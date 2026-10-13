import {test,expect} from "@playwright/test";
const ROOT=process.env.DAYFRAME_BASE_URL||"http://127.0.0.1:4173";

test("new daily routines affect today and future, never an already elapsed week",async({page})=>{
  await page.clock.setFixedTime(new Date("2026-10-13T11:46:00"));
  await page.goto(ROOT,{waitUntil:"networkidle"});
  await page.evaluate(()=>localStorage.clear());
  await page.reload({waitUntil:"networkidle"});
  await page.getByRole("button",{name:/Nastavení/}).click();
  await page.getByRole("button",{name:"+ Nová rutina"}).click();
  const dialog=page.getByRole("dialog",{name:"Přidat úkol"});
  await dialog.locator(".df2-title-input input").fill("Nový pouze budoucí blok");
  await dialog.locator(".df2-chips input[type=time]").fill("20:30");
  await dialog.locator("details summary").filter({hasText:"Podrobnosti"}).click();
  await dialog.getByLabel("Opakování").selectOption("daily");
  await dialog.getByRole("button",{name:"Naplánovat"}).click();
  await expect(dialog).toHaveCount(0);
  const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem("dayframe-v1")));
  const routine=saved.routines.find(x=>x.title==="Nový pouze budoucí blok");
  expect(routine).toBeTruthy();
  expect((saved.plans["2026-10-13"]??[]).filter(x=>x.routineId===routine.id).length).toBeLessThanOrEqual(1);
  expect((saved.plans["2026-10-14"]??[]).filter(x=>x.routineId===routine.id)).toHaveLength(1);
  for(const date of ["2026-10-05","2026-10-06","2026-10-07","2026-10-08","2026-10-09","2026-10-10","2026-10-11","2026-10-12"])
    expect((saved.plans[date]??[]).some(x=>x.routineId===routine.id)).toBe(false);
  await page.locator(".df2-sidebar nav button").filter({hasText:"Týden"}).click();
  await page.locator(".df2-week-controls button").filter({hasText:"←"}).click();
  await expect(page.locator(".df2-week-grid")).not.toContainText("Nový pouze budoucí blok");
  await page.reload({waitUntil:"networkidle"});
  const reloaded=await page.evaluate(()=>JSON.parse(localStorage.getItem("dayframe-v1")));
  expect((reloaded.plans["2026-10-14"]??[]).filter(x=>x.routineId===routine.id)).toHaveLength(1);
  expect((reloaded.plans["2026-10-05"]??[]).some(x=>x.routineId===routine.id)).toBe(false);
});

test("retroactive Week entry cannot be recurring, but one-off historical entry is still allowed",async({page})=>{
  await page.clock.setFixedTime(new Date("2026-10-13T11:46:00"));
  await page.goto(ROOT,{waitUntil:"networkidle"});
  await page.evaluate(()=>localStorage.clear());
  await page.reload({waitUntil:"networkidle"});
  await page.locator(".df2-sidebar nav button").filter({hasText:"Týden"}).click();
  await page.locator(".df2-week-controls button").filter({hasText:"←"}).click();
  await page.locator(".df2-week-day").first().locator(".df2-week-day-head > button").click();
  const dialog=page.getByRole("dialog",{name:"Přidat úkol"});
  const historicalDate=await dialog.locator(".df2-chips input[type=date]").inputValue();
  expect(historicalDate).toBe("2026-10-05");
  await dialog.locator(".df2-title-input input").fill("Zpětná poznámka");
  await dialog.locator(".df2-chips input[type=time]").fill("18:00");
  await dialog.locator("details summary").filter({hasText:"Podrobnosti"}).click();
  await dialog.getByLabel("Opakování").selectOption("weekly");
  await dialog.getByRole("button",{name:"Naplánovat"}).click();
  await expect(dialog).toContainText("Opakovanou rutinu lze naplánovat jen do budoucna.");
  let state=await page.evaluate(()=>JSON.parse(localStorage.getItem("dayframe-v1")));
  expect(state.routines.some(x=>x.title==="Zpětná poznámka")).toBe(false);
  await dialog.getByLabel("Opakování").selectOption("none");
  await dialog.getByRole("button",{name:"Naplánovat"}).click();
  await expect(dialog).toHaveCount(0);
  state=await page.evaluate(()=>JSON.parse(localStorage.getItem("dayframe-v1")));
  expect((state.plans[historicalDate]??[]).some(x=>x.title==="Zpětná poznámka")).toBe(true);
});
