# Google Maps Routes API — voluntary integration

Dayframe is deployed as a static Vite preview build on Vercel. The additional `api/google-travel.ts` Vercel Function proxies Routes API requests. **No Google Maps API key is embedded in browser code.**

## Activation (requires project owner)
1. Create/select a Google Cloud project and enable billing. Enable **Routes API** (not merely Maps JavaScript API).
2. Create a Google Maps Platform API key, restrict it to **Routes API only**, and set a low per-day request quota and a cost budget alert. Routes API requests are billable. Do not paste the key into the Dayframe UI, a GitHub issue, PR, or chat.
3. In Vercel project `dayframe2`, set these **server-side, encrypted** environment variables for Production (and Preview if needed):
   - `GOOGLE_MAPS_ROUTES_API_KEY` = restricted Routes API key
   - `DAYFRAME_ROUTES_ACCESS_TOKEN` = **separate random Base64URL/ASCII secret of at least 20 characters**, used to protect against unauthenticated API abuse. This is *not* the Google API key.
4. Redeploy the `main` branch. Open a Week block → Místo konání. Once the server status is active, supply the **access token** to the private input once per browser session. It stays in `sessionStorage` (not the calendar or travel store).
5. Once origin, destination and (if applicable) transfer stops are selected, Dayframe makes one request per leg after a short debounce. The displayed minutes and distance are attributed **Google Maps** and are **never saved**. You may enter your own planning-time estimate independently; Jarvis uses that user-entered value.
6. The app includes public disclosures at `/privacy.html` and `/terms.html`. **The project owner must review their accuracy and suitability before enabling billing.** Review the [Google Maps Platform Routes API policy](https://developers.google.com/maps/documentation/routes/policies), [EEA terms](https://cloud.google.com/terms/maps-platform/eea), required public terms/privacy disclosures and quotas before turning on a production integration.

## Caveats
- The map picker still uses OpenStreetMap / Leaflet, **not Google Maps**. Google data is displayed as separate, clearly attributed text, never drawn on the OSM map.
- Driving estimates are `TRAFFIC_AWARE` **at the time of the request**. Walking, cycling and transit routes are not equivalent to a live congestion feed. Mixed journeys request each leg independently for planning, not a synchronized timetable itinerary.
- Google Maps results are ephemeral: Dayframe doesn't copy route durations into any persistent planner field or cache. User-entered travel minutes are a separate manual estimate.
- Jarvis currently works with the manually accepted planning estimate; it does not continuously poll Google Maps. This avoids surprise usage costs and prevents displaying a stale traffic claim.
- A secret in a browser can be extracted by someone with access to that browser. Rotate `DAYFRAME_ROUTES_ACCESS_TOKEN` if exposed.
- Check Vercel's API endpoint deployment before enabling billing. With missing env vars it reports `available:false` and POST returns 503, and the existing manual mode stays usable.
