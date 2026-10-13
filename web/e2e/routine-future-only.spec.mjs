import {test,expect} from "@playwright/test";
const ROOT=process.env.DAYFRAME_BASE_URL||"http://127.0.0.1:4173";
test("routines created now only populate upcoming calendar dates",async({page})=>{
  await page.clock.setFixedTime(new Date("2026-10-13T17:05:00"));
  await page.goto(ROOT,{waitUntil:"networkidle"});
  await page.evaluate(()=>localStorage.clear());
  await page.reload({waitUntil:"networkidle"});
  await page.getByRole("button",{name:/Nastavení/}).click();
  await page.getByRole("button",{name:"+ Nová rutina"}).click();
  const dialog=page.getByRole("dialog",{name:"Přidat úkol"});
  await dialog.locator(".df2-title-input input").fill("Jen budoucí rutina");
  await dialog.locator(".df2-chips input[type=time]").fill("20:30");
  await dialog.locator("details summary").click();
  await dialog.getByLabel("Opakování",{exact:true}).selectOption("daily");
  await dialog.getByRole("button",{name:"Naplánovat"}).click();
  await expect(dialog).toHaveCount(0);
  const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem("dayframe-v1")));
  const routine=saved.routines.find(x=>x.title==="Jen budoucí rutina");
  expect(routine).toBeTruthy();
  for(const date of ["2026-10-05","2026-10-06","2026-10-07","2026-10-08","2026-10-09","2026-10-10","2026-10-11","2026-10-12"])
    expect((saved.plans[date]??[]).some(x=>x.routineId===routine.id)).toBe(false);
  expect((saved.plans["2026-10-14"]??[]).filter(x=>x.routineId===routine.id)).toHaveLength(1);
  await page.reload({waitUntil:"networkidle"});
  const after=await page.evaluate(()=>JSON.parse(localStorage.getItem("dayframe-v1")));
  expect((after.plans["2026-10-14"]??[]).filter(x=>x.routineId===routine.id)).toHaveLength(1);
});
