import fs from "node:fs";
import path from "node:path";
import { revalidatePath } from "next/cache";
import { RetryableError } from "workflow";
import {
  categorizeLegislationItem,
  summarizeAndCategorizeItems,
} from "@/lib/llm/router";
import {
  FallbackCapReachedError,
  type LlmCategoryInput,
} from "@/lib/llm/types";
import {
  completeJobRunStep,
  createJobRunStep,
  failJobRunStep,
  revalidateLegislationPathsStep,
} from "@/workflows/steps/job-runs";
import {
  processSummaryBatchStep,
  selectWorkBatchStep,
  type SummarizeWorkBatch,
} from "@/workflows/steps/summarize";
import { summarizeLegislationWorkflow } from "@/workflows/summarize-legislation";

jest.mock("workflow", () => {
  class MockRetryableError extends Error {
    retryAfter: unknown;

    constructor(message: string, options?: { retryAfter?: unknown }) {
      super(message);
      this.name = "RetryableError";
      this.retryAfter = options?.retryAfter;
    }

    static is(value: unknown): value is MockRetryableError {
      return value instanceof Error && value.name === "RetryableError";
    }
  }

  return {
    RetryableError: MockRetryableError,
  };
});

jest.mock("next/cache", () => ({
  revalidatePath: jest.fn(),
}));

jest.mock("@/lib/llm/router", () => {
  const actual =
    jest.requireActual<typeof import("@/lib/llm/router")>("@/lib/llm/router");
  return {
    summarizeAndCategorizeItems: jest.fn(),
    categorizeLegislationItem: jest.fn(),
    truncateForPrompt: actual.truncateForPrompt,
  };
});

jest.mock("@/lib/db", () => ({
  db: {
    $transaction: jest.fn(),
    $executeRaw: jest.fn(),
    category: {
      findMany: jest.fn(),
      count: jest.fn(),
    },
    bill: {
      findMany: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
    },
    executiveOrder: {
      findMany: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
    },
    summary: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    deadLetter: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    jobRun: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
  },
}));

interface MockDb {
  $transaction: jest.Mock;
  $executeRaw: jest.Mock;
  category: { findMany: jest.Mock; count: jest.Mock };
  bill: { findMany: jest.Mock; count: jest.Mock; update: jest.Mock };
  executiveOrder: { findMany: jest.Mock; count: jest.Mock; update: jest.Mock };
  summary: { findFirst: jest.Mock; create: jest.Mock };
  deadLetter: {
    findMany: jest.Mock;
    findFirst: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    updateMany: jest.Mock;
  };
  jobRun: {
    findFirst: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    updateMany: jest.Mock;
  };
}

const { db: mockDb } = jest.requireMock("@/lib/db") as { db: MockDb };
const mockRevalidatePath = revalidatePath as jest.Mock;
const mockSummarizeAndCategorizeItems = summarizeAndCategorizeItems as jest.Mock;
const mockCategorizeLegislationItem = categorizeLegislationItem as jest.Mock;

const VALID_SUMMARY =
  "This bipartisan legislative measure establishes federal infrastructure grants, modernizes municipal drinking water systems, and directs technical assistance toward rural communities nationwide.";

const DYNAMIC_CATEGORIES: Array<LlmCategoryInput & { id: string }> = [
  {
    id: "dyn-cat-infra",
    slug: "infrastructure",
    name: "Infrastructure",
    description: "Roads, bridges, water systems, and public works",
  },
  {
    id: "dyn-cat-health",
    slug: "healthcare",
    name: "Healthcare",
    description: "Hospitals, clinics, and public health",
  },
  {
    id: "dyn-cat-env",
    slug: "environment-climate",
    name: "Environment & Climate",
    description: "Clean water and climate resilience",
  },
  {
    id: "dyn-cat-def",
    slug: "defense-security",
    name: "Defense & Security",
    description: "National defense and cybersecurity",
  },
];

describe("Durable summarization + categorization workflow and dead-letter steps", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.SUMMARIZE_BATCH_SIZE;
    delete process.env.LLM_MAX_ATTEMPTS;

    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "info").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});

    mockDb.$transaction.mockReset().mockImplementation(
      async (callback: (tx: MockDb) => Promise<unknown>) => callback(mockDb)
    );
    mockDb.$executeRaw.mockReset().mockResolvedValue(1);
    mockDb.category.findMany.mockReset().mockResolvedValue(DYNAMIC_CATEGORIES);
    mockDb.category.count.mockReset().mockResolvedValue(0);
    mockDb.deadLetter.findMany.mockReset().mockResolvedValue([]);
    mockDb.deadLetter.findFirst.mockReset().mockResolvedValue(null);
    mockDb.deadLetter.create.mockReset().mockResolvedValue({ id: "dl-created" });
    mockDb.deadLetter.update.mockReset().mockResolvedValue({ id: "dl-updated" });
    mockDb.deadLetter.updateMany.mockReset().mockResolvedValue({ count: 0 });
    mockDb.summary.findFirst.mockReset().mockResolvedValue(null);
    mockDb.summary.create.mockReset().mockResolvedValue({ id: "sum-created" });
    mockDb.bill.findMany.mockReset().mockResolvedValue([]);
    mockDb.bill.count.mockReset().mockResolvedValue(0);
    mockDb.bill.update.mockReset().mockResolvedValue({ id: "bill-updated" });
    mockDb.executiveOrder.findMany.mockReset().mockResolvedValue([]);
    mockDb.executiveOrder.count.mockReset().mockResolvedValue(0);
    mockDb.executiveOrder.update.mockReset().mockResolvedValue({ id: "eo-updated" });
    mockDb.jobRun.findFirst.mockReset().mockResolvedValue(null);
    mockDb.jobRun.create.mockReset().mockResolvedValue({ id: "jr-1" });
    mockDb.jobRun.update.mockReset().mockResolvedValue({ id: "jr-1" });
    mockDb.jobRun.updateMany.mockReset().mockResolvedValue({ count: 0 });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe("selectWorkBatchStep", () => {
    it("loads dynamic categories, excludes DeadLetter rows >= LLM_MAX_ATTEMPTS, and tops off bills when fewer EOs exist", async () => {
      process.env.LLM_MAX_ATTEMPTS = "3";

      mockDb.deadLetter.findMany.mockResolvedValueOnce([
        { billId: "bill-poisoned-1", executiveOrderId: null },
        { billId: null, executiveOrderId: "eo-poisoned-1" },
      ]);

      // Only 2 EOs available out of default eoBatchSize = 5 -> shortfall of 3 -> bill take = 5 + 3 = 8
      mockDb.executiveOrder.findMany.mockResolvedValueOnce([
        {
          id: "eo-1",
          title: "EO 14100 Clean Water Directive",
          fullText: "Full executive order text ".repeat(10),
          summaries: [],
          categories: [],
        },
        {
          id: "eo-2",
          title: "EO 14101 Grid Security Directive",
          fullText: "Full executive order grid text ".repeat(10),
          summaries: [{ id: "sum-eo-2", content: VALID_SUMMARY }],
          categories: [],
        },
      ]);

      mockDb.bill.findMany.mockResolvedValueOnce([
        {
          id: "bill-1",
          billType: "hr",
          billNumber: 101,
          title: "Clean Water Infrastructure Act",
          shortTitle: null,
          fullText: "Full bill text ".repeat(10),
          summaries: [],
          categories: [],
        },
        {
          id: "bill-2",
          billType: "s",
          billNumber: 202,
          title: "Rural Healthcare Access Act",
          shortTitle: null,
          fullText: "Full senate bill text ".repeat(10),
          summaries: [{ id: "sum-bill-2", content: VALID_SUMMARY }],
          categories: [],
        },
        {
          id: "bill-blank-text",
          billType: "hr",
          billNumber: 999,
          title: "Blank Text Bill",
          shortTitle: null,
          fullText: "   ",
          summaries: [],
          categories: [],
        },
      ]);

      const batch = await selectWorkBatchStep();

      expect(mockDb.category.findMany).toHaveBeenCalledTimes(1);
      expect(mockDb.deadLetter.findMany).toHaveBeenCalledWith({
        where: {
          processed: false,
          attempts: { gte: 3 },
        },
        select: {
          billId: true,
          executiveOrderId: true,
        },
      });

      expect(mockDb.executiveOrder.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 5,
          where: expect.objectContaining({
            id: { notIn: ["eo-poisoned-1"] },
            fullText: { not: null },
            NOT: { fullText: "" },
            OR: [
              { summaries: { none: { summaryType: "STANDARD" } } },
              { categories: { none: {} } },
            ],
          }),
        })
      );

      expect(mockDb.bill.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 8,
          where: expect.objectContaining({
            id: { notIn: ["bill-poisoned-1"] },
            fullText: { not: null },
            NOT: { fullText: "" },
            OR: [
              { summaries: { none: { summaryType: "STANDARD" } } },
              { categories: { none: {} } },
            ],
          }),
        })
      );

      expect(batch.categories).toEqual(DYNAMIC_CATEGORIES);
      expect(batch.billCount).toBe(2);
      expect(batch.executiveOrderCount).toBe(2);
      expect(batch.items.map((i) => ({ id: i.id, kind: i.kind }))).toEqual([
        { id: "bill-1", kind: "bill" },
        { id: "bill-2", kind: "bill" },
        { id: "eo-1", kind: "executiveOrder" },
        { id: "eo-2", kind: "executiveOrder" },
      ]);
      expect(batch.items[0]).toMatchObject({
        id: "bill-1",
        hasStandardSummary: false,
        standardSummaryText: null,
        hasCategories: false,
      });
      expect(batch.items[1]).toMatchObject({
        id: "bill-2",
        hasStandardSummary: true,
        standardSummaryText: VALID_SUMMARY,
        hasCategories: false,
      });
      for (const selectedItem of batch.items) {
        expect("fullText" in selectedItem).toBe(false);
        expect(selectedItem.fullText).toBeUndefined();
      }
    });

    it("defaults LLM_MAX_ATTEMPTS to 5 and respects custom billBatchSize / eoBatchSize", async () => {
      mockDb.executiveOrder.findMany.mockResolvedValueOnce([]);
      mockDb.bill.findMany.mockResolvedValueOnce([]);

      await selectWorkBatchStep({ billBatchSize: 2, eoBatchSize: 3 });

      expect(mockDb.deadLetter.findMany).toHaveBeenCalledWith({
        where: {
          processed: false,
          attempts: { gte: 5 },
        },
        select: {
          billId: true,
          executiveOrderId: true,
        },
      });
      expect(mockDb.executiveOrder.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 3 })
      );
      expect(mockDb.bill.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 5 })
      );
    });
  });

  describe("processSummaryBatchStep", () => {
    it("creates STANDARD Summary with winning aiModel and connects up to 3 dynamic Category IDs, chunking by SUMMARIZE_BATCH_SIZE", async () => {
      const batch: SummarizeWorkBatch = {
        categories: DYNAMIC_CATEGORIES,
        billCount: 3,
        executiveOrderCount: 1,
        items: [
          {
            id: "bill-1",
            kind: "bill",
            title: "Water Infrastructure Act",
            fullText: "Bill 1 text ".repeat(20),
            hasStandardSummary: false,
            standardSummaryText: null,
            hasCategories: false,
          },
          {
            id: "bill-2",
            kind: "bill",
            title: "Hospital Modernization Act",
            fullText: "Bill 2 text ".repeat(20),
            hasStandardSummary: false,
            standardSummaryText: null,
            hasCategories: false,
          },
          {
            id: "bill-3",
            kind: "bill",
            title: "Already Tagged Bill",
            fullText: "Bill 3 text ".repeat(20),
            hasStandardSummary: false,
            standardSummaryText: null,
            hasCategories: true,
          },
          {
            id: "eo-1",
            kind: "executiveOrder",
            title: "EO Clean Resilience",
            fullText: "EO 1 text ".repeat(20),
            hasStandardSummary: false,
            standardSummaryText: null,
            hasCategories: false,
          },
        ],
      };

      mockSummarizeAndCategorizeItems
        .mockResolvedValueOnce([
          {
            id: "bill-1",
            ok: true,
            summary: VALID_SUMMARY,
            keyPoints: ["Funds rural municipal water upgrades."],
            impactAreas: ["Rural municipalities"],
            categories: [
              "infrastructure",
              "environment-climate",
              "healthcare",
              "defense-security",
            ],
            confidence: 0.92,
            aiModel: "deepseek/deepseek-v4.1-flash-1017",
          },
          {
            id: "bill-2",
            ok: true,
            summary: VALID_SUMMARY,
            keyPoints: ["Expands community hospital grants."],
            impactAreas: ["Hospitals"],
            categories: ["healthcare"],
            confidence: 0.89,
            aiModel: "xiaomi/mimo-v2.6-flash",
          },
          {
            id: "bill-3",
            ok: true,
            summary: VALID_SUMMARY,
            keyPoints: ["Supports defense cyber readiness."],
            impactAreas: ["Federal defense agencies"],
            categories: ["defense-security"],
            confidence: 0.85,
            aiModel: "deepseek/deepseek-v4.1-flash-1017",
          },
        ])
        .mockResolvedValueOnce([
          {
            id: "eo-1",
            ok: true,
            summary: VALID_SUMMARY,
            keyPoints: ["Directs federal climate resilience standards."],
            impactAreas: ["Federal agencies"],
            categories: ["environment-climate", "infrastructure"],
            confidence: 0.91,
            aiModel: "gemini-3.8-flash",
          },
        ]);

      const outcome = await processSummaryBatchStep(batch);

      // Default SUMMARIZE_BATCH_SIZE = 3 -> chunk of 3 + chunk of 1
      expect(mockSummarizeAndCategorizeItems).toHaveBeenCalledTimes(2);
      expect(mockSummarizeAndCategorizeItems.mock.calls[0][0]).toHaveLength(3);
      expect(mockSummarizeAndCategorizeItems.mock.calls[1][0]).toHaveLength(1);
      expect(mockCategorizeLegislationItem).not.toHaveBeenCalled();

      expect(mockDb.summary.create).toHaveBeenCalledTimes(4);
      expect(mockDb.summary.create).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          data: expect.objectContaining({
            billId: "bill-1",
            executiveOrderId: null,
            summaryType: "STANDARD",
            content: VALID_SUMMARY,
            keyPoints: ["Funds rural municipal water upgrades."],
            impactAreas: ["Rural municipalities"],
            aiModel: "deepseek/deepseek-v4.1-flash-1017",
            confidence: 0.92,
          }),
        })
      );
      expect(mockDb.summary.create).toHaveBeenNthCalledWith(
        4,
        expect.objectContaining({
          data: expect.objectContaining({
            billId: null,
            executiveOrderId: "eo-1",
            summaryType: "STANDARD",
            aiModel: "gemini-3.8-flash",
          }),
        })
      );

      // Bill-1 had 4 returned categories -> capped at 3 connected dynamic IDs
      expect(mockDb.bill.update).toHaveBeenCalledTimes(2);
      expect(mockDb.bill.update).toHaveBeenNthCalledWith(1, {
        where: { id: "bill-1" },
        data: {
          categories: {
            connect: [
              { id: "dyn-cat-infra" },
              { id: "dyn-cat-env" },
              { id: "dyn-cat-health" },
            ],
          },
        },
      });
      expect(mockDb.bill.update).toHaveBeenNthCalledWith(2, {
        where: { id: "bill-2" },
        data: {
          categories: {
            connect: [{ id: "dyn-cat-health" }],
          },
        },
      });
      expect(mockDb.executiveOrder.update).toHaveBeenCalledWith({
        where: { id: "eo-1" },
        data: {
          categories: {
            connect: [{ id: "dyn-cat-env" }, { id: "dyn-cat-infra" }],
          },
        },
      });

      expect(outcome).toEqual({
        attempted: 4,
        persisted: 4,
        summarized: 4,
        categorized: 3,
        failed: 0,
        deadLettered: 0,
        errors: [],
      });
    });

    it("categorizes items that already have a STANDARD summary via categorizeLegislationItem without duplicating Summary rows", async () => {
      const batch: SummarizeWorkBatch = {
        categories: DYNAMIC_CATEGORIES,
        billCount: 1,
        executiveOrderCount: 1,
        items: [
          {
            id: "bill-has-sum",
            kind: "bill",
            title: "Rural Water Systems Act",
            fullText: "Full bill text ".repeat(20),
            hasStandardSummary: true,
            standardSummaryText: VALID_SUMMARY,
            hasCategories: false,
          },
          {
            id: "eo-has-sum",
            kind: "executiveOrder",
            title: "EO Defense Logistics",
            fullText: "Full EO text ".repeat(20),
            hasStandardSummary: true,
            standardSummaryText: VALID_SUMMARY,
            hasCategories: false,
          },
        ],
      };

      mockCategorizeLegislationItem
        .mockResolvedValueOnce({
          categories: ["infrastructure", "environment-climate"],
          aiModel: "deepseek/deepseek-v4.1-flash-1017",
        })
        .mockResolvedValueOnce({
          categories: ["defense-security"],
          aiModel: "xiaomi/mimo-v2.6-flash",
        });

      const outcome = await processSummaryBatchStep(batch);

      expect(mockSummarizeAndCategorizeItems).not.toHaveBeenCalled();
      expect(mockCategorizeLegislationItem).toHaveBeenCalledTimes(2);
      expect(mockCategorizeLegislationItem).toHaveBeenNthCalledWith(1, {
        title: "Rural Water Systems Act",
        summary: VALID_SUMMARY,
        categories: DYNAMIC_CATEGORIES,
      });
      expect(mockDb.summary.create).not.toHaveBeenCalled();

      expect(mockDb.bill.update).toHaveBeenCalledWith({
        where: { id: "bill-has-sum" },
        data: {
          categories: {
            connect: [{ id: "dyn-cat-infra" }, { id: "dyn-cat-env" }],
          },
        },
      });
      expect(mockDb.executiveOrder.update).toHaveBeenCalledWith({
        where: { id: "eo-has-sum" },
        data: {
          categories: {
            connect: [{ id: "dyn-cat-def" }],
          },
        },
      });

      expect(outcome).toEqual({
        attempted: 2,
        persisted: 2,
        summarized: 0,
        categorized: 2,
        failed: 0,
        deadLettered: 0,
        errors: [],
      });
    });

    it("skips duplicate Summary creation if a prior retry attempt already wrote a STANDARD Summary", async () => {
      mockDb.summary.findFirst.mockResolvedValueOnce({
        id: "existing-sum-1",
        content: VALID_SUMMARY,
      });

      const batch: SummarizeWorkBatch = {
        categories: DYNAMIC_CATEGORIES,
        billCount: 1,
        executiveOrderCount: 0,
        items: [
          {
            id: "bill-retry-1",
            kind: "bill",
            title: "Retry Safe Bill",
            fullText: "Full bill text ".repeat(20),
            hasStandardSummary: false,
            standardSummaryText: null,
            hasCategories: false,
          },
        ],
      };

      mockCategorizeLegislationItem.mockResolvedValueOnce({
        categories: ["healthcare"],
        aiModel: "deepseek/deepseek-v4.1-flash-1017",
      });

      const outcome = await processSummaryBatchStep(batch);

      expect(mockSummarizeAndCategorizeItems).not.toHaveBeenCalled();
      expect(mockDb.summary.create).not.toHaveBeenCalled();
      expect(mockCategorizeLegislationItem).toHaveBeenCalledTimes(1);
      expect(mockDb.bill.update).toHaveBeenCalledWith({
        where: { id: "bill-retry-1" },
        data: { categories: { connect: [{ id: "dyn-cat-health" }] } },
      });
      expect(outcome).toMatchObject({
        persisted: 1,
        summarized: 0,
        categorized: 1,
        failed: 0,
      });
    });

    it("throws RetryableError (retryAfter: '30m') on FallbackCapReachedError without creating or updating DeadLetter", async () => {
      const batch: SummarizeWorkBatch = {
        categories: DYNAMIC_CATEGORIES,
        billCount: 1,
        executiveOrderCount: 0,
        items: [
          {
            id: "bill-cap-1",
            kind: "bill",
            title: "Cap Test Bill",
            fullText: "Full bill text ".repeat(20),
            hasStandardSummary: false,
            standardSummaryText: null,
            hasCategories: false,
          },
        ],
      };

      mockSummarizeAndCategorizeItems.mockRejectedValueOnce(
        new FallbackCapReachedError("Gemini daily cap reached", {
          reason: "daily-cap-reached",
          used: 20,
          limit: 20,
        })
      );

      let caught: unknown;
      try {
        await processSummaryBatchStep(batch);
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(RetryableError);
      expect(caught).toMatchObject({
        name: "RetryableError",
        retryAfter: "30m",
      });
      expect(mockDb.deadLetter.findFirst).not.toHaveBeenCalled();
      expect(mockDb.deadLetter.create).not.toHaveBeenCalled();
      expect(mockDb.deadLetter.update).not.toHaveBeenCalled();

      // Also verify FallbackCapReachedError from categorizeLegislationItem triggers RetryableError
      jest.clearAllMocks();
      const catOnlyBatch: SummarizeWorkBatch = {
        categories: DYNAMIC_CATEGORIES,
        billCount: 1,
        executiveOrderCount: 0,
        items: [
          {
            id: "bill-cap-2",
            kind: "bill",
            title: "Cap Test Categorize Bill",
            fullText: "Full bill text ".repeat(20),
            hasStandardSummary: true,
            standardSummaryText: VALID_SUMMARY,
            hasCategories: false,
          },
        ],
      };
      mockCategorizeLegislationItem.mockRejectedValueOnce(
        new FallbackCapReachedError("Gemini daily cap reached")
      );

      let catCaught: unknown;
      try {
        await processSummaryBatchStep(catOnlyBatch);
      } catch (err) {
        catCaught = err;
      }

      expect(catCaught).toBeInstanceOf(RetryableError);
      expect(catCaught).toMatchObject({
        name: "RetryableError",
        retryAfter: "30m",
      });
      expect(mockDb.deadLetter.create).not.toHaveBeenCalled();
      expect(mockDb.deadLetter.update).not.toHaveBeenCalled();
    });

    it("records/increments DeadLetter via findFirst + create/update on item validation/parse failure without crashing siblings", async () => {
      // Scenario A: Siblings bill-ok-1 & bill-ok-3 persist while bill-bad-2 fails Zod summary length (<20 words) and creates DeadLetter
      const batchA: SummarizeWorkBatch = {
        categories: DYNAMIC_CATEGORIES,
        billCount: 3,
        executiveOrderCount: 0,
        items: [
          {
            id: "bill-ok-1",
            kind: "bill",
            title: "Valid Sibling 1",
            fullText: "Full text 1 ".repeat(20),
            hasStandardSummary: false,
            standardSummaryText: null,
            hasCategories: false,
          },
          {
            id: "bill-bad-2",
            kind: "bill",
            title: "Malformed Item 2",
            fullText: "Full text 2 ".repeat(20),
            hasStandardSummary: false,
            standardSummaryText: null,
            hasCategories: false,
          },
          {
            id: "bill-ok-3",
            kind: "bill",
            title: "Valid Sibling 3",
            fullText: "Full text 3 ".repeat(20),
            hasStandardSummary: false,
            standardSummaryText: null,
            hasCategories: false,
          },
        ],
      };

      mockSummarizeAndCategorizeItems.mockResolvedValueOnce([
        {
          id: "bill-ok-1",
          ok: true,
          summary: VALID_SUMMARY,
          keyPoints: ["Sibling 1 point."],
          impactAreas: ["States"],
          categories: ["infrastructure"],
          confidence: 0.9,
          aiModel: "deepseek/deepseek-v4.1-flash-1017",
        },
        {
          id: "bill-bad-2",
          ok: true,
          summary: "Too short invalid summary.",
          keyPoints: [],
          impactAreas: [],
          categories: ["healthcare"],
          confidence: 0.4,
          aiModel: "xiaomi/mimo-v2.6-flash",
        },
        {
          id: "bill-ok-3",
          ok: true,
          summary: VALID_SUMMARY,
          keyPoints: ["Sibling 3 point."],
          impactAreas: ["Clinics"],
          categories: ["healthcare"],
          confidence: 0.88,
          aiModel: "deepseek/deepseek-v4.1-flash-1017",
        },
      ]);

      const outcomeA = await processSummaryBatchStep(batchA);

      expect(outcomeA.persisted).toBe(2);
      expect(outcomeA.failed).toBe(1);
      expect(outcomeA.deadLettered).toBe(1);
      expect(outcomeA.errors).toHaveLength(1);
      expect(outcomeA.errors[0]).toMatchObject({
        id: "bill-bad-2",
        kind: "bill",
        deadLetterAttempts: 1,
      });

      expect(mockDb.summary.create).toHaveBeenCalledTimes(2);
      expect(mockDb.deadLetter.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { billId: "bill-bad-2", processed: false },
        })
      );
      expect(mockDb.deadLetter.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          billId: "bill-bad-2",
          executiveOrderId: null,
          attempts: 1,
          errorMessage: expect.stringContaining("20 words"),
          lastAttemptAt: expect.any(Date),
          processed: false,
        }),
      });

      // Scenario B: Existing unprocessed DeadLetter row on an EO increments attempts via update
      jest.clearAllMocks();
      mockDb.summary.findFirst.mockResolvedValue(null);
      mockDb.deadLetter.findFirst.mockResolvedValueOnce({
        id: "dl-eo-existing",
        attempts: 2,
      });

      const batchB: SummarizeWorkBatch = {
        categories: DYNAMIC_CATEGORIES,
        billCount: 0,
        executiveOrderCount: 1,
        items: [
          {
            id: "eo-bad-1",
            kind: "executiveOrder",
            title: "EO Parse Failure",
            fullText: "EO text ".repeat(20),
            hasStandardSummary: false,
            standardSummaryText: null,
            hasCategories: false,
          },
        ],
      };

      mockSummarizeAndCategorizeItems.mockResolvedValueOnce([
        {
          id: "eo-bad-1",
          ok: false,
          error: "OpenRouter and Gemini returned malformed JSON",
        },
      ]);

      const outcomeB = await processSummaryBatchStep(batchB);

      expect(outcomeB.failed).toBe(1);
      expect(outcomeB.deadLettered).toBe(1);
      expect(outcomeB.errors[0]).toMatchObject({
        id: "eo-bad-1",
        kind: "executiveOrder",
        deadLetterAttempts: 3,
      });
      expect(mockDb.deadLetter.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { executiveOrderId: "eo-bad-1", processed: false },
        })
      );
      expect(mockDb.deadLetter.update).toHaveBeenCalledWith({
        where: { id: "dl-eo-existing" },
        data: expect.objectContaining({
          attempts: 3,
          errorMessage: "OpenRouter and Gemini returned malformed JSON",
          lastAttemptAt: expect.any(Date),
        }),
      });
      expect(mockDb.deadLetter.create).not.toHaveBeenCalled();
    });

    it("marks all unprocessed DeadLetter rows for an item as processed when recovery succeeds", async () => {
      mockDb.deadLetter.updateMany.mockResolvedValueOnce({ count: 2 });

      const batch: SummarizeWorkBatch = {
        categories: DYNAMIC_CATEGORIES,
        billCount: 1,
        executiveOrderCount: 0,
        items: [
          {
            id: "bill-recovered",
            kind: "bill",
            title: "Recovered Bill",
            fullText: "Recovered text ".repeat(20),
            hasStandardSummary: false,
            standardSummaryText: null,
            hasCategories: false,
          },
        ],
      };

      mockSummarizeAndCategorizeItems.mockResolvedValueOnce([
        {
          id: "bill-recovered",
          ok: true,
          summary: VALID_SUMMARY,
          keyPoints: ["Recovered cleanly."],
          impactAreas: ["Public"],
          categories: ["infrastructure"],
          confidence: 0.9,
          aiModel: "deepseek/deepseek-v4.1-flash-1017",
        },
      ]);

      const outcome = await processSummaryBatchStep(batch);

      expect(outcome.persisted).toBe(1);
      expect(mockDb.deadLetter.updateMany).toHaveBeenCalledWith({
        where: { billId: "bill-recovered", processed: false },
        data: {
          processed: true,
          processedAt: expect.any(Date),
        },
      });
    });

    it("isolates batch-level non-cap rejections per item and isolates categories-only validation failures to DeadLetter", async () => {
      process.env.SUMMARIZE_BATCH_SIZE = "2";

      const batch: SummarizeWorkBatch = {
        categories: DYNAMIC_CATEGORIES,
        billCount: 3,
        executiveOrderCount: 1,
        items: [
          {
            id: "bill-iso-1",
            kind: "bill",
            title: "Iso Sibling 1",
            fullText: "Text 1 ".repeat(20),
            hasStandardSummary: false,
            standardSummaryText: null,
            hasCategories: false,
          },
          {
            id: "bill-iso-2",
            kind: "bill",
            title: "Iso Failing 2",
            fullText: "Text 2 ".repeat(20),
            hasStandardSummary: false,
            standardSummaryText: null,
            hasCategories: false,
          },
          {
            id: "bill-cat-bad",
            kind: "bill",
            title: "Categories Only Failing",
            fullText: "Text 3 ".repeat(20),
            hasStandardSummary: true,
            standardSummaryText: VALID_SUMMARY,
            hasCategories: false,
          },
          {
            id: "eo-cat-good",
            kind: "executiveOrder",
            title: "Categories Only Sibling",
            fullText: "Text 4 ".repeat(20),
            hasStandardSummary: true,
            standardSummaryText: VALID_SUMMARY,
            hasCategories: false,
          },
        ],
      };

      // Chunk of 2 throws non-cap error -> isolates into 2 single-item calls
      mockSummarizeAndCategorizeItems
        .mockRejectedValueOnce(new Error("Unexpected batch JSON structure"))
        .mockResolvedValueOnce([
          {
            id: "bill-iso-1",
            ok: true,
            summary: VALID_SUMMARY,
            keyPoints: ["Recovered singly."],
            impactAreas: ["Public"],
            categories: ["infrastructure"],
            confidence: 0.9,
            aiModel: "deepseek/deepseek-v4.1-flash-1017",
          },
        ])
        .mockRejectedValueOnce(new Error("Permanent item schema error"));

      // First categorizeOnly returns 0 valid slugs -> DeadLetter; second succeeds
      mockCategorizeLegislationItem
        .mockResolvedValueOnce({
          categories: ["nonexistent-slug"],
          aiModel: "deepseek/deepseek-v4.1-flash-1017",
        })
        .mockResolvedValueOnce({
          categories: ["defense-security"],
          aiModel: "deepseek/deepseek-v4.1-flash-1017",
        });

      const outcome = await processSummaryBatchStep(batch);

      expect(outcome.persisted).toBe(2);
      expect(outcome.summarized).toBe(1);
      expect(outcome.categorized).toBe(2);
      expect(outcome.failed).toBe(2);
      expect(outcome.deadLettered).toBe(2);
      expect(mockDb.deadLetter.create).toHaveBeenCalledTimes(2);
      expect(mockDb.executiveOrder.update).toHaveBeenCalledWith({
        where: { id: "eo-cat-good" },
        data: { categories: { connect: [{ id: "dyn-cat-def" }] } },
      });
    });

    it("detects live DB categories on retry when both Summary and categories already exist, skips LLM/DB writes, marks DeadLetter processed, and preserves persisted count", async () => {
      // Bill started with stale snapshot { hasStandardSummary: false, hasCategories: false }
      // and EO started with { hasStandardSummary: true, hasCategories: false },
      // both already persisted during Attempt 1 before a later RetryableError.
      mockDb.summary.findFirst.mockResolvedValueOnce({
        id: "existing-sum-retry",
        content: VALID_SUMMARY,
      });
      mockDb.bill.count.mockResolvedValueOnce(2);
      mockDb.executiveOrder.count.mockResolvedValueOnce(1);
      mockDb.deadLetter.updateMany
        .mockResolvedValueOnce({ count: 1 })
        .mockResolvedValueOnce({ count: 1 });

      const batch: SummarizeWorkBatch = {
        categories: DYNAMIC_CATEGORIES,
        billCount: 1,
        executiveOrderCount: 1,
        items: [
          {
            id: "bill-retry-both",
            kind: "bill",
            title: "Already Persisted Both Bill",
            fullText: "Full bill text ".repeat(20),
            hasStandardSummary: false,
            standardSummaryText: null,
            hasCategories: false,
          },
          {
            id: "eo-retry-cats",
            kind: "executiveOrder",
            title: "Already Persisted Categories EO",
            fullText: "Full EO text ".repeat(20),
            hasStandardSummary: true,
            standardSummaryText: VALID_SUMMARY,
            hasCategories: false,
          },
        ],
      };

      const outcome = await processSummaryBatchStep(batch);

      expect(mockSummarizeAndCategorizeItems).not.toHaveBeenCalled();
      expect(mockCategorizeLegislationItem).not.toHaveBeenCalled();
      expect(mockDb.summary.create).not.toHaveBeenCalled();
      expect(mockDb.bill.update).not.toHaveBeenCalled();
      expect(mockDb.executiveOrder.update).not.toHaveBeenCalled();
      expect(mockDb.deadLetter.updateMany).toHaveBeenCalledTimes(2);
      expect(mockDb.deadLetter.updateMany).toHaveBeenNthCalledWith(1, {
        where: { billId: "bill-retry-both", processed: false },
        data: { processed: true, processedAt: expect.any(Date) },
      });
      expect(mockDb.deadLetter.updateMany).toHaveBeenNthCalledWith(2, {
        where: { executiveOrderId: "eo-retry-cats", processed: false },
        data: { processed: true, processedAt: expect.any(Date) },
      });
      expect(outcome).toEqual({
        attempted: 2,
        persisted: 2,
        summarized: 0,
        categorized: 0,
        failed: 0,
        deadLettered: 0,
        errors: [],
      });
    });

    it("isolates DeadLetter cleanup errors after persistence so persisted items are never double-counted as failed", async () => {
      mockDb.deadLetter.updateMany
        .mockRejectedValueOnce(new Error("DeadLetter row lock timeout"))
        .mockRejectedValueOnce(new Error("DeadLetter row lock timeout"));

      const batch: SummarizeWorkBatch = {
        categories: DYNAMIC_CATEGORIES,
        billCount: 2,
        executiveOrderCount: 0,
        items: [
          {
            id: "bill-dl-cleanup-1",
            kind: "bill",
            title: "Combined Cleanup Error Bill",
            fullText: "Bill text ".repeat(20),
            hasStandardSummary: false,
            standardSummaryText: null,
            hasCategories: false,
          },
          {
            id: "bill-dl-cleanup-2",
            kind: "bill",
            title: "Categories Cleanup Error Bill",
            fullText: "Bill text ".repeat(20),
            hasStandardSummary: true,
            standardSummaryText: VALID_SUMMARY,
            hasCategories: false,
          },
        ],
      };

      mockSummarizeAndCategorizeItems.mockResolvedValueOnce([
        {
          id: "bill-dl-cleanup-1",
          ok: true,
          summary: VALID_SUMMARY,
          keyPoints: ["Modernizes municipal pipes."],
          impactAreas: ["Cities"],
          categories: ["infrastructure"],
          confidence: 0.9,
          aiModel: "deepseek/deepseek-v4.1-flash-1017",
        },
      ]);
      mockCategorizeLegislationItem.mockResolvedValueOnce({
        categories: ["healthcare"],
        aiModel: "deepseek/deepseek-v4.1-flash-1017",
      });

      const outcome = await processSummaryBatchStep(batch);

      expect(outcome).toEqual({
        attempted: 2,
        persisted: 2,
        summarized: 1,
        categorized: 2,
        failed: 0,
        deadLettered: 0,
        errors: [],
      });
      expect(mockDb.deadLetter.create).not.toHaveBeenCalled();
    });

    it("scopes summary.create and category updates to the tx client inside $transaction and keeps counters consistent on partial failure", async () => {
      const mockTx = {
        summary: { create: jest.fn() },
        bill: { update: jest.fn() },
        executiveOrder: { update: jest.fn() },
      };

      mockDb.$transaction.mockImplementation(
        async (callback: (tx: typeof mockTx) => Promise<unknown>) =>
          callback(mockTx)
      );

      mockTx.summary.create
        .mockResolvedValueOnce({ id: "sum-tx-committed" })
        .mockResolvedValueOnce({ id: "sum-tx-rollback" });
      mockTx.bill.update
        .mockResolvedValueOnce({ id: "bill-tx-ok" })
        .mockRejectedValueOnce(new Error("Category relation constraint error"));

      const batch: SummarizeWorkBatch = {
        categories: DYNAMIC_CATEGORIES,
        billCount: 2,
        executiveOrderCount: 0,
        items: [
          {
            id: "bill-tx-ok",
            kind: "bill",
            title: "Transaction Scoped Success Bill",
            fullText: "Bill text ok ".repeat(20),
            hasStandardSummary: false,
            standardSummaryText: null,
            hasCategories: false,
          },
          {
            id: "bill-tx-partial-fail",
            kind: "bill",
            title: "Partial Persistence Failure Bill",
            fullText: "Bill text fail ".repeat(20),
            hasStandardSummary: false,
            standardSummaryText: null,
            hasCategories: false,
          },
        ],
      };

      mockSummarizeAndCategorizeItems.mockResolvedValueOnce([
        {
          id: "bill-tx-ok",
          ok: true,
          summary: VALID_SUMMARY,
          keyPoints: ["Commits cleanly on tx."],
          impactAreas: ["Cities"],
          categories: ["infrastructure"],
          confidence: 0.91,
          aiModel: "deepseek/deepseek-v4.1-flash-1017",
        },
        {
          id: "bill-tx-partial-fail",
          ok: true,
          summary: VALID_SUMMARY,
          keyPoints: ["Expands water infrastructure grants."],
          impactAreas: ["Towns"],
          categories: ["infrastructure"],
          confidence: 0.9,
          aiModel: "deepseek/deepseek-v4.1-flash-1017",
        },
      ]);

      const outcome = await processSummaryBatchStep(batch);

      expect(mockDb.$transaction).toHaveBeenCalledTimes(2);
      expect(mockTx.summary.create).toHaveBeenCalledTimes(2);
      expect(mockTx.bill.update).toHaveBeenCalledTimes(2);
      expect(mockDb.summary.create).not.toHaveBeenCalled();
      expect(mockDb.bill.update).not.toHaveBeenCalled();

      expect(outcome).toEqual({
        attempted: 2,
        persisted: 1,
        summarized: 1,
        categorized: 1,
        failed: 1,
        deadLettered: 1,
        errors: [
          {
            id: "bill-tx-partial-fail",
            kind: "bill",
            error: "Category relation constraint error",
            deadLetterAttempts: 1,
          },
        ],
      });
      expect(mockDb.deadLetter.create).toHaveBeenCalledTimes(1);
      expect(mockDb.deadLetter.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          billId: "bill-tx-partial-fail",
          attempts: 1,
          errorMessage: "Category relation constraint error",
          processed: false,
        }),
      });
    });

    it("acquires per-item advisory lock and skips duplicate Summary/category writes inside $transaction when a concurrent worker already persisted them", async () => {
      const mockTx = {
        $executeRaw: jest.fn().mockResolvedValue(1),
        summary: {
          findFirst: jest.fn().mockResolvedValueOnce({ id: "sum-concurrent" }),
          create: jest.fn(),
        },
        category: {
          count: jest.fn().mockResolvedValueOnce(3),
        },
        bill: {
          update: jest.fn(),
        },
        executiveOrder: {
          update: jest.fn(),
        },
      };

      mockDb.$transaction.mockImplementationOnce(
        async (callback: (tx: typeof mockTx) => Promise<unknown>) =>
          callback(mockTx)
      );

      const batch: SummarizeWorkBatch = {
        categories: DYNAMIC_CATEGORIES,
        billCount: 1,
        executiveOrderCount: 0,
        items: [
          {
            id: "bill-race-1",
            kind: "bill",
            title: "Concurrent Race Bill",
            fullText: "Bill text ".repeat(20),
            hasStandardSummary: false,
            standardSummaryText: null,
            hasCategories: false,
          },
        ],
      };

      mockSummarizeAndCategorizeItems.mockResolvedValueOnce([
        {
          id: "bill-race-1",
          ok: true,
          summary: VALID_SUMMARY,
          keyPoints: ["Concurrent point."],
          impactAreas: ["Public"],
          categories: ["infrastructure", "healthcare"],
          confidence: 0.9,
          aiModel: "deepseek/deepseek-v4.1-flash-1017",
        },
      ]);

      const outcome = await processSummaryBatchStep(batch);

      expect(mockTx.$executeRaw).toHaveBeenCalledTimes(1);
      const lockSql = (
        mockTx.$executeRaw.mock.calls[0][0] as TemplateStringsArray
      ).join("");
      expect(lockSql).toContain("pg_advisory_xact_lock");
      expect(mockTx.summary.findFirst).toHaveBeenCalledWith({
        where: { billId: "bill-race-1", summaryType: "STANDARD" },
        select: { id: true },
      });
      expect(mockTx.category.count).toHaveBeenCalledWith({
        where: { bills: { some: { id: "bill-race-1" } } },
      });
      expect(mockTx.summary.create).not.toHaveBeenCalled();
      expect(mockTx.bill.update).not.toHaveBeenCalled();
      expect(outcome).toEqual({
        attempted: 1,
        persisted: 1,
        summarized: 0,
        categorized: 0,
        failed: 0,
        deadLettered: 0,
        errors: [],
      });
    });

    it("loads bounded fullText from DB inside processSummaryBatchStep only for needsSummaryItems lacking inline fullText", async () => {
      mockDb.bill.findMany.mockResolvedValueOnce([
        {
          id: "bill-db-load-1",
          fullText: "Loaded bill text from DB ".repeat(20),
        },
      ]);

      const batch: SummarizeWorkBatch = {
        categories: DYNAMIC_CATEGORIES,
        billCount: 2,
        executiveOrderCount: 0,
        items: [
          {
            id: "bill-db-load-1",
            kind: "bill",
            title: "Needs Summary Without Serialized Text",
            hasStandardSummary: false,
            standardSummaryText: null,
            hasCategories: false,
          },
          {
            id: "bill-cat-only-no-text",
            kind: "bill",
            title: "Already Summarized No Text Needed",
            hasStandardSummary: true,
            standardSummaryText: VALID_SUMMARY,
            hasCategories: false,
          },
        ],
      };

      mockSummarizeAndCategorizeItems.mockResolvedValueOnce([
        {
          id: "bill-db-load-1",
          ok: true,
          summary: VALID_SUMMARY,
          keyPoints: ["Loaded text cleanly."],
          impactAreas: ["Public"],
          categories: ["infrastructure"],
          confidence: 0.91,
          aiModel: "deepseek/deepseek-v4.1-flash-1017",
        },
      ]);
      mockCategorizeLegislationItem.mockResolvedValueOnce({
        categories: ["healthcare"],
        aiModel: "deepseek/deepseek-v4.1-flash-1017",
      });

      const outcome = await processSummaryBatchStep(batch);

      expect(mockDb.bill.findMany).toHaveBeenCalledTimes(1);
      expect(mockDb.bill.findMany).toHaveBeenCalledWith({
        where: { id: { in: ["bill-db-load-1"] } },
        select: { id: true, fullText: true },
      });
      expect(mockDb.executiveOrder.findMany).not.toHaveBeenCalled();
      expect(mockSummarizeAndCategorizeItems).toHaveBeenCalledWith(
        [
          {
            id: "bill-db-load-1",
            title: "Needs Summary Without Serialized Text",
            text: "Loaded bill text from DB ".repeat(20),
            kind: "bill",
          },
        ],
        DYNAMIC_CATEGORIES
      );
      expect(outcome).toMatchObject({
        attempted: 2,
        persisted: 2,
        summarized: 1,
        categorized: 2,
        failed: 0,
      });

      // Also verify oversized DB fullText (> 400k default Gemini cap) is bounded cleanly
      jest.clearAllMocks();
      process.env.OPENROUTER_MAX_INPUT_CHARS = "300";
      process.env.GEMINI_MAX_INPUT_CHARS = "500";
      mockDb.bill.findMany.mockResolvedValueOnce([
        {
          id: "bill-db-huge",
          fullText: "Z".repeat(2_000),
        },
      ]);
      mockSummarizeAndCategorizeItems.mockResolvedValueOnce([
        {
          id: "bill-db-huge",
          ok: true,
          summary: VALID_SUMMARY,
          keyPoints: ["Bounded DB fullText."],
          impactAreas: ["Public"],
          categories: ["infrastructure"],
          confidence: 0.9,
          aiModel: "deepseek/deepseek-v4.1-flash-1017",
        },
      ]);

      const hugeOutcome = await processSummaryBatchStep({
        categories: DYNAMIC_CATEGORIES,
        billCount: 1,
        executiveOrderCount: 0,
        items: [
          {
            id: "bill-db-huge",
            kind: "bill",
            title: "Oversized DB FullText Bill",
            hasStandardSummary: false,
            standardSummaryText: null,
            hasCategories: false,
          },
        ],
      });

      expect(hugeOutcome.persisted).toBe(1);
      const passedInput = mockSummarizeAndCategorizeItems.mock.calls[0][0][0] as {
        text: string;
      };
      expect(passedInput.text.length).toBeLessThanOrEqual(500);
      expect(passedInput.text).toContain("truncated due to length");
    });
  });

  describe("job-runs steps & summarizeLegislationWorkflow orchestration", () => {
    it("enforces strict Workflow Sandbox isolation and directives across workflow and step files", () => {
      const rootDir = process.cwd();
      const workflowSource = fs.readFileSync(
        path.join(rootDir, "src/workflows/summarize-legislation.ts"),
        "utf8"
      );
      const jobRunsSource = fs.readFileSync(
        path.join(rootDir, "src/workflows/steps/job-runs.ts"),
        "utf8"
      );
      const summarizeStepsSource = fs.readFileSync(
        path.join(rootDir, "src/workflows/steps/summarize.ts"),
        "utf8"
      );

      expect(workflowSource).toContain('"use workflow"');
      expect(workflowSource).not.toContain("@/lib/db");
      expect(workflowSource).not.toContain("next/cache");
      expect(workflowSource).not.toContain("node:");
      expect(workflowSource).not.toContain("@google/genai");
      expect(workflowSource).not.toContain("openai");
      expect(workflowSource).not.toMatch(/\bsetTimeout\b|\bsetInterval\b|\bfetch\s*\(/);

      expect(jobRunsSource).toContain('"use step"');
      expect(summarizeStepsSource).toContain('"use step"');
    });

    it("supports jobRun lifecycle and path revalidation steps directly", async () => {
      mockDb.jobRun.create.mockResolvedValueOnce({ id: "jr-direct-1" });

      const jobRunId = await createJobRunStep("test-job", {
        executionId: "exec-99",
      });
      expect(jobRunId).toBe("jr-direct-1");
      expect(mockDb.jobRun.create).toHaveBeenCalledWith({
        data: {
          jobName: "test-job",
          status: "RUNNING",
          metadata: { executionId: "exec-99" },
        },
        select: { id: true },
      });

      await completeJobRunStep(jobRunId, {
        itemsProcessed: 4,
        itemsFailed: 1,
        metadata: { ok: true },
      });
      expect(mockDb.jobRun.update).toHaveBeenCalledWith({
        where: { id: "jr-direct-1" },
        data: {
          status: "COMPLETED",
          completedAt: expect.any(Date),
          itemsProcessed: 4,
          itemsFailed: 1,
          metadata: { ok: true },
        },
      });

      await failJobRunStep(jobRunId, "boom");
      expect(mockDb.jobRun.update).toHaveBeenLastCalledWith({
        where: { id: "jr-direct-1" },
        data: {
          status: "FAILED",
          completedAt: expect.any(Date),
          error: "boom",
        },
      });

      await revalidateLegislationPathsStep();
      expect(mockRevalidatePath).toHaveBeenCalledWith("/");
      expect(mockRevalidatePath).toHaveBeenCalledWith("/bills");
    });

    it("runs full summarizeLegislationWorkflow lifecycle and revalidates paths when persisted > 0", async () => {
      mockDb.jobRun.create.mockResolvedValueOnce({ id: "jr-wf-1" });
      mockDb.executiveOrder.findMany.mockResolvedValueOnce([]);
      mockDb.bill.findMany
        .mockResolvedValueOnce([
          {
            id: "bill-wf-1",
            billType: "hr",
            billNumber: 55,
            title: "Grid Modernization Act",
            shortTitle: null,
            fullText: "Full legislative text ".repeat(20),
            summaries: [],
            categories: [],
          },
        ])
        .mockResolvedValueOnce([
          {
            id: "bill-wf-1",
            fullText: "Full legislative text ".repeat(20),
          },
        ]);
      mockSummarizeAndCategorizeItems.mockResolvedValueOnce([
        {
          id: "bill-wf-1",
          ok: true,
          summary: VALID_SUMMARY,
          keyPoints: ["Modernizes electrical transmission."],
          impactAreas: ["Utilities"],
          categories: ["infrastructure"],
          confidence: 0.93,
          aiModel: "deepseek/deepseek-v4.1-flash-1017",
        },
      ]);

      const result = await summarizeLegislationWorkflow({
        executionId: "sched-exec-1",
      });

      expect(result).toEqual({
        jobRunId: "jr-wf-1",
        executionId: "sched-exec-1",
        selectedBills: 1,
        selectedExecutiveOrders: 0,
        attempted: 1,
        persisted: 1,
        summarized: 1,
        categorized: 1,
        failed: 0,
        deadLettered: 0,
        revalidated: true,
        errors: [],
      });
      expect(mockRevalidatePath).toHaveBeenCalledWith("/");
      expect(mockRevalidatePath).toHaveBeenCalledWith("/bills");
      expect(mockDb.jobRun.update).toHaveBeenCalledWith({
        where: { id: "jr-wf-1" },
        data: expect.objectContaining({
          status: "COMPLETED",
          itemsProcessed: 1,
          itemsFailed: 0,
          completedAt: expect.any(Date),
        }),
      });
    });

    it("skips overlapping summarizeLegislationWorkflow triggers when an active RUNNING lease exists without creating a competing JobRun or calling LLMs", async () => {
      mockDb.jobRun.findFirst.mockResolvedValueOnce({ id: "jr-active-lease" });

      const result = await summarizeLegislationWorkflow({
        executionId: "sched-overlap-1",
      });

      expect(mockDb.$executeRaw).toHaveBeenCalledTimes(1);
      const lockText = (
        mockDb.$executeRaw.mock.calls[0][0] as TemplateStringsArray
      ).join("");
      expect(lockText).toContain("pg_advisory_xact_lock(948272)");

      expect(mockDb.jobRun.updateMany).toHaveBeenCalledWith({
        where: {
          jobName: "summarize-legislation",
          status: "RUNNING",
          startedAt: { lte: expect.any(Date) },
        },
        data: expect.objectContaining({
          status: "FAILED",
          completedAt: expect.any(Date),
        }),
      });
      expect(mockDb.jobRun.findFirst).toHaveBeenCalledWith({
        where: {
          jobName: "summarize-legislation",
          status: "RUNNING",
          startedAt: { gt: expect.any(Date) },
        },
        orderBy: { startedAt: "desc" },
        select: { id: true },
      });

      expect(mockDb.jobRun.create).not.toHaveBeenCalled();
      expect(mockDb.jobRun.update).not.toHaveBeenCalled();
      expect(mockDb.category.findMany).not.toHaveBeenCalled();
      expect(mockSummarizeAndCategorizeItems).not.toHaveBeenCalled();
      expect(mockCategorizeLegislationItem).not.toHaveBeenCalled();
      expect(mockRevalidatePath).not.toHaveBeenCalled();
      expect(result).toEqual({
        jobRunId: "jr-active-lease",
        executionId: "sched-overlap-1",
        skipped: true,
        skippedReason: "active-run-in-progress",
        activeJobRunId: "jr-active-lease",
        selectedBills: 0,
        selectedExecutiveOrders: 0,
        attempted: 0,
        persisted: 0,
        summarized: 0,
        categorized: 0,
        failed: 0,
        deadLettered: 0,
        revalidated: false,
        errors: [],
      });
    });

    it("skips LLM calls and path revalidation when no work items are found", async () => {
      mockDb.jobRun.create.mockResolvedValueOnce({ id: "jr-empty-1" });
      mockDb.executiveOrder.findMany.mockResolvedValueOnce([]);
      mockDb.bill.findMany.mockResolvedValueOnce([]);

      const result = await summarizeLegislationWorkflow();

      expect(mockSummarizeAndCategorizeItems).not.toHaveBeenCalled();
      expect(mockCategorizeLegislationItem).not.toHaveBeenCalled();
      expect(mockRevalidatePath).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        jobRunId: "jr-empty-1",
        selectedBills: 0,
        selectedExecutiveOrders: 0,
        persisted: 0,
        revalidated: false,
      });
      expect(mockDb.jobRun.update).toHaveBeenCalledWith({
        where: { id: "jr-empty-1" },
        data: expect.objectContaining({
          status: "COMPLETED",
          itemsProcessed: 0,
          itemsFailed: 0,
        }),
      });
    });

    it("records JobRun FAILED and rethrows when a step errors out", async () => {
      mockDb.jobRun.create.mockResolvedValueOnce({ id: "jr-fail-1" });
      mockDb.executiveOrder.findMany.mockRejectedValueOnce(
        new Error("Database connection lost")
      );

      await expect(summarizeLegislationWorkflow()).rejects.toThrow(
        "Database connection lost"
      );

      expect(mockRevalidatePath).not.toHaveBeenCalled();
      expect(mockDb.jobRun.update).toHaveBeenCalledWith({
        where: { id: "jr-fail-1" },
        data: {
          status: "FAILED",
          completedAt: expect.any(Date),
          error: "Database connection lost",
        },
      });
    });
  });
});
