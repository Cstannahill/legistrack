import { formatDate, formatDateTime } from "@/lib/utils/date";
import {
  formatCount,
  formatSponsorLabel,
  getBillStageSummary,
  truncate,
} from "@/lib/utils/formatting";

describe("date formatting utilities", () => {
  it("formats UTC Date objects and ISO strings consistently in UTC", () => {
    const utcMidnight = new Date("2025-12-05T00:00:00.000Z");
    const isoWithZ = "2025-12-05T00:00:00.000Z";
    const isoWithoutZ = "2025-12-05T00:00:00";

    expect(formatDate(utcMidnight)).toBe("Dec 5, 2025");
    expect(formatDate(isoWithZ)).toBe("Dec 5, 2025");
    expect(formatDate(isoWithoutZ)).toBe("Dec 5, 2025");
  });

  it("handles invalid dates gracefully", () => {
    expect(formatDate("not-a-date")).toBe("—");
    expect(formatDateTime("not-a-date")).toBe("—");
  });
});

describe("formatting & stage utilities", () => {
  it("does not duplicate party/state when fullName already contains brackets", () => {
    expect(
      formatSponsorLabel({
        fullName: "Rep. Steube, W. Gregory [R-FL-17]",
        party: "R",
        state: "Florida",
      })
    ).toBe("Rep. Steube, W. Gregory [R-FL-17]");

    expect(
      formatSponsorLabel({
        fullName: "Sen. Jane Doe",
        party: "D",
        state: "CA",
      })
    ).toBe("Sen. Jane Doe (D-CA)");

    expect(formatSponsorLabel(null)).toBe("");
  });

  it("formats integer counts with locale commas and truncates cleanly", () => {
    expect(formatCount(11892)).toBe("11,892");
    expect(truncate("Hello world", 20)).toBe("Hello world");
    expect(truncate("Hello world   example", 12)).toBe("Hello world...");
  });

  it("maps bill statuses to 4-stage pipeline summaries", () => {
    expect(getBillStageSummary("INTRODUCED")).toEqual({
      step: 1,
      outcome: "active",
    });
    expect(getBillStageSummary("REFERRED_TO_COMMITTEE")).toEqual({
      step: 2,
      outcome: "active",
    });
    expect(getBillStageSummary("PASSED_HOUSE")).toEqual({
      step: 3,
      outcome: "active",
    });
    expect(getBillStageSummary("BECAME_LAW")).toEqual({
      step: 4,
      outcome: "law",
    });
    expect(getBillStageSummary("VETOED")).toEqual({
      step: 4,
      outcome: "failed",
    });
  });
});
