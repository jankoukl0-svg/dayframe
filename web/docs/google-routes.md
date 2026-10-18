# Google Maps Routes API — voluntary integration

Dayframe is deployed as a static Vite preview build on Vercel. The additional `api/google-travel.ts` Vercel Function proxies Routes API requests. **No Google Maps API key is embedded in browser code.**

## Activation — dedicated 50 requests/day Google Cloud quota (owner action required)

**Google Cloud billing must be enabled; this is a pay-as-you-go product. The goal is to stay below its free tier, not a billing-provider guarantee of zero charges.** Cloud budget alerts do not cap spending.

1. Create or select a **dedicated Google Cloud project used exclusively for Dayframe** and enable billing. Enable **Routes API** only (not Maps JavaScript, Places or Compute Route Matrix). Create a Google Maps Platform API key restricted to **Routes API only**. Never put this key in browser code, an issue, a PR or a chat.
2. In [Google Maps Platform → Quotas](https://console.cloud.google.com/google/maps-apis/quotas), choose this exact Cloud project and **Routes API → Compute Routes**. Set the **requests per day** quota to **50** (NOT 50/minute). Verify the new quota is *active*, not pending. If a daily limit cannot be applied, **do not activate Google Maps in Dayframe**.
3. Set up [Google Cloud Billing → Budgets & alerts](https://console.cloud.google.com/billing) with a low alert e.g. US$1. **Alerts are not hard caps.** Google's Quota and Billing systems can disagree, so use a substantial buffer: 50 × 31 = 1,550 monthly Compute Routes calls versus the current Pro free allowance of 5,000. Current endpoint only uses Essentials/Pro request features, never Enterprise. Avoid sharing the project/key with anything else.
4. Review the shipped [privacy notice](../public/privacy.html), [usage terms](../public/terms.html), [Routes policies](https://developers.google.com/maps/documentation/routes/policies) and [EEA terms](https://cloud.google.com/terms/maps-platform/eea). The owner must verify suitability and accuracy **before enabling billing or making Google API calls**.
5. **Only after the Google Cloud daily quota is verified**, open Vercel project `dayframe2` → Environment Variables. For Production set these server-side encrypted values:
   - `GOOGLE_MAPS_ROUTES_API_KEY`: the restricted server-only Routes API key;
   - `DAYFRAME_ROUTES_ACCESS_TOKEN`: a *different*, securely generated Base64URL/ASCII token with 20+ characters, used to authenticate requests coming from your browser;
   - `DAYFRAME_ROUTES_CLOUD_DAILY_QUOTA_CONFIRMED`: exactly `50`. **This is a fail-closed operator acknowledgement, not an enforcement counter and not evidence Google quota has been set.** Do not configure this flag earlier.
6. Redeploy `main`. The API returns `available:false` and refuses requests with 503 if any setting is missing. When active, open Week → Místo konání and enter the personal access token. The token resides only in browser `sessionStorage`, never the calendar. The Google key never leaves the Vercel function.
7. Once departure, destination, mode and any transfers are selected, the editor calculates individual stages after a debounce. Every stage consumes one of the **50 daily requests**; 3 stages = 3 calls. Displayed Google estimates are temporary and **never persisted**. Jarvis still uses an independently entered planning duration.
8. If the quota is exhausted, Google refuses new API calls, while manual duration entry and Google Maps navigation links remain available. Avoid repeated changes that issue unnecessary requests. Verify usage and billing independently in Google Cloud.

## What the 50/day gate does — and does not do

- **Provider-enforced quota:** Google Cloud's actual *Compute Routes requests/day* quota is the effective usage cap. It applies to the entire Cloud project. The Vercel env flag only prevents Dayframe from starting until the operator claims to have set it. A client-side budget, Vercel environment variable alone, or Cloud budget alert cannot enforce an aggregate per-day usage cap.
- **Tier:** With the current request fields (`DRIVE` with `TRAFFIC_AWARE`, `TRANSIT`, `WALK`, `BICYCLE`, no toll data, traffic polylines or other Enterprise modifiers) the most expensive route request is Pro. Its current free cap is 5,000 per monthly billing period. The 50/day quota keeps usage well below the cap *for this dedicated API and otherwise-unused billing allocation*. Validate SKU/billing changes before broadening the implementation.
- **Safety disclaimer:** Google cautions that Quota and Billing measurements can differ. Charges may still arise from other enabled Google services, shared billing usage, an accidentally raised quota, project/key compromise, or future price changes. No configuration of a pay-as-you-go API is an absolute zero-charge promise.
- **Secrecy:** Use a dedicated restricted key and random personal access token, never the public Google OAuth client ID already used for Google Calendar.

## Caveats
- The map picker still uses OpenStreetMap / Leaflet, **not Google Maps**. Google data is displayed as separate, clearly attributed text, never drawn on the OSM map.
- Driving estimates are `TRAFFIC_AWARE` **at the time of the request**. Walking, cycling and transit routes are not equivalent to a live congestion feed. Mixed journeys request each leg independently for planning, not a synchronized timetable itinerary.
- Google Maps results are ephemeral: Dayframe doesn't copy route durations into any persistent planner field or cache. User-entered travel minutes are a separate manual estimate.
- Jarvis currently works with the manually accepted planning estimate; it does not continuously poll Google Maps. This avoids surprise usage costs and prevents displaying a stale traffic claim.
- A secret in a browser can be extracted by someone with access to that browser. Rotate `DAYFRAME_ROUTES_ACCESS_TOKEN` if exposed.
- Check Vercel's API endpoint deployment before enabling billing. With missing env vars it reports `available:false` and POST returns 503, and the existing manual mode stays usable.
