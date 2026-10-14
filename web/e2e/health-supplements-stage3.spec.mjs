import { test, expect } from "@playwright/test";

const ROOT=process.env.DAYFRAME_BASE_URL||"http://127.0.0.1:4173";
const SUP_KEY="dayframe-supplements-v1";
async function fresh(page){
  await page.clock.setFixedTime(new Date("2026-10-12T12:00:00"));
  await page.goto(ROOT,{waitUntil:"networkidle"});
  await page.evaluate(()=>localStorage.clear());
  await page.reload({waitUntil:"networkidle"});
}
async function supplements(page){
  await page.locator(".df2-sidebar nav button").filter({hasText:"Zdraví"}).click();
  await page.getByRole("tab",{name:"Suplementy"}).click();
  return page.getByRole("region",{name:"Suplementy",exact:true});
}
async function addOne(page,{name="Kreatin test",stock="3",times="09:00"}={}){
  const root=await supplements(page);
  await root.getByRole("button",{name:"+ Přidat suplement"}).click();
  const dialog=page.getByRole("dialog",{name:"Editor suplementu"});
  await dialog.getByRole("textbox",{name:"Název suplementu"}).fill(name);
  await dialog.getByRole("textbox",{name:"Dávkování"}).fill("Dle etikety 1 kapsle");
  await dialog.getByRole("textbox",{name:"Časy užívání"}).fill(times);
  await dialog.getByRole("checkbox",{name:"Sledovat zásoby"}).check();
  await dialog.getByRole("spinbutton",{name:"Aktuální zásoba"}).fill(stock);
  await dialog.getByRole("spinbutton",{name:"Minimální zásoba"}).fill("2");
  await dialog.getByRole("spinbutton",{name:"Velikost balení"}).fill("30");
  await dialog.getByRole("button",{name:"Uložit suplement"}).click();
  await expect(dialog).toHaveCount(0);
  return root;
}
test("supplement check-in, Today summary and inventory read one shared record without duplicate tasks",async({page})=>{
  await fresh(page);
  const beforeHygiene=await page.evaluate(()=>localStorage.getItem("dayframe-hygiene-v1"));
  const root=await addOne(page,{times:"09:00, 20:00"});
  const due=root.locator("[data-supplement-occurrence]");
  await expect(due).toHaveCount(2);
  await due.first().getByRole("button",{name:"Užito",exact:true}).click();
  await expect(due.first()).toContainText("Zbývá 2");
  await page.locator(".df2-sidebar nav button").filter({hasText:"Dnes"}).click();
  const entries=page.locator("[data-supplement-checklist]");
  await expect(entries).toHaveCount(2);
  await expect(entries.first()).toContainText("Užito");
  await entries.first().getByRole("button",{name:/Otevřít suplement/}).click();
  await expect(page.getByRole("tab",{name:"Suplementy"})).toHaveAttribute("aria-selected","true");
  await root.getByRole("button",{name:"Historie",exact:true}).click();
  await expect(root.locator("[data-supplements-history]")).toContainText("Užito");
  const saved=await page.evaluate(k=>JSON.parse(localStorage.getItem(k)),SUP_KEY);
  expect(saved.intakes).toHaveLength(1);
  expect(saved.supplements[0].stock).toBe(2);
  // Hygiena normalizes optional productIds/completedOn while reading. Verify
  // meaningful routine and product invariants instead of comparing raw JSON.
  const hygieneAfter=await page.evaluate(()=>JSON.parse(localStorage.getItem("dayframe-hygiene-v1")));
  const hygieneBefore=JSON.parse(beforeHygiene);
  const invariant=(state)=>({
    products:state.products,
    routines:state.routines.map(r=>({
      id:r.id,title:r.title,active:r.active,order:r.order,schedule:r.schedule,
      tasks:r.tasks.map(t=>({id:t.id,title:t.title,active:t.active,
        section:t.section,optional:t.optional,allowSkip:t.allowSkip,
        productIds:t.productIds??[]}))
    }))
  });
  expect(invariant(hygieneAfter)).toEqual(invariant(hygieneBefore));
  await page.reload({waitUntil:"networkidle"});
  await page.locator(".df2-sidebar nav button").filter({hasText:"Dnes"}).click();
  await expect(page.locator("[data-supplement-checklist]").first()).toContainText("Užito");
});
test("stock limits, skipped doses, shopping and purchase history behave predictably",async({page})=>{
  await fresh(page);
  const root=await addOne(page,{stock:"1",times:"09:00, 20:00"});
  await root.locator("[data-supplement-occurrence]").first().getByRole("button",{name:"Užito",exact:true}).click();
  await root.locator("[data-supplement-occurrence]").last().getByRole("button",{name:"Užito",exact:true}).click();
  const s=await page.evaluate(k=>JSON.parse(localStorage.getItem(k)),SUP_KEY);
  expect(s.intakes).toHaveLength(1);
  expect(s.supplements[0].stock).toBe(0);
  await root.getByRole("button",{name:/K nákupu/}).click();
  await expect(root).toContainText("Kreatin test");
  await root.getByRole("button",{name:"Potvrdit nákup (+ balení)"}).click();
  await root.getByRole("button",{name:"Dnes",exact:true}).click();
  await root.locator("[data-supplement-occurrence]").last().getByRole("button",{name:"Užito",exact:true}).click();
  const newStore=await page.evaluate(k=>JSON.parse(localStorage.getItem(k)),SUP_KEY);
  expect(newStore.intakes).toHaveLength(2);
  expect(newStore.supplements[0].stock).toBe(29);
  expect(newStore.purchases).toHaveLength(1);
  await root.locator("[data-supplement-occurrence]").last().getByRole("button",{name:/Užito/}).click();
  await root.locator("[data-supplement-occurrence]").last().getByRole("button",{name:"Vynechat"}).click();
  const after=await page.evaluate(k=>JSON.parse(localStorage.getItem(k)),SUP_KEY);
  expect(after.intakes.find(x=>x.time==="20:00").status).toBe("skipped");
  expect(after.supplements[0].stock).toBe(30);
});
test("invalid dose or time never saves and existing data survives other-module visits",async({page})=>{
  await fresh(page);
  const root=await supplements(page);
  await root.getByRole("button",{name:"+ Přidat suplement"}).click();
  const dialog=page.getByRole("dialog",{name:"Editor suplementu"});
  await dialog.getByRole("textbox",{name:"Název suplementu"}).fill("Vitamin test");
  await dialog.getByRole("textbox",{name:"Časy užívání"}).fill("25:12");
  await dialog.getByRole("button",{name:"Uložit suplement"}).click();
  await expect(dialog.getByRole("alert")).toContainText("Doplň dávku");
  await dialog.getByRole("textbox",{name:"Dávkování"}).fill("Podle doporučení");
  await dialog.getByRole("button",{name:"Uložit suplement"}).click();
  await expect(dialog.getByRole("alert")).toContainText("HH:MM");
  await dialog.getByRole("textbox",{name:"Časy užívání"}).fill("09:00");
  await dialog.getByRole("button",{name:"Uložit suplement"}).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole("tab",{name:"Gym & Tréninky"}).click();
  await page.getByRole("tab",{name:"Suplementy"}).click();
  await root.getByRole("button",{name:"Moje suplementy"}).click();
  await expect(root).toContainText("Vitamin test");
});
test("supplement views and modal stay usable on narrow screens",async({page})=>{
  await page.setViewportSize({width:375,height:812});
  await fresh(page);
  const root=await supplements(page);
  await root.getByRole("button",{name:"+ Přidat suplement"}).click();
  await expect(page.getByRole("dialog",{name:"Editor suplementu"})).toBeVisible();
  await expect(page.getByRole("textbox",{name:"Časy užívání"})).toBeVisible();
});
test("editing metadata in another tab does not undo a newly logged dose or restore stale stock",async({browser})=>{
  const context=await browser.newContext();
  const a=await context.newPage();
  const b=await context.newPage();
  await fresh(a);
  await b.goto(ROOT,{waitUntil:"networkidle"});
  await b.reload({waitUntil:"networkidle"});
  const primary=await addOne(a,{stock:"3"});
  const second=await supplements(b);
  await second.getByRole("button",{name:"Moje suplementy"}).click();
  await second.locator("[data-supplement-id]").getByRole("button",{name:"Upravit"}).click();
  await b.getByRole("dialog",{name:"Editor suplementu"}).getByRole("textbox",{name:"Značka suplementu"}).fill("Nová značka");
  await primary.locator("[data-supplement-occurrence]").getByRole("button",{name:"Užito",exact:true}).click();
  await b.getByRole("dialog",{name:"Editor suplementu"}).getByRole("button",{name:"Uložit suplement"}).click();
  const saved=await a.evaluate(k=>JSON.parse(localStorage.getItem(k)),SUP_KEY);
  expect(saved.intakes).toHaveLength(1);
  expect(saved.supplements[0].stock).toBe(2);
  expect(saved.supplements[0].brand).toBe("Nová značka");
  await context.close();
});

test("an explicit inventory recount does not make earlier dose reversals add phantom stock",async({page})=>{
  await fresh(page);
  const root=await addOne(page,{stock:"3"});
  await root.locator("[data-supplement-occurrence]").first().getByRole("button",{name:"Užito",exact:true}).click();
  await root.getByRole("button",{name:"Moje suplementy"}).click();
  await root.locator("[data-supplement-id]").getByRole("button",{name:"Upravit"}).click();
  const modal=page.getByRole("dialog",{name:"Editor suplementu"});
  await modal.getByRole("spinbutton",{name:"Aktuální zásoba"}).fill("20");
  await modal.getByRole("button",{name:"Uložit suplement"}).click();
  await root.getByRole("button",{name:"Dnes",exact:true}).click();
  await root.locator("[data-supplement-occurrence]").first().getByRole("button",{name:/Užito/}).click();
  const latest=await page.evaluate(k=>JSON.parse(localStorage.getItem(k)),SUP_KEY);
  expect(latest.supplements[0].stock).toBe(20);
  expect(latest.intakes).toHaveLength(0);
});

test("concurrent metadata-only edit preserves a newer schedule in another tab",async({browser})=>{
  const context=await browser.newContext();
  const a=await context.newPage(),b=await context.newPage();
  await fresh(a);
  await b.goto(ROOT,{waitUntil:"networkidle"});
  const rootA=await addOne(a);
  const rootB=await supplements(b);
  await rootB.getByRole("button",{name:"Moje suplementy"}).click();
  await rootB.locator("[data-supplement-id]").getByRole("button",{name:"Upravit"}).click();
  const modalB=b.getByRole("dialog",{name:"Editor suplementu"});
  await modalB.getByRole("textbox",{name:"Značka suplementu"}).fill("Značka upravená v druhém okně");
  await rootA.getByRole("button",{name:"Moje suplementy"}).click();
  await rootA.locator("[data-supplement-id]").getByRole("button",{name:"Upravit"}).click();
  const modalA=a.getByRole("dialog",{name:"Editor suplementu"});
  await modalA.getByRole("textbox",{name:"Časy užívání"}).fill("10:30");
  await modalA.getByRole("button",{name:"Uložit suplement"}).click();
  await modalB.getByRole("button",{name:"Uložit suplement"}).click();
  const result=await a.evaluate(k=>JSON.parse(localStorage.getItem(k)),SUP_KEY);
  expect(result.supplements[0].times).toEqual(["10:30"]);
  expect(result.supplements[0].brand).toBe("Značka upravená v druhém okně");
  expect(result.supplements[0].scheduleHistory.at(-1).times).toEqual(["10:30"]);
  await context.close();
});

test("concurrent brand edit retains newer package, price, notes and shopping selections",async({browser})=>{
  const context=await browser.newContext();
  const a=await context.newPage(),b=await context.newPage();
  await fresh(a);
  await b.goto(ROOT,{waitUntil:"networkidle"});
  const rootA=await addOne(a,{name:"Společný suplement"});
  const rootB=await supplements(b);
  await rootB.getByRole("button",{name:"Moje suplementy"}).click();
  await rootB.locator("[data-supplement-id]").getByRole("button",{name:"Upravit"}).click();
  const modalB=b.getByRole("dialog",{name:"Editor suplementu"});
  await modalB.getByRole("textbox",{name:"Značka suplementu"}).fill("Značka z B");

  await rootA.getByRole("button",{name:"Moje suplementy"}).click();
  await rootA.locator("[data-supplement-id]").getByRole("button",{name:"Upravit"}).click();
  const modalA=a.getByRole("dialog",{name:"Editor suplementu"});
  await modalA.getByRole("spinbutton",{name:"Velikost balení"}).fill("45");
  await modalA.getByRole("spinbutton",{name:"Cena balení"}).fill("425");
  await modalA.getByRole("textbox",{name:"Poznámky suplementu"}).fill("Nová poznámka z A");
  await modalA.getByRole("button",{name:"Uložit suplement"}).click();
  await rootA.locator("[data-supplement-id]").getByRole("button",{name:"Přidat k nákupu"}).click();

  await modalB.getByRole("button",{name:"Uložit suplement"}).click();
  const result=await a.evaluate(k=>JSON.parse(localStorage.getItem(k)),SUP_KEY);
  const x=result.supplements[0];
  expect(x.brand).toBe("Značka z B");
  expect(x.packServings).toBe(45);
  expect(x.packPriceCzk).toBe(425);
  expect(x.notes).toBe("Nová poznámka z A");
  expect(x.shopping).toBe(true);
  await context.close();
});

test("changing active state in one tab preserves another tab's newer intake time",async({browser})=>{
  const context=await browser.newContext();
  const a=await context.newPage(),b=await context.newPage();
  await fresh(a);
  await b.goto(ROOT,{waitUntil:"networkidle"});
  const rootA=await addOne(a,{name:"Ranní dávka"});
  const rootB=await supplements(b);
  await rootB.getByRole("button",{name:"Moje suplementy"}).click();
  await rootB.locator("[data-supplement-id]").getByRole("button",{name:"Upravit"}).click();
  const modalB=b.getByRole("dialog",{name:"Editor suplementu"});
  await modalB.getByRole("checkbox",{name:"Aktivní"}).uncheck();

  await rootA.getByRole("button",{name:"Moje suplementy"}).click();
  await rootA.locator("[data-supplement-id]").getByRole("button",{name:"Upravit"}).click();
  const modalA=a.getByRole("dialog",{name:"Editor suplementu"});
  await modalA.getByRole("textbox",{name:"Časy užívání"}).fill("10:30");
  await modalA.getByRole("button",{name:"Uložit suplement"}).click();
  await modalB.getByRole("button",{name:"Uložit suplement"}).click();

  const saved=await a.evaluate(k=>JSON.parse(localStorage.getItem(k)),SUP_KEY);
  expect(saved.supplements[0].active).toBe(false);
  expect(saved.supplements[0].times).toEqual(["10:30"]);
  expect(saved.supplements[0].scheduleHistory.at(-1).active).toBe(false);
  expect(saved.supplements[0].scheduleHistory.at(-1).times).toEqual(["10:30"]);
  await context.close();
});


const PACKSHOT_PNG=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9lNqIAAAAASUVORK5CYII=","base64");
const packshot={name:"supplement.png",mimeType:"image/png",buffer:PACKSHOT_PNG};
async function photoBlobExists(page,id){
  if(typeof id!=="string")throw Error("Image metadata was not saved before checking IndexedDB.");
  return page.evaluate(id=>new Promise((resolve,reject)=>{
    const req=indexedDB.open("dayframe-supplement-photos-v1",1);
    req.onerror=()=>reject(req.error);
    req.onsuccess=()=>{
      const db=req.result;
      if(!db.objectStoreNames.contains("photos")){db.close();reject(Error("Missing IndexedDB photos store."));return;}
      const tx=db.transaction("photos","readonly");
      const get=tx.objectStore("photos").get(id);
      get.onsuccess=()=>resolve(get.result instanceof Blob);
      get.onerror=()=>reject(get.error);
      tx.oncomplete=()=>db.close();
    };
  }),id);
}
test("uploading a supplement image saves a real local packshot visible across reloads and tabs",async({page})=>{
  await fresh(page);
  const root=await supplements(page);
  await root.getByRole("button",{name:"+ Přidat suplement"}).click();
  const modal=page.getByRole("dialog",{name:"Editor suplementu"});
  await modal.getByRole("textbox",{name:"Název suplementu"}).fill("Vitamin C s fotkou");
  await modal.getByRole("textbox",{name:"Dávkování"}).fill("Dle etikety");
  await modal.getByLabel("Nahrát fotografii suplementu").setInputFiles(packshot);
  await expect(modal.locator(".df2-supplement-photo img")).toBeVisible();
  await modal.getByRole("button",{name:"Uložit suplement"}).click();
  await expect(modal).toHaveCount(0);
  const state=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),SUP_KEY);
  expect(state.supplements).toHaveLength(1);
  const photoId=state.supplements[0].photoId;
  expect(photoId).toMatch(/^supp-photo-/);
  expect(await photoBlobExists(page,photoId)).toBe(true);
  expect(JSON.stringify(state)).not.toContain("data:image");
  await expect(root.locator("[data-supplement-occurrence] .df2-supplement-photo img")).toBeVisible();
  await root.getByRole("button",{name:"Moje suplementy"}).click();
  await expect(root.locator("[data-supplement-id] .df2-supplement-photo img")).toBeVisible();
  await page.reload({waitUntil:"networkidle"});
  const again=await supplements(page);
  await again.getByRole("button",{name:"Moje suplementy"}).click();
  await expect(again.locator("[data-supplement-id] .df2-supplement-photo img")).toBeVisible();
});
test("replacing or removing a photo preserves intake records and safely cleans up old image",async({page})=>{
  await fresh(page);
  const root=await addOne(page);
  await root.locator("[data-supplement-occurrence]").first().getByRole("button",{name:"Užito",exact:true}).click();
  await root.getByRole("button",{name:"Moje suplementy"}).click();
  await root.locator("[data-supplement-id]").getByRole("button",{name:"Upravit"}).click();
  const dialog=page.getByRole("dialog",{name:"Editor suplementu"});
  await dialog.getByLabel("Nahrát fotografii suplementu").setInputFiles(packshot);
  await dialog.getByRole("button",{name:"Uložit suplement"}).click();
  await expect(dialog).toHaveCount(0);
  const state1=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),SUP_KEY);
  const first=state1.supplements[0].photoId;
  expect(await photoBlobExists(page,first)).toBe(true);
  await root.locator("[data-supplement-id]").getByRole("button",{name:"Upravit"}).click();
  await dialog.getByLabel("Nahrát fotografii suplementu").setInputFiles({...packshot,name:"another.png"});
  await dialog.getByRole("button",{name:"Uložit suplement"}).click();
  await expect(dialog).toHaveCount(0);
  const state2=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),SUP_KEY);
  const second=state2.supplements[0].photoId;
  expect(second).not.toBe(first);
  await expect.poll(()=>photoBlobExists(page,first)).toBe(false);
  expect(await photoBlobExists(page,second)).toBe(true);
  await root.locator("[data-supplement-id]").getByRole("button",{name:"Upravit"}).click();
  await dialog.getByRole("button",{name:"Odebrat fotografii"}).click();
  await dialog.getByRole("button",{name:"Uložit suplement"}).click();
  await expect(dialog).toHaveCount(0);
  const state3=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),SUP_KEY);
  expect(state3.supplements[0].photoId).toBeUndefined();
  expect(state3.intakes).toEqual(state1.intakes);
  expect(state3.supplements[0].stock).toBe(state1.supplements[0].stock);
  await expect.poll(()=>photoBlobExists(page,second)).toBe(false);
  await expect(root.locator("[data-supplement-id] .df2-supplement-photo img")).toHaveCount(0);
});
test("an invalid photo or broken photo store never destroys an existing supplement",async({page})=>{
  await fresh(page);
  const root=await addOne(page,{name:"Původní doplněk"});
  const before=await page.evaluate(key=>localStorage.getItem(key),SUP_KEY);
  await root.getByRole("button",{name:"Moje suplementy"}).click();
  await root.locator("[data-supplement-id]").getByRole("button",{name:"Upravit"}).click();
  const dialog=page.getByRole("dialog",{name:"Editor suplementu"});
  await dialog.getByLabel("Nahrát fotografii suplementu").setInputFiles({
    name:"unsafe.svg",mimeType:"image/svg+xml",buffer:Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>")
  });
  await expect(dialog.getByRole("alert")).toContainText("JPG, PNG nebo WebP");
  await expect(dialog.locator(".df2-supplement-photo img")).toHaveCount(0);
  expect(await page.evaluate(key=>localStorage.getItem(key),SUP_KEY)).toBe(before);
  await dialog.getByLabel("Nahrát fotografii suplementu").setInputFiles({
    name:"huge.png",mimeType:"image/png",buffer:Buffer.alloc(6*1024*1024+1)
  });
  await expect(dialog.getByRole("alert")).toContainText("6 MB");
  expect(await page.evaluate(key=>localStorage.getItem(key),SUP_KEY)).toBe(before);
});


test("corrupt image bytes with a PNG MIME type show a neutral placeholder, not a broken photo icon",async({page})=>{
  await fresh(page);
  const root=await addOne(page,{name:"Poškozená fotografie"});
  await root.getByRole("button",{name:"Moje suplementy"}).click();
  await root.locator("[data-supplement-id]").getByRole("button",{name:"Upravit"}).click();
  const dialog=page.getByRole("dialog",{name:"Editor suplementu"});
  await dialog.getByLabel("Nahrát fotografii suplementu").setInputFiles({
    name:"corrupted.png",mimeType:"image/png",buffer:Buffer.from("this is not a PNG")
  });
  await expect(dialog.locator(".df2-supplement-photo-placeholder")).toBeVisible();
  await expect(dialog.locator(".df2-supplement-photo img")).toHaveCount(0);
  await dialog.getByRole("button",{name:"Uložit suplement"}).click();
  await expect(dialog).toHaveCount(0);
  await expect(root.locator("[data-supplement-id] .df2-supplement-photo-placeholder")).toBeVisible();
  await expect(root.locator("[data-supplement-id] .df2-supplement-photo img")).toHaveCount(0);
  await page.reload({waitUntil:"networkidle"});
  const again=await supplements(page);
  await again.getByRole("button",{name:"Moje suplementy"}).click();
  await expect(again.locator("[data-supplement-id] .df2-supplement-photo-placeholder")).toBeVisible();
  await expect(again.locator("[data-supplement-id] .df2-supplement-photo img")).toHaveCount(0);
});


test("compact daily cards group doses by time, show live progress and preserve quick check-in",async({page})=>{
  await page.setViewportSize({width:1440,height:900});
  await fresh(page);
  await addOne(page,{name:"B12 test",stock:"4",times:"09:00,20:00"});
  await addOne(page,{name:"Kreatin test",stock:"4",times:"09:00"});
  const root=await supplements(page);
  const groups=root.locator(".df2-supplements-time-group");
  await expect(groups).toHaveCount(2);
  await expect(groups.first().locator("[data-supplement-occurrence]")).toHaveCount(2);
  await expect(groups.last().locator("[data-supplement-occurrence]")).toHaveCount(1);
  await expect(groups.first().getByRole("heading",{name:"09:00"})).toBeVisible();
  const progress=root.getByRole("progressbar",{name:"Dnes užité dávky"});
  await expect(progress).toHaveAttribute("aria-valuemax","3");
  await expect(progress).toHaveAttribute("aria-valuenow","0");
  const first=groups.first().locator("[data-supplement-occurrence]").first();
  await expect(first).toHaveAttribute("data-intake-status","pending");
  await first.getByRole("button",{name:"Užito",exact:true}).click();
  await expect(first).toHaveAttribute("data-intake-status","taken");
  await expect(progress).toHaveAttribute("aria-valuenow","1");
  await expect(first).toContainText("Zbývá 3");
  const second=groups.first().locator("[data-supplement-occurrence]").last();
  await second.getByRole("button",{name:"Vynechat"}).click();
  await expect(second).toHaveAttribute("data-intake-status","skipped");
  await expect(root.locator(".df2-supplements-overview-detail")).toContainText("Vynecháno 1");
  await expect(progress).toHaveAttribute("aria-valuenow","1");
  await page.reload({waitUntil:"networkidle"});
  const reloaded=await supplements(page);
  await expect(reloaded.locator("[data-supplement-occurrence][data-intake-status=taken]")).toHaveCount(1);
  await expect(reloaded.locator("[data-supplement-occurrence][data-intake-status=skipped]")).toHaveCount(1);
  await expect(reloaded.getByRole("progressbar",{name:"Dnes užité dávky"})).toHaveAttribute("aria-valuenow","1");
  await reloaded.getByRole("button",{name:"Moje suplementy"}).click();
  await expect(reloaded.locator("[data-supplements-library] [data-supplement-id]")).toHaveCount(2);
  expect(await reloaded.locator(".df2-supplements-library").evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(" ").length)).toBeGreaterThan(1);
  await reloaded.locator("[data-supplement-id]").first().getByRole("button",{name:"Upravit"}).click();
  await expect(page.getByRole("dialog",{name:"Editor suplementu"})).toBeVisible();
});

test("responsive supplement cards stack on mobile without hiding inventory and history",async({page})=>{
  await page.setViewportSize({width:375,height:812});
  await fresh(page);
  const root=await addOne(page,{name:"Zinek test",stock:"5"});
  await expect(root.locator(".df2-supplements-dose-card")).toHaveCount(1);
  await expect(root.getByRole("progressbar",{name:"Dnes užité dávky"})).toBeVisible();
  await expect(root.locator(".df2-supplements-dose-card").first().getByRole("button",{name:"Užito",exact:true})).toBeVisible();
  await expect(root.locator(".df2-supplements-dose-card").first().getByRole("button",{name:"Vynechat"})).toBeVisible();
  expect(await root.locator(".df2-supplements-due").evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(" ").length)).toBe(1);
  await root.getByRole("button",{name:"Moje suplementy"}).click();
  await expect(root.locator("[data-supplements-library] [data-supplement-id]")).toHaveCount(1);
  await root.locator("[data-supplement-id]").getByRole("button",{name:"Přidat k nákupu"}).click();
  await root.getByRole("button",{name:/K nákupu/}).click();
  await expect(root.locator(".df2-supplements-shopping")).toContainText("Zinek test");
  await root.getByRole("button",{name:"Historie",exact:true}).click();
  await expect(root.locator("[data-supplements-history]")).toBeVisible();
});
