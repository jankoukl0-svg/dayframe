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


## Comfort-first public transport and parking alternatives

- **Pohodlná cesta** is the default for MHD. The server asks Google's transit routing for `LESS_WALKING` and ranks only the routes actually returned by Google using a transparent composite of trip duration, walking metres and number of transfers (with extra penalty for 1.2 km+ walking). The user can still choose `fastest`, `fewer_transfers`, or `less_walking` under advanced settings. The balanced result is a ranking of Google's available options, **not a guarantee of globally optimal transport**.
- In the summary, Dayframe explicitly displays walking metres and transfers next to lines. A computed transit segment with over 1 km of walking gets a practical warning. For simple DRIVE → TRANSIT journeys whose manually selected interchange is within 8 km of the official Černý Most P+R garage and whose destination is in its wider Prague catchment, the warning offers an alternate interchange: official garage entrance 50.1102028, 14.5794097 (source: `https://parking.praha.eu/cs/moznosti-parkovani-v-praze/pr-park-ride/cerny-most/`).
- Clicking **Zkusit P+R Černý Most** changes only the draft interchange coordinate; the user must explicitly click **Spočítat trasu** to spend the two new Google stage requests. This intentionally makes API spending visible and avoids implicit fees. It does not guarantee an available parking space, a valid real-time metro schedule, the most comfortable possible interchange, or a particular route. The original interchange isn't automatically persisted until the user saves the location.
- Later possibilities: richer parking discovery with live occupancy or authoritative tariffs requires local providers; do not silently use paid Places API or invent other parkings.


### Compare a metro B alternative when Google suggests rail and buses instead

For a final TRANSIT stage whose start is within 3 km of the official P+R Černý Most garage (50.1102028, 14.5794097) and destination is in the wider Prague area, show an **A co metro B?** comparison when Google's selected route does not use a subway (or requires multiple transfers).

1. If the *existing* Google options already contain a subway segment, compare that option for **zero new calls**.
2. Otherwise offer one **user-triggered** `POST /api/google-travel` on the *TRANSIT stage only*, keeping the same exact stage endpoints and departure time, preserving the applied routing preference, and adding `transitTravelModes: "metro"`. If the original stage departure is already more than two minutes old, Dayframe prompts for a fresh full calculation instead of spending a request on a stale comparison. Google gets `transitPreferences.allowedTravelModes: ["SUBWAY","BUS","LIGHT_RAIL"]` plus its normal routing preference. **Google documents this as a preference, not a guarantee of an actual metro route.** Do not claim a metro route if no step is classified as `SUBWAY` or `METRO_RAIL`.
3. If Google returns a verified subway, render old and metro alternatives side by side with total minutes, transfer count, and walking metres. Switching locally between these calculated results uses **no further Google calls**, updates the displayed trip time and never persists the provider estimate as Jarvis's normal journey duration.
4. If Google does not provide a subway, display that limitation clearly instead of inventing an itinerary; allow the user to choose the official P+R garage near the station as a separate change to draft route geometry.
5. Every provider request, including the metro comparison, still uses the atomic Redis reservation (50/day and 1000/month). No auto background scans, additional keys, or route storage. Metro comparison does not rerun the driving stage.

The limitation is structural: Google Routes returns only a restricted selection of transit alternatives; ordinary `LESS_WALKING` does not force subway. Explicit comparison makes metro visible when Google will actually supply it without claiming a globally optimal route.


### One-click interchange at P+R Černý Most

- If origin is more than 8 km from the verified P+R Černý Most coordinate and the destination is within 26 km, step **Jak pojedeš?** offers a compact **Auto → P+R Černý Most → MHD** preset. These distance thresholds are a convenience heuristic, not a claim of optimal parking.
- A click creates a draft DRIVE stage ending at the known P+R and a TRANSIT stage ending at the event. It does not call Google, persist the trip, assume parking is available, or populate an invented travel duration. Previously entered manual minutes are kept only if the same preset was already selected; switching from another itinerary clears them.
- The user must explicitly calculate the route (two counted Google requests) and enter planning minutes before saving the trip for Jarvis. Google may still return a train or bus instead of subway; the itinerary must reflect the actual response.
- In the existing **A co metro B?** comparison, an option is eligible as metro B only when Google returns a subway boarding with line **B** (or **Metro B**). A route on A or C cannot be relabeled as B, regardless of the requested transit mode preference.


## Destination-based parking discovery (OpenStreetMap, any locality)

- The Week editor automatically searches a **1.8 km** radius around a selected offsite destination for trips beginning by car; the user may increase the radius to **4 km**. Existing drive → transit plans can additionally search around their interchange. No Google Routes call occurs during discovery or sorting. No provider API credentials are needed.
- Server route `GET /api/parking?lat=...&lon=...&radius=1800|4000` calls a fixed OpenStreetMap Overpass endpoint, with validated coordinates, bounded results, an 11 s timeout, two maximum simultaneous requests per process, 30-minute in-process cache and CDN cache. Requests are debounced and canceled in the UI when the destination changes. This public Overpass service is **best effort** and intended for modest app usage, not an SLA-backed commercial location database; if the app scales, replace it with licensed/hosted OSM extracts.
- Parking records reflect OSM `amenity=parking`, `access`, `fee`, `charge` and `park_ride` tags. Private/permit-only lots are excluded. A literal unconditional `fee=no` without charges can show **Zdarma dle OSM**. A simple unambiguous `charge=NN CZK/hour` (also EUR/USD/GBP/CHF/PLN) allows showing a rate and *approximate* duration multiplication. Conditional/complex tariffs show **Placené · sazba neznámá**, missing fees **Cena neuvedena**. Prices are neither live nor necessarily complete. Never rank different currencies by bare numeric amount; multiple currencies are grouped, so the result does not represent a converted cross-currency cheapest price.
- The parking chooser offers **nearest**, **known price** and **tagged free only** filters, as well as a duration hint. Straight-line distance is labeled **vzdušnou čarou**; OSM polygon centers are only representative coordinates, not verified vehicle entrances. Site fees, parking restrictions, capacity, road entrance, accessibility and live availability must be checked by the traveller.
- Choosing a parking point prepares a draft **DRIVE → WALK** journey ending at the original event. For an existing exactly two-leg **DRIVE → TRANSIT** trip, it preserves the transit mode. Previously entered per-leg times are reset unless the same parking is selected again; the Google route is still explicitly requested by button and billable stage count remains governed by the existing Redis 50/day and 1,000/month limits.
- Real authoritative tariffs by city, garage and time period, as well as space availability and integrated comparison of car+walking+transit options, remain future additions. Do not claim to have complete pricing data for any city.


## Simpler transit: metro-only and real selectable Google alternatives

- **Google does not support intermediate waypoints for TRANSIT**, so the itinerary cannot be forced to pass Florenc via a regular waypoint. Nor does a `transitPreferences.allowedTravelModes` request guarantee the supplied mode. The UI must never manufacture B → C → Hlavní nádraží if Google returns only B → tram.
- The backend supports explicit `transitTravelModes:"subway_only"` on one TRANSIT stage. This sends a `["SUBWAY"]` mode preference and `FEWER_TRANSFERS`, but **does not guarantee only subway**. The server ranks returned all-subway connections first where present; the client independently checks that every boarding is `SUBWAY`/`METRO_RAIL`. Only those can be selected as **pouze metro**.
- The ordinary balanced transit ranking now modestly penalizes a switch between bus/rail/metro/tram vehicle types (seven equivalent minutes per change), in addition to its existing travel time, walking and transfers. It does not claim a universally optimal trip and never changes the raw Google-reported duration.
- Once a user has explicitly calculated a trip, they can choose any **already returned transit alternative** at no additional API cost; the journey summary, displayed itinerary and live total update. This is limited to the last TRANSIT stage to avoid invalidating downstream stage schedules.
- The **Raději jen metrem?** section appears for transit journeys not already all-subway. First reuses an existing fully subway Google option for free. Otherwise, after a **user click**, requests the current TRANSIT stage again at the *identical departure timestamp*, spending **one** of the existing atomic Redis quotas (50/day and 1,000/month) but not re-running the driving leg. It rejects expired comparisons, shows why none was found, and allows reverting without another Google call.
- Detailed route ETAs are temporary and not saved as Jarvis planning durations. Google can omit fully-metro paths, even where such trips physically exist. A more complete multimodal trip search needs an authoritative GTFS-based journey planner or a richer routing provider, not invented timetables.


## Travel as real Week calendar time (opt-in return)

- **Each saved offsite event with a valid start and end** and known route duration produces a visually distinct **Cesta tam** time reservation in Week: `[eventStart - (selectedGoogleMinutes || manuallyEnteredMinutes) - bufferMinutes, eventStart]`. The buffer is deliberately included in reserved time.
- **Přidat cestu domů po skončení bloku** is off by default. Once enabled, the projected **Cesta domů** occupies `[eventEnd,eventEnd + returnMinutes]`. For a normal route it is assumed to have the *reverse leg order* but its duration must not be presented as verified unless an actual opposite-direction request succeeded. Without such a request, use and label the outward ETA as an **estimate**, or allow an explicit manual duration.
- **Spočítat zpáteční trasu** is user-initiated; each reversed segment consumes one of the same Redis-budgeted Google calls. Reverse the actual car/transit/walk stages (dest → start via original intermediate locations in reverse order). For public transport, route service and timings can differ by direction, so never claim that a reversed outward itinerary is a real checked return service.
- Persist only per-block calendar duration, optional return duration, source-verification boolean and checkbox; do not persist access secret, Directions response, station list or traffic provider route geometry. Old travel entries are backward compatible.
- Projection derives the *live parent appointment* date/start/end from Week tasks, Gym occurrences and Hygiene routine blocks. Moving/deleting an event repositions/removes its projected travel; travel is not saved as a standalone completable task.
- Planning and reprojection use travel time as unavailable for adding manual/automatic tasks, week recalculation and drag/drop + Hygiene repositioning. Already-overlapping manual entries are visual conflicts; do not silently reschedule finished/manual events.
- Week calendar's standard visible hours are 08:00–02:00. Reservations partly outside those bounds still count for collision calculations but their visible portion is clipped; the visual label should clearly indicate any portion outside the view.
- Changing the saved place/time may require a new **explicit** Google calculation. Cached duration is an estimate at a prior departure time, not a live journey ETA. Times are snapshots and cannot guarantee future traffic, schedules or parking availability.


## Direct route time reservation (car, walk, bicycle, MHD)

- The **same one-stage time reservation** is used for all travel modes. When a user explicitly runs Google Routes, the returned minutes populate the saved planning duration, and Week projects outbound time + buffer before the parent event, with an optional return after the parent event. Without Google, a manually entered positive duration does the same.
- An offsite event with a known origin, destination and start/end must not silently save a single-mode trip without its duration. Present an actionable warning, and offer a separately labeled **Uložit pouze místo (bez cesty)** for intentional location-only records. Do not fabricate travel times or make a paid Google call on save.
- Older saved location-only trips still parse and remain editable. Their Week location pins use an **⏱** indicator until a positive duration is supplied. Missing duration means no calendar minutes can be claimed.
- Switching from combined to direct, or switching the direct mode, clears stale manual ETA and return verification. A car ETA must never be silently repurposed as a walking, cycling or transit estimate.
- The 50/day, 1,000/month protected paid Google Routes limits stay unchanged. E2E coverage includes each direct mode using both manual and explicitly calculated ETAs.
