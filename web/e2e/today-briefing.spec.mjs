import { test, expect } from "@playwright/test";

const FIXED_NOW = new Date("2026-10-02T15:00:00Z");

function planningDateKeyInBrowser() {
  const now = new Date();
  const date = new Date(now);
  if (now.getHours() < 2) date.setDate(date.getDate() - 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

async function mockWeather(page, overrides = {}) {
  const payload = {
    current: {
      temperature_2m: 18.4,
      apparent_temperature: 17.1,
      weather_code: 2,
      wind_speed_10m: 12.2,
    },
    daily: {
      temperature_2m_max: [21.2],
      temperature_2m_min: [10.8],
      precipitation_probability_max: [20],
      sunrise: ["2026-10-02T06:58"],
      sunset: ["2026-10-02T18:40"],
    },
    ...overrides,
  };
  await page.route("https://api.open-meteo.com/**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payload) });
  });
}

async function seedWeatherLocation(page) {
  await page.evaluate(() => {
    window.localStorage.setItem("dayframe-weather-location-v1", JSON.stringify({
      latitude: 50.4,
      longitude: 14.9,
      acquiredAt: Date.now(),
    }));
  });
}

async function openFreshToday(page) {
  const baseUrl = process.env.DAYFRAME_BASE_URL || "http://127.0.0.1:4173";
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.evaluate(() => window.localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
  await expect.poll(() => page.evaluate(() => Boolean(window.localStorage.getItem("dayframe-v1")))).toBe(true);
}

async function openBriefing(page) {
  const launcher = page.locator("[data-today-briefing-launcher]");
  await expect(launcher).toBeVisible();
  await launcher.click();
  const modal = page.locator("[data-today-briefing-modal]");
  await expect(modal).toBeVisible();
  await expect(modal.getByRole("dialog", { name: "Ranní briefing" })).toBeVisible();
  return modal.locator("[data-today-briefing]");
}


test("Jarvis shows the next 24 hours and uses their weather changes for outfit advice", async ({ page }) => {
  await page.clock.setFixedTime(FIXED_NOW);
  const start = new Date("2026-10-02T15:00:00Z");
  const times = Array.from({ length: 40 }, (_, i) =>
    Math.floor((start.getTime() + i * 3_600_000) / 1000));
  const temperatures = times.map((_, i) => i <= 12 ? 19 - i : 7 + Math.round((i - 12) * 0.5));
  let requested = false;
  await page.route("https://api.open-meteo.com/**", async (route) => {
    const url = new URL(route.request().url());
    expect(url.searchParams.get("hourly")).toContain("temperature_2m");
    expect(url.searchParams.get("hourly")).toContain("precipitation_probability");
    expect(url.searchParams.get("forecast_days")).toBe("3");
    expect(url.searchParams.get("timeformat")).toBe("unixtime");
    requested = true;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        timezone: "Europe/Prague",
        current: { time: Date.parse("2026-10-02T20:15:00Z") / 1000, temperature_2m: 14, apparent_temperature: 12, weather_code: 3, wind_speed_10m: 15 },
        daily: { temperature_2m_max: [19], temperature_2m_min: [7], precipitation_probability_max: [75], sunrise: [Date.parse("2026-10-02T05:00:00Z") / 1000], sunset: [Date.parse("2026-10-02T16:00:00Z") / 1000] },
        hourly: {
          time: times,
          temperature_2m: temperatures,
          apparent_temperature: temperatures.map((n) => n - 2),
          weather_code: times.map((_, i) => i >= 16 && i <= 19 ? 61 : 3),
          precipitation_probability: times.map((_, i) => i >= 16 && i <= 19 ? 75 : 12),
          wind_speed_10m: times.map((_, i) => i >= 16 && i <= 19 ? 39 : 11),
        },
      }),
    });
  });
  await openFreshToday(page);
  await seedWeatherLocation(page);
  await page.reload({ waitUntil: "networkidle" });
  const briefing = await openBriefing(page);
  const weather = briefing.locator(".df2-jarvis-weather");
  const hourly = weather.locator("[data-jarvis-hourly]");
  await expect(hourly).toBeVisible();
  await expect(hourly).toContainText("Dalších 24 hodin");
  const points = hourly.locator("[data-jarvis-hour]");
  await expect(points).toHaveCount(8);
  await expect(hourly).toHaveAttribute("data-jarvis-hour-count", "24");
  await expect(points.first()).toHaveAttribute("data-jarvis-hour", "2026-10-02T23:00");
  await expect(points.nth(1)).toHaveAttribute("data-jarvis-hour", "2026-10-03T02:00");
  await expect(hourly).toContainText("zítra");
  await expect(points.nth(4)).toContainText("75 %");
  await expect(weather.locator("[data-jarvis-outfit]")).toContainText("bunda");
  await expect(weather.locator("[data-jarvis-outfit]")).toContainText("deštník");
  await expect(weather.locator("[data-jarvis-outfit]")).toContainText("větrem");
  await expect(hourly).toContainText("Rozmezí");
  expect(requested).toBe(true);
  const overflow = await hourly.locator(".df2-jarvis-hourly-scroll").evaluate((node) =>
    ({ content: node.scrollWidth, viewport: node.clientWidth }));
  expect(overflow.content).toBeGreaterThanOrEqual(overflow.viewport);
});

test("Jarvis hourly slots keep the correct local clock when winter time begins", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-10-25T00:30:00Z"));
  const from = Date.parse("2026-10-24T22:00:00Z") / 1000;
  const times = Array.from({ length: 48 }, (_, i) => from + i * 3600);
  await page.route("https://api.open-meteo.com/**", (route) => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({
      timezone: "Europe/Prague",
      current: { time: Date.parse("2026-10-25T00:30:00Z") / 1000, temperature_2m: 9, apparent_temperature: 7, weather_code: 3, wind_speed_10m: 10 },
      daily: { temperature_2m_max: [12], temperature_2m_min: [5], precipitation_probability_max: [10], sunrise: [Date.parse("2026-10-25T05:30:00Z") / 1000], sunset: [Date.parse("2026-10-25T15:00:00Z") / 1000] },
      hourly: {
        time: times,
        temperature_2m: times.map(() => 9),
        apparent_temperature: times.map(() => 7),
        weather_code: times.map(() => 3),
        precipitation_probability: times.map(() => 10),
        wind_speed_10m: times.map(() => 10),
      },
    }),
  }));
  await openFreshToday(page);
  await seedWeatherLocation(page);
  await page.reload({ waitUntil: "networkidle" });
  const weather = (await openBriefing(page)).locator(".df2-jarvis-weather");
  const slots = weather.locator("[data-jarvis-hour]");
  await expect(slots).toHaveCount(8);
  await expect(slots.first()).toHaveAttribute("data-jarvis-hour", "2026-10-25T02:00");
  await expect(slots.nth(1)).toHaveAttribute("data-jarvis-hour", "2026-10-25T05:00");
  await expect(weather.locator(".df2-jarvis-weather-metrics")).toContainText("06:30");
  await expect(weather.locator(".df2-jarvis-weather-metrics")).toContainText("16:00");
});

test("Jarvis covers the full 24 real hours across spring daylight-saving change", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2027-03-27T22:30:00Z"));
  const start = Date.parse("2027-03-27T20:00:00Z") / 1000;
  const times = Array.from({ length: 65 }, (_, i) => start + i * 3600);
  await page.route("https://api.open-meteo.com/**", (route) => {
    expect(new URL(route.request().url()).searchParams.get("forecast_days")).toBe("3");
    return route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({
        timezone: "Europe/Prague",
        current: { time: Date.parse("2027-03-27T22:30:00Z") / 1000, temperature_2m: 7, apparent_temperature: 5, weather_code: 2, wind_speed_10m: 8 },
        daily: { temperature_2m_max: [15], temperature_2m_min: [4], precipitation_probability_max: [10], sunrise: [Date.parse("2027-03-28T04:50:00Z") / 1000], sunset: [Date.parse("2027-03-28T17:20:00Z") / 1000] },
        hourly: {
          time: times,
          temperature_2m: times.map(() => 8),
          apparent_temperature: times.map(() => 6),
          weather_code: times.map(() => 2),
          precipitation_probability: times.map(() => 10),
          wind_speed_10m: times.map(() => 8),
        },
      }),
    });
  });
  await openFreshToday(page);
  await seedWeatherLocation(page);
  await page.reload({ waitUntil: "networkidle" });
  const view = (await openBriefing(page)).locator(".df2-jarvis-weather [data-jarvis-hourly]");
  await expect(view).toHaveAttribute("data-jarvis-hour-count", "24");
  const slots = view.locator("[data-jarvis-hour]");
  await expect(slots).toHaveCount(8);
  await expect(slots.first()).toHaveAttribute("data-jarvis-hour", "2027-03-28T00:00");
  await expect(slots.nth(1)).toHaveAttribute("data-jarvis-hour", "2027-03-28T04:00");
  await expect(slots.last()).toHaveAttribute("data-jarvis-hour", "2027-03-28T22:00");
});

test("Jarvis handles missing hourly data without inventing an outfit forecast", async ({ page }) => {
  await page.clock.setFixedTime(FIXED_NOW);
  await mockWeather(page);
  await openFreshToday(page);
  await seedWeatherLocation(page);
  await page.reload({ waitUntil: "networkidle" });
  const weather = (await openBriefing(page)).locator(".df2-jarvis-weather");
  await expect(weather).toContainText("18°");
  await expect(weather.locator("[data-jarvis-hourly]")).toHaveCount(0);
  await expect(weather.locator("[data-jarvis-outfit]")).toHaveCount(0);
  await expect(weather.locator("[data-jarvis-hourly-unavailable]")).toBeVisible();
});


async function seedJarvisSupplements(page, date, rows) {
  await page.evaluate(({ date, rows }) => {
    const supplements = rows.map((item, index) => {
      const weekdays = [0,1,2,3,4,5,6];
      return {
        id: "supp-jarvis-" + index,
        scheduleHistory: [{ effectiveFrom: date, weekdays, times: item.times, active: true }],
        name: item.name, brand: "Test", doseLabel: "Podle etikety",
        servingsPerIntake: 1, units: "kapsle", weekdays, times: item.times,
        active: true, stock: item.stock ?? 5, lowStockAt: 1, packServings: 30,
        packPriceCzk: null, sourceUrl: "", notes: "", shopping: false,
      };
    });
    localStorage.setItem("dayframe-supplements-v1",JSON.stringify({version:1,supplements,intakes:[],purchases:[]}));
    window.dispatchEvent(new Event("dayframe-supplements-sync"));
  },{date,rows});
}

test("Jarvis keeps weather and replaces duplicated planner cards with situational supplements",async({page})=>{
  await page.clock.setFixedTime(FIXED_NOW);
  await mockWeather(page);
  await openFreshToday(page);
  await seedWeatherLocation(page);
  const date=await page.evaluate(planningDateKeyInBrowser);
  await seedJarvisSupplements(page,date,[{name:"Zinek",times:["22:00"]}]);
  const briefing=await openBriefing(page);
  await expect(briefing).toContainText("JARVIS · LIVE");
  await expect(briefing.locator(".df2-jarvis-weather")).toContainText("18°");
  await expect(briefing.locator("[data-jarvis-supplements]")).toBeVisible();
  await expect(briefing.locator("[data-jarvis-supplements]")).toContainText("Teď není žádný suplement k užití");
  await expect(briefing.locator("[data-jarvis-supplement-key]")).toHaveCount(0);
  await expect(briefing.locator(".df2-jarvis-command")).toHaveCount(0);
  await expect(briefing.locator(".df2-briefing-signals")).toHaveCount(0);
  await expect(briefing.locator(".df2-jarvis-sequence")).toHaveCount(0);
  await expect(briefing.locator(".df2-jarvis-insight")).toHaveCount(0);
  const close=page.getByRole("button",{name:"Zavřít briefing"});
  await expect(close).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-today-briefing-modal]")).toHaveCount(0);
  await expect(page.locator("[data-today-briefing-launcher]")).toBeFocused();
  await openBriefing(page);
  await page.keyboard.press("w");
  await expect(page.locator("[data-today-briefing-modal]")).toHaveCount(0);
  await expect(page.getByRole("heading",{name:"Týden"})).toBeVisible();
});

test("supplement appears only once its assigned time arrives and syncs an intake",async({page})=>{
  await page.clock.setFixedTime(new Date("2026-10-02T21:59:00Z"));
  await mockWeather(page);
  await openFreshToday(page);
  await seedWeatherLocation(page);
  const date=await page.evaluate(planningDateKeyInBrowser);
  await seedJarvisSupplements(page,date,[{name:"Zinek",times:["22:00"],stock:3}]);
  const briefing=await openBriefing(page);
  const card=briefing.locator("[data-jarvis-supplements]");
  await expect(card.locator("[data-jarvis-supplement-key]")).toHaveCount(0);
  await page.clock.setFixedTime(new Date("2026-10-02T22:00:00Z"));
  await page.evaluate(()=>window.dispatchEvent(new Event("dayframe-supplements-sync")));
  await expect(card.locator("[data-jarvis-supplement-key]")).toHaveCount(1);
  await expect(card).toContainText("Zinek");
  await expect(card).toContainText("22:00");
  await card.getByRole("button",{name:"Užito: Zinek (22:00)"}).click();
  await expect(card.locator("[data-jarvis-supplement-key]")).toHaveCount(0);
  const store=await page.evaluate(()=>JSON.parse(localStorage.getItem("dayframe-supplements-v1")));
  expect(store.intakes).toHaveLength(1);
  expect(store.intakes[0].status).toBe("taken");
  expect(store.intakes[0].time).toBe("22:00");
  expect(store.supplements[0].stock).toBe(2);
  await page.reload({waitUntil:"networkidle"});
  const reloaded=await openBriefing(page);
  await expect(reloaded.locator("[data-jarvis-supplement-key]")).toHaveCount(0);
});

test("Jarvis shows only pending doses whose times passed, skips without deducting stock and reacts to external check-ins",async({page})=>{
  await page.clock.setFixedTime(new Date("2026-10-02T15:00:00Z"));
  await mockWeather(page);
  await openFreshToday(page);
  await seedWeatherLocation(page);
  const date=await page.evaluate(planningDateKeyInBrowser);
  await seedJarvisSupplements(page,date,[
    {name:"Omega 3",times:["14:00"],stock:5},
    {name:"Magnesium",times:["14:30","22:00"],stock:5},
    {name:"Zinek",times:["22:00"],stock:5},
  ]);
  const briefing=await openBriefing(page);
  const card=briefing.locator("[data-jarvis-supplements]");
  await expect(card.locator("[data-jarvis-supplement-key]")).toHaveCount(2);
  await expect(card).toContainText("Omega 3");
  await expect(card).toContainText("Magnesium");
  await expect(card).not.toContainText("Zinek");
  await card.getByRole("button",{name:"Vynechat: Omega 3 (14:00)"}).click();
  await expect(card.locator("[data-jarvis-supplement-key]")).toHaveCount(1);
  await page.evaluate(()=>{
    const store=JSON.parse(localStorage.getItem("dayframe-supplements-v1"));
    const magnesium=store.supplements.find(x=>x.name==="Magnesium");
    const date=magnesium.scheduleHistory[0].effectiveFrom;
    store.intakes.push({
      key:magnesium.id+"|"+date+"|14:30",supplementId:magnesium.id,
      date,time:"14:30",status:"taken",recordedAt:new Date().toISOString(),
      servings:1,stockDeducted:1,
    });
    magnesium.stock-=1;
    localStorage.setItem("dayframe-supplements-v1",JSON.stringify(store));
    window.dispatchEvent(new Event("dayframe-supplements-sync"));
  });
  await expect(card.locator("[data-jarvis-supplement-key]")).toHaveCount(0);
  const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem("dayframe-supplements-v1")));
  expect(saved.intakes.map(x=>x.status)).toEqual(["skipped","taken"]);
  expect(saved.supplements.find(x=>x.name==="Omega 3").stock).toBe(5);
});

test("Jarvis understands after-midnight doses before Dayframe planning day closes at 02:00",async({page})=>{
  await page.clock.setFixedTime(new Date("2026-10-03T00:59:00Z"));
  await mockWeather(page);
  await openFreshToday(page);
  await seedWeatherLocation(page);
  const date=await page.evaluate(planningDateKeyInBrowser);
  expect(date).toBe("2026-10-02");
  await seedJarvisSupplements(page,date,[{name:"Noční doplněk",times:["01:00"]}]);
  const briefing=await openBriefing(page);
  await expect(briefing.locator("[data-jarvis-supplement-key]")).toHaveCount(0);
  await page.clock.setFixedTime(new Date("2026-10-03T01:00:00Z"));
  await page.evaluate(()=>window.dispatchEvent(new Event("dayframe-supplements-sync")));
  const row=briefing.locator("[data-jarvis-supplement-key]");
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("01:00");
  await row.getByRole("button",{name:"Užito: Noční doplněk (01:00)"}).click();
  await expect(row).toHaveCount(0);
  await page.clock.setFixedTime(new Date("2026-10-03T02:01:00Z"));
  await page.evaluate(()=>window.dispatchEvent(new Event("dayframe-supplements-sync")));
  await expect(briefing.locator("[data-jarvis-supplement-key]")).toHaveCount(0);
});

test("supplements at 03:00 arrive exactly at their time, not after 08:00",async({page})=>{
  await page.clock.setFixedTime(new Date("2026-10-02T02:59:00Z"));
  await mockWeather(page);
  await openFreshToday(page);
  await seedWeatherLocation(page);
  const date=await page.evaluate(planningDateKeyInBrowser);
  await seedJarvisSupplements(page,date,[{name:"Ranní test",times:["03:00"]}]);
  const briefing=await openBriefing(page);
  const card=briefing.locator("[data-jarvis-supplements]");
  await expect(card.locator("[data-jarvis-supplement-key]")).toHaveCount(0);
  await page.clock.setFixedTime(new Date("2026-10-02T03:00:00Z"));
  await page.evaluate(()=>window.dispatchEvent(new Event("dayframe-supplements-sync")));
  await expect(card.locator("[data-jarvis-supplement-key]")).toHaveCount(1);
  await expect(card).toContainText("Ranní test");
});

test("Jarvis supplement action buttons are keyboard reachable inside the modal focus trap",async({page})=>{
  await page.clock.setFixedTime(new Date("2026-10-02T22:30:00Z"));
  await mockWeather(page);
  await openFreshToday(page);
  await seedWeatherLocation(page);
  const date=await page.evaluate(planningDateKeyInBrowser);
  await seedJarvisSupplements(page,date,[{name:"Zinek",times:["22:00"]}]);
  const briefing=await openBriefing(page);
  const close=page.getByRole("button",{name:"Zavřít briefing"});
  const taken=briefing.getByRole("button",{name:"Užito: Zinek (22:00)"});
  const skipped=briefing.getByRole("button",{name:"Vynechat: Zinek (22:00)"});
  await expect(close).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(taken).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(skipped).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(skipped).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(briefing.locator("[data-jarvis-supplement-key]")).toHaveCount(0);
  const state=await page.evaluate(()=>JSON.parse(localStorage.getItem("dayframe-supplements-v1")));
  expect(state.intakes[0].status).toBe("skipped");
});

test("Jarvis weather remains useful even if no supplements are configured",async({page})=>{
  await page.clock.setFixedTime(FIXED_NOW);
  await mockWeather(page,{current:{temperature_2m:9,apparent_temperature:7,weather_code:61,wind_speed_10m:18},
    daily:{temperature_2m_max:[11],temperature_2m_min:[6],precipitation_probability_max:[85],
      sunrise:["2026-10-02T06:58"],sunset:["2026-10-02T18:40"]}});
  await openFreshToday(page);
  await seedWeatherLocation(page);
  const briefing=await openBriefing(page);
  await expect(briefing.locator(".df2-jarvis-weather")).toContainText("Déšť");
  await expect(briefing.locator("[data-jarvis-supplements]")).toContainText("Teď není žádný suplement k užití");
});
