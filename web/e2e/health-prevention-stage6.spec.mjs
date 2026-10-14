import {test,expect} from "@playwright/test";
const ROOT=process.env.DAYFRAME_BASE_URL||"http://127.0.0.1:4173";
const KEY="dayframe-prevention-v1";
async function fresh(page){
  await page.clock.setFixedTime(new Date("2026-10-12T12:00:00"));
  await page.goto(ROOT,{waitUntil:"networkidle"});
  await page.evaluate(()=>localStorage.clear());
  await page.reload({waitUntil:"networkidle"});
}
async function goPrevention(page){
  await page.locator(".df2-sidebar nav button").filter({hasText:"Zdraví"}).click();
  await page.getByRole("tab",{name:"Prevence"}).click();
  return page.locator("[data-prevention-root]");
}
async function addAppointment(page,{title="Zubní kontrola",date="2026-10-15",reminderDays="7",repeatMonths="0"}={}){
  const root=await goPrevention(page);
  await root.getByRole("button",{name:"+ Přidat termín"}).click();
  const dialog=page.getByRole("dialog",{name:"Preventivní termín"});
  await dialog.getByRole("textbox",{name:"Název",exact:true}).fill(title);
  await dialog.getByLabel("Datum termínu (volitelné)").fill(date);
  await dialog.getByLabel("Připomenutí v Dnes").selectOption(reminderDays);
  await dialog.getByLabel("Opakování po splnění").selectOption(repeatMonths);
  await dialog.getByRole("button",{name:"Uložit termín"}).click();
  return root;
}
test("prevention is empty by default and an appointment appears exactly once in Today with correct deep link",async({page})=>{
  await fresh(page);
  const root=await goPrevention(page);
  await expect(root).toContainText("Zatím žádné termíny.");
  await page.locator(".df2-sidebar nav button").filter({hasText:"Dnes"}).click();
  await expect(page.locator("[data-prevention-checklist]")).toHaveCount(0);
  await addAppointment(page);
  await page.locator(".df2-sidebar nav button").filter({hasText:"Dnes"}).click();
  const row=page.locator("[data-prevention-checklist]");
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("Zubní kontrola");
  await row.getByRole("button",{name:/Otevřít preventivní termín/}).click();
  await expect(page.getByRole("tab",{name:"Prevence"})).toHaveAttribute("aria-selected","true");
  await expect(page.locator("[data-prevention-item]")).toHaveCount(1);
  const saved=await page.evaluate(k=>JSON.parse(localStorage.getItem(k)),KEY);
  expect(saved.items).toHaveLength(1);
  expect(saved.items[0]).toMatchObject({title:"Zubní kontrola",dueDate:"2026-10-15",reminderDays:7});
  await page.reload({waitUntil:"networkidle"});
  await expect(page.locator("[data-prevention-checklist]")).toHaveCount(1);
});
test("completing a recurring checkup preserves history and sets next due from actual completion",async({page})=>{
  await fresh(page);
  const root=await addAppointment(page,{date:"2026-10-12",repeatMonths:"6",reminderDays:"0"});
  await root.locator("[data-prevention-item]").getByRole("button",{name:"Zapsat splnění"}).click();
  const dialog=page.getByRole("dialog",{name:"Zapsat absolvovanou prevenci"});
  await dialog.getByLabel("Poznámka ke splnění (volitelné)").fill("Kontrola proběhla");
  await dialog.getByRole("button",{name:"Uložit splnění"}).click();
  await expect(root.locator("[data-prevention-item]")).toContainText("2027");
  const saved=await page.evaluate(k=>JSON.parse(localStorage.getItem(k)),KEY);
  expect(saved.items[0].dueDate).toBe("2027-04-12");
  expect(saved.items[0].history).toHaveLength(1);
  await root.getByRole("button",{name:"Historie",exact:true}).click();
  await expect(root.locator("[data-prevention-completion]")).toHaveCount(1);
  await page.locator(".df2-sidebar nav button").filter({hasText:"Dnes"}).click();
  const row=page.locator("[data-prevention-checklist]");
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("Splněno");
  // A second, older completion must not rewind the next six-month appointment.
  await goPrevention(page);
  await root.locator("[data-prevention-item]").getByRole("button",{name:"Zapsat splnění"}).click();
  const backdated=page.getByRole("dialog",{name:"Zapsat absolvovanou prevenci"});
  await backdated.getByLabel("Skutečné datum splnění").fill("2026-10-11");
  await backdated.getByRole("button",{name:"Uložit splnění"}).click();
  await expect(root.getByRole("alert")).toContainText("Změnu nelze bezpečně uložit");
  const after=await page.evaluate(k=>JSON.parse(localStorage.getItem(k)),KEY);
  expect(after.items[0].dueDate).toBe("2027-04-12");
  expect(after.items[0].history).toHaveLength(1);
});
test("editing in another tab must not erase a completion from the first tab",async({browser})=>{
  const context=await browser.newContext();
  const a=await context.newPage(),b=await context.newPage();
  await fresh(a);
  await addAppointment(a,{date:"2026-10-12"});
  await b.clock.setFixedTime(new Date("2026-10-12T12:00:00"));
  await b.goto(ROOT,{waitUntil:"networkidle"});
  const rootB=await goPrevention(b);
  await rootB.locator("[data-prevention-item]").getByRole("button",{name:"Upravit"}).click();
  const editB=b.getByRole("dialog",{name:"Preventivní termín"});
  await editB.getByLabel("Poskytovatel / místo (volitelné)").fill("Moje ordinace");
  const rootA=a.locator("[data-prevention-root]");
  await rootA.locator("[data-prevention-item]").getByRole("button",{name:"Zapsat splnění"}).click();
  await a.getByRole("dialog",{name:"Zapsat absolvovanou prevenci"}).getByRole("button",{name:"Uložit splnění"}).click();
  await editB.getByRole("button",{name:"Uložit termín"}).click();
  const saved=await a.evaluate(k=>JSON.parse(localStorage.getItem(k)),KEY);
  expect(saved.items[0].history).toHaveLength(1);
  expect(saved.items[0].dueDate).toBeNull();
  expect(saved.items[0].provider).toBe("Moje ordinace");
  await context.close();
});
test("invalid stored data blocks every write rather than resetting it",async({page})=>{
  await fresh(page);
  await page.evaluate(k=>localStorage.setItem(k,'{"version":999,"items":[]}'),KEY);
  await page.reload({waitUntil:"networkidle"});
  const root=await goPrevention(page);
  await expect(root.getByRole("alert")).toContainText("zablokované");
  await expect(root.getByRole("button",{name:"+ Přidat termín"})).toBeDisabled();
  expect(await page.evaluate(k=>localStorage.getItem(k),KEY)).toBe('{"version":999,"items":[]}');
});
test("editing, pausing and deletion work without changing other Health stores",async({page})=>{
  await fresh(page);
  const before=await page.evaluate(()=>localStorage.getItem("dayframe-body-v1"));
  const root=await addAppointment(page);
  await root.locator("[data-prevention-item]").getByRole("button",{name:"Upravit"}).click();
  const dialog=page.getByRole("dialog",{name:"Preventivní termín"});
  await dialog.getByRole("textbox",{name:"Název",exact:true}).fill("Zubní hygiena");
  await dialog.getByRole("button",{name:"Uložit termín"}).click();
  await expect(root.locator("[data-prevention-item]")).toContainText("Zubní hygiena");
  await root.locator("[data-prevention-item]").getByRole("button",{name:"Pozastavit"}).click();
  await expect(root.locator("[data-prevention-item]")).toHaveCount(0);
  await root.getByRole("button",{name:/Zobrazit/}).click();
  await root.locator("[data-prevention-paused]").getByRole("button",{name:"Aktivovat"}).click();
  await root.locator("[data-prevention-item]").getByRole("button",{name:"Upravit"}).click();
  page.once("dialog",d=>d.accept());
  await page.getByRole("dialog",{name:"Preventivní termín"}).getByRole("button",{name:"Odstranit včetně historie"}).click();
  await expect(root.locator("[data-prevention-item]")).toHaveCount(0);
  const store=await page.evaluate(k=>JSON.parse(localStorage.getItem(k)),KEY);
  expect(store.items).toHaveLength(0);
  expect(await page.evaluate(()=>localStorage.getItem("dayframe-body-v1"))).toBe(before);
});
test("prevention UI stays usable on a narrow mobile viewport",async({page})=>{
  await page.setViewportSize({width:375,height:812});
  await fresh(page);
  const root=await goPrevention(page);
  await root.getByRole("button",{name:"+ Přidat termín"}).click();
  const dialog=page.getByRole("dialog",{name:"Preventivní termín"});
  await expect(dialog.getByLabel("Datum termínu (volitelné)")).toBeVisible();
  await expect(dialog.getByRole("button",{name:"Uložit termín"})).toBeVisible();
});
