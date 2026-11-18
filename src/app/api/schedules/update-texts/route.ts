import { handleSchedule } from "@vercel/schedules";
import { triggerScheduledWorkflow } from "@/lib/schedules/trigger";
import { updateTextsWorkflow } from "@/workflows/update-texts";

export const POST = handleSchedule(async (metadata) => {
  await triggerScheduledWorkflow(updateTextsWorkflow, metadata);
});
