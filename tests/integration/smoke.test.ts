import "dotenv/config";
import fetch from "node-fetch";

const BASE =
  process.env.SMOKE_BASE_URL ||
  process.env.NEXT_PUBLIC_APP_URL ||
  "http://localhost:3000";
const BILL_ID = process.env.SMOKE_BILL_ID || process.env.TEST_BILL_ID;

if (!BASE) {
  // If no BASE is configured, do not run tests to avoid accidental external calls
  // Provide a harmless test so TypeScript/Jest runs cleanly
  test("no base URL configured - skipping e2e smoke", () => {
    // Intentionally empty - set SMOKE_BASE_URL or NEXT_PUBLIC_APP_URL to run E2E tests
    console.warn(
      "Skipping smoke tests: no SMOKE_BASE_URL or NEXT_PUBLIC_APP_URL configured"
    );
  });
} else {
  test("smoke e2e register/login/track", async () => {
    if (!BILL_ID) {
      console.warn("Skipping smoke test: SMOKE_BILL_ID / TEST_BILL_ID not set");
      return;
    }

    const username =
      process.env.SMOKE_CI_USERNAME || `test_smoke_${Date.now()}`;
    const email =
      process.env.SMOKE_CI_EMAIL || `test_smoke_${Date.now()}@example.com`;
    const password = process.env.SMOKE_CI_PASSWORD || "Password123!";

    const reg = await fetch(`${BASE}/api/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, email, password }),
    });
    expect([200, 201, 409]).toContain(reg.status);
    const regBody = await reg.json().catch(() => null);

    let token: string | null = regBody?.authToken ?? null;
    if (!token) {
      // try login
      const login = await fetch(`${BASE}/api/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      expect([200, 201]).toContain(login.status);
      const loginBody = await login.json();
      token = loginBody?.authToken;
    }

    expect(token).toBeTruthy();

    // set prefs
    const prefs = await fetch(`${BASE}/api/notifications/preferences`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        notifyOnStatusChange: true,
        notifyOnAllActions: false,
        emailNotifications: false,
      }),
    });
    expect(prefs.ok).toBe(true);

    // track bill
    const track = await fetch(`${BASE}/api/bills/track`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ billId: BILL_ID }),
    });
    expect(track.ok).toBe(true);
  }, 20000);
}
