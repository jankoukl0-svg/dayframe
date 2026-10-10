export const GYM_STORAGE_KEY = "dayframe-gym-v1";
export const GYM_SYNC_EVENT = "dayframe-gym-sync";

export type GymExercise = { id: string; name: string; muscle: string; equipment: string; kind: string; technique: string; photoUrl?: string; custom?: boolean };
export type GymPlanExercise = { id: string; exerciseId: string; sets: number; reps: number; restSeconds: number };
export type GymPlanDay = { id: string; name: string; weekday: number; exercises: GymPlanExercise[] };
export type GymPlan = { id: string; name: string; days: GymPlanDay[] };
export type GymSet = { id: string; kind: "work" | "warmup"; reps: number | null; weightKg: number | null; rpe: number | null; rir: number | null; done: boolean; note: string };
export type GymSessionExercise = { id: string; exerciseId: string; name: string; sets: GymSet[]; note: string };
export type GymSession = { id: string; occurrenceKey: string; planId: string; dayId: string; date: string; title: string; startedAt: string; completedAt: string | null; restUntil: number | null; exercises: GymSessionExercise[] };
export type GymStore = { version: 1; exercises: GymExercise[]; plans: GymPlan[]; activePlanId: string | null; sessions: GymSession[]; moves: Record<string, string> };
export type GymOccurrence = { key: string; planId: string; dayId: string; name: string; date: string; originalDate: string; completed: boolean; session: GymSession | null };

export const EXERCISE_LIBRARY: GymExercise[] = [
  ["bench-press","Bench press","Hrudník","Velká činka","Silový","Lopatky stáhni, chodidla zpevni a činku kontrolovaně spouštěj."],
  ["incline-dumbbell","Tlaky na šikmé lavici","Hrudník","Jednoručky","Silový","Lokty drž pod zápěstími a ramena nevytahuj k uším."],
  ["squat","Dřep s činkou","Nohy","Velká činka","Silový","Zpevni trup a drž stabilní pohybovou dráhu."],
  ["romanian-deadlift","Rumunský mrtvý tah","Hamstringy","Velká činka","Silový","Veď pohyb z kyčlí a činku drž blízko nohou."],
  ["deadlift","Mrtvý tah","Záda","Velká činka","Silový","Zpevni trup, pohyb začni nohama a nevytrhávej činku."],
  ["lat-pulldown","Stahování horní kladky","Záda","Kladka","Silový","Táhni lokty dolů bez výrazného záklonu."],
  ["pull-up","Shyby","Záda","Hrazda","Silový","Pohyb kontroluj bez švihu."],
  ["cable-row","Přítahy spodní kladky","Záda","Kladka","Silový","Trup nech stabilní, lokty veď dozadu."],
  ["overhead-press","Tlaky nad hlavou","Ramena","Velká činka","Silový","Zpevni trup a neprohýbej záda."],
  ["lateral-raise","Upažování","Ramena","Jednoručky","Izolovaný","Bez švihu a s kontrolou při spouštění."],
  ["biceps-curl","Bicepsový zdvih","Biceps","Jednoručky","Izolovaný","Lokty drž stabilní."],
  ["triceps-pushdown","Tricepsové stlačování","Triceps","Kladka","Izolovaný","Lokty u těla, pohyb bez švihu."],
  ["leg-press","Leg press","Nohy","Stroj","Silový","Pánev drž na opěrce a kolena nezamykej nárazově."],
  ["leg-curl","Zakopávání","Hamstringy","Stroj","Izolovaný","Opakování prováděj kontrolovaně."],
  ["calf-raise","Výpony na lýtka","Lýtka","Stroj","Izolovaný","Plynulý pohyb s krátkou pauzou nahoře."],
  ["plank","Plank","Core","Vlastní váha","Stabilizační","Udrž pevný trup a plynule dýchej."],
].map(([id,name,muscle,equipment,kind,technique]) => ({ id,name,muscle,equipment,kind,technique }));

export function emptyGymStore(): GymStore {
  return { version: 1, exercises: EXERCISE_LIBRARY.map(x=>({...x})), plans: [], activePlanId: null, sessions: [], moves: {} };
}
const str = (value: unknown, max=300) => typeof value === "string" && value.length <= max;
const num = (value: unknown, min: number, max: number) => typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
const nullable = (value: unknown,min:number,max:number) => value === null || num(value,min,max);
const distinct = (items: {id:string}[]) => new Set(items.map(x=>x.id)).size === items.length;
const dateValid = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d)
  && !Number.isNaN(new Date(d + "T12:00:00").getTime())
  && new Date(d + "T12:00:00").getFullYear() === Number(d.slice(0,4))
  && new Date(d + "T12:00:00").getMonth()+1 === Number(d.slice(5,7))
  && new Date(d + "T12:00:00").getDate() === Number(d.slice(8,10));
export function parseGymStore(raw: string | null): { store: GymStore; blocked: boolean } {
  if (raw === null) return {store:emptyGymStore(),blocked:false};
  try {
    const s = JSON.parse(raw) as GymStore;
    if(!s || s.version !== 1 || !Array.isArray(s.exercises) || !Array.isArray(s.plans)
      || !Array.isArray(s.sessions) || !s.moves || typeof s.moves !== "object" || Array.isArray(s.moves)
      || (s.activePlanId !== null && !str(s.activePlanId)) || !distinct(s.exercises) || !distinct(s.plans) || !distinct(s.sessions)) throw Error("store");
    for(const e of s.exercises) if(!e || !str(e.id,100) || !e.id || !str(e.name) || !e.name.trim() || !str(e.muscle) || !str(e.equipment)
      || !str(e.kind) || !str(e.technique,1500) || (e.photoUrl !== undefined && !str(e.photoUrl,600))) throw Error("exercise");
    for(const p of s.plans) {
      if(!p || !str(p.id,100) || !p.id || !str(p.name) || !p.name.trim() || !Array.isArray(p.days) || !distinct(p.days)) throw Error("plan");
      for(const d of p.days) {
        if(!d || !str(d.id,100) || !d.id || !str(d.name) || !num(d.weekday,0,6) || !Number.isInteger(d.weekday) || !Array.isArray(d.exercises) || !distinct(d.exercises)) throw Error("day");
        for(const e of d.exercises) if(!e || !str(e.id,100) || !str(e.exerciseId,100) || !num(e.sets,1,12) || !Number.isInteger(e.sets) || !num(e.reps,1,100) || !Number.isInteger(e.reps) || !num(e.restSeconds,0,1800)) throw Error("template");
      }
    }
    for(const s0 of s.sessions) {
      if(!s0 || !str(s0.id,100) || !str(s0.occurrenceKey,300) || !str(s0.planId,100) || !str(s0.dayId,100) || !str(s0.title)
        || !dateValid(s0.date) || !str(s0.startedAt,70) || (s0.completedAt!==null && !str(s0.completedAt,70))
        || (s0.restUntil!==null && !num(s0.restUntil,0,4e15)) || !Array.isArray(s0.exercises) || !distinct(s0.exercises)) throw Error("session");
      for(const ex of s0.exercises) {
        if(!ex || !str(ex.id,100) || !str(ex.exerciseId,100) || !str(ex.name) || !str(ex.note,1500) || !Array.isArray(ex.sets) || !distinct(ex.sets)) throw Error("logged exercise");
        for(const set of ex.sets) if(!set || !str(set.id,100) || !["work","warmup"].includes(set.kind) || !nullable(set.reps,0,1000)
          || !nullable(set.weightKg,0,2000) || !nullable(set.rpe,1,10) || !nullable(set.rir,0,10) || typeof set.done !== "boolean" || !str(set.note,1000)) throw Error("set");
      }
    }
    if(s.activePlanId && !s.plans.some(x=>x.id===s.activePlanId)) throw Error("active plan");
    for(const [key,date] of Object.entries(s.moves)) if(!str(key,300)||!dateValid(date)) throw Error("move");
    return {store:s,blocked:false};
  }catch{ return {store:emptyGymStore(),blocked:true}; }
}
export function readGymStore(): {store:GymStore;blocked:boolean} {
  if(typeof window==="undefined") return {store:emptyGymStore(),blocked:false};
  try{return parseGymStore(window.localStorage.getItem(GYM_STORAGE_KEY));}
  catch{return {store:emptyGymStore(),blocked:true};}
}
export function saveGymStore(store:GymStore) {
  if(typeof window==="undefined") return false;
  try{window.localStorage.setItem(GYM_STORAGE_KEY,JSON.stringify(store));window.dispatchEvent(new Event(GYM_SYNC_EVENT));return true;}
  catch{return false;}
}
export function dateShift(date:string, offset:number):string {
  const d = new Date(date+"T12:00:00");d.setDate(d.getDate()+offset);
  return [d.getFullYear(),String(d.getMonth()+1).padStart(2,"0"),String(d.getDate()).padStart(2,"0")].join("-");
}
export function weekday(date:string):number { return new Date(date+"T12:00:00").getDay(); }
export function occurrenceKey(planId:string,dayId:string,origin:string){return [planId,dayId,origin].join("|");}
export function assignmentsOnDate(store:GymStore,date:string):GymOccurrence[] {
  const plan=store.plans.find(p=>p.id===store.activePlanId);if(!plan || !dateValid(date))return [];
  const result:GymOccurrence[]=[];
  const append=(day:GymPlanDay,origin:string)=>{
    const key=occurrenceKey(plan.id,day.id,origin);
    if((store.moves[key]??origin)!==date)return;
    const session=store.sessions.find(s=>s.occurrenceKey===key)??null;
    result.push({key,planId:plan.id,dayId:day.id,name:day.name,date,originalDate:origin,completed:!!session?.completedAt,session});
  };
  for(const d of plan.days)if(d.weekday===weekday(date))append(d,date);
  for(const [key,target] of Object.entries(store.moves)){
    if(target!==date)continue;
    const [planId,dayId,origin,...rest]=key.split("|");
    if(rest.length || planId!==plan.id || !dateValid(origin) || origin===date)continue;
    const d=plan.days.find(x=>x.id===dayId);
    if(d && d.weekday===weekday(origin))append(d,origin);
  }
  return result.sort((a,b)=>a.name.localeCompare(b.name,"cs")||a.key.localeCompare(b.key));
}
export function moveOccurrence(store:GymStore,key:string,target:string):GymStore {
  const plan=store.plans.find(p=>p.id===store.activePlanId);
  const [planId,dayId,origin,...rest]=key.split("|");
  if(!dateValid(target)||!dateValid(origin)||rest.length||!plan||planId!==plan.id
    ||!plan.days.some(x=>x.id===dayId&&x.weekday===weekday(origin))
    ||store.sessions.some(s=>s.occurrenceKey===key))return store;
  const moves={...store.moves};if(target===origin)delete moves[key];else moves[key]=target;
  return {...store,moves};
}
export function uid(prefix:string) {return prefix+"-"+crypto.randomUUID();}
export function newSet(kind:GymSet["kind"]="work"):GymSet {return {id:uid("set"),kind,reps:null,weightKg:null,rpe:null,rir:null,done:false,note:""};}
export function startSession(store:GymStore,key:string,date:string,now=new Date().toISOString()):GymStore {
  const found=assignmentsOnDate(store,date).find(x=>x.key===key);
  if(!found || found.session)return store;
  const day=store.plans.find(p=>p.id===found.planId)?.days.find(x=>x.id===found.dayId);
  if(!day)return store;
  const exercises=day.exercises.map(x=>({id:uid("log-ex"),exerciseId:x.exerciseId,
    name:store.exercises.find(e=>e.id===x.exerciseId)?.name??"Neznámý cvik",
    sets:Array.from({length:x.sets},()=>newSet()),note:""}));
  return {...store,sessions:[...store.sessions,{id:uid("session"),occurrenceKey:key,planId:found.planId,dayId:found.dayId,
    date,title:found.name,startedAt:now,completedAt:null,restUntil:null,exercises}]};
}
export function lastExercisePerformance(store:GymStore,exerciseId:string,beforeDate:string,excludeId?:string):GymSet[] {
  for(const session of store.sessions.filter(s=>s.completedAt && s.date<=beforeDate && s.id!==excludeId)
    .sort((a,b)=>(b.completedAt??"").localeCompare(a.completedAt??""))) {
      const exercise=session.exercises.find(e=>e.exerciseId===exerciseId);
      if(exercise)return exercise.sets.filter(x=>x.done&&x.kind==="work");
  }
  return [];
}
export function gymMetrics(store:GymStore) {
  const byExercise=new Map<string,{weight:number;estimated1RM:number;reps:number;sets:number;volume:number}>();
  const workouts=store.sessions.filter(s=>!!s.completedAt).sort((a,b)=>a.date.localeCompare(b.date)).map(s=>{
    let volume=0,sets=0;
    for(const ex of s.exercises)for(const set of ex.sets)if(set.done&&set.kind==="work"&&set.weightKg!==null&&set.reps!==null) {
      const lifted=set.weightKg*set.reps;volume+=lifted;sets++;
      const val=byExercise.get(ex.exerciseId)??{weight:0,estimated1RM:0,reps:0,sets:0,volume:0};
      val.weight=Math.max(val.weight,set.weightKg);val.reps=Math.max(val.reps,set.reps);
      if(set.reps>=1&&set.reps<=12)val.estimated1RM=Math.max(val.estimated1RM,set.weightKg*(1+set.reps/30));
      val.sets++;val.volume+=lifted;byExercise.set(ex.exerciseId,val);
    }
    return {id:s.id,date:s.date,title:s.title,volume,sets};
  });
  return {workouts,byExercise,totalVolume:workouts.reduce((n,x)=>n+x.volume,0)};
}
export type GymTemplate="ppl"|"upper-lower"|"full-body"|"custom";
export function makeGymPlan(name:string,template:GymTemplate):GymPlan {
  const templates:Record<GymTemplate,Array<[string,number,string[]]>>={
    "ppl":[["Push",1,["bench-press","incline-dumbbell","overhead-press","triceps-pushdown"]],["Pull",3,["pull-up","cable-row","biceps-curl"]],["Legs",5,["squat","romanian-deadlift","leg-curl","calf-raise"]]],
    "upper-lower":[["Upper",1,["bench-press","lat-pulldown","overhead-press","biceps-curl"]],["Lower",4,["squat","romanian-deadlift","leg-press","calf-raise"]]],
    "full-body":[["Full Body",1,["squat","bench-press","cable-row"]],["Full Body B",4,["romanian-deadlift","overhead-press","lat-pulldown"]]],
    "custom":[["Vlastní trénink",1,[]]]
  };
  return {id:uid("plan"),name:name.trim()||"Můj plán",days:templates[template].map(([title,weekday,ids])=>({
    id:uid("day"),name:title,weekday,exercises:ids.map(exerciseId=>({id:uid("plan-ex"),exerciseId,sets:3,reps:10,restSeconds:90}))
  }))};
}