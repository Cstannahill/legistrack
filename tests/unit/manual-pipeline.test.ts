import {
  getBooleanFlag,
  getCsvFlag,
  getNonNegativeIntFlag,
  getPositiveIntFlag,
  getStringFlag,
  parseBillIdentifier,
  parseCliFlags,
  resolveManualModelTarget,
} from "../../scripts/lib/manual-cli-args";
import {
  DEFAULT_OPENROUTER_MODELS,
  GEMINI_FALLBACK_MODEL,
  OPENROUTER_MODEL_ALIASES,
} from "@/lib/llm/types";

describe("manual pipeline CLI parsing & model targeting", () => {
  it("parses --key=value, --key value, boolean flags, and positionals", () => {
    const parsed = parseCliFlags([
      "--model=deepseek",
      "--bills",
      "10",
      "--dry-run",
      "--types=hr, S",
      "extra",
    ]);

    expect(getStringFlag(parsed.flags, "model")).toBe("deepseek");
    expect(getPositiveIntFlag(parsed.flags, "bills")).toBe(10);
    expect(getBooleanFlag(parsed.flags, "dry-run")).toBe(true);
    expect(getCsvFlag(parsed.flags, "types")).toEqual(["hr", "s"]);
    expect(parsed.positionals).toEqual(["extra"]);
  });

  it("rejects non-integer flag values cleanly", () => {
    const parsed = parseCliFlags(["--bills=3abc", "--eos=-1"]);
    expect(() => getPositiveIntFlag(parsed.flags, "bills")).toThrow(
      /--bills must be a positive integer/
    );
    expect(() => getNonNegativeIntFlag(parsed.flags, "eos")).toThrow(
      /--eos must be a non-negative integer/
    );
  });

  it("parses bill identifiers across common formats", () => {
    expect(parseBillIdentifier("HR 4398", 119)).toEqual({
      congress: 119,
      type: "hr",
      number: "4398",
    });
    expect(parseBillIdentifier("118-S-2309", 119)).toEqual({
      congress: 118,
      type: "s",
      number: "2309",
    });
    expect(parseBillIdentifier("H.R. 5374", 119)).toEqual({
      congress: 119,
      type: "hr",
      number: "5374",
    });
    expect(() => parseBillIdentifier("invalid-bill", 119)).toThrow(
      /Invalid bill identifier/
    );
  });

  it("resolves deepseek, mimo, glm, gemini, and cascade model aliases", () => {
    const deepseek = resolveManualModelTarget("deepseek");
    expect(deepseek.usesOpenRouter).toBe(true);
    expect(deepseek.usesGemini).toBe(false);
    expect(deepseek.llmOptions).toEqual({
      provider: "openrouter",
      openRouterModels: [OPENROUTER_MODEL_ALIASES.deepseek],
      allowGeminiFallback: false,
    });

    const mimo = resolveManualModelTarget("mimo");
    expect(mimo.llmOptions).toEqual({
      provider: "openrouter",
      openRouterModels: [OPENROUTER_MODEL_ALIASES.mimo],
      allowGeminiFallback: false,
    });

    const glm = resolveManualModelTarget("glm");
    expect(glm.llmOptions).toEqual({
      provider: "openrouter",
      openRouterModels: [OPENROUTER_MODEL_ALIASES.glm],
      allowGeminiFallback: false,
    });

    const gemini = resolveManualModelTarget("gemini");
    expect(gemini.usesOpenRouter).toBe(false);
    expect(gemini.usesGemini).toBe(true);
    expect(gemini.label).toContain(GEMINI_FALLBACK_MODEL);
    expect(gemini.llmOptions).toEqual({
      provider: "gemini",
    });

    const deepseekWithFallback = resolveManualModelTarget("deepseek", {
      allowFallback: true,
    });
    expect(deepseekWithFallback.usesGemini).toBe(true);
    expect(deepseekWithFallback.llmOptions).toEqual({
      provider: "auto",
      openRouterModels: [...DEFAULT_OPENROUTER_MODELS],
      allowGeminiFallback: true,
    });

    const cascade = resolveManualModelTarget("cascade");
    expect(cascade.llmOptions).toBeUndefined();
  });

  it("rejects unknown model names with an actionable message", () => {
    expect(() => resolveManualModelTarget("nonexistent")).toThrow(
      /Supported models: deepseek, gemini, glm, mimo, cascade/
    );
  });
});
