import {
  categorizeLegislationItem,
  resetOpenRouterRouterStateForTests,
  summarizeAndCategorizeItems,
  truncateForPrompt,
} from "@/lib/llm/router";
import { callGeminiStructured } from "@/lib/llm/gemini";
import {
  CategorizeOnlySchema,
  DEFAULT_OPENROUTER_MODELS,
  FallbackCapReachedError,
  GEMINI_FALLBACK_MODEL,
  SummaryAndCategoryBatchSchema,
  type LlmCategoryInput,
  type LlmLegislationInput,
} from "@/lib/llm/types";
import {
  determineBillStatus,
  resolveProvider,
  summarizeBillStandard,
} from "@/workflows/summarize-bill-standard";
import { categorizeBill } from "@/lib/ai/categorizer";
import {
  generateSummaryOpenRouter,
  getAvailableModels,
  OPENROUTER_MODELS as SUMMARIZER_OPENROUTER_MODELS,
} from "@/lib/ai/summarizer-openrouter";
import {
  OPENROUTER_MODELS as LEGACY_LLM_OPENROUTER_MODELS,
  resolveOpenRouterModelConfig,
  summarizeAndCategorizeWithKey,
} from "@/lib/llm";

jest.mock("openai", () => {
  const create = jest.fn();
  const OpenAI = jest.fn().mockImplementation((config?: { apiKey?: string }) => {
    if (!config?.apiKey) {
      throw new Error("Missing credentials. Please pass an apiKey");
    }
    return {
      chat: {
        completions: {
          create: (params: unknown, options?: unknown) =>
            create(params, options, config.apiKey),
        },
      },
    };
  });
  return {
    __esModule: true,
    default: OpenAI,
    __mockCreate: create,
  };
});

jest.mock("@anthropic-ai/sdk", () => {
  const create = jest.fn();
  const Anthropic = jest.fn().mockImplementation(() => ({
    messages: { create },
  }));
  return {
    __esModule: true,
    default: Anthropic,
    __mockMessagesCreate: create,
  };
});

jest.mock("@/lib/llm/gemini", () => ({
  callGeminiStructured: jest.fn(),
  getRemainingGeminiFallbackQuota: jest.fn(),
}));

jest.mock("@/lib/db", () => ({
  db: {
    bill: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    category: {
      findMany: jest.fn(),
    },
    summary: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
  },
}));

jest.mock("@/lib/llmRedis", () => ({
  __esModule: true,
  default: {
    reserveForKeyIndex: jest.fn(),
    refundForKeyIndex: jest.fn(),
    enqueuePayload: jest.fn(),
  },
}));

jest.mock("@/lib/api/congress", () => ({
  fetchBillDetails: jest.fn(),
  fetchBillText: jest.fn(),
}));

interface MockOpenAIModule {
  default: jest.Mock;
  __mockCreate: jest.Mock;
}

interface MockAnthropicModule {
  default: jest.Mock;
  __mockMessagesCreate: jest.Mock;
}

interface MockDbModule {
  db: {
    bill: { findUnique: jest.Mock; update: jest.Mock };
    category: { findMany: jest.Mock };
    summary: { findFirst: jest.Mock; create: jest.Mock };
  };
}

interface MockCongressModule {
  fetchBillDetails: jest.Mock;
  fetchBillText: jest.Mock;
}

const mockOpenAI = jest.requireMock("openai") as MockOpenAIModule;
const mockAnthropic = jest.requireMock(
  "@anthropic-ai/sdk"
) as MockAnthropicModule;
const mockCallGeminiStructured = callGeminiStructured as jest.Mock;
const { db: mockDb } = jest.requireMock("@/lib/db") as MockDbModule;
const mockCongress = jest.requireMock(
  "@/lib/api/congress"
) as MockCongressModule;

const VALID_SUMMARY =
  "This bipartisan legislative measure establishes federal infrastructure grants, modernizes municipal drinking water facilities, and directs targeted technical assistance toward rural communities nationwide.";

const SAMPLE_CATEGORIES: LlmCategoryInput[] = [
  {
    id: "cat-1",
    slug: "infrastructure",
    name: "Infrastructure",
    description: "Roads, bridges, water systems, and public works",
  },
  {
    id: "cat-2",
    slug: "healthcare",
    name: "Healthcare",
    description: "Public health, hospitals, and medical access",
  },
  {
    id: "cat-3",
    slug: "environment-climate",
    name: "Environment & Climate",
    description: "Clean water, conservation, and climate resilience",
  },
];

function makeOpenRouterError(status: number, message: string): Error & {
  status: number;
} {
  const err = new Error(message) as Error & { status: number };
  err.status = status;
  return err;
}

function makeCompletionResponse(payload: unknown) {
  return {
    choices: [
      {
        message: {
          content:
            typeof payload === "string" ? payload : JSON.stringify(payload),
        },
      },
    ],
  };
}

function makeItem(id: string, text = "Full bill text ".repeat(30)): LlmLegislationInput {
  return {
    id,
    title: `Legislation ${id}`,
    text,
    kind: "bill",
  };
}

describe("Unified OpenRouter -> Gemini router & legacy migration", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    resetOpenRouterRouterStateForTests();
    process.env = { ...originalEnv };
    delete process.env.OPENROUTER_API_KEYS;
    delete process.env.OPENROUTER_MODELS;
    delete process.env.OPENROUTER_MODEL;
    delete process.env.OPENROUTER_MAX_INPUT_CHARS;
    delete process.env.OPENROUTER_TIMEOUT_MS;
    delete process.env.AI_MODEL;
    delete process.env.INGEST_AI_MODEL;
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.GEMINI_API_KEY;
    for (let i = 1; i <= 10; i++) {
      delete process.env[`OPENROUTER_API_KEY_${i}`];
      delete process.env[`OPENROUTER_KEY_${i}`];
    }
    process.env.OPENROUTER_API_KEYS = "or-key-1,or-key-2";
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("iterates paid Flash models in exact order and rotates across keys on 429 without calling Gemini", async () => {
    expect(DEFAULT_OPENROUTER_MODELS).toEqual([
      "deepseek/deepseek-v4.1-flash-1017",
      "xiaomi/mimo-v2.6-flash",
      "z-ai/glm-5.3-flash",
    ]);

    mockOpenAI.__mockCreate
      .mockRejectedValueOnce(makeOpenRouterError(429, "Rate limit key 1"))
      .mockRejectedValueOnce(makeOpenRouterError(429, "Rate limit key 2"))
      .mockResolvedValueOnce(
        makeCompletionResponse({
          id: "bill-1",
          summary: VALID_SUMMARY,
          keyPoints: ["Expands municipal water grants across rural districts."],
          impactAreas: ["Local water authorities"],
          categories: ["infrastructure", "environment-climate"],
          confidence: 0.91,
        })
      );

    const outcomes = await summarizeAndCategorizeItems(
      [makeItem("bill-1")],
      SAMPLE_CATEGORIES
    );

    expect(outcomes).toEqual([
      {
        id: "bill-1",
        ok: true,
        summary: VALID_SUMMARY,
        keyPoints: ["Expands municipal water grants across rural districts."],
        impactAreas: ["Local water authorities"],
        categories: ["infrastructure", "environment-climate"],
        confidence: 0.91,
        aiModel: "xiaomi/mimo-v2.6-flash",
      },
    ]);

    expect(mockCallGeminiStructured).not.toHaveBeenCalled();

    const attempted = mockOpenAI.__mockCreate.mock.calls.map(
      ([params, , apiKey]) => ({
        model: (params as { model: string }).model,
        apiKey,
        responseFormat: (params as { response_format?: unknown }).response_format,
      })
    );

    expect(attempted).toEqual([
      {
        model: "deepseek/deepseek-v4.1-flash-1017",
        apiKey: "or-key-1",
        responseFormat: { type: "json_object" },
      },
      {
        model: "deepseek/deepseek-v4.1-flash-1017",
        apiKey: "or-key-2",
        responseFormat: { type: "json_object" },
      },
      {
        model: "xiaomi/mimo-v2.6-flash",
        apiKey: "or-key-1",
        responseFormat: { type: "json_object" },
      },
    ]);
  });

  it("rotates through model 3 (z-ai/glm-5.3-flash) when models 1 and 2 fail 5xx/429", async () => {
    mockOpenAI.__mockCreate
      .mockRejectedValueOnce(makeOpenRouterError(503, "Model 1 key 1 down"))
      .mockRejectedValueOnce(makeOpenRouterError(502, "Model 1 key 2 bad gw"))
      .mockRejectedValueOnce(makeOpenRouterError(429, "Model 2 key 1 limited"))
      .mockRejectedValueOnce(makeOpenRouterError(500, "Model 2 key 2 error"))
      .mockResolvedValueOnce(
        makeCompletionResponse({
          id: "bill-glm",
          summary: VALID_SUMMARY,
          keyPoints: ["Modernizes public water utilities."],
          impactAreas: ["Municipalities"],
          categories: ["infrastructure"],
          confidence: 0.85,
        })
      );

    const outcomes = await summarizeAndCategorizeItems(
      [makeItem("bill-glm")],
      SAMPLE_CATEGORIES
    );

    expect(outcomes[0]).toMatchObject({
      id: "bill-glm",
      ok: true,
      aiModel: "z-ai/glm-5.3-flash",
    });
    expect(mockCallGeminiStructured).not.toHaveBeenCalled();
  });

  it("skips a 402/401 key immediately on the same model, and short-circuits to Gemini when all keys fail 401/402", async () => {
    // Subcase A: key 1 hits 402, key 2 succeeds on the same model
    mockOpenAI.__mockCreate
      .mockRejectedValueOnce(makeOpenRouterError(402, "Insufficient credits"))
      .mockResolvedValueOnce(
        makeCompletionResponse({
          id: "bill-key2",
          summary: VALID_SUMMARY,
          keyPoints: ["Updates rural water infrastructure funding."],
          impactAreas: ["Rural communities"],
          categories: ["infrastructure"],
          confidence: 0.88,
        })
      );

    const firstOutcomes = await summarizeAndCategorizeItems(
      [makeItem("bill-key2")],
      SAMPLE_CATEGORIES
    );
    expect(firstOutcomes[0]).toMatchObject({
      id: "bill-key2",
      ok: true,
      aiModel: "deepseek/deepseek-v4.1-flash-1017",
    });
    expect(mockCallGeminiStructured).not.toHaveBeenCalled();

    // Key 1 remains disabled on the subsequent call
    mockOpenAI.__mockCreate.mockClear();
    mockOpenAI.__mockCreate.mockRejectedValueOnce(
      makeOpenRouterError(401, "Invalid API key 2")
    );
    mockCallGeminiStructured.mockResolvedValueOnce({
      data: {
        id: "bill-shortcircuit",
        summary: VALID_SUMMARY,
        keyPoints: ["Provides federal drinking water grants."],
        impactAreas: ["Small municipalities"],
        categories: ["infrastructure"],
        confidence: 0.9,
      },
      model: GEMINI_FALLBACK_MODEL,
    });

    const secondOutcomes = await summarizeAndCategorizeItems(
      [makeItem("bill-shortcircuit")],
      SAMPLE_CATEGORIES
    );

    // Only key 2 was tried once on model 1 before short-circuiting straight to Gemini
    expect(mockOpenAI.__mockCreate).toHaveBeenCalledTimes(1);
    expect(mockOpenAI.__mockCreate.mock.calls[0][2]).toBe("or-key-2");
    expect(mockCallGeminiStructured).toHaveBeenCalledTimes(1);
    expect(secondOutcomes[0]).toMatchObject({
      id: "bill-shortcircuit",
      ok: true,
      aiModel: "gemini-3.8-flash",
    });
  });

  it("short-circuits directly to Gemini without trying remaining models when all keys fail 401/402 in a single call", async () => {
    mockOpenAI.__mockCreate
      .mockRejectedValueOnce(makeOpenRouterError(401, "Bad key 1"))
      .mockRejectedValueOnce(makeOpenRouterError(402, "Out of credits key 2"));

    mockCallGeminiStructured.mockResolvedValueOnce({
      data: {
        id: "bill-dead-keys",
        summary: VALID_SUMMARY,
        keyPoints: ["Authorizes infrastructure grants."],
        impactAreas: ["Water districts"],
        categories: ["infrastructure"],
        confidence: 0.89,
      },
      model: GEMINI_FALLBACK_MODEL,
    });

    const outcomes = await summarizeAndCategorizeItems(
      [makeItem("bill-dead-keys")],
      SAMPLE_CATEGORIES
    );

    // Exactly 2 OpenRouter calls (key 1 + key 2 on model 1); NOT 6 calls across models 2 and 3
    expect(mockOpenAI.__mockCreate).toHaveBeenCalledTimes(2);
    expect(mockCallGeminiStructured).toHaveBeenCalledTimes(1);
    expect(outcomes[0]).toMatchObject({
      id: "bill-dead-keys",
      ok: true,
      aiModel: "gemini-3.8-flash",
    });
  });

  it("lets FallbackCapReachedError propagate cleanly when OpenRouter fails and Gemini cap is reached", async () => {
    mockOpenAI.__mockCreate
      .mockRejectedValueOnce(makeOpenRouterError(402, "Out of credits 1"))
      .mockRejectedValueOnce(makeOpenRouterError(402, "Out of credits 2"));

    mockCallGeminiStructured.mockRejectedValueOnce(
      new FallbackCapReachedError("Daily cap reached", {
        reason: "daily-cap-reached",
        used: 20,
        limit: 20,
      })
    );

    await expect(
      summarizeAndCategorizeItems([makeItem("bill-cap")], SAMPLE_CATEGORIES)
    ).rejects.toBeInstanceOf(FallbackCapReachedError);
  });

  it("advances directly to model 2 using valid keys when model 1 returns 400 or 404", async () => {
    mockOpenAI.__mockCreate
      .mockRejectedValueOnce(makeOpenRouterError(404, "Model not found"))
      .mockResolvedValueOnce(
        makeCompletionResponse({
          id: "bill-404",
          summary: VALID_SUMMARY,
          keyPoints: ["Modernizes public infrastructure."],
          impactAreas: ["Communities"],
          categories: ["infrastructure"],
          confidence: 0.84,
        })
      );

    const outcomes404 = await summarizeAndCategorizeItems(
      [makeItem("bill-404")],
      SAMPLE_CATEGORIES
    );

    expect(outcomes404[0]).toMatchObject({
      id: "bill-404",
      ok: true,
      aiModel: "xiaomi/mimo-v2.6-flash",
    });
    expect(
      mockOpenAI.__mockCreate.mock.calls.map(([p, , key]) => [
        (p as { model: string }).model,
        key,
      ])
    ).toEqual([
      ["deepseek/deepseek-v4.1-flash-1017", "or-key-1"],
      ["xiaomi/mimo-v2.6-flash", "or-key-1"],
    ]);

    resetOpenRouterRouterStateForTests();
    mockOpenAI.__mockCreate.mockClear();

    mockOpenAI.__mockCreate
      .mockRejectedValueOnce(makeOpenRouterError(400, "Bad request for model"))
      .mockResolvedValueOnce(
        makeCompletionResponse({
          id: "bill-400",
          summary: VALID_SUMMARY,
          keyPoints: ["Modernizes public infrastructure."],
          impactAreas: ["Communities"],
          categories: ["healthcare"],
          confidence: 0.86,
        })
      );

    const outcomes400 = await summarizeAndCategorizeItems(
      [makeItem("bill-400")],
      SAMPLE_CATEGORIES
    );

    expect(outcomes400[0]).toMatchObject({
      id: "bill-400",
      ok: true,
      aiModel: "xiaomi/mimo-v2.6-flash",
    });
    expect(
      mockOpenAI.__mockCreate.mock.calls.map(([p, , key]) => [
        (p as { model: string }).model,
        key,
      ])
    ).toEqual([
      ["deepseek/deepseek-v4.1-flash-1017", "or-key-1"],
      ["xiaomi/mimo-v2.6-flash", "or-key-1"],
    ]);
    expect(mockCallGeminiStructured).not.toHaveBeenCalled();
  });

  it("keeps valid items from a 3-item batch and retries omitted or corrupt item individually via OpenRouter before Gemini", async () => {
    process.env.OPENROUTER_API_KEYS = "or-key-1";

    // Subcase A: Batch omits item-2; single-item retry succeeds on OpenRouter without Gemini
    mockOpenAI.__mockCreate
      .mockResolvedValueOnce(
        makeCompletionResponse({
          items: [
            {
              id: "bill-1",
              summary: VALID_SUMMARY,
              keyPoints: ["Key point for bill 1"],
              impactAreas: ["Cities"],
              categories: ["infrastructure"],
              confidence: 0.9,
            },
            {
              id: "bill-3",
              summary: VALID_SUMMARY,
              keyPoints: ["Key point for bill 3"],
              impactAreas: ["Hospitals"],
              categories: ["healthcare"],
              confidence: 0.87,
            },
          ],
        })
      )
      .mockResolvedValueOnce(
        makeCompletionResponse({
          id: "bill-2",
          summary: VALID_SUMMARY,
          keyPoints: ["Key point for bill 2"],
          impactAreas: ["Watersheds"],
          categories: ["environment-climate"],
          confidence: 0.88,
        })
      );

    const outcomes = await summarizeAndCategorizeItems(
      [makeItem("bill-1"), makeItem("bill-2"), makeItem("bill-3")],
      SAMPLE_CATEGORIES
    );

    expect(outcomes).toHaveLength(3);
    expect(outcomes.map((o) => o.id)).toEqual(["bill-1", "bill-2", "bill-3"]);
    expect(outcomes.every((o) => o.ok)).toBe(true);
    expect(mockCallGeminiStructured).not.toHaveBeenCalled();
    expect(mockOpenAI.__mockCreate).toHaveBeenCalledTimes(2);

    // Subcase B: Batch returns corrupt summary for bill-2, single retry fails OpenRouter -> falls back to Gemini ONLY for bill-2
    resetOpenRouterRouterStateForTests();
    mockOpenAI.__mockCreate.mockClear();
    mockCallGeminiStructured.mockClear();

    mockOpenAI.__mockCreate
      .mockResolvedValueOnce(
        makeCompletionResponse({
          items: [
            {
              id: "bill-1",
              summary: VALID_SUMMARY,
              keyPoints: ["Valid bill 1 point"],
              impactAreas: ["States"],
              categories: ["infrastructure"],
              confidence: 0.9,
            },
            {
              id: "bill-2",
              summary: "Too short summary",
              keyPoints: ["Invalid"],
              impactAreas: [],
              categories: ["healthcare"],
            },
            {
              id: "bill-3",
              summary: VALID_SUMMARY,
              keyPoints: ["Valid bill 3 point"],
              impactAreas: ["States"],
              categories: ["healthcare"],
              confidence: 0.85,
            },
          ],
        })
      )
      // All 3 models fail on single-item OpenRouter retry for bill-2
      .mockRejectedValueOnce(makeOpenRouterError(429, "limit 1"))
      .mockRejectedValueOnce(makeOpenRouterError(429, "limit 2"))
      .mockRejectedValueOnce(makeOpenRouterError(429, "limit 3"));

    mockCallGeminiStructured.mockResolvedValueOnce({
      data: {
        id: "bill-2",
        summary: VALID_SUMMARY,
        keyPoints: ["Recovered via Gemini"],
        impactAreas: ["Rural water utilities"],
        categories: ["environment-climate"],
        confidence: 0.92,
      },
      model: GEMINI_FALLBACK_MODEL,
    });

    const partialFallback = await summarizeAndCategorizeItems(
      [makeItem("bill-1"), makeItem("bill-2"), makeItem("bill-3")],
      SAMPLE_CATEGORIES
    );

    expect(partialFallback[0]).toMatchObject({
      id: "bill-1",
      ok: true,
      aiModel: "deepseek/deepseek-v4.1-flash-1017",
    });
    expect(partialFallback[1]).toMatchObject({
      id: "bill-2",
      ok: true,
      aiModel: "gemini-3.8-flash",
    });
    expect(partialFallback[2]).toMatchObject({
      id: "bill-3",
      ok: true,
      aiModel: "deepseek/deepseek-v4.1-flash-1017",
    });
    expect(mockCallGeminiStructured).toHaveBeenCalledTimes(1);
    expect(mockCallGeminiStructured.mock.calls[0][0].itemIds).toEqual(["bill-2"]);
  });

  it("retries each item individually through OpenRouter when a 3-item batch returns malformed JSON", async () => {
    process.env.OPENROUTER_API_KEYS = "or-key-1";

    mockOpenAI.__mockCreate
      .mockResolvedValueOnce(makeCompletionResponse("{ invalid json <<<"))
      .mockResolvedValueOnce(
        makeCompletionResponse({
          id: "bill-a",
          summary: VALID_SUMMARY,
          keyPoints: ["Point A"],
          impactAreas: ["Area A"],
          categories: ["infrastructure"],
        })
      )
      .mockResolvedValueOnce(
        makeCompletionResponse({
          id: "bill-b",
          summary: VALID_SUMMARY,
          keyPoints: ["Point B"],
          impactAreas: ["Area B"],
          categories: ["healthcare"],
        })
      )
      .mockResolvedValueOnce(
        makeCompletionResponse({
          id: "bill-c",
          summary: VALID_SUMMARY,
          keyPoints: ["Point C"],
          impactAreas: ["Area C"],
          categories: ["environment-climate"],
        })
      );

    const outcomes = await summarizeAndCategorizeItems(
      [makeItem("bill-a"), makeItem("bill-b"), makeItem("bill-c")],
      SAMPLE_CATEGORIES
    );

    expect(outcomes.every((o) => o.ok)).toBe(true);
    expect(mockOpenAI.__mockCreate).toHaveBeenCalledTimes(4);
    expect(mockCallGeminiStructured).not.toHaveBeenCalled();
  });

  it("truncates oversized input text cleanly via OPENROUTER_MAX_INPUT_CHARS (default 120000) without throwing", async () => {
    process.env.OPENROUTER_API_KEYS = "or-key-1";
    const hugeText = "A".repeat(250_000);

    const defaultTruncated = truncateForPrompt(hugeText);
    expect(defaultTruncated.length).toBeLessThanOrEqual(120_000);
    expect(defaultTruncated).toContain("truncated");

    process.env.OPENROUTER_MAX_INPUT_CHARS = "500";
    mockOpenAI.__mockCreate.mockResolvedValueOnce(
      makeCompletionResponse({
        id: "bill-huge",
        summary: VALID_SUMMARY,
        keyPoints: ["Handles large legislation safely."],
        impactAreas: ["Federal agencies"],
        categories: ["infrastructure"],
      })
    );

    const outcomes = await summarizeAndCategorizeItems(
      [makeItem("bill-huge", hugeText)],
      SAMPLE_CATEGORIES
    );

    expect(outcomes[0]).toMatchObject({ id: "bill-huge", ok: true });
    const sentMessages = (
      mockOpenAI.__mockCreate.mock.calls[0][0] as {
        messages: Array<{ content: string }>;
      }
    ).messages;
    const userPrompt = sentMessages[1].content;
    expect(userPrompt.length).toBeLessThan(2_000);
  });

  it("supports categorizeLegislationItem with OpenRouter primary and Gemini fallback", async () => {
    process.env.OPENROUTER_API_KEYS = "or-key-1";
    mockOpenAI.__mockCreate
      .mockRejectedValueOnce(makeOpenRouterError(429, "Rate limited"))
      .mockResolvedValueOnce(
        makeCompletionResponse({
          categories: ["healthcare", "unknown-slug", "infrastructure"],
        })
      );

    const catResult = await categorizeLegislationItem({
      title: "Clean Water and Health Act",
      summary: VALID_SUMMARY,
      categories: SAMPLE_CATEGORIES,
    });

    expect(catResult).toEqual({
      categories: ["healthcare", "infrastructure"],
      aiModel: "xiaomi/mimo-v2.6-flash",
    });
    expect(mockCallGeminiStructured).not.toHaveBeenCalled();
  });

  it("defaults resolveProvider to openrouter and categorizeBill to categorizeLegislationItem while preserving Anthropic opt-in", async () => {
    expect(resolveProvider(undefined)).toBe("openrouter");
    expect(resolveProvider(null)).toBe("openrouter");
    expect(resolveProvider("")).toBe("openrouter");
    expect(resolveProvider("openai")).toBe("openai");
    expect(resolveProvider("ANTHROPIC")).toBe("anthropic");
    expect(resolveProvider("openrouter")).toBe("openrouter");
    expect(determineBillStatus("Signed by President.")).toBe("BECAME_LAW");

    // summarizeBillStandard defaults to OpenRouter router when AI_MODEL is unset
    mockDb.bill.findUnique.mockResolvedValueOnce({
      id: "bill-db-1",
      congress: 119,
      billType: "hr",
      billNumber: 42,
      title: "Water Modernization Act",
      officialTitle: "Water Modernization Act",
      introducedDate: new Date("2026-01-01T00:00:00Z"),
      statusDate: new Date("2026-01-02T00:00:00Z"),
      sourceUrl: null,
      fullText: null,
      fullTextUrl: null,
      summaries: [],
    });
    mockCongress.fetchBillDetails.mockResolvedValueOnce({
      title: "Water Modernization Act",
      latestAction: { text: "Referred to committee", actionDate: "2026-01-03" },
    });
    mockCongress.fetchBillText.mockResolvedValueOnce({
      text: "Full legislative text ".repeat(30),
      url: "https://congress.gov/bill/text",
    });
    mockDb.bill.update.mockResolvedValueOnce({ id: "bill-db-1" });
    mockDb.category.findMany.mockResolvedValueOnce(SAMPLE_CATEGORIES);
    mockDb.summary.create.mockResolvedValueOnce({ id: "summary-1" });

    mockOpenAI.__mockCreate.mockResolvedValueOnce(
      makeCompletionResponse({
        id: "bill-db-1",
        summary: VALID_SUMMARY,
        keyPoints: ["Modernizes local water systems."],
        impactAreas: ["Municipalities"],
        categories: ["infrastructure"],
        confidence: 0.9,
      })
    );

    const stdRes = await summarizeBillStandard({ billId: "bill-db-1" });
    expect(stdRes).toMatchObject({
      status: "success",
      summaryId: "summary-1",
      model: "deepseek/deepseek-v4.1-flash-1017",
    });

    // categorizeBill defaults to OpenRouter cascade
    mockOpenAI.__mockCreate.mockResolvedValueOnce(
      makeCompletionResponse({ categories: ["infrastructure"] })
    );
    const defaultCats = await categorizeBill({
      title: "Clean Water Act",
      summary: VALID_SUMMARY,
      availableCategories: SAMPLE_CATEGORIES,
    });
    expect(defaultCats).toEqual(["infrastructure"]);
    expect(mockAnthropic.__mockMessagesCreate).not.toHaveBeenCalled();

    // categorizeBill retains Anthropic only when AI_MODEL=anthropic
    process.env.AI_MODEL = "anthropic";
    process.env.ANTHROPIC_API_KEY = "test-anthropic-key";
    mockAnthropic.__mockMessagesCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: "healthcare, infrastructure" }],
    });
    const anthroCats = await categorizeBill({
      title: "Health Infrastructure Act",
      summary: VALID_SUMMARY,
      availableCategories: SAMPLE_CATEGORIES,
    });
    expect(anthroCats).toEqual(["healthcare", "infrastructure"]);
    expect(mockAnthropic.__mockMessagesCreate).toHaveBeenCalledTimes(1);
  });

  it("fixes src/lib/llm.ts and summarizer-openrouter.ts model lookup for AI_MODEL=openrouter and initializes keys lazily without throwing", async () => {
    process.env.AI_MODEL = "openrouter";
    delete process.env.OPENROUTER_MODEL;
    delete process.env.OPENROUTER_API_KEYS;

    // Must not resolve OPENROUTER_MODELS["openrouter"] as undefined
    const resolved = resolveOpenRouterModelConfig();
    expect(resolved).toBeDefined();
    expect(resolved.id).toBe("deepseek/deepseek-v4.1-flash-1017");

    // Verify all 3 paid Flash slugs exist in both OPENROUTER_MODELS registries
    const legacyIds = Object.values(LEGACY_LLM_OPENROUTER_MODELS).map((m) => m.id);
    const summarizerIds = Object.values(SUMMARIZER_OPENROUTER_MODELS).map(
      (m) => m.id
    );
    for (const slug of DEFAULT_OPENROUTER_MODELS) {
      expect(legacyIds).toContain(slug);
      expect(summarizerIds).toContain(slug);
    }

    // summarizeAndCategorizeWithKey succeeds with AI_MODEL=openrouter
    mockOpenAI.__mockCreate.mockResolvedValueOnce(
      makeCompletionResponse({
        summary: VALID_SUMMARY,
        keyPoints: [
          "Establishes a competitive municipal water modernization grant program nationwide.",
          "Prioritizes rural and underserved water districts for infrastructure upgrades.",
          "Requires annual federal compliance and water quality reporting standards.",
        ],
        impactAreas: ["Rural municipalities"],
        categories: ["infrastructure"],
        aiModel: "deepseek/deepseek-v4.1-flash-1017",
        confidence: 0.9,
      })
    );

    const legacyResult = await summarizeAndCategorizeWithKey({
      title: "Water Act",
      text: "Water infrastructure legislation text",
      categories: SAMPLE_CATEGORIES.map((c) => ({
        slug: c.slug,
        name: c.name,
        description: c.description ?? undefined,
      })),
      apiKey: "explicit-key",
    });
    expect(legacyResult.summary).toBe(VALID_SUMMARY);
    expect((mockOpenAI.__mockCreate.mock.calls[0][0] as { model: string }).model).toBe(
      "deepseek/deepseek-v4.1-flash-1017"
    );
    const legacyMessages = (
      mockOpenAI.__mockCreate.mock.calls[0][0] as {
        messages: Array<{ content: string }>;
      }
    ).messages;
    expect(legacyMessages[1].content).toContain(
      "2. The 'summary' field must be at least 20 words"
    );

    // generateSummaryOpenRouter works lazily when keys are added post-import
    process.env.OPENROUTER_API_KEYS = "lazy-key-1";
    mockOpenAI.__mockCreate.mockResolvedValueOnce(
      makeCompletionResponse(
        `## Summary\n${VALID_SUMMARY}\n\n## Key Points\n- Point one\n\n## Impact Areas\n- Communities\n\n## Confidence\n0.85`
      )
    );
    const sumOr = await generateSummaryOpenRouter({
      title: "Water Act",
      fullText: "Full bill text",
      summaryType: "STANDARD",
    });
    expect(sumOr.content).toBe(VALID_SUMMARY);
    expect(getAvailableModels().length).toBeGreaterThanOrEqual(3);
  });

  it("supports OPENROUTER_MODELS CSV overrides and imports without throwing when all API keys are absent", async () => {
    delete process.env.OPENROUTER_API_KEYS;
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.GEMINI_API_KEY;

    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require("@/lib/llm");
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require("@/lib/ai/summarizer-openrouter");
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require("@/lib/ai/categorizer");
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require("@/workflows/summarize-bill-standard");
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require("@/lib/llm/router");
    });

    // When OpenRouter has no keys, router falls straight back to Gemini
    mockCallGeminiStructured.mockResolvedValueOnce({
      data: {
        id: "bill-nokeys",
        summary: VALID_SUMMARY,
        keyPoints: ["Fallback point"],
        impactAreas: ["Public utilities"],
        categories: ["infrastructure"],
        confidence: 0.88,
      },
      model: GEMINI_FALLBACK_MODEL,
    });

    const fallbackOutcomes = await summarizeAndCategorizeItems(
      [makeItem("bill-nokeys")],
      SAMPLE_CATEGORIES
    );
    expect(fallbackOutcomes[0]).toMatchObject({
      id: "bill-nokeys",
      ok: true,
      aiModel: "gemini-3.8-flash",
    });
    expect(mockOpenAI.__mockCreate).not.toHaveBeenCalled();

    // Respects OPENROUTER_MODELS CSV override order
    process.env.OPENROUTER_API_KEYS = "or-key-1";
    process.env.OPENROUTER_MODELS = "custom/model-a, custom/model-b";
    mockOpenAI.__mockCreate
      .mockRejectedValueOnce(makeOpenRouterError(429, "Rate limit custom A"))
      .mockResolvedValueOnce(
        makeCompletionResponse({
          id: "bill-csv",
          summary: VALID_SUMMARY,
          keyPoints: ["Uses CSV model override"],
          impactAreas: ["Agencies"],
          categories: ["infrastructure"],
        })
      );

    const csvOutcomes = await summarizeAndCategorizeItems(
      [makeItem("bill-csv")],
      SAMPLE_CATEGORIES
    );
    expect(csvOutcomes[0]).toMatchObject({
      id: "bill-csv",
      ok: true,
      aiModel: "custom/model-b",
    });
    expect(
      mockOpenAI.__mockCreate.mock.calls.map(([p]) => (p as { model: string }).model)
    ).toEqual(["custom/model-a", "custom/model-b"]);

    warnSpy.mockRestore();
  });

  it("configures OpenAI clients with maxRetries: 0 and bounded timeout across router and OpenRouter summarizer", async () => {
    process.env.OPENROUTER_API_KEYS = "or-key-1";
    mockOpenAI.__mockCreate.mockResolvedValueOnce(
      makeCompletionResponse({
        id: "bill-timeout-default",
        summary: VALID_SUMMARY,
        keyPoints: ["Default timeout check"],
        impactAreas: ["Agencies"],
        categories: ["infrastructure"],
      })
    );

    await summarizeAndCategorizeItems(
      [makeItem("bill-timeout-default")],
      SAMPLE_CATEGORIES
    );

    expect(mockOpenAI.default).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: "or-key-1",
        baseURL: "https://openrouter.ai/api/v1",
        maxRetries: 0,
        timeout: 60_000,
      })
    );

    process.env.OPENROUTER_TIMEOUT_MS = "15000";
    mockOpenAI.__mockCreate.mockResolvedValueOnce(
      makeCompletionResponse(
        `## Summary\n${VALID_SUMMARY}\n\n## Key Points\n- Timeout bound check\n\n## Impact Areas\n- Agencies\n\n## Confidence\n0.85`
      )
    );

    await generateSummaryOpenRouter({
      title: "Water Act",
      fullText: "Full bill text",
      summaryType: "STANDARD",
    });

    expect(mockOpenAI.default).toHaveBeenLastCalledWith(
      expect.objectContaining({
        apiKey: "or-key-1",
        baseURL: "https://openrouter.ai/api/v1",
        maxRetries: 0,
        timeout: 15_000,
      })
    );
  });

  it("falls back to guarded Gemini batch mode on multi-item OpenRouter exhaustion, handles omitted items, and propagates FallbackCapReachedError", async () => {
    // Subcase A: 3-item batch short-circuits on 402/401 to a single Gemini batch call
    mockOpenAI.__mockCreate
      .mockRejectedValueOnce(makeOpenRouterError(402, "No credits key 1"))
      .mockRejectedValueOnce(makeOpenRouterError(401, "Invalid key 2"));

    mockCallGeminiStructured.mockResolvedValueOnce({
      data: {
        items: [
          {
            id: "bill-b1",
            summary: VALID_SUMMARY,
            keyPoints: ["Batch Gemini point 1"],
            impactAreas: ["Municipalities"],
            categories: ["infrastructure", "nonexistent-slug"],
            confidence: 0.9,
          },
          {
            id: "bill-b3",
            summary: VALID_SUMMARY,
            keyPoints: ["Batch Gemini point 3"],
            impactAreas: ["Clinics"],
            categories: ["healthcare"],
            confidence: null,
          },
        ],
      },
      model: GEMINI_FALLBACK_MODEL,
    });

    const batchItems = [
      makeItem("bill-b1"),
      makeItem("bill-b2"),
      makeItem("bill-b3"),
    ];
    const outcomes = await summarizeAndCategorizeItems(
      batchItems,
      SAMPLE_CATEGORIES
    );

    expect(mockOpenAI.__mockCreate).toHaveBeenCalledTimes(2);
    expect(mockCallGeminiStructured).toHaveBeenCalledTimes(1);
    expect(mockCallGeminiStructured).toHaveBeenCalledWith(
      expect.objectContaining({
        schema: SummaryAndCategoryBatchSchema,
        itemIds: ["bill-b1", "bill-b2", "bill-b3"],
      })
    );
    expect(outcomes).toEqual([
      {
        id: "bill-b1",
        ok: true,
        summary: VALID_SUMMARY,
        keyPoints: ["Batch Gemini point 1"],
        impactAreas: ["Municipalities"],
        categories: ["infrastructure"],
        confidence: 0.9,
        aiModel: "gemini-3.8-flash",
      },
      {
        id: "bill-b2",
        ok: false,
        error: "Gemini batch response omitted item",
      },
      {
        id: "bill-b3",
        ok: true,
        summary: VALID_SUMMARY,
        keyPoints: ["Batch Gemini point 3"],
        impactAreas: ["Clinics"],
        categories: ["healthcare"],
        confidence: null,
        aiModel: "gemini-3.8-flash",
      },
    ]);

    // Subcase B: Multi-item batch propagates FallbackCapReachedError when Gemini cap is hit
    resetOpenRouterRouterStateForTests();
    mockOpenAI.__mockCreate.mockClear();
    mockCallGeminiStructured.mockClear();
    process.env.OPENROUTER_API_KEYS = "or-key-1";

    mockOpenAI.__mockCreate
      .mockRejectedValueOnce(makeOpenRouterError(429, "Rate limit m1"))
      .mockRejectedValueOnce(makeOpenRouterError(429, "Rate limit m2"))
      .mockRejectedValueOnce(makeOpenRouterError(429, "Rate limit m3"));
    mockCallGeminiStructured.mockRejectedValueOnce(
      new FallbackCapReachedError("Daily cap reached", {
        reason: "daily-cap-reached",
        used: 20,
        limit: 20,
      })
    );

    await expect(
      summarizeAndCategorizeItems(
        [makeItem("bill-cap-1"), makeItem("bill-cap-2")],
        SAMPLE_CATEGORIES
      )
    ).rejects.toBeInstanceOf(FallbackCapReachedError);
    expect(mockOpenAI.__mockCreate).toHaveBeenCalledTimes(3);
    expect(mockCallGeminiStructured).toHaveBeenCalledTimes(1);
  });

  it("falls back to guarded Gemini in categorizeLegislationItem when OpenRouter fails and propagates FallbackCapReachedError", async () => {
    // Subcase A: OpenRouter all keys 402/401 -> Gemini CategorizeOnlySchema succeeds
    mockOpenAI.__mockCreate
      .mockRejectedValueOnce(makeOpenRouterError(402, "No credits 1"))
      .mockRejectedValueOnce(makeOpenRouterError(401, "Bad key 2"));

    mockCallGeminiStructured.mockResolvedValueOnce({
      data: {
        categories: ["healthcare", "invalid-slug", "infrastructure"],
      },
      model: GEMINI_FALLBACK_MODEL,
    });

    const result = await categorizeLegislationItem({
      title: "Rural Hospital & Water Infrastructure Act",
      summary: VALID_SUMMARY,
      categories: SAMPLE_CATEGORIES,
    });

    expect(mockOpenAI.__mockCreate).toHaveBeenCalledTimes(2);
    expect(mockCallGeminiStructured).toHaveBeenCalledTimes(1);
    expect(mockCallGeminiStructured).toHaveBeenCalledWith(
      expect.objectContaining({
        schema: CategorizeOnlySchema,
      })
    );
    expect(result).toEqual({
      categories: ["healthcare", "infrastructure"],
      aiModel: "gemini-3.8-flash",
    });

    // Subcase B: Propagates FallbackCapReachedError when Gemini cap is reached
    resetOpenRouterRouterStateForTests();
    mockOpenAI.__mockCreate.mockClear();
    mockCallGeminiStructured.mockClear();
    process.env.OPENROUTER_API_KEYS = "or-key-1";

    mockOpenAI.__mockCreate.mockRejectedValueOnce(
      makeOpenRouterError(402, "No credits")
    );
    mockCallGeminiStructured.mockRejectedValueOnce(
      new FallbackCapReachedError("Daily cap reached", {
        reason: "daily-cap-reached",
        used: 20,
        limit: 20,
      })
    );

    await expect(
      categorizeLegislationItem({
        title: "Clean Water Act",
        summary: VALID_SUMMARY,
        categories: SAMPLE_CATEGORIES,
      })
    ).rejects.toBeInstanceOf(FallbackCapReachedError);
  });
});
