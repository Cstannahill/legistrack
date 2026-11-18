# Legislation summarization model eval

The eval compares the production summary prompt across candidate models, judges each output against the source text and required factual criteria, and recommends the cheapest model that passes consistently.

```bash
npm run eval:legislation
```

It evaluates the configured `OPENROUTER_MODELS` cascade, then `openai/gpt-6-luna-pro`, `anthropic/claude-haiku-5.5`, `minimax/minimax-m3.1-flash`, and direct Gemini `gemini-3.8-flash`. The fixed judge is `openai/gpt-6-luna-pro`. Each model is tested on the same legislation and prompt, with three runs per case by default; model calls for a case are issued in parallel. The candidate prompt and output schema are shared with the production router. Eval calls do not persist summaries or consume the production Gemini fallback's daily quota.

Requirements:

- An OpenRouter key with access to the candidates and the fixed judge.
- `GEMINI_API_KEY` for the default Gemini candidate.

Choose a subset, custom candidate set, more repetitions, or another fixture:

```bash
npm run eval:legislation -- --models=deepseek/deepseek-v4.1-flash-1017,openai/gpt-6-luna-pro,gemini-3.8-flash
npm run eval:legislation -- --runs=5
npm run eval:legislation -- --fixture=scripts/fixtures/legislation-eval.json
```

The checked-in fixture contains one real procedural House resolution and one synthetic bill designed to catch errors in thresholds, dates, exceptions, and legal effects. For each run, the fixed judge sees the source text, candidate summary, key points, and explicit required facts, and returns a 1–5 score, per-fact status, and material-error list. A run passes with a score of at least 4, no incorrect required facts, every critical fact accurate, and no material errors. The recommendation only considers models that pass every case in every run and have complete cost data, then chooses the lowest mean generation cost per case. Three runs on two cases is a smoke eval, not enough evidence for a production decision; add reviewed, representative legislation to the fixture and increase repetitions before switching.

OpenRouter candidate costs use provider-reported response usage. Gemini cost is estimated from token counts at the configured `GEMINI_EVAL_INPUT_PRICE_PER_MILLION` / `GEMINI_EVAL_OUTPUT_PRICE_PER_MILLION` rates (defaults: $0.75/$3.75 per million input/output tokens through 2026, then $1.50/$7.50 from 2027). Update rates when pricing changes. Judge calls use `openai/gpt-6-luna-pro` and are the same across candidates; the table compares generation cost only. Candidate latency excludes judge latency.

This remains a model-graded eval: the judge can make mistakes. Inspect per-fact notes, material errors, summaries, token/cost data, and provider/model identity in the timestamped JSON output under `.eval-results/` before acting on the recommendation. OpenRouter may route the same model slug to different providers across calls; inspect returned model/provider metadata and consider pinning a provider for strict repeatability. A missing Gemini key or inaccessible candidate is recorded as a failed run, not silently skipped.
