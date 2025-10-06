HTTP smoke-test

This tiny smoke-test exercises four API endpoints in sequence: register -> login -> get/set notification preferences -> track bill.

Prerequisites

- A running dev server with your app (default: http://localhost:3000). If your app runs elsewhere, set SMOKE_BASE_URL.
- A valid bill id to test tracking; set this via SMOKE_BILL_ID or TEST_BILL_ID in your environment.
- Node 18+ (for fetch support) or have `node-fetch` installed.

Environment variables used

- SMOKE_BASE_URL: override base URL (default: NEXT_PUBLIC_APP_URL or http://localhost:3000)
- SMOKE_BILL_ID or TEST_BILL_ID: the bill id to track (required)
- SMOKE_TEST_EMAIL: optional override for the test user's email
- SMOKE_TEST_USERNAME / SMOKE_TEST_PASSWORD: optional overrides for credentials

How to run

1. From repo root, set env (example using .env):

```bash
export $(cat .env | xargs)
export SMOKE_BILL_ID=<some-bill-id>
node scripts/http-smoke-test.js
```

Or on Windows PowerShell:

```powershell
Get-Content .env | Foreach-Object { $k,$v = $_ -split '=',2; Set-Item -Path env:$k -Value $v }
$env:SMOKE_BILL_ID = '<some-bill-id>'
node scripts/http-smoke-test.js
```

The script will exit non-zero on failure and print progress to the console.
