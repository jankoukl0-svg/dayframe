import { addDaysKey } from "./dayframe-calendar.ts";

export const PREVENTION_STORAGE_KEY = "dayframe-prevention-v1";
export const PREVENTION_SYNC_EVENT = "dayframe-prevention-sync";

export type PreventionCategory = "general" | "dental" | "vision" | "vaccination" | "screening" | "other";
export const PREVENTION_CATEGORIES: ReadonlyArray<{key:PreventionCategory;label:string}> = [
  {key:"general",label:"Praktický lékař"},
  {key:"dental",label:"Zubní péče"},
  {key:"vision",label:"Oční péče"},
  {key:"vaccination",label:"Očkování"},
  {key:"screening",label:"Vyšetření / screening"},
  {key:"other",label:"Ostatní"},
];
export type PreventionCompletion = {
  id:string;
  date:string; // Actual completion date
  scheduledFor:string; // Date that was due before completion
  note:string;
  recordedAt:string;
};
export type PreventionItem = {
  id:string;
  title:string;
  category:PreventionCategory;
  provider:string;
  dueDate:string|null;
  reminderDays:number;
  repeatMonths:number; // 0 = manual / one-off
  active:boolean;
  notes:string;
  history:PreventionCompletion[];
  createdAt:string;
  updatedAt:string;
};
export type PreventionStore = {version:1;items:PreventionItem[]};
export type PreventionDraft = Pick<PreventionItem,"title"|"category"|"provider"|"dueDate"|"reminderDays"|"repeatMonths"|"active"|"notes">;

export const PREVENTION_REMIND_DAYS=[0,1,3,7,14,30] as const;
export const PREVENTION_REPEAT_MONTHS=[0,3,6,12,24,36,60] as const;

export function emptyPreventionStore():PreventionStore{return {version:1,items:[]};}
export function validPreventionDate(value:unknown):value is string{
  if(typeof value!=="string"||! /^\d{4}-\d{2}-\d{2}$/.test(value))return false;
  const date=new Date(value+"T12:00:00");
  return !Number.isNaN(date.getTime())&&date.getFullYear()===Number(value.slice(0,4))
    &&date.getMonth()+1===Number(value.slice(5,7))&&date.getDate()===Number(value.slice(8,10));
}
const text=(value:unknown,max:number)=>typeof value==="string"&&value.length<=max;
const unique=(keys:string[])=>new Set(keys).size===keys.length;
export function validPreventionDraft(value:unknown):value is PreventionDraft{
  if(!value||typeof value!=="object"||Array.isArray(value))return false;
  const i=value as PreventionDraft;
  return text(i.title,120)&&i.title.trim().length>0
    &&PREVENTION_CATEGORIES.some(c=>c.key===i.category)
    &&text(i.provider,140)
    &&(i.dueDate===null||validPreventionDate(i.dueDate))
    &&PREVENTION_REMIND_DAYS.some(n=>n===i.reminderDays)
    &&PREVENTION_REPEAT_MONTHS.some(n=>n===i.repeatMonths)
    &&typeof i.active==="boolean"&&text(i.notes,1200);
}
export function validPreventionItem(value:unknown):value is PreventionItem{
  if(!validPreventionDraft(value))return false;
  const i=value as PreventionItem;
  return text(i.id,100)&&i.id.length>0
    &&text(i.createdAt,80)&&text(i.updatedAt,80)
    &&Array.isArray(i.history)
    &&unique(i.history.map(h=>h?.id))
    &&i.history.every(h=>h&&text(h.id,100)&&h.id.length>0
      &&validPreventionDate(h.date)&&validPreventionDate(h.scheduledFor)
      &&text(h.note,1200)&&text(h.recordedAt,80));
}
export function validPreventionStore(value:unknown):value is PreventionStore{
  if(!value||typeof value!=="object"||Array.isArray(value))return false;
  const s=value as PreventionStore;
  return s.version===1&&Array.isArray(s.items)
    &&unique(s.items.map(i=>i?.id))&&s.items.every(validPreventionItem);
}
export function parsePreventionStore(raw:string|null):{store:PreventionStore;blocked:boolean}{
  if(raw===null)return {store:emptyPreventionStore(),blocked:false};
  try{
    const value:unknown=JSON.parse(raw);
    return validPreventionStore(value)?{store:value,blocked:false}:{store:emptyPreventionStore(),blocked:true};
  }catch{return {store:emptyPreventionStore(),blocked:true};}
}
export function readPreventionStore():{store:PreventionStore;blocked:boolean}{
  if(typeof window==="undefined")return {store:emptyPreventionStore(),blocked:false};
  try{return parsePreventionStore(window.localStorage.getItem(PREVENTION_STORAGE_KEY));}
  catch{return {store:emptyPreventionStore(),blocked:true};}
}
export function savePreventionStore(store:PreventionStore):boolean{
  if(typeof window==="undefined"||!validPreventionStore(store))return false;
  try{
    window.localStorage.setItem(PREVENTION_STORAGE_KEY,JSON.stringify(store));
    window.dispatchEvent(new Event(PREVENTION_SYNC_EVENT));
    return true;
  }catch{return false;}
}
export function preventionCategoryLabel(category:PreventionCategory){
  return PREVENTION_CATEGORIES.find(c=>c.key===category)?.label??"Ostatní";
}
export function newPreventionDraft():PreventionDraft{
  return {title:"",category:"general",provider:"",dueDate:null,reminderDays:7,repeatMonths:0,active:true,notes:""};
}
/** Add calendar months clamped to the last valid day (e.g. Jan 31 -> Feb 28). */
export function addPreventionMonths(date:string,months:number):string|null{
  if(!validPreventionDate(date)||!Number.isInteger(months)||months<1||months>120)return null;
  const year=Number(date.slice(0,4)),month=Number(date.slice(5,7))-1,day=Number(date.slice(8,10));
  const target=new Date(year,month+months+1,0,12);
  if(Number.isNaN(target.getTime()))return null;
  target.setDate(Math.min(day,target.getDate()));
  const key=[target.getFullYear(),String(target.getMonth()+1).padStart(2,"0"),String(target.getDate()).padStart(2,"0")].join("-");
  return validPreventionDate(key)?key:null;
}
export function createPreventionItem(store:PreventionStore,draft:PreventionDraft):PreventionStore|null{
  if(!validPreventionDraft(draft))return null;
  const now=new Date().toISOString();
  const item:PreventionItem={...draft,title:draft.title.trim(),provider:draft.provider.trim(),
    id:"prevention-"+crypto.randomUUID(),notes:draft.notes.trim(),
    history:[],createdAt:now,updatedAt:now};
  return {...store,items:[...store.items,item]};
}
/** Rebase changed form fields onto the latest item to preserve history/completions from other tabs. */
export function updatePreventionItem(store:PreventionStore,id:string,draft:PreventionDraft,baseline:PreventionDraft):PreventionStore|null{
  if(!validPreventionDraft(draft)||!validPreventionDraft(baseline))return null;
  const latest=store.items.find(i=>i.id===id);
  if(!latest)return null;
  const patch={...latest};
  for(const key of ["title","category","provider","dueDate","reminderDays","repeatMonths","active","notes"] as const){
    if(draft[key]!==baseline[key]){
      // When another tab completed this appointment, never resurrect its obsolete due date.
      if(key==="dueDate"&&latest.dueDate!==baseline.dueDate)return null;
      (patch as unknown as Record<string,unknown>)[key]=draft[key];
    }
  }
  patch.title=patch.title.trim();
  patch.provider=patch.provider.trim();
  patch.notes=patch.notes.trim();
  patch.updatedAt=new Date().toISOString();
  if(!validPreventionItem(patch))return null;
  return {...store,items:store.items.map(i=>i.id===id?patch:i)};
}
export function completePrevention(store:PreventionStore,id:string,date:string,note=""):PreventionStore|null{
  if(!validPreventionDate(date)||!text(note,1200))return null;
  const item=store.items.find(i=>i.id===id);
  if(!item||!item.active||!item.dueDate||date>new Date().toLocaleDateString("sv-SE"))return null;
  // One entry per appointment; rapid double clicks cannot complete the next cycle ahead of time.
  if(item.history.some(h=>h.date===date))return null;
  const due=item.dueDate;
  const nextDate=item.repeatMonths?addPreventionMonths(date,item.repeatMonths):null;
  if(item.repeatMonths&&nextDate===null)return null;
  const completed:PreventionCompletion={
    id:"completed-"+crypto.randomUUID(),date,scheduledFor:due,note:note.trim(),recordedAt:new Date().toISOString()
  };
  const next:PreventionItem={...item,dueDate:nextDate,history:[...item.history,completed],updatedAt:completed.recordedAt};
  return {...store,items:store.items.map(i=>i.id===id?next:i)};
}
export type PreventionTodayRow={item:PreventionItem;status:"done"|"upcoming"|"today"|"overdue";date:string};
/** Shows reminders only for user-entered dates, plus completions recorded on this day. */
export function preventionTodayRows(store:PreventionStore,date:string):PreventionTodayRow[]{
  if(!validPreventionDate(date))return [];
  return store.items.filter(i=>i.active).flatMap<PreventionTodayRow>(item=>{
    if(item.history.some(h=>h.date===date))return [{item,status:"done" as const,date}];
    if(!item.dueDate)return [];
    if(date<addDaysKey(item.dueDate,-item.reminderDays))return [];
    const status:PreventionTodayRow["status"]=item.dueDate<date?"overdue":item.dueDate===date?"today":"upcoming";
    return [{item,status,date}];
  }).sort((a,b)=>(a.status==="done"?1:0)-(b.status==="done"?1:0)
    ||(a.item.dueDate??"9999").localeCompare(b.item.dueDate??"9999")
    ||a.item.title.localeCompare(b.item.title,"cs"));
}
export function preventionHistory(store:PreventionStore){
  return store.items.flatMap(item=>item.history.map(history=>({item,history})))
    .sort((a,b)=>b.history.date.localeCompare(a.history.date)||a.item.title.localeCompare(b.item.title,"cs"));
}
