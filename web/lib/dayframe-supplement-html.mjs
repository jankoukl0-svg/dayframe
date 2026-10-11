/**
 * Public product metadata extraction independent from other Vercel entrypoints.
 * Never infer a price, package, dose or image.
 */
const decode=(s)=>String(s??"").replace(/&#(?:x([0-9a-f]+)|([0-9]+));/gi,(_,h,d)=>{
  const n=h?parseInt(h,16):parseInt(d,10);return n>0&&n<=0x10ffff?String.fromCodePoint(n):"";
}).replace(/&(?:amp|quot|apos|lt|gt|nbsp);/gi,m=>({
  "&amp;":"&","&quot;":'"',"&apos;":"'","&lt;":"<","&gt;":">","&nbsp;":" "
})[m.toLowerCase()]??m);
const clean=(s,max=180)=>decode(typeof s==="string"?s:"").replace(/<[^>]*>/g," ")
  .replace(/\s+/g," ").trim().slice(0,max);
const attr=(tag,key)=>{
  const escaped=key.replace(/\W/g,"\\$&");
  const found=tag.match(new RegExp("\\b"+escaped+"\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s>]+))","i"));
  return decode(found?.[1]??found?.[2]??found?.[3]??"");
};
const meta=(html)=>{
  const output={};
  for(const tag of html.match(/<meta\b[^>]*>/gi)??[]){
    const key=(attr(tag,"property")||attr(tag,"name")).toLowerCase();
    if(key&&!output[key])output[key]=attr(tag,"content");
  }
  return output;
};
function jsonLdProduct(html){
  const visit=(x)=>{
    if(Array.isArray(x)){for(const item of x){const found=visit(item);if(found)return found;}return null;}
    if(!x||typeof x!=="object")return null;
    const types=Array.isArray(x["@type"])?x["@type"]:[x["@type"]];
    if(types.some(t=>typeof t==="string"&&/(^|[/:])Product$/i.test(t)))return x;
    return visit(x["@graph"])||visit(x.mainEntity);
  };
  for(const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){
    if(!/application\/ld\+json/i.test(m[1]))continue;
    try{const v=visit(JSON.parse(m[2]));if(v)return v;}catch{/* malformed LD */}
  }
  return null;
}
function safeImage(value,base){
  const v=Array.isArray(value)?value[0]:value;
  const raw=typeof v==="object"&&v?v.url:v;
  try{
    const u=new URL(clean(raw,2500),base);
    return u.protocol==="https:"&&!u.username&&!u.password&&!u.port?u.href:"";
  }catch{return "";}
}
function brandOf(value){
  if(Array.isArray(value))return brandOf(value[0]);
  return clean(value&&typeof value==="object"?value.name:value,100);
}
function priceOf(value){
  const offer=Array.isArray(value)?value[0]:value;
  if(!offer||typeof offer!=="object")return null;
  const currency=clean(offer.priceCurrency??offer.priceSpecification?.priceCurrency,10).toUpperCase();
  const price=Number(String(offer.price??offer.priceSpecification?.price??"").replace(",","."));
  return currency==="CZK"&&Number.isFinite(price)&&price>0&&price<1e6?price:null;
}
/** Returns product metadata from the actual page only, not health instructions. */
export function supplementFromHtml(html,url){
  let base;try{base=new URL(url);if(base.protocol!=="https:")return null;}catch{return null;}
  const ld=jsonLdProduct(html),m=meta(html);
  const rawTitle=clean(ld?.name||m["og:title"]||m["twitter:title"]||
    html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1],220);
  const name=rawTitle.replace(/^recenze\s*[-–:]\s*/i,"")
    .replace(/\s+[-|–]\s+(?:GymBeam(?:\.cz)?|[\w.-]+\.(?:cz|com|eu)|Recenze).*$/i,"").trim().slice(0,160);
  if(name.length<3)return null;
  const brand=brandOf(ld?.brand||m["product:brand"]||m.brand);
  const amount=clean(ld?.size||ld?.weight||m["product:quantity"],130);
  const description=clean(ld?.description||m["og:description"]||m.description,650);
  return {name,brand,amount,category:clean(ld?.category||m["product:category"],180),
    description,priceCzk:priceOf(ld?.offers),
    imageUrl:safeImage(ld?.image||m["og:image"]||m["twitter:image"],url),
    sourceUrl:url,sourceLabel:base.hostname};
}
