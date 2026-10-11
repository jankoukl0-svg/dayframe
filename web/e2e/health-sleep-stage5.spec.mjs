import {test,expect} from "@playwright/test";
const ROOT=process.env.DAYFRAME_BASE_URL||"http://127.0.0.1:4173";
const KEY="dayframe-sleep-v1";
async function fresh(page){
  await page.clock.setFixedTime(new Date("2026-10-12T12:00:00"));
  await page.goto(ROOT,{waitUntil:"networkidle"});
  await page.evaluate(()=>localStorage.clear());
  await page.reload({waitUntil:"networkidle"});
}
async function sleep(page){
  await page.locator(".df2-sidebar nav button").filter({hasText:"Zdraví"}).click();
  await page.getByRole("tab",{name:"Spánek & Regenerace"}).click();
  return page.locator("[data-sleep-root]");
}
test("Stage 5 replaces hydration placeholder with working Sleep and preserves existing hygiene data",async({page})=>{
  await fresh(page);
  const hygiene=await page.evaluate(()=>localStorage.getItem("dayframe-hygiene-v1"));
  const root=await sleep(page);
  await expect(page.getByRole("tab",{name:"Hydratace"})).toHaveCount(0);
  await expect(root).toContainText("Spánek & Regenerace");
  await page.locator(".df2-sidebar nav button").filter({hasText:"Dnes"}).click();
  await expect(page.locator("[data-sleep-checklist]")).toHaveCount(0);
  await sleep(page);
  await root.getByRole("checkbox",{name:/Přidávat/}).check();
  await page.locator(".df2-sidebar nav button").filter({hasText:"Dnes"}).click();
  const check=page.locator("[data-sleep-checklist]");
  await expect(check).toHaveCount(1);
  await check.getByRole("button",{name:"Otevřít záznam spánku ve Zdraví"}).click();
  await expect(page.getByRole("tab",{name:"Spánek & Regenerace"})).toHaveAttribute("aria-selected","true");
  await expect(root.locator("[data-sleep-editor]")).toBeVisible();
  await root.getByLabel("Čas usnutí").fill("23:30");
  await root.getByLabel("Čas probuzení").fill("07:15");
  await root.getByLabel("Kvalita spánku").selectOption("4");
  await root.getByRole("button",{name:"Uložit spánek"}).click();
  await page.locator(".df2-sidebar nav button").filter({hasText:"Dnes"}).click();
  await expect(check).toHaveCount(1);
  await expect(check).toContainText("Zapsáno");
  const saved=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),KEY);
  expect(saved.entries).toHaveLength(1);
  expect(saved.entries[0]).toMatchObject({date:"2026-10-12",bedtime:"23:30",wakeTime:"07:15",quality:4});
  const afterHygiene=await page.evaluate(()=>localStorage.getItem("dayframe-hygiene-v1"));
  const normalize=raw=>{
    const s=JSON.parse(raw);
    return {products:s.products,routines:s.routines.map(r=>({
      id:r.id,title:r.title,active:r.active,
      tasks:r.tasks.map(t=>({id:t.id,title:t.title,productIds:t.productIds??[]}))
    }))};
  };
  expect(normalize(afterHygiene)).toEqual(normalize(hygiene));
  await page.reload({waitUntil:"networkidle"});
  await expect(page.locator("[data-sleep-checklist]")).toContainText("Zapsáno");
});
test("sleep history uses the single saved record and supports editing and deleting",async({page})=>{
  await fresh(page);
  const root=await sleep(page);
  await root.getByRole("button",{name:"+ Zapsat spánek"}).click();
  await root.getByRole("button",{name:"Uložit spánek"}).click();
  await root.getByRole("button",{name:"Historie"}).click();
  await expect(root.locator("[data-sleep-entry]")).toHaveCount(1);
  await root.locator("[data-sleep-entry]").getByRole("button",{name:"Upravit"}).click();
  await root.getByLabel("Čas probuzení").fill("08:30");
  await root.getByRole("button",{name:"Uložit spánek"}).click();
  await expect(root.locator("[data-sleep-chart]")).toBeVisible();
  const saved=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),KEY);
  expect(saved.entries).toHaveLength(1);
  expect(saved.entries[0].wakeTime).toBe("08:30");
  await root.getByRole("button",{name:"Historie"}).click();
  page.once("dialog",dialog=>dialog.accept());
  await root.locator("[data-sleep-entry]").getByRole("button",{name:"Odstranit"}).click();
  await expect(root.locator("[data-sleep-entry]")).toHaveCount(0);
});
test("bad stored data blocks writes, never silently resets storage",async({page})=>{
  await fresh(page);
  await page.evaluate(key=>localStorage.setItem(key,'{"version":999,"entries":[]}'),KEY);
  await page.reload({waitUntil:"networkidle"});
  const root=await sleep(page);
  await expect(root.getByRole("alert")).toContainText("zablokované");
  await expect(root.getByRole("checkbox",{name:/Přidávat/})).toBeDisabled();
  expect(await page.evaluate(key=>localStorage.getItem(key),KEY)).toBe('{"version":999,"entries":[]}');
});
test("sleep editor is usable on small mobile screens",async({page})=>{
  await page.setViewportSize({width:375,height:812});
  await fresh(page);
  const root=await sleep(page);
  await root.getByRole("button",{name:"+ Zapsat spánek"}).click();
  await expect(root.getByLabel("Čas usnutí")).toBeVisible();
  await expect(root.getByRole("button",{name:"Uložit spánek"})).toBeVisible();
});
test("two tabs preserve changes to different fields when editing the same date",async({browser})=>{
  const context=await browser.newContext();
  const a=await context.newPage(),b=await context.newPage();
  await fresh(a);
  const aRoot=await sleep(a);
  await aRoot.getByRole("button",{name:"+ Zapsat spánek"}).click();
  await aRoot.getByRole("button",{name:"Uložit spánek"}).click();
  await b.clock.setFixedTime(new Date("2026-10-12T12:00:00"));
  await b.goto(ROOT,{waitUntil:"networkidle"});
  const bRoot=await sleep(b);
  await aRoot.getByRole("button",{name:"Záznam",exact:true}).click();
  await bRoot.getByRole("button",{name:"Záznam",exact:true}).click();
  await aRoot.getByLabel("Čas usnutí").fill("22:30");
  await bRoot.getByLabel("Kvalita spánku").selectOption("5");
  await aRoot.getByRole("button",{name:"Uložit spánek"}).click();
  await bRoot.getByRole("button",{name:"Uložit spánek"}).click();
  const saved=await a.evaluate(key=>JSON.parse(localStorage.getItem(key)),KEY);
  expect(saved.entries).toHaveLength(1);
  expect(saved.entries[0].bedtime).toBe("22:30");
  expect(saved.entries[0].quality).toBe(5);
  await context.close();
});

test("before 02:00, wake date is the real local date rather than yesterday's planning day",async({page})=>{
  await page.clock.setFixedTime(new Date("2026-10-13T01:00:00"));
  await page.goto(ROOT,{waitUntil:"networkidle"});
  await page.evaluate(()=>localStorage.clear());
  await page.reload({waitUntil:"networkidle"});
  const root=await sleep(page);
  await root.getByRole("button",{name:"+ Zapsat spánek"}).click();
  await expect(root.getByLabel("Datum probuzení")).toHaveValue("2026-10-13");
  await expect(root.getByLabel("Datum probuzení")).toHaveAttribute("max","2026-10-13");
  await root.getByRole("button",{name:"Uložit spánek"}).click();
  const saved=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),KEY);
  expect(saved.entries.map(e=>e.date)).toEqual(["2026-10-13"]);
});
test("invalid merged sleep times warn without losing either tab's already saved record",async({browser})=>{
  const context=await browser.newContext();
  const a=await context.newPage(),b=await context.newPage();
  await fresh(a);
  const rootA=await sleep(a);
  await rootA.getByRole("button",{name:"+ Zapsat spánek"}).click();
  await rootA.getByRole("button",{name:"Uložit spánek"}).click();
  await b.clock.setFixedTime(new Date("2026-10-12T12:00:00"));
  await b.goto(ROOT,{waitUntil:"networkidle"});
  const rootB=await sleep(b);
  await rootA.getByRole("button",{name:"Záznam",exact:true}).click();
  await rootB.getByRole("button",{name:"Záznam",exact:true}).click();
  await rootA.getByLabel("Čas usnutí").fill("07:15");
  await rootB.getByLabel("Čas probuzení").fill("07:20");
  await rootA.getByRole("button",{name:"Uložit spánek"}).click();
  await rootB.getByRole("button",{name:"Uložit spánek"}).click();
  await expect(rootB.getByRole("alert")).toContainText("současně změněny");
  await expect(rootB.locator("[data-sleep-editor]")).toBeVisible();
  const saved=await a.evaluate(key=>JSON.parse(localStorage.getItem(key)),KEY);
  expect(saved.entries).toHaveLength(1);
  expect(saved.entries[0]).toMatchObject({bedtime:"07:15",wakeTime:"07:00"});
  await context.close();
});
