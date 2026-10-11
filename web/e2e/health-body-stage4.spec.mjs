import {test,expect} from "@playwright/test";
const ROOT=process.env.DAYFRAME_BASE_URL||"http://127.0.0.1:4173";
const KEY="dayframe-body-v1";
async function fresh(page){
  await page.clock.setFixedTime(new Date("2026-10-12T12:00:00"));
  await page.goto(ROOT,{waitUntil:"networkidle"});
  await page.evaluate(()=>localStorage.clear());
  await page.reload({waitUntil:"networkidle"});
}
async function body(page){
  await page.locator(".df2-sidebar nav button").filter({hasText:"Zdraví"}).click();
  await page.getByRole("tab",{name:"Tělo & Progress"}).click();
  return page.locator("[data-body-root]");
}
async function measure(page,kg="70",waist=""){
  const root=await body(page);
  await root.getByRole("button",{name:"Měření",exact:true}).click();
  await root.getByRole("spinbutton",{name:"Hmotnost",exact:true}).fill(kg);
  if(waist)await root.getByRole("spinbutton",{name:"Pas",exact:true}).fill(waist);
  await root.getByRole("button",{name:"Uložit měření"}).click();
  return root;
}
test("Stage 4 body check-in is opt-in and exactly one Today summary reflects the single measurement",async({page})=>{
  await fresh(page);
  const beforeHygiene=await page.evaluate(()=>localStorage.getItem("dayframe-hygiene-v1"));
  const root=await body(page);
  await expect(root).toContainText("Tělo & Progress");
  await page.locator(".df2-sidebar nav button").filter({hasText:"Dnes"}).click();
  await expect(page.locator("[data-body-checklist]")).toHaveCount(0);
  await page.locator(".df2-sidebar nav button").filter({hasText:"Zdraví"}).click();
  await page.getByRole("tab",{name:"Tělo & Progress"}).click();
  await root.getByRole("combobox",{name:"Frekvence měření"}).selectOption("weekly");
  await page.locator(".df2-sidebar nav button").filter({hasText:"Dnes"}).click();
  const check=page.locator("[data-body-checklist]");
  await expect(check).toHaveCount(1);
  await expect(check).toContainText("Naplánováno");
  await check.getByRole("button",{name:"Otevřít tělesné měření ve Zdraví"}).click();
  await expect(page.getByRole("tab",{name:"Tělo & Progress"})).toHaveAttribute("aria-selected","true");
  await expect(root.locator("[data-body-editor]")).toBeVisible();
  await root.getByRole("spinbutton",{name:"Hmotnost",exact:true}).fill("70");
  await root.getByRole("spinbutton",{name:"Pas",exact:true}).fill("80.5");
  await root.getByRole("button",{name:"Uložit měření"}).click();
  await page.locator(".df2-sidebar nav button").filter({hasText:"Dnes"}).click();
  await expect(check).toHaveCount(1);
  await expect(check).toContainText("Zapsáno");
  const saved=await page.evaluate(k=>JSON.parse(localStorage.getItem(k)),KEY);
  expect(saved.entries).toHaveLength(1);
  expect(saved.entries[0].metrics).toMatchObject({weightKg:70,waistCm:80.5});
  const afterHygiene=await page.evaluate(()=>localStorage.getItem("dayframe-hygiene-v1"));
  const normalize=raw=>{
    const s=JSON.parse(raw);return {
      products:s.products,
      routines:s.routines.map(r=>({id:r.id,title:r.title,active:r.active,
        tasks:r.tasks.map(t=>({id:t.id,title:t.title,productIds:t.productIds??[]}))}))
    };
  };
  expect(normalize(afterHygiene)).toEqual(normalize(beforeHygiene));
  await page.reload({waitUntil:"networkidle"});
  await expect(page.locator("[data-body-checklist]")).toContainText("Zapsáno");
});
test("History can be edited without creating duplicate dates and chart reads measurements",async({page})=>{
  await fresh(page);
  const root=await measure(page,"70","81");
  await root.getByRole("button",{name:"Měření",exact:true}).click();
  await expect(root.locator("[data-body-entry]")).toHaveCount(1);
  await root.locator("[data-body-entry]").getByRole("button",{name:"Upravit"}).click();
  await root.getByRole("spinbutton",{name:"Hmotnost",exact:true}).fill("71");
  await root.getByRole("button",{name:"Uložit měření"}).click();
  const saved=await page.evaluate(k=>JSON.parse(localStorage.getItem(k)),KEY);
  expect(saved.entries).toHaveLength(1);
  expect(saved.entries[0].metrics.weightKg).toBe(71);
  await root.getByRole("button",{name:"Přehled",exact:true}).click();
  await expect(root.locator("[data-body-chart]")).toBeVisible();
  await expect(root).toContainText("71 kg");
});
test("Goal baseline and current performance use actual readings",async({page})=>{
  await fresh(page);
  const root=await measure(page,"70");
  await root.getByRole("button",{name:"Cíle",exact:true}).click();
  await root.getByRole("spinbutton",{name:"Cílová hodnota"}).fill("75");
  await root.getByRole("button",{name:"+ Vytvořit cíl"}).click();
  await expect(root.locator("[data-body-goal]")).toHaveCount(1);
  await expect(root.locator("[data-body-goal] progress")).toHaveAttribute("value","0");
  const store=await page.evaluate(k=>JSON.parse(localStorage.getItem(k)),KEY);
  expect(store.goals[0].startValue).toBe(70);
});
test("Optional progress photos are stored as local blobs, with metadata only in localStorage",async({page})=>{
  await fresh(page);
  const root=await body(page);
  await root.getByRole("button",{name:"Fotografie",exact:true}).click();
  await expect(root).toContainText("Nejsou odesílány na server");
  const png=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+nmV0AAAAASUVORK5CYII=","base64");
  await root.getByLabel("Vybrat progresovou fotografii").setInputFiles({
    name:"progress.png",mimeType:"image/png",buffer:png
  });
  await root.getByRole("textbox",{name:"Popisek fotografie"}).fill("Před tréninkem");
  await root.getByRole("button",{name:"Uložit fotografii"}).click();
  await expect(root.locator("[data-body-photo]")).toHaveCount(1);
  await expect(root.locator("[data-body-photo] img")).toBeVisible();
  const s=await page.evaluate(k=>JSON.parse(localStorage.getItem(k)),KEY);
  expect(s.photos).toHaveLength(1);
  expect(JSON.stringify(s)).not.toContain("data:image/");
  const blobs=await page.evaluate(async()=>{
    const db=await new Promise((resolve,reject)=>{const req=indexedDB.open("dayframe-body-photos-v1");req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
    return new Promise((resolve,reject)=>{const r=db.transaction("photos","readonly").objectStore("photos").getAll();r.onsuccess=()=>resolve(r.result.map(x=>x.size));r.onerror=()=>reject(r.error);});
  });
  expect(blobs).toEqual([png.length]);
});
test("narrow-screen body form and goal controls are usable",async({page})=>{
  await page.setViewportSize({width:375,height:812});
  await fresh(page);
  const root=await body(page);
  await root.getByRole("button",{name:"Měření",exact:true}).click();
  await expect(root.getByRole("spinbutton",{name:"Pas",exact:true})).toBeVisible();
  await root.getByRole("button",{name:"Cíle",exact:true}).click();
  await expect(root.getByRole("spinbutton",{name:"Cílová hodnota"})).toBeVisible();
});
test("untouched fields in one tab do not overwrite a newer measurement from another tab",async({browser})=>{
  const context=await browser.newContext();
  const a=await context.newPage(),b=await context.newPage();
  await fresh(a);await b.goto(ROOT,{waitUntil:"networkidle"});
  await measure(a,"70","80");
  await b.locator(".df2-sidebar nav button").filter({hasText:"Zdraví"}).click();
  await b.getByRole("tab",{name:"Tělo & Progress"}).click();
  const rootB=b.locator("[data-body-root]");
  await rootB.getByRole("button",{name:"Měření",exact:true}).click();
  await rootB.locator("[data-body-entry]").getByRole("button",{name:"Upravit"}).click();
  await rootB.getByRole("spinbutton",{name:"Pas",exact:true}).fill("82");
  const rootA=a.locator("[data-body-root]");
  await rootA.getByRole("button",{name:"Měření",exact:true}).click();
  await rootA.locator("[data-body-entry]").getByRole("button",{name:"Upravit"}).click();
  await rootA.getByRole("spinbutton",{name:"Hmotnost",exact:true}).fill("72");
  await rootA.getByRole("button",{name:"Uložit měření"}).click();
  await rootB.getByRole("button",{name:"Uložit měření"}).click();
  const saved=await a.evaluate(k=>JSON.parse(localStorage.getItem(k)),KEY);
  expect(saved.entries).toHaveLength(1);
  expect(saved.entries[0].metrics.weightKg).toBe(72);
  expect(saved.entries[0].metrics.waistCm).toBe(82);
  await context.close();
});
