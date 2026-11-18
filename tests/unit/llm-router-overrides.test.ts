import {
  categorizeLegislationItem,
  resetOpenRouterRouterStateForTests,
  summarizeAndCategorizeItems,
} from "@/lib/llm/router";
import { callGeminiStructured } from "@/lib/llm/gemini";
import {
  AllOpenRouterKeysExhaustedError,
  GEMINI_FALLBACK_MODEL,
  OPENROUTER_MODEL_ALIASES,
  type LlmCategoryInput,
  type LlmLegislationInput,
} from "@/lib/llm/types";

jest.mock("openai", () => {
  const create = jest.fn();
  const OpenAI = jest.fn().mockImplementation((config?: { apiKey?: string }) => ({
    chat: {
      completions: {
        create: (params: unknown, options?: unknown) =>
          create(params, options, config?.apiKey),
      },
    },
  }));
  return {
    __esModule: true,
    default: OpenAI,
    __mockCreate: create,
  };
});

jest.mock("@/lib/llm/gemini", () => ({
  callGeminiStructured: jest.fn(),
}));

const openaiModule = jest.requireMock("openai") as {
  __mockCreate: jest.Mock;
};
const mockOpenRouterCreate = openaiModule.__mockCreate;
const mockCallGemini = callGeminiStructured as jest.Mock;

const CATEGORIES: LlmCategoryInput[] = [
  { slug: "economy-taxes", name: "Economy & Taxes" },
  { slug: "technology", name: "Technology & Innovation" },
];

const SAMPLE_BILL: LlmLegislationInput = {
  id: "bill-1",
  title: "Sample Tax Modernization Act",
  text: "Section 1. This bill updates federal taxpayer notification rules and provides forty five days of advance written notice before third-party disclosures.",
  kind: "bill",
};

const VALID_SUMMARY_JSON = JSON.stringify({
  id: "bill-1",
  summary:
    "This bill modernizes federal taxpayer notification procedures by requiring written notice at least forty five days before seeking records from third parties.",
  keyPoints: ["Requires 45-day notice", "Preserves tax collection exceptions"],
  impactAreas: ["Taxpayers", "IRS"],
  categories: ["economy-taxes"],
  confidence: 0.92,
});

describe("LLM router explicit model targeting overrides", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    resetOpenRouterRouterStateForTests();
    process.env = {
      ...originalEnv,
      OPENROUTER_API_KEYS: "or-key-1",
      GEMINI_API_KEY: "gem-key-1",
    };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("routes directly to Gemini 3.8 Flash when provider='gemini' without touching OpenRouter", async () => {
    mockCallGemini.mockResolvedValueOnce({
      data: {
        id: "bill-1",
        summary:
          "This bill establishes clear notification rules requiring forty five days of advance written notice prior to third party IRS requests.",
        keyPoints: ["45-day notice"],
        impactAreas: ["Taxpayers"],
        categories: ["economy-taxes"],
        confidence: 0.95,
      },
      model: GEMINI_FALLBACK_MODEL,
    });

    const outcomes = await summarizeAndCategorizeItems([SAMPLE_BILL], CATEGORIES, {
      provider: "gemini",
    });

    expect(mockOpenRouterCreate).not.toHaveBeenCalled();
    expect(mockCallGemini).toHaveBeenCalledTimes(1);
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toMatchObject({
      id: "bill-1",
      ok: true,
      aiModel: GEMINI_FALLBACK_MODEL,
      categories: ["economy-taxes"],
    });
  });

  it("pins a single OpenRouter model (e.g. glm) and skips Gemini fallback when allowGeminiFallback=false", async () => {
    mockOpenRouterCreate.mockResolvedValueOnce({
      choices: [{ message: { content: VALID_SUMMARY_JSON } }],
    });

    const success = await summarizeAndCategorizeItems([SAMPLE_BILL], CATEGORIES, {
      provider: "openrouter",
      openRouterModels: [OPENROUTER_MODEL_ALIASES.glm],
      allowGeminiFallback: false,
    });

    expect(mockOpenRouterCreate).toHaveBeenCalledTimes(1);
    expect(mockOpenRouterCreate.mock.calls[0][0]).toMatchObject({
      model: OPENROUTER_MODEL_ALIASES.glm,
    });
    expect(success[0]).toMatchObject({
      ok: true,
      aiModel: OPENROUTER_MODEL_ALIASES.glm,
    });

    mockOpenRouterCreate.mockRejectedValueOnce(
      Object.assign(new Error("Rate limited"), { status: 429 })
    );

    const failure = await summarizeAndCategorizeItems([SAMPLE_BILL], CATEGORIES, {
      provider: "openrouter",
      openRouterModels: [OPENROUTER_MODEL_ALIASES.mimo],
      allowGeminiFallback: false,
    });

    expect(mockCallGemini).not.toHaveBeenCalled();
    expect(failure[0]).toMatchObject({
      id: "bill-1",
      ok: false,
    });
  });

  it("respects provider overrides in categorizeLegislationItem", async () => {
    mockCallGemini.mockResolvedValueOnce({
      data: { categories: ["technology"] },
      model: GEMINI_FALLBACK_MODEL,
    });

    const geminiCat = await categorizeLegislationItem(
      {
        title: "AI Act",
        summary: "Requires federal AI safety standards.",
        categories: CATEGORIES,
      },
      { provider: "gemini" }
    );

    expect(mockOpenRouterCreate).not.toHaveBeenCalled();
    expect(geminiCat).toEqual({
      categories: ["technology"],
      aiModel: GEMINI_FALLBACK_MODEL,
    });

    mockOpenRouterCreate.mockRejectedValueOnce(
      Object.assign(new Error("429"), { status: 429 })
    );

    await expect(
      categorizeLegislationItem(
        {
          title: "AI Act",
          summary: "Requires federal AI safety standards.",
          categories: CATEGORIES,
        },
        {
          provider: "openrouter",
          openRouterModels: [OPENROUTER_MODEL_ALIASES.deepseek],
          allowGeminiFallback: false,
        }
      )
    ).rejects.toBeInstanceOf(AllOpenRouterKeysExhaustedError);
  });
});
