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
  expect(await page.evaluate(()=>localStorage.getItem("dayframe-hygiene-v1"))).toEqual(beforeHygiene);
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