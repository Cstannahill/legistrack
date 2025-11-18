import type { SummarizationItem } from "./types.js";

const TOKEN_CHAR_RATIO = 4;

interface TokenReportEntry {
  id: string;
  approxTokens: number;
}

export interface TokenReport {
  label: string;
  batchTokens: number;
  perItem: TokenReportEntry[];
}

function estimateTokens(text: string): number {
  return Math.max(0, Math.ceil(text.length / TOKEN_CHAR_RATIO));
}

export function logBatchTokenEstimate(options: {
  label: string;
  systemPrompt: string;
  buildUserPrompt: (items: SummarizationItem[]) => string;
  items: SummarizationItem[];
}): TokenReport {
  const userPrompt = options.buildUserPrompt(options.items);
  const batchTokens = estimateTokens(`${options.systemPrompt}\n${userPrompt}`);

  const perItem: TokenReportEntry[] = options.items.map((item) => {
    const promptForOne = options.buildUserPrompt([item]);
    return {
      id: item.sourceId,
      approxTokens: estimateTokens(`${options.systemPrompt}\n${promptForOne}`),
    };
  });

  const report: TokenReport = {
    label: options.label,
    batchTokens,
    perItem,
  };

  console.log(JSON.stringify({ tokenReport: report }));
  return report;
}
