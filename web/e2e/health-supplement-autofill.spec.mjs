import {test,expect} from "@playwright/test";
const ROOT=process.env.DAYFRAME_BASE_URL||"http://127.0.0.1:4173";
async function setup(page){
  await page.clock.setFixedTime(new Date("2026-10-12T12:00:00"));
  await page.goto(ROOT,{waitUntil:"networkidle"});
  await page.evaluate(()=>localStorage.clear());
  await page.reload({waitUntil:"networkidle"});
  await page.locator(".df2-sidebar nav button").filter({hasText:"Zdraví"}).click();
  await page.getByRole("tab",{name:"Suplementy"}).click();
  await page.getByRole("button",{name:"+ Přidat suplement"}).click();
  return page.getByRole("dialog",{name:"Editor suplementu"});
}
const A={name:"Vitamin C 1000 mg 60 capsules",brand:"Sample Labs",
  amount:"60 capsules",packServings:60,packUnit:"kapsle",
  priceCzk:249,imageUrl:"https://cdn.example.com/vitamin-c.png",
  sourceUrl:"https://example.com/shop/vitamin-c-60",sourceLabel:"Sample shop"};
const B={...A,name:"Vitamin C 1000 mg 120 capsules",amount:"120 capsules",packServings:120,
  imageUrl:"https://cdn.example.com/vitamin-c-120.png",sourceUrl:"https://example.com/shop/vitamin-c-120"};
async function fixture(page,bg="#ffffff"){
  const value=await page.evaluate(fill=>{
    const c=document.createElement("canvas");c.width=280;c.height=320;
    const ctx=c.getContext("2d");ctx.fillStyle=fill;ctx.fillRect(0,0,280,320);
    ctx.fillStyle="#2061b4";ctx.fillRect(90,60,100,220);
    ctx.fillStyle="#fff";ctx.fillRect(111,100,58,40);return c.toDataURL("image/png");
  },bg);return Buffer.from(value.split(",")[1],"base64");
}
async function mock(page){
  const white=await fixture(page,"#fff"),dark=await fixture(page,"#333");
  await page.route("**/api/supplement-product-lookup?*",async route=>{
    const q=new URL(route.request().url()).searchParams.get("query");
    const matches=q?.startsWith("https://")?[A]:[A,B];
    await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({matches,notice:"Zkontroluj variantu."})});
  });
  await page.route("**/api/hygiene-product-lookup?*",async route=>{
    const p=new URL(route.request().url()).searchParams;
    if(p.get("mode")==="photos")return route.fulfill({status:200,contentType:"application/json",
      body:JSON.stringify({candidates:[
        {url:"https://cdn.example.com/dark.png",source:"Shop",priority:30},
        {url:"https://cdn.example.com/white.png",source:"Manufacturer",priority:12}
      ]})});
    if(p.get("mode")==="image")return route.fulfill({status:200,contentType:"image/png",
      body:p.get("url")?.includes("white.png")?white:dark});
    return route.fulfill({status:404});
  });
}
test("name search suggests variants, imports chosen packaging and a white-background photo without inventing dosage",async({page})=>{
  const dialog=await setup(page);await mock(page);
  await dialog.getByRole("textbox",{name:"Název nebo odkaz suplementu"}).fill("Vitamin C");
  await dialog.getByRole("button",{name:"Vyhledat",exact:true}).click();
  await expect(dialog.getByLabel("Nalezené suplementy")).toContainText("60 capsules");
  await expect(dialog.getByLabel("Nalezené suplementy")).toContainText("120 capsules");
  await dialog.getByLabel("Nalezené suplementy").getByRole("button",{name:"Použít produkt"}).first().click();
  await expect(dialog.getByRole("textbox",{name:"Název suplementu"})).toHaveValue(A.name);
  await expect(dialog.getByRole("textbox",{name:"Značka suplementu"})).toHaveValue(A.brand);
  await expect(dialog.getByRole("spinbutton",{name:"Velikost balení"})).toHaveValue("60");
  await expect(dialog.getByRole("spinbutton",{name:"Cena balení"})).toHaveValue("249");
  await expect(dialog.getByRole("textbox",{name:"Dávkování"})).toHaveValue("");
  await expect(dialog.locator(".df2-supplements-photo-editor img")).toBeVisible();
  await expect(dialog.getByText(/bílým pozadím|sjednotit na bílou/)).toBeVisible();
  const colors=await dialog.locator(".df2-supplements-photo-editor img").evaluate(async img=>{
    await img.decode();const c=document.createElement("canvas");c.width=img.naturalWidth;c.height=img.naturalHeight;
    const ctx=c.getContext("2d");ctx.drawImage(img,0,0);return [...ctx.getImageData(0,0,1,1).data].slice(0,3);
  });
  expect(colors.every(x=>x>=237)).toBe(true);
  await dialog.getByRole("button",{name:"Uložit suplement"}).click();
  await expect(dialog.getByRole("alert")).toContainText("Doplň dávku");
  await dialog.getByRole("textbox",{name:"Dávkování"}).fill("Dle etikety");
  await dialog.getByRole("button",{name:"Uložit suplement"}).click();
  await expect(dialog).toHaveCount(0);
  const data=await page.evaluate(()=>JSON.parse(localStorage.getItem("dayframe-supplements-v1")));
  expect(data.supplements[0].photoId).toMatch(/^supp-photo-/);
  expect(data.supplements[0].sourceUrl).toBe(A.sourceUrl);
  expect(data.supplements[0].doseLabel).toBe("Dle etikety");
});
test("HTTPS link automatically selects a unique product; manual photo is never overwritten",async({page})=>{
  const dialog=await setup(page);await mock(page);
  const before=await fixture(page,"#e5e5e5");
  await dialog.getByLabel("Nahrát fotografii suplementu").setInputFiles({name:"mine.png",mimeType:"image/png",buffer:before});
  await dialog.getByRole("textbox",{name:"Název nebo odkaz suplementu"}).fill("https://example.com/shop/vitamin-c-60");
  await expect(dialog.getByRole("textbox",{name:"Název suplementu"})).toHaveValue(A.name);
  await expect(dialog.locator(".df2-supplements-photo-editor img")).toBeVisible();
  await expect(dialog.getByText("Fotografie produktu", {exact:true})).toBeVisible();
  await expect(dialog.getByText("Fotografie byla doplněna; bílé pozadí nelze spolehlivě zaručit.")).toHaveCount(0);
});
test("failed lookup preserves manually entered personal fields and photograph upload controls",async({page})=>{
  const dialog=await setup(page);
  await page.route("**/api/supplement-product-lookup?*",route=>route.fulfill({status:200,
    contentType:"application/json",body:JSON.stringify({matches:[],notice:"Nenalezeno."})}));
  await dialog.getByRole("textbox",{name:"Název suplementu"}).fill("Můj produkt");
  await dialog.getByRole("textbox",{name:"Dávkování"}).fill("Z etikety");
  await dialog.getByRole("button",{name:"Vyhledat",exact:true}).click();
  await expect(dialog.getByText("Nenalezeno.")).toBeVisible();
  await expect(dialog.getByRole("textbox",{name:"Dávkování"})).toHaveValue("Z etikety");
  await expect(dialog.getByLabel("Nahrát fotografii suplementu")).toBeAttached();
});

test("stale URL lookup cannot overwrite a newly typed product name during debounce",async({page})=>{
  const dialog=await setup(page);
  let resolveOld;
  await page.route("**/api/supplement-product-lookup?*",async route=>{
    const query=new URL(route.request().url()).searchParams.get("query")||"";
    if(query.includes("old-product")){
      await new Promise(resolve=>{resolveOld=resolve;});
      return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({matches:[A]})}).catch(()=>{});
    }
    return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({matches:[],notice:"Bez výsledku"})});
  });
  const input=dialog.getByRole("textbox",{name:"Název nebo odkaz suplementu"});
  await input.fill("https://example.com/old-product");
  await expect.poll(()=>typeof resolveOld).toBe("function");
  await input.fill("Nový jiný produkt");
  resolveOld();
  await expect(dialog.getByRole("textbox",{name:"Název suplementu"})).toHaveValue("");
  await expect(input).toHaveValue("Nový jiný produkt");
  await expect(dialog.locator(".df2-supplements-photo-editor img")).toHaveCount(0);
});
