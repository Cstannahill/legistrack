// Application constants

export const APP_NAME = "LegisTrack";
export const APP_DESCRIPTION =
  "Track, understand, and stay informed about U.S. federal legislation in plain language";

// API URLs
export const CONGRESS_API_BASE = "https://api.congress.gov/v3";
export const FEDERAL_REGISTER_API_BASE =
  "https://www.federalregister.gov/api/v1";

// Current Congress
export const CURRENT_CONGRESS = 119;

// Pagination defaults
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

// Cache durations (in seconds)
export const CACHE_DURATIONS = {
  BILLS_LIST: 3600, // 1 hour
  BILL_DETAIL: 1800, // 30 minutes
  CATEGORIES: 86400, // 24 hours
  SEARCH: 600, // 10 minutes
} as const;

export type SemanticTone = "neutral" | "info" | "success" | "danger";

export const SEMANTIC_TONE_BADGE_CLASSES: Record<SemanticTone, string> = {
  neutral:
    "border-stone-300/80 bg-stone-100/80 text-stone-700 dark:border-stone-700 dark:bg-stone-800/70 dark:text-stone-300",
  info:
    "border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-800/70 dark:bg-sky-950/60 dark:text-sky-300",
  success:
    "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800/70 dark:bg-emerald-950/60 dark:text-emerald-300",
  danger:
    "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-800/70 dark:bg-rose-950/60 dark:text-rose-300",
};

export const SEMANTIC_TONE_DOT_CLASSES: Record<SemanticTone, string> = {
  neutral: "bg-stone-500 dark:bg-stone-400",
  info: "bg-sky-600 dark:bg-sky-400",
  success: "bg-emerald-600 dark:bg-emerald-400",
  danger: "bg-rose-600 dark:bg-rose-400",
};

export const BILL_STATUS_TONES = {
  INTRODUCED: "neutral",
  REFERRED_TO_COMMITTEE: "neutral",
  REPORTED_BY_COMMITTEE: "neutral",
  PASSED_HOUSE: "info",
  PASSED_SENATE: "info",
  RESOLVING_DIFFERENCES: "info",
  PRESENTED_TO_PRESIDENT: "info",
  BECAME_LAW: "success",
  VETOED: "danger",
  FAILED: "danger",
} as const satisfies Record<string, SemanticTone>;

// Bill status colors (4 semantic tones with full light/dark support)
export const BILL_STATUS_COLORS = {
  INTRODUCED: SEMANTIC_TONE_BADGE_CLASSES.neutral,
  REFERRED_TO_COMMITTEE: SEMANTIC_TONE_BADGE_CLASSES.neutral,
  REPORTED_BY_COMMITTEE: SEMANTIC_TONE_BADGE_CLASSES.neutral,
  PASSED_HOUSE: SEMANTIC_TONE_BADGE_CLASSES.info,
  PASSED_SENATE: SEMANTIC_TONE_BADGE_CLASSES.info,
  RESOLVING_DIFFERENCES: SEMANTIC_TONE_BADGE_CLASSES.info,
  PRESENTED_TO_PRESIDENT: SEMANTIC_TONE_BADGE_CLASSES.info,
  BECAME_LAW: SEMANTIC_TONE_BADGE_CLASSES.success,
  VETOED: SEMANTIC_TONE_BADGE_CLASSES.danger,
  FAILED: SEMANTIC_TONE_BADGE_CLASSES.danger,
} as const;

// Bill status labels
export const BILL_STATUS_LABELS = {
  INTRODUCED: "Introduced",
  REFERRED_TO_COMMITTEE: "In Committee",
  REPORTED_BY_COMMITTEE: "Reported by Committee",
  PASSED_HOUSE: "Passed House",
  PASSED_SENATE: "Passed Senate",
  RESOLVING_DIFFERENCES: "Resolving Differences",
  PRESENTED_TO_PRESIDENT: "Sent to President",
  BECAME_LAW: "Became Law",
  VETOED: "Vetoed",
  FAILED: "Failed",
} as const;

// Summary type labels
export const SUMMARY_TYPE_LABELS = {
  BRIEF: "Brief Summary",
  STANDARD: "Standard Summary",
  DETAILED: "Detailed Analysis",
  ELI5: "Simple Explanation",
  KEY_CHANGES: "Key Changes",
} as const;

// Executive Order type labels
export const EXECUTIVE_ORDER_TYPE_LABELS = {
  EXECUTIVE_ORDER: "Executive Order",
  PRESIDENTIAL_MEMORANDUM: "Presidential Memorandum",
  PROCLAMATION: "Proclamation",
  DETERMINATION: "Determination",
} as const;

// Executive Order type colors (cohesive civic-teal / slate accents with dark mode variants)
export const EXECUTIVE_ORDER_TYPE_COLORS = {
  EXECUTIVE_ORDER:
    "border-teal-200 bg-teal-50 text-teal-800 dark:border-teal-800/70 dark:bg-teal-950/60 dark:text-teal-300",
  PRESIDENTIAL_MEMORANDUM:
    "border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-800/70 dark:bg-sky-950/60 dark:text-sky-300",
  PROCLAMATION:
    "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800/70 dark:bg-amber-950/60 dark:text-amber-300",
  DETERMINATION:
    "border-stone-300 bg-stone-100 text-stone-800 dark:border-stone-700 dark:bg-stone-800/70 dark:text-stone-300",
} as const;

// Legislation type labels
export const LEGISLATION_TYPE_LABELS = {
  ALL: "All Legislation",
  BILLS: "Bills Only",
  EXECUTIVE_ORDERS: "Executive Orders Only",
} as const;
