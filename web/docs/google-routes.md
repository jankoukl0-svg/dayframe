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
5. In Dayframe, go to **Týden → Místo konání** and enter the private access token in the route section. It stays only in browser sessionStorage, not in the schedule. Choose origin, destination and transport, then press **Spočítat trasu** once to request the Google estimate. Changing inputs does not automatically trigger billable requests, and provider results are never persisted.
6. Confirm the Vercel Upstash resource is on **Free**, with **Auto Upgrade disabled**. The presence of credentials does not confirm its tariff; review the database in Upstash before accepting a billing upgrade.
7. Test by selecting one simple route and a multi-leg route; verify the route ETA appears and the corresponding count is recorded in Upstash. For a low-cost test, use a mock Google response in CI (already covered in unit/browser tests). Never reveal tokens in support screenshots or GitHub.
8. Review the [published privacy notice](../public/privacy.html), [terms](../public/terms.html), [Google Routes requirements](https://developers.google.com/maps/documentation/routes/policies), and [Google Maps Platform EEA terms](https://cloud.google.com/terms/maps-platform/eea) before enabling the integration.


## Quick route planner UI

The Week location editor is organized as four short sections: (1) **Odkud a kam?** to select the origin, destination, and optional transit points, (2) **Jak pojedeš?** for direct vs combined transport, (3) **Kdy vyrazit?** for a single explicit Google calculation, and (4) **Uložit plán pro Jarvise** for manually entered customary travel time and reserve.

- The map and geocoding picker appear when selecting/changing a location; saved trips reopen with compact location cards and the picker collapsed. Exact coordinates remain available.
- The session-scoped personal access code is collapsed after valid-format entry and can be edited via **Změnit kód**. This is a UI convenience, not confirmation of provider authorization.
- Advanced transit priorities and transfer buffer are optional; the result first shows time, distance and a short breakdown; stations and alternatives expand on demand.
- On a failed Google connection, the manual trip planner continues to work. Any route estimate is deliberately **read-only and ephemeral**, so the user must enter their own planning minutes for Jarvis.

## Transient provider errors and conservative retries

Google may return a transient HTTP 503 when Compute Routes is unavailable, even if Dayframe's credentials and Upstash limits are healthy. Dayframe now identifies the affected segment and retains earlier successfully calculated segments in component memory only. The user can explicitly request **Zkusit znovu bez alternativ**; this reuses the completed segments when the origin/destination, route settings and 10-minute validity window are unchanged. Failed and remaining segments are recomputed sequentially, with `computeAlternativeRoutes: false` to reduce provider work. The initial failure and any retry each consume a separate atomically reserved Upstash unit per actual Google call. **No automatic retries** and no uncapped provider calls. Failure to recover must allow manual entry as before.

Detailed Google error body text is never forwarded; only provider status, retryability and a fixed Czech error message are exposed. Removing unused turn-by-turn walking instructions from the field mask keeps routing payloads smaller. Neither partial results nor the Google response are persisted.

## Connected transit journeys and alternatives

- The Week location editor offers departure **Now** (calculated when requested) or an explicit local date/time within the next 7 days. Transit preferences and transfer allowances are tucked under **Upřesnit cestu**. All routing uses the explicit **Spočítat trasu** (or **Přepočítat trasu**) button; editing settings, locations or the personal token never triggers paid requests automatically.
- Combined routes are calculated **sequentially**, not in parallel. Each following segment uses the preceding segment's chosen estimate plus a configurable **0–30 minute** parking/transfer allowance (default 5 minutes). This is a planning approximation; it does not guarantee a physical transfer or parking availability.
- Google Routes API `computeAlternativeRoutes: true` can return the primary and up to three alternative routes per request. Dayframe ranks the returned alternatives by the selected criterion (duration by default; transfers or walking distance when requested), displays the top-ranked returned option, and allows comparing others without making extra Google calls. **Not an exhaustive proof of globally fastest transit.**
- Transit preferences are `fastest` (no transit preference sent), `fewer_transfers` (`FEWER_TRANSFERS`) and `less_walking` (`LESS_WALKING`), scoped only to `TRANSIT` calls. Transit steps display sanitized line names, headsigns, stations, provider-local stop times with their time zones, walking sections and transfer counts when the provider supplies them. When no local time zone is available, fallback times are explicitly marked UTC rather than being silently rendered in the user's device zone.
- The displayed trip itinerary now groups consecutive fine-grained WALK turns into one **Pěšky** segment while retaining every train, metro, bus and tram boarding. Vehicle labels use the provider's specific type and a conservative S/R train-line fallback. Stop names and local times are prominent; turn-by-turn pedestrian navigation remains available in Google Maps. Grouping does not change Route API calls, Redis limits, data persistence or Jarvis estimates.
- A stage's transit schedule is computed against that stage's estimated arrival at its starting waypoint, **not** the simultaneous time used by another stage. Actual realtime delays and timetable changes can affect transfers; the user should confirm Google Maps before departure.
- Every segment still calls the same server endpoint, which atomically reserves **one** Upstash unit before contacting Google; requesting alternatives inside that call does **not** multiply the number of Dayframe requests. 50/day, 1,000/month, fail-closed Redis, server-only Google credentials, the access token and the manual planner are unchanged.
- Both route alternatives and transit timetable details are only held in component state during editing. They are **not persisted** into the Dayframe travel store or silently copied into Jarvis' planning duration.
- Google Maps Platform prices and SKU conditions can change; extra route fields and routing options need pricing review. No absolute guarantee of zero fees. Avoid enabling additional services or increasing existing limits.

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


### More useful recovery from Google 503

The first Compute Routes request keeps the usual traffic-aware routing, scheduled departure time and optional alternative routes. If Google replies HTTP 503, Dayframe keeps successfully completed legs and offers a **manual**, budgeted retry. For `DRIVE` only, that retry now requests `TRAFFIC_UNAWARE`, omits the prediction departure time and disables alternatives. This is an **average time-independent duration** and is labeled clearly; it does **not** include current traffic, congestion or predictions for the requested future time. For `TRANSIT`, the retry keeps its departure time to preserve meaningful scheduled boarding and only drops alternatives. Upstash daily/monthly caps remain mandatory for every provider request. No automatic retries are triggered and no route details are stored.

When Google returns an error, Dayframe may display only validated uppercase protocol identifiers such as `UNAVAILABLE` and safe ErrorInfo reason codes. It never forwards Google's raw error message, response body, address, route payload or credentials. When the service stays unavailable, the failing segment can always be opened directly in Google Maps using the existing external directions link. Provider errors can still happen; this mechanism does not guarantee recovery.


### Restore the known-working basic driving request

After introducing route alternatives, the app began observing repeated Google `503 / UNAVAILABLE` errors on otherwise ordinary driving journeys. Google Maps Platform's public status page did not report a widespread Routes API incident, and Vercel runtime log access was unavailable (permission denied), so the exact upstream root cause was not established.

To reduce variables while keeping the service useful, Dayframe now sends its **previously working basic Google Routes request** for driving, walking and cycling: no alternative routes, with the same two-field response mask. In the **Co nejdřív (teď)** case for the first driving segment, it omits an explicit `departureTime`, letting Google use the request time; driving remains `TRAFFIC_AWARE`. For a scheduled driving journey, the specified `departureTime` remains; for MHD stages and subsequent transfers, sequential times are still sent, and MHD alternatives remain available. A failed call can still be retried explicitly with `TRAFFIC_UNAWARE`; provider diagnostics remain sanitized and quotas unchanged. This is a troubleshooting rollback of unnecessary request complexity, **not proof** the Google upstream failure is fixed.
