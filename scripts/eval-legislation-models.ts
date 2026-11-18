import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { GoogleGenAI } from "@google/genai";
import OpenAI from "openai";
import { z } from "zod";
import { getOpenRouterKeys } from "@/lib/openrouter-keys";
import {
  buildSingleSummaryPrompt,
  getConfiguredOpenRouterModels,
  SUMMARY_SYSTEM_INSTRUCTION,
} from "@/lib/llm/router";
import { passesEvalQualityGate } from "@/lib/llm/eval-quality-gate";
import {
  GEMINI_FALLBACK_MODEL,
  SummaryAndCategoryItemSchema,
  toJsonSchema,
  type BatchSummaryOutputItem,
  type LlmLegislationInput,
} from "@/lib/llm/types";

const EXTRA_OPENROUTER_MODELS = [
  "openai/gpt-6-luna-pro",
  "anthropic/claude-haiku-5.5",
  "minimax/minimax-m3.1-flash",
] as const;
const JUDGE_MODEL = "openai/gpt-6-luna-pro";
const DEFAULT_RUNS = 3;
const DEFAULT_FIXTURE = path.resolve(
  process.cwd(),
  "scripts/fixtures/legislation-eval.json"
);
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_INPUT_CHARS = 120_000;

function getDefaultGeminiPricing(now = new Date()) {
  return now.toISOString().slice(0, 10) >= "2027-01-01"
    ? { input: 1.5, output: 7.5 }
    : { input: 0.75, output: 3.75 };
}

const EvalFactSchema = z.object({
  id: z.string().min(1),
  statement: z.string().min(1),
  critical: z.boolean(),
});

const EvalCaseSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  kind: z.enum(["bill", "executiveOrder"]).default("bill"),
  text: z.string().min(1),
  expectedFacts: z.array(EvalFactSchema).min(1),
});

const EvalCasesSchema = z.array(EvalCaseSchema).min(1);
const JudgeResponseSchema = z.object({
  score: z.number().int().min(1).max(5),
  facts: z.array(
    z.object({
      id: z.string().min(1),
      status: z.enum(["accurate", "omitted", "incorrect"]),
      note: z.string(),
    })
  ),
  materialErrors: z.array(z.string()),
});

type EvalCase = z.infer<typeof EvalCaseSchema>;
type JudgeResponse = z.infer<typeof JudgeResponseSchema>;
type Usage = {
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  costIsEstimate: boolean;
};
type ModelResult = {
  model: string;
  returnedModel: string | null;
  returnedProvider: string | null;
  caseId: string;
  run: number;
  candidateLatencyMs: number;
  usage: Usage;
  judgeCostUsd: number | null;
  summary: BatchSummaryOutputItem | null;
  judge: JudgeResponse | null;
  judgeError?: string;
  error?: string;
};

function readArgument(name: string): string | undefined {
  const prefix = `--${name}=`;
  const arg = process.argv.slice(2).find((value) => value.startsWith(prefix));
  return arg?.slice(prefix.length);
}

function readPositiveInteger(name: string, fallback: number): number {
  const raw = readArgument(name);
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`--${name} must be a positive integer`);
  }
  return parsed;
}

function readPrice(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative number`);
  }
  return parsed;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function openRouterCost(value: unknown): number | null {
  return numberOrNull(asRecord(value)?.cost);
}

function geminiCost(inputTokens: number | null, outputTokens: number | null) {
  if (inputTokens === null || outputTokens === null) return null;
  const defaults = getDefaultGeminiPricing();
  const inputRate = readPrice(
    "GEMINI_EVAL_INPUT_PRICE_PER_MILLION",
    defaults.input
  );
  const outputRate = readPrice(
    "GEMINI_EVAL_OUTPUT_PRICE_PER_MILLION",
    defaults.output
  );
  return (inputTokens * inputRate + outputTokens * outputRate) / 1_000_000;
}

function buildJudgePrompt(item: EvalCase, output: BatchSummaryOutputItem): string {
  const rubric = item.expectedFacts
    .map(
      (fact) =>
        `- ${fact.id}${fact.critical ? " (critical)" : ""}: ${fact.statement}`
    )
    .join("\n");

  return `Judge the summary against the source legislation. The model identity is hidden. Do not reward verbosity or penalize concise wording. Treat the source as authoritative and do not use outside knowledge.

Source title: ${item.title}
Source text:
${item.text}

Required factual criteria:
${rubric}

Candidate summary:
${output.summary}

Key points:
${output.keyPoints.map((point) => `- ${point}`).join("\n")}

Affected groups:
${output.impactAreas.map((area) => `- ${area}`).join("\n")}

Score the summary from 1 to 5 for factual accuracy and usefulness. Mark each required fact accurate only if the summary or its key points accurately convey it, omitted if absent, or incorrect if contradicted/misstated. Report only material factual errors or unsupported claims. A material error includes reversing a threshold/date, stating a proposal is enacted, or attributing a legal effect not in the source. Return one JSON object with keys "score", "facts", "materialErrors". Include exactly one facts entry for every required criterion, preserving its id.`;
}

function validateJudgeCoverage(judge: JudgeResponse, item: EvalCase): void {
  const expectedIds = new Set(item.expectedFacts.map((fact) => fact.id));
  const judgedIds = new Set(judge.facts.map((fact) => fact.id));
  if (
    judge.facts.length !== expectedIds.size ||
    judgedIds.size !== expectedIds.size ||
    Array.from(expectedIds).some((id) => !judgedIds.has(id))
  ) {
    throw new Error("Judge did not return exactly one result per required fact");
  }
}

async function judgeSummary(
  client: OpenAI,
  item: EvalCase,
  summary: BatchSummaryOutputItem
): Promise<{ judge: JudgeResponse; costUsd: number | null }> {
  const response = await client.chat.completions.create({
    model: JUDGE_MODEL,
    messages: [
      {
        role: "system",
        content:
          "You are a strict, impartial legal-text evaluation judge. Follow the rubric exactly and return valid JSON only.",
      },
      { role: "user", content: buildJudgePrompt(item, summary) },
    ],
    temperature: 0,
    max_tokens: 1600,
    response_format: { type: "json_object" },
  });
  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error("Judge returned empty content");
  const rawJudge: unknown = JSON.parse(content);
  const judge = JudgeResponseSchema.parse(rawJudge);
  validateJudgeCoverage(judge, item);
  return { judge, costUsd: openRouterCost(response.usage) };
}

function parseCandidateOutput(value: unknown, item: EvalCase) {
  const result = SummaryAndCategoryItemSchema.parse(value);
  if (result.id !== item.id) {
    throw new Error(`Returned id ${JSON.stringify(result.id)} does not match case`);
  }
  return result;
}

function toLegislationInput(item: EvalCase): LlmLegislationInput {
  return { id: item.id, title: item.title, text: item.text, kind: item.kind };
}

async function runOpenRouterCandidate(
  client: OpenAI,
  model: string,
  item: EvalCase
): Promise<{
  summary: BatchSummaryOutputItem;
  returnedModel: string;
  returnedProvider: string | null;
  usage: Usage;
}> {
  const completion = await client.chat.completions.create({
    model,
    messages: [
      { role: "system", content: SUMMARY_SYSTEM_INSTRUCTION },
      {
        role: "user",
        content: buildSingleSummaryPrompt(
          toLegislationInput(item),
          [],
          MAX_INPUT_CHARS
        ),
      },
    ],
    temperature: 0.2,
    max_tokens: 2500,
    response_format: { type: "json_object" },
  });
  const content = completion.choices[0]?.message?.content;
  if (!content) throw new Error("Model returned empty content");
  const rawCandidate: unknown = JSON.parse(content);
  const usage = completion.usage as unknown;
  const usageRecord = asRecord(usage);
  const provider = asRecord(completion as unknown)?.provider;

  return {
    summary: parseCandidateOutput(rawCandidate, item),
    returnedModel: completion.model || model,
    returnedProvider: typeof provider === "string" ? provider : null,
    usage: {
      inputTokens: numberOrNull(usageRecord?.prompt_tokens),
      outputTokens: numberOrNull(usageRecord?.completion_tokens),
      costUsd: openRouterCost(usage),
      costIsEstimate: false,
    },
  };
}

async function runGeminiCandidate(
  client: GoogleGenAI,
  item: EvalCase
): Promise<{ summary: BatchSummaryOutputItem; usage: Usage }> {
  const interaction = await client.interactions.create({
    model: GEMINI_FALLBACK_MODEL,
    store: false,
    system_instruction: SUMMARY_SYSTEM_INSTRUCTION,
    input: buildSingleSummaryPrompt(toLegislationInput(item), [], MAX_INPUT_CHARS),
    response_format: {
      type: "text",
      mime_type: "application/json",
      schema: toJsonSchema(SummaryAndCategoryItemSchema),
    },
  });
  if (interaction.status !== "completed") {
    throw new Error(`Gemini interaction status: ${interaction.status}`);
  }
  if (!interaction.output_text?.trim()) {
    throw new Error("Gemini returned empty output_text");
  }

  const rawCandidate: unknown = JSON.parse(interaction.output_text);
  const inputTokens = numberOrNull(interaction.usage?.total_input_tokens);
  const outputTokens = numberOrNull(interaction.usage?.total_output_tokens);
  return {
    summary: parseCandidateOutput(rawCandidate, item),
    usage: {
      inputTokens,
      outputTokens,
      costUsd: geminiCost(inputTokens, outputTokens),
      costIsEstimate: true,
    },
  };
}

async function evaluateOne(
  openRouterClient: OpenAI,
  geminiClient: GoogleGenAI | null,
  model: string,
  item: EvalCase,
  run: number
): Promise<ModelResult> {
  const startedAt = Date.now();
  let candidateLatencyMs: number | null = null;
  let usage: Usage = {
    inputTokens: null,
    outputTokens: null,
    costUsd: null,
    costIsEstimate: false,
  };
  let returnedModel: string | null = null;
  let returnedProvider: string | null = null;
  let judgeCostUsd: number | null = null;

  try {
    let candidate: { summary: BatchSummaryOutputItem; usage: Usage };
    if (model === GEMINI_FALLBACK_MODEL) {
      if (!geminiClient) throw new Error("GEMINI_API_KEY is not configured");
      candidate = await runGeminiCandidate(geminiClient, item);
      returnedModel = GEMINI_FALLBACK_MODEL;
      returnedProvider = "Google AI API";
    } else {
      const result = await runOpenRouterCandidate(openRouterClient, model, item);
      candidate = { summary: result.summary, usage: result.usage };
      returnedModel = result.returnedModel;
      returnedProvider = result.returnedProvider;
    }
    candidateLatencyMs = Date.now() - startedAt;
    usage = candidate.usage;

    let judge: JudgeResponse | null = null;
    let judgeError: string | undefined;
    try {
      const judged = await judgeSummary(openRouterClient, item, candidate.summary);
      judge = judged.judge;
      judgeCostUsd = judged.costUsd;
    } catch (error) {
      judgeError = error instanceof Error ? error.message : String(error);
    }

    return {
      model,
      caseId: item.id,
      run,
      candidateLatencyMs,
      usage,
      returnedModel,
      returnedProvider,
      judgeCostUsd,
      summary: candidate.summary,
      judge,
      ...(judgeError ? { judgeError } : {}),
    };
  } catch (error) {
    return {
      model,
      caseId: item.id,
      run,
      candidateLatencyMs: candidateLatencyMs ?? Date.now() - startedAt,
      usage,
      returnedModel,
      returnedProvider,
      judgeCostUsd,
      summary: null,
      judge: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function isPassing(result: ModelResult, item: EvalCase): boolean {
  return passesEvalQualityGate(
    result.judge,
    item.expectedFacts,
    result.summary !== null
  );
}

function getModelMetrics(
  model: string,
  results: ModelResult[],
  cases: EvalCase[],
  runsPerCase: number
) {
  const modelResults = results.filter((result) => result.model === model);
  const passing = modelResults.filter((result) => {
    const item = cases.find((candidate) => candidate.id === result.caseId);
    return item !== undefined && isPassing(result, item);
  });
  const judgeable = modelResults.filter((result) => result.judge !== null);
  const scores = judgeable.map((result) => result.judge!.score);
  const judgedFacts = judgeable.flatMap((result) => result.judge!.facts);
  const allCriticalChecks = modelResults.every((result) => {
    const item = cases.find((candidate) => candidate.id === result.caseId);
    return item !== undefined && isPassing(result, item);
  });
  const costValues = modelResults
    .map((result) => result.usage.costUsd)
    .filter((cost): cost is number => cost !== null);
  const uniqueRunCases = new Set(
    modelResults.map((result) => `${result.run}:${result.caseId}`)
  );
  const judgeCosts = modelResults
    .map((result) => result.judgeCostUsd)
    .filter((cost): cost is number => cost !== null);
  const judgedFactCount = judgedFacts.length;
  const correctFacts = judgedFacts.filter((fact) => fact.status === "accurate").length;

  return {
    runs: modelResults.length,
    expectedRuns: cases.length * runsPerCase,
    passRate: modelResults.length ? passing.length / modelResults.length : 0,
    allRunsPass:
      modelResults.length === cases.length * runsPerCase &&
      uniqueRunCases.size === cases.length * runsPerCase &&
      allCriticalChecks,
    averageJudgeScore: scores.length
      ? scores.reduce((total, score) => total + score, 0) / scores.length
      : null,
    factAccuracy: judgedFactCount ? correctFacts / judgedFactCount : null,
    averageCostUsd: costValues.length
      ? costValues.reduce((total, cost) => total + cost, 0) / costValues.length
      : null,
    costsComplete: costValues.length === modelResults.length,
    estimatedCost: modelResults.some((result) => result.usage.costIsEstimate),
    averageJudgeCostUsd: judgeCosts.length
      ? judgeCosts.reduce((total, cost) => total + cost, 0) / judgeCosts.length
      : null,
    averageLatencyMs: modelResults.length
      ? modelResults.reduce((total, result) => total + result.candidateLatencyMs, 0) /
        modelResults.length
      : null,
    judgeFailures: modelResults.filter((result) => result.judge === null).length,
    modelFailures: modelResults.filter((result) => result.summary === null).length,
  };
}

function formatUsd(value: number | null, estimated: boolean): string {
  if (value === null) return "n/a";
  return `${estimated ? "~" : ""}$${value.toFixed(5)}`;
}

function printHelp(): void {
  console.log(`Legislation model evaluation

Usage:
  npm run eval:legislation -- [--models=model-a,model-b] [--fixture=path] [--runs=3]

Default candidates: configured OPENROUTER_MODELS, ${EXTRA_OPENROUTER_MODELS.join(", ")}, ${GEMINI_FALLBACK_MODEL}.
The fixed judge is ${JUDGE_MODEL}. Requires OpenRouter access for candidates/judge, and GEMINI_API_KEY for Gemini.
Results are saved under .eval-results/.`);
}

async function main(): Promise<void> {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    printHelp();
    return;
  }

  const fixturePath = path.resolve(
    process.cwd(),
    readArgument("fixture") ?? DEFAULT_FIXTURE
  );
  const fixtureRaw: unknown = JSON.parse(await fs.readFile(fixturePath, "utf8"));
  const cases = EvalCasesSchema.parse(fixtureRaw);
  const runs = readPositiveInteger("runs", DEFAULT_RUNS);
  const requestedModels = readArgument("models")
    ?.split(",")
    .map((model) => model.trim())
    .filter(Boolean);
  const models = Array.from(
    new Set(
      requestedModels ?? [
        ...getConfiguredOpenRouterModels(),
        ...EXTRA_OPENROUTER_MODELS,
        GEMINI_FALLBACK_MODEL,
      ]
    )
  );
  if (models.length === 0) {
    throw new Error("No models selected for evaluation.");
  }
  const usesOpenRouter = models.some((model) => model !== GEMINI_FALLBACK_MODEL);
  const keys = getOpenRouterKeys();
  if (usesOpenRouter && keys.length === 0) {
    throw new Error("Configure an OpenRouter key for model candidates and judging.");
  }
  if (!keys.length) {
    throw new Error(`Configure an OpenRouter key for the fixed judge (${JUDGE_MODEL}).`);
  }

  const openRouterClient = new OpenAI({
    apiKey: keys[0],
    baseURL: "https://openrouter.ai/api/v1",
    maxRetries: 0,
    timeout: DEFAULT_TIMEOUT_MS,
    defaultHeaders: {
      "HTTP-Referer": process.env.SITE_URL || "https://legistrack.vercel.app",
      "X-Title": "Legislation Tracker - Summarization Model Eval",
    },
  });
  const geminiApiKey = process.env.GEMINI_API_KEY?.trim();
  const geminiClient = geminiApiKey ? new GoogleGenAI({ apiKey: geminiApiKey }) : null;

  const results: ModelResult[] = [];
  for (let run = 1; run <= runs; run++) {
    for (const item of cases) {
      console.log(`Run ${run}/${runs}: ${item.id} · ${models.length} models in parallel`);
      const caseResults = await Promise.all(
        models.map((model) =>
          evaluateOne(openRouterClient, geminiClient, model, item, run)
        )
      );
      for (const result of caseResults) {
        results.push(result);
        const status = result.error
          ? `model error: ${result.error}`
          : result.judgeError
            ? `judge error: ${result.judgeError}`
            : `${isPassing(result, item) ? "PASS" : "FAIL"} · judge ${result.judge?.score}/5 · ${formatUsd(result.usage.costUsd, result.usage.costIsEstimate)}`;
        console.log(`  ${result.model}: ${status}`);
      }
    }
  }

  const generatedAt = new Date().toISOString();
  const geminiPricing = getDefaultGeminiPricing(new Date(generatedAt));
  const outputDir = path.resolve(process.cwd(), ".eval-results");
  await fs.mkdir(outputDir, { recursive: true });
  const outputPath = path.join(
    outputDir,
    `legislation-model-eval-${generatedAt.replace(/[:.]/g, "-")}.json`
  );
  await fs.writeFile(
    outputPath,
    `${JSON.stringify(
      {
        generatedAt,
        fixture: path.relative(process.cwd(), fixturePath),
        runsPerCase: runs,
        judge: { model: JUDGE_MODEL, temperature: 0 },
        selectionRule:
          "Eligible models pass every case in every run with judge score >= 4/5, all critical facts accurate, no incorrect required facts, no material errors, and complete candidate cost data. Recommend the eligible model with the lowest mean candidate cost per case. Gemini cost is estimated from configured rates.",
        geminiPricing: {
          inputPerMillionUsd: readPrice(
            "GEMINI_EVAL_INPUT_PRICE_PER_MILLION",
            geminiPricing.input
          ),
          outputPerMillionUsd: readPrice(
            "GEMINI_EVAL_OUTPUT_PRICE_PER_MILLION",
            geminiPricing.output
          ),
        },
        models,
        results,
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  const metrics = models.map((model) => ({
    model,
    ...getModelMetrics(model, results, cases, runs),
  }));
  const eligible = metrics
    .filter(
      (metric) =>
        metric.allRunsPass && metric.costsComplete && metric.averageCostUsd !== null
    )
    .sort((left, right) => left.averageCostUsd! - right.averageCostUsd!);

  console.log("\nModel comparison:");
  console.log("Model | pass runs | judge /5 | fact accuracy | mean cost/case | mean latency | verdict");
  for (const metric of metrics) {
    const score = metric.averageJudgeScore?.toFixed(2) ?? "n/a";
    const factRate =
      metric.factAccuracy === null ? "n/a" : `${(metric.factAccuracy * 100).toFixed(1)}%`;
    const latency =
      metric.averageLatencyMs === null
        ? "n/a"
        : `${Math.round(metric.averageLatencyMs)}ms`;
    const verdict =
      metric.judgeFailures > 0 || metric.modelFailures > 0
        ? "incomplete"
        : metric.allRunsPass && metric.costsComplete
          ? "pass"
          : metric.allRunsPass
            ? "missing cost data"
            : "fails quality gate";
    console.log(
      `${metric.model} | ${Math.round(metric.passRate * metric.runs)}/${metric.runs} | ${score} | ${factRate} | ${formatUsd(metric.averageCostUsd, metric.estimatedCost)} | ${latency} | ${verdict}`
    );
  }
  console.log(
    eligible.length
      ? `\nCheapest consistent, accurate model: ${eligible[0].model} (${formatUsd(eligible[0].averageCostUsd, eligible[0].estimatedCost)} per case).`
      : "\nNo model passed every repeat and case. Increase the fixture size, inspect judge feedback, or relax the quality gate deliberately."
  );
  console.log(`Results: ${path.relative(process.cwd(), outputPath)}`);
  console.log(
    `Note: candidate cost excludes judge calls (mean judge cost/run by candidate: ${metrics
      .map(
        (metric) =>
          `${metric.model} ${formatUsd(metric.averageJudgeCostUsd ?? null, false)}`
      )
      .join(", ")}). OpenRouter candidate cost is provider-reported; Gemini cost is estimated and its direct API calls do not consume the production fallback quota.`
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
