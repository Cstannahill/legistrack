import {
  CongressClient,
  hydrateBill,
  type CongressBillListItem,
} from "@/lib/ingestion/congress-client";
import {
  ensureOrderNumber,
  fetchExecutiveOrderDetails,
  fetchExecutiveOrderFullText,
  fetchExecutiveOrdersPage,
  hydrateExecutiveOrder,
  mapSubtypeToExecutiveOrderType,
  resetFederalRegisterThrottleForTests,
  type FederalRegisterDocument,
} from "@/lib/ingestion/federal-register-client";

interface MockResponseInit {
  ok?: boolean;
  status: number;
  statusText?: string;
  jsonBody?: unknown;
  textBody?: string;
  headers?: Record<string, string>;
}

function makeMockResponse(init: MockResponseInit): Response {
  const ok = init.ok ?? (init.status >= 200 && init.status < 300);
  const headerMap = new Map<string, string>(
    Object.entries(init.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v])
  );
  return {
    ok,
    status: init.status,
    statusText: init.statusText ?? (ok ? "OK" : "Error"),
    headers: {
      get: (name: string) => headerMap.get(name.toLowerCase()) ?? null,
    },
    json: async () => init.jsonBody,
    text: async () =>
      init.textBody !== undefined
        ? init.textBody
        : init.jsonBody !== undefined
          ? JSON.stringify(init.jsonBody)
          : "",
  } as unknown as Response;
}

describe("Congress.gov & Federal Register ingestion clients", () => {
  const originalFetch = global.fetch;
  let mockFetch: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    resetFederalRegisterThrottleForTests();
    mockFetch = jest.fn();
    global.fetch = mockFetch as unknown as typeof fetch;
  });

  afterEach(() => {
    jest.useRealTimers();
    global.fetch = originalFetch;
  });

  describe("CongressClient", () => {
    it("fetchBillPage passes cache: no-store, signal, date range, and api_key, and retries on 429 and 503", async () => {
      mockFetch
        .mockResolvedValueOnce(
          makeMockResponse({ status: 429, statusText: "Too Many Requests", textBody: "rate limited" })
        )
        .mockResolvedValueOnce(
          makeMockResponse({ status: 503, statusText: "Service Unavailable", textBody: "try again" })
        )
        .mockResolvedValueOnce(
          makeMockResponse({
            status: 200,
            jsonBody: {
              bills: [
                {
                  congress: 119,
                  type: "HR",
                  number: "101",
                  title: "Clean Water Act",
                },
              ],
              pagination: { count: 1 },
            },
          })
        );

      const client = new CongressClient({
        apiKey: "test-congress-key",
        requestIntervalMs: 0,
        retryDelayMs: 0,
        maxRetries: 2,
      });

      const page = await client.fetchBillPage({
        congress: 119,
        billTypes: ["HR", "S"],
        limit: 50,
        offset: 10,
        fromDateTime: "2026-01-01T00:00:00Z",
        toDateTime: "2026-01-02T00:00:00Z",
      });

      expect(page.bills).toHaveLength(1);
      expect(page.bills[0].number).toBe("101");
      expect(mockFetch).toHaveBeenCalledTimes(3);

      for (const [rawUrl, init] of mockFetch.mock.calls as Array<[string, RequestInit]>) {
        const parsed = new URL(rawUrl);
        expect(parsed.origin + parsed.pathname).toBe(
          "https://api.congress.gov/v3/bill/119"
        );
        expect(parsed.searchParams.get("api_key")).toBe("test-congress-key");
        expect(parsed.searchParams.get("format")).toBe("json");
        expect(parsed.searchParams.get("fromDateTime")).toBe(
          "2026-01-01T00:00:00Z"
        );
        expect(parsed.searchParams.get("toDateTime")).toBe(
          "2026-01-02T00:00:00Z"
        );
        expect(parsed.searchParams.get("limit")).toBe("50");
        expect(parsed.searchParams.get("offset")).toBe("10");
        expect(parsed.searchParams.get("billType")).toBe("hr,s");
        expect(init.cache).toBe("no-store");
        expect(init.signal).toBeInstanceOf(AbortSignal);
      }
    });

    it("does not retry non-transient 404 responses and throws when maxRetries exhausted on 5xx", async () => {
      const client = new CongressClient({
        apiKey: "test-congress-key",
        requestIntervalMs: 0,
        retryDelayMs: 0,
        maxRetries: 2,
      });

      mockFetch.mockResolvedValueOnce(
        makeMockResponse({ status: 404, statusText: "Not Found", textBody: "missing" })
      );

      await expect(client.fetchBillDetail(119, "hr", "99999")).rejects.toThrow(/404/);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      mockFetch.mockClear();
      mockFetch.mockResolvedValue(
        makeMockResponse({ status: 502, statusText: "Bad Gateway", textBody: "bad gw" })
      );

      await expect(client.fetchBillDetail(119, "hr", "100")).rejects.toThrow(/502/);
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it("fetchBillText prioritizes FORMATTED TEXT > TEXT > TXT > XML > PDF and extracts <pre> inner text without leaking api_key in returned url", async () => {
      mockFetch
        .mockResolvedValueOnce(
          makeMockResponse({
            status: 200,
            jsonBody: {
              textVersions: [
                {
                  type: "Introduced in House",
                  date: "2026-01-05T00:00:00Z",
                  formats: [
                    { type: "PDF", url: "https://www.congress.gov/119/bills/hr1/old.pdf" },
                    { type: "Formatted Text", url: "https://www.congress.gov/119/bills/hr1/old.htm" },
                  ],
                },
                {
                  type: "Engrossed in House",
                  date: "2026-02-10T00:00:00Z",
                  formats: [
                    { type: "PDF", url: "https://www.congress.gov/119/bills/hr1/latest.pdf" },
                    { type: "Formatted XML", url: "https://www.congress.gov/119/bills/hr1/latest.xml" },
                    { type: "TXT", url: "https://www.congress.gov/119/bills/hr1/latest.txt" },
                    { type: "Formatted Text", url: "https://www.congress.gov/119/bills/hr1/latest.htm" },
                  ],
                },
              ],
            },
          })
        )
        .mockResolvedValueOnce(
          makeMockResponse({
            status: 200,
            textBody:
              "<html><body><PRE class=\"bill-text\">\n  SECTION 1. SHORT TITLE.\n  This Act may be cited as the Test Act.\n</PRE></body></html>",
          })
        );

      const client = new CongressClient({
        apiKey: "secret-congress-key",
        requestIntervalMs: 0,
        retryDelayMs: 0,
      });

      const result = await client.fetchBillText(119, "HR", 1);

      expect(result).toEqual({
        content: "SECTION 1. SHORT TITLE.\n  This Act may be cited as the Test Act.",
        url: "https://www.congress.gov/119/bills/hr1/latest.htm",
        date: "2026-02-10T00:00:00Z",
      });
      expect(result?.url).not.toContain("secret-congress-key");

      expect(mockFetch).toHaveBeenCalledTimes(2);
      const [downloadCallUrl, downloadInit] = mockFetch.mock.calls[1] as [
        string,
        RequestInit,
      ];
      expect(downloadCallUrl).toContain("https://www.congress.gov/119/bills/hr1/latest.htm");
      expect(downloadInit.cache).toBe("no-store");
      expect(downloadInit.signal).toBeInstanceOf(AbortSignal);
    });

    it("fetchBillText handles TEXT/TXT priority fallback, 404 text metadata, and non-200 file downloads gracefully", async () => {
      const client = new CongressClient({
        apiKey: "test-key",
        requestIntervalMs: 0,
        retryDelayMs: 0,
      });

      // Fallback to TEXT over TXT & XML, returning plain text
      mockFetch
        .mockResolvedValueOnce(
          makeMockResponse({
            status: 200,
            jsonBody: {
              textVersions: {
                items: [
                  {
                    date: "2026-03-01T00:00:00Z",
                    formats: {
                      items: [
                        { type: "Formatted XML", url: "/119/bills/s5/s5.xml" },
                        { type: "TXT", url: "/119/bills/s5/s5.txt" },
                        { type: "Text", url: "/119/bills/s5/s5-text.htm" },
                      ],
                    },
                  },
                ],
              },
            },
          })
        )
        .mockResolvedValueOnce(
          makeMockResponse({
            status: 200,
            textBody: "Plain text bill content",
          })
        );

      const textRes = await client.fetchBillText(119, "S", "5");
      expect(textRes).toEqual({
        content: "Plain text bill content",
        url: "https://www.congress.gov/119/bills/s5/s5-text.htm",
        date: "2026-03-01T00:00:00Z",
      });

      // Download 404 returns content: null while preserving public URL
      mockFetch.mockClear();
      mockFetch
        .mockResolvedValueOnce(
          makeMockResponse({
            status: 200,
            jsonBody: {
              textVersions: [
                {
                  date: "2026-03-02T00:00:00Z",
                  formats: [{ type: "TXT", url: "https://www.congress.gov/119/bills/s6/s6.txt" }],
                },
              ],
            },
          })
        )
        .mockResolvedValueOnce(makeMockResponse({ status: 404, textBody: "Not Found" }));

      const failedDownload = await client.fetchBillText(119, "S", "6");
      expect(failedDownload).toEqual({
        content: null,
        url: "https://www.congress.gov/119/bills/s6/s6.txt",
        date: "2026-03-02T00:00:00Z",
      });

      // Metadata 404 returns undefined
      mockFetch.mockClear();
      mockFetch.mockResolvedValueOnce(makeMockResponse({ status: 404, textBody: "No text" }));
      await expect(client.fetchBillText(119, "S", "7")).resolves.toBeUndefined();
    });

    it("hydrateBill assembles detail, actions, amendments, cosponsors, and text without failing if text throws", async () => {
      const client = new CongressClient({
        apiKey: "test-key",
        requestIntervalMs: 0,
        retryDelayMs: 0,
        maxRetries: 0,
      });

      const listItem: CongressBillListItem = {
        congress: 119,
        type: "HR",
        number: "42",
        title: "Infrastructure Bill",
      };

      mockFetch.mockImplementation(async (rawUrl: string) => {
        const path = new URL(rawUrl).pathname;
        if (path.endsWith("/bill/119/hr/42")) {
          return makeMockResponse({
            status: 200,
            jsonBody: {
              bill: {
                congress: 119,
                type: "HR",
                number: "42",
                title: "Infrastructure Bill",
                sponsor: { bioguideId: "A000001", fullName: "Rep. Alice" },
              },
            },
          });
        }
        if (path.endsWith("/actions")) {
          return makeMockResponse({
            status: 200,
            jsonBody: {
              actions: [{ actionDate: "2026-02-01", text: "Referred to committee" }],
            },
          });
        }
        if (path.endsWith("/amendments")) {
          return makeMockResponse({
            status: 200,
            jsonBody: {
              amendments: [{ number: "1", type: "HAMDT", congress: 119 }],
            },
          });
        }
        if (path.endsWith("/cosponsors")) {
          return makeMockResponse({
            status: 200,
            jsonBody: {
              cosponsors: [{ bioguideId: "B000002", fullName: "Rep. Bob" }],
            },
          });
        }
        if (path.endsWith("/text")) {
          return makeMockResponse({ status: 500, textBody: "Server Error" });
        }
        return makeMockResponse({ status: 404 });
      });

      const hydrated = await client.hydrateBill(listItem);
      expect(hydrated.bill.title).toBe("Infrastructure Bill");
      expect(hydrated.actions).toHaveLength(1);
      expect(hydrated.amendments).toHaveLength(1);
      expect(hydrated.cosponsors).toEqual([
        { bioguideId: "B000002", fullName: "Rep. Bob" },
      ]);
      expect(hydrated.text).toBeUndefined();

      // Standalone hydrateBill helper delegates equivalently
      const hydratedViaFn = await hydrateBill({ client, bill: listItem });
      expect(hydratedViaFn.bill.title).toBe("Infrastructure Bill");
    });

    it("enforces default 1000ms throttle between sequential requests and aborts on timeout", async () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

      mockFetch.mockResolvedValue(
        makeMockResponse({ status: 200, jsonBody: { member: { bioguideId: "M001" } } })
      );

      const client = new CongressClient({ apiKey: "test-key" });

      const firstPromise = client.fetchMember("M001");
      await Promise.resolve();
      const firstResult = await firstPromise;
      expect(firstResult?.member?.bioguideId).toBe("M001");
      expect(mockFetch).toHaveBeenCalledTimes(1);

      const secondPromise = client.fetchMember("M002");
      await jest.advanceTimersByTimeAsync(999);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      await jest.advanceTimersByTimeAsync(1);
      const secondResult = await secondPromise;
      expect(secondResult?.member?.bioguideId).toBe("M001");
      expect(mockFetch).toHaveBeenCalledTimes(2);

      // Timeout abort check
      jest.useRealTimers();
      const timeoutClient = new CongressClient({
        apiKey: "test-key",
        requestIntervalMs: 0,
        retryDelayMs: 0,
        maxRetries: 0,
        timeoutMs: 20,
      });

      mockFetch.mockImplementationOnce(
        (_url: string, init?: RequestInit) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              reject(init.signal?.reason ?? new Error("Aborted"));
            });
          })
      );

      await expect(timeoutClient.fetchBillDetail(119, "hr", 1)).rejects.toThrow(
        /timed out/i
      );
    });

    it("retries on transient network errors, requires CONGRESS_API_KEY, and returns null from fetchMember on failure", async () => {
      const originalCongressKey = process.env.CONGRESS_API_KEY;
      delete process.env.CONGRESS_API_KEY;

      const missingKeyClient = new CongressClient({
        requestIntervalMs: 0,
        retryDelayMs: 0,
      });
      await expect(
        missingKeyClient.fetchBillDetail(119, "hr", 1)
      ).rejects.toThrow(/CONGRESS_API_KEY is not configured/);

      if (originalCongressKey !== undefined) {
        process.env.CONGRESS_API_KEY = originalCongressKey;
      }

      mockFetch
        .mockRejectedValueOnce(new TypeError("fetch failed"))
        .mockResolvedValueOnce(
          makeMockResponse({
            status: 200,
            jsonBody: { bill: { congress: 119, type: "HR", number: "9" } },
          })
        )
        .mockResolvedValueOnce(makeMockResponse({ status: 404, textBody: "Missing member" }));

      const client = new CongressClient({
        apiKey: "test-key",
        requestIntervalMs: 0,
        retryDelayMs: 0,
        maxRetries: 1,
      });

      const detail = await client.fetchBillDetail(119, "hr", 9);
      expect(detail.bill.number).toBe("9");
      expect(mockFetch).toHaveBeenCalledTimes(2);

      const member = await client.fetchMember("MISSING1");
      expect(member).toBeNull();
    });
  });

  describe("Federal Register client", () => {
    it("fetchExecutiveOrdersPage passes cache: no-store, signal, conditions, and retries on 429/5xx", async () => {
      mockFetch
        .mockResolvedValueOnce(
          makeMockResponse({ status: 429, statusText: "Too Many Requests" })
        )
        .mockResolvedValueOnce(
          makeMockResponse({
            status: 200,
            jsonBody: {
              count: 1,
              page: 1,
              total_pages: 1,
              total_entries: 1,
              results: [
                {
                  document_number: "2026-00010",
                  type: "Presidential Document",
                  title: "Executive Order on AI Safety",
                },
              ],
            },
          })
        );

      const res = await fetchExecutiveOrdersPage(
        {
          page: 2,
          perPage: 50,
          conditions: {
            presidentialDocumentType: ["executive_order", "proclamation"],
            publicationDate: { gte: "2026-01-01", lte: "2026-01-15" },
            signingDate: { gte: "2026-01-01", lte: "2026-01-14" },
          },
        },
        { requestIntervalMs: 0, retryDelayMs: 0 }
      );

      expect(res.results).toHaveLength(1);
      expect(mockFetch).toHaveBeenCalledTimes(2);

      const [calledUrl, init] = mockFetch.mock.calls[1] as [string, RequestInit];
      const parsed = new URL(calledUrl);
      expect(parsed.origin + parsed.pathname).toBe(
        "https://www.federalregister.gov/api/v1/documents.json"
      );
      expect(parsed.searchParams.get("page")).toBe("2");
      expect(parsed.searchParams.get("per_page")).toBe("50");
      expect(parsed.searchParams.getAll("conditions[type][]")).toEqual(["PRESDOCU"]);
      expect(
        parsed.searchParams.getAll("conditions[presidential_document_type][]")
      ).toEqual(["executive_order", "proclamation"]);
      expect(parsed.searchParams.get("conditions[publication_date][gte]")).toBe(
        "2026-01-01"
      );
      expect(parsed.searchParams.get("conditions[signing_date][lte]")).toBe(
        "2026-01-14"
      );
      expect(init.cache).toBe("no-store");
      expect(init.signal).toBeInstanceOf(AbortSignal);
    });

    it("hydrateExecutiveOrder fetches detail + text candidates in priority order (body_html_url -> raw_text_url -> full_text_xml_url) with no-store and handles 404 without aborting EO", async () => {
      const baseDoc: FederalRegisterDocument = {
        document_number: "2026-01234",
        type: "Presidential Document",
        subtype: "Presidential Memorandum",
        title: "Memorandum on Federal Workforce",
        publication_date: "2026-02-02",
        html_url: "https://www.federalregister.gov/d/2026-01234",
      };

      const detailDoc: FederalRegisterDocument = {
        ...baseDoc,
        signing_date: "2026-02-01",
        body_html_url: "https://www.federalregister.gov/api/v1/body.html",
        raw_text_url: "https://www.federalregister.gov/api/v1/raw.txt",
        full_text_xml_url: "https://www.federalregister.gov/api/v1/full.xml",
      };

      // Case 1: body_html_url returns 404, raw_text_url returns 404, full_text_xml_url returns 200
      mockFetch
        .mockResolvedValueOnce(makeMockResponse({ status: 200, jsonBody: detailDoc }))
        .mockResolvedValueOnce(makeMockResponse({ status: 404 }))
        .mockResolvedValueOnce(makeMockResponse({ status: 404 }))
        .mockResolvedValueOnce(
          makeMockResponse({ status: 200, textBody: "<EO>Full XML body</EO>" })
        );

      const hydrated = await hydrateExecutiveOrder({
        document: baseDoc,
        fetchFullText: true,
        requestIntervalMs: 0,
        retryDelayMs: 0,
      });

      expect(hydrated.documentNumber).toBe("2026-01234");
      expect(hydrated.executiveOrderType).toBe("PRESIDENTIAL_MEMORANDUM");
      expect(hydrated.orderNumber).toBe(ensureOrderNumber(detailDoc));
      expect(hydrated.presidentName).toBe("Donald J. Trump");
      expect(hydrated.fullText).toBe("<EO>Full XML body</EO>");
      expect(hydrated.fullTextUrl).toBe(
        "https://www.federalregister.gov/api/v1/full.xml"
      );

      expect(mockFetch.mock.calls.map(([url]) => url)).toEqual([
        "https://www.federalregister.gov/api/v1/documents/2026-01234.json",
        "https://www.federalregister.gov/api/v1/body.html",
        "https://www.federalregister.gov/api/v1/raw.txt",
        "https://www.federalregister.gov/api/v1/full.xml",
      ]);
      for (const [, init] of mockFetch.mock.calls as Array<[string, RequestInit]>) {
        expect(init.cache).toBe("no-store");
        expect(init.signal).toBeInstanceOf(AbortSignal);
      }

      // Case 2: All text candidates return 404 -> EO succeeds with fullText: null
      mockFetch.mockClear();
      mockFetch
        .mockResolvedValueOnce(makeMockResponse({ status: 200, jsonBody: detailDoc }))
        .mockResolvedValueOnce(makeMockResponse({ status: 404 }))
        .mockResolvedValueOnce(makeMockResponse({ status: 404 }))
        .mockResolvedValueOnce(makeMockResponse({ status: 404 }));

      const hydratedNoText = await hydrateExecutiveOrder({
        document: baseDoc,
        fetchFullText: true,
        requestIntervalMs: 0,
        retryDelayMs: 0,
      });

      expect(hydratedNoText.documentNumber).toBe("2026-01234");
      expect(hydratedNoText.fullText).toBeNull();
      expect(hydratedNoText.fullTextUrl).toBe(
        "https://www.federalregister.gov/api/v1/body.html"
      );
    });

    it("fetchExecutiveOrderFullText returns standardized { content, url } and tries candidates in order", async () => {
      mockFetch
        .mockResolvedValueOnce(
          makeMockResponse({
            status: 200,
            jsonBody: {
              document_number: "2026-99999",
              body_html_url: "https://example.test/body.html",
              raw_text_url: "https://example.test/raw.txt",
              full_text_xml_url: "https://example.test/full.xml",
            },
          })
        )
        .mockResolvedValueOnce(makeMockResponse({ status: 404 }))
        .mockResolvedValueOnce(
          makeMockResponse({ status: 200, textBody: "Raw text content" })
        );

      const res = await fetchExecutiveOrderFullText("2026-99999", {
        requestIntervalMs: 0,
        retryDelayMs: 0,
      });

      expect(res).toEqual({
        content: "Raw text content",
        url: "https://example.test/raw.txt",
      });
      expect(mockFetch.mock.calls.map(([url]) => url)).toEqual([
        "https://www.federalregister.gov/api/v1/documents/2026-99999.json?fields[]=full_text_xml_url&fields[]=body_html_url&fields[]=raw_text_url",
        "https://example.test/body.html",
        "https://example.test/raw.txt",
      ]);

      // 404 on metadata endpoint returns { content: null, url: null }
      mockFetch.mockClear();
      mockFetch.mockResolvedValueOnce(makeMockResponse({ status: 404 }));
      await expect(
        fetchExecutiveOrderFullText("2026-00000", {
          requestIntervalMs: 0,
          retryDelayMs: 0,
        })
      ).resolves.toEqual({ content: null, url: null });

      // Network error on body_html_url falls through to full_text_xml_url
      mockFetch.mockClear();
      mockFetch
        .mockResolvedValueOnce(
          makeMockResponse({
            status: 200,
            jsonBody: {
              document_number: "2026-88888",
              body_html_url: "https://example.test/broken-body.html",
              full_text_xml_url: "https://example.test/ok-full.xml",
            },
          })
        )
        .mockRejectedValueOnce(new Error("ECONNRESET"))
        .mockResolvedValueOnce(
          makeMockResponse({ status: 200, textBody: "<EO>Recovered XML</EO>" })
        );

      await expect(
        fetchExecutiveOrderFullText("2026-88888", {
          requestIntervalMs: 0,
          retryDelayMs: 0,
          maxRetries: 0,
        })
      ).resolves.toEqual({
        content: "<EO>Recovered XML</EO>",
        url: "https://example.test/ok-full.xml",
      });
    });

    it("maps subtypes cleanly and enforces default 1000ms throttle across Federal Register requests", async () => {
      expect(mapSubtypeToExecutiveOrderType("Executive Order")).toBe("EXECUTIVE_ORDER");
      expect(mapSubtypeToExecutiveOrderType("presidential_memorandum")).toBe(
        "PRESIDENTIAL_MEMORANDUM"
      );
      expect(mapSubtypeToExecutiveOrderType("Proclamation")).toBe("PROCLAMATION");
      expect(mapSubtypeToExecutiveOrderType("Determination")).toBe("DETERMINATION");

      jest.useFakeTimers();
      jest.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

      mockFetch.mockResolvedValue(
        makeMockResponse({
          status: 200,
          jsonBody: { document_number: "2026-1", type: "Presidential Document", title: "EO" },
        })
      );

      const firstPromise = fetchExecutiveOrderDetails("2026-1");
      await Promise.resolve();
      await firstPromise;
      expect(mockFetch).toHaveBeenCalledTimes(1);

      const secondPromise = fetchExecutiveOrderDetails("2026-2");
      await jest.advanceTimersByTimeAsync(999);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      await jest.advanceTimersByTimeAsync(1);
      await secondPromise;
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });
});
