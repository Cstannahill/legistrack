// Type definitions for the application
import {
  Bill,
  Category,
  Summary,
  Member,
  Vote,
  ExecutiveOrder,
} from "@prisma/client";

// Extended types with relationships
export type BillWithRelations = Bill & {
  sponsor?: Member | null;
  categories: Category[];
  summaries: Summary[];
  _count?: {
    votes: number;
    amendments: number;
  };
};

export type ExecutiveOrderWithRelations = ExecutiveOrder & {
  categories: Category[];
  summaries: Summary[];
};

// API Response types
export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface ApiError {
  error: string;
  details?: unknown;
}

// Filter types
export interface BillFilters {
  status?: string;
  category?: string;
  congress?: number;
  search?: string;
  sortBy?: "date" | "relevance" | "status";
  sortOrder?: "asc" | "desc";
}

// Summary display types
export interface SummaryDisplay {
  type: string;
  label: string;
  content: string;
  keyPoints: string[];
  impactAreas: string[];
}
