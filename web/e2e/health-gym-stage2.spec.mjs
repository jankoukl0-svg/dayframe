import {test,expect} from "@playwright/test";
const ROOT=process.env.DAYFRAME_BASE_URL||"http://127.0.0.1:4173";
const KEY="dayframe-gym-v1";

async function fresh(page){
  await page.clock.setFixedTime(new Date("2026-10-12T12:00:00"));
  await page.goto(ROOT,{waitUntil:"networkidle"});
  await page.evaluate(()=>localStorage.clear());
  await page.reload({waitUntil:"networkidle"});
}
async function gym(page){
  await page.locator(".df2-sidebar nav button").filter({hasText:"Zdraví"}).click();
  await page.getByRole("tab",{name:"Gym & Tréninky"}).click();
  return page.locator("[data-gym-root]");
}
async function createPlan(page,name="Můj Upper / Lower"){
  const root=await gym(page);
  await root.getByRole("button",{name:"+ Tréninkový plán"}).click();
  const modal=page.getByRole("dialog",{name:"Nový tréninkový plán"});
  await modal.getByRole("textbox",{name:"Název nového plánu"}).fill(name);
  await modal.getByRole("combobox",{name:"Šablona plánu"}).selectOption("upper-lower");
  await modal.getByRole("button",{name:"Vytvořit plán"}).click();
  await root.getByRole("button",{name:"Tréninky",exact:true}).click();
  return root;
}
test("active plan appears once in Today and Week, with one shared completion and persistent gym records",async({page})=>{
  await fresh(page);
  const root=await createPlan(page);
  const scheduled=root.locator("[data-gym-occurrence]");
  await expect(scheduled).toHaveCount(4); // two Mondays and two Thursdays in the 14-day window
  const first=scheduled.first();
  await first.getByRole("button",{name:"Zahájit"}).click();
  await expect(root.getByRole("region",{name:"Tréninkový deník"})).toBeVisible();
  const set=root.locator("[data-gym-log-exercise]").first().locator("[data-gym-set]").first();
  await set.getByRole("spinbutton",{name:/Váha v kg série 1/}).fill("80");
  await set.getByRole("spinbutton",{name:/Opakování série 1/}).fill("8");
  await set.getByRole("button",{name:/Dokončit sérii 1/}).click();
  await expect(set.getByRole("button",{name:/Dokončit sérii 1/})).toHaveAttribute("aria-pressed","true");
  await root.getByRole("button",{name:"Dokončit trénink",exact:true}).click();
  await page.locator(".df2-sidebar nav button").filter({hasText:"Dnes"}).click();
  const summary=page.locator("[data-gym-checklist]");
  await expect(summary).toHaveCount(1);
  await expect(summary).toContainText("Hotovo");
  await expect(page.locator("[data-health-checklist-routine]")).toHaveCount(0);
  await page.locator(".df2-sidebar nav button").filter({hasText:"Týden"}).click();
  const week=page.locator("[data-week-gym]");
  await expect(week).toHaveCount(2);
  await expect(week.first()).toContainText("Hotovo");
  await week.first().click();
  await expect(page.locator("[data-gym-root]")).toBeVisible();
  await expect(page.locator("[data-gym-log-exercise]").first()).toBeVisible();
  const saved=await page.evaluate(k=>JSON.parse(localStorage.getItem(k)),KEY);
  expect(saved.sessions).toHaveLength(1);
  expect(saved.sessions[0].completedAt).toBeTruthy();
  await page.reload({waitUntil:"networkidle"});
  await page.locator(".df2-sidebar nav button").filter({hasText:"Dnes"}).click();
  await expect(page.locator("[data-gym-checklist]")).toContainText("Hotovo");
});

test("workout can be moved between dates, shows once and cannot move a started occurrence",async({page})=>{
  await fresh(page);
  const root=await createPlan(page,"Přesuny");
  const before=root.locator("[data-gym-occurrence]").first();
  const key=await before.getAttribute("data-gym-occurrence");
  await before.locator('input[type="date"]').fill("2026-10-13");
  await expect(root.locator('[data-gym-occurrence="'+key+'"]')).toContainText("Přesunuto");
  await page.locator(".df2-sidebar nav button").filter({hasText:"Dnes"}).click();
  await expect(page.locator("[data-gym-checklist]")).toHaveCount(0);
  await page.locator(".df2-sidebar nav button").filter({hasText:"Týden"}).click();
  const moves=page.locator('[data-week-gym="'+key+'"]');
  await expect(moves).toHaveCount(1);
  await moves.click();
  const selected=page.locator('[data-gym-occurrence="'+key+'"]');
  await expect(selected).toBeVisible();
  await selected.getByRole("button",{name:"Zahájit"}).click();
  const stored=await page.evaluate(k=>JSON.parse(localStorage.getItem(k)),KEY);
  expect(stored.sessions).toHaveLength(1);
  expect(stored.moves[key]).toBe("2026-10-13");
});

test("custom exercises, plans and historical progress are retained without gym duplication",async({page})=>{
  await fresh(page);
  const root=await createPlan(page,"Výkonnost");
  await root.getByRole("button",{name:"Cviky",exact:true}).click();
  await root.getByRole("button",{name:"+ Vlastní cvik"}).click();
  const modal=page.getByRole("dialog",{name:"Vlastní cvik"});
  await modal.getByRole("textbox",{name:"Název cviku"}).fill("Bulharský dřep");
  await modal.getByRole("textbox",{name:"Svalová partie"}).fill("Nohy");
  await modal.getByRole("textbox",{name:"Vybavení"}).fill("Jednoručky");
  await modal.getByRole("button",{name:"Uložit cvik"}).click();
  await expect(root).toContainText("Bulharský dřep");
  await root.getByRole("button",{name:"Plány",exact:true}).click();
  await root.getByRole("combobox",{name:/Přidat cvik do Upper/}).selectOption({label:"Bulharský dřep"});
  const saved=await page.evaluate(k=>JSON.parse(localStorage.getItem(k)),KEY);
  expect(saved.plans[0].days[0].exercises.some(item=>saved.exercises.find(ex=>ex.id===item.exerciseId)?.name==="Bulharský dřep")).toBe(true);
  await root.getByRole("button",{name:"Tréninky",exact:true}).click();
  await root.locator("[data-gym-occurrence]").first().getByRole("button",{name:"Zahájit"}).click();
  const set=root.locator("[data-gym-log-exercise]").first().locator("[data-gym-set]").first();
  await set.getByRole("spinbutton",{name:/Váha v kg série 1/}).fill("90");
  await set.getByRole("spinbutton",{name:/Opakování série 1/}).fill("5");
  await set.getByRole("button",{name:/Dokončit sérii 1/}).click();
  await root.getByRole("button",{name:"Dokončit trénink",exact:true}).click();
  await root.getByRole("button",{name:"Progres",exact:true}).click();
  await expect(root.locator("[data-gym-progress]")).toContainText("Absolvované tréninky");
  await expect(root.locator("[data-gym-progress]")).toContainText("Odhad 1RM");
  await expect(root.locator("[data-gym-progress]")).toContainText("105 kg");
});

test("Gym interface stays usable at mobile width",async({page})=>{
  await page.setViewportSize({width:375,height:812});
  await fresh(page);
  const root=await gym(page);
  await expect(root.getByRole("button",{name:"+ Tréninkový plán"})).toBeVisible();
  await root.getByRole("button",{name:"Cviky",exact:true}).click();
  await expect(root.getByRole("searchbox",{name:"Hledat cviky"})).toBeVisible();
});

test("renaming a plan or day cannot store a transient blank name and block existing Gym data",async({page})=>{
  await fresh(page);
  const root=await createPlan(page,"Bezpečný plán");
  await root.getByRole("button",{name:"Plány",exact:true}).click();
  const planName=root.getByRole("textbox",{name:"Název plánu",exact:true});
  await planName.fill("");
  await root.getByRole("heading",{name:"Moje plány"}).click();
  await expect(root).toContainText("Název plánu nesmí být prázdný");
  await expect(planName).toHaveValue("Bezpečný plán");
  await planName.fill("Nový plán");
  await planName.press("Tab");
  const dayName=root.getByRole("textbox",{name:"Název tréninkového dne 1"});
  await dayName.fill("");
  await dayName.press("Tab");
  await expect(dayName).toHaveValue("Upper");
  await dayName.fill("Síla horní poloviny");
  await dayName.press("Tab");
  const saved=await page.evaluate(k=>JSON.parse(localStorage.getItem(k)),KEY);
  expect(saved.plans[0].name).toBe("Nový plán");
  expect(saved.plans[0].days[0].name).toBe("Síla horní poloviny");
  await page.reload({waitUntil:"networkidle"});
  const again=await gym(page);
  await expect(again).toContainText("Nový plán");
  await expect(again).not.toContainText("Tréninková data nelze bezpečně načíst");
});

test("a Gym deep link is consumed and an ordinary Health click returns to its overview",async({page})=>{
  await fresh(page);
  await createPlan(page);
  await page.locator(".df2-sidebar nav button").filter({hasText:"Týden"}).click();
  await page.locator("[data-week-gym]").first().click();
  await expect(page.getByRole("tab",{name:"Gym & Tréninky"})).toHaveAttribute("aria-selected","true");
  await page.locator(".df2-sidebar nav button").filter({hasText:"Dnes"}).click();
  await page.locator(".df2-sidebar nav button").filter({hasText:"Zdraví"}).click();
  await expect(page.getByRole("tab",{name:"Přehled"})).toHaveAttribute("aria-selected","true");
});
