#!/usr/bin/env node
import "dotenv/config";
import fetch from "node-fetch";

// Hardened smoke-test: register -> login -> get prefs -> set prefs -> track bill
// - Idempotent: if the test user already exists we'll attempt to login instead of failing
// - CI-friendly: pass --ci to use stable credentials provided via env (SMOKE_CI_USERNAME/EMAIL/PASSWORD)
// - Assertions: checks basic shapes and required fields
// Configure via env or command-line overrides
const BASE =
  process.env.SMOKE_BASE_URL ||
  process.env.NEXT_PUBLIC_APP_URL ||
  "http://localhost:3000";
const BILL_ID = process.env.SMOKE_BILL_ID || process.env.TEST_BILL_ID;
const isCI = process.argv.includes("--ci") || process.env.SMOKE_CI === "true";

const TEST_EMAIL =
  (isCI && process.env.SMOKE_CI_EMAIL) ||
  process.env.SMOKE_TEST_EMAIL ||
  `smoke+${Date.now()}@example.com`;
const TEST_USERNAME =
  (isCI && process.env.SMOKE_CI_USERNAME) ||
  process.env.SMOKE_TEST_USERNAME ||
  `smoke_user_${Date.now()}`;
const TEST_PASSWORD =
  (isCI && process.env.SMOKE_CI_PASSWORD) ||
  process.env.SMOKE_TEST_PASSWORD ||
  "Password123!";

function assert(condition, message) {
  if (!condition) throw new Error(message || "Assertion failed");
}

async function parseJsonSafe(res) {
  try {
    return await res.json();
  } catch (e) {
    return null;
  }
}

async function tryRegister(username, email, password) {
  const resp = await fetch(`${BASE}/api/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, email, password }),
  });
  const body = await parseJsonSafe(resp);
  return { ok: resp.ok, status: resp.status, body };
}

async function tryLogin(username, password) {
  const resp = await fetch(`${BASE}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const body = await parseJsonSafe(resp);
  return { ok: resp.ok, status: resp.status, body };
}

async function run() {
  console.log("Using base URL:", BASE);
  if (!BILL_ID) {
    console.error(
      "Please set SMOKE_BILL_ID or TEST_BILL_ID in your environment to a valid bill id."
    );
    process.exit(2);
  }

  console.log(`Test mode: ${isCI ? "CI (stable creds)" : "ephemeral"}`);

  // Register (idempotent)
  console.log("Registering (or skipping if exists)...");
  const regResult = await tryRegister(TEST_USERNAME, TEST_EMAIL, TEST_PASSWORD);
  let token = null;
  let userId = null;

  if (regResult.ok) {
    assert(
      regResult.body && regResult.body.authToken,
      "register did not return authToken"
    );
    token = regResult.body.authToken;
    userId = regResult.body.userId;
    console.log("Registered userId:", userId);
  } else {
    console.log(
      "Register returned status",
      regResult.status,
      "; attempting login..."
    );
    const loginResult = await tryLogin(TEST_USERNAME, TEST_PASSWORD);
    if (!loginResult.ok) {
      console.error("Neither register nor login succeeded. Response bodies:");
      console.error("register:", regResult.body);
      console.error("login:", loginResult.body);
      throw new Error("Unable to create or authenticate test user");
    }
    assert(
      loginResult.body && loginResult.body.authToken,
      "login did not return authToken"
    );
    token = loginResult.body.authToken;
    userId = loginResult.body.userId;
    console.log("Logged in userId:", userId);
  }

  // GET preferences (should return defaults or existing preferences)
  console.log("Getting preferences...");
  const prefsResp = await fetch(`${BASE}/api/notifications/preferences`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
  assert(prefsResp.ok, `GET preferences failed: ${prefsResp.status}`);
  const prefs = await parseJsonSafe(prefsResp);
  console.log("Current prefs:", prefs?.currentPreferences ?? prefs);

  // POST preferences
  console.log("Setting preferences (emailNotifications = false)...");
  const setResp = await fetch(`${BASE}/api/notifications/preferences`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      notifyOnStatusChange: true,
      notifyOnAllActions: false,
      emailNotifications: false,
    }),
  });
  assert(setResp.ok, `POST preferences failed: ${setResp.status}`);
  const set = await parseJsonSafe(setResp);
  console.log("Preferences saved:", set);

  // Track a bill
  console.log("Tracking bill:", BILL_ID);
  const trackResp = await fetch(`${BASE}/api/bills/track`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ billId: BILL_ID }),
  });
  assert(trackResp.ok, `Track bill failed: ${trackResp.status}`);
  const tracked = await parseJsonSafe(trackResp);
  console.log("Tracking response:", tracked);

  // Cleanup: delete the test user (dev-only endpoint)
  if (isCI) {
    console.log(
      "CI mode: skipping test-user cleanup to preserve stable test account"
    );
  } else {
    console.log("Cleaning up test user...");
    try {
      const delResp = await fetch(`${BASE}/api/test/cleanup-user`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (delResp.ok) {
        const del = await parseJsonSafe(delResp);
        console.log("Cleanup result:", del);
      } else {
        console.warn("Cleanup endpoint returned non-ok status", delResp.status);
      }
    } catch (e) {
      console.warn(
        "Cleanup failed (non-fatal):",
        e && e.message ? e.message : e
      );
    }
  }

  console.log("Smoke test completed successfully");
}

run().catch((err) => {
  console.error("Smoke test failed:", err && err.message ? err.message : err);
  process.exit(1);
});
