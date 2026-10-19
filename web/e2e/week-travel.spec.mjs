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
async function openTaskPlace(page,title){
  await page.locator(".df2-week-task").filter({hasText:title}).hover();
  await page.getByRole("button",{name:"Místo konání: "+title}).click();
}
async function setMapPoint(dialog,lat,lon,label){
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

test("Google ETA remains ephemeral and cannot silently replace private planning time",async({page})=>{
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
  await expect(dialog).toContainText("50 výpočtů denně");
  await expect(dialog).toContainText("1 000 měsíčně");
  await expect(dialog.locator(".df2-google-route-results")).toContainText("58 min");
  await expect(dialog.locator(".df2-google-route-results")).toContainText("54.0 km");
  await expect(dialog.locator(".df2-google-attribution img")).toHaveAttribute("src",/gstatic\.com\/images\/branding\/product/);
  await expect(dialog.getByRole("spinbutton",{name:"Obvyklá doba cesty"})).toHaveValue("");
  // Google-derived content stays ephemeral. The user's own planning value is the only saved duration.
  await expect(dialog.getByRole("button",{name:"Převzít časy jako můj plánovací odhad"})).toHaveCount(0);
  await dialog.getByRole("spinbutton",{name:"Obvyklá doba cesty"}).fill("65");
  await dialog.getByRole("button",{name:"Uložit místo"}).click();
  const stored=await page.evaluate(()=>JSON.parse(localStorage.getItem("dayframe-travel-v1")));
  expect(Object.values(stored.blocks)[0].typicalMinutes).toBe(65);
  expect(JSON.stringify(stored)).not.toContain("58");
  expect(JSON.stringify(stored)).not.toContain("x".repeat(28));
});
test("Google route server unavailable still permits manual travel time",async({page})=>{
  await page.route("**/api/google-travel",route=>route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({available:false})}));
  await makeTask(page,"Pohovor bez API");
  await openTaskPlace(page,"Pohovor bez API");
  const dialog=page.getByRole("dialog",{name:"Místo konání: Pohovor bez API"});
  await dialog.getByRole("checkbox",{name:/Blok se odehrává mimo domov/}).check();
  await setMapPoint(dialog,50.08,14.43,"Cíl");
  await expect(dialog).toContainText("Serverová služba zatím není aktivní");
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
  await expect(dialog).toContainText("Serverová funkce pro Google Maps neodpovídá");
  const access=dialog.getByLabel("Přístupový kód k výpočtu tras");
  await expect(access).toBeVisible();
  await access.fill("x".repeat(28));
  await expect.poll(()=>postCount).toBe(0);
  isOnline=true;
  await dialog.getByRole("button",{name:"Zkontrolovat propojení znovu"}).click();
  await expect(dialog).toContainText("Bezpečnostní limit Dayframe");
  await expect(access).toHaveValue("x".repeat(28));
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
            departureTime:"2026-10-18T07:45:00Z",arrivalTime:"2026-10-18T08:05:00Z"}]},
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
  await dialog.getByRole("combobox",{name:"Preference MHD"}).selectOption("fewer_transfers");
  await dialog.getByRole("spinbutton",{name:"Minuty na přestup"}).fill("7");
  await dialog.getByRole("button",{name:"Přepočítat podle nastavení"}).click();
  await dialog.getByLabel("Přístupový kód k výpočtu tras").fill("x".repeat(28));
  await expect(dialog.locator(".df2-google-route-results")).toContainText("57 min");
  await expect(dialog.locator(".df2-google-route-results")).toContainText("Metro B");
  await expect(dialog.locator(".df2-google-route-results")).toContainText("Černý Most");
  await expect(dialog.locator(".df2-google-route-results")).toContainText("Porovnat 1 další dostupné varianty");
  await expect.poll(()=>calls.length).toBe(2);
  expect(calls[0].mode).toBe("driving");
  expect(calls[1].mode).toBe("transit");
  expect(calls[1].transitPreference).toBe("fewer_transfers");
  expect(Date.parse(calls[1].departureTime)-Date.parse(calls[0].departureTime)).toBe(37*60000);
  await dialog.getByRole("spinbutton",{name:"Délka úseku 1"}).fill("30");
  await dialog.getByRole("spinbutton",{name:"Délka úseku 2"}).fill("27");
  await dialog.getByRole("button",{name:"Uložit místo"}).click();
  const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem("dayframe-travel-v1")));
  expect(JSON.stringify(saved)).not.toContain("Černý Most");
  expect(JSON.stringify(saved)).not.toContain("x".repeat(28));
  expect(Object.values(saved.blocks)[0].typicalMinutes).toBe(57);
});
