import fs from "node:fs";
import path from "node:path";
import { handleSchedule, type ScheduleHandler } from "@vercel/schedules";
import { start } from "workflow/api";
import { ingestExecutiveOrdersWorkflow } from "@/workflows/ingest-eo";
import { ingestLegislationWorkflow } from "@/workflows/ingest-legislation";
import { summarizeLegislationWorkflow } from "@/workflows/summarize-legislation";
import { updateTextsWorkflow } from "@/workflows/update-texts";

jest.mock("@vercel/schedules", () => {
  const actual =
    jest.requireActual<typeof import("@vercel/schedules")>("@vercel/schedules");
  return {
    ...actual,
    handleSchedule: jest.fn((handler: ScheduleHandler) =>
      actual.handleSchedule(handler)
    ),
  };
});

jest.mock("workflow/api", () => ({
  start: jest.fn(),
}));

jest.mock("workflow", () => {
  class MockRetryableError extends Error {
    retryAfter: unknown;

    constructor(message: string, options?: { retryAfter?: unknown }) {
      super(message);
      this.name = "RetryableError";
      this.retryAfter = options?.retryAfter;
    }
  }

  return {
    RetryableError: MockRetryableError,
    FatalError: class extends Error {},
  };
});

jest.mock("next/cache", () => ({
  revalidatePath: jest.fn(),
}));

jest.mock("@/lib/db", () => ({
  db: {},
}));

import * as ingestEoRoute from "@/app/api/schedules/ingest-eo/route";
import * as ingestLegislationRoute from "@/app/api/schedules/ingest-legislation/route";
import * as summarizeLegislationRoute from "@/app/api/schedules/summarize-legislation/route";
import * as updateTextsRoute from "@/app/api/schedules/update-texts/route";

type RouteModule = {
  POST?: (request: Request) => Promise<Response>;
  GET?: unknown;
  [key: string]: unknown;
};

interface ScheduleTestCase {
  name: string;
  cron: string;
  workflow: unknown;
  route: RouteModule;
}

const SCHEDULE_CASES: ScheduleTestCase[] = [
  {
    name: "ingest-legislation",
    cron: "0 */6 * * *",
    workflow: ingestLegislationWorkflow,
    route: ingestLegislationRoute,
  },
  {
    name: "ingest-eo",
    cron: "0 */12 * * *",
    workflow: ingestExecutiveOrdersWorkflow,
    route: ingestEoRoute,
  },
  {
    name: "update-texts",
    cron: "0 */4 * * *",
    workflow: updateTextsWorkflow,
    route: updateTextsRoute,
  },
  {
    name: "summarize-legislation",
    cron: "*/20 * * * *",
    workflow: summarizeLegislationWorkflow,
    route: summarizeLegislationRoute,
  },
];

const CRON_FIELD_REGEX =
  /^(\*|\d+(-\d+)?|\*\/\d+|\d+(-\d+)?\/\d+)(,(\*|\d+(-\d+)?|\*\/\d+|\d+(-\d+)?\/\d+))*$/;

function isValidFiveFieldVercelCron(expr: string): boolean {
  if (expr.length < 9 || expr.length > 256) return false;
  const fields = expr.split(" ");
  if (fields.length !== 5) return false;
  if (!fields.every((field) => CRON_FIELD_REGEX.test(field))) return false;
  // Vercel Schedules prohibits setting both day-of-month and day-of-week
  if (fields[2] !== "*" && fields[4] !== "*") return false;
  return true;
}

function makeScheduleRequest(
  name: string,
  cron: string,
  executionId: string
): Request {
  return new Request(`https://internal.vercel.local/api/schedules/${name}`, {
    method: "POST",
    headers: {
      "ce-specversion": "1.0",
      "ce-type": "com.vercel.schedule.v1beta",
      "ce-source": "/vercel/schedules",
      "ce-id": executionId,
      "ce-vssscheduleid": `sched-${name}`,
      "ce-vssschedulename": name,
      "ce-vssnamespace": "default",
      "ce-vssscheduledat": "2026-11-17T12:00:00.000Z",
      "ce-vssschedulesource": "static",
      "ce-vssexpression": cron,
    },
  });
}

const mockHandleSchedule = handleSchedule as jest.Mock;
const mockStart = start as jest.Mock;

describe("Vercel Schedules route handlers and vercel.json", () => {
  const originalCronSecret = process.env.CRON_SECRET;
  let infoSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    infoSpy = jest.spyOn(console, "info").mockImplementation(() => {});
    errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    mockStart.mockReset();
    mockStart.mockResolvedValue({ runId: "wrun_test_123" });
    process.env.CRON_SECRET = "should-not-be-checked";
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(() => {
    if (originalCronSecret === undefined) {
      delete process.env.CRON_SECRET;
    } else {
      process.env.CRON_SECRET = originalCronSecret;
    }
  });

  it("wraps every route POST handler directly with handleSchedule", () => {
    expect(mockHandleSchedule).toHaveBeenCalledTimes(SCHEDULE_CASES.length);
  });

  it.each(SCHEDULE_CASES)(
    "$name exports only POST (no GET), calls start with executionId, and ignores CRON_SECRET",
    async ({ name, cron, workflow, route }) => {
      expect(Object.keys(route)).toEqual(["POST"]);
      expect(typeof route.POST).toBe("function");
      expect(route.GET).toBeUndefined();

      const executionId = `exec-${name}-001`;
      const request = makeScheduleRequest(name, cron, executionId);

      const response = await route.POST!(request);
      expect(response.status).toBe(200);
      expect(await response.text()).toBe("");
      expect(mockStart).toHaveBeenCalledTimes(1);
      expect(mockStart).toHaveBeenCalledWith(workflow, [{ executionId }]);
      expect(infoSpy).toHaveBeenCalledWith(
        "[schedules] Started workflow",
        expect.objectContaining({
          scheduleName: name,
          executionId,
          runId: "wrun_test_123",
        })
      );
      expect(errorSpy).not.toHaveBeenCalled();
    }
  );

  it.each(SCHEDULE_CASES)(
    "$name returns HTTP 400 without calling start() when CloudEvent headers are missing",
    async ({ name, route }) => {
      const request = new Request(
        `https://internal.vercel.local/api/schedules/${name}`,
        { method: "POST" }
      );

      const response = await route.POST!(request);
      expect(response.status).toBe(400);
      expect(mockStart).not.toHaveBeenCalled();
    }
  );

  it.each(SCHEDULE_CASES)(
    "$name propagates workflow start() failures so Vercel records a failed invocation",
    async ({ name, cron, route }) => {
      mockStart.mockRejectedValueOnce(
        new Error(`Queue unavailable for ${name}`)
      );

      const executionId = `exec-${name}-err`;
      const request = makeScheduleRequest(name, cron, executionId);

      await expect(route.POST!(request)).rejects.toThrow(
        `Queue unavailable for ${name}`
      );
      expect(errorSpy).toHaveBeenCalledWith(
        "[schedules] Failed to start workflow",
        expect.objectContaining({
          scheduleName: name,
          executionId,
          error: `Queue unavailable for ${name}`,
        })
      );
    }
  );

  it.each(SCHEDULE_CASES)(
    "$name source file exports handleSchedule directly and contains no CRON_SECRET, Authorization, or edge runtime config",
    ({ name }) => {
      const routeFile = path.join(
        process.cwd(),
        "src",
        "app",
        "api",
        "schedules",
        name,
        "route.ts"
      );
      const source = fs.readFileSync(routeFile, "utf8");

      expect(source).toMatch(/export\s+const\s+POST\s*=\s*handleSchedule\(/);
      expect(source).not.toMatch(/CRON_SECRET/);
      expect(source).not.toMatch(/authorization/i);
      expect(source).not.toMatch(/runtime\s*=\s*["']edge["']/);
      expect(source).not.toMatch(/export\s+(async\s+)?(function|const)\s+GET\b/);
    }
  );

  it("defines valid private schedule/v1beta functions and matching schedules in vercel.json", () => {
    const vercelJsonPath = path.join(process.cwd(), "vercel.json");
    expect(fs.existsSync(vercelJsonPath)).toBe(true);

    const parsed = JSON.parse(fs.readFileSync(vercelJsonPath, "utf8")) as {
      $schema?: string;
      crons?: unknown;
      routes?: unknown;
      rewrites?: unknown;
      functions?: Record<
        string,
        { experimentalTriggers?: Array<{ type: string; [key: string]: unknown }> }
      >;
      schedules?: Record<string, Record<string, unknown>>;
    };

    expect(Object.keys(parsed).sort()).toEqual([
      "$schema",
      "functions",
      "schedules",
    ]);
    expect(parsed.$schema).toBe("https://openapi.vercel.sh/vercel.json");
    expect(parsed.crons).toBeUndefined();
    expect(parsed.routes).toBeUndefined();
    expect(parsed.rewrites).toBeUndefined();
    expect(parsed.functions).toBeDefined();
    expect(parsed.schedules).toBeDefined();

    const expectedNames = SCHEDULE_CASES.map((c) => c.name).sort();
    expect(Object.keys(parsed.schedules!).sort()).toEqual(expectedNames);

    const expectedFunctionKeys = SCHEDULE_CASES.map(
      (c) => `src/app/api/schedules/${c.name}/route.ts`
    ).sort();
    expect(Object.keys(parsed.functions!).sort()).toEqual(expectedFunctionKeys);

    for (const { name, cron } of SCHEDULE_CASES) {
      const scheduleEntry = parsed.schedules![name];
      expect(Object.keys(scheduleEntry).sort()).toEqual([
        "function",
        "schedule",
      ]);
      expect(scheduleEntry.schedule).toBe(cron);
      expect(isValidFiveFieldVercelCron(String(scheduleEntry.schedule))).toBe(
        true
      );
      expect(scheduleEntry.function).toBe(`api/schedules/${name}`);
      expect(scheduleEntry.path).toBeUndefined();
      expect(scheduleEntry.topic).toBeUndefined();
      expect(scheduleEntry.requestMethod).toBeUndefined();

      const functionKey = `src/app/api/schedules/${name}/route.ts`;
      const routeDiskPath = path.join(process.cwd(), functionKey);
      expect(fs.existsSync(routeDiskPath)).toBe(true);

      const fnConfig = parsed.functions![functionKey];
      expect(fnConfig.experimentalTriggers).toEqual([
        { type: "schedule/v1beta" },
      ]);
    }
  });
});
