import {test,expect} from "@playwright/test";
const base=process.env.DAYFRAME_BASE_URL||"http://127.0.0.1:4173";
test.beforeEach(async({page})=>{
  await page.clock.setFixedTime(new Date("2026-10-18T08:00:00"));
  await page.route("https://unpkg.com/leaflet@**",route=>route.abort());
  await page.route("**/api/parking?**",route=>route.fulfill({
    status:200,contentType:"application/json",body:JSON.stringify({items:[],source:"OpenStreetMap"})
  }));
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
async function openTaskPlace(page,title){
  await page.locator(".df2-week-task").filter({hasText:title}).hover();
  await page.getByRole("button",{name:"Místo konání: "+title}).click();
}
async function setMapPoint(dialog,lat,lon,label){
  if(await dialog.getByRole("button",{name:"Upravit souřadnice"}).count())
    await dialog.getByRole("button",{name:"Upravit souřadnice"}).click();
  await dialog.getByRole("spinbutton",{name:"Zeměpisná šířka"}).fill(String(lat));
  await dialog.getByRole("spinbutton",{name:"Zeměpisná délka"}).fill(String(lon));
  await dialog.getByRole("textbox",{name:"Popis vybraného místa"}).fill(label);
}
test("week location icon appears only on hover and stays reachable by keyboard",async({page})=>{
  const title="Úkol s nenápadnou ikonou";
  await makeTask(page,title);
  const card=page.locator(".df2-week-task").filter({hasText:title});
  const pin=page.getByRole("button",{name:"Místo konání: "+title});
  await page.locator(".df2-week-day-head").first().hover();
  await expect(pin).toHaveCSS("opacity","0");
  await card.hover();
  await expect(pin).toHaveCSS("opacity","1");
  await page.locator(".df2-week-day-head").first().hover();
  await expect(pin).toHaveCSS("opacity","0");
  await pin.focus();
  await expect(pin).toHaveCSS("opacity","1");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog",{name:"Místo konání: "+title})).toBeVisible();
});
test("touch-capable devices can tap location pins without mouse hover",async({browser})=>{
  const context=await browser.newContext({hasTouch:true,viewport:{width:1280,height:800}});
  const page=await context.newPage();
  try {
    await page.clock.setFixedTime(new Date("2026-10-18T08:00:00"));
    await page.route("https://unpkg.com/leaflet@**",route=>route.abort());
    await page.goto(base,{waitUntil:"networkidle"});
    await page.evaluate(()=>localStorage.clear());
    await page.reload({waitUntil:"networkidle"});
    const title="Místo na dotykové obrazovce";
    await makeTask(page,title);
    const pin=page.getByRole("button",{name:"Místo konání: "+title});
    await expect(pin).toHaveCSS("opacity","1");
    await expect(pin).toHaveCSS("pointer-events","auto");
    await pin.tap();
    await expect(page.getByRole("dialog",{name:"Místo konání: "+title})).toBeVisible();
  } finally {
    await context.close();
  }
});
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
test("long task titles do not prevent storing exact destinations",async({page})=>{
  const name="Dlouhý úkol "+"T".repeat(320);
  await makeTask(page,name);
  await openTaskPlace(page,name);
  const picker=page.getByRole("dialog",{name:"Místo konání: "+name});
  await picker.getByRole("checkbox",{name:/Blok se odehrává mimo domov/}).check();
  await setMapPoint(picker,50.084,14.421,"Testovací místo");
  await picker.getByRole("button",{name:"Uložit místo"}).click();
  await expect(picker).toHaveCount(0);
  const store=await page.evaluate(()=>JSON.parse(localStorage.getItem("dayframe-travel-v1")));
  expect(Object.values(store.blocks)[0].title.length).toBe(300);
  expect(Object.values(store.blocks)[0].place.label).toBe("Testovací místo");
  await expect(page.locator(".df2-week-task").filter({hasText:name})).toBeVisible();
});
test("long geocoder place labels are constrained before saving exact coordinates",async({page})=>{
  await makeTask(page,"Dlouhá adresa");
  await page.route("https://nominatim.openstreetmap.org/search?**",route=>route.fulfill({
    status:200,contentType:"application/json",
    body:JSON.stringify([{lat:"50.075",lon:"14.425",display_name:"D".repeat(410)}]),
  }));
  await openTaskPlace(page,"Dlouhá adresa");
  const modal=page.getByRole("dialog",{name:"Místo konání: Dlouhá adresa"});
  await modal.getByRole("checkbox",{name:/Blok se odehrává mimo domov/}).check();
  await modal.getByRole("textbox",{name:"Vyhledat adresu nebo místo"}).fill("Praha centrum");
  await modal.getByRole("button",{name:"Hledat"}).click();
  await modal.locator(".df2-travel-search-results button").first().click();
  const label=modal.getByRole("textbox",{name:"Popis vybraného místa"});
  await expect(label).toHaveAttribute("maxlength","300");
  expect((await label.inputValue()).length).toBe(300);
  await modal.getByRole("button",{name:"Uložit místo"}).click();
  const data=await page.evaluate(()=>JSON.parse(localStorage.getItem("dayframe-travel-v1")));
  const saved=Object.values(data.blocks)[0];
  expect(saved.place.label).toHaveLength(300);
  expect(saved.place.lat).toBe(50.075);
  expect(saved.place.lon).toBe(14.425);
});
test("every scheduled week task offers an exact offsite map destination and persists coordinates",async({page})=>{
  await makeTask(page);
  await openTaskPlace(page,"Pracovní schůzka");
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
test("car metro and walking journey persists and Jarvis links every stage",async({page})=>{
  const title="Pohovor s kombinovanou dopravou";
  await makeTask(page,title);
  await openTaskPlace(page,title);
  const dialog=page.getByRole("dialog",{name:"Místo konání: "+title});
  await dialog.getByRole("checkbox",{name:/Blok se odehrává mimo domov/}).check();
  await setMapPoint(dialog,50.08,14.43,"Místo pohovoru");
  await dialog.getByRole("button",{name:"Odkud vyrážím"}).click();
  await setMapPoint(dialog,50.10,14.20,"Výchozí místo");
  await dialog.getByRole("button",{name:"Kombinovaná cesta"}).click();
  await dialog.getByRole("button",{name:"Zastávka 1"}).click();
  await expect(dialog.getByRole("button",{name:"Zastávka 1"})).toHaveAttribute("aria-pressed","true");
  await expect(dialog.getByRole("button",{name:"Místo konání",exact:true})).toHaveAttribute("aria-pressed","false");
  await setMapPoint(dialog,50.11,14.22,"P+R parkoviště");
  await dialog.getByRole("spinbutton",{name:"Délka úseku 1"}).fill("25");
  await dialog.getByRole("button",{name:"+ Přidat úsek"}).click();
  await dialog.getByRole("combobox",{name:"Doprava úsek 2"}).selectOption("transit");
  await dialog.getByRole("spinbutton",{name:"Délka úseku 2"}).fill("15");
  await dialog.getByRole("button",{name:"Zastávka 2"}).click();
  await setMapPoint(dialog,50.12,14.25,"Stanice metra");
  await dialog.getByRole("spinbutton",{name:"Délka úseku 3"}).fill("10");
  await expect(dialog).toContainText("Celková cesta: 50 min");
  await dialog.getByRole("button",{name:"Uložit místo"}).click();
  await expect(dialog).toHaveCount(0);
  const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem("dayframe-travel-v1")));
  const journey=Object.values(saved.blocks)[0];
  expect(journey.legs.map(x=>[x.mode,x.minutes])).toEqual([["driving",25],["transit",15],["walking",10]]);
  expect(journey.legs[0].via.label).toBe("P+R parkoviště");
  expect(journey.legs[1].via.label).toBe("Stanice metra");
  expect(journey.typicalMinutes).toBe(50);
  await page.reload({waitUntil:"networkidle"});
  await page.locator(".df2-sidebar nav button").filter({hasText:"Týden"}).click();
  await openTaskPlace(page,title);
  const reopened=page.getByRole("dialog",{name:"Místo konání: "+title});
  await expect(reopened.getByRole("button",{name:"Kombinovaná cesta"})).toHaveAttribute("aria-pressed","true");
  await expect(reopened.getByRole("combobox",{name:"Doprava úsek 2"})).toHaveValue("transit");
  await reopened.getByRole("button",{name:"Zrušit"}).click();
  await page.locator(".df2-sidebar nav button").filter({hasText:"Dnes"}).click();
  await page.locator("[data-today-briefing-launcher]").click();
  const card=page.locator("[data-jarvis-travel]");
  await expect(card).toContainText("Doporučený odjezd: 08:55");
  await expect(card).toContainText("MHD / vlak");
  await expect(card).toContainText("P+R parkoviště");
  await expect(card).toContainText("Stanice metra");
  await expect(card).toContainText("bez dat o aktuální dopravě");
  const links=card.locator("[data-jarvis-route-link]");
  await expect(links).toHaveCount(3);
  expect(await links.nth(1).getAttribute("href")).toContain("travelmode=transit");
  expect(await links.nth(1).getAttribute("href")).toContain("origin=50.11%2C14.22");
  expect(await links.nth(2).getAttribute("href")).toContain("destination=50.08%2C14.43");
});
test("incomplete combined route cannot be saved or overwrite an existing location",async({page})=>{
  const title="Seminář s přestupem";
  await makeTask(page,title);
  await openTaskPlace(page,title);
  const dialog=page.getByRole("dialog",{name:"Místo konání: "+title});
  await dialog.getByRole("checkbox",{name:/Blok se odehrává mimo domov/}).check();
  await setMapPoint(dialog,50.08,14.43,"Seminář");
  await dialog.getByRole("button",{name:"Kombinovaná cesta"}).click();
  await dialog.getByRole("button",{name:/Vybrat parkoviště/}).click();
  await expect(dialog.locator(".df2-travel-map-picker")).toBeVisible();

  await dialog.getByRole("spinbutton",{name:"Délka úseku 1"}).fill("20");
  await dialog.getByRole("spinbutton",{name:"Délka úseku 2"}).fill("15");
  await dialog.getByRole("button",{name:"Uložit místo"}).click();
  await expect(dialog.getByRole("alert")).toContainText("mezizastávek");
  await expect(dialog).toBeVisible();
  expect(await page.evaluate(()=>localStorage.getItem("dayframe-travel-v1"))).toBeNull();
});
test("removing an existing location ignores incomplete mixed-mode draft",async({page})=>{
  const title="Schůzka ke zrušení";
  await makeTask(page,title);
  await openTaskPlace(page,title);
  const first=page.getByRole("dialog",{name:"Místo konání: "+title});
  await first.getByRole("checkbox",{name:/Blok se odehrává mimo domov/}).check();
  await setMapPoint(first,50.08,14.43,"Původní místo");
  await first.getByRole("button",{name:"Uložit místo"}).click();
  await openTaskPlace(page,title);
  const edit=page.getByRole("dialog",{name:"Místo konání: "+title});
  await edit.getByRole("button",{name:"Kombinovaná cesta"}).click();
  await edit.getByRole("checkbox",{name:/Blok se odehrává mimo domov/}).uncheck();
  await edit.getByRole("button",{name:"Uložit místo"}).click();
  await expect(edit).toHaveCount(0);
  const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem("dayframe-travel-v1")));
  expect(Object.keys(saved.blocks)).toHaveLength(0);
});

test("access code remains editable past twenty characters and can be collapsed explicitly",async({page})=>{
  let posts=0;
  await page.route("**/api/google-travel",route=>{
    if(route.request().method()==="POST"){posts++;return route.abort();}
    return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({available:true})});
  });
  await makeTask(page,"Test kódu");
  await openTaskPlace(page,"Test kódu");
  const dialog=page.getByRole("dialog",{name:"Místo konání: Test kódu"});
  await dialog.getByRole("checkbox",{name:/Blok se odehrává mimo domov/}).check();
  const access=dialog.getByLabel("Přístupový kód k výpočtu tras");
  await access.pressSequentially("x".repeat(28));
  await expect(access).toHaveValue("x".repeat(28));
  await dialog.getByRole("button",{name:"Hotovo s kódem"}).click();
  await expect(dialog.getByRole("button",{name:"Změnit kód"})).toBeVisible();
  await dialog.getByRole("button",{name:"Změnit kód"}).click();
  await expect(dialog.getByLabel("Přístupový kód k výpočtu tras")).toHaveValue("x".repeat(28));
  expect(posts).toBe(0);
});
test("travel editor defaults to a short journey summary and never auto-spends the Google budget",async({page})=>{
  let posts=0;
  await page.route("**/api/google-travel",route=>{
    if(route.request().method()==="POST"){posts++;const payload=route.request().postDataJSON();expect(payload.departureTime).toBeUndefined();return route.fulfill({status:200,contentType:"application/json",
      body:JSON.stringify({minutes:30,distanceMeters:12000,source:"Google Maps",trafficAware:true})});}
    return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({available:true})});
  });
  await makeTask(page,"Jednoduché cestování");
  await openTaskPlace(page,"Jednoduché cestování");
  const dialog=page.getByRole("dialog",{name:"Místo konání: Jednoduché cestování"});
  await dialog.getByRole("checkbox",{name:/Blok se odehrává mimo domov/}).check();
  await expect(dialog.getByRole("heading",{name:"Odkud a kam?"})).toBeVisible();
  await expect(dialog.getByRole("heading",{name:"Jak pojedeš?"})).toBeVisible();
  await expect(dialog.getByRole("heading",{name:"Kdy vyrazit?"})).toBeVisible();
  await setMapPoint(dialog,50.08,14.43,"Škola");
  await dialog.getByRole("button",{name:"Odkud vyrážím"}).click();
  await setMapPoint(dialog,50.1,14.2,"Domov");
  await dialog.getByRole("button",{name:"Hotovo",exact:true}).click();
  await dialog.getByLabel("Přístupový kód k výpočtu tras").fill("x".repeat(28));
  await expect.poll(()=>posts).toBe(0);
  await dialog.getByRole("button",{name:"Spočítat trasu"}).click();
  await expect(dialog.locator(".df2-google-route-results")).toContainText("30 min");
  expect(posts).toBe(1);
  await dialog.getByRole("button",{name:"Místo konání",exact:true}).click();
  await setMapPoint(dialog,50.09,14.44,"Jiné místo");
  await expect(dialog.locator(".df2-google-route-results")).toHaveCount(0);
  await expect.poll(()=>posts).toBe(1);
});
test("saved locations reopen without an expanded map and advanced travel settings stay optional",async({page})=>{
  await makeTask(page,"Přehledný pohovor");
  await openTaskPlace(page,"Přehledný pohovor");
  const dialog=page.getByRole("dialog",{name:"Místo konání: Přehledný pohovor"});
  await dialog.getByRole("checkbox",{name:/Blok se odehrává mimo domov/}).check();
  await setMapPoint(dialog,50.08,14.43,"Kancelář");
  await dialog.getByRole("button",{name:"Odkud vyrážím"}).click();
  await setMapPoint(dialog,50.1,14.2,"Domov");
  await expect(dialog).toContainText("Chybí délka přímé cesty");
  await dialog.getByRole("button",{name:"Uložit místo",exact:true}).click();
  await expect(dialog.getByRole("alert")).toContainText("Přímá cesta zatím nemá délku");
  // Saving the place without an ETA remains possible, but is now explicit.
  await dialog.getByRole("button",{name:"Uložit pouze místo (bez cesty)"}).click();
  await expect(page.getByRole("button",{name:"Místo konání: Přehledný pohovor"}))
    .toHaveClass(/needs-travel-duration/);
  await openTaskPlace(page,"Přehledný pohovor");
  const reopened=page.getByRole("dialog",{name:"Místo konání: Přehledný pohovor"});
  await expect(reopened.getByRole("heading",{name:"Odkud a kam?"})).toBeVisible();
  await expect(reopened.locator(".df2-travel-map-picker")).toHaveCount(0);
  await expect(reopened.getByRole("button",{name:"Odkud vyrážím"})).toBeVisible();
  await reopened.getByRole("button",{name:"Odkud vyrážím"}).click();
  await expect(reopened.locator(".df2-travel-map-picker")).toBeVisible();
});
for(const mode of ["driving","walking","cycling","transit"]){
  test("direct "+mode+" manual trip creates visible round-trip reservations in Week",async({page})=>{
    const title="Jednoduchá cesta "+mode;
    await makeTask(page,title);
    await openTaskPlace(page,title);
    const dialog=page.getByRole("dialog",{name:"Místo konání: "+title});
    await dialog.getByRole("checkbox",{name:/Blok se odehrává mimo domov/}).check();
    await setMapPoint(dialog,50.08,14.43,"Cíl "+mode);
    await dialog.getByRole("button",{name:"Odkud vyrážím"}).click();
    await setMapPoint(dialog,50.4,14.7,"Domov");
    await dialog.getByRole("combobox",{name:"Způsob dopravy"}).selectOption(mode);
    await expect(dialog).toContainText("Chybí délka přímé cesty");
    await dialog.getByRole("spinbutton",{name:"Obvyklá doba cesty"}).fill("24");
    await dialog.getByRole("checkbox",{name:"Přidat cestu domů po skončení bloku"}).check();
    await expect(dialog).toContainText("24+15 min");
    await dialog.getByRole("button",{name:"Uložit místo",exact:true}).click();
    const reservations=page.locator(".df2-week-day").last().locator("[data-week-travel]");
    await expect(reservations).toHaveCount(2);
    await expect(reservations.first()).toContainText("09:21–10:00");
    await expect(reservations.last()).toContainText("10:45–11:09");
    // Compact travel slots show only timing and direction; details stay accessible.
    for(const reservation of await reservations.all()){
      await expect(reservation.locator("small")).toHaveCount(0);
      await expect(reservation).not.toContainText(title);
      await expect(reservation).not.toContainText("odhad");
      await expect(reservation).toHaveAttribute("aria-label",new RegExp(title));
    }
    const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem("dayframe-travel-v1")));
    const trip=Object.values(saved.blocks)[0];
    expect(trip.mode).toBe(mode);
    expect(trip).toMatchObject({typicalMinutes:24,calendarMinutes:24,returnHome:true,returnMinutes:24});
    await page.reload({waitUntil:"networkidle"});
    await page.locator(".df2-sidebar nav button").filter({hasText:"Týden"}).click();
    await expect(page.locator(".df2-week-day").last().locator("[data-week-travel]")).toHaveCount(2);
  });
  test("direct "+mode+" Google calculation persists ETA without a separate planning input",async({page})=>{
    let paid=0;
    await page.route("**/api/google-travel",route=>{
      if(route.request().method()==="GET")
        return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({available:true})});
      paid++;
      expect(route.request().postDataJSON().mode).toBe(mode);
      return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({
        minutes:32,distanceMeters:10500,trafficAware:mode==="driving",
        options:[{minutes:32,distanceMeters:10500,steps:[],transfers:0,walkingMeters:0}]
      })});
    });
    const title="Google přímá cesta "+mode;
    await makeTask(page,title);
    await openTaskPlace(page,title);
    const dialog=page.getByRole("dialog",{name:"Místo konání: "+title});
    await dialog.getByRole("checkbox",{name:/Blok se odehrává mimo domov/}).check();
    await setMapPoint(dialog,50.08,14.43,"Škola");
    await dialog.getByRole("button",{name:"Odkud vyrážím"}).click();
    await setMapPoint(dialog,50.4,14.7,"Domov");
    await dialog.getByRole("combobox",{name:"Způsob dopravy"}).selectOption(mode);
    await dialog.getByLabel("Přístupový kód k výpočtu tras").fill("x".repeat(28));
    await dialog.getByRole("button",{name:"Spočítat trasu"}).click();
    await expect(dialog.locator(".df2-google-route-results")).toContainText("32 min");
    await expect(dialog).toContainText("32+15 min");
    await dialog.getByRole("checkbox",{name:"Přidat cestu domů po skončení bloku"}).check();
    await dialog.getByRole("button",{name:"Uložit místo",exact:true}).click();
    const trip=await page.evaluate(()=>Object.values(JSON.parse(localStorage.getItem("dayframe-travel-v1")).blocks)[0]);
    expect(trip).toMatchObject({mode,typicalMinutes:32,calendarMinutes:32,calendarVerified:true,
      returnHome:true,returnMinutes:32,returnVerified:false});
    await expect(page.locator(".df2-week-day").last().locator("[data-week-travel]")).toHaveCount(2);
    expect(paid).toBe(1,"saving must not requery the provider");
  });
}

test("explicit Google calculation supplies persisted Week travel slot without saving provider details",async({page})=>{
  await page.route("**/api/google-travel",async route=>{
    if(route.request().method()==="GET")return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({available:true})});
    const request=route.request();
    expect(request.headers().authorization).toBe("Bearer "+"x".repeat(28));
    const payload=request.postDataJSON();
    expect(payload.mode).toBe("driving");
    expect(Object.keys(payload.from).sort()).toEqual(["lat","lon"]);
    expect(Object.keys(payload.to).sort()).toEqual(["lat","lon"]);
    expect(JSON.stringify(payload)).not.toContain("Odkud jedu");
    expect(JSON.stringify(payload)).not.toContain("Cíl cesty");
    return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({
      minutes:58,distanceMeters:54000,source:"Google Maps",trafficAware:true,
    })});
  });
  await makeTask(page,"Výlet autem do města");
  await openTaskPlace(page,"Výlet autem do města");
  const dialog=page.getByRole("dialog",{name:"Místo konání: Výlet autem do města"});
  await dialog.getByRole("checkbox",{name:/Blok se odehrává mimo domov/}).check();
  await setMapPoint(dialog,50.08,14.43,"Cíl cesty");
  await dialog.getByRole("button",{name:"Odkud vyrážím"}).click();
  await setMapPoint(dialog,50.4,14.7,"Odkud jedu");
  await dialog.getByLabel("Přístupový kód k výpočtu tras").fill("x".repeat(28));
  await dialog.getByRole("button",{name:"Spočítat trasu"}).click();
  await expect(dialog).toContainText("50 požadavků denně");
  await expect(dialog).toContainText("1 000 měsíčně");
  await expect(dialog.locator(".df2-google-route-results")).toContainText("58 min");
  await expect(dialog.locator(".df2-google-route-results")).toContainText("54.0 km");
  await expect(dialog.locator(".df2-google-attribution img")).toHaveAttribute("src",/gstatic\.com\/images\/branding\/product/);
  await expect(dialog.getByRole("spinbutton",{name:"Obvyklá doba cesty"})).toHaveValue("");
  // A user-clicked Google route supplies the calendar duration, never the access secret.
  await expect(dialog.getByRole("button",{name:"Převzít časy jako můj plánovací odhad"})).toHaveCount(0);
  await dialog.getByRole("spinbutton",{name:"Obvyklá doba cesty"}).fill("65");
  await dialog.getByRole("button",{name:"Uložit místo"}).click();
  const stored=await page.evaluate(()=>JSON.parse(localStorage.getItem("dayframe-travel-v1")));
  expect(Object.values(stored.blocks)[0].typicalMinutes).toBe(58);
  expect(Object.values(stored.blocks)[0].calendarMinutes).toBe(58);
  expect(JSON.stringify(stored)).not.toContain("x".repeat(28));
  await expect(page.locator("[data-week-travel]")).toHaveCount(1);
  await expect(page.locator("[data-week-travel]")).toContainText("Cesta tam");
});
for(const mode of ["driving","walking","cycling","transit"]){
  test("only home by "+mode+" reserves no outbound time, survives reload and allows later round trip",async({page})=>{
    const title="Domů jen "+mode;
    await makeTask(page,title);await openTaskPlace(page,title);
    const editor=page.getByRole("dialog",{name:"Místo konání: "+title});
    await editor.getByRole("checkbox",{name:/Blok se odehrává mimo domov/}).check();
    await setMapPoint(editor,50.08,14.43,"Škola");
    await editor.getByRole("button",{name:"Odkud vyrážím"}).click();
    await setMapPoint(editor,50.4,14.7,"Domov");
    await editor.getByRole("combobox",{name:"Způsob dopravy"}).selectOption(mode);
    await editor.getByRole("checkbox",{name:"Pouze cesta domů (bez cesty tam)"}).check();
    await expect(editor.getByRole("checkbox",{name:"Přidat cestu domů po skončení bloku"})).toBeChecked();
    await expect(editor.getByRole("spinbutton",{name:"Obvyklá doba cesty"})).toHaveCount(0);
    await editor.getByRole("button",{name:"Uložit místo",exact:true}).click();
    await expect(editor.getByRole("alert")).toContainText("platnou dobu návratu");
    await editor.getByRole("spinbutton",{name:"Doba cesty domů"}).fill("32");
    await editor.getByRole("button",{name:"Uložit místo",exact:true}).click();
    const reservations=page.locator(".df2-week-day").last().locator("[data-week-travel]");
    await expect(reservations).toHaveCount(1);
    await expect(reservations).toContainText("Cesta domů");
    await expect(reservations).toContainText("10:45–11:17");
    await expect(reservations.locator("small")).toHaveCount(0);
    await expect(reservations).not.toContainText(title);
    await expect(reservations).not.toContainText("odhad");
    await expect(reservations).toHaveAttribute("aria-label",new RegExp(title));
    await expect(page.locator("[data-week-travel$='outbound']")).toHaveCount(0);
    const stored=await page.evaluate(()=>Object.values(JSON.parse(localStorage.getItem("dayframe-travel-v1")).blocks)[0]);
    expect(stored).toMatchObject({outboundEnabled:false,returnHome:true,returnMinutes:32,mode});
    expect(stored).not.toHaveProperty("typicalMinutes");
    expect(stored).not.toHaveProperty("calendarMinutes");
    await expect(page.getByRole("button",{name:"Místo konání: "+title})).not.toHaveClass(/needs-travel-duration/);
    await page.reload({waitUntil:"networkidle"});
    await page.locator(".df2-sidebar nav button").filter({hasText:"Týden"}).click();
    await expect(page.locator("[data-week-travel]")).toHaveCount(1);
    await openTaskPlace(page,title);
    const reopened=page.getByRole("dialog",{name:"Místo konání: "+title});
    await expect(reopened.getByRole("checkbox",{name:"Pouze cesta domů (bez cesty tam)"})).toBeChecked();
    await reopened.getByRole("checkbox",{name:"Pouze cesta domů (bez cesty tam)"}).uncheck();
    await reopened.getByRole("spinbutton",{name:"Obvyklá doba cesty"}).fill("22");
    await reopened.getByRole("button",{name:"Uložit místo",exact:true}).click();
    await expect(page.locator("[data-week-travel]")).toHaveCount(2);
  });
}
test("switching a saved round trip into only home requires a new return duration",async({page})=>{
  const title="Změna na jediný návrat";
  await makeTask(page,title);await openTaskPlace(page,title);
  const editor=page.getByRole("dialog",{name:"Místo konání: "+title});
  await editor.getByRole("checkbox",{name:/Blok se odehrává mimo domov/}).check();
  await setMapPoint(editor,50.08,14.43,"Knihovna");
  await editor.getByRole("button",{name:"Odkud vyrážím"}).click();
  await setMapPoint(editor,50.4,14.7,"Domov");
  await editor.getByRole("spinbutton",{name:"Obvyklá doba cesty"}).fill("35");
  await editor.getByRole("checkbox",{name:"Přidat cestu domů po skončení bloku"}).check();
  await editor.getByRole("button",{name:"Uložit místo",exact:true}).click();
  await expect(page.locator("[data-week-travel]")).toHaveCount(2);
  await openTaskPlace(page,title);
  const reopened=page.getByRole("dialog",{name:"Místo konání: "+title});
  await expect(reopened.getByRole("spinbutton",{name:"Doba cesty domů"})).toHaveValue("35");
  await reopened.getByRole("checkbox",{name:"Pouze cesta domů (bez cesty tam)"}).check();
  await expect(reopened.getByRole("spinbutton",{name:"Doba cesty domů"})).toHaveValue("");
  await reopened.getByRole("button",{name:"Uložit místo",exact:true}).click();
  await expect(reopened.getByRole("alert")).toContainText("platnou dobu návratu");
  await reopened.getByRole("spinbutton",{name:"Doba cesty domů"}).fill("42");
  await reopened.getByRole("button",{name:"Uložit místo",exact:true}).click();
  await expect(page.locator("[data-week-travel]")).toHaveCount(1);
  await expect(page.locator("[data-week-travel]")).toContainText("10:45–11:27");
});
test("only home Google calculation reverses the trip without calculating outbound",async({page})=>{
  const calls=[];
  await page.route("**/api/google-travel",route=>{
    if(route.request().method()==="GET")
      return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({available:true})});
    calls.push(route.request().postDataJSON());
    return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({
      minutes:29,distanceMeters:14000,trafficAware:true,
      options:[{minutes:29,distanceMeters:14000,steps:[],transfers:0,walkingMeters:0}]
    })});
  });
  const title="Pouze domů s Googlem";
  await makeTask(page,title);await openTaskPlace(page,title);
  const editor=page.getByRole("dialog",{name:"Místo konání: "+title});
  await editor.getByRole("checkbox",{name:/Blok se odehrává mimo domov/}).check();
  await setMapPoint(editor,50.08,14.43,"Škola");
  await editor.getByRole("button",{name:"Odkud vyrážím"}).click();
  await setMapPoint(editor,50.4,14.7,"Domov");
  await editor.getByLabel("Přístupový kód k výpočtu tras").fill("x".repeat(28));
  await editor.getByRole("checkbox",{name:"Pouze cesta domů (bez cesty tam)"}).check();
  await expect(editor.getByRole("button",{name:"Spočítat trasu",exact:true})).toHaveCount(0);
  await expect(editor.getByRole("button",{name:/Spočítat zpáteční trasu/})).toBeVisible();
  await editor.getByRole("button",{name:/Spočítat zpáteční trasu/}).click();
  await expect(editor.getByRole("spinbutton",{name:"Doba cesty domů"})).toHaveValue("29");
  expect(calls).toHaveLength(1);
  expect(calls[0].from).toEqual({lat:50.08,lon:14.43});
  expect(calls[0].to).toEqual({lat:50.4,lon:14.7});
  expect(calls[0].mode).toBe("driving");
  await editor.getByRole("button",{name:"Uložit místo",exact:true}).click();
  const saved=await page.evaluate(()=>Object.values(JSON.parse(localStorage.getItem("dayframe-travel-v1")).blocks)[0]);
  expect(saved).toMatchObject({outboundEnabled:false,returnHome:true,returnMinutes:29,returnVerified:true});
  expect(saved).not.toHaveProperty("calendarMinutes");
  await expect(page.locator("[data-week-travel]")).toHaveCount(1);
  await expect(page.locator("[data-week-travel]")).toContainText("10:45–11:14");
  expect(calls).toHaveLength(1,"saving return-only journey must not bill again");
});
test("mixed return-only itinerary needs no outward per-leg minutes and keeps interchange on reopen",async({page})=>{
  const title="Z knihovny přes metro domů";
  await makeTask(page,title);await openTaskPlace(page,title);
  const editor=page.getByRole("dialog",{name:"Místo konání: "+title});
  await editor.getByRole("checkbox",{name:/Blok se odehrává mimo domov/}).check();
  await setMapPoint(editor,50.08,14.43,"Knihovna");
  await editor.getByRole("button",{name:"Odkud vyrážím"}).click();
  await setMapPoint(editor,50.4,14.7,"Domov");
  await editor.getByRole("button",{name:"Kombinovaná cesta"}).click();
  await editor.getByRole("button",{name:"Zastávka 1"}).click();
  await setMapPoint(editor,50.11,14.58,"P+R");
  await editor.getByRole("combobox",{name:"Doprava úsek 2"}).selectOption("transit");
  await editor.getByRole("checkbox",{name:"Pouze cesta domů (bez cesty tam)"}).check();
  await editor.getByRole("spinbutton",{name:"Doba cesty domů"}).fill("44");
  await editor.getByRole("button",{name:"Uložit místo",exact:true}).click();
  const store=await page.evaluate(()=>Object.values(JSON.parse(localStorage.getItem("dayframe-travel-v1")).blocks)[0]);
  expect(store).toMatchObject({outboundEnabled:false,returnHome:true,returnMinutes:44});
  expect(store).not.toHaveProperty("legs");
  expect(store.pathLegs).toEqual([
    {mode:"driving",via:{lat:50.11,lon:14.58,label:"P+R"}},
    {mode:"transit"}
  ]);
  await expect(page.locator("[data-week-travel]")).toHaveCount(1);
  await expect(page.locator("[data-week-travel]")).toContainText("10:45–11:29");
  await page.reload({waitUntil:"networkidle"});
  await page.locator(".df2-sidebar nav button").filter({hasText:"Týden"}).click();
  await openTaskPlace(page,title);
  const reopened=page.getByRole("dialog",{name:"Místo konání: "+title});
  await expect(reopened.getByRole("button",{name:"Kombinovaná cesta"})).toHaveAttribute("aria-pressed","true");
  await expect(reopened.getByRole("button",{name:"Zastávka 1"})).toContainText("P+R");
  await expect(reopened.getByRole("spinbutton",{name:"Délka úseku 1"})).toHaveValue("");
  await expect(reopened.getByRole("spinbutton",{name:"Délka úseku 2"})).toHaveValue("");
});
test("Google return journey reverses the endpoints, saves separate duration and adds both Week blocks",async({page})=>{
  const calls=[];
  await page.route("**/api/google-travel",route=>{
    if(route.request().method()==="GET")return route.fulfill({status:200,
      contentType:"application/json",body:JSON.stringify({available:true})});
    const payload=route.request().postDataJSON();
    calls.push(payload);
    const reverse=payload.from.lat===50.08;
    return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({
      minutes:reverse?47:40,distanceMeters:11000,trafficAware:true,
      options:[{minutes:reverse?47:40,distanceMeters:11000,steps:[],transfers:0,walkingMeters:0}]
    })});
  });
  const title="Běžná angličtina cesta tam i domů";
  await makeTask(page,title);
  await openTaskPlace(page,title);
  const dialog=page.getByRole("dialog",{name:"Místo konání: "+title});
  await dialog.getByRole("checkbox",{name:/Blok se odehrává mimo domov/}).check();
  await setMapPoint(dialog,50.08,14.43,"Škola");
  await dialog.getByRole("button",{name:"Odkud vyrážím"}).click();
  await setMapPoint(dialog,50.4,14.7,"Domov");
  await dialog.getByRole("combobox",{name:"Způsob dopravy"}).selectOption("driving");
  await dialog.getByLabel("Přístupový kód k výpočtu tras").fill("x".repeat(28));
  await dialog.getByRole("button",{name:"Spočítat trasu"}).click();
  await expect(dialog.locator(".df2-google-route-results")).toContainText("40 min");
  const checked=dialog.getByRole("checkbox",{name:"Přidat cestu domů po skončení bloku"});
  await checked.check();
  expect(calls).toHaveLength(1,"no automatic reverse paid requests");
  await expect(dialog).toContainText("orientační odhad");
  await dialog.getByRole("button",{name:/Spočítat zpáteční trasu/}).click();
  await expect(dialog.getByRole("spinbutton",{name:"Doba cesty domů"})).toHaveValue("47");
  expect(calls).toHaveLength(2);
  expect(calls[1].from).toEqual(calls[0].to);
  expect(calls[1].to).toEqual(calls[0].from);
  await dialog.getByRole("button",{name:"Uložit místo"}).click();
  const store=await page.evaluate(()=>JSON.parse(localStorage.getItem("dayframe-travel-v1")));
  const entry=Object.values(store.blocks)[0];
  expect(entry).toMatchObject({calendarMinutes:40,typicalMinutes:40,returnHome:true,
    returnMinutes:47,returnVerified:true});
  const windows=page.locator(".df2-week-day").last().locator("[data-week-travel]");
  await expect(windows).toHaveCount(2);
  await expect(windows.first()).toContainText("Cesta tam");
  await expect(windows.last()).toContainText("Cesta domů");
  await expect(windows.first()).toContainText("09:05–10:00");
  await expect(windows.last()).toContainText("10:45–11:32");
  await page.reload({waitUntil:"networkidle"});
  await page.locator(".df2-sidebar nav button").filter({hasText:"Týden"}).click();
  await expect(page.locator(".df2-week-day").last().locator("[data-week-travel]")).toHaveCount(2);
  await windows.last().click();
  const edit=page.getByRole("dialog",{name:"Místo konání: "+title});
  await expect(edit.getByRole("checkbox",{name:"Přidat cestu domů po skončení bloku"})).toBeChecked();
  await edit.getByRole("checkbox",{name:"Přidat cestu domů po skončení bloku"}).uncheck();
  await edit.getByRole("button",{name:"Uložit místo"}).click();
  await expect(page.locator(".df2-week-day").last().locator("[data-week-travel]")).toHaveCount(1);
  expect(calls).toHaveLength(2,"no new route requests on save, reload or toggle");
});

test("manual round trip is marked as estimate and changing a task updates projected slots",async({page})=>{
  const title="Kurz se zpáteční cestou";
  await makeTask(page,title);await openTaskPlace(page,title);
  const dialog=page.getByRole("dialog",{name:"Místo konání: "+title});
  await dialog.getByRole("checkbox",{name:/Blok se odehrává mimo domov/}).check();
  await setMapPoint(dialog,50.08,14.43,"Knihovna");
  await dialog.getByRole("button",{name:"Odkud vyrážím"}).click();
  await setMapPoint(dialog,50.40,14.7,"Domov");
  await dialog.getByRole("spinbutton",{name:"Obvyklá doba cesty"}).fill("35");
  await dialog.getByRole("checkbox",{name:"Přidat cestu domů po skončení bloku"}).check();
  await dialog.getByRole("button",{name:"Uložit místo"}).click();
  const windows=page.locator(".df2-week-day").last().locator("[data-week-travel]");
  await expect(windows).toHaveCount(2);
  await expect(windows.last()).not.toContainText("odhad");
  await expect(windows.last()).toHaveClass(/is-estimate/);
  await expect(windows.last()).toHaveAttribute("title",/orientační odhad/);
  const stored=await page.evaluate(()=>JSON.parse(localStorage.getItem("dayframe-travel-v1")));
  expect(Object.values(stored.blocks)[0].returnVerified).toBe(false);
  await page.reload({waitUntil:"networkidle"});
  await page.locator(".df2-sidebar nav button").filter({hasText:"Týden"}).click();
  await expect(page.locator(".df2-week-day").last().locator("[data-week-travel]")).toHaveCount(2);
});

test("Google route server unavailable still permits manual travel time",async({page})=>{
  await page.route("**/api/google-travel",route=>route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({available:false})}));
  await makeTask(page,"Pohovor bez API");
  await openTaskPlace(page,"Pohovor bez API");
  const dialog=page.getByRole("dialog",{name:"Místo konání: Pohovor bez API"});
  await dialog.getByRole("checkbox",{name:/Blok se odehrává mimo domov/}).check();
  await setMapPoint(dialog,50.08,14.43,"Cíl");
  await expect(dialog).toContainText("Automatický výpočet není dostupný");
  await expect(dialog.getByLabel("Přístupový kód k výpočtu tras")).toBeVisible();
  await dialog.getByLabel("Přístupový kód k výpočtu tras").fill("x".repeat(28));
  await expect(dialog.locator(".df2-google-attribution img")).toHaveCount(0);
  await dialog.getByRole("spinbutton",{name:"Obvyklá doba cesty"}).fill("65");
  await dialog.getByRole("button",{name:"Uložit místo"}).click();
  const stored=await page.evaluate(()=>JSON.parse(localStorage.getItem("dayframe-travel-v1")));
  expect(Object.values(stored.blocks)[0].typicalMinutes).toBe(65);
});
test("Google Routes 404 retains access field and suppresses paid POST until retry succeeds",async({page})=>{
  let isOnline=false,postCount=0;
  await page.route("**/api/google-travel",async route=>{
    if(route.request().method()==="POST"){
      postCount++;
      if(!isOnline)throw Error("Never send a billable route while API readiness is unavailable");
      return route.fulfill({status:200,contentType:"application/json",
        body:JSON.stringify({minutes:37,distanceMeters:18000,source:"Google Maps",trafficAware:true})});
    }
    if(!isOnline)return route.fulfill({status:404,contentType:"text/html",body:"<html>Not Found</html>"});
    return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({available:true})});
  });
  await makeTask(page,"API diagnostika");
  await openTaskPlace(page,"API diagnostika");
  const dialog=page.getByRole("dialog",{name:"Místo konání: API diagnostika"});
  await dialog.getByRole("checkbox",{name:/Blok se odehrává mimo domov/}).check();
  await setMapPoint(dialog,50.08,14.43,"Cíl trasy");
  await dialog.getByRole("button",{name:"Odkud vyrážím"}).click();
  await setMapPoint(dialog,50.10,14.20,"Výchozí místo");
  await expect(dialog).toContainText("Google Maps teď neodpovídají");
  const access=dialog.getByLabel("Přístupový kód k výpočtu tras");
  await expect(access).toBeVisible();
  await access.fill("x".repeat(28));
  await expect.poll(()=>postCount).toBe(0);
  isOnline=true;
  await dialog.getByRole("button",{name:"Zkusit připojení znovu"}).click();
  await expect(dialog.getByRole("button",{name:"Spočítat trasu"})).toBeEnabled();
  await expect(access).toHaveValue("x".repeat(28));
  await dialog.getByRole("button",{name:"Spočítat trasu"}).click();
  await expect(dialog.locator(".df2-google-route-results")).toContainText("37 min");
  expect(postCount).toBe(1);
});
test("destination can be removed without deleting or changing the week block",async({page})=>{
  await makeTask(page,"Seminář");
  await openTaskPlace(page,"Seminář");
  const dialog=page.getByRole("dialog",{name:"Místo konání: Seminář"});
  await dialog.getByRole("checkbox",{name:/Blok se odehrává mimo domov/}).check();
  await setMapPoint(dialog,50.1,14.5,"Budova");
  await dialog.getByRole("button",{name:"Uložit místo"}).click();
  await openTaskPlace(page,"Seminář");
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


test("transit timeline shows train, metro and bus instead of dozens of walking turns",async({page})=>{
  let posts=0;
  await page.route("**/api/google-travel",route=>{
    if(route.request().method()==="GET")
      return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({available:true})});
    posts++;
    const walk=(n,meters)=>Array.from({length:n},()=>({
      kind:"walk",distanceMeters:meters,instructions:"Odbočte vlevo na další ulici"
    }));
    const transit=(vehicle,line,from,to)=>({kind:"transit",vehicle,line,
      headsign:"Centrum",from,to,departureLabel:"14:26",arrivalLabel:"14:37",stops:2});
    return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({
      minutes:58,distanceMeters:15000,source:"Google Maps",trafficAware:false,options:[{
        minutes:58,distanceMeters:15000,transfers:2,walkingMeters:600,steps:[
          ...walk(20,10),transit("OTHER","S22","Rajská zahrada","Praha hl. n."),
          ...walk(20,10),transit("SUBWAY","C","Hlavní nádraží","Muzeum"),
          transit("BUS","135","Muzeum","Zastávka"),
          ...walk(10,20),
        ],
      }]
    })});
  });
  await makeTask(page,"Čitelná trasa MHD");
  await openTaskPlace(page,"Čitelná trasa MHD");
  const dialog=page.getByRole("dialog",{name:"Místo konání: Čitelná trasa MHD"});
  await dialog.getByRole("checkbox",{name:/Blok se odehrává mimo domov/}).check();
  await setMapPoint(dialog,50.08,14.43,"Škola");
  await dialog.getByRole("button",{name:"Odkud vyrážím"}).click();
  await setMapPoint(dialog,50.10,14.42,"Doma");
  await dialog.getByRole("combobox",{name:"Způsob dopravy"}).selectOption("transit");
  await dialog.getByLabel("Přístupový kód k výpočtu tras").fill("x".repeat(28));
  await dialog.getByRole("button",{name:"Spočítat trasu"}).click();
  await expect(dialog.locator(".df2-google-route-results")).toContainText("Vlak S22");
  await dialog.locator(".df2-trip-details summary").click();
  const timeline=dialog.locator(".df2-route-timeline");
  await expect(timeline.locator("li")).toHaveCount(6);
  await expect(timeline).toContainText("Vlak");
  await expect(timeline).toContainText("S22");
  await expect(timeline).toContainText("Metro");
  await expect(timeline).toContainText("Autobus");
  await expect(timeline).toContainText("Rajská zahrada");
  await expect(timeline).toContainText("Praha hl. n.");
  await expect(timeline).toContainText("14:26");
  await expect(timeline).not.toContainText("Odbočte vlevo");
  await expect(timeline.locator(".df2-route-walk")).toHaveCount(3);
  expect(posts).toBe(1);
});

test("scheduled trips do not reuse stale successful legs after ten minutes",async({page})=>{
  let attempts=0;
  await page.route("**/api/google-travel",route=>{
    if(route.request().method()==="GET")
      return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({available:true})});
    attempts++;
    return route.fulfill({status:502,contentType:"application/json",body:JSON.stringify({
      error:"Služba Google Routes je dočasně nedostupná (503).",
      providerStatus:503,retryable:true,
    })});
  });
  await makeTask(page,"Plánovaná cesta na čtvrtek");
  await openTaskPlace(page,"Plánovaná cesta na čtvrtek");
  const dialog=page.getByRole("dialog",{name:"Místo konání: Plánovaná cesta na čtvrtek"});
  await dialog.getByRole("checkbox",{name:/Blok se odehrává mimo domov/}).check();
  await setMapPoint(dialog,50.08,14.43,"VŠE");
  await dialog.getByRole("button",{name:"Odkud vyrážím"}).click();
  await setMapPoint(dialog,50.12,14.52,"Černý Most");
  await dialog.getByRole("combobox",{name:"Čas odjezdu"}).selectOption("scheduled");
  await dialog.getByLabel("Datum a čas odjezdu").fill("2026-10-22T13:15");
  await dialog.getByLabel("Přístupový kód k výpočtu tras").fill("x".repeat(28));
  await dialog.getByRole("button",{name:"Spočítat trasu"}).click();
  await expect(dialog.getByRole("alert")).toContainText("503");
  await expect.poll(()=>attempts).toBe(1);
  await page.clock.setFixedTime(new Date("2026-10-18T08:11:00"));
  await dialog.getByRole("button",{name:/Zkusit jednodušší výpočet/}).click();
  await expect(dialog.getByRole("alert")).toContainText("už není aktuální");
  expect(attempts).toBe(1);
});

test("scheduled driving recovers from upstream 503 with an explicitly traffic-unaware estimate",async({page})=>{
  const requests=[];
  await page.route("**/api/google-travel",route=>{
    if(route.request().method()==="GET")return route.fulfill({status:200,
      contentType:"application/json",body:JSON.stringify({available:true})});
    const payload=route.request().postDataJSON();
    requests.push(payload);
    if(!payload.simpleRoute)return route.fulfill({status:502,contentType:"application/json",
      body:JSON.stringify({error:"Služba Google Routes je dočasně nedostupná (503).",
        providerStatus:503,retryable:true,providerCode:"UNAVAILABLE"})});
    return route.fulfill({status:200,contentType:"application/json",
      body:JSON.stringify({minutes:45,distanceMeters:35000,options:[{
        minutes:45,distanceMeters:35000,steps:[],transfers:0,walkingMeters:0}],
        trafficAware:false})});
  });
  const title="Náhradní čas cesty autem";
  await makeTask(page,title);
  await openTaskPlace(page,title);
  const dialog=page.getByRole("dialog",{name:"Místo konání: "+title});
  await dialog.getByRole("checkbox",{name:/Blok se odehrává mimo domov/}).check();
  await setMapPoint(dialog,50.08,14.43,"VŠE");
  await dialog.getByRole("button",{name:"Odkud vyrážím"}).click();
  await setMapPoint(dialog,50.12,14.52,"Start");
  await dialog.getByRole("combobox",{name:"Čas odjezdu"}).selectOption("scheduled");
  await dialog.getByLabel("Datum a čas odjezdu").fill("2026-10-22T13:15");
  await dialog.getByLabel("Přístupový kód k výpočtu tras").fill("x".repeat(28));
  await dialog.getByRole("button",{name:"Spočítat trasu"}).click();
  await expect(dialog.getByRole("alert")).toContainText("Kód služby Google: UNAVAILABLE");
  await dialog.getByRole("button",{name:/Zkusit jednodušší výpočet/}).click();
  await expect(dialog.locator(".df2-google-route-results")).toContainText("45 min");
  await expect(dialog.locator(".df2-google-route-results")).toContainText("bez aktuálních kolon");
  expect(requests).toHaveLength(2);
  expect(requests[0].simpleRoute).toBeUndefined();
  expect(requests[1].simpleRoute).toBe(true);
  expect(requests[1].departureTime).toBe(requests[0].departureTime);
});

test("provider 503 retries only the failed MHD leg with a simpler Google request",async({page})=>{
  const requests=[];
  await page.route("**/api/google-travel",async route=>{
    if(route.request().method()==="GET")
      return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({available:true})});
    const data=route.request().postDataJSON();
    requests.push(data);
    if(data.mode==="driving")return route.fulfill({status:200,contentType:"application/json",
      body:JSON.stringify({minutes:35,distanceMeters:25000,options:[{
        minutes:35,distanceMeters:25000,steps:[],transfers:0,walkingMeters:0}]})});
    if(!data.simpleRoute)return route.fulfill({status:502,contentType:"application/json",
      body:JSON.stringify({error:"Služba Google Routes je dočasně nedostupná (503).",
        providerStatus:503,retryable:true})});
    return route.fulfill({status:200,contentType:"application/json",
      body:JSON.stringify({minutes:20,distanceMeters:10000,options:[{
        minutes:20,distanceMeters:10000,steps:[{kind:"transit",vehicle:"SUBWAY",line:"B",
          from:"Černý Most",to:"Florenc"}],transfers:0,walkingMeters:0}]})});
  });
  const title="Odolná kombinovaná cesta";
  await makeTask(page,title);
  await openTaskPlace(page,title);
  const dialog=page.getByRole("dialog",{name:"Místo konání: "+title});
  await dialog.getByRole("checkbox",{name:/Blok se odehrává mimo domov/}).check();
  await setMapPoint(dialog,50.08,14.43,"Cíl");
  await dialog.getByRole("button",{name:"Odkud vyrážím"}).click();
  await setMapPoint(dialog,50.14,14.41,"Doma");
  await dialog.getByRole("button",{name:"Kombinovaná cesta"}).click();
  await dialog.getByRole("button",{name:"Zastávka 1"}).click();
  await setMapPoint(dialog,50.11,14.5,"Parkoviště");
  await dialog.getByRole("combobox",{name:"Doprava úsek 2"}).selectOption("transit");
  await dialog.getByLabel("Přístupový kód k výpočtu tras").fill("x".repeat(28));
  await dialog.getByRole("button",{name:"Spočítat trasu"}).click();
  await expect(dialog.getByRole("alert")).toContainText("Úsek 2 z 2");
  await expect(dialog.getByRole("alert")).toContainText("úsek 1 (35 min)");
  await expect.poll(()=>requests.length).toBe(2);
  await dialog.getByRole("button",{name:/Zkusit jednodušší výpočet/}).click();
  await expect(dialog.locator(".df2-google-route-results")).toContainText("60 min");
  await expect(dialog.locator(".df2-google-route-results")).toContainText("Metro B");
  expect(requests.map(request=>request.mode)).toEqual(["driving","transit","transit"]);
  expect(requests[2].simpleRoute).toBe(true);
  expect(requests[0].departureTime).toBeUndefined();
  const mockedNow=await page.evaluate(()=>Date.now());
  expect(Date.parse(requests[2].departureTime)).toBeGreaterThan(mockedNow+38*60000);
  expect(Date.parse(requests[2].departureTime)).toBeLessThan(mockedNow+42*60000);
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await expect.poll(()=>requests.length).toBe(3);
});

test("Černý Most metro B can be compared with awkward bus-train-tram in exactly one extra call",async({page})=>{
  const calls=[];
  await page.route("**/api/google-travel",route=>{
    if(route.request().method()==="GET")
      return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({available:true})});
    const payload=route.request().postDataJSON();
    calls.push(payload);
    if(payload.mode==="driving")
      return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({
        minutes:40,distanceMeters:53200,trafficAware:true,
        options:[{minutes:40,distanceMeters:53200,steps:[],transfers:0,walkingMeters:0}]
      })});
    const metro=payload.transitTravelModes==="metro";
    return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({
      minutes:metro?51:48,distanceMeters:metro?14100:14500,trafficAware:false,
      options:[metro?{minutes:51,distanceMeters:14100,transfers:1,walkingMeters:480,
        steps:[{kind:"walk",distanceMeters:210},
          {kind:"transit",vehicle:"SUBWAY",line:"B",from:"Černý Most",to:"Florenc"},
          {kind:"transit",vehicle:"TRAM",line:"9",from:"Florenc",to:"Viktoria Žižkov"},
          {kind:"walk",distanceMeters:270}]}:
        {minutes:48,distanceMeters:14500,transfers:2,walkingMeters:924,
          steps:[{kind:"walk",distanceMeters:566},
            {kind:"transit",vehicle:"BUS",line:"201",from:"Poliklinika Černý Most",to:"Hutě"},
            {kind:"transit",vehicle:"COMMUTER_TRAIN",line:"S34",from:"Rajská zahrada",to:"Masarykovo nádraží"},
            {kind:"transit",vehicle:"TRAM",line:"26",from:"Masarykovo nádraží",to:"Viktoria Žižkov"},
            {kind:"walk",distanceMeters:358}]}]
    })});
  });
  const title="Metro versus tři přestupy";
  await makeTask(page,title);
  await openTaskPlace(page,title);
  const dialog=page.getByRole("dialog",{name:"Místo konání: "+title});
  await dialog.getByRole("checkbox",{name:/Blok se odehrává mimo domov/}).check();
  await setMapPoint(dialog,50.084,14.442,"VŠE");
  await dialog.getByRole("button",{name:"Odkud vyrážím"}).click();
  await setMapPoint(dialog,50.3,14.9,"Doma");
  await dialog.getByRole("button",{name:"Kombinovaná cesta"}).click();
  await dialog.getByRole("button",{name:"Zastávka 1"}).click();
  await setMapPoint(dialog,50.1102028,14.5794097,"P+R Černý Most");
  await dialog.getByRole("combobox",{name:"Doprava úsek 2"}).selectOption("transit");
  await dialog.getByLabel("Přístupový kód k výpočtu tras").fill("x".repeat(28));
  await dialog.getByRole("button",{name:"Spočítat trasu"}).click();
  const results=dialog.locator(".df2-google-route-results");
  await expect(results).toContainText("93 min");
  await expect(results).toContainText("Autobus 201");
  const metro=dialog.locator(".df2-trip-metro-compare");
  await expect(metro).toContainText("A co metro B?");
  expect(calls).toHaveLength(2);
  await metro.getByRole("button",{name:/Porovnat trasu metrem B/}).click();
  await expect(metro).toContainText("Metro B · 51 min");
  expect(calls).toHaveLength(3);
  expect(calls.map(c=>c.mode)).toEqual(["driving","transit","transit"]);
  expect(calls[2].transitTravelModes).toBe("metro");
  expect(calls[2].from).toEqual(calls[1].from);
  expect(calls[2].to).toEqual(calls[1].to);
  expect(calls[2].departureTime).toBe(calls[1].departureTime);
  await metro.getByRole("button",{name:"Vybrat metro"}).click();
  await expect(results).toContainText("96 min");
  await expect(results).toContainText("Metro B");
  await metro.getByRole("button",{name:"Ponechat původní"}).click();
  await expect(results).toContainText("93 min");
  expect(calls).toHaveLength(3);
});

test("Florenc metro B to C can be compared without requerying car or inventing tram-less rides",async({page})=>{
  const calls=[];
  await page.route("**/api/google-travel",route=>{
    if(route.request().method()==="GET")
      return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({available:true})});
    const p=route.request().postDataJSON();calls.push(p);
    if(p.mode==="driving")return route.fulfill({status:200,contentType:"application/json",
      body:JSON.stringify({minutes:36,distanceMeters:52000,trafficAware:true,
        options:[{minutes:36,distanceMeters:52000,steps:[],transfers:0,walkingMeters:0}]})});
    const subway=p.transitTravelModes==="subway_only";
    const steps=subway?[
      {kind:"walk",distanceMeters:500},
      {kind:"transit",vehicle:"SUBWAY",line:"B",from:"Černý Most",to:"Florenc"},
      {kind:"transit",vehicle:"SUBWAY",line:"C",from:"Florenc",to:"Hlavní nádraží"},
      {kind:"walk",distanceMeters:750},
    ]:[
      {kind:"walk",distanceMeters:535},
      {kind:"transit",vehicle:"SUBWAY",line:"B",from:"Černý Most",to:"Florenc"},
      {kind:"transit",vehicle:"TRAM",line:"26",from:"Florenc",to:"Viktoria Žižkov"},
      {kind:"walk",distanceMeters:268},
    ];
    return route.fulfill({status:200,contentType:"application/json",
      body:JSON.stringify({minutes:subway?47:43,distanceMeters:13600,trafficAware:false,
        options:[{minutes:subway?47:43,distanceMeters:13600,
          transfers:1,walkingMeters:subway?1250:803,steps}]})});
  });
  const title="Metro přes Florenc";
  await makeTask(page,title);await openTaskPlace(page,title);
  const dialog=page.getByRole("dialog",{name:"Místo konání: "+title});
  await dialog.getByRole("checkbox",{name:/Blok se odehrává mimo domov/}).check();
  await setMapPoint(dialog,50.084,14.442,"VŠE");
  await dialog.getByRole("button",{name:"Odkud vyrážím"}).click();
  await setMapPoint(dialog,50.3,14.9,"Domov");
  await dialog.getByRole("button",{name:"Kombinovaná cesta"}).click();
  await dialog.getByRole("button",{name:"Zastávka 1"}).click();
  await setMapPoint(dialog,50.1102028,14.5794097,"P+R Černý Most");
  await dialog.getByRole("combobox",{name:"Doprava úsek 2"}).selectOption("transit");
  await dialog.getByLabel("Přístupový kód k výpočtu tras").fill("x".repeat(28));
  await dialog.getByRole("button",{name:"Spočítat trasu"}).click();
  const results=dialog.locator(".df2-google-route-results");
  await expect(results).toContainText("84 min");
  const onlyMetro=dialog.getByLabel("Alternativa pouze metrem");
  await expect(onlyMetro).toContainText("Raději jen metrem?");
  expect(calls).toHaveLength(2);
  await onlyMetro.getByRole("button",{name:/Prověřit cestu pouze metrem/}).click();
  await expect(onlyMetro).toContainText("Metro B → Metro C");
  expect(calls).toHaveLength(3);
  expect(calls.map(c=>c.mode)).toEqual(["driving","transit","transit"]);
  expect(calls[2].transitTravelModes).toBe("subway_only");
  expect(calls[2].from).toEqual(calls[1].from);
  expect(calls[2].to).toEqual(calls[1].to);
  expect(calls[2].departureTime).toBe(calls[1].departureTime);
  await onlyMetro.getByRole("button",{name:"Vybrat pouze metro"}).click();
  await expect(results).toContainText("88 min");
  await expect(results).toContainText("Metro B → Metro C");
  await onlyMetro.getByRole("button",{name:"Ponechat původní spoj"}).click();
  await expect(results).toContainText("84 min");
  expect(calls).toHaveLength(3);
});

test("subway-only request cannot pretend metro plus tram is subway-only",async({page})=>{
  const calls=[];
  await page.route("**/api/google-travel",route=>{
    if(route.request().method()==="GET")
      return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({available:true})});
    const p=route.request().postDataJSON();calls.push(p);
    return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({
      minutes:42,distanceMeters:11500,trafficAware:false,
      options:[{minutes:42,distanceMeters:11500,transfers:1,walkingMeters:400,
        steps:[{kind:"walk",distanceMeters:180},
          {kind:"transit",vehicle:"SUBWAY",line:"B"},
          {kind:"transit",vehicle:"TRAM",line:"26"},
          {kind:"walk",distanceMeters:220}]}]})});
  });
  const title="Žádné čisté metro";
  await makeTask(page,title);await openTaskPlace(page,title);
  const dialog=page.getByRole("dialog",{name:"Místo konání: "+title});
  await dialog.getByRole("checkbox",{name:/Blok se odehrává mimo domov/}).check();
  await setMapPoint(dialog,50.084,14.442,"VŠE");
  await dialog.getByRole("button",{name:"Odkud vyrážím"}).click();
  await setMapPoint(dialog,50.1102028,14.5794097,"Černý Most");
  await dialog.getByRole("combobox",{name:"Způsob dopravy"}).selectOption("transit");
  await dialog.getByLabel("Přístupový kód k výpočtu tras").fill("x".repeat(28));
  await dialog.getByRole("button",{name:"Spočítat trasu"}).click();
  const onlyMetro=dialog.getByLabel("Alternativa pouze metrem");
  await onlyMetro.getByRole("button",{name:/Prověřit cestu pouze metrem/}).click();
  await expect(onlyMetro).toContainText("nevrátil ověřenou trasu bez tramvaje");
  await expect(onlyMetro.getByRole("button",{name:"Vybrat pouze metro"})).toHaveCount(0);
  expect(calls).toHaveLength(2);
});

test("already-returned transit alternatives can be chosen for free and update total and itinerary",async({page})=>{
  let paid=0;
  await page.route("**/api/google-travel",route=>{
    if(route.request().method()==="GET")
      return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({available:true})});
    paid++;
    const r=(minutes,transit)=>({
      minutes,distanceMeters:12300,transfers:1,walkingMeters:500,steps:[
        {kind:"walk",distanceMeters:220},
        {kind:"transit",vehicle:"SUBWAY",line:"B",from:"Černý Most",to:"Florenc"},
        {kind:"transit",vehicle:transit?"TRAM":"SUBWAY",line:transit?"26":"C",
          from:"Florenc",to:transit?"Viktoria Žižkov":"Hlavní nádraží"},
        {kind:"walk",distanceMeters:280}]
    });
    return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({
      minutes:40,distanceMeters:12300,
      options:[r(40,true),r(44,false)]})});
  });
  const title="Dvě varianty Google";
  await makeTask(page,title);await openTaskPlace(page,title);
  const dialog=page.getByRole("dialog",{name:"Místo konání: "+title});
  await dialog.getByRole("checkbox",{name:/Blok se odehrává mimo domov/}).check();
  await setMapPoint(dialog,50.084,14.442,"VŠE");
  await dialog.getByRole("button",{name:"Odkud vyrážím"}).click();
  await setMapPoint(dialog,50.1102028,14.5794097,"P+R");
  await dialog.getByRole("combobox",{name:"Způsob dopravy"}).selectOption("transit");
  await dialog.getByLabel("Přístupový kód k výpočtu tras").fill("x".repeat(28));
  await dialog.getByRole("button",{name:"Spočítat trasu"}).click();
  const results=dialog.locator(".df2-google-route-results");
  await expect(results).toContainText("40 min");
  await results.getByText("Zobrazit stanice, spoje a alternativy").click();
  await results.getByText(/Porovnat 1 další dostupné varianty/).click();
  await results.getByRole("button",{name:"Vybrat variantu 2 (bez API)"}).click();
  await expect(results).toContainText("44 min");
  await expect(results).toContainText("Metro B → Metro C");
  expect(paid).toBe(1);
});

test("one-click P+R preset prepares drive plus MHD without paid requests or invented minutes",async({page})=>{
  let paidCalls=0;
  await page.route("**/api/google-travel",route=>{
    if(route.request().method()==="GET")
      return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({available:true})});
    paidCalls++;
    return route.fulfill({status:500,contentType:"application/json",body:'{"error":"Unexpected paid call"}'});
  });
  const title="Pohovor u VŠE přes P+R";
  await makeTask(page,title);
  await openTaskPlace(page,title);
  const dialog=page.getByRole("dialog",{name:"Místo konání: "+title});
  await dialog.getByRole("checkbox",{name:/Blok se odehrává mimo domov/}).check();
  await setMapPoint(dialog,50.084,14.442,"VŠE");
  await dialog.getByRole("button",{name:"Odkud vyrážím"}).click();
  await setMapPoint(dialog,50.31,14.86,"Domov");
  const preset=dialog.getByRole("group",{name:"Rychlá volba cesty"});
  await expect(preset).toBeVisible();
  await preset.getByRole("button",{name:"Použít tuto kombinaci"}).click();
  await expect(preset.getByRole("button",{name:/P\+R Černý Most vybráno/})).toHaveAttribute("aria-pressed","true");
  await expect(dialog.getByRole("button",{name:"Kombinovaná cesta"})).toHaveAttribute("aria-pressed","true");
  await expect(dialog.getByRole("combobox",{name:"Doprava úsek 1"})).toHaveValue("driving");
  await expect(dialog.getByRole("combobox",{name:"Doprava úsek 2"})).toHaveValue("transit");
  await expect(dialog.getByRole("spinbutton",{name:"Délka úseku 1"})).toHaveValue("");
  await expect(dialog.getByRole("spinbutton",{name:"Délka úseku 2"})).toHaveValue("");
  await expect(dialog.getByRole("button",{name:"Zastávka 1"})).toContainText("P+R Černý Most");
  // A nearby pedestrian/metro entrance is NOT the verified garage coordinate.
  await dialog.getByRole("button",{name:"Zastávka 1"}).click();
  await setMapPoint(dialog,50.1104,14.5794097,"Pěší vstup u metra");
  await expect(preset.getByRole("button",{name:"Použít tuto kombinaci"})).toBeEnabled();
  await preset.getByRole("button",{name:"Použít tuto kombinaci"}).click();
  await expect(preset.getByRole("button",{name:"P+R Černý Most vybráno"})).toBeDisabled();
  expect(paidCalls).toBe(0);
  await dialog.getByRole("spinbutton",{name:"Délka úseku 1"}).fill("40");
  await dialog.getByRole("spinbutton",{name:"Délka úseku 2"}).fill("45");
  await dialog.getByRole("button",{name:"Uložit místo"}).click();
  const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem("dayframe-travel-v1")));
  const trip=Object.values(saved.blocks)[0];
  expect(trip.legs.map(leg=>leg.mode)).toEqual(["driving","transit"]);
  expect(trip.legs[0].via).toEqual({
    lat:50.1102028,lon:14.5794097,label:"P+R Černý Most — parkovací dům u metra B"});
  expect(trip.typicalMinutes).toBe(85);
  expect(paidCalls).toBe(0);
});

test("metro B comparison must not accept an unrelated metro A route",async({page})=>{
  const calls=[];
  await page.route("**/api/google-travel",route=>{
    if(route.request().method()==="GET")
      return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({available:true})});
    const payload=route.request().postDataJSON();
    calls.push(payload);
    const isComparison=payload.transitTravelModes==="metro";
    return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({
      minutes:46,distanceMeters:11500,trafficAware:false,
      options:[{minutes:46,distanceMeters:11500,transfers:0,walkingMeters:420,
        steps:[{kind:"walk",distanceMeters:200},
          {kind:"transit",vehicle:isComparison?"SUBWAY":"BUS",
            line:isComparison?"A":"201",from:"Nástup",to:"Výstup"},
          {kind:"walk",distanceMeters:220}]}]
    })});
  });
  const title="Linka metra musí sedět";
  await makeTask(page,title);
  await openTaskPlace(page,title);
  const dialog=page.getByRole("dialog",{name:"Místo konání: "+title});
  await dialog.getByRole("checkbox",{name:/Blok se odehrává mimo domov/}).check();
  await setMapPoint(dialog,50.084,14.442,"VŠE");
  await dialog.getByRole("button",{name:"Odkud vyrážím"}).click();
  await setMapPoint(dialog,50.1102028,14.5794097,"P+R Černý Most");
  await dialog.getByRole("combobox",{name:"Způsob dopravy"}).selectOption("transit");
  await dialog.getByLabel("Přístupový kód k výpočtu tras").fill("x".repeat(28));
  await dialog.getByRole("button",{name:"Spočítat trasu"}).click();
  const metro=dialog.locator(".df2-trip-metro-compare");
  await expect(metro).toContainText("A co metro B?");
  await metro.getByRole("button",{name:/Porovnat trasu metrem B/}).click();
  await expect(metro).toContainText("ověřenou trasu linkou B");
  await expect(metro.getByRole("button",{name:"Vybrat metro"})).toHaveCount(0);
  expect(calls).toHaveLength(2);
  expect(calls[1].transitTravelModes).toBe("metro");
});

test("any city automatically finds parking, ranks known prices and inserts garage",async({page})=>{
  const calls=[];
  await page.route("**/api/parking?**",route=>{
    calls.push(new URL(route.request().url()));
    return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({items:[
      {id:"node:1",name:"Centrální garáž",lat:49.741,lon:13.381,distanceMeters:300,
        kind:"multi-storey",access:"yes",price:{kind:"hourly",amount:35,currency:"CZK",label:"35 CZK/hod"},
        parkRide:false,osmUrl:"https://www.openstreetmap.org/node/1"},
      {id:"node:2",name:"Neznámý tarif",lat:49.7405,lon:13.3805,distanceMeters:90,
        kind:"surface",access:"unknown",price:{kind:"unknown",label:"Cena neuvedena"},
        parkRide:false,osmUrl:"https://www.openstreetmap.org/node/2"},
      {id:"node:3",name:"Městské zdarma",lat:49.745,lon:13.385,distanceMeters:800,
        kind:"surface",access:"yes",price:{kind:"free",label:"Zdarma dle OSM"},
        parkRide:false,osmUrl:"https://www.openstreetmap.org/node/3"}
    ],source:"OpenStreetMap"})});
  });
  let googleCalls=0;
  await page.route("**/api/google-travel",route=>{
    if(route.request().method()==="POST")googleCalls++;
    return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({available:true})});
  });
  const title="Výlet do Plzně";
  await makeTask(page,title);await openTaskPlace(page,title);
  const dialog=page.getByRole("dialog",{name:"Místo konání: "+title});
  await dialog.getByRole("checkbox",{name:/Blok se odehrává mimo domov/}).check();
  await setMapPoint(dialog,49.74,13.38,"Plzeň");
  const list=dialog.locator(".df2-parking-list");
  await expect(list).toContainText("Centrální garáž");
  expect(calls.some(u=>u.searchParams.get("lat")==="49.74"&&u.searchParams.get("lon")==="13.38")).toBe(true);
  await expect(list.locator(".df2-parking-item").first()).toContainText("Neznámý tarif");
  await dialog.getByRole("combobox",{name:"Seřadit parkoviště"}).selectOption("price");
  await expect(list.locator(".df2-parking-item").first()).toContainText("Městské zdarma");
  await dialog.getByRole("combobox",{name:"Doba parkování"}).selectOption("4");
  await expect(list).toContainText("asi 140 CZK za 4 h");
  await list.locator(".df2-parking-item").filter({hasText:"Centrální garáž"}).getByRole("button",{name:"Vybrat"}).click();
  await expect(dialog.getByRole("combobox",{name:"Doprava úsek 1"})).toHaveValue("driving");
  await expect(dialog.getByRole("combobox",{name:"Doprava úsek 2"})).toHaveValue("walking");
  await expect(dialog.getByRole("button",{name:"Zastávka 1"})).toContainText("Centrální garáž");
  await expect(dialog.getByRole("spinbutton",{name:"Délka úseku 1"})).toHaveValue("");
  expect(googleCalls).toBe(0);
});

test("searching near an existing interchange preserves the drive plus transit plan",async({page})=>{
  const queries=[];
  await page.route("**/api/parking?**",route=>{
    queries.push(new URL(route.request().url()));
    return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({
      items:[{id:"node:12",name:"Alternativní P+R",lat:50.111,lon:14.580,distanceMeters:80,
        kind:"multi-storey",access:"yes",parkRide:true,
        price:{kind:"hourly",amount:20,currency:"CZK",label:"20 CZK/hod"},
        osmUrl:"https://www.openstreetmap.org/node/12"}]
    })});
  });
  const title="Kombinace do školy";
  await makeTask(page,title);await openTaskPlace(page,title);
  const dialog=page.getByRole("dialog",{name:"Místo konání: "+title});
  await dialog.getByRole("checkbox",{name:/Blok se odehrává mimo domov/}).check();
  await setMapPoint(dialog,50.084,14.442,"VŠE");
  await dialog.getByRole("button",{name:"Odkud vyrážím"}).click();
  await setMapPoint(dialog,50.30,14.90,"Domov");
  await dialog.getByRole("group",{name:"Rychlá volba cesty"}).getByRole("button",{name:"Použít tuto kombinaci"}).click();
  await dialog.getByRole("combobox",{name:"Oblast parkování"}).selectOption("interchange");
  await expect.poll(()=>queries.some(q=>q.searchParams.get("lat")==="50.1102028")).toBe(true);
  await dialog.locator(".df2-parking-item").filter({hasText:"Alternativní P+R"})
    .getByRole("button",{name:"Vybrat"}).click();
  await expect(dialog.getByRole("combobox",{name:"Doprava úsek 2"})).toHaveValue("transit");
  await expect(dialog.getByRole("button",{name:"Zastávka 1"})).toContainText("Alternativní P+R");
});

test("comfort planner warns about 2.2 km walking and suggests metro P+R without hidden billing",async({page})=>{
  const requests=[];
  await page.route("**/api/google-travel",async route=>{
    if(route.request().method()==="GET")
      return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({available:true})});
    const p=route.request().postDataJSON();
    requests.push(p);
    if(p.mode==="driving")return route.fulfill({status:200,contentType:"application/json",
      body:JSON.stringify({minutes:40,distanceMeters:53200,trafficAware:true,options:[
        {minutes:40,distanceMeters:53200,steps:[],walkingMeters:0,transfers:0}]})});
    const metro=p.from.lon>14.57;
    return route.fulfill({status:200,contentType:"application/json",
      body:JSON.stringify({minutes:metro?50:45,distanceMeters:13000,trafficAware:false,
        options:[{minutes:metro?50:45,distanceMeters:13000,transfers:0,
          walkingMeters:metro?400:2200,steps:[
            {kind:"walk",distanceMeters:metro?200:1300},
            {kind:"transit",vehicle:metro?"SUBWAY":"COMMUTER_TRAIN",
              line:metro?"B":"S3",from:metro?"Černý Most":"Rajská zahrada",
              to:metro?"Náměstí Republiky":"Praha hl. n."},
            {kind:"walk",distanceMeters:metro?200:900},
          ]}]})});
  });
  const title="Pohodlná cesta do školy";
  await makeTask(page,title);
  await openTaskPlace(page,title);
  const dialog=page.getByRole("dialog",{name:"Místo konání: "+title});
  await dialog.getByRole("checkbox",{name:/Blok se odehrává mimo domov/}).check();
  await setMapPoint(dialog,50.084,14.442,"VŠE");
  await dialog.getByRole("button",{name:"Odkud vyrážím"}).click();
  await setMapPoint(dialog,50.3,14.9,"Doma");
  await dialog.getByRole("button",{name:"Kombinovaná cesta"}).click();
  await dialog.getByRole("button",{name:"Zastávka 1"}).click();
  await setMapPoint(dialog,50.1068211,14.5622422,"P+R Rajská zahrada");
  await dialog.getByRole("combobox",{name:"Doprava úsek 2"}).selectOption("transit");
  await dialog.getByLabel("Přístupový kód k výpočtu tras").fill("x".repeat(28));
  await dialog.getByRole("button",{name:"Spočítat trasu"}).click();
  const results=dialog.locator(".df2-google-route-results");
  await expect(results).toContainText("Vlak S3");
  await expect(results).toContainText("2.2 km chůze");
  await expect(results.getByRole("button",{name:/Nastavit P\+R u metra B/})).toBeVisible();
  expect(requests).toHaveLength(2);
  expect(requests[1].transitPreference).toBe("balanced");
  await results.getByRole("button",{name:/Nastavit P\+R u metra B/}).click();
  await expect(dialog.locator("p.df2-trip-inline-hint[role=status]").filter({hasText:"Přestupní místo je nastaveno"})).toContainText("P+R Černý Most u metra B");
  await expect(results).toHaveCount(0);
  expect(requests).toHaveLength(2);
  await dialog.getByRole("button",{name:"Spočítat trasu"}).click();
  await expect(dialog.locator(".df2-google-route-results")).toContainText("Metro B");
  expect(requests).toHaveLength(4);
  expect(requests[2].to.lat).toBeCloseTo(50.1102028,6);
  expect(requests[2].to.lon).toBeCloseTo(14.5794097,6);
  expect(requests[3].from.lon).toBeCloseTo(14.5794097,6);
});

test("Google calculates car to transit in sequence and shows alternative lines without saving Google data",async({page})=>{
  const calls=[];
  await page.route("**/api/google-travel",async route=>{
    if(route.request().method()==="GET")
      return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({available:true})});
    const payload=route.request().postDataJSON();
    calls.push(payload);
    if(payload.mode==="driving")return route.fulfill({status:200,contentType:"application/json",
      body:JSON.stringify({minutes:30,distanceMeters:35000,source:"Google Maps",trafficAware:true,
        options:[{minutes:30,distanceMeters:35000,steps:[],transfers:0,walkingMeters:0}]})});
    expect(payload.mode).toBe("transit");
    return route.fulfill({status:200,contentType:"application/json",
      body:JSON.stringify({minutes:20,distanceMeters:13000,source:"Google Maps",trafficAware:false,options:[
        {minutes:20,distanceMeters:13000,transfers:0,walkingMeters:200,steps:[
          {kind:"walk",distanceMeters:200},
          {kind:"transit",vehicle:"SUBWAY",line:"B",headsign:"Zličín",
            from:"Černý Most",to:"Florenc",stops:12,
            departureTime:"2026-10-18T07:45:00Z",arrivalTime:"2026-10-18T08:05:00Z",
            departureLabel:"09:45",arrivalLabel:"10:05",departureZone:"Europe/Prague",arrivalZone:"Europe/Prague"}]},
        {minutes:26,distanceMeters:15000,transfers:1,walkingMeters:400,steps:[
          {kind:"transit",vehicle:"BUS",line:"100",from:"Zastávka",to:"Stanice"}]},
      ]})});
  });
  const title="Cesta s návazností MHD";
  await makeTask(page,title);
  await openTaskPlace(page,title);
  const dialog=page.getByRole("dialog",{name:"Místo konání: "+title});
  await dialog.getByRole("checkbox",{name:/Blok se odehrává mimo domov/}).check();
  await setMapPoint(dialog,50.08,14.43,"Fakulta");
  await dialog.getByRole("button",{name:"Odkud vyrážím"}).click();
  await setMapPoint(dialog,50.1,14.2,"Doma");
  await dialog.getByRole("button",{name:"Kombinovaná cesta"}).click();
  await dialog.getByRole("button",{name:"Zastávka 1"}).click();
  await setMapPoint(dialog,50.11,14.22,"Parkoviště");
  await dialog.getByRole("combobox",{name:"Doprava úsek 2"}).selectOption("transit");
  await dialog.getByRole("button",{name:/Upřesnit cestu/}).click();
  await dialog.getByRole("combobox",{name:"Preference MHD"}).selectOption("fewer_transfers");
  await dialog.getByRole("spinbutton",{name:"Minuty na přestup"}).fill("7");
  await dialog.getByLabel("Přístupový kód k výpočtu tras").fill("x".repeat(28));
  await dialog.getByRole("button",{name:"Spočítat trasu"}).click();
  await expect(dialog.locator(".df2-google-route-results")).toContainText("57 min");
  await expect(dialog.locator(".df2-google-route-results")).toContainText("Metro B");
  await expect(dialog.locator(".df2-google-route-results")).toContainText("Černý Most");
  await expect(dialog.locator(".df2-google-route-results")).toContainText("09:45");
  await expect(dialog.locator(".df2-google-route-results")).toContainText("Porovnat 1 další dostupné varianty");
  await expect.poll(()=>calls.length).toBe(2);
  expect(calls[0].mode).toBe("driving");
  expect(calls[1].mode).toBe("transit");
  expect(calls[1].transitPreference).toBe("fewer_transfers");
  expect(calls[0].departureTime).toBeUndefined();
  const mockedNow=await page.evaluate(()=>Date.now());
  expect(Date.parse(calls[1].departureTime)).toBeGreaterThan(mockedNow+35*60000);
  expect(Date.parse(calls[1].departureTime)).toBeLessThan(mockedNow+39*60000);
  await dialog.getByRole("spinbutton",{name:"Délka úseku 1"}).fill("30");
  await dialog.getByRole("spinbutton",{name:"Délka úseku 2"}).fill("27");
  await dialog.getByRole("button",{name:"Uložit místo"}).click();
  const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem("dayframe-travel-v1")));
  expect(JSON.stringify(saved)).not.toContain("Černý Most");
  expect(JSON.stringify(saved)).not.toContain("x".repeat(28));
  expect(Object.values(saved.blocks)[0].typicalMinutes).toBe(57);
});


test("outbound and return journeys dim with their completed task and restore on undo",async({page})=>{
  const title="Úkol s oběma cestami";
  await makeTask(page,title);
  await openTaskPlace(page,title);
  const dialog=page.getByRole("dialog",{name:"Místo konání: "+title});
  await dialog.getByRole("checkbox",{name:/Blok se odehrává mimo domov/}).check();
  await setMapPoint(dialog,50.08,14.43,"Místo konání");
  await dialog.getByRole("button",{name:"Odkud vyrážím"}).click();
  await setMapPoint(dialog,50.4,14.7,"Doma");
  await dialog.getByRole("spinbutton",{name:"Obvyklá doba cesty"}).fill("24");
  await dialog.getByRole("checkbox",{name:"Přidat cestu domů po skončení bloku"}).check();
  await dialog.getByRole("button",{name:"Uložit místo",exact:true}).click();

  const task=page.locator(".df2-week-task").filter({hasText:title});
  const journeys=page.locator("[data-week-travel]");
  await expect(journeys).toHaveCount(2);
  await expect(journeys.first()).toContainText("Cesta tam");
  await expect(journeys.last()).toContainText("Cesta domů");
  for(const journey of await journeys.all()){
    await expect(journey).not.toHaveClass(/is-completed/);
  }
  const travelBefore=await page.evaluate(()=>localStorage.getItem("dayframe-travel-v1"));

  await task.click();
  await page.locator(".df2-modal").getByRole("button",{name:"Označit hotovo"}).click();
  await expect(task).toHaveClass(/done/);
  for(const journey of await journeys.all()){
    await expect(journey).toHaveClass(/is-completed/);
    await expect(journey).toHaveCSS("background-color","rgb(240, 240, 237)");
  }
  expect(await page.evaluate(()=>localStorage.getItem("dayframe-travel-v1"))).toBe(travelBefore);

  // Undo through the actual completion toast; completed cards in read-only days
  // intentionally cannot be reopened by clicking them.
  await page.locator(".df2-completion-toast").getByRole("button",{name:"Vrátit"}).click();
  await expect(task).not.toHaveClass(/done/);
  await expect(page.locator("[data-week-travel]")).toHaveCount(2);
  await expect(page.locator("[data-week-travel].is-completed")).toHaveCount(0);
  expect(await page.evaluate(()=>localStorage.getItem("dayframe-travel-v1"))).toBe(travelBefore);

  // Persist both completion states without changing travel reservations.
  await page.reload({waitUntil:"networkidle"});
  await page.locator(".df2-sidebar nav button").filter({hasText:"Týden"}).click();
  await expect(page.locator(".df2-week-task").filter({hasText:title})).not.toHaveClass(/done/);
  await expect(page.locator("[data-week-travel].is-completed")).toHaveCount(0);
  expect(await page.evaluate(()=>localStorage.getItem("dayframe-travel-v1"))).toBe(travelBefore);
});
