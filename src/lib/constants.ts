// Application constants

export const APP_NAME = "Legislative Tracker";
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

// Bill status colors
export const BILL_STATUS_COLORS = {
  INTRODUCED: "bg-blue-100 text-blue-800",
  REFERRED_TO_COMMITTEE: "bg-purple-100 text-purple-800",
  REPORTED_BY_COMMITTEE: "bg-indigo-100 text-indigo-800",
  PASSED_HOUSE: "bg-green-100 text-green-800",
  PASSED_SENATE: "bg-teal-100 text-teal-800",
  RESOLVING_DIFFERENCES: "bg-yellow-100 text-yellow-800",
  PRESENTED_TO_PRESIDENT: "bg-orange-100 text-orange-800",
  BECAME_LAW: "bg-emerald-100 text-emerald-800",
  VETOED: "bg-red-100 text-red-800",
  FAILED: "bg-gray-100 text-gray-800",
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

// Executive Order type colors
export const EXECUTIVE_ORDER_TYPE_COLORS = {
  EXECUTIVE_ORDER: "bg-purple-100 text-purple-800",
  PRESIDENTIAL_MEMORANDUM: "bg-blue-100 text-blue-800",
  PROCLAMATION: "bg-indigo-100 text-indigo-800",
  DETERMINATION: "bg-violet-100 text-violet-800",
} as const;

// Legislation type labels
export const LEGISLATION_TYPE_LABELS = {
  ALL: "All Legislation",
  BILLS: "Bills Only",
  EXECUTIVE_ORDERS: "Executive Orders Only",
} as const;
