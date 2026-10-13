import { test, expect } from "@playwright/test";

test("past week days stay editable and accept retroactive tasks", async ({ page }) => {
  await page.goto(process.env.DAYFRAME_BASE_URL || "http://127.0.0.1:4173", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Týden/ }).click();
  await page.locator(".df2-week-controls button").filter({ hasText: "←" }).click();

  const pastDay = page.locator(".df2-week-day").first();
  await expect(pastDay).toHaveClass(/df2-week-past-editable/);
  const addButton = pastDay.locator(".df2-week-day-head > button");
  await expect(addButton).toBeEnabled();

  const historyLabel = await pastDay.locator(".df2-week-day-head").evaluate((head) => getComputedStyle(head, "::after").content.replaceAll('"', ""));
  expect(historyLabel).toBe("historie");

  await addButton.click();
  const dialog = page.getByRole("dialog", { name: "Přidat úkol" });
  await expect(dialog).toBeVisible();
  const dayInput = dialog.locator(".df2-chips input[type='date']").first();
  const retroDate = await dayInput.inputValue();
  const today = await page.evaluate(() => {
    const now = new Date();
    if (now.getHours() < 2) now.setDate(now.getDate() - 1);
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  });
  expect(retroDate < today).toBe(true);
  await expect(dayInput).not.toHaveAttribute("min");

  await dialog.locator(".df2-title-input input").fill("Zpětně doplněná práce");
  await dialog.locator("input[type='time']").first().fill("18:00");
  await page.getByRole("button", { name: "Naplánovat", exact: true }).click();

  await expect(dialog).toHaveCount(0);
  await expect(pastDay.locator(".df2-week-task").filter({ hasText: "Zpětně doplněná práce" })).toBeVisible();
});

test("retroactive edit is saved together with completion, resizes visually and survives reload", async ({ page }) => {
  const baseUrl = process.env.DAYFRAME_BASE_URL || "http://127.0.0.1:4173";
  await page.goto(baseUrl, { waitUntil: "networkidle" });

  const seeded = await page.evaluate(() => {
    const state = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}");
    const now = new Date();
    if (now.getHours() < 2) now.setDate(now.getDate() - 1);
    const past = new Date(now);
    past.setDate(past.getDate() - 7);
    const date = `${past.getFullYear()}-${String(past.getMonth() + 1).padStart(2, "0")}-${String(past.getDate()).padStart(2, "0")}`;
    const createdAt = new Date().toISOString();
    state.routines = [];
    state.plans = state.plans || {};
    state.plans[date] = [{
      id: "retro-edit-completion",
      title: "Původní zpětný blok",
      date,
      duration: 60,
      start: "18:00",
      end: "19:00",
      requestedStart: "18:00",
      dueDate: date,
      deadlineTime: "22:30",
      priority: "normal",
      category: "Studium",
      mode: "flexible",
      completed: false,
      source: "user",
      dateLocked: true,
      autoScheduled: false,
      createdAt,
    }];
    window.localStorage.setItem("dayframe-v1", JSON.stringify(state));
    return date;
  });

  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Týden/ }).click();
  await page.locator(".df2-week-controls button").filter({ hasText: "←" }).click();

  const original = page.locator(".df2-week-task").filter({ hasText: "Původní zpětný blok" });
  await expect(original).toBeVisible();
  await original.click();

  const edit = page.locator("form.df2-modal").filter({ hasText: "Upravit" });
  await expect(edit).toBeVisible();
  await edit.locator("input[name='title']").fill("Skutečně odpracovaný blok");
  await edit.locator("input[name='start']").fill("19:00");
  await edit.locator("input[name='duration']").fill("16");
  await edit.locator("select[name='category']").selectOption({ label: "Finance" });
  await edit.getByRole("button", { name: "Označit hotovo", exact: true }).click();

  await expect(edit).toBeVisible();
  const storedAfterInvalidAttempt = await page.evaluate((date) => {
    const state = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}");
    return (state.plans?.[date] || []).find((task) => task.id === "retro-edit-completion") || null;
  }, seeded);
  expect(storedAfterInvalidAttempt).toMatchObject({
    title: "Původní zpětný blok",
    start: "18:00",
    end: "19:00",
    duration: 60,
    category: "Studium",
    completed: false,
  });

  await edit.locator("input[name='duration']").fill("120");
  await edit.getByRole("button", { name: "Označit hotovo", exact: true }).click();

  await expect(edit).toHaveCount(0);
  const updated = page.locator(".df2-week-task").filter({ hasText: "Skutečně odpracovaný blok" });
  await expect(updated).toBeVisible();
  await expect(updated).toHaveClass(/done/);
  await expect(updated).toContainText("19:00–21:00");
  await expect.poll(async () => updated.evaluate((node) => node.getBoundingClientRect().height)).toBeCloseTo(86.4, 0);

  const storedBeforeReload = await page.evaluate((date) => {
    const state = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}");
    return (state.plans?.[date] || []).find((task) => task.id === "retro-edit-completion") || null;
  }, seeded);
  expect(storedBeforeReload).toMatchObject({
    title: "Skutečně odpracovaný blok",
    start: "19:00",
    end: "21:00",
    duration: 120,
    category: "Finance",
    completed: true,
  });

  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Týden/ }).click();
  await page.locator(".df2-week-controls button").filter({ hasText: "←" }).click();

  const persisted = page.locator(".df2-week-task").filter({ hasText: "Skutečně odpracovaný blok" });
  await expect(persisted).toBeVisible();
  await expect(persisted).toHaveClass(/done/);
  await expect(persisted).toContainText("19:00–21:00");
  await expect.poll(async () => persisted.evaluate((node) => node.getBoundingClientRect().height)).toBeCloseTo(86.4, 0);
});


test("saved September routine ghosts disappear from history after loading without erasing completed sessions",async({page})=>{
  await page.clock.setFixedTime(new Date("2026-10-13T16:30:00"));
  await page.goto(process.env.DAYFRAME_BASE_URL||"http://127.0.0.1:4173",{waitUntil:"networkidle"});
  await expect.poll(()=>page.evaluate(()=>Boolean(localStorage.getItem("dayframe-v1")))).toBe(true);
  await page.evaluate(()=>{
    const state=JSON.parse(localStorage.getItem("dayframe-v1"));
    const reference="2026-09-17T09:00:00.000Z";
    const template=(id,date,title,source="routine",completed=false)=>({
      id,title,date,duration:45,start:"18:00",end:"18:45",requestedStart:"18:00",
      category:"Studium",priority:"normal",mode:"flexible",completed,source,
      routineId:source==="routine"?"old-study":undefined,createdAt:reference,
    });
    state.routines.push({id:"old-study",title:"SCIO historické opakování",
      duration:45,start:"18:00",category:"Studium",priority:"normal",
      frequency:"daily",active:true,createdAt:reference});
    state.plans["2026-09-21"]=[
      template("routine-old-study-2026-09-21","2026-09-21","Starý automatický SCIO blok"),
      template("confirmed","2026-09-21","Skutečně dokončené studium","routine",true),
      template("manual","2026-09-21","Ručně zapsaný historický úkol","user"),
    ];
    state.plans["2026-09-22"]=[
      template("orphan","2026-09-22","Osiřelý automatický blok"),
    ];
    state.plans["2026-10-14"]=[
      template("future","2026-10-14","Budoucí automatický blok"),
    ];
    localStorage.setItem("dayframe-v1",JSON.stringify(state));
  });
  await page.reload({waitUntil:"networkidle"});
  const historical=()=>page.evaluate(()=>{
    const state=JSON.parse(localStorage.getItem("dayframe-v1"));
    return {
      monday:(state.plans["2026-09-21"]??[]).map(task=>task.id),
      tuesday:(state.plans["2026-09-22"]??[]).map(task=>task.id),
      future:(state.plans["2026-10-14"]??[]).some(task=>task.id==="future"),
      routine:state.routines.some(rule=>rule.id==="old-study"),
    };
  });
  await expect.poll(historical).toEqual({
    monday:["confirmed","manual"],tuesday:[],future:true,routine:true,
  });
  await page.getByRole("button",{name:/Týden/}).click();
  for(let i=0;i<3;i++)await page.locator(".df2-week-controls button").filter({hasText:"←"}).click();
  const week=page.locator(".df2-week-grid");
  await expect(week).not.toContainText("Starý automatický SCIO blok");
  await expect(week).not.toContainText("Osiřelý automatický blok");
  await expect(week).toContainText("Skutečně dokončené studium");
  await expect(week).toContainText("Ručně zapsaný historický úkol");
  await page.reload({waitUntil:"networkidle"});
  await expect.poll(historical).toEqual({
    monday:["confirmed","manual"],tuesday:[],future:true,routine:true,
  });
  await page.getByRole("button",{name:/Týden/}).click();
  for(let i=0;i<3;i++)await page.locator(".df2-week-controls button").filter({hasText:"←"}).click();
  await expect(page.locator(".df2-week-grid")).not.toContainText("Starý automatický SCIO blok");
});
