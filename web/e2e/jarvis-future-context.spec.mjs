import { test, expect } from "@playwright/test";

const BASE_URL = process.env.DAYFRAME_BASE_URL || "http://127.0.0.1:4173";
const FIXED_NOW = new Date("2026-10-02T15:00:00Z");

function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function addDaysKey(key, amount) {
  const date = new Date(`${key}T12:00:00`);
  date.setDate(date.getDate() + amount);
  return dateKey(date);
}

function planningDateKeyInBrowser() {
  const now = new Date();
  const date = new Date(now);
  if (now.getHours() < 2) date.setDate(date.getDate() - 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

async function mockWeather(page) {
  await page.route("https://api.open-meteo.com/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        current: { temperature_2m: 14, apparent_temperature: 13, weather_code: 2, wind_speed_10m: 8 },
        daily: {
          temperature_2m_max: [18],
          temperature_2m_min: [9],
          precipitation_probability_max: [15],
          sunrise: ["2026-10-02T07:01"],
          sunset: ["2026-10-02T18:31"],
        },
      }),
    });
  });
}

async function openFresh(page) {
  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await page.evaluate(() => window.localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
  await expect.poll(() => page.evaluate(() => Boolean(window.localStorage.getItem("dayframe-v1")))).toBe(true);
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

async function openBriefing(page) {
  const launcher = page.locator("[data-today-briefing-launcher]");
  await expect(launcher).toBeVisible();
  await launcher.click();
  const briefing = page.locator("[data-today-briefing]");
  await expect(briefing).toBeVisible();
  return briefing;
}

test("Jarvis does not duplicate tomorrow's schedule or milestone-prep summaries",async({page})=>{
  await page.goto(process.env.DAYFRAME_BASE_URL || "http://127.0.0.1:4173",{waitUntil:"networkidle"});
  await expect.poll(()=>page.evaluate(()=>Boolean(localStorage.getItem("dayframe-v1")))).toBe(true);
  await page.evaluate(()=>{
    const state=JSON.parse(localStorage.getItem("dayframe-v1"));
    const now=new Date(); const today=new Date(now);
    if(now.getHours()<2)today.setDate(today.getDate()-1);
    const tomorrow=new Date(today);tomorrow.setDate(tomorrow.getDate()+1);
    const key=date=>[date.getFullYear(),String(date.getMonth()+1).padStart(2,"0"),String(date.getDate()).padStart(2,"0")].join("-");
    const tomorrowKey=key(tomorrow);
    state.plans[tomorrowKey]=[{id:"future-jarvis",title:"Cambridge C1",date:tomorrowKey,
      duration:60,start:"09:00",end:"10:00",requestedStart:"09:00",priority:"high",
      category:"Angličtina",mode:"fixed",completed:false,source:"user",dateLocked:true,autoScheduled:false}];
    state.milestones=[{id:"milestone-jarvis",title:"VŠE přijímačky",date:tomorrowKey,note:"Test"}];
    localStorage.setItem("dayframe-v1",JSON.stringify(state));
    window.dispatchEvent(new Event("dayframe-state-sync"));
  });
  const launcher=page.locator("[data-today-briefing-launcher]");
  await expect(launcher).toBeVisible();
  await launcher.click();
  const briefing=page.locator("[data-today-briefing]");
  await expect(briefing.locator(".df2-jarvis-weather")).toBeVisible();
  await expect(briefing.locator("[data-jarvis-supplements]")).toBeVisible();
  await expect(briefing.locator("[data-jarvis-tomorrow]")).toHaveCount(0);
  await expect(briefing.locator(".df2-jarvis-milestone")).toHaveCount(0);
  await expect(briefing.locator("[data-jarvis-milestone-prep]")).toHaveCount(0);
  await expect(briefing.locator("[data-jarvis-advisor]")).toHaveCount(0);
});
