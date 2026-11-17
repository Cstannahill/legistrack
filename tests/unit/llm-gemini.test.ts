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
  SummaryAndCategoryItemSchema,
  toJsonSchema,
} from "@/lib/llm/types";

jest.mock("@/lib/db", () => ({
  db: {
    jobRun: {
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  },
}));

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

interface MockDb {
  db: {
    jobRun: {
      count: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
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

  it("validates SummaryAndCategoryItemSchema and CategorizeOnlySchema constraints", () => {
    const validItem = SummaryAndCategoryItemSchema.parse({
      id: "bill-123",
      summary: VALID_SUMMARY_20_WORDS,
      keyPoints: ["Modernizes municipal water systems nationwide."],
      impactAreas: ["Local municipalities"],
      categories: ["infrastructure", "environment-climate"],
      confidence: 0.92,
    });
    expect(validItem.id).toBe("bill-123");

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

  it("converts Zod schemas into clean JSON Schema without $schema metadata", () => {
    const jsonSchema = toJsonSchema(CategorizeOnlySchema);

    expect(jsonSchema).not.toHaveProperty("$schema");
    expect(jsonSchema.type).toBe("object");
    expect(jsonSchema.properties).toBeDefined();
  });
});

describe("Gemini fallback quota & direct interactions adapter", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
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

  it("throws FallbackCapReachedError without constructing GoogleGenAI when daily cap is reached", async () => {
    mockDb.jobRun.count.mockResolvedValueOnce(20);

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

    expect(mockGenAi.GoogleGenAI).not.toHaveBeenCalled();
    expect(mockGenAi.__mockCreate).not.toHaveBeenCalled();
    expect(mockDb.jobRun.create).not.toHaveBeenCalled();
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

  it("creates JobRun RUNNING, calls interactions.create with store: false and response_format, validates output_text, and marks COMPLETED", async () => {
    mockDb.jobRun.count.mockResolvedValueOnce(3);
    mockDb.jobRun.create.mockResolvedValueOnce({ id: "job-run-42" });
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

    expect(mockDb.jobRun.create).toHaveBeenCalledWith({
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
    mockDb.jobRun.count.mockResolvedValueOnce(1);
    mockDb.jobRun.create.mockResolvedValueOnce({ id: "job-run-99" });
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

  it("marks JobRun FAILED and rethrows when interactions.create rejects", async () => {
    mockDb.jobRun.count.mockResolvedValueOnce(2);
    mockDb.jobRun.create.mockResolvedValueOnce({ id: "job-run-100" });
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
});
