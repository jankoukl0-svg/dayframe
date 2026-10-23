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
  await expect(root.locator("[data-gym-schedule]")).toHaveCount(0);
  await expect(root.locator("[data-gym-week]").getByRole("combobox",{name:/typ tréninku/})).toHaveCount(7);
  await root.locator("[data-gym-week]").getByLabel("Pondělí – čas tréninku").fill("17:00");
  await root.locator("[data-gym-week]").getByLabel("Čtvrtek – čas tréninku").fill("18:00");
  await root.locator("[data-gym-workout-preview]").getByRole("button",{name:"Zahájit trénink"}).click();
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
  // A completed occurrence opens its actual session rather than the calendar.
  await expect(page.locator("[data-gym-log-exercise]").first()).toBeVisible();
  const saved=await page.evaluate(k=>JSON.parse(localStorage.getItem(k)),KEY);
  expect(saved.sessions).toHaveLength(1);
  expect(saved.sessions[0].completedAt).toBeTruthy();
  await page.reload({waitUntil:"networkidle"});
  await page.locator(".df2-sidebar nav button").filter({hasText:"Dnes"}).click();
  await expect(page.locator("[data-gym-checklist]")).toContainText("Hotovo");
});

test("existing manually moved workouts survive removal of the date browser",async({page})=>{
  await fresh(page);
  const root=await createPlan(page,"Dřívější přesuny");
  await root.locator("[data-gym-week]").getByLabel("Pondělí – čas tréninku").fill("17:00");
  const movedKey=await page.evaluate(storageKey=>{
    const data=JSON.parse(localStorage.getItem(storageKey));
    const plan=data.plans[0],day=plan.days[0];
    const key=[plan.id,day.id,"2026-10-12"].join("|");
    data.moves[key]="2026-10-13";
    localStorage.setItem("dayframe-gym-v1",JSON.stringify(data));
    return key;
  },KEY);
  await page.reload({waitUntil:"networkidle"});
  await page.locator(".df2-sidebar nav button").filter({hasText:"Dnes"}).click();
  await expect(page.locator("[data-gym-checklist]")).toHaveCount(0);
  await page.locator(".df2-sidebar nav button").filter({hasText:"Týden"}).click();
  const moved=page.locator('[data-week-gym="'+movedKey+'"]');
  await expect(moved).toHaveCount(1);
  await moved.click();
  await expect(page.locator("[data-gym-schedule]")).toHaveCount(0);
  const preview=page.locator("[data-gym-workout-preview]");
  await expect(preview).toContainText("další út 13.");
  await preview.getByRole("button",{name:"Zahájit trénink"}).click();
  const data=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),KEY);
  expect(data.moves[movedKey]).toBe("2026-10-13");
  expect(data.sessions).toHaveLength(1);
  expect(data.sessions[0]).toMatchObject({occurrenceKey:movedKey,date:"2026-10-13"});
});

test("custom exercises, plans and historical progress are retained without gym duplication",async({page})=>{
  await fresh(page);
  const root=await createPlan(page,"Výkonnost");
  // The exercise catalog is not a separate screen; users create custom entries from Plans.
  await root.getByRole("button",{name:"Plány",exact:true}).click();
  await expect(root.getByRole("button",{name:"Cviky",exact:true})).toHaveCount(0);
  await root.getByRole("button",{name:"+ Vlastní cvik"}).click();
  const modal=page.getByRole("dialog",{name:"Vlastní cvik"});
  await modal.getByRole("textbox",{name:"Název cviku"}).fill("Bulharský dřep");
  await modal.getByRole("textbox",{name:"Svalová partie"}).fill("Nohy");
  await modal.getByRole("textbox",{name:"Vybavení"}).fill("Jednoručky");
  await modal.getByRole("button",{name:"Uložit cvik"}).click();
  const storedCustom=await page.evaluate(k=>JSON.parse(localStorage.getItem(k)).exercises,KEY);
  expect(storedCustom.find(ex=>ex.custom&&ex.name==="Bulharský dřep")).toMatchObject({custom:true,muscle:"Nohy",equipment:"Jednoručky"});
  await root.getByRole("button",{name:"Přidat cvik do Upper"}).click();
  const customChoice=root.getByRole("region",{name:"Výběr cviku – Přidat cvik do Upper"});
  await customChoice.getByRole("searchbox",{name:"Hledat cvik"}).fill("Bulharský dřep");
  await customChoice.locator('[data-gym-picker-exercise]').filter({hasText:"Bulharský dřep"}).last().click();
  const saved=await page.evaluate(k=>JSON.parse(localStorage.getItem(k)),KEY);
  expect(saved.plans[0].days[0].exercises.some(item=>saved.exercises.find(ex=>ex.id===item.exerciseId)?.name==="Bulharský dřep")).toBe(true);
  await root.getByRole("button",{name:"Tréninky",exact:true}).click();
  await root.locator("[data-gym-workout-preview]").getByRole("button",{name:"Zahájit trénink"}).click();
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
  await expect(root.locator(".df2-gym-nav button")).toHaveCount(3);
  await expect(root.getByRole("button",{name:"Cviky",exact:true})).toHaveCount(0);
  await expect(root.locator(".df2-gym-library")).toHaveCount(0);
  await root.getByRole("button",{name:"Plány",exact:true}).click();
  await expect(root.getByRole("button",{name:"+ Vlastní cvik"})).toBeVisible();
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

test("a Gym deep link is consumed and an ordinary Health click opens Gym by default",async({page})=>{
  await fresh(page);
  const root=await createPlan(page);
  await root.locator("[data-gym-week]").getByLabel("Pondělí – čas tréninku").fill("17:00");
  await page.locator(".df2-sidebar nav button").filter({hasText:"Týden"}).click();
  await page.locator("[data-week-gym]").first().click();
  await expect(page.getByRole("tab",{name:"Gym & Tréninky"})).toHaveAttribute("aria-selected","true");
  await page.locator(".df2-sidebar nav button").filter({hasText:"Dnes"}).click();
  await page.locator(".df2-sidebar nav button").filter({hasText:"Zdraví"}).click();
  await expect(page.getByRole("tab",{name:"Gym & Tréninky"})).toHaveAttribute("aria-selected","true");
});

test("new workout plans do not appear in weeks before they were created",async({page})=>{
  await fresh(page);
  const root=await createPlan(page,"Jen ode dne založení");
  await root.locator("[data-gym-week]").getByLabel("Pondělí – čas tréninku").fill("17:00");
  await page.clock.setFixedTime(new Date("2026-09-28T12:00:00"));
  await page.reload({waitUntil:"networkidle"});
  await page.locator(".df2-sidebar nav button").filter({hasText:"Týden"}).click();
  await expect(page.locator("[data-week-gym]")).toHaveCount(0);
});

test("invalidated completed set cannot silently remain done and historical session can reopen",async({page})=>{
  await fresh(page);
  const root=await createPlan(page,"Korekce");
  await root.locator("[data-gym-workout-preview]").getByRole("button",{name:"Zahájit trénink"}).click();
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
  await expect(root.locator(".df2-gym-session")).toHaveCSS("display","grid");
  await expect(root.locator(".df2-gym-session")).toHaveCSS("gap","10px");
  await expect(root.locator("[data-gym-log-exercise]").first()).toContainText("Bench press");
  await root.getByRole("button",{name:"← Zpět na plán"}).click();
  await expect(root.locator("[data-gym-schedule]")).toHaveCount(0);
  await expect(root.locator("[data-gym-week]")).toBeVisible();
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


test("Gym has only the weekly planner and starts directly from its workout preview",async({page})=>{
  await fresh(page);
  const root=await gym(page);
  await root.getByRole("button",{name:"Použít split Push / Pull / Lower →"}).click();
  const summary=root.locator("[data-gym-summary]");
  const initial=await summary.innerText();
  await expect(root.locator("[data-gym-schedule]")).toHaveCount(0);
  await expect(root.getByText("Konkrétní termíny a přesuny")).toHaveCount(0);
  await expect(root.locator("[data-gym-week]")).toContainText("Push");
  await root.locator('[data-gym-day="Pull"]').click();
  await root.locator('[data-gym-day="Push"]').click();
  expect(await summary.innerText()).toBe(initial);
  await root.locator("[data-gym-workout-preview]").getByRole("button",{name:"Zahájit trénink"}).click();
  await expect(root.getByRole("region",{name:"Tréninkový deník"})).toBeVisible();
});


test("the hidden exercise catalog remains searchable and grouped in the plan picker",async({page})=>{
  await fresh(page);
  const root=await gym(page);
  await expect(root.getByRole("button",{name:"Cviky",exact:true})).toHaveCount(0);
  await expect(root.locator(".df2-gym-library")).toHaveCount(0);
  await root.getByRole("button",{name:"Použít split Push / Pull / Lower →"}).click();
  await root.getByRole("button",{name:"Plány",exact:true}).click();
  await root.getByRole("button",{name:"Přidat cvik do Push"}).click();
  const picker=root.getByRole("region",{name:"Výběr cviku – Přidat cvik do Push"});
  await picker.getByRole("button",{name:"Vše",exact:true}).click();
  const names=["Pec deck (motýlek)","Face pull","Bulharský dřep","Hip thrust",
    "Kladivové bicepsové zdvihy","Předkopávání na stroji","Přednožování ve visu"];
  for(const name of names)await expect(picker.locator("[data-gym-picker-exercise]").filter({hasText:name})).toBeVisible();
  await picker.getByRole("searchbox",{name:"Hledat cvik"}).fill("hip thrust");
  await expect(picker.locator("[data-gym-picker-exercise]")).toHaveCount(1);
  await expect(picker.locator("[data-gym-picker-exercise]")).toContainText("Hip thrust");
  await picker.getByRole("searchbox",{name:"Hledat cvik"}).fill("neexistujícícvikxyz");
  await expect(picker.locator(".df2-gym-picker-empty")).toBeVisible();
  await picker.getByRole("searchbox",{name:"Hledat cvik"}).fill("pec deck");
  await picker.locator('[data-gym-picker-exercise="pec-deck"]').click();
  const saved=await page.evaluate(k=>JSON.parse(localStorage.getItem(k)),KEY);
  expect(saved.exercises).toHaveLength(83);
  expect(saved.plans[0].days[0].exercises.some(ex=>ex.exerciseId==="pec-deck")).toBe(true);
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
  await expect(again.getByRole("button",{name:"Cviky",exact:true})).toHaveCount(0);
  const recovered=await page.evaluate(k=>JSON.parse(localStorage.getItem(k)),KEY);
  // Hydration enriches the in-memory catalogue; persisted bytes are only updated on the next write.
  expect(recovered.exercises).toHaveLength(17);
  expect(recovered.exercises.find(ex=>ex.id==="user-test-cable")).toMatchObject({
    name:"Můj vlastní tah",technique:"Můj vlastní popis",custom:true,
  });
  expect(recovered.exercises.find(ex=>ex.id==="bench-press").technique).toBe("Upravená osobní instrukce");
  expect(recovered.exercises.some(ex=>ex.id==="pec-deck")).toBe(false);
  await again.getByRole("button",{name:"Plány",exact:true}).click();
  await again.getByRole("button",{name:"Přidat cvik do Upper"}).click();
  const add=again.getByRole("region",{name:"Výběr cviku – Přidat cvik do Upper"});
  await add.getByRole("searchbox",{name:"Hledat cvik"}).fill("pec deck");
  await add.locator('[data-gym-picker-exercise="pec-deck"]').click();
  const persisted=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),KEY);
  expect(persisted.exercises).toHaveLength(84);
  expect(persisted.plans).toHaveLength(1);
  expect(persisted.plans[0].days[0].exercises.some(e=>e.exerciseId==="pec-deck")).toBe(true);
  expect(persisted.plans[0].id).toBe(original.plans[0].id);
  expect(persisted.sessions).toEqual(original.sessions);
  expect(persisted.moves).toEqual(original.moves);
  await page.reload({waitUntil:"networkidle"});
  const loaded=await gym(page);
  await expect(loaded.getByRole("button",{name:"Cviky",exact:true})).toHaveCount(0);
  const reloadedStore=await page.evaluate(k=>JSON.parse(localStorage.getItem(k)),KEY);
  expect(reloadedStore.exercises).toHaveLength(84);
  expect(reloadedStore.exercises.find(ex=>ex.id==="user-test-cable")?.name).toBe("Můj vlastní tah");
});

test("unknown gym data remains blocked and untouched when the catalog expands",async({page})=>{
  await fresh(page);
  await page.evaluate(key=>localStorage.setItem(key,'{"version":999,"exercises":[]}'),KEY);
  await page.reload({waitUntil:"networkidle"});
  const root=await gym(page);
  await expect(root.getByRole("alert")).toContainText("zablokované");
  await root.getByRole("button",{name:"Plány",exact:true}).click();
  await expect(root.getByRole("button",{name:"+ Vlastní cvik"})).toBeDisabled();
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
  await root.locator("[data-gym-workout-preview]").getByRole("button",{name:"Zahájit trénink"}).click();
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

test("hidden catalog alias pecdec remains searchable inside workout-plan picker",async({page})=>{
  await fresh(page);
  const root=await gym(page);
  await root.getByRole("button",{name:"Použít split Push / Pull / Lower →"}).click();
  await root.getByRole("button",{name:"Plány",exact:true}).click();
  await root.getByRole("button",{name:"Přidat cvik do Push"}).click();
  const picker=root.getByRole("region",{name:"Výběr cviku – Přidat cvik do Push"});
  await picker.getByRole("searchbox",{name:"Hledat cvik"}).fill("pecdec");
  await expect(picker.locator("[data-gym-picker-exercise]")).toHaveCount(2);
  await expect(picker).toContainText("Pec deck (motýlek)");
  await expect(picker).toContainText("Obrácený pec deck");
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
  await expect(again.locator("[data-gym-schedule]")).toHaveCount(0);
  await expect(again.locator("[data-gym-week]")).toContainText("5 tréninků týdně");
});

test("a repeated template can start its nearest weekday and new templates do not create extra Monday workouts",async({page})=>{
  await fresh(page);
  const root=await gym(page);
  await root.getByRole("button",{name:"Použít split Push / Pull / Lower →"}).click();
  await root.locator("[data-gym-week]").getByRole("combobox",{name:"Úterý – typ tréninku"}).selectOption({label:"Push"});
  await root.getByRole("button",{name:"Plány",exact:true}).click();
  await root.locator("[data-gym-plan-editor]").getByRole("button",{name:"+ Tréninkový den"}).click();
  const before=await page.evaluate(k=>JSON.parse(localStorage.getItem(k)),KEY);
  expect(before.plans[0].days.at(-1).scheduleHistory.at(-1).weekday).toBeNull();
  await root.getByRole("button",{name:"Tréninky",exact:true}).click();
  await expect(root.locator("[data-gym-week]")).toContainText("4 tréninků týdně");
  await page.clock.setFixedTime(new Date("2026-10-13T12:00:00"));
  await page.reload({waitUntil:"networkidle"});
  const again=await gym(page);
  await expect(again.locator("[data-gym-workout-preview]")).toContainText("další út 13.");
  await again.locator("[data-gym-workout-preview]").getByRole("button",{name:"Zahájit trénink"}).click();
  const updated=await page.evaluate(k=>JSON.parse(localStorage.getItem(k)),KEY);
  expect(updated.sessions[0].date).toBe("2026-10-13");
  await again.getByRole("button",{name:"← Zpět na plán"}).click();
  const monday=again.locator('[data-gym-weekday="1"]');
  await expect(monday.getByRole("combobox",{name:"Pondělí – typ tréninku"})).toBeEnabled();
  await monday.getByRole("combobox",{name:"Pondělí – typ tréninku"}).selectOption({label:"Volno"});
  const following=await page.evaluate(k=>JSON.parse(localStorage.getItem(k)),KEY);
  expect(following.sessions).toHaveLength(1);
  expect(following.sessions[0].date).toBe("2026-10-13");
});

test("new gym templates show 'Nenaplánováno' until the user assigns a weekday",async({page})=>{
  await fresh(page);
  const root=await gym(page);
  await root.getByRole("button",{name:"Použít split Push / Pull / Lower →"}).click();
  await root.getByRole("button",{name:"Plány",exact:true}).click();
  await root.locator("[data-gym-plan-editor]").getByRole("button",{name:"+ Tréninkový den"}).click();
  await root.getByRole("button",{name:"Tréninky",exact:true}).click();
  await root.locator('[data-gym-day="Nový trénink"]').click();
  await expect(root.locator("[data-gym-workout-preview]")).toContainText("Nenaplánováno");
  await root.locator("[data-gym-week]").getByRole("combobox",{name:"Sobota – typ tréninku"}).selectOption({label:"Nový trénink"});
  await expect(root.locator("[data-gym-workout-preview]")).toContainText("Sobota");
});

test("Gym workouts appear on Week only once an actual start time has been chosen",async({page})=>{
  await fresh(page);
  const root=await gym(page);
  await root.getByRole("button",{name:"Použít split Push / Pull / Lower →"}).click();
  const calendarBefore=await page.evaluate(()=>localStorage.getItem("dayframe-v1"));
  await page.locator(".df2-sidebar nav button").filter({hasText:"Týden"}).click();
  await expect(page.locator("[data-week-gym]")).toHaveCount(0);
  await page.locator(".df2-sidebar nav button").filter({hasText:"Zdraví"}).click();
  await page.getByRole("tab",{name:"Gym & Tréninky"}).click();
  const week=page.locator("[data-gym-week]");
  await week.getByLabel("Pondělí – čas tréninku").fill("17:00");
  await week.getByLabel("Pondělí – délka tréninku").selectOption("90");
  const stored=await page.evaluate(k=>JSON.parse(localStorage.getItem(k)),KEY);
  expect(stored.plans[0].days[0].timeHistory).toEqual([{effectiveFrom:"2026-10-12",start:"17:00",duration:90}]);
  await page.locator(".df2-sidebar nav button").filter({hasText:"Týden"}).click();
  const tile=page.locator("[data-week-gym]");
  await expect(tile).toHaveCount(1);
  await expect(tile).toContainText("17:00–18:30");
  await expect(tile).toContainText("Push");
  const top=await tile.evaluate(el=>Number.parseFloat(getComputedStyle(el).top));
  expect(top).toBeGreaterThan(388);
  expect(top).toBeLessThan(390);
  expect(await page.evaluate(()=>localStorage.getItem("dayframe-v1"))).toBe(calendarBefore);
  await page.reload({waitUntil:"networkidle"});
  await page.locator(".df2-sidebar nav button").filter({hasText:"Týden"}).click();
  await expect(page.locator("[data-week-gym]")).toHaveCount(1);
  await page.locator("[data-week-gym]").click();
  await expect(page.locator("[data-gym-root]")).toBeVisible();
});

test("Gym and an overlapping calendar task have separate visible and clickable lanes",async({page})=>{
  await fresh(page);
  const root=await gym(page);
  await root.getByRole("button",{name:"Použít split Push / Pull / Lower →"}).click();
  await root.locator("[data-gym-week]").getByLabel("Pondělí – čas tréninku").fill("17:00");
  await page.evaluate(()=>{
    const key="dayframe-v1",state=JSON.parse(localStorage.getItem(key));
    state.plans["2026-10-12"]=[...(state.plans["2026-10-12"]??[]),{
      id:"gym-calendar-overlap",title:"Překryv s Gym",date:"2026-10-12",
      duration:60,start:"17:00",end:"18:00",requestedStart:"17:00",
      priority:"normal",category:"Studium",mode:"fixed",completed:false,
      source:"user",createdAt:"2026-10-12T09:00:00Z",
    }];
    localStorage.setItem(key,JSON.stringify(state));
  });
  await page.reload({waitUntil:"networkidle"});
  await page.locator(".df2-sidebar nav button").filter({hasText:"Týden"}).click();
  const gymTile=page.locator("[data-week-gym]").first();
  const taskTile=page.locator(".df2-week-task").filter({hasText:"Překryv s Gym"}).first();
  await expect(gymTile).toBeVisible();
  await expect(taskTile).toBeVisible();
  const gymRect=await gymTile.boundingBox(),taskRect=await taskTile.boundingBox();
  expect(gymRect.x+gymRect.width).toBeLessThanOrEqual(taskRect.x+2);
  await gymTile.click();
  await expect(page.locator("[data-gym-root]")).toBeVisible();
});

test("a historical unstarted Week workout opens its original plan after switching the active plan",async({page})=>{
  await fresh(page);
  const original=await createPlan(page,"Původní Upper");
  await original.locator("[data-gym-week]").getByLabel("Pondělí – čas tréninku").fill("17:00");
  const previousId=await page.evaluate(k=>JSON.parse(localStorage.getItem(k)).plans[0].id,KEY);
  await page.clock.setFixedTime(new Date("2026-10-13T12:00:00"));
  await page.reload({waitUntil:"networkidle"});
  const switched=await gym(page);
  await switched.getByRole("button",{name:"+ Tréninkový plán"}).click();
  const modal=page.getByRole("dialog",{name:"Nový tréninkový plán"});
  await modal.getByRole("textbox",{name:"Název nového plánu"}).fill("Nový Pull");
  await modal.getByRole("combobox",{name:"Šablona plánu"}).selectOption("ppl");
  await modal.getByRole("button",{name:"Vytvořit plán"}).click();
  await switched.locator(".df2-gym-plan-switch article").last().getByRole("button",{name:"Aktivovat"}).click();
  const activeId=await page.evaluate(k=>JSON.parse(localStorage.getItem(k)).activePlanId,KEY);
  expect(activeId).not.toBe(previousId);
  await page.clock.setFixedTime(new Date("2026-10-14T12:00:00"));
  await page.reload({waitUntil:"networkidle"});
  await page.locator(".df2-sidebar nav button").filter({hasText:"Týden"}).click();
  await page.locator("[data-week-gym]").first().click();
  const root=page.locator("[data-gym-root]");
  const preview=root.locator("[data-gym-workout-preview]");
  await expect(preview).toContainText("Původní Upper");
  await expect(preview).toContainText("Upper");
  await expect(preview).toContainText("po 12.");
  await expect(root.locator("[data-gym-week]").getByRole("combobox",{name:"Pondělí – typ tréninku"}).locator("option:checked")).toHaveText("Push");
  await root.locator('[data-gym-day="Lower"]').click();
  await expect(preview.getByRole("heading",{name:"Lower"})).toBeVisible();
  await expect(preview).toContainText("Původní Upper");
  await root.locator('[data-gym-day="Upper"]').click();
  await preview.getByRole("button",{name:"Zahájit trénink"}).click();
  const state=await page.evaluate(k=>JSON.parse(localStorage.getItem(k)),KEY);
  expect(state.sessions).toHaveLength(1);
  expect(state.sessions[0]).toMatchObject({planId:previousId,date:"2026-10-12"});
  expect(state.activePlanId).toBe(activeId);
});


/** Dispatch native drag events at exact Week grid coordinates (not the viewport scroll position). */
async function dragWorkoutOnWeek(page,fromIndex,toIndex,targetStart){
  await page.evaluate(({fromIndex})=>{
    const day=document.querySelectorAll(".df2-week-day")[fromIndex];
    const source=day?.querySelector("[data-week-gym]");
    if(!(source instanceof HTMLElement))throw Error("Gym block missing");
    const rect=source.getBoundingClientRect(),transfer=new DataTransfer();
    window.__gymWeekDragTransfer=transfer;
    source.dispatchEvent(new DragEvent("dragstart",{
      bubbles:true,cancelable:true,dataTransfer:transfer,
      clientX:rect.left+20,clientY:rect.top+8,
    }));
  },{fromIndex});
  await page.evaluate(({toIndex,targetStart})=>{
    const day=document.querySelectorAll(".df2-week-day")[toIndex];
    const target=day?.querySelector(".df2-time-body");
    const transfer=window.__gymWeekDragTransfer;
    if(!(target instanceof HTMLElement)||!(transfer instanceof DataTransfer))throw Error("Gym drop target missing");
    const [hours,mins]=targetStart.split(":").map(Number);
    const minute=(hours<8?hours+24:hours)*60+mins;
    const rect=target.getBoundingClientRect();
    target.dispatchEvent(new DragEvent("dragover",{
      bubbles:true,cancelable:true,dataTransfer:transfer,
      clientX:rect.left+Math.min(65,rect.width/2),
      clientY:rect.top+(minute-8*60)*0.72+8,
    }));
  },{toIndex,targetStart});
  const target=page.locator(".df2-week-day").nth(toIndex).locator(".df2-time-body");
  await expect(target.locator(".df2-drop-preview.valid")).toBeVisible();
  await page.evaluate(({toIndex,targetStart})=>{
    const target=document.querySelectorAll(".df2-week-day")[toIndex]?.querySelector(".df2-time-body");
    const transfer=window.__gymWeekDragTransfer;
    if(!(target instanceof HTMLElement)||!(transfer instanceof DataTransfer))throw Error("Gym drop target missing");
    const [hours,mins]=targetStart.split(":").map(Number);
    const minute=(hours<8?hours+24:hours)*60+mins;
    const rect=target.getBoundingClientRect();
    target.dispatchEvent(new DragEvent("drop",{
      bubbles:true,cancelable:true,dataTransfer:transfer,
      clientX:rect.left+Math.min(65,rect.width/2),
      clientY:rect.top+(minute-8*60)*0.72+8,
    }));
  },{toIndex,targetStart});
}

test("Gym block is draggable within Week and to another day; new time persists without changing recurring hours",async({page})=>{
  await fresh(page);
  const root=await createPlan(page,"Dragované tréninky");
  await root.locator("[data-gym-week]").getByLabel("Pondělí – čas tréninku").fill("17:00");
  await page.locator(".df2-sidebar nav button").filter({hasText:"Týden"}).click();
  const monday=page.locator(".df2-week-day").nth(0);
  const tuesday=page.locator(".df2-week-day").nth(1);
  const workout=monday.locator("[data-week-gym]").first();
  await expect(workout).toContainText("17:00");
  await expect(workout).toHaveAttribute("draggable","true");
  const key=await workout.getAttribute("data-week-gym");
  await dragWorkoutOnWeek(page,0,0,"18:30");
  await expect.poll(()=>page.evaluate(key=>{
    const store=JSON.parse(localStorage.getItem("dayframe-gym-v1"));
    return store.occurrenceTimes?.[key]?.start;
  },key)).toBe("18:30");
  await expect(monday.locator('[data-week-gym="'+key+'"]')).toContainText("18:30–19:30");
  await dragWorkoutOnWeek(page,0,1,"19:00");
  await expect(monday.locator('[data-week-gym="'+key+'"]')).toHaveCount(0);
  await expect(tuesday.locator('[data-week-gym="'+key+'"]')).toContainText("19:00–20:00");
  const snapshot=()=>page.evaluate(key=>{
    const store=JSON.parse(localStorage.getItem("dayframe-gym-v1"));
    return {date:store.moves[key],time:store.occurrenceTimes?.[key]?.start,duration:store.occurrenceTimes?.[key]?.duration};
  },key);
  await expect.poll(snapshot).toEqual({date:"2026-10-13",time:"19:00",duration:60});
  await page.reload({waitUntil:"networkidle"});
  await page.locator(".df2-sidebar nav button").filter({hasText:"Týden"}).click();
  await expect(page.locator(".df2-week-day").nth(1).locator('[data-week-gym="'+key+'"]')).toContainText("19:00");
  await page.locator(".df2-week-controls button").filter({hasText:"→"}).click();
  await expect(page.locator(".df2-week-day").nth(0).locator("[data-week-gym]")).toContainText("17:00");
  await page.locator(".df2-week-controls button").filter({hasText:"←"}).click();
  await page.locator(".df2-week-day").nth(1).locator('[data-week-gym="'+key+'"]').click();
  await expect(page.getByRole("tab",{name:"Gym & Tréninky"})).toHaveAttribute("aria-selected","true");
  const gymRoot=page.locator("[data-gym-root]");
  await expect(gymRoot.locator("[data-gym-workout-preview]")).toContainText("út 13.");
  await gymRoot.locator("[data-gym-workout-preview]").getByRole("button",{name:"Zahájit trénink"}).click();
  const stored=await page.evaluate(()=>JSON.parse(localStorage.getItem("dayframe-gym-v1")));
  const session=stored.sessions.find(session=>session.occurrenceKey===key);
  expect(session).toMatchObject({date:"2026-10-13",scheduledTime:{start:"19:00",duration:60}});
  await page.locator(".df2-sidebar nav button").filter({hasText:"Týden"}).click();
  await expect(page.locator(".df2-week-day").nth(1).locator('[data-week-gym="'+key+'"]')).toHaveAttribute("draggable","false");
});


test("past calendar Gym workout can be deleted once without removing future recurring instances",async({page})=>{
  await fresh(page);
  const root=await createPlan(page,"Historický trénink");
  await root.locator("[data-gym-week]").getByLabel("Pondělí – čas tréninku").fill("17:00");
  const original=await page.evaluate(k=>{
    const s=JSON.parse(localStorage.getItem(k));
    return {plan:JSON.stringify(s.plans),key:[s.plans[0].id,s.plans[0].days[0].id,"2026-10-12"].join("|")};
  },KEY);
  await page.clock.setFixedTime(new Date("2026-10-14T12:00:00"));
  await page.reload({waitUntil:"networkidle"});
  await page.locator(".df2-sidebar nav button").filter({hasText:"Týden"}).click();
  const monday=page.locator(".df2-week-day").nth(0);
  await expect(monday.locator('[data-week-gym="'+original.key+'"]')).toBeVisible();
  const remove=monday.getByRole("button",{name:/Smazat trénink .* ze dne 2026-10-12/});
  await monday.locator("[data-week-gym]").first().hover();
  // A history-delete button must not break the adjacent location pin hover rule.
  const location=monday.locator('[data-week-place="gym:'+original.key+'"]');
  await expect(location).toHaveCSS("opacity","1");
  page.once("dialog",dialog=>dialog.dismiss());
  await remove.click();
  await expect(monday.locator("[data-week-gym]")).toHaveCount(1);
  await monday.locator("[data-week-gym]").first().hover();
  page.once("dialog",dialog=>dialog.accept());
  await remove.click();
  await expect(monday.locator('[data-week-gym="'+original.key+'"]')).toHaveCount(0);
  const saved=await page.evaluate(k=>JSON.parse(localStorage.getItem(k)),KEY);
  expect(saved.deletedOccurrences).toContain(original.key);
  expect(JSON.stringify(saved.plans)).toBe(original.plan);
  await page.reload({waitUntil:"networkidle"});
  await page.locator(".df2-sidebar nav button").filter({hasText:"Týden"}).click();
  await expect(page.locator(".df2-week-day").nth(0).locator("[data-week-gym]")).toHaveCount(0);
  await page.locator(".df2-week-controls button").filter({hasText:"→"}).click();
  await expect(page.locator(".df2-week-day").nth(0).locator("[data-week-gym]")).toHaveCount(1);
});

test("Gym history deletes completed session including logged progress without erasing its plan",async({page})=>{
  await fresh(page);
  const root=await createPlan(page,"Deník k opravě");
  await root.locator("[data-gym-week]").getByLabel("Pondělí – čas tréninku").fill("17:00");
  await root.locator("[data-gym-workout-preview]").getByRole("button",{name:"Zahájit trénink"}).click();
  const set=root.locator("[data-gym-log-exercise]").first().locator("[data-gym-set]").first();
  await set.getByRole("spinbutton",{name:/Váha v kg série 1/}).fill("80");
  await set.getByRole("spinbutton",{name:/Opakování série 1/}).fill("8");
  await set.getByRole("button",{name:/Dokončit sérii 1/}).click();
  await root.getByRole("button",{name:"Dokončit trénink",exact:true}).click();
  await root.getByRole("button",{name:"← Zpět na plán"}).click();
  const history=root.locator("[data-gym-history]");
  await history.locator("summary").click();
  await expect(history.locator(".df2-gym-history-row")).toHaveCount(1);
  const before=await page.evaluate(k=>JSON.parse(localStorage.getItem(k)),KEY);
  expect(before.sessions).toHaveLength(1);
  const key=before.sessions[0].occurrenceKey;
  page.once("dialog",dialog=>dialog.accept());
  await history.getByRole("button",{name:/Smazat trénink .* ze dne/}).click();
  await expect(history).toHaveCount(0);
  const stored=await page.evaluate(k=>JSON.parse(localStorage.getItem(k)),KEY);
  expect(stored.sessions).toHaveLength(0);
  expect(stored.deletedOccurrences).toContain(key);
  expect(stored.plans).toEqual(before.plans);
  await root.getByRole("button",{name:"Progres"}).click();
  await expect(root.locator("[data-gym-progress]")).toContainText("Zatím bez výsledků");
  await page.reload({waitUntil:"networkidle"});
  const persisted=await page.evaluate(k=>JSON.parse(localStorage.getItem(k)),KEY);
  expect(persisted.sessions).toHaveLength(0);
  expect(persisted.deletedOccurrences).toContain(key);
});

test("past Gym workouts are read-only and future Gym cannot be dropped into an elapsed day",async({page})=>{
  await fresh(page);
  const root=await createPlan(page,"Bez přepisování historie");
  await root.locator("[data-gym-week]").getByLabel("Pondělí – čas tréninku").fill("17:00");
  await root.locator("[data-gym-week]").getByLabel("Čtvrtek – čas tréninku").fill("18:00");
  await page.clock.setFixedTime(new Date("2026-10-14T12:00:00"));
  await page.reload({waitUntil:"networkidle"});
  await page.locator(".df2-sidebar nav button").filter({hasText:"Týden"}).click();
  const monday=page.locator(".df2-week-day").nth(0);
  const thursday=page.locator(".df2-week-day").nth(3);
  await expect(monday.locator("[data-week-gym]")).toHaveAttribute("draggable","false");
  await expect(thursday.locator("[data-week-gym]")).toHaveAttribute("draggable","true");
  const original=await page.evaluate(()=>JSON.stringify(JSON.parse(localStorage.getItem("dayframe-gym-v1")).moves));
  await page.evaluate(()=>{
    const source=document.querySelectorAll(".df2-week-day")[3]?.querySelector("[data-week-gym]");
    if(!(source instanceof HTMLElement))throw Error("Future workout missing");
    const rect=source.getBoundingClientRect(),transfer=new DataTransfer();
    window.__pastGymTransfer=transfer;
    source.dispatchEvent(new DragEvent("dragstart",{bubbles:true,cancelable:true,dataTransfer:transfer,clientX:rect.left+15,clientY:rect.top+8}));
  });
  await page.evaluate(()=>{
    const target=document.querySelectorAll(".df2-week-day")[0]?.querySelector(".df2-time-body");
    if(!(target instanceof HTMLElement))throw Error("Past column missing");
    const rect=target.getBoundingClientRect();
    const options={bubbles:true,cancelable:true,dataTransfer:window.__pastGymTransfer,
      clientX:rect.left+25,clientY:rect.top+(18*60-8*60)*0.72+8};
    target.dispatchEvent(new DragEvent("dragover",options));
    target.dispatchEvent(new DragEvent("drop",options));
  });
  await expect(monday.locator("[data-week-gym]")).toHaveCount(1);
  await expect(thursday.locator("[data-week-gym]")).toHaveCount(1);
  const after=await page.evaluate(()=>JSON.stringify(JSON.parse(localStorage.getItem("dayframe-gym-v1")).moves));
  expect(after).toBe(original);
});

test("forearm and grip exercises are searchable from Pull, can be saved into a plan, and survive reload",async({page})=>{
  await fresh(page);
  const root=await gym(page);
  await root.getByRole("button",{name:"Použít split Push / Pull / Lower →"}).click();
  await root.getByRole("button",{name:"Plány",exact:true}).click();
  const pull=root.locator(".df2-gym-day-edit").nth(1);
  await pull.getByRole("button",{name:"Přidat cvik do Pull"}).click();
  const picker=pull.getByRole("region",{name:"Výběr cviku – Přidat cvik do Pull"});
  await expect(picker.getByRole("button",{name:"Pull",exact:true})).toHaveAttribute("aria-pressed","true");
  await expect(picker.locator('[data-gym-picker-exercise="wrist-curl-dumbbell"]')).toBeVisible();
  await picker.getByRole("searchbox",{name:"Hledat cvik"}).fill("farmarska chuze");
  await expect(picker.locator('[data-gym-picker-exercise="farmer-carry"]')).toBeVisible();
  await picker.getByRole("searchbox",{name:"Hledat cvik"}).fill("reverse wrist curl");
  await picker.locator('[data-gym-picker-exercise="reverse-wrist-curl-dumbbell"]').click();

  const saved=await page.evaluate(k=>JSON.parse(localStorage.getItem(k)),KEY);
  const added=saved.plans[0].days[1].exercises;
  expect(added.some(ex=>ex.exerciseId==="reverse-wrist-curl-dumbbell")).toBe(true);
  expect(saved.exercises).toHaveLength(83);
  await page.reload({waitUntil:"networkidle"});
  const restored=await gym(page);
  await restored.getByRole("button",{name:"Plány",exact:true}).click();
  const stored=await page.evaluate(k=>JSON.parse(localStorage.getItem(k)),KEY);
  expect(stored.plans[0].days[1].exercises.filter(ex=>ex.exerciseId==="reverse-wrist-curl-dumbbell")).toHaveLength(1);
});

test("Week adds two independently dated Gym blocks without changing recurring plan or Gym journal",async({page})=>{
  await fresh(page);
  await createPlan(page,"Budoucí tréninky");
  const base=await page.evaluate(()=>JSON.parse(localStorage.getItem(KEY)));
  const originalDays=JSON.stringify(base.plans[0].days);
  await page.getByRole("button",{name:"Týden",exact:true}).click();
  await page.getByRole("button",{name:"+ Trénink",exact:true}).click();
  const form=page.getByRole("dialog",{name:"Naplánovat trénink"});
  await expect(form.getByRole("combobox",{name:"Typ bloku"})).toHaveValue("gym");
  await expect(form.getByRole("combobox",{name:"Vyber trénink"})).toBeVisible();
  await form.locator('input[type="date"]').first().fill("2026-11-04");
  await form.getByRole("combobox",{name:"Vyber trénink"}).selectOption({label:"Upper"});
  await form.locator('input[type="time"]').first().fill("17:00");
  await form.getByLabel("Délka").selectOption("90");
  await form.getByRole("button",{name:"Naplánovat"}).click();
  await expect(form).toHaveCount(0);
  await page.getByRole("button",{name:"+ Trénink",exact:true}).click();
  await form.locator('input[type="date"]').first().fill("2026-11-04");
  await form.getByRole("combobox",{name:"Vyber trénink"}).selectOption({label:"Lower"});
  await form.locator('input[type="time"]').first().fill("19:00");
  await form.getByLabel("Délka").selectOption("75");
  await form.getByRole("button",{name:"Naplánovat"}).click();
  let data=await page.evaluate(()=>JSON.parse(localStorage.getItem(KEY)));
  expect(data.oneOffWorkouts).toHaveLength(2);
  expect(data.oneOffWorkouts.map(x=>x.date)).toEqual(["2026-11-04","2026-11-04"]);
  expect(data.oneOffWorkouts.map(x=>x.duration)).toEqual([90,75]);
  expect(JSON.stringify(data.plans[0].days)).toBe(originalDays);
  await page.reload({waitUntil:"networkidle"});
  await page.getByRole("button",{name:"Týden",exact:true}).click();
  const arrows=page.locator(".df2-week-controls button");
  for(let i=0;i<3;i++)await arrows.nth(2).click();
  const blocks=page.locator("[data-week-gym^='manual-']");
  await expect(blocks).toHaveCount(2);
  await expect(blocks.filter({hasText:"Upper"})).toContainText("17:00–18:30");
  await expect(blocks.filter({hasText:"Lower"})).toContainText("19:00–20:15");
  // Clicking a dated Gym block must load the real exercise template/session.
  await blocks.filter({hasText:"Upper"}).click();
  const gymRoot=page.locator("[data-gym-root]");
  await expect(gymRoot).toContainText("Upper");
  await expect(gymRoot.locator("[data-gym-workout-preview]")).toBeVisible();
  await gymRoot.locator("[data-gym-workout-preview]").getByRole("button",{name:"Zahájit trénink"}).click();
  await expect(gymRoot.getByRole("region",{name:"Tréninkový deník"})).toBeVisible();
  data=await page.evaluate(()=>JSON.parse(localStorage.getItem(KEY)));
  expect(data.sessions).toHaveLength(1);
  expect(data.sessions[0].occurrenceKey).toBe(data.oneOffWorkouts[0].id);
  expect(data.sessions[0].date).toBe("2026-11-04");
  expect(data.sessions[0].exercises.length).toBeGreaterThan(0);
  await page.getByRole("button",{name:"Týden",exact:true}).click();
  await expect(page.locator("[data-week-gym^='manual-']")).toHaveCount(2);
  // A one-off deletion removes only this booking; no recurrence template is touched.
  await page.locator("[data-week-gym^='manual-']").filter({hasText:"Lower"})
    .locator("..").getByRole("button",{name:/Smazat trénink Lower/}).click();
  await expect(page.locator("[data-week-gym^='manual-']")).toHaveCount(1);
  data=await page.evaluate(()=>JSON.parse(localStorage.getItem(KEY)));
  expect(data.oneOffWorkouts).toHaveLength(1);
  expect(JSON.stringify(data.plans[0].days)).toBe(originalDays);
});

test("Week Gym form does not create conflicting workouts or block legacy task creation",async({page})=>{
  await fresh(page);
  await createPlan(page,"Bez kolizí");
  await page.getByRole("button",{name:"Týden",exact:true}).click();
  await page.getByRole("button",{name:"+ Trénink",exact:true}).click();
  const form=page.getByRole("dialog",{name:"Naplánovat trénink"});
  await form.locator('input[type="date"]').first().fill("2026-11-04");
  await form.locator('input[type="time"]').first().fill("17:00");
  await form.getByRole("button",{name:"Naplánovat"}).click();
  await page.getByRole("button",{name:"+ Trénink",exact:true}).click();
  await form.locator('input[type="date"]').first().fill("2026-11-04");
  await form.locator('input[type="time"]').first().fill("17:30");
  await form.getByRole("button",{name:"Naplánovat"}).click();
  await expect(form.getByText("Tento čas se překrývá s jiným blokem nebo cestou.")).toBeVisible();
  let store=await page.evaluate(()=>JSON.parse(localStorage.getItem(KEY)));
  expect(store.oneOffWorkouts).toHaveLength(1);
  await form.getByRole("combobox",{name:"Typ bloku"}).selectOption("task");
  await expect(page.getByRole("dialog",{name:"Přidat úkol"})).toBeVisible();
  await page.getByRole("dialog",{name:"Přidat úkol"}).getByPlaceholder("Např. zeměpis 20 min").fill("Přečíst článek");
  await page.getByRole("dialog",{name:"Přidat úkol"}).getByRole("button",{name:"Naplánovat"}).click();
  await expect(page.getByRole("dialog",{name:"Přidat úkol"})).toHaveCount(0);
});
