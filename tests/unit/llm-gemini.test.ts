import { z } from "zod";
import { getOpenRouterKeys } from "@/lib/openrouter-keys";
import {
  callGeminiStructured,
  getRemainingGeminiFallbackQuota,
} from "@/lib/llm/gemini";
import {
  CategorizeOnlySchema,
  DEFAULT_OPENROUTER_MODELS,
  FallbackCapReachedError,
  GEMINI_FALLBACK_MODEL,
  SummaryAndCategoryBatchSchema,
  SummaryAndCategoryItemSchema,
  toJsonSchema,
} from "@/lib/llm/types";

jest.mock("@/lib/db", () => {
  const tx = {
    $executeRaw: jest.fn(),
    jobRun: {
      count: jest.fn(),
      create: jest.fn(),
    },
  };
  return {
    db: {
      $transaction: jest.fn(
        async (cb: (client: typeof tx) => Promise<unknown>) => cb(tx)
      ),
      jobRun: {
        count: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      __tx: tx,
    },
  };
});

jest.mock("@google/genai", () => {
  const create = jest.fn();
  const GoogleGenAI = jest.fn().mockImplementation(() => ({
    interactions: { create },
  }));
  return {
    GoogleGenAI,
    __mockCreate: create,
  };
});

interface MockTx {
  $executeRaw: jest.Mock;
  jobRun: {
    count: jest.Mock;
    create: jest.Mock;
  };
}

interface MockDb {
  db: {
    $transaction: jest.Mock;
    jobRun: {
      count: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    __tx: MockTx;
  };
}

interface MockGenAiModule {
  GoogleGenAI: jest.Mock;
  __mockCreate: jest.Mock;
}

const { db: mockDb } = jest.requireMock("@/lib/db") as MockDb;
const mockGenAi = jest.requireMock("@google/genai") as MockGenAiModule;

const VALID_SUMMARY_20_WORDS =
  "This bipartisan legislation establishes new federal grant programs and technical assistance funds to modernize community water infrastructure across rural and underserved municipalities nationwide.";

describe("getOpenRouterKeys", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.OPENROUTER_API_KEYS;
    for (let i = 1; i <= 10; i++) {
      delete process.env[`OPENROUTER_API_KEY_${i}`];
      delete process.env[`OPENROUTER_KEY_${i}`];
    }
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("merges and deduplicates OPENROUTER_API_KEYS, OPENROUTER_API_KEY_1..10, and OPENROUTER_KEY_1..10 in order", () => {
    const keys = getOpenRouterKeys({
      OPENROUTER_API_KEYS: " key-a , key-b , key-a ",
      OPENROUTER_API_KEY_1: "key-b",
      OPENROUTER_API_KEY_2: " key-c ",
      OPENROUTER_API_KEY_10: "key-d",
      OPENROUTER_KEY_1: "key-c",
      OPENROUTER_KEY_3: "key-e",
      OPENROUTER_KEY_10: "key-f",
    });

    expect(keys).toEqual([
      "key-a",
      "key-b",
      "key-c",
      "key-d",
      "key-e",
      "key-f",
    ]);
  });

  it("returns [] with a warning and does not throw when no keys are set", () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

    const keys = getOpenRouterKeys({});

    expect(keys).toEqual([]);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });

  it("defaults to process.env for backward compatibility when called without arguments", () => {
    process.env.OPENROUTER_KEY_2 = "env-key-2";

    expect(getOpenRouterKeys()).toEqual(["env-key-2"]);
  });
});

describe("LLM shared types and Zod schemas", () => {
  it("exports expected OpenRouter cascade and Gemini fallback model constants", () => {
    expect(DEFAULT_OPENROUTER_MODELS).toEqual([
      "deepseek/deepseek-v4.1-flash-1017",
      "xiaomi/mimo-v2.6-flash",
      "z-ai/glm-5.3-flash",
    ]);
    expect(GEMINI_FALLBACK_MODEL).toBe("gemini-3.8-flash");
  });

  it("validates SummaryAndCategoryItemSchema (including nullable/omitted confidence) and CategorizeOnlySchema constraints", () => {
    const validItem = SummaryAndCategoryItemSchema.parse({
      id: "bill-123",
      summary: VALID_SUMMARY_20_WORDS,
      keyPoints: ["Modernizes municipal water systems nationwide."],
      impactAreas: ["Local municipalities"],
      categories: ["infrastructure", "environment-climate"],
      confidence: 0.92,
    });
    expect(validItem.id).toBe("bill-123");

    const nullableConfidenceItem = SummaryAndCategoryItemSchema.parse({
      id: "bill-124",
      summary: VALID_SUMMARY_20_WORDS,
      keyPoints: [],
      impactAreas: [],
      categories: [],
      confidence: null,
    });
    expect(nullableConfidenceItem.confidence).toBeNull();

    expect(() =>
      SummaryAndCategoryItemSchema.parse({
        id: "bill-123",
        summary: "Too short.",
        keyPoints: [],
        impactAreas: [],
        categories: ["infrastructure"],
      })
    ).toThrow();

    expect(() =>
      CategorizeOnlySchema.parse({
        categories: ["a", "b", "c", "d"],
      })
    ).toThrow();
  });

  it("converts Zod schemas into strict JSON Schema with every property required and no $schema or default keywords", () => {
    const itemSchema = toJsonSchema(SummaryAndCategoryItemSchema);
    const batchSchema = toJsonSchema(SummaryAndCategoryBatchSchema);
    const catSchema = toJsonSchema(CategorizeOnlySchema);

    expect(itemSchema).not.toHaveProperty("$schema");
    expect(itemSchema.additionalProperties).toBe(false);
    expect(itemSchema.required).toEqual(
      Object.keys(itemSchema.properties as Record<string, unknown>)
    );
    expect(itemSchema.required).toContain("confidence");

    const batchItemSchema = (
      (batchSchema.properties as Record<string, { items: Record<string, unknown> }>)
        .items.items
    );
    expect(batchSchema).not.toHaveProperty("$schema");
    expect(batchSchema.additionalProperties).toBe(false);
    expect(batchSchema.required).toEqual(["items"]);
    expect(batchItemSchema.additionalProperties).toBe(false);
    expect(batchItemSchema.required).toEqual(
      Object.keys(batchItemSchema.properties as Record<string, unknown>)
    );
    expect(batchItemSchema.required).toContain("confidence");

    expect(catSchema).not.toHaveProperty("$schema");
    expect(catSchema.additionalProperties).toBe(false);
    expect(catSchema.required).toEqual(["categories"]);

    for (const serialized of [
      JSON.stringify(itemSchema),
      JSON.stringify(batchSchema),
      JSON.stringify(catSchema),
    ]) {
      expect(serialized).not.toContain('"$schema"');
      expect(serialized).not.toContain('"default"');
    }
  });
});

describe("Gemini fallback quota & direct interactions adapter", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    mockDb.$transaction.mockImplementation(
      async (cb: (client: MockTx) => Promise<unknown>) => cb(mockDb.__tx)
    );
    process.env = {
      ...originalEnv,
      GEMINI_API_KEY: "test-gemini-key",
      GEMINI_FALLBACK_ENABLED: "true",
      GEMINI_FALLBACK_DAILY_LIMIT: "20",
    };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("counts db.jobRun from 00:00:00Z today and reports remaining quota", async () => {
    mockDb.jobRun.count.mockResolvedValueOnce(7);

    const quota = await getRemainingGeminiFallbackQuota();

    expect(quota).toEqual({ used: 7, limit: 20, remaining: 13 });
    expect(mockDb.jobRun.count).toHaveBeenCalledTimes(1);
    const countArgs = mockDb.jobRun.count.mock.calls[0][0] as {
      where: { jobName: string; startedAt: { gte: Date } };
    };
    expect(countArgs.where.jobName).toBe("llm-fallback:gemini-3.8-flash");
    expect(countArgs.where.startedAt.gte.getUTCHours()).toBe(0);
    expect(countArgs.where.startedAt.gte.getUTCMinutes()).toBe(0);
    expect(countArgs.where.startedAt.gte.getUTCSeconds()).toBe(0);
    expect(countArgs.where.startedAt.gte.getUTCMilliseconds()).toBe(0);
  });

  it("respects GEMINI_FALLBACK_DAILY_LIMIT=0 without falling back to default 20", async () => {
    process.env.GEMINI_FALLBACK_DAILY_LIMIT = "0";
    mockDb.jobRun.count.mockResolvedValueOnce(0);

    const quota = await getRemainingGeminiFallbackQuota();

    expect(quota).toEqual({ used: 0, limit: 0, remaining: 0 });
  });

  it("throws FallbackCapReachedError without constructing GoogleGenAI when daily cap is reached inside locked transaction", async () => {
    mockDb.__tx.$executeRaw.mockResolvedValueOnce(1);
    mockDb.__tx.jobRun.count.mockResolvedValueOnce(20);

    const TestSchema = z.object({ categories: z.array(z.string()).max(3) });

    await expect(
      callGeminiStructured({
        systemInstruction: "Categorize legislation.",
        prompt: "Test prompt",
        schema: TestSchema,
        jsonSchema: toJsonSchema(TestSchema),
        itemIds: ["bill-1"],
      })
    ).rejects.toBeInstanceOf(FallbackCapReachedError);

    expect(mockDb.$transaction).toHaveBeenCalledTimes(1);
    expect(mockDb.__tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(mockDb.__tx.jobRun.count).toHaveBeenCalledTimes(1);
    expect(mockDb.__tx.jobRun.create).not.toHaveBeenCalled();
    expect(mockGenAi.GoogleGenAI).not.toHaveBeenCalled();
    expect(mockGenAi.__mockCreate).not.toHaveBeenCalled();
  });

  it("serializes concurrent quota checks via advisory-locked transaction so cap is never overshot", async () => {
    process.env.GEMINI_FALLBACK_DAILY_LIMIT = "1";

    let persistedCount = 0;
    let txQueue = Promise.resolve();

    mockDb.$transaction.mockImplementation(
      (cb: (client: MockTx) => Promise<unknown>) => {
        const next = txQueue.then(async () => {
          const txClient: MockTx = {
            $executeRaw: jest.fn().mockResolvedValue(1),
            jobRun: {
              count: jest.fn(async () => persistedCount),
              create: jest.fn(async () => {
                persistedCount += 1;
                return { id: `job-run-${persistedCount}` };
              }),
            },
          };
          return cb(txClient);
        });
        txQueue = next.then(
          () => undefined,
          () => undefined
        );
        return next;
      }
    );

    mockDb.jobRun.update.mockResolvedValue({ id: "job-run-1" });
    mockGenAi.__mockCreate.mockResolvedValue({
      id: "interaction-concurrent",
      status: "completed",
      output_text: JSON.stringify({ categories: ["healthcare"] }),
    });

    const req = {
      systemInstruction: "Categorize.",
      prompt: "Prompt",
      schema: CategorizeOnlySchema,
      jsonSchema: toJsonSchema(CategorizeOnlySchema),
      itemIds: ["bill-concurrent"],
    };

    const [first, second] = await Promise.allSettled([
      callGeminiStructured(req),
      callGeminiStructured(req),
    ]);

    expect(first.status).toBe("fulfilled");
    expect(second.status).toBe("rejected");
    if (second.status === "rejected") {
      expect(second.reason).toBeInstanceOf(FallbackCapReachedError);
    }
    expect(persistedCount).toBe(1);
    expect(mockGenAi.__mockCreate).toHaveBeenCalledTimes(1);
  });

  it("throws FallbackCapReachedError without calling Gemini when GEMINI_FALLBACK_ENABLED is false", async () => {
    process.env.GEMINI_FALLBACK_ENABLED = "false";

    await expect(
      callGeminiStructured({
        systemInstruction: "Categorize legislation.",
        prompt: "Test prompt",
        schema: CategorizeOnlySchema,
        jsonSchema: toJsonSchema(CategorizeOnlySchema),
        itemIds: ["bill-1"],
      })
    ).rejects.toBeInstanceOf(FallbackCapReachedError);

    expect(mockGenAi.GoogleGenAI).not.toHaveBeenCalled();
    expect(mockGenAi.__mockCreate).not.toHaveBeenCalled();
  });

  it("throws FallbackCapReachedError without calling Gemini when GEMINI_API_KEY is missing", async () => {
    delete process.env.GEMINI_API_KEY;

    await expect(
      callGeminiStructured({
        systemInstruction: "Categorize legislation.",
        prompt: "Test prompt",
        schema: CategorizeOnlySchema,
        jsonSchema: toJsonSchema(CategorizeOnlySchema),
        itemIds: ["bill-1"],
      })
    ).rejects.toBeInstanceOf(FallbackCapReachedError);

    expect(mockGenAi.GoogleGenAI).not.toHaveBeenCalled();
    expect(mockGenAi.__mockCreate).not.toHaveBeenCalled();
  });

  it("acquires advisory lock, creates JobRun RUNNING inside $transaction, calls interactions.create with store: false and response_format, validates output_text, and marks COMPLETED", async () => {
    mockDb.__tx.$executeRaw.mockResolvedValueOnce(1);
    mockDb.__tx.jobRun.count.mockResolvedValueOnce(3);
    mockDb.__tx.jobRun.create.mockResolvedValueOnce({ id: "job-run-42" });
    mockDb.jobRun.update.mockResolvedValueOnce({ id: "job-run-42" });

    const payload = {
      id: "bill-99",
      summary: VALID_SUMMARY_20_WORDS,
      keyPoints: ["Provides federal grants to modernize municipal water systems."],
      impactAreas: ["Municipal water utilities"],
      categories: ["infrastructure"],
      confidence: 0.9,
    };

    mockGenAi.__mockCreate.mockResolvedValueOnce({
      id: "interaction-1",
      status: "completed",
      output_text: JSON.stringify(payload),
    });

    const jsonSchema = toJsonSchema(SummaryAndCategoryItemSchema);
    const result = await callGeminiStructured({
      systemInstruction: "You are a legislative analyst.",
      prompt: "Summarize bill-99.",
      schema: SummaryAndCategoryItemSchema,
      jsonSchema,
      itemIds: ["bill-99"],
    });

    expect(result).toEqual({
      data: payload,
      model: "gemini-3.8-flash",
    });

    expect(mockDb.$transaction).toHaveBeenCalledTimes(1);
    expect(mockDb.__tx.$executeRaw).toHaveBeenCalledTimes(1);
    const lockCallText = (
      mockDb.__tx.$executeRaw.mock.calls[0][0] as TemplateStringsArray
    ).join("");
    expect(lockCallText).toContain("pg_advisory_xact_lock(948271)");

    const lockOrder = mockDb.__tx.$executeRaw.mock.invocationCallOrder[0];
    const countOrder = mockDb.__tx.jobRun.count.mock.invocationCallOrder[0];
    const createOrder = mockDb.__tx.jobRun.create.mock.invocationCallOrder[0];
    expect(lockOrder).toBeLessThan(countOrder);
    expect(countOrder).toBeLessThan(createOrder);

    expect(mockDb.__tx.jobRun.create).toHaveBeenCalledWith({
      data: {
        jobName: "llm-fallback:gemini-3.8-flash",
        status: "RUNNING",
        metadata: {
          model: "gemini-3.8-flash",
          itemIds: ["bill-99"],
        },
      },
    });

    expect(mockGenAi.GoogleGenAI).toHaveBeenCalledWith({
      apiKey: "test-gemini-key",
      httpOptions: { timeout: 60_000 },
    });

    expect(mockGenAi.__mockCreate).toHaveBeenCalledWith({
      model: "gemini-3.8-flash",
      store: false,
      system_instruction: "You are a legislative analyst.",
      input: "Summarize bill-99.",
      response_format: {
        type: "text",
        mime_type: "application/json",
        schema: jsonSchema,
      },
    });

    expect(mockDb.jobRun.update).toHaveBeenCalledWith({
      where: { id: "job-run-42" },
      data: expect.objectContaining({
        status: "COMPLETED",
        itemsProcessed: 1,
        completedAt: expect.any(Date),
      }),
    });
  });

  it("marks JobRun FAILED and rethrows when Gemini output fails Zod validation or API errors", async () => {
    mockDb.__tx.$executeRaw.mockResolvedValueOnce(1);
    mockDb.__tx.jobRun.count.mockResolvedValueOnce(1);
    mockDb.__tx.jobRun.create.mockResolvedValueOnce({ id: "job-run-99" });
    mockDb.jobRun.update.mockResolvedValueOnce({ id: "job-run-99" });

    mockGenAi.__mockCreate.mockResolvedValueOnce({
      id: "interaction-2",
      status: "completed",
      output_text: JSON.stringify({ categories: ["a", "b", "c", "d"] }),
    });

    await expect(
      callGeminiStructured({
        systemInstruction: "Categorize.",
        prompt: "Prompt",
        schema: CategorizeOnlySchema,
        jsonSchema: toJsonSchema(CategorizeOnlySchema),
        itemIds: ["bill-77"],
      })
    ).rejects.toThrow();

    expect(mockDb.jobRun.update).toHaveBeenCalledWith({
      where: { id: "job-run-99" },
      data: expect.objectContaining({
        status: "FAILED",
        itemsFailed: 1,
        completedAt: expect.any(Date),
        error: expect.any(String),
      }),
    });
  });

  it("rejects any non-completed interaction status (e.g., incomplete or requires_continuation) and marks JobRun FAILED", async () => {
    for (const status of [
      "incomplete",
      "requires_continuation",
      "in_progress",
      "requires_action",
      "queued",
    ]) {
      mockDb.__tx.$executeRaw.mockResolvedValueOnce(1);
      mockDb.__tx.jobRun.count.mockResolvedValueOnce(2);
      mockDb.__tx.jobRun.create.mockResolvedValueOnce({
        id: `job-run-${status}`,
      });
      mockDb.jobRun.update.mockResolvedValueOnce({
        id: `job-run-${status}`,
      });

      mockGenAi.__mockCreate.mockResolvedValueOnce({
        id: `interaction-${status}`,
        status,
        output_text: JSON.stringify({ categories: ["healthcare"] }),
      });

      await expect(
        callGeminiStructured({
          systemInstruction: "Categorize.",
          prompt: "Prompt",
          schema: CategorizeOnlySchema,
          jsonSchema: toJsonSchema(CategorizeOnlySchema),
          itemIds: ["bill-status"],
        })
      ).rejects.toThrow(`Gemini interaction ended with status "${status}"`);

      expect(mockDb.jobRun.update).toHaveBeenLastCalledWith({
        where: { id: `job-run-${status}` },
        data: expect.objectContaining({
          status: "FAILED",
          itemsFailed: 1,
          completedAt: expect.any(Date),
          error: `Gemini interaction ended with status "${status}"`,
        }),
      });
    }
  });

  it("marks JobRun FAILED and rethrows when interactions.create rejects", async () => {
    mockDb.__tx.$executeRaw.mockResolvedValueOnce(1);
    mockDb.__tx.jobRun.count.mockResolvedValueOnce(2);
    mockDb.__tx.jobRun.create.mockResolvedValueOnce({ id: "job-run-100" });
    mockDb.jobRun.update.mockResolvedValueOnce({ id: "job-run-100" });

    mockGenAi.__mockCreate.mockRejectedValueOnce(
      new Error("Gemini 503 unavailable")
    );

    await expect(
      callGeminiStructured({
        systemInstruction: "Categorize.",
        prompt: "Prompt",
        schema: CategorizeOnlySchema,
        jsonSchema: toJsonSchema(CategorizeOnlySchema),
        itemIds: ["bill-88"],
      })
    ).rejects.toThrow("Gemini 503 unavailable");

    expect(mockDb.jobRun.update).toHaveBeenCalledWith({
      where: { id: "job-run-100" },
      data: expect.objectContaining({
        status: "FAILED",
        itemsFailed: 1,
        completedAt: expect.any(Date),
        error: "Gemini 503 unavailable",
      }),
    });
  });

  it("configures GoogleGenAI httpOptions.timeout from GEMINI_TIMEOUT_MS and falls back to 60000ms on invalid/non-positive values", async () => {
    for (const [envValue, expectedTimeout] of [
      ["45000", 45_000],
      ["0", 60_000],
      ["-500", 60_000],
      ["not-a-number", 60_000],
    ] as const) {
      mockGenAi.GoogleGenAI.mockClear();
      process.env.GEMINI_TIMEOUT_MS = envValue;
      mockDb.__tx.$executeRaw.mockResolvedValueOnce(1);
      mockDb.__tx.jobRun.count.mockResolvedValueOnce(0);
      mockDb.__tx.jobRun.create.mockResolvedValueOnce({ id: `job-run-to-${envValue}` });
      mockDb.jobRun.update.mockResolvedValueOnce({ id: `job-run-to-${envValue}` });
      mockGenAi.__mockCreate.mockResolvedValueOnce({
        id: `interaction-to-${envValue}`,
        status: "completed",
        output_text: JSON.stringify({ categories: ["healthcare"] }),
      });

      await callGeminiStructured({
        systemInstruction: "Categorize.",
        prompt: "Prompt",
        schema: CategorizeOnlySchema,
        jsonSchema: toJsonSchema(CategorizeOnlySchema),
        itemIds: ["bill-timeout"],
      });

      expect(mockGenAi.GoogleGenAI).toHaveBeenCalledWith({
        apiKey: "test-gemini-key",
        httpOptions: { timeout: expectedTimeout },
      });
    }
  });
});
