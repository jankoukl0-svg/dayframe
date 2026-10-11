/**
 * Server-side product lookup for supplements: Open Food Facts + public product pages.
 * Reuses Hygiene's validated HTTPS fetcher and web discovery, not cosmetic catalog matches.
 * Data is limited to product identity/packaging; NO dosage, usage or medical advice.
 */
import {fromHtml} from "./hygiene-product-lookup";
import {readLimited,requestPublic} from "./supplement-remote";
import {bingRssResults,duckDuckGoResults,rankProductLinks,productPageIsRelevant} from "../lib/dayframe-product-discovery.mjs";
import {foodCatalogCandidates,packCountFromLabel,sameSupplementProduct,plausibleSupplementListing,
  type SupplementLookupMatch} from "../lib/dayframe-supplement-lookup";

const str=(v:unknown,max=160)=>typeof v==="string"?v.replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim().slice(0,max):"";
const safeImage=(value:unknown)=>{
  try{const u=new URL(str(value,2000));return u.protocol==="https:"&&!u.username&&!u.password?u.href:"";}
  catch{return "";}
};
function mapWeb(x:ReturnType<typeof fromHtml>):SupplementLookupMatch|null {
  if(!x)return null;
  const pack=packCountFromLabel([x.name,x.amount].join(" "));
  return {name:x.name,brand:x.brand,amount:x.amount,priceCzk:x.priceCzk,
    imageUrl:x.imageUrl,sourceUrl:x.sourceUrl,sourceLabel:x.sourceLabel,
    packServings:pack?.count??null,packUnit:pack?.unit??""};
}
async function searchFood(query:string):Promise<SupplementLookupMatch[]>{
  const url=new URL("https://world.openfoodfacts.org/cgi/search.pl");
  for(const [k,v] of Object.entries({
    search_terms:query,search_simple:"1",action:"process",json:"1",page_size:"15",
    fields:"code,product_name,product_name_cs,product_name_en,brands,quantity,categories,categories_tags,image_front_url,image_url"
  }))url.searchParams.set(k,v);
  const response=await requestPublic(url.href,"application/json",5000);
  const bytes=await readLimited(response,600_000);
  const parsed=JSON.parse(new TextDecoder().decode(bytes)) as {products?:Record<string,unknown>[]};
  return foodCatalogCandidates(Array.isArray(parsed.products)?parsed.products:[],query);
}
async function researchProductPages(query:string){
  const bing=new URL("https://www.bing.com/search");
  bing.searchParams.set("q",query+" supplement");bing.searchParams.set("format","rss");
  const duck=new URL("https://html.duckduckgo.com/html/");
  duck.searchParams.set("q",query+" supplement");
  const [a,b]=await Promise.allSettled([
    requestPublic(bing.href,"application/rss+xml,application/xml,text/xml",3500)
      .then(async r=>bingRssResults(new TextDecoder().decode(await readLimited(r,200_000,true)),query)),
    requestPublic(duck.href,"text/html",3500)
      .then(async r=>duckDuckGoResults(new TextDecoder().decode(await readLimited(r,300_000,true)),query))
  ]);
  const discovered=rankProductLinks([
    ...(a.status==="fulfilled"?a.value:[]),
    ...(b.status==="fulfilled"?b.value:[])
  ],query).slice(0,6);
  const results=await Promise.all(discovered.map(async (link:{url:string;title:string})=>{
    try{
      const r=await requestPublic(link.url,"text/html",4200);
      if(!(r.headers.get("content-type")??"").toLowerCase().includes("text/html"))return null;
      const html=new TextDecoder().decode(await readLimited(r,1_100_000,true));
      const found=fromHtml(html,link.url);
      if(!found||!productPageIsRelevant(found.name,query,found.brand,link.title,found.amount)
        ||!plausibleSupplementListing(found.name,found.category,found.description))return null;
      return found;
    }catch{return null;}
  }));
  return results.filter((x):x is NonNullable<typeof x>=>x!==null);
}
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
async function handle(request:Request):Promise<Response>{
  if(request.method!=="GET")return json({error:"Nepodporovaná metoda."},405);
  const query=(new URL(request.url).searchParams.get("query")??"").trim();
  if(query.length<3||query.length>500)return json({error:"Zadej název nebo odkaz produktu (3–500 znaků)."},400);
  try{
    if(/^https?:\/\//i.test(query)){
      // All redirects and DNS targets are checked by the existing SSRF-safe fetcher.
      const response=await requestPublic(query,"text/html",6500);
      if(!(response.headers.get("content-type")??"").toLowerCase().includes("text/html"))
        return json({matches:[],notice:"Odkaz neobsahuje veřejnou produktovou stránku."});
      const html=new TextDecoder().decode(await readLimited(response,1_100_000,true));
      const found=mapWeb(fromHtml(html,query));
      return json({matches:found?[found]:[],notice:found
        ?"Údaje vycházejí z produktové stránky. Zkontroluj značku a konkrétní variantu."
        :"Nepodařilo se ověřit produkt na uvedeném odkazu."});
    }
    let catalog:SupplementLookupMatch[]=[];
    try{catalog=await searchFood(query);}catch{/* Independent web discovery. */}
    let pages:SupplementLookupMatch[]=[];
    try{
      const web=await researchProductPages(query);
      pages=web.map(mapWeb).filter((x):x is SupplementLookupMatch=>!!x)
        .filter(x=>sameSupplementProduct(x.name,x.brand,query)).slice(0,5);
    }catch{/* Offline catalogs are still useful. */}
    const distinct=new Map<string,SupplementLookupMatch>();
    for(const item of [...catalog,...pages])distinct.set(item.sourceUrl,item);
    const matches=[...distinct.values()].slice(0,6);
    return json({matches,notice:matches.length
      ?"Nalezené varianty produktů. Vyber přesný výrobek a zkontroluj jeho balení."
      :"Produkt se nepodařilo spolehlivě najít. Zkus přesnější název nebo přímý odkaz."});
  }catch{return json({matches:[],notice:"Zdroj je nedostupný nebo blokuje automatické načítání. Zkus jiný odkaz."});}
}
export default {fetch:handle};
