// AI Summarization Prompt Templates

export const SUMMARIZATION_PROMPTS = {
  BRIEF: `You are a legislative analyst. Summarize the following bill in 2-3 clear sentences that a general audience can understand.

Title: {{TITLE}}
Bill Type: {{BILL_TYPE}}
Sponsor: {{SPONSOR}}
Status: {{STATUS}}

Full Text:
{{FULL_TEXT}}

Provide your response in this format:
## Summary
[2-3 sentence summary]

## Key Points
- [First key point]
- [Second key point]
- [Third key point]

## Impact Areas
- [Who or what this affects]
- [Another impact area]

Focus on what the bill does, who it affects, and why it matters. Avoid jargon.`,

  STANDARD: `You are a legislative analyst. Provide a comprehensive but accessible summary of the following bill.

Title: {{TITLE}}
Bill Type: {{BILL_TYPE}}
Sponsor: {{SPONSOR}}
Status: {{STATUS}}

Full Text:
{{FULL_TEXT}}

Provide your response in this format:
## Summary
[1-2 paragraph summary explaining what the bill does, its purpose, and potential impact]

## Key Points
- [Important provision 1]
- [Important provision 2]
- [Important provision 3]
- [Important provision 4]
- [Important provision 5]

## Impact Areas
- [Primary group/area affected]
- [Secondary group/area affected]
- [Additional impacts]

Use clear, plain language. Explain technical terms when necessary.`,

  ELI5: `You are explaining legislation to someone with no legal background. Summarize this bill as if explaining to a curious 12-year-old.

Title: {{TITLE}}
Full Text:
{{FULL_TEXT}}

Provide your response in this format:
## Summary
[Simple explanation using everyday language and relatable examples]

## Key Points
- [Simple point 1]
- [Simple point 2]
- [Simple point 3]

## Impact Areas
- [Who this affects in simple terms]

Use analogies, avoid all jargon, and focus on real-world effects.`,

  DETAILED: `You are a senior legislative analyst. Provide a detailed analysis of the following bill.

Title: {{TITLE}}
Bill Type: {{BILL_TYPE}}
Sponsor: {{SPONSOR}}
Status: {{STATUS}}

Full Text:
{{FULL_TEXT}}

Provide your response in this format:
## Executive Summary
[Comprehensive overview]

## Key Provisions
- [Detailed provision 1]
- [Detailed provision 2]
- [Detailed provision 3]
[Continue as needed]

## Stakeholder Impact
- [Affected group 1 and how]
- [Affected group 2 and how]
- [Affected group 3 and how]

## Fiscal Implications
[Budget impact if mentioned]

## Implementation Timeline
[Key dates and deadlines if specified]

## Related Legislation
[Connections to other bills if evident]

Be thorough but clear.`,

  KEY_CHANGES: `You are comparing versions of legislation. Identify the key changes in this bill.

Title: {{TITLE}}
Full Text:
{{FULL_TEXT}}

Provide your response in this format:
## Summary of Changes
[Overview of what changed]

## Major Changes
- [Change 1]
- [Change 2]
- [Change 3]

## Impact of Changes
- [How change 1 affects things]
- [How change 2 affects things]

Focus on substantive changes, not formatting.`,
} as const;

export const CATEGORIZATION_PROMPT = `You are a legislative categorization system. Analyze the following bill and assign it to the most relevant categories.

Title: {{TITLE}}
Summary: {{SUMMARY}}

Available Categories:
{{CATEGORIES}}

Instructions:
1. Assign 1-3 primary categories that best describe this bill
2. Consider the bill's main focus and impacts
3. Return only category slugs, comma-separated

Response format:
category-slug-1, category-slug-2, category-slug-3`;
