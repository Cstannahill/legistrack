import { passesEvalQualityGate } from "@/lib/llm/eval-quality-gate";

const requiredFacts = [
  { id: "critical", critical: true },
  { id: "optional", critical: false },
];

const fullyAccurateJudgment = {
  score: 4,
  facts: [
    { id: "critical", status: "accurate" as const },
    { id: "optional", status: "accurate" as const },
  ],
  materialErrors: [],
};

describe("passesEvalQualityGate", () => {
  it("requires valid summary output", () => {
    expect(
      passesEvalQualityGate(fullyAccurateJudgment, requiredFacts, false)
    ).toBe(false);
  });

  it("requires judge score of at least four", () => {
    expect(
      passesEvalQualityGate(
        { ...fullyAccurateJudgment, score: 3 },
        requiredFacts,
        true
      )
    ).toBe(false);
  });

  it("requires every critical fact to be accurate", () => {
    expect(
      passesEvalQualityGate(
        {
          ...fullyAccurateJudgment,
          facts: [
            { id: "critical", status: "omitted" },
            { id: "optional", status: "accurate" },
          ],
        },
        requiredFacts,
        true
      )
    ).toBe(false);
  });

  it("rejects an incorrect required fact", () => {
    expect(
      passesEvalQualityGate(
        {
          ...fullyAccurateJudgment,
          facts: [
            { id: "critical", status: "accurate" },
            { id: "optional", status: "incorrect" },
          ],
        },
        requiredFacts,
        true
      )
    ).toBe(false);
  });

  it("rejects material errors", () => {
    expect(
      passesEvalQualityGate(
        { ...fullyAccurateJudgment, materialErrors: ["Reversed threshold"] },
        requiredFacts,
        true
      )
    ).toBe(false);
  });

  it("allows omitted non-critical facts when all critical facts are accurate", () => {
    expect(
      passesEvalQualityGate(
        {
          ...fullyAccurateJudgment,
          facts: [{ id: "critical", status: "accurate" }],
        },
        requiredFacts,
        true
      )
    ).toBe(true);
  });
});
