import { handleSchedule } from "@vercel/schedules";
import { triggerScheduledWorkflow } from "@/lib/schedules/trigger";
import { ingestExecutiveOrdersWorkflow } from "@/workflows/ingest-eo";

export const POST = handleSchedule(async (metadata) => {
  await triggerScheduledWorkflow(ingestExecutiveOrdersWorkflow, metadata);
});
