import {test,expect} from "@playwright/test";
const base=process.env.DAYFRAME_BASE_URL||"http://127.0.0.1:4173";
test.beforeEach(async({page})=>{
  await page.clock.setFixedTime(new Date("2026-10-18T08:00:00"));
  await page.route("https://unpkg.com/leaflet@**",route=>route.abort());
  await page.goto(base,{waitUntil:"networkidle"});
  // Clear once for isolation, but do not wipe persisted travel data on a test reload.
  await page.evaluate(()=>localStorage.clear());
  await page.reload({waitUntil:"networkidle"});
});
async function makeTask(page,title="Pracovní schůzka"){
  await page.getByRole("button",{name:"+ Nový úkol"}).click();
  const dialog=page.getByRole("dialog",{name:"Přidat úkol"});
  await dialog.getByPlaceholder("Např. zeměpis 20 min").fill(title);
  await dialog.getByLabel("Začít v").fill("10:00");
  await dialog.getByRole("button",{name:"Naplánovat"}).click();
  await expect(dialog).toHaveCount(0);
  await page.locator(".df2-sidebar nav button").filter({hasText:"Týden"}).click();
  await expect(page.locator(".df2-week-grid")).toBeVisible();
}
async function setMapPoint(dialog,lat,lon,label){
  await dialog.getByRole("spinbutton",{name:"Zeměpisná šířka"}).fill(String(lat));
  await dialog.getByRole("spinbutton",{name:"Zeměpisná délka"}).fill(String(lon));
  await dialog.getByRole("textbox",{name:"Popis vybraného místa"}).fill(label);
}
test("offsite creation opens the map with the selected choice already checked",async({page})=>{
  await page.getByRole("button",{name:"+ Nový úkol"}).click();
  const creation=page.getByRole("dialog",{name:"Přidat úkol"});
  await creation.getByPlaceholder("Např. zeměpis 20 min").fill("Výuka mimo domov");
  await creation.getByLabel("Začít v").fill("10:00");
  await creation.getByRole("checkbox",{name:/Odehrává se mimo domov/}).check();
  await creation.getByRole("button",{name:"Naplánovat"}).click();
  const picker=page.getByRole("dialog",{name:"Místo konání: Výuka mimo domov"});
  await expect(picker).toBeVisible();
  await expect(picker.getByRole("checkbox",{name:/Blok se odehrává mimo domov/})).toBeChecked();
  await picker.getByRole("button",{name:"Uložit místo"}).click();
  await expect(picker.getByRole("alert")).toContainText("Nejprve vyber místo konání");
  await setMapPoint(picker,50.09,14.41,"Místo schůzky");
  await picker.getByRole("button",{name:"Uložit místo"}).click();
  await expect(picker).toHaveCount(0);
  const stored=await page.evaluate(()=>JSON.parse(localStorage.getItem("dayframe-travel-v1")));
  expect(Object.values(stored.blocks)).toHaveLength(1);
  expect(Object.values(stored.blocks)[0].place.label).toBe("Místo schůzky");
});
test("every scheduled week task offers an exact offsite map destination and persists coordinates",async({page})=>{
  await makeTask(page);
  await page.getByRole("button",{name:"Místo konání: Pracovní schůzka"}).click();
  const dialog=page.getByRole("dialog",{name:"Místo konání: Pracovní schůzka"});
  await expect(dialog).toBeVisible();
  await dialog.getByRole("checkbox",{name:/Blok se odehrává mimo domov/}).check();
  await setMapPoint(dialog,50.08,14.43,"Praha – fakultní budova");
  await dialog.getByRole("button",{name:"Odkud vyrážím"}).click();
  await setMapPoint(dialog,50.4,14.7,"Výchozí místo pro test");
  await dialog.getByRole("spinbutton",{name:"Obvyklá doba cesty"}).fill("40");
  await dialog.getByRole("spinbutton",{name:"Časová rezerva"}).fill("15");
  await dialog.getByRole("button",{name:"Uložit místo"}).click();
  await expect(dialog).toHaveCount(0);
  const value=await page.evaluate(()=>JSON.parse(localStorage.getItem("dayframe-travel-v1")));
  expect(value.version).toBe(1);
  expect(value.origin.lat).toBe(50.4);
  const block=Object.values(value.blocks)[0];
  expect(block.place).toEqual({lat:50.08,lon:14.43,label:"Praha – fakultní budova"});
  expect(block.typicalMinutes).toBe(40);
  expect(block.bufferMinutes).toBe(15);
  await expect(page.getByRole("button",{name:"Místo konání: Pracovní schůzka"})).toHaveClass(/has-location/);
  await page.reload({waitUntil:"networkidle"});
  await page.locator(".df2-sidebar nav button").filter({hasText:"Týden"}).click();
  await expect(page.getByRole("button",{name:"Místo konání: Pracovní schůzka"})).toHaveClass(/has-location/);
  await page.locator(".df2-sidebar nav button").filter({hasText:"Dnes"}).click();
  await page.locator("[data-today-briefing-launcher]").click();
  const jarvis=page.locator("[data-today-briefing]");
  await expect(jarvis.locator("[data-jarvis-travel]")).toContainText("Pracovní schůzka");
  await expect(jarvis.locator("[data-jarvis-travel]")).toContainText("Doporučený odjezd: 09:05");
  await expect(jarvis.locator("[data-jarvis-travel]")).toContainText("bez dat o aktuální dopravě");
  const link=jarvis.locator("[data-jarvis-route-link]");
  await expect(link).toHaveAttribute("href",/google\.com\/maps\/dir/);
  expect((await link.getAttribute("href"))).toContain("destination=50.08%2C14.43");
  expect((await link.getAttribute("href"))).toContain("origin=50.4%2C14.7");
});
test("destination can be removed without deleting or changing the week block",async({page})=>{
  await makeTask(page,"Seminář");
  await page.getByRole("button",{name:"Místo konání: Seminář"}).click();
  const dialog=page.getByRole("dialog",{name:"Místo konání: Seminář"});
  await dialog.getByRole("checkbox",{name:/Blok se odehrává mimo domov/}).check();
  await setMapPoint(dialog,50.1,14.5,"Budova");
  await dialog.getByRole("button",{name:"Uložit místo"}).click();
  await page.getByRole("button",{name:"Místo konání: Seminář"}).click();
  const edit=page.getByRole("dialog",{name:"Místo konání: Seminář"});
  await edit.getByRole("checkbox",{name:/Blok se odehrává mimo domov/}).uncheck();
  await edit.getByRole("button",{name:"Uložit místo"}).click();
  const stored=await page.evaluate(()=>JSON.parse(localStorage.getItem("dayframe-travel-v1")));
  expect(Object.keys(stored.blocks)).toHaveLength(0);
  await expect(page.locator(".df2-week-task").filter({hasText:"Seminář"})).toBeVisible();
});
test("gym and hygiene week blocks have individual place controls",async({page})=>{
  await page.locator(".df2-sidebar nav button").filter({hasText:"Týden"}).click();
  const gym=page.locator("[data-week-gym]");
  const care=page.locator("[data-week-care]");
  if(await gym.count())await expect(page.locator('[data-week-place^="gym:"]').first()).toBeVisible();
  if(await care.count())await expect(page.locator('[data-week-place^="care:"]').first()).toBeVisible();
  await expect(page.locator(".df2-week-grid")).toBeVisible();
});
