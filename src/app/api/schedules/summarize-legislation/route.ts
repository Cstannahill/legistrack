import { handleSchedule } from "@vercel/schedules";
import { triggerScheduledWorkflow } from "@/lib/schedules/trigger";
import { summarizeLegislationWorkflow } from "@/workflows/summarize-legislation";

const SUMMARIZE_SCHEDULE_MAX_AGE_MS = 20 * 60 * 1000;

export const POST = handleSchedule(async (metadata) => {
  await triggerScheduledWorkflow(summarizeLegislationWorkflow, metadata, {
    maxAgeMs: SUMMARIZE_SCHEDULE_MAX_AGE_MS,
  });
});
