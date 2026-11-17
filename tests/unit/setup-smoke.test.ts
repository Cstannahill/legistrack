import { CURRENT_CONGRESS } from "@/lib/constants";

describe("Jest setup smoke test", () => {
  it("resolves @/* path aliases to src/*", () => {
    expect(CURRENT_CONGRESS).toBeGreaterThanOrEqual(119);
  });
});
