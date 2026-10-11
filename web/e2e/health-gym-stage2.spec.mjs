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

test("new plan does not appear in historical past weeks",async({page})=>{
  await fresh(page);
  const root=await createPlan(page,"Jen ode dne založení");
  await root.getByLabel("Prohlížet od data").fill("2026-09-28");
  await expect(root.locator('[data-gym-occurrence]')).toHaveCount(0);
});

test("invalidated completed set cannot silently remain done and historical session can reopen",async({page})=>{
  await fresh(page);
  const root=await createPlan(page,"Korekce");
  await root.locator("[data-gym-occurrence]").first().getByRole("button",{name:"Zahájit"}).click();
  const set=root.locator("[data-gym-log-exercise]").first().locator("[data-gym-set]").first();
  await set.getByRole("spinbutton",{name:/Váha v kg série 1/}).fill("75");
  await set.getByRole("spinbutton",{name:/Opakování série 1/}).fill("8");
  await set.getByRole("button",{name:/Dokončit sérii 1/}).click();
  await root.getByRole("button",{name:"Dokončit trénink",exact:true}).click();
  await set.getByRole("spinbutton",{name:/Váha v kg série 1/}).fill("");
  await expect(set.getByRole("button",{name:/Dokončit sérii 1/})).toHaveAttribute("aria-pressed","false");
  // Clearing the final valid set automatically reopens the completed workout.
  await expect(root.getByRole("button",{name:"Dokončit trénink"})).toBeVisible();
  let saved=await page.evaluate(k=>JSON.parse(localStorage.getItem(k)),KEY);
  expect(saved.sessions[0].completedAt).toBeNull();
  await set.getByRole("spinbutton",{name:/Váha v kg série 1/}).fill("75");
  await set.getByRole("button",{name:/Dokončit sérii 1/}).click();
  await root.getByRole("button",{name:"Dokončit trénink"}).click();
  await root.getByRole("button",{name:"Znovu otevřít trénink"}).click();
  saved=await page.evaluate(k=>JSON.parse(localStorage.getItem(k)),KEY);
  expect(saved.sessions[0].completedAt).toBeNull();
});


test("new user can opt into Push / Pull / Lower without losing original Gym data or adding duplicate tasks",async({page})=>{
  await fresh(page);
  const root=await gym(page);
  await expect(root.locator("[data-gym-setup]")).toBeVisible();
  await expect(root.locator("[data-gym-summary]")).toContainText("Nenastaveno");
  // First-run Gym storage may not exist until the user explicitly saves a plan.
  const initial=await page.evaluate(k=>localStorage.getItem(k),KEY);
  if(initial)expect(JSON.parse(initial)).toMatchObject({plans:[],activePlanId:null});
  await root.getByRole("button",{name:"Použít split Push / Pull / Lower →"}).click();
  await expect(root.locator("[data-gym-split]")).toBeVisible();
  const saved=await page.evaluate(k=>JSON.parse(localStorage.getItem(k)),KEY);
  expect(saved.plans).toHaveLength(1);
  expect(saved.plans[0].days.map(day=>day.name)).toEqual(["Push","Pull","Lower"]);
  expect(saved.activePlanId).toBe(saved.plans[0].id);
  await expect(root.locator("[data-gym-workout-preview]")).toContainText("Bench press");
  await root.locator('[data-gym-day="Pull"]').click();
  await expect(root.locator("[data-gym-workout-preview]")).toContainText("Shyby");
  await root.locator('[data-gym-day="Lower"]').click();
  await expect(root.locator("[data-gym-workout-preview]")).toContainText("Dřep s činkou");
  await page.reload({waitUntil:"networkidle"});
  const again=await gym(page);
  await expect(again.locator("[data-gym-split]")).toBeVisible();
  const after=await page.evaluate(k=>JSON.parse(localStorage.getItem(k)),KEY);
  expect(after.plans).toHaveLength(1);
  await page.locator(".df2-sidebar nav button").filter({hasText:"Dnes"}).click();
  await expect(page.locator("[data-gym-checklist]")).toHaveCount(1);
});

test("clean gym preview is sourced from the real saved plan and starts an editable workout",async({page})=>{
  await fresh(page);
  const root=await createPlan(page,"Vlastní Upper / Lower");
  await expect(root.locator("[data-gym-summary]")).toContainText("Vlastní Upper / Lower");
  await expect(root.locator("[data-gym-day]")).toHaveCount(2);
  await expect(root.locator("[data-gym-workout-preview]")).toContainText("Bench press");
  await root.locator("[data-gym-workout-preview]").getByRole("button",{name:"Zahájit trénink"}).click();
  await expect(root.getByRole("region",{name:"Tréninkový deník"})).toBeVisible();
  await expect(root.locator("[data-gym-log-exercise]").first()).toContainText("Bench press");
  await root.getByRole("button",{name:"← Zpět na plán"}).click();
  await expect(root.locator("[data-gym-schedule]")).toBeVisible();
  const saved=await page.evaluate(k=>JSON.parse(localStorage.getItem(k)),KEY);
  expect(saved.sessions).toHaveLength(1);
  expect(saved.sessions[0].completedAt).toBeNull();
});

test("mobile Gym dashboard keeps plan selection and the real workout preview readable",async({page})=>{
  await page.setViewportSize({width:375,height:812});
  await fresh(page);
  const root=await gym(page);
  await root.getByRole("button",{name:"Použít split Push / Pull / Lower →"}).click();
  await expect(root.locator("[data-gym-day]")).toHaveCount(3);
  await root.locator('[data-gym-day="Pull"]').click();
  await expect(root.locator("[data-gym-workout-preview]")).toContainText("Shyby");
});


test("historical schedule browsing does not change today's gym dashboard or the next actionable training",async({page})=>{
  await fresh(page);
  const root=await gym(page);
  await root.getByRole("button",{name:"Použít split Push / Pull / Lower →"}).click();
  const summary=root.locator("[data-gym-summary]");
  const initial=await summary.innerText();
  await expect(root.locator("[data-gym-workout-preview]").getByRole("button",{name:"Zahájit trénink"})).toBeVisible();
  await root.getByLabel("Prohlížet od data").fill("2026-09-28");
  await expect(root.locator("[data-gym-occurrence]")).toHaveCount(0);
  expect(await summary.innerText()).toBe(initial);
  await expect(root.locator("[data-gym-week]")).toContainText("Push");
  await root.locator("[data-gym-workout-preview]").getByRole("button",{name:"Zahájit trénink"}).click();
  await expect(root.getByRole("region",{name:"Tréninkový deník"})).toBeVisible();
});


test("exercise library includes common new gym movements with working Czech search and muscle filters",async({page})=>{
  await fresh(page);
  const root=await gym(page);
  await root.getByRole("button",{name:"Cviky",exact:true}).click();
  await expect(root.locator("[data-gym-library-count]")).toContainText("72 z 72 cviků");
  for(const name of ["Pec deck (motýlek)","Face pull","Bulharský dřep","Hip thrust",
    "Kladivové bicepsové zdvihy","Předkopávání na stroji","Přednožování ve visu"]){
    await expect(root.locator(".df2-gym-library")).toContainText(name);
  }
  await root.getByRole("searchbox",{name:"Hledat cviky"}).fill("hip thrust");
  await expect(root.locator("[data-gym-library-count]")).toContainText("1 z 72 cviků");
  await expect(root.locator(".df2-gym-library article")).toHaveCount(1);
  await root.getByRole("searchbox",{name:"Hledat cviky"}).fill("");
  await root.getByRole("combobox",{name:"Filtrovat podle partie"}).selectOption("Hrudník");
  await expect(root.locator(".df2-gym-library")).toContainText("Pec deck");
  await expect(root.locator(".df2-gym-library")).not.toContainText("Bulharský dřep");
  await root.getByRole("searchbox",{name:"Hledat cviky"}).fill("neexistujícícvikxyz");
  await expect(root.locator("[data-gym-library-empty]")).toBeVisible();
  await root.getByRole("searchbox",{name:"Hledat cviky"}).fill("");
  await root.getByRole("combobox",{name:"Filtrovat podle partie"}).selectOption("all");
  await expect(root.locator("[data-gym-library-count]")).toContainText("72 z 72 cviků");
});

test("existing saved plans and user exercises gain new standard exercises without losing history",async({page})=>{
  await fresh(page);
  const root=await createPlan(page,"Původní plán");
  const original=await page.evaluate(key=>{
    const state=JSON.parse(localStorage.getItem(key));
    const ids=new Set(["bench-press","incline-dumbbell","squat","romanian-deadlift",
      "deadlift","lat-pulldown","pull-up","cable-row","overhead-press",
      "lateral-raise","biceps-curl","triceps-pushdown","leg-press",
      "leg-curl","calf-raise","plank"]);
    state.exercises=state.exercises.filter(ex=>ids.has(ex.id));
    state.exercises.find(ex=>ex.id==="bench-press").technique="Upravená osobní instrukce";
    state.exercises.push({id:"user-test-cable",name:"Můj vlastní tah",muscle:"Záda",
      equipment:"Kladka",kind:"Silový",technique:"Můj vlastní popis",custom:true});
    localStorage.setItem(key,JSON.stringify(state));
    return {plans:state.plans,sessions:state.sessions,moves:state.moves};
  },KEY);
  await page.reload({waitUntil:"networkidle"});
  const again=await gym(page);
  await again.getByRole("button",{name:"Cviky",exact:true}).click();
  await expect(again.locator("[data-gym-library-count]")).toContainText("73 z 73 cviků");
  await expect(again.locator(".df2-gym-library")).toContainText("Můj vlastní tah");
  await expect(again.locator(".df2-gym-library")).toContainText("Upravená osobní instrukce");
  await expect(again.locator(".df2-gym-library")).toContainText("Pec deck (motýlek)");
  await again.getByRole("button",{name:"Plány",exact:true}).click();
  const add=again.getByRole("combobox",{name:"Přidat cvik do Upper"});
  await add.selectOption("pec-deck");
  const persisted=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),KEY);
  expect(persisted.exercises).toHaveLength(73);
  expect(persisted.plans).toHaveLength(1);
  expect(persisted.plans[0].days[0].exercises.some(e=>e.exerciseId==="pec-deck")).toBe(true);
  expect(persisted.plans[0].id).toBe(original.plans[0].id);
  expect(persisted.sessions).toEqual(original.sessions);
  expect(persisted.moves).toEqual(original.moves);
  await page.reload({waitUntil:"networkidle"});
  const loaded=await gym(page);
  await loaded.getByRole("button",{name:"Cviky",exact:true}).click();
  await expect(loaded.locator("[data-gym-library-count]")).toContainText("73 z 73 cviků");
});

test("unknown gym data remains blocked and untouched when the catalog expands",async({page})=>{
  await fresh(page);
  await page.evaluate(key=>localStorage.setItem(key,'{"version":999,"exercises":[]}'),KEY);
  await page.reload({waitUntil:"networkidle"});
  const root=await gym(page);
  await expect(root.getByRole("alert")).toContainText("zablokované");
  await root.getByRole("button",{name:"Cviky",exact:true}).click();
  expect(await page.evaluate(key=>localStorage.getItem(key),KEY)).toBe('{"version":999,"exercises":[]}');
});
