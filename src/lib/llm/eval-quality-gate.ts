export interface EvalRequiredFact {
  id: string;
  critical: boolean;
}

export interface EvalJudgeFact {
  id: string;
  status: "accurate" | "omitted" | "incorrect";
}

export interface EvalJudgment {
  score: number;
  facts: EvalJudgeFact[];
  materialErrors: string[];
}

export function passesEvalQualityGate(
  judgment: EvalJudgment | null,
  requiredFacts: EvalRequiredFact[],
  hasValidSummary: boolean
): boolean {
  if (
    !hasValidSummary ||
    !judgment ||
    judgment.score < 4 ||
    judgment.materialErrors.length > 0 ||
    judgment.facts.some((fact) => fact.status === "incorrect")
  ) {
    return false;
  }

  const factStatuses = new Map(
    judgment.facts.map((fact) => [fact.id, fact.status])
  );
  return requiredFacts
    .filter((fact) => fact.critical)
    .every((fact) => factStatuses.get(fact.id) === "accurate");
}
