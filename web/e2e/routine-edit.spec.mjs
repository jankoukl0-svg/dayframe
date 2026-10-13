import { test, expect } from "@playwright/test";

test("edits a recurring routine and persists the new schedule", async ({ page }) => {
  await page.goto(process.env.DAYFRAME_BASE_URL || "http://127.0.0.1:4173", { waitUntil: "networkidle" });
  await page.evaluate(() => window.localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });

  await page.getByRole("button", { name: /Nastavení/ }).click();

  const cfiGroup = page.locator(".df2-routine-group").filter({ hasText: "CFI / Excel" }).first();
  await expect(cfiGroup).toBeVisible();
  await cfiGroup.locator(".df2-routine-group-summary").click();

  const firstOccurrence = cfiGroup.locator(".df2-routine-occurrence").first();
  await firstOccurrence.getByRole("button", { name: "Upravit" }).click();

  const editor = page.locator(".df2-routine-editor");
  await expect(editor).toBeVisible();
  await editor.getByLabel("Název").fill("CFI / Excel deep");
  await editor.getByLabel("Čas").fill("10:30");
  await editor.getByLabel("Délka").fill("75");

  const reload = page.waitForEvent("load");
  await editor.getByRole("button", { name: "Uložit změny" }).click();
  await reload;
  await page.waitForLoadState("networkidle");

  await expect(page.getByRole("heading", { name: "Nastavení" })).toBeVisible();

  const stored = await page.evaluate(() => JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}"));
  const edited = stored.routines.find((routine) => routine.id === "mon-cfi");
  expect(edited.title).toBe("CFI / Excel deep");
  expect(edited.start).toBe("10:30");
  expect(edited.duration).toBe(75);

  const editedGroup = page.locator(".df2-routine-group").filter({ hasText: "CFI / Excel deep" }).first();
  await expect(editedGroup).toBeVisible();
  await expect(editedGroup.locator(".df2-routine-group-summary")).toContainText("10:30 · 75 min");
});

test("a new repeating routine rejects past dates in the historical Week editor",async({page})=>{
  await page.clock.setFixedTime(new Date("2026-10-13T15:20:00"));
  await page.goto(process.env.DAYFRAME_BASE_URL||"http://127.0.0.1:4173",{waitUntil:"networkidle"});
  await page.evaluate(()=>localStorage.clear());
  await page.reload({waitUntil:"networkidle"});
  await page.getByRole("button",{name:/Týden/}).click();
  await page.locator(".df2-week-controls button").filter({hasText:"←"}).click();
  await page.locator(".df2-week-day").first().locator(".df2-week-day-head > button").click();
  const dialog=page.getByRole("dialog",{name:"Přidat úkol"});
  await expect(dialog).toBeVisible();
  const date=dialog.locator(".df2-chips input[type='date']");
  await expect(date).toHaveValue("2026-10-05");
  await dialog.locator(".df2-title-input input").fill("Budoucí testovací rutina");
  await dialog.locator(".df2-chips input[type='time']").fill("18:00");
  await dialog.locator("details.df2-details summary").click();
  await dialog.getByRole("combobox",{name:/^Opakování/}).selectOption("weekly");
  const before=await page.evaluate(()=>localStorage.getItem("dayframe-v1"));
  await dialog.getByRole("button",{name:"Naplánovat"}).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/jen do budoucna/)).toBeVisible();
  expect(await page.evaluate(()=>localStorage.getItem("dayframe-v1"))).toBe(before);
  await date.fill("2026-10-14");
  await dialog.getByRole("button",{name:"Naplánovat"}).click();
  await expect(dialog).toHaveCount(0);
  const state=await page.evaluate(()=>JSON.parse(localStorage.getItem("dayframe-v1")));
  expect(state.routines.some(r=>r.title==="Budoucí testovací rutina")).toBe(true);
  expect((state.plans["2026-10-05"]??[]).some(t=>t.title==="Budoucí testovací rutina")).toBe(false);
  await page.reload({waitUntil:"networkidle"});
  const after=await page.evaluate(()=>JSON.parse(localStorage.getItem("dayframe-v1")));
  expect((after.plans["2026-10-05"]??[]).some(t=>t.title==="Budoucí testovací rutina")).toBe(false);
});

test("a newly created future-dated daily routine only appears from its first date onward",async({page})=>{
  await page.clock.setFixedTime(new Date("2026-10-13T16:30:00"));
  await page.goto(process.env.DAYFRAME_BASE_URL||"http://127.0.0.1:4173",{waitUntil:"networkidle"});
  await page.evaluate(()=>localStorage.clear());
  await page.reload({waitUntil:"networkidle"});
  await page.getByRole("button",{name:/Nastavení/}).click();
  await page.getByRole("button",{name:"+ Nová rutina"}).click();
  const dialog=page.getByRole("dialog",{name:"Přidat úkol"});
  await dialog.locator(".df2-title-input input").fill("Budoucí od 19. října");
  await dialog.locator(".df2-chips input[type='date']").fill("2026-10-19");
  await dialog.locator(".df2-chips input[type='time']").fill("18:00");
  await dialog.locator("details.df2-details summary").click();
  await dialog.getByRole("combobox",{name:/^Opakování/}).selectOption("daily");
  await dialog.getByRole("button",{name:"Naplánovat"}).click();
  await expect(dialog).toHaveCount(0);
  let saved=await page.evaluate(()=>JSON.parse(localStorage.getItem("dayframe-v1")));
  const routine=saved.routines.find(x=>x.title==="Budoucí od 19. října");
  expect(routine.effectiveFrom).toBe("2026-10-19");
  await page.getByRole("button",{name:/Týden/}).click();
  await expect(page.locator(".df2-week-day").filter({hasText:"Budoucí od 19. října"})).toHaveCount(0);
  // Next week includes Monday the 19th. Reload must not backfill earlier days.
  await page.locator(".df2-week-controls button").filter({hasText:"→"}).click();
  await expect(page.locator(".df2-week-day").filter({hasText:"Budoucí od 19. října"})).toHaveCount(7);
  saved=await page.evaluate(()=>JSON.parse(localStorage.getItem("dayframe-v1")));
  for(const day of ["2026-10-12","2026-10-13","2026-10-14","2026-10-15","2026-10-16","2026-10-17","2026-10-18"]){
    expect((saved.plans[day]??[]).some(x=>x.routineId===routine.id)).toBe(false);
  }
  await page.reload({waitUntil:"networkidle"});
  const reloaded=await page.evaluate(()=>JSON.parse(localStorage.getItem("dayframe-v1")));
  expect((reloaded.plans["2026-10-18"]??[]).some(x=>x.routineId===routine.id)).toBe(false);
  expect((reloaded.plans["2026-10-20"]??[]).filter(x=>x.routineId===routine.id)).toHaveLength(1);
});


test("Settings toggle immediately restores upcoming routine blocks and deleting retains history",async({page})=>{
  await page.clock.setFixedTime(new Date("2026-10-13T15:30:00"));
  await page.goto(process.env.DAYFRAME_BASE_URL||"http://127.0.0.1:4173",{waitUntil:"networkidle"});
  await page.evaluate(()=>{
    const initial=JSON.parse(localStorage.getItem("dayframe-v1"));
    const id="history-toggle-e2e";
    const rule={id,title:"Rutina s bezpečnou historií",duration:45,start:"18:00",
      category:"Studium",priority:"normal",frequency:"daily",active:true,
      createdAt:"2026-10-01T08:00:00.000Z",effectiveFrom:"2026-10-12"};
    const occurrence=(date)=>({id:"routine-"+id+"-"+date,title:rule.title,date,
      duration:45,start:"18:00",end:"18:45",priority:"normal",category:"Studium",
      mode:"flexible",completed:false,source:"routine",routineId:id,
      createdAt:rule.createdAt});
    initial.routines.push(rule);
    initial.plans["2026-10-12"]=[...(initial.plans["2026-10-12"]??[]),occurrence("2026-10-12")];
    initial.plans["2026-10-13"]=[...(initial.plans["2026-10-13"]??[]),occurrence("2026-10-13")];
    initial.plans["2026-10-14"]=[...(initial.plans["2026-10-14"]??[]),occurrence("2026-10-14")];
    localStorage.setItem("dayframe-v1",JSON.stringify(initial));
  });
  await page.reload({waitUntil:"networkidle"});
  await page.getByRole("button",{name:/Nastavení/}).click();
  const group=page.locator(".df2-routine-group").filter({hasText:"Rutina s bezpečnou historií"}).first();
  await expect(group).toBeVisible();
  await group.locator(".df2-routine-group-summary").click();
  const toggle=group.locator(".df2-routine-occurrence input[type='checkbox']");
  await toggle.click();
  const counts=()=>page.evaluate(()=>{
    const state=JSON.parse(localStorage.getItem("dayframe-v1"));
    const count=(date)=>(state.plans[date]??[]).filter(task=>task.routineId==="history-toggle-e2e").length;
    return [count("2026-10-12"),count("2026-10-13"),count("2026-10-14")];
  });
  await expect.poll(counts).toEqual([1,0,0]);
  await expect(toggle).not.toBeChecked();
  await toggle.click();
  await expect.poll(counts).toEqual([1,1,1]);
  await expect(toggle).toBeChecked();
  await group.locator(".df2-routine-occurrence button.delete").click();
  await expect.poll(counts).toEqual([1,0,0]);
  await page.reload({waitUntil:"networkidle"});
  expect(await counts()).toEqual([1,0,0]);
  const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem("dayframe-v1")));
  expect(saved.routines.some(r=>r.id==="history-toggle-e2e")).toBe(false);
});
