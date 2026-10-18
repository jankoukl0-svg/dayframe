# Dayframe — Google Routes protected by persistent, atomic request budgets

This integration is **disabled until all required server-only Vercel secrets AND Upstash Redis credentials are present**. No credentials or quotas are stored in browser JS. The existing manual journey planner keeps working when routing is disabled or a budget is exhausted.

## Actual limits enforced by Dayframe

- **50 Google Compute Routes requests per UTC day**
- **1,000 Google Compute Routes requests per UTC calendar month**
- Every stage of a combined car, metro and walking trip costs **one** request. A 3-stage trip costs 3 budget units.
- The counter is in one persistent Upstash Redis store. A single **atomic Lua EVAL** checks BOTH the day and month counters before incrementing them. Simultaneous requests from multiple users, tabs and Vercel instances cannot independently exceed the application budget.
- The reservation happens **before** calling Google. Failed Google calls may consume budget; this is a deliberately conservative choice. When Redis is unreachable, unconfigured, returns an error, or a budget is exhausted, the Google call does not happen. Browser status falls back to manual time entry.
- UTC quota windows and limits are fixed in versioned server code; they cannot be increased via a casual frontend setting.
- Do **not** reset/delete Redis data or connect a new empty database mid-month. Such a reset would reset the budget, so treat the database as permanent.
- This cap applies to **Dayframe calls only**. It cannot control unrelated Google services, another API key or project, leaked Google credentials, or future changes in prices. Google Cloud's Billing budgets are **alerts, not spending limits**. No pay-as-you-go integration can promise an unconditional zero charge.

## Setup — no Google Cloud daily quota required

1. Keep using the existing Google Cloud project. Ensure **Routes API** alone is enabled and the dedicated API key is restricted to Routes API; do not enable unrelated paid APIs. Inspect Google Cloud Billing separately. Current Routes: Compute Routes Pro offers 5,000 free monthly calls, but don't rely on prices remaining unchanged.
2. In the [Vercel Upstash integration](https://vercel.com/marketplace/upstash) choose **Install Upstash for Redis → Free ($0)**, then link it to Vercel project `dayframe2` **Production**. Vercel can create a new free Upstash account and a Redis database through this flow. Do **not** select Pay as You Go or the paid Fixed plan. If a billing/upgrade prompt appears, stop rather than authorizing spend.
3. Check **Vercel → dayframe2 → Settings → Environment Variables**. These must exist as server-only variables for Production:
   - `GOOGLE_MAPS_ROUTES_API_KEY`: a Routes API-restricted key (already set previously).
   - `KV_REST_API_URL`: Upstash Redis REST HTTPS endpoint, automatically supplied by the current Vercel Marketplace integration.
   - `KV_REST_API_TOKEN`: its read/write Redis REST token, automatically supplied by Vercel.
   - The alternative names `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` are also supported if supplied together. Never copy, disclose, or mix secrets from two databases.
   - `DAYFRAME_ROUTES_ACCESS_TOKEN`: a different random ASCII/Base64URL token, minimum 20 characters, for accessing the private endpoint from your browser. Do **not** paste the Google API key here.
4. Redeploy `main` on Vercel so the new variables are picked up.
5. In Dayframe, go to **Týden → Místo konání** and enter the private access token in the route section. It stays only in browser sessionStorage, not in the schedule. After choosing all endpoints and modes the app shows Google estimates and distance, without permanently storing Google's API results.
6. Confirm the Vercel Upstash resource is on **Free**, with **Auto Upgrade disabled**. The presence of credentials does not confirm its tariff; review the database in Upstash before accepting a billing upgrade.
7. Test by selecting one simple route and a multi-leg route; verify the route ETA appears and the corresponding count is recorded in Upstash. For a low-cost test, use a mock Google response in CI (already covered in unit/browser tests). Never reveal tokens in support screenshots or GitHub.
8. Review the [published privacy notice](../public/privacy.html), [terms](../public/terms.html), [Google Routes requirements](https://developers.google.com/maps/documentation/routes/policies), and [Google Maps Platform EEA terms](https://cloud.google.com/terms/maps-platform/eea) before enabling the integration.

## Guard technical notes

- The server uses REST `POST /api/google-travel` with a secret access token, validating same-origin browser requests, selected transport and geographical coordinates.
- It issues an atomic Upstash `EVAL` with the day and month keys using one Redis hash-slot tag. If either limit is exhausted the endpoint returns HTTP **429** with `Retry-After`; on database failure it returns **503** and **never forwards** a request to Google.
- Redis is required even if the Google Maps API key and access token exist. In their absence `GET /api/google-travel` reports `available:false`.
- No in-memory counters, non-atomic transactions, client-local counters, fail-open paths, caching of raw Google Routes responses, or Google-derived persistent travel minutes.
- Leave the old `DAYFRAME_ROUTES_CLOUD_DAILY_QUOTA_CONFIRMED` unset. It is no longer used; Google Cloud's Compute Routes daily quota is not adjustable for this project.
- Upstash's current free tier provides 500,000 monthly commands and one free database; usage in this design is substantially below that. It must stay on the **Free** plan.

## Additional precautions

- Restrict the Google key to **Routes API only** and rotate it if it was exposed in any chat, screenshot, browser page, frontend JS or public repository. Vercel's preexisting `NEXT_PUBLIC_GOOGLE_CLIENT_ID` is unrelated.
- The private access token is a deterrent against anonymous budget exhaustion, not a substitute for full user authentication. Anyone with the token can spend the remaining capped allowance; rotate it if exposed.
- The Vercel runtime and other services may have their own plan limits. This feature controls **Google Routes API calls originating from Dayframe**, not billing for the hosting account or Redis paid plans.
- The current plan/route interpretation is an informational calculation at request time. Timetables and transfers across independently calculated modes are not guaranteed to connect.
