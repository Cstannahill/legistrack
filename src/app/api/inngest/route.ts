// app/api/inngest/route.ts  (or pages/api/inngest.ts depending on layout)

// Force Node runtime so process.env contains server secrets
export const runtime = "nodejs";

import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import { functions } from "@/inngest/functions";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions,
});
