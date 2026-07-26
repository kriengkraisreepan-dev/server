# Sprint 8A Hotfix — Product API Route 404

## Root cause

The project `index.js` already contained the Sprint 8A inventory routes. The server listening on port 3000 was an older `node index.js` process and had not been restarted after the Sprint 8A route changes. It therefore served the old route table and returned Express's HTML 404 page for the product GET endpoints.

## Fix

- Restarted the server from `C:\Users\Windows 11\Desktop\88Snooker Club\server` after stopping only the stale listener on port 3000.
- Moved static-file registration after API registration and added a JSON `/api` 404 handler.
- Kept authentication before API routes: unauthenticated requests return JSON 401, never an HTML login redirect.
- Added `pagination` while retaining the existing top-level pagination fields for compatibility.
- Hardened the frontend API helper to inspect the content type before decoding JSON and show a clear inventory-server message for HTML responses.

## Verification

- Actual restarted server: unauthenticated product/category requests return `401 application/json`.
- Isolated route regression test: authenticated OWNER gets `200 application/json` for products and categories; unknown authenticated API route gets JSON 404.
- Browser: Login page loads after restart. Owner-page verification requires a supplied test account and is not performed by guessing or resetting a production password.
