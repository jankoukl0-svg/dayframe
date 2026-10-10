export const SUPPLEMENTS_STORAGE_KEY = "dayframe-supplements-v1";
export const SUPPLEMENTS_SYNC_EVENT = "dayframe-supplements-sync";

export type Supplement = {
  id: string;
  name: string;
  brand: string;
  doseLabel: string;       // Exactly what the user transcribed from the label or professional advice
  servingsPerIntake: number;
  units: string;           // e.g. capsule, serving; user controlled
  weekdays: number[];      // 0 (Sunday) ... 6 (Saturday)
  times: string[];         // Local HH:mm, one check-in per time
  active: boolean;
  stock: number | null;    // Number of servings remaining; null means not tracked
  lowStockAt: number;
  packServings: number;
  packPriceCzk: number | null;
  sourceUrl: string;
  notes: string;
  shopping: boolean;
};
export type SupplementIntake = {
  key: string;
  supplementId: string;
  date: string;
  time: string;
  status: "taken" | "skipped";
  recordedAt: string;
  servings: number;
};
export type SupplementPurchase = { id: string; supplementId: string; date: string; servings: number; paidCzk: number | null };
export type SupplementStore = {
  version: 1;
  supplements: Supplement[];
  intakes: SupplementIntake[];
  purchases: SupplementPurchase[];
};
export type SupplementOccurrence = {
  key: string; date: string; time: string; supplement: Supplement;
  intake: SupplementIntake | null;
};
const timeRx = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const dateRx = /^\d{4}-\d{2}-\d{2}$/;
const validDate = (s:string) => dateRx.test(s) && !Number.isNaN(Date.parse(s+"T12:00:00"))
  && new Date(s+"T12:00:00").getFullYear() === Number(s.slice(0,4))
  && new Date(s+"T12:00:00").getMonth()+1 === Number(s.slice(5,7))
  && new Date(s+"T12:00:00").getDate() === Number(s.slice(8,10));
const isStr = (v:unknown,lim=300) => typeof v==="string" && v.length<=lim;
const isNumber = (v:unknown,min:number,max:number) => typeof v==="number" && Number.isFinite(v) && v>=min && v<=max;
const isOptionalMoney=(v:unknown)=>v===null || isNumber(v,0,1000000);
const distinct = (arr:string[]) => new Set(arr).size === arr.length;
export function emptySupplementStore():SupplementStore {return {version:1,supplements:[],intakes:[],purchases:[]};}
export function supplementIntakeKey(id:string,date:string,time:string){return id+"|"+date+"|"+time;}
export function supplementDue(s:Supplement,date:string):boolean {
  return s.active && validDate(date) && s.weekdays.includes(new Date(date+"T12:00:00").getDay());
}
export function supplementOccurrences(store:SupplementStore,date:string):SupplementOccurrence[]{
  return store.supplements.filter(s=>supplementDue(s,date)).flatMap(s=>s.times.map(time=>{
    const key=supplementIntakeKey(s.id,date,time);
    return {key,date,time,supplement:s,intake:store.intakes.find(x=>x.key===key)??null};
  })).sort((a,b)=>a.time.localeCompare(b.time)||a.supplement.name.localeCompare(b.supplement.name,"cs"));
}
export function parseSupplementStore(raw:string|null):{store:SupplementStore;blocked:boolean}{
  if(raw===null)return {store:emptySupplementStore(),blocked:false};
  try{
    const s=JSON.parse(raw) as SupplementStore;
    if(!s||s.version!==1||!Array.isArray(s.supplements)||!Array.isArray(s.intakes)||!Array.isArray(s.purchases))throw Error("schema");
    if(!distinct(s.supplements.map(x=>x?.id))||!distinct(s.intakes.map(x=>x?.key))||!distinct(s.purchases.map(x=>x?.id)))throw Error("duplicate");
    for(const x of s.supplements){
      if(!x||!isStr(x.id,100)||!x.id||x.id.includes("|")||!isStr(x.name,160)||!x.name.trim()
        ||!isStr(x.brand,100)||!isStr(x.doseLabel,240)||!isStr(x.units,50)||!x.units.trim()
        ||!isNumber(x.servingsPerIntake,.01,10000)||!Array.isArray(x.weekdays)||!Array.isArray(x.times)
        ||!x.weekdays.every(n=>Number.isInteger(n)&&n>=0&&n<=6)||!distinct(x.weekdays.map(String))
        ||!x.times.every(t=>typeof t==="string"&&timeRx.test(t))||!distinct(x.times)
        ||!x.times.length||typeof x.active!=="boolean"||!(x.stock===null||isNumber(x.stock,0,1000000))
        ||!isNumber(x.lowStockAt,0,1000000)||!isNumber(x.packServings,.01,1000000)
        ||!isOptionalMoney(x.packPriceCzk)||!isStr(x.sourceUrl,700)||!isStr(x.notes,1500)
        ||typeof x.shopping!=="boolean")throw Error("supplement");
    }
    for(const x of s.intakes){
      if(!x||!isStr(x.key,300)||!isStr(x.supplementId,100)||!validDate(x.date)
        ||!timeRx.test(x.time)||x.key!==supplementIntakeKey(x.supplementId,x.date,x.time)
        ||!["taken","skipped"].includes(x.status)||!isStr(x.recordedAt,70)
        ||!isNumber(x.servings,.01,10000))throw Error("intake");
    }
    for(const x of s.purchases){
      if(!x||!isStr(x.id,100)||!isStr(x.supplementId,100)||!validDate(x.date)
        ||!isNumber(x.servings,.01,1000000)||!isOptionalMoney(x.paidCzk))throw Error("purchase");
    }
    return {store:s,blocked:false};
  }catch{return {store:emptySupplementStore(),blocked:true};}
}
export function readSupplementStore():{store:SupplementStore;blocked:boolean}{
  if(typeof window==="undefined")return {store:emptySupplementStore(),blocked:false};
  try{return parseSupplementStore(window.localStorage.getItem(SUPPLEMENTS_STORAGE_KEY));}
  catch{return {store:emptySupplementStore(),blocked:true};}
}
export function saveSupplementStore(s:SupplementStore):boolean {
  if(typeof window==="undefined")return false;
  // Reject invalid data before touching the saved original.
  if(parseSupplementStore(JSON.stringify(s)).blocked)return false;
  try{window.localStorage.setItem(SUPPLEMENTS_STORAGE_KEY,JSON.stringify(s));
    window.dispatchEvent(new Event(SUPPLEMENTS_SYNC_EVENT));return true;}
  catch{return false;}
}
export function newSupplement(name:string):Supplement {
  return {id:"supp-"+crypto.randomUUID(),name:name.trim(),brand:"",doseLabel:"",
    servingsPerIntake:1,units:"kapsle",weekdays:[0,1,2,3,4,5,6],times:["09:00"],
    active:true,stock:null,lowStockAt:7,packServings:30,packPriceCzk:null,sourceUrl:"",notes:"",shopping:false};
}
export function markSupplementIntake(store:SupplementStore,key:string,status:"taken"|"skipped"):SupplementStore {
  const [id,date,time,...extra]=key.split("|");
  if(extra.length || !validDate(date)||!timeRx.test(time))return store;
  const item=store.supplements.find(x=>x.id===id);
  if(!item)return store;
  // Only an explicitly scheduled occurrence, or its historical record, may be edited.
  const existing=store.intakes.find(x=>x.key===key);
  if(!existing && !(supplementDue(item,date) && item.times.includes(time)))return store;
  const isUndo=existing?.status===status;
  const nextStatus=isUndo?null:status;
  // Never silently invent stock on an undo when the original intake had
  // already exhausted the inventory. Ask for a manual correction instead.
  const available=item.stock===null?null:item.stock+(existing?.status==="taken"?existing.servings:0);
  if(nextStatus==="taken" && available!==null && available<item.servingsPerIntake)return store;
  let stock=item.stock;
  if(stock!==null){
    if(existing?.status==="taken") stock+=existing.servings;
    if(nextStatus==="taken") stock=stock-item.servingsPerIntake;
  }
  const updated={...store,
    supplements:store.supplements.map(x=>x.id===id?{...x,stock}:x),
    intakes:store.intakes.filter(x=>x.key!==key)};
  if(!nextStatus)return updated;
  return {...updated,intakes:[...updated.intakes,{key,supplementId:id,date,time,status:nextStatus,
    recordedAt:new Date().toISOString(),servings:item.servingsPerIntake}]};
}
export function buySupplement(store:SupplementStore,id:string,date:string):SupplementStore {
  const item=store.supplements.find(x=>x.id===id);
  if(!item||!validDate(date)||item.stock===null)return store;
  return {...store,supplements:store.supplements.map(x=>x.id===id?{...x,stock:x.stock!+x.packServings,shopping:false}:x),
    purchases:[...store.purchases,{id:"purchase-"+crypto.randomUUID(),supplementId:id,date,
      servings:item.packServings,paidCzk:item.packPriceCzk}]};
}
export function lowStockSupplements(s:SupplementStore){
  return s.supplements.filter(x=>x.shopping || (x.stock!==null&&x.stock<=x.lowStockAt))
    .sort((a,b)=>a.name.localeCompare(b.name,"cs"));
}
export function supplementStats(s:SupplementStore,from:string,to:string){
  const records=s.intakes.filter(x=>x.date>=from&&x.date<=to);
  const taken=records.filter(x=>x.status==="taken").length;
  const skipped=records.filter(x=>x.status==="skipped").length;
  let planned=0;
  for(let day=from;day<=to;){
    planned+=supplementOccurrences(s,day).length;
    const d=new Date(day+"T12:00:00");d.setDate(d.getDate()+1);
    day=d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
  }
  return {planned,taken,skipped};
}