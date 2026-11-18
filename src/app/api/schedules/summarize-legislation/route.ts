import { handleSchedule } from "@vercel/schedules";
import { triggerScheduledWorkflow } from "@/lib/schedules/trigger";
import { summarizeLegislationWorkflow } from "@/workflows/summarize-legislation";

export const POST = handleSchedule(async (metadata) => {
  await triggerScheduledWorkflow(summarizeLegislationWorkflow, metadata);
});
