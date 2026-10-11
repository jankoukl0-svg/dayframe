/** Product-identity helpers only. Do not infer health claims or daily dosage from listings. */
export type SupplementLookupMatch={
  name:string;brand:string;amount:string;priceCzk:number|null;
  imageUrl:string;sourceUrl:string;sourceLabel:string;
  packServings:number|null;packUnit:string;
};
const space=(s:string)=>s.replace(/\s+/g," ").trim();
export function packCountFromLabel(value:string):{count:number;unit:string}|null{
  // Only explicit package counts. Never treat strength like "1000 mg" as number of doses.
  const pattern=/\b(\d{1,5})\s*(kapsl(?:e|í|i)?|capsules?|caps?|tablet(?:y|s)?|tabletek|tabl(?:ety)?|softgels?|sáčk(?:ů|y|u|y)?|sachets?|ks|pieces|servings?|dávek|dávky|gummies)(?!\p{L})/giu;
  const found=[...space(value).matchAll(pattern)];
  if(!found.length)return null;
  const count=Number(found[0][1]);
  if(!Number.isInteger(count)||count<1||count>10000)return null;
  const token=found[0][2].toLocaleLowerCase("cs");
  const unit=/kapsl|caps|softgel/.test(token)?"kapsle":
    /tablet|tabletek|tabl/.test(token)?"tablety":
    /sáčk|sachet/.test(token)?"sáčky":
    /serving|dáv/.test(token)?"dávky":
    /gumm/.test(token)?"gumové bonbony":"ks";
  return {count,unit};
}
export function looksLikeSupplementCategory(value:string):boolean{
  return /supplement|vitamin|minerals?|dietary|protein|creatine|kreatin|dopl[nň]k|v[ýy]živa|sport.*nutrition|aminokyselin|omega[- ]?3|magnesium|collagen|kolagen|electrolyte/i.test(value);
}
export function sameSupplementProduct(name:string,brand:string,query:string):boolean{
  const normalize=(s:string)=>s.normalize("NFKD").replace(/[\u0300-\u036f]/g,"")
    .toLowerCase().replace(/[^a-z0-9]+/g," ").trim().split(/\s+/).filter(Boolean);
  const wanted=normalize(query),actual=new Set(normalize(name+" "+brand));
  if(!wanted.length)return false;
  const nonNumeric=wanted.filter(w=>!/^\d+$/.test(w)&&w!=="mg"&&w!=="g"&&w!=="ml");
  if(!nonNumeric.length)return false;
  const matches=nonNumeric.filter(w=>actual.has(w)).length;
  const fraction=matches/nonNumeric.length;
  if(fraction < (nonNumeric.length===1?1:.7))return false;
  // Never confuse 60-capsule and 120-capsule variants, or 500/1000 mg strengths.
  const requested=packCountFromLabel(query),found=packCountFromLabel(name);
  if(requested&&found&&(requested.count!==found.count||requested.unit!==found.unit))return false;
  const strengths=(s:string)=>[...s.toLowerCase().matchAll(/\b\d+(?:[.,]\d+)?\s*(?:mg|mcg|µg|g|iu)\b/g)].map(m=>m[0].replace(/\s/g,"")).sort();
  const a=strengths(query),b=strengths(name);
  if(a.length&&b.length&&a.some(v=>!b.includes(v)))return false;
  return true;
}

const str=(v:unknown,max=160)=>typeof v==="string"?v.replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim().slice(0,max):"";
const safeImage=(value:unknown)=>{try{const u=new URL(str(value,2000));return u.protocol==="https:"&&!u.username&&!u.password?u.href:"";}catch{return "";}};
export function foodCatalogCandidates(products:Record<string,unknown>[],query:string):SupplementLookupMatch[]{
  const seen=new Set<string>();
  return products.flatMap((p)=>{
    const name=str(p.product_name||p.product_name_cs||p.product_name_en);
    const brand=str(p.brands).split(",")[0];
    const category=str(p.categories_tags?Array.isArray(p.categories_tags)?p.categories_tags.join(" "):p.categories_tags:p.categories,800);
    if(!name||!looksLikeSupplementCategory(category+" "+name)||!sameSupplementProduct(name,brand,query))return [];
    const code=str(p.code,20);
    const sourceUrl=/^\d{8,14}$/.test(code)?"https://world.openfoodfacts.org/product/"+code:"";
    if(!sourceUrl||seen.has(sourceUrl))return [];
    seen.add(sourceUrl);
    const amount=str(p.quantity,130);
    const pack=packCountFromLabel(name+" "+amount);
    return [{name,brand,amount,priceCzk:null,
      imageUrl:safeImage(p.image_front_url||p.image_url),sourceUrl,sourceLabel:"Open Food Facts",
      packServings:pack?.count??null,packUnit:pack?.unit??""}];
  }).slice(0,5);
}

/** Reject cosmetic products with the same ingredient name as a supplement. */
export function plausibleSupplementListing(name:string,category:string,description=""):boolean{
  const info=(name+" "+category).toLocaleLowerCase("cs");
  const ingestible=/\b(?:dietary|supplements?|capsules?|caps?|tablets?|softgels?|powder|drink|oral|gummies|sachets?)\b/i.test(info)
    ||/(?:kapsl|tablety|doplněk stravy|doplnky stravy|prášek k užití)/i.test(info);
  const topical=/\b(?:face|facial|skin|body|hair|lotion|serum|cream|topical|perfume|fragrance|shampoo|cleanser|skincare|deodorant|spray|wash|soap)\b/i.test(info)
    ||/(?:pleťov|pleť|krém|šamp[oó]n|sprchov|pokožk)/i.test(info);
  const cosmeticCategory=/^(?:Pleť|Tělo|Vlasy|Zuby|Holení|Vůně|Pomůcky)$/i.test(category.trim());
  if((topical||cosmeticCategory)&&!ingestible)return false;
  return looksLikeSupplementCategory(name+" "+description+" "+category)||ingestible;
}


/** A visibly unverified fallback for product links whose shop blocks robots.
 * The address only tells us the slug and seller, not pack size, price or dosage.
 */
export function supplementSuggestionFromUrl(input:string):SupplementLookupMatch|null{
  try{
    const url=new URL(input.trim());
    if(url.protocol!=="https:"||url.username||url.password||url.port)return null;
    const hostname=url.hostname.toLowerCase();
    if(!hostname.includes(".")||/^(?:localhost|127\.|10\.|192\.168\.)/.test(hostname)
      ||/\.(?:local|internal|test|invalid)$/.test(hostname))return null;
    const segments=url.pathname.split("/").filter(Boolean);
    let slug=decodeURIComponent(segments.at(-1)??"").replace(/\.(?:html?|php|aspx?)$/i,"");
    slug=slug.replace(/[_-]+/g," ").replace(/[^ \p{L}\p{N}]/gu," ").replace(/\s+/g," ").trim();
    if(slug.length<4||slug.length>160||!/[\p{L}]/u.test(slug))return null;
    const hostpart=hostname.replace(/^www\./,"").split(".")[0];
    const words=slug.split(" ");
    // Cosmetic formatting only; still not a verified brand or product identity.
    if(words.length>2&&words.slice(-2).join("").toLowerCase()===hostpart)
      words.splice(-2,2,hostpart);
    const name=words.map(w=>/^\d+$/.test(w)?w:w[0].toLocaleUpperCase("cs")+w.slice(1)).join(" ");
    return {name,brand:"",amount:"",priceCzk:null,imageUrl:"",sourceUrl:url.href,
      sourceLabel:"Návrh podle odkazu – neověřeno",packServings:null,packUnit:""};
  }catch{return null;}
}
