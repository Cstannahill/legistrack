// Inngest function registry
// Import all background job functions here
import { fetchBillsJob } from "@/jobs/fetch/fetch-bills";
import { fetchExecutiveOrdersJob } from "@/jobs/fetch/fetch-executive-orders";
import { summarizeBillJob } from "@/jobs/process/summarize-legislation";
import { categorizeBillJob } from "@/jobs/process/categorize-bills";
import { batchSummarizeBillsJob } from "@/jobs/process/batch-summarize-bills";

// Export all functions that should be registered with Inngest
export const functions = [
  fetchBillsJob,
  fetchExecutiveOrdersJob,
  summarizeBillJob,
  categorizeBillJob,
  batchSummarizeBillsJob,
];
