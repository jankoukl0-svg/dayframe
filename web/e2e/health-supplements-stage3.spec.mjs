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
  await expect(entries).toHaveCount(1);
  await expect(entries.first()).toContainText("Suplementy");
  await expect(entries.first()).toContainText("1/2 užito");
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
  await expect(page.locator("[data-supplement-checklist]")).toHaveCount(1);
  await expect(page.locator("[data-supplement-checklist]").first()).toContainText("1/2 užito");
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


test("dayparts classify morning, afternoon and bedtime without changing saved intake times",async({page})=>{
  await fresh(page);
  const root=await addOne(page,{name:"Dávka test",stock:"6",times:"08:30,15:45,22:15"});
  const groups=root.locator("[data-supplement-daypart]");
  await expect(groups).toHaveCount(3);
  for(const [index,part,time] of [[0,"morning","08:30"],[1,"afternoon","15:45"],[2,"bedtime","22:15"]]){
    await expect(groups.nth(index)).toHaveAttribute("data-supplement-daypart",part);
    await expect(groups.nth(index).locator("[data-supplement-occurrence]")).toHaveCount(1);
    await expect(groups.nth(index)).toContainText(time);
  }
  await groups.last().getByRole("button",{name:"Užito",exact:true}).click();
  await expect(root.getByRole("progressbar",{name:"Dnes užité dávky"})).toHaveAttribute("aria-valuenow","1");
  const stored=await page.evaluate(k=>JSON.parse(localStorage.getItem(k)),SUP_KEY);
  expect(stored.supplements[0].times).toEqual(["08:30","15:45","22:15"]);
  expect(stored.intakes).toHaveLength(1);
  expect(stored.intakes[0].time).toBe("22:15");
  await root.getByRole("button",{name:"Moje suplementy"}).click();
  await expect(root.locator(".df2-supplements-library-dayparts span")).toHaveText(["Ráno","Odpoledne","Před spaním"]);
  await page.reload({waitUntil:"networkidle"});
  await supplements(page);
  await expect(root.locator('[data-supplement-occurrence][data-intake-status="taken"]')).toHaveCount(1);
});

test("daypart editor lets the user pick multiple periods and fine tune exact times",async({page})=>{
  await fresh(page);
  const root=await supplements(page);
  await root.getByRole("button",{name:"+ Přidat suplement"}).click();
  const dialog=page.getByRole("dialog",{name:"Editor suplementu"});
  await dialog.getByRole("textbox",{name:"Název suplementu"}).fill("Hořčík test");
  await dialog.getByRole("textbox",{name:"Dávkování"}).fill("Dle etikety");
  const picker=dialog.getByRole("group",{name:"Části dne užívání"});
  await expect(picker.getByRole("button",{name:"Ráno"})).toHaveAttribute("aria-pressed","true");
  await picker.getByRole("button",{name:"Odpoledne"}).click();
  await picker.getByRole("button",{name:"Před spaním"}).click();
  await expect(dialog.getByRole("textbox",{name:"Časy užívání"})).toHaveValue("09:00, 15:00, 22:00");
  await picker.getByRole("button",{name:"Ráno"}).click();
  await expect(dialog.getByRole("textbox",{name:"Časy užívání"})).toHaveValue("15:00, 22:00");
  await dialog.getByRole("textbox",{name:"Časy užívání"}).fill("14:40, 23:15");
  await dialog.getByRole("button",{name:"Uložit suplement"}).click();
  const stored=await page.evaluate(k=>JSON.parse(localStorage.getItem(k)),SUP_KEY);
  expect(stored.supplements[0].times).toEqual(["14:40","23:15"]);
  await expect(root.locator("[data-supplement-occurrence]")).toHaveCount(2);
  await root.getByRole("button",{name:"Moje suplementy"}).click();
  await root.locator("[data-supplement-id]").getByRole("button",{name:"Upravit"}).click();
  const modal=page.getByRole("dialog",{name:"Editor suplementu"});
  await modal.getByRole("textbox",{name:"Časy užívání"}).fill("08:20");
  await modal.getByRole("button",{name:"Uložit suplement"}).click();
  const after=await page.evaluate(k=>JSON.parse(localStorage.getItem(k)),SUP_KEY);
  expect(after.supplements[0].times).toEqual(["08:20"]);
  await root.getByRole("button",{name:"Dnes",exact:true}).click();
  await expect(root.locator("[data-supplement-daypart=morning] [data-supplement-occurrence]")).toHaveCount(1);
  await expect(root.locator("[data-supplement-daypart=afternoon] [data-supplement-occurrence]")).toHaveCount(0);
  await expect(root.locator("[data-supplement-daypart=bedtime] [data-supplement-occurrence]")).toHaveCount(0);
});


test("an existing supplement moves from morning to bedtime today without a reload",async({page})=>{
  await fresh(page);
  const root=await addOne(page,{name:"Magnesium",stock:"3",times:"09:00"});
  await root.getByRole("button",{name:"Moje suplementy"}).click();
  await root.locator("[data-supplement-id]").getByRole("button",{name:"Upravit"}).click();
  const dialog=page.getByRole("dialog",{name:"Editor suplementu"});
  await dialog.getByRole("textbox",{name:"Časy užívání"}).fill("22:00");
  await dialog.getByRole("button",{name:"Uložit suplement"}).click();
  await root.getByRole("button",{name:"Dnes",exact:true}).click();
  await expect(root.locator("[data-supplement-daypart=morning] [data-supplement-occurrence]")).toHaveCount(0);
  await expect(root.locator("[data-supplement-daypart=bedtime] [data-supplement-occurrence]")).toHaveCount(1);
  await expect(root.locator("[data-supplement-daypart=bedtime]")).toContainText("22:00");
  await page.locator(".df2-sidebar nav button").filter({hasText:"Dnes"}).click();
  await expect(page.locator('[data-supplement-checklist="summary"]')).toContainText("0/1 užito");
  const saved=await page.evaluate(k=>JSON.parse(localStorage.getItem(k)),SUP_KEY);
  expect(saved.supplements[0].scheduleHistory.at(-1).effectiveFrom).toBe("2026-10-12");
  await page.reload({waitUntil:"networkidle"});
  const again=await supplements(page);
  await expect(again.locator("[data-supplement-daypart=bedtime] [data-supplement-occurrence]")).toHaveCount(1);
});

test("older edits set to tomorrow migrate to today and appear in the correct group",async({page})=>{
  await fresh(page);
  await addOne(page,{name:"Psyllium",stock:"3",times:"09:00"});
  await page.evaluate(key=>{
    const store=JSON.parse(localStorage.getItem(key));
    const item=store.supplements[0];
    item.times=["15:00"];
    item.scheduleHistory.push({effectiveFrom:"2026-10-13",weekdays:[...item.weekdays],times:["15:00"],active:true});
    localStorage.setItem(key,JSON.stringify(store));
  },SUP_KEY);
  await page.reload({waitUntil:"networkidle"});
  const root=await supplements(page);
  await expect(root.locator("[data-supplement-daypart=morning] [data-supplement-occurrence]")).toHaveCount(0);
  await expect(root.locator("[data-supplement-daypart=afternoon] [data-supplement-occurrence]")).toHaveCount(1);
  await expect(root.locator("[data-supplement-daypart=afternoon]")).toContainText("15:00");
  const saved=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),SUP_KEY);
  expect(saved.supplements[0].scheduleHistory).toHaveLength(1);
  expect(saved.supplements[0].scheduleHistory[0].effectiveFrom).toBe("2026-10-12");
});

test("moving a taken dose never offers the same serving twice or consumes extra stock",async({page})=>{
  await fresh(page);
  const root=await addOne(page,{name:"Zinek",stock:"3",times:"09:00"});
  await root.locator("[data-supplement-occurrence]").getByRole("button",{name:"Užito",exact:true}).click();
  await root.getByRole("button",{name:"Moje suplementy"}).click();
  await root.locator("[data-supplement-id]").getByRole("button",{name:"Upravit"}).click();
  const dialog=page.getByRole("dialog",{name:"Editor suplementu"});
  await dialog.getByRole("textbox",{name:"Časy užívání"}).fill("22:00");
  await dialog.getByRole("button",{name:"Uložit suplement"}).click();
  await root.getByRole("button",{name:"Dnes",exact:true}).click();
  await expect(root.locator('[data-supplement-occurrence][data-intake-status="taken"]')).toHaveCount(1);
  await expect(root.locator('[data-supplement-occurrence][data-intake-status="pending"]')).toHaveCount(0);
  await expect(root.locator("[data-supplement-daypart=morning]")).toContainText("09:00");
  await expect(root.locator("[data-supplement-daypart=bedtime] [data-supplement-occurrence]")).toHaveCount(0);
  const saved=await page.evaluate(k=>JSON.parse(localStorage.getItem(k)),SUP_KEY);
  expect(saved.intakes).toHaveLength(1);
  expect(saved.supplements[0].stock).toBe(2);
  await root.locator("[data-supplement-daypart=morning] [data-supplement-occurrence]").getByRole("button",{name:/Užito/}).click();
  await expect(root.locator("[data-supplement-daypart=bedtime] [data-supplement-occurrence]")).toHaveCount(1);
});

test("pausing a supplement removes today's unlogged doses",async({page})=>{
  await fresh(page);
  const root=await addOne(page,{name:"Pozastavený",stock:"2",times:"09:00"});
  await root.getByRole("button",{name:"Moje suplementy"}).click();
  await root.locator("[data-supplement-id]").getByRole("button",{name:"Pozastavit"}).click();
  await root.getByRole("button",{name:"Dnes",exact:true}).click();
  await expect(root.locator("[data-supplement-occurrence]")).toHaveCount(0);
});

test("compact daily cards group doses by time, show live progress and preserve quick check-in",async({page})=>{
  await page.setViewportSize({width:1440,height:900});
  await fresh(page);
  await addOne(page,{name:"B12 test",stock:"4",times:"09:00,20:00"});
  await addOne(page,{name:"Kreatin test",stock:"4",times:"09:00"});
  const root=await supplements(page);
  const groups=root.locator(".df2-supplements-time-group");
  await expect(groups).toHaveCount(3);
  await expect(groups.nth(0)).toHaveAttribute("data-supplement-daypart","morning");
  await expect(groups.nth(1)).toHaveAttribute("data-supplement-daypart","afternoon");
  await expect(groups.nth(2)).toHaveAttribute("data-supplement-daypart","bedtime");
  await expect(groups.first().locator("[data-supplement-occurrence]")).toHaveCount(2);
  await expect(groups.nth(1).locator("[data-supplement-occurrence]")).toHaveCount(1);
  await expect(groups.last().locator("[data-supplement-occurrence]")).toHaveCount(0);
  await expect(groups.first().getByRole("heading",{name:"Ráno"})).toBeVisible();
  await expect(groups.first()).toContainText("09:00");
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
  expect(await root.locator("[data-supplement-daypart=morning] .df2-supplements-due").evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(" ").length)).toBe(1);
  await root.getByRole("button",{name:"Moje suplementy"}).click();
  await expect(root.locator("[data-supplements-library] [data-supplement-id]")).toHaveCount(1);
  await root.locator("[data-supplement-id]").getByRole("button",{name:"Přidat k nákupu"}).click();
  await root.getByRole("button",{name:/K nákupu/}).click();
  await expect(root.locator(".df2-supplements-shopping")).toContainText("Zinek test");
  await root.getByRole("button",{name:"Historie",exact:true}).click();
  await expect(root.locator("[data-supplements-history]")).toBeVisible();
});


test("Užito vše records all pending daily doses at once and survives reload without duplicate stock deductions",async({page})=>{
  await fresh(page);
  const root=await addOne(page,{name:"Kreatin",stock:"2",times:"09:00,20:00"});
  await addOne(page,{name:"Vitamin D",stock:"5",times:"09:00"});
  await expect(root.locator("[data-supplement-occurrence]")).toHaveCount(3);
  const all=root.getByRole("button",{name:"Užito vše",exact:true});
  await expect(all).toBeEnabled();
  await all.click();
  await expect(root.locator('[data-supplement-occurrence][data-intake-status="taken"]')).toHaveCount(3);
  await expect(root.getByRole("progressbar",{name:"Dnes užité dávky"})).toHaveAttribute("aria-valuenow","3");
  await expect(all).toBeDisabled();
  const snapshot=()=>page.evaluate(k=>{
    const s=JSON.parse(localStorage.getItem(k));
    return {intakes:s.intakes.length,stocks:Object.fromEntries(s.supplements.map(x=>[x.name,x.stock]))};
  },SUP_KEY);
  await expect.poll(snapshot).toEqual({intakes:3,stocks:{"Kreatin":0,"Vitamin D":4}});
  await page.reload({waitUntil:"networkidle"});
  await supplements(page);
  await expect(root.locator('[data-supplement-occurrence][data-intake-status="taken"]')).toHaveCount(3);
  await expect(root.getByRole("button",{name:"Užito vše",exact:true})).toBeDisabled();
  await expect.poll(snapshot).toEqual({intakes:3,stocks:{"Kreatin":0,"Vitamin D":4}});
  const first=root.locator("[data-supplement-occurrence]").first();
  await first.getByRole("button",{name:/Užito/}).click();
  await expect(root.locator('[data-supplement-occurrence][data-intake-status="pending"]')).toHaveCount(1);
  await root.getByRole("button",{name:"Užito vše",exact:true}).click();
  await expect.poll(snapshot).toEqual({intakes:3,stocks:{"Kreatin":0,"Vitamin D":4}});
});

test("Užito vše never partially consumes inventory and preserves deliberately skipped doses",async({page})=>{
  await fresh(page);
  const root=await addOne(page,{name:"Dvě dávky",stock:"1",times:"09:00,20:00"});
  await root.getByRole("button",{name:"Užito vše",exact:true}).click();
  await expect(root.locator('[data-supplement-occurrence][data-intake-status="taken"]')).toHaveCount(0);
  await expect(root).toContainText("není dost zásob");
  let saved=await page.evaluate(k=>JSON.parse(localStorage.getItem(k)),SUP_KEY);
  expect(saved.intakes).toHaveLength(0);
  expect(saved.supplements[0].stock).toBe(1);
  await root.locator("[data-supplement-occurrence]").last().getByRole("button",{name:"Vynechat"}).click();
  await root.getByRole("button",{name:"Užito vše",exact:true}).click();
  await expect(root.locator('[data-supplement-occurrence][data-intake-status="taken"]')).toHaveCount(1);
  await expect(root.locator('[data-supplement-occurrence][data-intake-status="skipped"]')).toHaveCount(1);
  saved=await page.evaluate(k=>JSON.parse(localStorage.getItem(k)),SUP_KEY);
  expect(saved.supplements[0].stock).toBe(0);
  expect(saved.intakes).toHaveLength(2);
  await expect(root.getByRole("progressbar",{name:"Dnes užité dávky"})).toHaveAttribute("aria-valuenow","1");
  await expect(root.getByRole("button",{name:"Užito vše",exact:true})).toBeDisabled();
});


test("seven supplement doses appear as one Today checklist entry and count as one task",async({page})=>{
  await fresh(page);
  await page.locator(".df2-sidebar nav button").filter({hasText:"Dnes"}).click();
  const checklist=page.locator("[data-daily-checklist]");
  const original=await checklist.locator("[data-checklist-progress]").innerText();
  const originalTotal=Number(original.split("/")[1]);
  expect(Number.isFinite(originalTotal)).toBe(true);
  const root=await addOne(page,{name:"Ranní vitamíny",stock:"7",times:"08:00,09:00,10:00,11:00"});
  await addOne(page,{name:"Kreatin",stock:"7",times:"12:00,13:00,14:00"});
  await expect(root.locator("[data-supplement-occurrence]")).toHaveCount(7);
  await page.locator(".df2-sidebar nav button").filter({hasText:"Dnes"}).click();
  const row=checklist.locator('[data-supplement-checklist="summary"]');
  await expect(checklist.locator("[data-supplement-checklist]")).toHaveCount(1);
  await expect(row).toContainText("Suplementy");
  await expect(row).toContainText("0/7 užito");
  await expect(row).not.toHaveClass(/done/);
  await expect(checklist.locator("[data-checklist-progress]")).toHaveText("0/"+(originalTotal+1));
  await row.getByRole("button",{name:"Otevřít suplementy ve Zdraví"}).click();
  await expect(page.getByRole("tab",{name:"Suplementy"})).toHaveAttribute("aria-selected","true");
  await root.getByRole("button",{name:"Užito vše",exact:true}).click();
  await expect(root.locator('[data-supplement-occurrence][data-intake-status="taken"]')).toHaveCount(7);
  await page.locator(".df2-sidebar nav button").filter({hasText:"Dnes"}).click();
  await expect(checklist.locator("[data-supplement-checklist]")).toHaveCount(1);
  await expect(row).toContainText("7/7 užito");
  await expect(row).toHaveClass(/done/);
  await expect(checklist.locator("[data-checklist-progress]")).toHaveText("1/"+(originalTotal+1));
  await page.reload({waitUntil:"networkidle"});
  await page.locator(".df2-sidebar nav button").filter({hasText:"Dnes"}).click();
  await expect(checklist.locator("[data-supplement-checklist]")).toHaveCount(1);
  await expect(row).toContainText("7/7 užito");
  await expect(checklist.locator("[data-checklist-progress]")).toHaveText("1/"+(originalTotal+1));
  const saved=await page.evaluate(k=>JSON.parse(localStorage.getItem(k)),SUP_KEY);
  expect(saved.intakes).toHaveLength(7);
  expect(saved.supplements.map(s=>s.stock).sort()).toEqual([3,4]);
});

test("Today supplement summary stays one row and shows taken/skipped progress separately",async({page})=>{
  await fresh(page);
  const root=await addOne(page,{name:"Zinek",stock:"4",times:"09:00,20:00"});
  await root.locator("[data-supplement-occurrence]").first().getByRole("button",{name:"Užito",exact:true}).click();
  await root.locator("[data-supplement-occurrence]").last().getByRole("button",{name:"Vynechat"}).click();
  await page.locator(".df2-sidebar nav button").filter({hasText:"Dnes"}).click();
  const checklist=page.locator("[data-daily-checklist]");
  const row=checklist.locator('[data-supplement-checklist="summary"]');
  await expect(checklist.locator("[data-supplement-checklist]")).toHaveCount(1);
  await expect(row).toContainText("1/2 užito · 1 vynecháno");
  await expect(row).toHaveClass(/done/);
  await row.getByRole("button",{name:"Otevřít suplementy ve Zdraví"}).click();
  await root.locator('[data-supplement-occurrence][data-intake-status="skipped"]').getByRole("button",{name:/Vynecháno/}).click();
  await page.locator(".df2-sidebar nav button").filter({hasText:"Dnes"}).click();
  await expect(row).toContainText("1/2 užito");
  await expect(row).not.toContainText("vynecháno");
  await expect(row).not.toHaveClass(/done/);
  const saved=await page.evaluate(k=>JSON.parse(localStorage.getItem(k)),SUP_KEY);
  expect(saved.intakes).toHaveLength(1);
  expect(saved.supplements[0].stock).toBe(3);
});


test("daily checklist bulk supplement checkbox updates doses, stock and history in both directions",async({page})=>{
  await fresh(page);
  const root=await addOne(page,{name:"Zinek test",stock:"3",times:"09:00, 20:00"});
  await page.locator(".df2-sidebar nav button").filter({hasText:"Dnes"}).click();
  const row=page.locator('[data-supplement-checklist="summary"]');
  await expect(row).toContainText("0/2 užito");
  const check=row.getByRole("button",{name:"Označit všechny dnešní suplementy jako užité"});
  await expect(check).toHaveAttribute("aria-pressed","false");
  await check.click();
  await expect(row).toContainText("2/2 užito");
  await expect(row.getByRole("button",{name:"Vrátit užité suplementy jako neužité"})).toHaveAttribute("aria-pressed","true");
  await row.getByRole("button",{name:"Otevřít suplementy ve Zdraví"}).click();
  await expect(root.locator('[data-intake-status="taken"]')).toHaveCount(2);
  let saved=await page.evaluate(k=>JSON.parse(localStorage.getItem(k)),SUP_KEY);
  expect(saved.supplements[0].stock).toBe(1);
  await page.reload({waitUntil:"networkidle"});
  await page.locator(".df2-sidebar nav button").filter({hasText:"Dnes"}).click();
  await expect(row).toContainText("2/2 užito");
  await row.getByRole("button",{name:"Vrátit užité suplementy jako neužité"}).click();
  await expect(row).toContainText("0/2 užito");
  saved=await page.evaluate(k=>JSON.parse(localStorage.getItem(k)),SUP_KEY);
  expect(saved.supplements[0].stock).toBe(3);
  expect(saved.intakes).toHaveLength(0);
  await row.getByRole("button",{name:"Otevřít suplementy ve Zdraví"}).click();
  await expect(root.locator('[data-intake-status="pending"]')).toHaveCount(2);
});

test("daily checklist does not partially mark supplement doses if stock is insufficient",async({page})=>{
  await fresh(page);
  await addOne(page,{name:"Test zásoby",stock:"1",times:"09:00, 20:00"});
  await page.locator(".df2-sidebar nav button").filter({hasText:"Dnes"}).click();
  const row=page.locator('[data-supplement-checklist="summary"]');
  await row.getByRole("button",{name:"Označit všechny dnešní suplementy jako užité"}).click();
  await expect(row).toContainText("0/2 užito");
  await expect(page.locator("[data-daily-checklist]")).toContainText("Nedostatečná zásoba");
  const saved=await page.evaluate(k=>JSON.parse(localStorage.getItem(k)),SUP_KEY);
  expect(saved.intakes).toHaveLength(0);
  expect(saved.supplements[0].stock).toBe(1);
});
