import {
  backfillMissingBillTexts,
  buildBillIdentifier,
  determineLookupWindow,
  persistHydratedBillPrisma,
  resolveBillStatus,
  type IngestionLogger,
} from "@/lib/ingestion/bills-service";
import {
  backfillMissingEoTexts,
  ensureOrderNumber,
  inferPresidentName,
  mapSubtypeToExecutiveOrderType,
  persistExecutiveOrderPrisma,
} from "@/lib/ingestion/executive-orders-service";
import type {
  CongressClient,
  HydratedBillData,
} from "@/lib/ingestion/congress-client";
import type {
  FederalRegisterDocument,
  HydratedExecutiveOrder,
} from "@/lib/ingestion/federal-register-client";
import * as federalRegisterClient from "@/lib/ingestion/federal-register-client";
import * as congressUrl from "@/lib/utils/congress-url";

jest.mock("@/lib/db", () => ({
  db: {
    $transaction: jest.fn(),
    bill: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    member: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
    action: {
      deleteMany: jest.fn(),
      createMany: jest.fn(),
    },
    amendment: {
      deleteMany: jest.fn(),
      createMany: jest.fn(),
    },
    executiveOrder: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  },
}));

jest.mock("@/lib/ingestion/federal-register-client", () => {
  const actual = jest.requireActual<
    typeof import("@/lib/ingestion/federal-register-client")
  >("@/lib/ingestion/federal-register-client");
  return {
    ...actual,
    fetchExecutiveOrderFullText: jest.fn(),
  };
});

interface MockDb {
  $transaction: jest.Mock;
  bill: {
    findUnique: jest.Mock;
    findMany: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
  };
  member: {
    findUnique: jest.Mock;
    upsert: jest.Mock;
  };
  action: {
    deleteMany: jest.Mock;
    createMany: jest.Mock;
  };
  amendment: {
    deleteMany: jest.Mock;
    createMany: jest.Mock;
  };
  executiveOrder: {
    findUnique: jest.Mock;
    findMany: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
  };
}

interface SpyLogger extends Required<IngestionLogger> {
  debug: jest.Mock;
  info: jest.Mock;
  warn: jest.Mock;
  error: jest.Mock;
}

const { db: mockDb } = jest.requireMock("@/lib/db") as { db: MockDb };
const mockFetchEoFullText =
  federalRegisterClient.fetchExecutiveOrderFullText as jest.Mock;

function createSpyLogger(): SpyLogger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
}

function createMockCongressClient(): CongressClient & {
  fetchMember: jest.Mock;
  fetchBillText: jest.Mock;
} {
  return {
    fetchMember: jest.fn(),
    fetchBillText: jest.fn(),
  } as unknown as CongressClient & {
    fetchMember: jest.Mock;
    fetchBillText: jest.Mock;
  };
}

describe("Ingestion Prisma persistence & text-backfill services", () => {
  let logger: SpyLogger;
  let mockClient: ReturnType<typeof createMockCongressClient>;

  beforeEach(() => {
    jest.clearAllMocks();
    logger = createSpyLogger();
    mockClient = createMockCongressClient();
    mockDb.$transaction.mockImplementation(
      async (callback: (tx: MockDb) => Promise<unknown>) => callback(mockDb)
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("determineLookupWindow & resolveBillStatus", () => {
    it("computes lookup windows, validates bounds, and resolves bill statuses across action texts", () => {
      const window = determineLookupWindow(
        7,
        undefined,
        "2026-03-15T12:00:00.000Z"
      );
      expect(window.to.toISOString()).toBe("2026-03-15T12:00:00.000Z");
      expect(window.from.toISOString()).toBe("2026-03-08T12:00:00.000Z");

      const minWindow = determineLookupWindow(
        0,
        undefined,
        "2026-03-15T12:00:00.000Z"
      );
      expect(minWindow.from.toISOString()).toBe("2026-03-14T12:00:00.000Z");

      expect(() => determineLookupWindow(1, "not-a-date")).toThrow(
        /Invalid start date/
      );
      expect(() =>
        determineLookupWindow(1, "2026-03-10T00:00:00Z", "bad-end")
      ).toThrow(/Invalid end date/);
      expect(() =>
        determineLookupWindow(1, "2026-03-12T00:00:00Z", "2026-03-10T00:00:00Z")
      ).toThrow(/cannot be after end date/);

      const fallbackDate = new Date("2026-01-01T00:00:00.000Z");
      expect(
        resolveBillStatus(
          {
            latestAction: {
              actionDate: "2026-02-10",
              text: "Became Public Law No: 119-12.",
            },
          },
          [],
          fallbackDate
        )
      ).toEqual({
        status: "BECAME_LAW",
        statusDate: new Date("2026-02-10"),
      });

      expect(
        resolveBillStatus(
          {},
          [{ actionDate: "2026-02-05", text: "Passed Senate without amendment." }],
          fallbackDate
        )
      ).toEqual({
        status: "PASSED_SENATE",
        statusDate: new Date("2026-02-05"),
      });

      expect(
        resolveBillStatus(
          { latestAction: { text: "Message on Senate action sent to conference." } },
          [],
          fallbackDate
        )
      ).toEqual({
        status: "RESOLVING_DIFFERENCES",
        statusDate: fallbackDate,
      });

      expect(
        resolveBillStatus(
          { latestAction: { text: "Referred to the Committee on Judiciary." } },
          [],
          fallbackDate
        ).status
      ).toBe("REFERRED_TO_COMMITTEE");

      expect(
        resolveBillStatus({}, [], fallbackDate)
      ).toEqual({
        status: "INTRODUCED",
        statusDate: fallbackDate,
      });

      expect(
        buildBillIdentifier({ congress: 119, type: "hr", number: "42" })
      ).toBe("119-HR-42");
    });
  });

  describe("persistHydratedBillPrisma", () => {
    it("preserves existing non-empty fullText, fullTextUrl, officialTitle, shortTitle, lawNumber, sponsorId, and sourceUrl when incoming data has null/empty values", async () => {
      jest.spyOn(congressUrl, "getCongressGovBillUrl").mockReturnValueOnce("");

      mockDb.bill.findUnique.mockResolvedValueOnce({
        id: "bill-existing-1",
        title: "Existing Primary Title",
        officialTitle: "Existing Official Title",
        shortTitle: "Existing Short Title",
        lawNumber: "119-5",
        fullText: "Existing comprehensive legislative text.",
        fullTextUrl: "https://www.congress.gov/119/bills/hr101/existing.htm",
        sponsorId: "member-existing-sponsor",
        sourceUrl: "https://www.congress.gov/bill/119th-congress/house-bill/101",
      });

      mockDb.bill.update.mockResolvedValueOnce({ id: "bill-existing-1" });
      mockDb.action.deleteMany.mockResolvedValueOnce({ count: 0 });
      mockDb.amendment.deleteMany.mockResolvedValueOnce({ count: 0 });

      const incoming: HydratedBillData = {
        bill: {
          congress: 119,
          type: "HR",
          number: "101",
          title: "",
          shortTitle: "",
          introducedDate: "2026-01-15",
          latestAction: {
            actionDate: "2026-02-20",
            text: "Passed House by voice vote.",
          },
          laws: [],
          sponsor: null,
          sponsors: [],
        },
        text: {
          content: null,
          url: "",
        },
        actions: [],
        amendments: [],
        cosponsors: [],
      };

      const result = await persistHydratedBillPrisma(incoming, mockClient, {
        logger,
      });

      expect(result).toEqual({
        action: "updated",
        billId: "bill-existing-1",
        identifier: "119-HR-101",
      });

      expect(mockDb.bill.update).toHaveBeenCalledTimes(1);
      const updateCall = mockDb.bill.update.mock.calls[0][0] as {
        where: { id: string };
        data: Record<string, unknown>;
      };
      expect(updateCall.where).toEqual({ id: "bill-existing-1" });
      expect(updateCall.data).toMatchObject({
        billType: "hr",
        billNumber: 101,
        congress: 119,
        title: "Existing Primary Title",
        officialTitle: "Existing Official Title",
        shortTitle: "Existing Short Title",
        lawNumber: "119-5",
        fullText: "Existing comprehensive legislative text.",
        fullTextUrl: "https://www.congress.gov/119/bills/hr101/existing.htm",
        sponsorId: "member-existing-sponsor",
        sourceUrl: "https://www.congress.gov/bill/119th-congress/house-bill/101",
        currentStatus: "PASSED_HOUSE",
        cosponsors: { set: [] },
      });
    });

    it("upserts sponsor & cosponsors by bioguideId, connects/sets cosponsors, and replaces Action and Amendment rows cleanly", async () => {
      // Scenario A: Create new bill with new sponsor + 1 existing cosponsor + 1 new cosponsor + 1 unresolvable cosponsor
      mockDb.bill.findUnique.mockResolvedValueOnce(null);

      // Sponsor S001 is new; Cosponsor C001 exists; Cosponsor C002 is new; Cosponsor C999 lacks chamber/state
      mockDb.member.findUnique
        .mockResolvedValueOnce(null) // S001
        .mockResolvedValueOnce({ id: "member-c001" }) // C001
        .mockResolvedValueOnce(null) // C002
        .mockResolvedValueOnce(null); // C999

      mockClient.fetchMember
        .mockResolvedValueOnce({
          member: {
            bioguideId: "S001",
            firstName: "Alice",
            lastName: "Sponsor",
            officialName: "Alice Sponsor",
            party: "D",
            state: "CA",
            district: "12",
            chamber: { code: "H", name: "House of Representatives" },
            terms: [{ startYear: 2025, endYear: 2027 }],
            depiction: { url: "https://example.test/s001.jpg" },
            officialWebsiteUrl: "https://sponsor.house.gov",
          },
        })
        .mockResolvedValueOnce({
          member: {
            bioguideId: "C002",
            firstName: "Bob",
            lastName: "Cosponsor",
            officialName: "Bob Cosponsor",
            party: "R",
            state: "TX",
            chamber: { code: "H", name: "House of Representatives" },
            terms: [{ startYear: 2025 }],
          },
        })
        .mockResolvedValueOnce(null); // C999 cannot be resolved

      mockDb.member.upsert
        .mockResolvedValueOnce({ id: "member-s001" })
        .mockResolvedValueOnce({ id: "member-c002" });

      mockDb.bill.create.mockResolvedValueOnce({ id: "bill-new-1" });
      mockDb.action.deleteMany.mockResolvedValueOnce({ count: 0 });
      mockDb.action.createMany.mockResolvedValueOnce({ count: 2 });
      mockDb.amendment.deleteMany.mockResolvedValueOnce({ count: 0 });
      mockDb.amendment.createMany.mockResolvedValueOnce({ count: 1 });

      const hydratedNew: HydratedBillData = {
        bill: {
          congress: 119,
          billType: "HR",
          billNumber: "250",
          title: "Clean Grid Modernization Act",
          shortTitle: "Clean Grid Act",
          introducedDate: "2026-02-01",
          latestAction: {
            actionDate: "2026-02-15",
            text: "Became Public Law No: 119-20.",
          },
          laws: [{ type: "Public Law", number: "119-20" }],
          sponsor: { bioguideId: "S001" },
        },
        text: {
          content: "SECTION 1. CLEAN GRID.",
          url: "https://www.congress.gov/119/bills/hr250/text.htm",
        },
        actions: [
          {
            actionDate: "2026-02-15",
            actionCode: "36000",
            type: "President",
            sourceSystem: { code: 9, name: "Library of Congress" },
            text: "Became Public Law No: 119-20.",
          },
          {
            actionDate: "2026-02-01",
            sourceSystem: { code: "2", name: "House floor actions" },
            text: "Introduced in House",
          },
          {
            // Invalid/missing date should be skipped cleanly
            actionDate: undefined,
            text: "Undated note",
          },
        ],
        amendments: [
          {
            number: "10",
            type: "HAMDT",
            congress: 119,
            status: "Agreed to",
            statusDate: "2026-02-10",
            purpose: "Clarify grid grants",
            description: "Grid grant amendment",
            sponsor: { bioguideId: "S001" },
          },
          // Duplicate amendment should be deduplicated
          {
            number: "10",
            type: "HAMDT",
            congress: 119,
            status: "Agreed to",
            statusDate: "2026-02-10",
          },
        ],
        cosponsors: [
          { bioguideId: "C001" },
          { bioguideId: "C001" }, // duplicate in payload
          { bioguideId: "C002" },
          { bioguideId: "C999" }, // missing state/chamber
        ],
      };

      const createRes = await persistHydratedBillPrisma(hydratedNew, mockClient, {
        logger,
      });

      expect(createRes).toEqual({
        action: "created",
        billId: "bill-new-1",
        identifier: "119-HR-250",
      });

      // C001 existed in DB so fetchMember was NOT called for C001; called for S001, C002, C999 only
      expect(mockClient.fetchMember).toHaveBeenCalledTimes(3);
      expect(mockDb.member.upsert).toHaveBeenCalledTimes(2);
      expect(mockDb.member.upsert).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          where: { bioguideId: "S001" },
          create: expect.objectContaining({
            bioguideId: "S001",
            firstName: "Alice",
            lastName: "Sponsor",
            fullName: "Alice Sponsor",
            chamber: "HOUSE",
            state: "CA",
            district: 12,
            party: "D",
            websiteUrl: "https://sponsor.house.gov",
          }),
        })
      );

      expect(mockDb.bill.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            congress: 119,
            billType: "hr",
            billNumber: 250,
            lawNumber: "119-20",
            sponsorId: "member-s001",
            currentStatus: "BECAME_LAW",
            cosponsors: {
              connect: [{ id: "member-c001" }, { id: "member-c002" }],
            },
          }),
          select: { id: true },
        })
      );

      expect(mockDb.action.deleteMany).toHaveBeenCalledWith({
        where: { billId: "bill-new-1" },
      });
      expect(mockDb.action.createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            billId: "bill-new-1",
            actionCode: "36000",
            actionType: "Library of Congress",
            text: "Became Public Law No: 119-20.",
          }),
          expect.objectContaining({
            billId: "bill-new-1",
            actionCode: "2",
            actionType: "House floor actions",
            text: "Introduced in House",
          }),
        ],
      });

      expect(mockDb.amendment.deleteMany).toHaveBeenCalledWith({
        where: { billId: "bill-new-1" },
      });
      expect(mockDb.amendment.createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            billId: "bill-new-1",
            amendmentNumber: "10",
            amendmentType: "HAMDT",
            congress: 119,
            sponsorId: "member-s001",
            status: "Agreed to",
          }),
        ],
        skipDuplicates: true,
      });

      expect(logger.warn).toHaveBeenCalledWith(
        "Unable to create member due to missing chamber or state",
        expect.objectContaining({ bioguideId: "C999" })
      );

      // Scenario B: Update existing bill replaces cosponsors via `set`, upserts new member from reference fallback when fetchMember returns null, and updates non-empty fields
      jest.clearAllMocks();
      mockDb.$transaction.mockImplementation(
        async (callback: (tx: MockDb) => Promise<unknown>) => callback(mockDb)
      );
      mockDb.member.findUnique
        .mockResolvedValueOnce({ id: "member-c001" })
        .mockResolvedValueOnce(null);
      mockClient.fetchMember.mockResolvedValueOnce(null);
      mockDb.member.upsert.mockResolvedValueOnce({ id: "member-c003" });
      mockDb.bill.findUnique.mockResolvedValueOnce({
        id: "bill-new-1",
        title: "Old Title",
        officialTitle: "Old Official Title",
        shortTitle: null,
        lawNumber: null,
        fullText: null,
        fullTextUrl: null,
        sponsorId: null,
        sourceUrl: null,
      });
      mockDb.bill.update.mockResolvedValueOnce({ id: "bill-new-1" });
      mockDb.action.deleteMany.mockResolvedValueOnce({ count: 2 });
      mockDb.amendment.deleteMany.mockResolvedValueOnce({ count: 1 });

      const updateRes = await persistHydratedBillPrisma(
        {
          bill: {
            congress: 119,
            type: "HR",
            number: "250",
            title: "Updated Clean Grid Modernization Act",
            shortTitle: "Grid Mod Act",
            laws: [{ lawNumber: "119-21" }],
            sponsor: { bioguideId: "C001" },
          },
          text: {
            content: "Updated full bill text",
            url: "https://www.congress.gov/119/bills/hr250/updated.htm",
          },
          actions: [],
          amendments: [],
          cosponsors: [
            { bioguideId: "C001" },
            {
              bioguideId: "C003",
              firstName: "Carol",
              lastName: "Sen",
              chamber: "SENATE",
              state: "WA",
              party: "D",
            },
          ],
        },
        mockClient,
        { logger }
      );

      expect(updateRes).toEqual({
        action: "updated",
        billId: "bill-new-1",
        identifier: "119-HR-250",
      });
      expect(mockDb.bill.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "bill-new-1" },
          data: expect.objectContaining({
            title: "Updated Clean Grid Modernization Act",
            officialTitle: "Updated Clean Grid Modernization Act",
            shortTitle: "Grid Mod Act",
            lawNumber: "119-21",
            fullText: "Updated full bill text",
            fullTextUrl: "https://www.congress.gov/119/bills/hr250/updated.htm",
            sponsorId: "member-c001",
            cosponsors: { set: [{ id: "member-c001" }, { id: "member-c003" }] },
          }),
        })
      );
      expect(mockDb.action.createMany).not.toHaveBeenCalled();
      expect(mockDb.amendment.createMany).not.toHaveBeenCalled();
    });

    it("skips bills missing identifier fields and catches transaction errors cleanly", async () => {
      const skipped = await persistHydratedBillPrisma(
        {
          bill: { title: "Incomplete" },
          actions: [],
          amendments: [],
          cosponsors: [],
        },
        mockClient,
        { logger }
      );
      expect(skipped.action).toBe("skipped");
      expect(mockDb.$transaction).not.toHaveBeenCalled();

      mockDb.$transaction.mockRejectedValueOnce(new Error("DB deadlock"));
      const failed = await persistHydratedBillPrisma(
        {
          bill: { congress: 119, type: "S", number: "99", title: "Senate Bill" },
          actions: [],
          amendments: [],
          cosponsors: [],
        },
        mockClient,
        { logger }
      );
      expect(failed).toEqual({
        action: "failed",
        identifier: "119-S-99",
        message: "DB deadlock",
      });
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe("persistExecutiveOrderPrisma", () => {
    it("preserves non-empty fullText, fullTextUrl, presidentName, sourceUrl, and federalRegisterUrl on update", async () => {
      mockDb.executiveOrder.findUnique.mockResolvedValueOnce({
        id: "eo-existing-1",
        title: "Existing EO Title",
        fullText: "Existing EO full text body.",
        fullTextUrl: "https://www.federalregister.gov/api/v1/body.html",
        presidentName: "Existing President",
        sourceUrl: "https://www.federalregister.gov/d/2026-00100",
        federalRegisterUrl: "https://www.federalregister.gov/d/2026-00100",
      });
      mockDb.executiveOrder.update.mockResolvedValueOnce({
        id: "eo-existing-1",
      });

      const incoming: HydratedExecutiveOrder = {
        documentNumber: "2026-00100",
        orderNumber: 14199,
        executiveOrderType: "EXECUTIVE_ORDER",
        title: "Updated EO Title",
        signingDate: new Date("2026-01-25T00:00:00Z"),
        publicationDate: new Date("2026-01-27T00:00:00Z"),
        federalRegisterUrl: "",
        sourceUrl: undefined,
        presidentName: "",
        fullText: null,
        fullTextUrl: "   ",
      };

      const res = await persistExecutiveOrderPrisma(incoming, { logger });

      expect(res).toEqual({
        action: "updated",
        identifier: "14199-Updated EO Title",
        executiveOrderId: "eo-existing-1",
      });

      expect(mockDb.executiveOrder.update).toHaveBeenCalledWith({
        where: { id: "eo-existing-1" },
        data: expect.objectContaining({
          orderNumber: 14199,
          executiveOrderType: "EXECUTIVE_ORDER",
          title: "Updated EO Title",
          fullText: "Existing EO full text body.",
          fullTextUrl: "https://www.federalregister.gov/api/v1/body.html",
          presidentName: "Existing President",
          sourceUrl: "https://www.federalregister.gov/d/2026-00100",
          federalRegisterUrl: "https://www.federalregister.gov/d/2026-00100",
        }),
        select: { id: true },
      });

      // Also verify "Unknown" incoming presidentName does not overwrite a known existing presidentName
      mockDb.executiveOrder.findUnique.mockResolvedValueOnce({
        id: "eo-existing-1",
        title: "Existing EO Title",
        fullText: null,
        fullTextUrl: null,
        presidentName: "Joseph R. Biden",
        sourceUrl: null,
        federalRegisterUrl: null,
      });
      mockDb.executiveOrder.update.mockResolvedValueOnce({
        id: "eo-existing-1",
      });

      await persistExecutiveOrderPrisma(
        {
          ...incoming,
          presidentName: "Unknown",
          fullText: "Newly fetched EO text",
          fullTextUrl: "https://www.federalregister.gov/api/v1/new-body.html",
          federalRegisterUrl: "https://www.federalregister.gov/d/2026-00100",
          sourceUrl: "https://www.federalregister.gov/d/2026-00100",
        },
        { logger }
      );

      expect(mockDb.executiveOrder.update).toHaveBeenLastCalledWith({
        where: { id: "eo-existing-1" },
        data: expect.objectContaining({
          presidentName: "Joseph R. Biden",
          fullText: "Newly fetched EO text",
          fullTextUrl: "https://www.federalregister.gov/api/v1/new-body.html",
          federalRegisterUrl: "https://www.federalregister.gov/d/2026-00100",
          sourceUrl: "https://www.federalregister.gov/d/2026-00100",
        }),
        select: { id: true },
      });
    });

    it("maps subtypes and synthesizes deterministic fallback orderNumber for unnumbered non-EO presidential docs", async () => {
      expect(mapSubtypeToExecutiveOrderType("executive_order")).toBe(
        "EXECUTIVE_ORDER"
      );
      expect(mapSubtypeToExecutiveOrderType("presidential_memorandum")).toBe(
        "PRESIDENTIAL_MEMORANDUM"
      );
      expect(mapSubtypeToExecutiveOrderType("proclamation")).toBe(
        "PROCLAMATION"
      );
      expect(mapSubtypeToExecutiveOrderType("determination")).toBe(
        "DETERMINATION"
      );

      const unnumberedMemo: FederalRegisterDocument = {
        document_number: "2026-04567",
        type: "Presidential Document",
        subtype: "presidential_memorandum",
        title: "Presidential Memorandum on Energy Policy",
        signing_date: "2026-02-10",
      };
      const fallbackA = ensureOrderNumber(unnumberedMemo);
      const fallbackB = ensureOrderNumber(unnumberedMemo);
      expect(fallbackA).toBe(fallbackB);
      expect(fallbackA).toBeGreaterThanOrEqual(100_000);
      expect(fallbackA).toBeLessThan(1_000_000);
      expect(
        ensureOrderNumber({
          ...unnumberedMemo,
          document_number: "2026-09999",
        })
      ).not.toBe(fallbackA);
      expect(inferPresidentName(unnumberedMemo)).toBe("Donald J. Trump");

      mockDb.executiveOrder.findUnique.mockResolvedValueOnce(null);
      mockDb.executiveOrder.create.mockResolvedValueOnce({ id: "eo-memo-1" });

      // Passing orderNumber: 0 simulates an unnumbered doc and triggers deterministic fallback
      const res = await persistExecutiveOrderPrisma(
        {
          documentNumber: "2026-04567",
          orderNumber: 0,
          executiveOrderType: mapSubtypeToExecutiveOrderType(
            "presidential_memorandum"
          ) as HydratedExecutiveOrder["executiveOrderType"],
          title: "Presidential Memorandum on Energy Policy",
          signingDate: new Date("2026-02-10T00:00:00Z"),
          presidentName: "",
          federalRegisterUrl: "https://www.federalregister.gov/d/2026-04567",
          sourceUrl: "https://www.federalregister.gov/d/2026-04567",
          fullText: "Memorandum text",
          fullTextUrl: "https://www.federalregister.gov/api/v1/memo.html",
        },
        { logger }
      );

      expect(res).toEqual({
        action: "created",
        identifier: `${fallbackA}-Presidential Memorandum on Energy Policy`,
        executiveOrderId: "eo-memo-1",
      });
      expect(mockDb.executiveOrder.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          orderNumber: fallbackA,
          executiveOrderType: "PRESIDENTIAL_MEMORANDUM",
          presidentName: "Donald J. Trump",
          fullText: "Memorandum text",
          fullTextUrl: "https://www.federalregister.gov/api/v1/memo.html",
        }),
        select: { id: true },
      });
    });
  });

  describe("backfillMissingBillTexts & backfillMissingEoTexts", () => {
    it("backfillMissingBillTexts queries where fullText is null and handles updated, urlOnly, and failed outcomes", async () => {
      const zeroSummary = await backfillMissingBillTexts(0, {
        client: mockClient,
        logger,
      });
      expect(zeroSummary).toEqual({
        processed: 0,
        updated: 0,
        urlOnly: 0,
        failed: 0,
        updatedIds: [],
      });
      expect(mockDb.bill.findMany).not.toHaveBeenCalled();

      mockDb.bill.findMany.mockResolvedValueOnce([
        {
          id: "bill-1",
          billType: "hr",
          billNumber: 1,
          congress: 119,
          title: "Bill One",
          fullTextUrl: null,
        },
        {
          id: "bill-2",
          billType: "s",
          billNumber: 2,
          congress: 119,
          title: "Bill Two",
          fullTextUrl: null,
        },
        {
          id: "bill-3",
          billType: "hjres",
          billNumber: 3,
          congress: 119,
          title: "Bill Three",
          fullTextUrl: null,
        },
        {
          id: "bill-4",
          billType: "sres",
          billNumber: 4,
          congress: 119,
          title: "Bill Four",
          fullTextUrl: null,
        },
      ]);

      mockClient.fetchBillText
        .mockResolvedValueOnce({
          content: "Full text for bill 1",
          url: "https://www.congress.gov/119/bills/hr1/text.htm",
        })
        .mockResolvedValueOnce({
          content: null,
          url: "https://www.congress.gov/119/bills/s2/text.htm",
        })
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error("Congress timeout"));

      mockDb.bill.update.mockResolvedValue({ id: "ok" });

      const summary = await backfillMissingBillTexts(10, {
        client: mockClient,
        logger,
      });

      expect(mockDb.bill.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { fullText: null },
          orderBy: { introducedDate: "desc" },
          take: 10,
        })
      );

      expect(mockDb.bill.update).toHaveBeenCalledTimes(2);
      expect(mockDb.bill.update).toHaveBeenNthCalledWith(1, {
        where: { id: "bill-1" },
        data: {
          fullText: "Full text for bill 1",
          fullTextUrl: "https://www.congress.gov/119/bills/hr1/text.htm",
        },
      });
      expect(mockDb.bill.update).toHaveBeenNthCalledWith(2, {
        where: { id: "bill-2" },
        data: {
          fullTextUrl: "https://www.congress.gov/119/bills/s2/text.htm",
        },
      });

      expect(summary).toEqual({
        processed: 4,
        updated: 1,
        urlOnly: 1,
        failed: 2,
        updatedIds: ["bill-1"],
      });
    });

    it("backfillMissingEoTexts queries where fullText is null and updates fullText and fullTextUrl cleanly", async () => {
      const zeroSummary = await backfillMissingEoTexts(0, { logger });
      expect(zeroSummary).toEqual({
        processed: 0,
        updated: 0,
        urlOnly: 0,
        failed: 0,
        updatedIds: [],
      });
      expect(mockDb.executiveOrder.findMany).not.toHaveBeenCalled();

      mockDb.executiveOrder.findMany.mockResolvedValueOnce([
        {
          id: "eo-1",
          orderNumber: 14200,
          title: "EO 14200",
          federalRegisterUrl:
            "https://www.federalregister.gov/documents/2026/02/01/2026-01111/eo-14200",
          sourceUrl: null,
          fullTextUrl: null,
        },
        {
          id: "eo-2",
          orderNumber: 14201,
          title: "EO 14201",
          federalRegisterUrl: "https://www.federalregister.gov/d/2026-02222",
          sourceUrl: null,
          fullTextUrl: null,
        },
        {
          id: "eo-3",
          orderNumber: 14202,
          title: "EO 14202",
          federalRegisterUrl: null,
          sourceUrl: "https://www.federalregister.gov/d/2026-03333",
          fullTextUrl: null,
        },
        {
          id: "eo-4",
          orderNumber: 14203,
          title: "EO 14203 Missing URL",
          federalRegisterUrl: null,
          sourceUrl: null,
          fullTextUrl: null,
        },
        {
          id: "eo-5",
          orderNumber: 14204,
          title: "EO 14204 Error",
          federalRegisterUrl: "https://www.federalregister.gov/d/2026-05555",
          sourceUrl: null,
          fullTextUrl: null,
        },
      ]);

      mockFetchEoFullText
        .mockResolvedValueOnce({
          content: "<html>EO 14200 full text</html>",
          url: "https://www.federalregister.gov/api/v1/2026-01111/body.html",
        })
        .mockResolvedValueOnce({
          content: null,
          url: "https://www.federalregister.gov/api/v1/2026-02222/body.html",
        })
        .mockResolvedValueOnce({
          content: null,
          url: null,
        })
        .mockRejectedValueOnce(new Error("Federal Register 503"));

      mockDb.executiveOrder.update.mockResolvedValue({ id: "ok" });

      const summary = await backfillMissingEoTexts(5, {
        requestIntervalMs: 0,
        retryDelayMs: 0,
        logger,
      });

      expect(mockDb.executiveOrder.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { fullText: null },
          orderBy: { signingDate: "desc" },
          take: 5,
        })
      );

      expect(mockFetchEoFullText).toHaveBeenNthCalledWith(
        1,
        "2026-01111",
        expect.objectContaining({ logger })
      );
      expect(mockFetchEoFullText).toHaveBeenNthCalledWith(
        2,
        "2026-02222",
        expect.objectContaining({ logger })
      );
      expect(mockFetchEoFullText).toHaveBeenNthCalledWith(
        3,
        "2026-03333",
        expect.objectContaining({ logger })
      );
      expect(mockFetchEoFullText).toHaveBeenNthCalledWith(
        4,
        "2026-05555",
        expect.objectContaining({ logger })
      );

      expect(mockDb.executiveOrder.update).toHaveBeenCalledTimes(2);
      expect(mockDb.executiveOrder.update).toHaveBeenNthCalledWith(1, {
        where: { id: "eo-1" },
        data: {
          fullText: "<html>EO 14200 full text</html>",
          fullTextUrl:
            "https://www.federalregister.gov/api/v1/2026-01111/body.html",
        },
      });
      expect(mockDb.executiveOrder.update).toHaveBeenNthCalledWith(2, {
        where: { id: "eo-2" },
        data: {
          fullTextUrl:
            "https://www.federalregister.gov/api/v1/2026-02222/body.html",
        },
      });

      expect(summary).toEqual({
        processed: 5,
        updated: 1,
        urlOnly: 1,
        failed: 3,
        updatedIds: ["eo-1"],
      });
    });
  });
});
