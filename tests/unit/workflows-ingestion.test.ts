import fs from "node:fs";
import path from "node:path";
import { revalidatePath } from "next/cache";
import { start } from "workflow/api";
import { CongressClient } from "@/lib/ingestion/congress-client";
import {
  backfillMissingBillTexts,
  persistHydratedBillPrisma,
} from "@/lib/ingestion/bills-service";
import {
  backfillMissingEoTexts,
  persistExecutiveOrderPrisma,
} from "@/lib/ingestion/executive-orders-service";
import {
  fetchExecutiveOrdersPage,
  hydrateExecutiveOrder,
} from "@/lib/ingestion/federal-register-client";
import { ingestExecutiveOrdersWorkflow } from "@/workflows/ingest-eo";
import { ingestLegislationWorkflow } from "@/workflows/ingest-legislation";
import * as ingestEoSteps from "@/workflows/steps/ingest-eo";
import * as ingestLegislationSteps from "@/workflows/steps/ingest-legislation";
import { summarizeLegislationWorkflow } from "@/workflows/summarize-legislation";
import { updateTextsWorkflow } from "@/workflows/update-texts";

jest.mock("workflow", () => ({
  RetryableError: class MockRetryableError extends Error {},
}));

jest.mock("workflow/api", () => ({
  start: jest.fn(),
}));

jest.mock("next/cache", () => ({
  revalidatePath: jest.fn(),
}));

jest.mock("@/lib/db", () => ({
  db: {
    jobRun: {
      create: jest.fn(),
      update: jest.fn(),
    },
    bill: {
      count: jest.fn(),
    },
    executiveOrder: {
      count: jest.fn(),
    },
  },
}));

const mockFetchBillPage = jest.fn();
const mockHydrateBill = jest.fn();

jest.mock("@/lib/ingestion/congress-client", () => {
  const actual = jest.requireActual<
    typeof import("@/lib/ingestion/congress-client")
  >("@/lib/ingestion/congress-client");
  return {
    ...actual,
    CongressClient: jest.fn().mockImplementation(() => ({
      fetchBillPage: mockFetchBillPage,
      hydrateBill: mockHydrateBill,
    })),
  };
});

jest.mock("@/lib/ingestion/bills-service", () => {
  const actual = jest.requireActual<
    typeof import("@/lib/ingestion/bills-service")
  >("@/lib/ingestion/bills-service");
  return {
    ...actual,
    persistHydratedBillPrisma: jest.fn(),
    backfillMissingBillTexts: jest.fn(),
  };
});

jest.mock("@/lib/ingestion/federal-register-client", () => {
  const actual = jest.requireActual<
    typeof import("@/lib/ingestion/federal-register-client")
  >("@/lib/ingestion/federal-register-client");
  return {
    ...actual,
    fetchExecutiveOrdersPage: jest.fn(),
    hydrateExecutiveOrder: jest.fn(),
  };
});

jest.mock("@/lib/ingestion/executive-orders-service", () => {
  const actual = jest.requireActual<
    typeof import("@/lib/ingestion/executive-orders-service")
  >("@/lib/ingestion/executive-orders-service");
  return {
    ...actual,
    persistExecutiveOrderPrisma: jest.fn(),
    backfillMissingEoTexts: jest.fn(),
  };
});

interface MockDb {
  jobRun: {
    create: jest.Mock;
    update: jest.Mock;
  };
  bill: {
    count: jest.Mock;
  };
  executiveOrder: {
    count: jest.Mock;
  };
}

const { db: mockDb } = jest.requireMock("@/lib/db") as { db: MockDb };
const mockStart = start as jest.Mock;
const mockRevalidatePath = revalidatePath as jest.Mock;
const mockCongressClientCtor = CongressClient as unknown as jest.Mock;
const mockPersistHydratedBillPrisma = persistHydratedBillPrisma as jest.Mock;
const mockBackfillMissingBillTexts = backfillMissingBillTexts as jest.Mock;
const mockFetchExecutiveOrdersPage = fetchExecutiveOrdersPage as jest.Mock;
const mockHydrateExecutiveOrder = hydrateExecutiveOrder as jest.Mock;
const mockPersistExecutiveOrderPrisma = persistExecutiveOrderPrisma as jest.Mock;
const mockBackfillMissingEoTexts = backfillMissingEoTexts as jest.Mock;

function makeBillListItem(index: number) {
  return {
    congress: 119,
    type: "HR",
    number: String(index),
    title: `Bill Number ${index}`,
    updateDate: "2026-11-16",
    latestAction: {
      actionDate: "2026-11-16",
      text: "Referred to committee",
    },
  };
}

function makeEoDocument(index: number) {
  return {
    document_number: `2026-${String(index).padStart(5, "0")}`,
    type: "Presidential Document",
    presidential_document_type: "executive_order",
    subtype: "Executive Order",
    title: `Executive Order Test ${index}`,
    signing_date: "2026-11-15",
    publication_date: "2026-11-16",
    executive_order_number: 14200 + index,
    html_url: `https://www.federalregister.gov/d/2026-${String(index).padStart(5, "0")}`,
    abstract: "Large unused abstract text ".repeat(50),
  };
}

describe("Durable ingestion & text-backfill workflows + steps", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    mockFetchBillPage.mockReset();
    mockHydrateBill.mockReset();
    mockPersistHydratedBillPrisma.mockReset();
    mockBackfillMissingBillTexts.mockReset();
    mockFetchExecutiveOrdersPage.mockReset();
    mockHydrateExecutiveOrder.mockReset();
    mockPersistExecutiveOrderPrisma.mockReset();
    mockBackfillMissingEoTexts.mockReset();
    mockDb.bill.count.mockReset();
    mockDb.executiveOrder.count.mockReset();

    process.env = { ...originalEnv };
    delete process.env.INGEST_LOOKBACK_DAYS;
    delete process.env.EO_LOOKBACK_DAYS;
    delete process.env.TARGET_CONGRESS;
    delete process.env.BILL_TEXT_BATCH_SIZE;
    delete process.env.EO_TEXT_BATCH_SIZE;
    delete process.env.EO_PER_PAGE;
    delete process.env.EO_FETCH_FULL_TEXT;
    delete process.env.EO_DOCUMENT_TYPES;

    jest.spyOn(console, "info").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});

    mockStart.mockResolvedValue({ runId: "wrun_child_sum_1" });
    mockDb.jobRun.create.mockResolvedValue({ id: "jr-1" });
    mockDb.jobRun.update.mockResolvedValue({ id: "jr-1" });
    mockDb.bill.count.mockResolvedValue(0);
    mockDb.executiveOrder.count.mockResolvedValue(0);

    mockCongressClientCtor.mockImplementation(() => ({
      fetchBillPage: mockFetchBillPage,
      hydrateBill: mockHydrateBill,
    }));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe("ingestLegislationWorkflow", () => {
    it("creates JobRun, chunks 25 bills into batches of 10, completes with counts, revalidates, and starts summarizeLegislationWorkflow when bills need processing", async () => {
      const billsPage1 = Array.from({ length: 15 }, (_, idx) =>
        makeBillListItem(idx + 1)
      );
      const billsPage2 = Array.from({ length: 10 }, (_, idx) =>
        makeBillListItem(idx + 16)
      );
      // Include a duplicate of bill #1 on page 2 to verify deduplication
      billsPage2.push(makeBillListItem(1));

      mockFetchBillPage
        .mockResolvedValueOnce({
          bills: billsPage1,
          pagination: { next: "https://api.congress.gov/v3/bill/119?offset=15" },
        })
        .mockResolvedValueOnce({
          bills: billsPage2,
          pagination: {},
        });

      const chunkSpy = jest.spyOn(
        ingestLegislationSteps,
        "ingestBillChunkStep"
      );

      mockHydrateBill.mockImplementation(async (bill: { congress: number; type: string; number: string; title: string }) => {
        if (bill.number === "25") {
          throw new Error("Congress API timeout");
        }
        return {
          bill: {
            congress: bill.congress,
            type: bill.type,
            number: bill.number,
            title: bill.title,
          },
          text:
            Number(bill.number) <= 20
              ? { content: `Full bill text for ${bill.number}` }
              : { content: null },
          actions: [],
          amendments: [],
          cosponsors: [],
        };
      });

      mockPersistHydratedBillPrisma.mockImplementation(async (hydrated: { bill: { number: string } }) => {
        const num = Number(hydrated.bill.number);
        if (num <= 18) {
          return {
            action: "created",
            billId: `bill-${num}`,
            identifier: `119-HR-${num}`,
          };
        }
        if (num <= 22) {
          return {
            action: "updated",
            billId: `bill-${num}`,
            identifier: `119-HR-${num}`,
          };
        }
        if (num === 23) {
          return {
            action: "skipped",
            identifier: `119-HR-${num}`,
            message: "Missing identifier",
          };
        }
        return {
          action: "failed",
          identifier: `119-HR-${num}`,
          message: "DB constraint failure",
        };
      });

      // Chunks 1 (10 changed bills) and 2 (10 changed bills) have bills needing summary/categories; chunk 3 (2 changed bills) has 0
      mockDb.bill.count
        .mockResolvedValueOnce(10)
        .mockResolvedValueOnce(8)
        .mockResolvedValueOnce(0);

      const summary = await ingestLegislationWorkflow({
        executionId: "sched-bill-exec-1",
        lookbackDays: 2,
        congress: 119,
      });

      expect(mockDb.jobRun.create).toHaveBeenCalledWith({
        data: {
          jobName: "ingest-legislation",
          status: "RUNNING",
          metadata: {
            executionId: "sched-bill-exec-1",
            lookbackDays: 2,
            congress: 119,
          },
        },
        select: { id: true },
      });

      // 25 unique bills chunked into [10, 10, 5]
      expect(chunkSpy).toHaveBeenCalledTimes(3);
      expect(chunkSpy.mock.calls[0][0]).toHaveLength(10);
      expect(chunkSpy.mock.calls[1][0]).toHaveLength(10);
      expect(chunkSpy.mock.calls[2][0]).toHaveLength(5);

      expect(mockRevalidatePath).toHaveBeenCalledWith("/");
      expect(mockRevalidatePath).toHaveBeenCalledWith("/bills");
      expect(mockStart).toHaveBeenCalledTimes(1);
      expect(mockStart).toHaveBeenCalledWith(summarizeLegislationWorkflow, [
        { executionId: "sched-bill-exec-1" },
      ]);

      expect(mockDb.jobRun.update).toHaveBeenCalledWith({
        where: { id: "jr-1" },
        data: {
          status: "COMPLETED",
          completedAt: expect.any(Date),
          itemsProcessed: 22, // 18 created + 4 updated
          itemsFailed: 2, // #24 failed in persist + #25 threw in hydrate
          metadata: expect.objectContaining({
            executionId: "sched-bill-exec-1",
            congress: 119,
            processed: 25,
            created: 18,
            updated: 4,
            skipped: 1,
            failed: 2,
            needsSummarizationCount: 18,
            revalidated: true,
            triggeredSummarization: true,
            summarizationRunId: "wrun_child_sum_1",
          }),
        },
      });

      expect(summary).toMatchObject({
        jobRunId: "jr-1",
        executionId: "sched-bill-exec-1",
        congress: 119,
        processed: 25,
        created: 18,
        updated: 4,
        skipped: 1,
        failed: 2,
        needsSummarizationCount: 18,
        revalidated: true,
        triggeredSummarization: true,
        summarizationRunId: "wrun_child_sum_1",
      });
    });

    it("does NOT spawn summarizeLegislationWorkflow when no created/updated bills need summarization or categorization", async () => {
      mockFetchBillPage.mockResolvedValueOnce({
        bills: [makeBillListItem(1), makeBillListItem(2)],
        pagination: {},
      });
      mockHydrateBill.mockResolvedValue({
        bill: { congress: 119, type: "HR", number: "1", title: "Already Summarized" },
        text: { content: null },
        actions: [],
        amendments: [],
        cosponsors: [],
      });
      mockPersistHydratedBillPrisma.mockResolvedValue({
        action: "updated",
        billId: "bill-existing",
        identifier: "119-HR-1",
      });
      mockDb.bill.count.mockResolvedValueOnce(0);

      const summary = await ingestLegislationWorkflow();

      expect(mockRevalidatePath).toHaveBeenCalledWith("/");
      expect(mockRevalidatePath).toHaveBeenCalledWith("/bills");
      expect(mockStart).not.toHaveBeenCalled();
      expect(summary).toMatchObject({
        created: 0,
        updated: 2,
        needsSummarizationCount: 0,
        revalidated: true,
        triggeredSummarization: false,
      });
    });

    it("completes cleanly without revalidating or starting child workflow when zero bills are returned", async () => {
      mockFetchBillPage.mockResolvedValueOnce({
        bills: [],
        pagination: {},
      });

      const summary = await ingestLegislationWorkflow();

      expect(mockHydrateBill).not.toHaveBeenCalled();
      expect(mockRevalidatePath).not.toHaveBeenCalled();
      expect(mockStart).not.toHaveBeenCalled();
      expect(mockDb.jobRun.update).toHaveBeenCalledWith({
        where: { id: "jr-1" },
        data: expect.objectContaining({
          status: "COMPLETED",
          itemsProcessed: 0,
          itemsFailed: 0,
        }),
      });
      expect(summary.processed).toBe(0);
    });

    it("marks JobRun FAILED and rethrows on uncaught error", async () => {
      mockFetchBillPage.mockRejectedValueOnce(new Error("Congress API 503"));

      await expect(
        ingestLegislationWorkflow({ executionId: "fail-bill-1" })
      ).rejects.toThrow("Congress API 503");

      expect(mockRevalidatePath).not.toHaveBeenCalled();
      expect(mockStart).not.toHaveBeenCalled();
      expect(mockDb.jobRun.update).toHaveBeenCalledWith({
        where: { id: "jr-1" },
        data: {
          status: "FAILED",
          completedAt: expect.any(Date),
          error: "Congress API 503",
        },
      });
    });
  });

  describe("ingestExecutiveOrdersWorkflow", () => {
    it("creates JobRun, chunks 15 EOs into batches of 10, revalidates, completes JobRun, and starts summarizeLegislationWorkflow when EOs need summarization", async () => {
      const page1Docs = Array.from({ length: 10 }, (_, idx) =>
        makeEoDocument(idx + 1)
      );
      const page2Docs = Array.from({ length: 5 }, (_, idx) =>
        makeEoDocument(idx + 11)
      );

      mockFetchExecutiveOrdersPage
        .mockResolvedValueOnce({
          count: 10,
          page: 1,
          total_pages: 2,
          total_entries: 15,
          results: page1Docs,
        })
        .mockResolvedValueOnce({
          count: 5,
          page: 2,
          total_pages: 2,
          total_entries: 15,
          results: page2Docs,
        });

      const eoChunkSpy = jest.spyOn(ingestEoSteps, "ingestEoChunkStep");

      mockHydrateExecutiveOrder.mockImplementation(
        async ({ document }: { document: { document_number: string; title: string } }) => {
          if (document.document_number === "2026-00015") {
            throw new Error("Federal Register detail failed");
          }
          return {
            documentNumber: document.document_number,
            orderNumber: 14200,
            executiveOrderType: "EXECUTIVE_ORDER",
            title: document.title,
            signingDate: new Date("2026-11-15T00:00:00Z"),
            presidentName: "Donald J. Trump",
            fullText: "Full EO text body",
          };
        }
      );

      mockPersistExecutiveOrderPrisma.mockImplementation(
        async (hydrated: { documentNumber: string }) => {
          const idx = Number(hydrated.documentNumber.split("-")[1]);
          if (idx <= 12) {
            return {
              action: "created",
              identifier: `eo-${idx}`,
              executiveOrderId: `eo-id-${idx}`,
            };
          }
          if (idx === 13) {
            return {
              action: "updated",
              identifier: `eo-${idx}`,
              executiveOrderId: `eo-id-${idx}`,
            };
          }
          return {
            action: "skipped",
            identifier: `eo-${idx}`,
          };
        }
      );

      mockDb.executiveOrder.count
        .mockResolvedValueOnce(10)
        .mockResolvedValueOnce(3);

      const summary = await ingestExecutiveOrdersWorkflow({
        executionId: "sched-eo-1",
        lookbackDays: 14,
      });

      expect(mockDb.jobRun.create).toHaveBeenCalledWith({
        data: {
          jobName: "ingest-eo",
          status: "RUNNING",
          metadata: {
            executionId: "sched-eo-1",
            lookbackDays: 14,
          },
        },
        select: { id: true },
      });

      expect(eoChunkSpy).toHaveBeenCalledTimes(2);
      expect(eoChunkSpy.mock.calls[0][0]).toHaveLength(10);
      expect(eoChunkSpy.mock.calls[1][0]).toHaveLength(5);

      expect(mockRevalidatePath).toHaveBeenCalledWith("/");
      expect(mockRevalidatePath).toHaveBeenCalledWith("/bills");
      expect(mockStart).toHaveBeenCalledTimes(1);
      expect(mockStart).toHaveBeenCalledWith(summarizeLegislationWorkflow, [
        { executionId: "sched-eo-1" },
      ]);

      expect(mockDb.jobRun.update).toHaveBeenCalledWith({
        where: { id: "jr-1" },
        data: {
          status: "COMPLETED",
          completedAt: expect.any(Date),
          itemsProcessed: 13,
          itemsFailed: 1,
          metadata: expect.objectContaining({
            executionId: "sched-eo-1",
            processed: 15,
            created: 12,
            updated: 1,
            skipped: 1,
            failed: 1,
            needsSummarizationCount: 13,
            revalidated: true,
            triggeredSummarization: true,
            summarizationRunId: "wrun_child_sum_1",
          }),
        },
      });

      expect(summary).toMatchObject({
        jobRunId: "jr-1",
        created: 12,
        updated: 1,
        skipped: 1,
        failed: 1,
        needsSummarizationCount: 13,
        revalidated: true,
        triggeredSummarization: true,
      });
    });

    it("skips spawning summarizeLegislationWorkflow when EOs have no fullText needing summary/categories", async () => {
      mockFetchExecutiveOrdersPage.mockResolvedValueOnce({
        count: 1,
        page: 1,
        total_pages: 1,
        total_entries: 1,
        results: [makeEoDocument(1)],
      });
      mockHydrateExecutiveOrder.mockResolvedValueOnce({
        documentNumber: "2026-00001",
        orderNumber: 14201,
        executiveOrderType: "EXECUTIVE_ORDER",
        title: "EO without text",
        signingDate: new Date("2026-11-15T00:00:00Z"),
        presidentName: "Donald J. Trump",
        fullText: null,
      });
      mockPersistExecutiveOrderPrisma.mockResolvedValueOnce({
        action: "created",
        identifier: "eo-1",
        executiveOrderId: "eo-id-1",
      });
      mockDb.executiveOrder.count.mockResolvedValueOnce(0);

      const summary = await ingestExecutiveOrdersWorkflow();

      expect(mockRevalidatePath).toHaveBeenCalledTimes(2);
      expect(mockStart).not.toHaveBeenCalled();
      expect(summary.triggeredSummarization).toBe(false);
    });

    it("marks JobRun FAILED and rethrows on uncaught Federal Register error", async () => {
      mockFetchExecutiveOrdersPage.mockRejectedValueOnce(
        new Error("Federal Register unreachable")
      );

      await expect(ingestExecutiveOrdersWorkflow()).rejects.toThrow(
        "Federal Register unreachable"
      );

      expect(mockDb.jobRun.update).toHaveBeenCalledWith({
        where: { id: "jr-1" },
        data: {
          status: "FAILED",
          completedAt: expect.any(Date),
          error: "Federal Register unreachable",
        },
      });
    });
  });

  describe("updateTextsWorkflow", () => {
    it("creates JobRun, backfills bill & EO texts, revalidates, completes JobRun, and starts summarizeLegislationWorkflow when items gained fullText", async () => {
      mockBackfillMissingBillTexts.mockResolvedValueOnce({
        processed: 4,
        updated: 2,
        urlOnly: 1,
        failed: 1,
        updatedIds: ["bill-1", "bill-2"],
      });
      mockBackfillMissingEoTexts.mockResolvedValueOnce({
        processed: 2,
        updated: 1,
        urlOnly: 0,
        failed: 1,
        updatedIds: ["eo-1"],
      });

      const summary = await updateTextsWorkflow({
        executionId: "sched-texts-1",
        billBatchSize: 12,
        eoBatchSize: 8,
      });

      expect(mockDb.jobRun.create).toHaveBeenCalledWith({
        data: {
          jobName: "update-texts",
          status: "RUNNING",
          metadata: {
            executionId: "sched-texts-1",
            billBatchSize: 12,
            eoBatchSize: 8,
          },
        },
        select: { id: true },
      });

      expect(mockBackfillMissingBillTexts).toHaveBeenCalledWith(12);
      expect(mockBackfillMissingEoTexts).toHaveBeenCalledWith(8);
      expect(mockRevalidatePath).toHaveBeenCalledWith("/");
      expect(mockRevalidatePath).toHaveBeenCalledWith("/bills");
      expect(mockStart).toHaveBeenCalledTimes(1);
      expect(mockStart).toHaveBeenCalledWith(summarizeLegislationWorkflow, [
        { executionId: "sched-texts-1" },
      ]);

      expect(mockDb.jobRun.update).toHaveBeenCalledWith({
        where: { id: "jr-1" },
        data: {
          status: "COMPLETED",
          completedAt: expect.any(Date),
          itemsProcessed: 4, // 2 bill updated + 1 bill urlOnly + 1 eo updated
          itemsFailed: 2, // 1 bill failed + 1 eo failed
          metadata: expect.objectContaining({
            executionId: "sched-texts-1",
            itemsGainedFullText: 3,
            revalidated: true,
            triggeredSummarization: true,
            summarizationRunId: "wrun_child_sum_1",
          }),
        },
      });

      expect(summary).toMatchObject({
        jobRunId: "jr-1",
        executionId: "sched-texts-1",
        itemsProcessed: 4,
        itemsFailed: 2,
        revalidated: true,
        triggeredSummarization: true,
        summarizationRunId: "wrun_child_sum_1",
      });
    });

    it("does NOT spawn summarizeLegislationWorkflow when only urlOnly updates or zero updates occur", async () => {
      process.env.BILL_TEXT_BATCH_SIZE = "7";
      process.env.EO_TEXT_BATCH_SIZE = "6";

      mockBackfillMissingBillTexts.mockResolvedValueOnce({
        processed: 2,
        updated: 0,
        urlOnly: 2,
        failed: 0,
        updatedIds: [],
      });
      mockBackfillMissingEoTexts.mockResolvedValueOnce({
        processed: 1,
        updated: 0,
        urlOnly: 0,
        failed: 1,
        updatedIds: [],
      });

      const urlOnlySummary = await updateTextsWorkflow();

      expect(mockBackfillMissingBillTexts).toHaveBeenCalledWith(7);
      expect(mockBackfillMissingEoTexts).toHaveBeenCalledWith(6);
      expect(mockRevalidatePath).toHaveBeenCalledTimes(2);
      expect(mockStart).not.toHaveBeenCalled();
      expect(urlOnlySummary.triggeredSummarization).toBe(false);

      jest.clearAllMocks();
      mockDb.jobRun.create.mockResolvedValue({ id: "jr-2" });
      mockDb.jobRun.update.mockResolvedValue({ id: "jr-2" });
      mockBackfillMissingBillTexts.mockResolvedValueOnce({
        processed: 0,
        updated: 0,
        urlOnly: 0,
        failed: 0,
        updatedIds: [],
      });
      mockBackfillMissingEoTexts.mockResolvedValueOnce({
        processed: 0,
        updated: 0,
        urlOnly: 0,
        failed: 0,
        updatedIds: [],
      });

      const emptySummary = await updateTextsWorkflow();

      expect(mockRevalidatePath).not.toHaveBeenCalled();
      expect(mockStart).not.toHaveBeenCalled();
      expect(emptySummary.revalidated).toBe(false);
      expect(emptySummary.triggeredSummarization).toBe(false);
    });

    it("marks JobRun FAILED and rethrows on uncaught backfill error", async () => {
      mockBackfillMissingBillTexts.mockRejectedValueOnce(
        new Error("Prisma query timeout")
      );

      await expect(updateTextsWorkflow()).rejects.toThrow(
        "Prisma query timeout"
      );

      expect(mockRevalidatePath).not.toHaveBeenCalled();
      expect(mockStart).not.toHaveBeenCalled();
      expect(mockDb.jobRun.update).toHaveBeenCalledWith({
        where: { id: "jr-1" },
        data: {
          status: "FAILED",
          completedAt: expect.any(Date),
          error: "Prisma query timeout",
        },
      });
    });
  });

  describe("Step boundaries, env defaults, and child trigger resilience", () => {
    it("respects env defaults, strips heavy fields across step boundaries, and skips empty chunks", async () => {
      process.env.INGEST_LOOKBACK_DAYS = "3";
      process.env.TARGET_CONGRESS = "120";
      process.env.EO_LOOKBACK_DAYS = "21";
      process.env.EO_PER_PAGE = "50";
      process.env.EO_FETCH_FULL_TEXT = "false";
      process.env.EO_DOCUMENT_TYPES = "executive_order,proclamation";

      mockFetchBillPage.mockResolvedValueOnce({
        bills: [makeBillListItem(7)],
        pagination: {},
      });

      const billList = await ingestLegislationSteps.fetchBillListStep({
        billTypes: ["hr", "s"],
      });
      expect(billList.congress).toBe(120);
      expect(billList.lookbackDays).toBe(3);
      expect(mockFetchBillPage).toHaveBeenCalledWith(
        expect.objectContaining({
          congress: 120,
          billTypes: ["hr", "s"],
          offset: 0,
        })
      );
      expect(billList.items).toEqual([
        {
          congress: 119,
          type: "HR",
          number: "7",
          title: "Bill Number 7",
        },
      ]);

      mockFetchExecutiveOrdersPage.mockResolvedValueOnce({
        count: 1,
        page: 1,
        total_pages: 1,
        total_entries: 1,
        results: [makeEoDocument(4), makeEoDocument(4)],
      });

      const eoList = await ingestEoSteps.fetchExecutiveOrderListStep();
      expect(eoList.lookbackDays).toBe(21);
      expect(eoList.fetchFullText).toBe(false);
      expect(mockFetchExecutiveOrdersPage).toHaveBeenCalledWith(
        expect.objectContaining({
          page: 1,
          perPage: 50,
          conditions: expect.objectContaining({
            presidentialDocumentType: ["executive_order", "proclamation"],
          }),
        })
      );
      expect(eoList.items).toHaveLength(1);
      expect("abstract" in eoList.items[0]).toBe(false);

      expect(await ingestLegislationSteps.ingestBillChunkStep([])).toEqual({
        processed: 0,
        created: 0,
        updated: 0,
        skipped: 0,
        failed: 0,
        needsSummarizationCount: 0,
        errors: [],
      });
      expect(await ingestEoSteps.ingestEoChunkStep([])).toEqual({
        processed: 0,
        created: 0,
        updated: 0,
        skipped: 0,
        failed: 0,
        needsSummarizationCount: 0,
        errors: [],
      });

      mockBackfillMissingBillTexts.mockResolvedValueOnce({
        processed: 0,
        updated: 0,
        urlOnly: 0,
        failed: 0,
        updatedIds: [],
      });
      mockBackfillMissingEoTexts.mockResolvedValueOnce({
        processed: 0,
        updated: 0,
        urlOnly: 0,
        failed: 0,
        updatedIds: [],
      });
      await ingestLegislationSteps.backfillBillTextsStep(0);
      await ingestEoSteps.backfillEoTextsStep(0);
      expect(mockBackfillMissingBillTexts).toHaveBeenCalledWith(0);
      expect(mockBackfillMissingEoTexts).toHaveBeenCalledWith(0);
    });

    it("queries exact Prisma eligibility criteria for changed items and keeps JobRun COMPLETED if child start() throws", async () => {
      mockFetchBillPage.mockResolvedValueOnce({
        bills: [makeBillListItem(1)],
        pagination: {},
      });
      mockHydrateBill.mockResolvedValueOnce({
        bill: { congress: 119, type: "HR", number: "1", title: "Bill 1" },
        text: { content: "Full bill text" },
        actions: [],
        amendments: [],
        cosponsors: [],
      });
      mockPersistHydratedBillPrisma.mockResolvedValueOnce({
        action: "created",
        billId: "bill-trigger-err",
        identifier: "119-HR-1",
      });
      mockDb.bill.count.mockResolvedValueOnce(1);
      mockStart.mockRejectedValueOnce(new Error("Workflow queue unavailable"));

      const summary = await ingestLegislationWorkflow({
        executionId: "exec-trigger-err",
      });

      expect(mockDb.bill.count).toHaveBeenCalledWith({
        where: {
          id: { in: ["bill-trigger-err"] },
          fullText: { not: null },
          NOT: { fullText: "" },
          OR: [
            { summaries: { none: { summaryType: "STANDARD" } } },
            { categories: { none: {} } },
          ],
        },
      });
      expect(summary).toMatchObject({
        jobRunId: "jr-1",
        created: 1,
        needsSummarizationCount: 1,
        revalidated: true,
        triggeredSummarization: false,
      });
      expect(mockDb.jobRun.update).toHaveBeenCalledWith({
        where: { id: "jr-1" },
        data: expect.objectContaining({
          status: "COMPLETED",
          itemsProcessed: 1,
          itemsFailed: 0,
          metadata: expect.objectContaining({
            triggeredSummarization: false,
            summarizationTriggerError: "Workflow queue unavailable",
          }),
        }),
      });
    });
  });

  describe("Workflow sandbox isolation static checks", () => {
    it("verifies 'use workflow' orchestrators do not import @/lib/db, next/cache, node:*, or setTimeout, and step modules declare 'use step'", () => {
      const rootDir = process.cwd();
      const workflowFiles = [
        "src/workflows/ingest-legislation.ts",
        "src/workflows/ingest-eo.ts",
        "src/workflows/update-texts.ts",
      ];
      const stepFiles = [
        "src/workflows/steps/ingest-legislation.ts",
        "src/workflows/steps/ingest-eo.ts",
      ];

      for (const relPath of workflowFiles) {
        const source = fs.readFileSync(path.join(rootDir, relPath), "utf8");
        expect(source).toContain('"use workflow"');
        expect(source).not.toContain("@/lib/db");
        expect(source).not.toContain("next/cache");
        expect(source).not.toContain("node:");
        expect(source).not.toContain("@/lib/ingestion");
        expect(source).not.toMatch(
          /\bsetTimeout\b|\bsetInterval\b|\bfetch\s*\(/
        );
      }

      for (const relPath of stepFiles) {
        const source = fs.readFileSync(path.join(rootDir, relPath), "utf8");
        expect(source).toContain('"use step"');
      }
    });
  });
});
