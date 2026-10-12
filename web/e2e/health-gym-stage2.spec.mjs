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
  await root.locator("[data-gym-schedule] summary").click();
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
  await expect(page.locator("[data-gym-schedule]")).toHaveAttribute("open","");
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
  await expect(page.locator("[data-gym-schedule]")).toHaveAttribute("open","");
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
  await root.getByRole("button",{name:"Přidat cvik do Upper"}).click();
  const customChoice=root.getByRole("region",{name:"Výběr cviku – Přidat cvik do Upper"});
  await customChoice.getByRole("searchbox",{name:"Hledat cvik"}).fill("Bulharský dřep");
  await customChoice.locator('[data-gym-picker-exercise]').filter({hasText:"Bulharský dřep"}).last().click();
  const saved=await page.evaluate(k=>JSON.parse(localStorage.getItem(k)),KEY);
  expect(saved.plans[0].days[0].exercises.some(item=>saved.exercises.find(ex=>ex.id===item.exerciseId)?.name==="Bulharský dřep")).toBe(true);
  await root.getByRole("button",{name:"Tréninky",exact:true}).click();
  await root.locator("[data-gym-schedule] summary").click();
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
  await root.locator("[data-gym-schedule] summary").click();
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
  await again.getByRole("button",{name:"Přidat cvik do Upper"}).click();
  const add=again.getByRole("region",{name:"Výběr cviku – Přidat cvik do Upper"});
  await add.getByRole("searchbox",{name:"Hledat cvik"}).fill("pec deck");
  await add.locator('[data-gym-picker-exercise="pec-deck"]').click();
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


test("Push/Pull/Lower plan pickers start in the matching group and allow fast accented or accent-free search",async({page})=>{
  await fresh(page);
  const root=await gym(page);
  await root.getByRole("button",{name:"Použít split Push / Pull / Lower →"}).click();
  await root.getByRole("button",{name:"Plány",exact:true}).click();
  const editor=root.locator("[data-gym-plan-editor]");
  const days=editor.locator(".df2-gym-day-edit");
  await expect(days).toHaveCount(3);

  const push=days.nth(0);
  await push.getByRole("button",{name:"Přidat cvik do Push"}).click();
  const pushPicker=push.getByRole("region",{name:"Výběr cviku – Přidat cvik do Push"});
  await expect(pushPicker.getByRole("button",{name:"Push",exact:true})).toHaveAttribute("aria-pressed","true");
  await expect(pushPicker.locator('[data-gym-picker-exercise="bench-press"]')).toBeVisible();
  await expect(pushPicker.locator('[data-gym-picker-exercise="pull-up"]')).toHaveCount(0);
  await pushPicker.getByRole("searchbox",{name:"Hledat cvik"}).fill("rozpazovani");
  await expect(pushPicker.locator('[data-gym-picker-exercise="cable-chest-fly"]')).toBeVisible();
  await pushPicker.locator('[data-gym-picker-exercise="cable-chest-fly"]').click();
  await expect(pushPicker).toHaveCount(0);
  await expect(push).toContainText("Rozpažování na kladkách");

  const pull=days.nth(1);
  await pull.getByRole("button",{name:"Přidat cvik do Pull"}).click();
  const pullPicker=pull.getByRole("region",{name:"Výběr cviku – Přidat cvik do Pull"});
  await expect(pullPicker.getByRole("button",{name:"Pull",exact:true})).toHaveAttribute("aria-pressed","true");
  await pullPicker.getByRole("searchbox",{name:"Hledat cvik"}).fill("kladivove");
  await expect(pullPicker.locator('[data-gym-picker-exercise="hammer-curl"]')).toBeVisible();
  await pullPicker.locator('[data-gym-picker-exercise="hammer-curl"]').click();

  const lower=days.nth(2);
  await lower.getByRole("button",{name:"Přidat cvik do Lower"}).click();
  const lowerPicker=lower.getByRole("region",{name:"Výběr cviku – Přidat cvik do Lower"});
  await expect(lowerPicker.getByRole("button",{name:"Lower",exact:true})).toHaveAttribute("aria-pressed","true");
  await lowerPicker.getByRole("searchbox",{name:"Hledat cvik"}).fill("bulharsky");
  await lowerPicker.locator('[data-gym-picker-exercise="bulgarian-split-squat"]').click();

  const saved=await page.evaluate(k=>JSON.parse(localStorage.getItem(k)),KEY);
  const [a,b,c]=saved.plans[0].days;
  expect(a.exercises.some(ex=>ex.exerciseId==="cable-chest-fly")).toBe(true);
  expect(b.exercises.some(ex=>ex.exerciseId==="hammer-curl")).toBe(true);
  expect(c.exercises.some(ex=>ex.exerciseId==="bulgarian-split-squat")).toBe(true);
  await page.reload({waitUntil:"networkidle"});
  const reloaded=await gym(page);
  await reloaded.getByRole("button",{name:"Plány",exact:true}).click();
  await expect(reloaded.locator("[data-gym-plan-editor]")).toContainText("Rozpažování na kladkách");
  await expect(reloaded.locator("[data-gym-plan-editor]")).toContainText("Kladivové bicepsové zdvihy");
});

test("All groups, no-results, keyboard Escape and Enter work in a real plan picker",async({page})=>{
  await fresh(page);
  const root=await createPlan(page);
  await root.getByRole("button",{name:"Plány",exact:true}).click();
  const day=root.locator(".df2-gym-day-edit").first();
  const toggle=day.getByRole("button",{name:"Přidat cvik do Upper"});
  await toggle.click();
  const picker=day.getByRole("region",{name:"Výběr cviku – Přidat cvik do Upper"});
  await expect(picker.getByRole("button",{name:"Vše",exact:true})).toHaveAttribute("aria-pressed","true");
  await expect(picker.locator(".df2-gym-picker-group")).toHaveCount(4);
  const search=picker.getByRole("searchbox",{name:"Hledat cvik"});
  await search.fill("neexistujicicvikXYZ");
  await expect(picker).toContainText("Žádné odpovídající cviky");
  await search.press("Escape");
  await expect(picker).toHaveCount(0);
  await expect(toggle).toBeFocused();
  await toggle.click();
  const again=day.getByRole("region",{name:"Výběr cviku – Přidat cvik do Upper"});
  await again.getByRole("searchbox",{name:"Hledat cvik"}).fill("face pull");
  await again.getByRole("searchbox",{name:"Hledat cvik"}).press("Enter");
  await expect(again).toHaveCount(0);
  await expect(day).toContainText("Face pull");
});

test("same searchable picker adds and replaces logged exercises without disturbing completed history",async({page})=>{
  await fresh(page);
  const root=await createPlan(page);
  await root.locator("[data-gym-occurrence]").first().getByRole("button",{name:"Zahájit"}).click();
  const first=root.locator("[data-gym-log-exercise]").first();
  const original=await first.getAttribute("data-gym-log-exercise");
  await root.getByRole("button",{name:"Přidat cvik během tréninku"}).click();
  const add=root.getByRole("region",{name:"Výběr cviku – Přidat cvik během tréninku"});
  await add.getByRole("searchbox",{name:"Hledat cvik"}).fill("face pull");
  await add.locator('[data-gym-picker-exercise="face-pull"]').click();
  await expect(root.locator('[data-gym-log-exercise="face-pull"]')).toBeVisible();
  await first.getByRole("button",{name:/Vyměnit cvik/}).click();
  const picker=first.getByRole("region",{name:/Výběr cviku – Vyměnit cvik/});
  await picker.getByRole("searchbox",{name:"Hledat cvik"}).fill("kladivove zdvihy");
  await picker.locator('[data-gym-picker-exercise="hammer-curl"]').click();
  await expect(root.locator('[data-gym-log-exercise="hammer-curl"]')).toBeVisible();
  await expect(root.locator('[data-gym-log-exercise="'+original+'"]')).toHaveCount(0);
  const saved=await page.evaluate(k=>JSON.parse(localStorage.getItem(k)),KEY);
  expect(saved.sessions[0].exercises.some(ex=>ex.exerciseId==="face-pull")).toBe(true);
  expect(saved.sessions[0].exercises.some(ex=>ex.exerciseId==="hammer-curl")).toBe(true);
});


test("pecdec finds chest and reverse rear delt variants from Pull with correct split and persists to the existing plan",async({page})=>{
  await fresh(page);
  const root=await gym(page);
  await root.getByRole("button",{name:"Použít split Push / Pull / Lower →"}).click();
  await root.getByRole("button",{name:"Plány",exact:true}).click();
  const days=root.locator("[data-gym-plan-editor] .df2-gym-day-edit");
  const pull=days.nth(1);
  await pull.getByRole("button",{name:"Přidat cvik do Pull"}).click();
  const chooser=pull.getByRole("region",{name:"Výběr cviku – Přidat cvik do Pull"});
  await expect(chooser.getByRole("button",{name:"Pull",exact:true})).toHaveAttribute("aria-pressed","true");
  await expect(chooser.locator('[data-gym-picker-exercise="reverse-pec-deck"]')).toBeVisible();
  await expect(chooser.locator('[data-gym-picker-exercise="pec-deck"]')).toHaveCount(0);
  const input=chooser.getByRole("searchbox",{name:"Hledat cvik"});
  await input.fill("pecdec");
  // Searching automatically expands all groups, even though this day defaults to Pull.
  await expect(chooser.getByRole("button",{name:"Vše",exact:true})).toHaveAttribute("aria-pressed","true");
  await expect(chooser.locator('[data-gym-picker-exercise="reverse-pec-deck"]')).toBeVisible();
  await expect(chooser.locator('[data-gym-picker-exercise="pec-deck"]')).toBeVisible();
  // A chip deliberately clicked by the user must remain selected while typing.
  await chooser.getByRole("button",{name:"Pull",exact:true}).click();
  await input.fill("");
  await input.fill("pecdec");
  await expect(chooser.getByRole("button",{name:"Pull",exact:true})).toHaveAttribute("aria-pressed","true");
  await expect(chooser.locator('[data-gym-picker-exercise="pec-deck"]')).toHaveCount(0);
  await expect(chooser.locator('[data-gym-picker-exercise="reverse-pec-deck"]')).toBeVisible();
  await chooser.getByRole("button",{name:"Vše",exact:true}).click();
  await input.fill("pecdec na zadni ramena");
  await expect(chooser.locator('[data-gym-picker-exercise]')).toHaveCount(1);
  await chooser.locator('[data-gym-picker-exercise="reverse-pec-deck"]').click();
  await expect(pull).toContainText("Obrácený pec deck");

  const push=days.nth(0);
  await push.getByRole("button",{name:"Přidat cvik do Push"}).click();
  const pushChooser=push.getByRole("region",{name:"Výběr cviku – Přidat cvik do Push"});
  await expect(pushChooser.getByRole("button",{name:"Push",exact:true})).toHaveAttribute("aria-pressed","true");
  await expect(pushChooser.locator('[data-gym-picker-exercise="pec-deck"]')).toBeVisible();
  await expect(pushChooser.locator('[data-gym-picker-exercise="reverse-pec-deck"]')).toHaveCount(0);
  await pushChooser.getByRole("searchbox",{name:"Hledat cvik"}).fill("pec dec");
  await expect(pushChooser.locator('[data-gym-picker-exercise="pec-deck"]')).toBeVisible();
  await pushChooser.locator('[data-gym-picker-exercise="pec-deck"]').click();
  await expect(push).toContainText("Pec deck (motýlek)");

  const saved=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),KEY);
  const [pushDay,pullDay]=saved.plans[0].days;
  expect(pushDay.exercises.some(x=>x.exerciseId==="pec-deck")).toBe(true);
  expect(pullDay.exercises.some(x=>x.exerciseId==="reverse-pec-deck")).toBe(true);
  expect(saved.exercises.filter(e=>["pec-deck","reverse-pec-deck"].includes(e.id))).toHaveLength(2);
  await page.reload({waitUntil:"networkidle"});
  const again=await gym(page);
  await again.getByRole("button",{name:"Plány",exact:true}).click();
  await expect(again.locator("[data-gym-plan-editor]")).toContainText("Obrácený pec deck");
  await expect(again.locator("[data-gym-plan-editor]")).toContainText("Pec deck (motýlek)");
});

test("exercise library search accepts pecdec as an alias for both catalog movements",async({page})=>{
  await fresh(page);
  const root=await gym(page);
  await root.getByRole("button",{name:"Cviky",exact:true}).click();
  await root.getByRole("searchbox",{name:"Hledat cviky"}).fill("pecdec");
  await expect(root.locator("[data-gym-library-count]")).toContainText("2 z 72 cviků");
  await expect(root.locator(".df2-gym-library")).toContainText("Pec deck (motýlek)");
  await expect(root.locator(".df2-gym-library")).toContainText("Obrácený pec deck");
});

test("simplified Gym shows the chosen workout and keeps advanced set fields optional and persistent",async({page})=>{
  await page.setViewportSize({width:375,height:812});
  await fresh(page);
  const root=await gym(page);
  await root.getByRole("button",{name:"Použít split Push / Pull / Lower →"}).click();
  const before=await page.evaluate(k=>JSON.parse(localStorage.getItem(k)),KEY);
  await expect(root.locator("[data-gym-split]").getByRole("heading",{name:"Vyber trénink"})).toBeVisible();
  await expect(root.locator("[data-gym-workout-preview]")).toContainText("3 série × 10 opak.");
  await expect(root.locator("[data-gym-week]")).not.toHaveAttribute("open","");
  await root.locator('[data-gym-day="Pull"]').click();
  await expect(root.locator("[data-gym-workout-preview]")).toContainText("Shyby");
  await root.locator('[data-gym-day="Push"]').click();
  await root.locator("[data-gym-workout-preview]").getByRole("button",{name:"Zahájit trénink"}).click();
  const set=root.locator("[data-gym-log-exercise]").first().locator("[data-gym-set]").first();
  await expect(set.getByRole("spinbutton",{name:/Váha v kg série 1/})).toBeVisible();
  await expect(set.getByRole("spinbutton",{name:/RPE série 1/})).toBeHidden();
  await set.getByText("Další možnosti série 1").click();
  await set.getByRole("spinbutton",{name:/RPE série 1/}).fill("8");
  await set.getByRole("spinbutton",{name:/Váha v kg série 1/}).fill("60");
  await set.getByRole("spinbutton",{name:/Opakování série 1/}).fill("10");
  await set.getByRole("button",{name:/Dokončit sérii 1/}).click();
  await expect(root.getByRole("progressbar",{name:"Dokončené série"})).toHaveAttribute("aria-valuenow","1");
  const after=await page.evaluate(k=>JSON.parse(localStorage.getItem(k)),KEY);
  expect(after.plans).toEqual(before.plans);
  expect(after.sessions[0].exercises[0].sets[0]).toMatchObject({weightKg:60,reps:10,rpe:8,done:true});
});

test("a gym user can build five recurring Push Pull Lower sessions from the weekly section without date fields",async({page})=>{
  await fresh(page);
  const root=await gym(page);
  await root.getByRole("button",{name:"Použít split Push / Pull / Lower →"}).click();
  const week=root.locator("[data-gym-week]");
  await expect(week).toBeVisible();
  await week.getByRole("combobox",{name:"Úterý – typ tréninku"}).selectOption({label:"Push"});
  await week.getByRole("combobox",{name:"Čtvrtek – typ tréninku"}).selectOption({label:"Pull"});
  await expect(week).toContainText("5 tréninků týdně");
  // Adding recurring instances does not clutter the workout-template switcher.
  await expect(root.locator("[data-gym-day]")).toHaveCount(3);
  await root.getByRole("button",{name:"Plány",exact:true}).click();
  await expect(root.locator("[data-gym-plan-editor] .df2-gym-day-edit")).toHaveCount(3);
  await root.getByRole("button",{name:"Tréninky",exact:true}).click();
  const saved=await page.evaluate(k=>JSON.parse(localStorage.getItem(k)),KEY);
  expect(saved.plans[0].days.filter(day=>day.scheduleHistory?.at(-1)?.weekday!==null)).toHaveLength(5);
  await page.reload({waitUntil:"networkidle"});
  const again=await gym(page);
  await expect(again.locator("[data-gym-week]")).toContainText("5 tréninků týdně");
  await expect(again.locator("[data-gym-schedule]")).not.toHaveAttribute("open","");
  await again.locator("[data-gym-schedule] summary").click();
  // The 14-day browser window runs from today - 3 to today + 10, not two full calendar weeks.
  await expect(again.locator("[data-gym-occurrence]")).toHaveCount(9);
});
