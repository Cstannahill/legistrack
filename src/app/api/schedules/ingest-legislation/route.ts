import { handleSchedule } from "@vercel/schedules";
import { triggerScheduledWorkflow } from "@/lib/schedules/trigger";
import { ingestLegislationWorkflow } from "@/workflows/ingest-legislation";

export const POST = handleSchedule(async (metadata) => {
  await triggerScheduledWorkflow(ingestLegislationWorkflow, metadata);
});
