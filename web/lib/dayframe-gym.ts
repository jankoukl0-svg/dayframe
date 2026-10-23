export const GYM_STORAGE_KEY = "dayframe-gym-v1";
export const GYM_SYNC_EVENT = "dayframe-gym-sync";

export type GymExercise = { id: string; name: string; muscle: string; equipment: string; kind: string; technique: string; photoUrl?: string; custom?: boolean };
export type GymPlanExercise = { id: string; exerciseId: string; sets: number; reps: number; restSeconds: number };
export type GymPlanDay = { id: string; name: string; weekday: number; exercises: GymPlanExercise[]; templateDayId?:string; scheduleHistory?: Array<{effectiveFrom:string;weekday:number|null}>; timeHistory?:Array<{effectiveFrom:string;start:string|null;duration:number}> };
export type GymPlan = { id: string; name: string; days: GymPlanDay[]; createdOn?: string };
export type GymSet = { id: string; kind: "work" | "warmup"; reps: number | null; weightKg: number | null; rpe: number | null; rir: number | null; done: boolean; note: string };
export type GymSessionExercise = { id: string; exerciseId: string; name: string; sets: GymSet[]; note: string };
export type GymSession = { id: string; occurrenceKey: string; planId: string; dayId: string; date: string; title: string; startedAt: string; completedAt: string | null; restUntil: number | null; scheduledTime?:GymTime; exercises: GymSessionExercise[] };
export type GymOneOff = { id:string; planId:string; dayId:string; date:string; start:string; duration:number };
export type GymStore = { version: 1; exercises: GymExercise[]; plans: GymPlan[]; activePlanId: string | null; activations?: Array<{planId:string|null;effectiveFrom:string}>; sessions: GymSession[]; moves: Record<string, string>; occurrenceTimes?: Record<string,GymTime>; deletedOccurrences?:string[]; oneOffWorkouts?:GymOneOff[] };
export type GymOccurrence = { key: string; planId: string; dayId: string; name: string; date: string; originalDate: string; completed: boolean; session: GymSession | null };
export type GymTime = {start:string|null;duration:number};

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

  // Curated gym staples: chest, back, shoulders, arms, legs, glutes and core.
  ["dumbbell-bench-press","Tlaky s jednoručkami na rovné lavici","Hrudník","Jednoručky","Silový","Zpevni lopatky, tlač jednoručky kontrolovaně vzhůru a nenech ramena vytáčet."],
  ["incline-barbell-press","Bench press na šikmé lavici","Hrudník","Velká činka","Silový","Lavici nastav do mírného sklonu a spouštěj činku kontrolovaně k horní části hrudníku."],
  ["machine-chest-press","Chest press na stroji","Hrudník","Stroj","Silový","Nastav výšku sedadla a drž záda opřená po celou dráhu pohybu."],
  ["pec-deck","Pec deck (motýlek)","Hrudník","Stroj","Izolovaný","Nastav ramena přístroje tak, aby tah vycházel z hrudníku; pohyb nešvihej."],
  ["cable-chest-fly","Rozpažování na kladkách","Hrudník","Kladka","Izolovaný","Drž mírně pokrčené lokty a ruce přibližuj plynule před hrudníkem."],
  ["dumbbell-chest-fly","Rozpažování s jednoručkami","Hrudník","Jednoručky","Izolovaný","Lokty nech lehce pokrčené, váhu spouštěj pouze v pohodlném rozsahu."],
  ["smith-bench-press","Bench press na Smithově stroji","Hrudník","Smithův stroj","Silový","Lavici nastav podle pevné dráhy osy a udržuj stabilní polohu ramen."],
  ["push-up","Kliky","Hrudník","Vlastní váha","Silový","Zpevni trup, lokty veď šikmo dozadu a tělo drž v jedné linii."],
  ["chest-dip","Dipy na bradlech","Hrudník","Bradla","Silový","Ramena drž pod kontrolou; rozsah přizpůsob pohodlí a síle."],
  ["close-grip-bench","Bench press úzkým úchopem","Triceps","Velká činka","Silový","Udrž zápěstí nad předloktím a lokty pod kontrolou blízko trupu."],
  ["dumbbell-shoulder-press","Tlaky na ramena s jednoručkami","Ramena","Jednoručky","Silový","Zpevni trup a tlač vzhůru bez prohýbání beder."],
  ["arnold-press","Arnoldovy tlaky","Ramena","Jednoručky","Silový","Rotuj předloktí plynule a používej kontrolovaný rozsah pohybu."],
  ["machine-shoulder-press","Tlaky na ramena na stroji","Ramena","Stroj","Silový","Sedadlo uprav tak, aby úchopy začínaly přibližně na úrovni ramen."],
  ["cable-lateral-raise","Upažování na kladce","Ramena","Kladka","Izolovaný","Paži zvedej bez švihu a trup drž stabilně."],
  ["reverse-pec-deck","Obrácený pec deck","Ramena","Stroj","Izolovaný","Pohyb veď lokty do stran a nestahuj ramena k uším."],
  ["dumbbell-front-raise","Předpažování s jednoručkami","Ramena","Jednoručky","Izolovaný","Zvedej činky bez záklonu a kontroluj spouštění."],
  ["overhead-cable-triceps","Tricepsové extenze nad hlavou na kladce","Triceps","Kladka","Izolovaný","Lokty drž stabilně a protahuj paže bez prudkého propnutí."],
  ["skull-crusher","Francouzský tlak vleže (skull crusher)","Triceps","EZ osa","Izolovaný","Nadloktí nech stabilní a osu spouštěj kontrolovaně."],
  ["overhead-dumbbell-triceps","Tricepsové extenze s jednoručkou nad hlavou","Triceps","Jednoručky","Izolovaný","Drž lokty směrem vzhůru a nepřetěžuj bedra."],
  ["barbell-row","Přítahy velké činky v předklonu","Záda","Velká činka","Silový","Zpevni trup, udrž neutrální záda a veď osu směrem k břichu."],
  ["one-arm-dumbbell-row","Přítahy jednoručky v předklonu","Záda","Jednoručky","Silový","Opri se o lavici, rameno nepřetáčej a táhni loket k boku."],
  ["t-bar-row","T-bar row","Záda","T-bar stroj","Silový","Udrž stabilní trup a přitahuj rukojeti bez švihu."],
  ["chest-supported-row","Přítahy s oporou hrudníku","Záda","Stroj","Silový","Opři hrudník o podložku a táhni lokty dozadu."],
  ["machine-row","Přítahy na stroji","Záda","Stroj","Silový","Nastav sedadlo a při přítahu kontroluj pohyb lopatek."],
  ["assisted-pull-up","Shyby s dopomocí","Záda","Stroj","Silový","Nastav dopomoc a přitahuj se plynule bez kopání nohama."],
  ["chin-up","Shyby podhmatem","Záda","Hrazda","Silový","Drž stabilní lopatky a vyhni se švihu."],
  ["close-grip-lat-pulldown","Stahování horní kladky úzkým úchopem","Záda","Kladka","Silový","Táhni lokty k trupu bez výrazného záklonu."],
  ["straight-arm-pulldown","Stahování kladky s nataženými pažemi","Záda","Kladka","Izolovaný","Paže nech mírně pokrčené a pohyb veď ze zad, ne ze švihu."],
  ["face-pull","Face pull","Ramena","Kladka","Izolovaný","Táhni lano směrem k obličeji a lokty nech do stran."],
  ["back-extension","Hyperextenze zad","Záda","Lavice","Silový","Pohyb začni v kyčlích a neprohýbej se nad neutrální polohu."],
  ["dumbbell-shrug","Krčení ramen s jednoručkami","Trapézy","Jednoručky","Izolovaný","Ramena zvedej přímo nahoru, neotáčej je v kruhu."],
  ["hammer-curl","Kladivové bicepsové zdvihy","Biceps","Jednoručky","Izolovaný","Dlaně drž proti sobě a lokty stabilní u těla."],
  ["ez-bar-curl","Bicepsový zdvih s EZ osou","Biceps","EZ osa","Izolovaný","Nehoupej trupem a kontroluj negativní fázi."],
  ["preacher-curl","Bicepsový zdvih na Scottově lavici","Biceps","Scottova lavice","Izolovaný","Lokty nech opřené a nepropínej paže prudce."],
  ["incline-curl","Bicepsový zdvih na šikmé lavici","Biceps","Jednoručky","Izolovaný","Ramena nech opřená o lavici a nešvihej činkami."],
  ["cable-biceps-curl","Bicepsový zdvih na kladce","Biceps","Kladka","Izolovaný","Lokty stabilizuj u trupu a činku nebo lano spouštěj pomalu."],

  // Forearms, wrist strength and grip: available in the Pull exercise picker.
  ["wrist-curl-dumbbell","Ohýbání zápěstí s jednoručkami (wrist curl)","Předloktí","Jednoručky","Izolovaný","Opři předloktí o stehna dlaněmi vzhůru a ohýbej pouze zápěstí bez švihu."],
  ["reverse-wrist-curl-dumbbell","Zvedání zápěstí nadhmatem (reverse wrist curl)","Předloktí","Jednoručky","Izolovaný","Opři předloktí dlaněmi dolů a zvedej hřbet ruky kontrolovaně s lehkou zátěží."],
  ["wrist-curl-barbell","Ohýbání zápěstí s velkou činkou","Předloktí","Velká činka","Izolovaný","Předloktí stabilně opři a činku zvedej pohybem zápěstí, ne loktů."],
  ["behind-back-wrist-curl","Ohýbání zápěstí za zády","Předloktí","Velká činka","Izolovaný","Drž osu za tělem dlaněmi vzad a ohýbej zápěstí v pohodlném rozsahu bez houpání."],
  ["reverse-ez-curl","Obrácený bicepsový zdvih s EZ osou","Předloktí","EZ osa","Izolovaný","Použij nadhmat a lehčí váhu, lokty drž u trupu a pohyb veď bez švihu."],
  ["zottman-curl","Zottmanovy zdvihy","Předloktí","Jednoručky","Izolovaný","Zvedej jednoručky podhmatem, nahoře otoč dlaně dolů a pomalu spouštěj."],
  ["wrist-roller","Navíjení závaží na válec (wrist roller)","Předloktí","Válec na zápěstí","Izolovaný","Drž paže stabilně a závaží navíjej i spouštěj pomalu; jeden cyklus lze evidovat jako jedno opakování."],
  ["farmer-carry","Farmářská chůze (farmer's carry)","Úchop","Jednoručky","Silový","Drž těžké jednoručky u boků, jdi vzpřímeně bez houpání; trasu zapisuj do poznámky."],
  ["dead-hang","Vis na hrazdě (dead hang)","Úchop","Hrazda","Stabilizační","Vis s aktivními rameny bez rozhoupání; dobu visu zapisuj do poznámky."],
  ["plate-pinch","Držení kotoučů prsty (plate pinch)","Úchop","Kotouče","Izolovaný","Drž hladké kotouče sevřením prstů a palce, bez přetížení zápěstí; čas zapisuj do poznámky."],
  ["forearm-pronation-supination","Rotace předloktí s jednoručkou (pronace a supinace)","Předloktí","Jednoručka","Izolovaný","Opři loket i předloktí a lehkou zátěž pomalu otáčej dlaní nahoru a dolů bez bolesti."],
  ["hack-squat","Hacken dřep na stroji","Nohy","Stroj","Silový","Záda opři a kolena veď ve směru špiček chodidel."],
  ["front-squat","Přední dřep","Nohy","Velká činka","Silový","Lokty drž vysoko a trup zpevněný po celou dráhu pohybu."],
  ["goblet-squat","Goblet dřep","Nohy","Jednoručky","Silový","Závaží drž před hrudníkem a sestupuj s pevným trupem."],
  ["bulgarian-split-squat","Bulharský dřep","Nohy","Jednoručky","Silový","Zadní nohu opři o lavici a přední koleno drž stabilně."],
  ["walking-lunge","Chůze ve výpadech","Nohy","Jednoručky","Silový","Dělej kontrolované kroky a udrž rovnováhu nad přední nohou."],
  ["smith-squat","Dřepy na Smithově stroji","Nohy","Smithův stroj","Silový","Postav chodidla tak, aby odpovídala dráze osy, a zpevni trup."],
  ["leg-extension","Předkopávání na stroji","Nohy","Stroj","Izolovaný","Nastav kloub stroje k ose kolene a pohyb prováděj plynule."],
  ["seated-leg-curl","Zakopávání vsedě","Hamstringy","Stroj","Izolovaný","Nastav opěrky podle délky nohou a kontroluj návrat závaží."],
  ["hip-thrust","Hip thrust","Hýždě","Velká činka","Silový","Horní část zad opři o lavici a zvedej pánev bez přehnaného záklonu."],
  ["glute-bridge","Glute bridge","Hýždě","Vlastní váha","Silový","Zvedej pánev sevřením hýždí a žebra nech stažená."],
  ["hip-abduction","Roznožování na stroji (abdukce)","Hýždě","Stroj","Izolovaný","Pánev drž na sedadle a nohy odtlačuj bez švihu."],
  ["hip-adduction","Snožování na stroji (addukce)","Vnitřní stehna","Stroj","Izolovaný","Nastav pohodlný rozsah a nohy přibližuj kontrolovaně."],
  ["cable-kickback","Zakopávání nohy dozadu na kladce","Hýždě","Kladka","Izolovaný","Trup udrž stabilně a pohyb veď kyčlí bez prohýbání beder."],
  ["seated-calf-raise","Výpony na lýtka vsedě","Lýtka","Stroj","Izolovaný","Propni kotníky v kontrolovaném rozsahu a na chvíli zastav nahoře."],
  ["cable-crunch","Zkracovačky na kladce","Core","Kladka","Izolovaný","Zakulat horní část trupu pohybem břicha, netahej pouze pažemi."],
  ["hanging-leg-raise","Přednožování ve visu","Core","Hrazda","Silový","Zvedej nohy kontrolovaně a omez houpání těla."],
  ["hanging-knee-raise","Přitahování kolen ve visu","Core","Hrazda","Silový","Přitahuj kolena k trupu bez rozkmitání."],
  ["ab-wheel","Rollout s kolečkem","Core","Kolečko","Stabilizační","Zpevni břicho a pohybuj se jen do rozsahu, kde udržíš neutrální záda."],
  ["side-plank","Boční plank","Core","Vlastní váha","Stabilizační","Drž boky nad zemí a tělo v přímé linii."],
  ["cable-woodchop","Rotace trupu na kladce (woodchopper)","Core","Kladka","Stabilizační","Otáčej trup plynule, bez prudkého škubání pažemi."],
].map(([id,name,muscle,equipment,kind,technique]) => ({ id,name,muscle,equipment,kind,technique }));

/** Add missing built-in exercises to valid older stores without replacing any existing entry.
 * IDs are stable; user-defined exercises, plans and completed sessions are preserved.
 * Returns the original object when no catalog entry is missing.
 */
export function extendGymExerciseCatalog(store: GymStore): GymStore {
  const ids = new Set(store.exercises.map(ex => ex.id));
  const missing = EXERCISE_LIBRARY.filter(ex => !ids.has(ex.id));
  return missing.length ? {...store,exercises:[...store.exercises,...missing.map(ex=>({...ex}))]} : store;
}

export function emptyGymStore(): GymStore {
  return { version: 1, exercises: EXERCISE_LIBRARY.map(x=>({...x})), plans: [], activePlanId: null, activations: [],  sessions: [], moves: {}, occurrenceTimes: {}, deletedOccurrences: [], oneOffWorkouts: [] };
}
const str = (value: unknown, max=300) => typeof value === "string" && value.length <= max;
const num = (value: unknown, min: number, max: number) => typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
const nullable = (value: unknown,min:number,max:number) => value === null || num(value,min,max);
const gymTimeValid=(value:string|null)=>value===null || (
  typeof value==="string" && /^(?:0[0189]|1[0-9]|2[0-3]):(?:00|15|30|45)$/.test(value));
const gymDurationValid=(value:number)=>Number.isInteger(value)&&value>=30&&value<=180&&value%15===0;
const gymClockMinutes=(value:string)=>{const hour=Number(value.slice(0,2));return (hour<8?hour+24:hour)*60+Number(value.slice(3));};

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
      if(!p || !str(p.id,100) || !p.id || !str(p.name) || !p.name.trim() || (p.createdOn!==undefined && !dateValid(p.createdOn)) || !Array.isArray(p.days) || !distinct(p.days)) throw Error("plan");
      for(const d of p.days) {
        if(!d || !str(d.id,100) || !d.id || !str(d.name) || !num(d.weekday,0,6) || !Number.isInteger(d.weekday) || !Array.isArray(d.exercises) || !distinct(d.exercises) || (d.templateDayId!==undefined && (!str(d.templateDayId,100)||!p.days.some(x=>x.id===d.templateDayId&&!x.templateDayId)))
          || (d.scheduleHistory!==undefined && (!Array.isArray(d.scheduleHistory) || !distinct(d.scheduleHistory.map(x=>({id:x.effectiveFrom})))
            ||d.scheduleHistory.some(x=>!dateValid(x.effectiveFrom)||(x.weekday!==null&&(!num(x.weekday,0,6)||!Number.isInteger(x.weekday)))))
           || (d.timeHistory!==undefined && (!Array.isArray(d.timeHistory)
             || !distinct(d.timeHistory.map(x=>({id:x.effectiveFrom})))
             || d.timeHistory.some(x=>!x||!dateValid(x.effectiveFrom)||!gymTimeValid(x.start)
               ||!gymDurationValid(x.duration)|| (x.start!==null && gymClockMinutes(x.start)+x.duration>26*60)))))) throw Error("day");
        for(const e of d.exercises) if(!e || !str(e.id,100) || !str(e.exerciseId,100) || !num(e.sets,1,12) || !Number.isInteger(e.sets) || !num(e.reps,1,100) || !Number.isInteger(e.reps) || !num(e.restSeconds,0,1800)) throw Error("template");
      }
    }
    for(const s0 of s.sessions) {
      if(!s0 || !str(s0.id,100) || !str(s0.occurrenceKey,300) || !str(s0.planId,100) || !str(s0.dayId,100) || !str(s0.title)
        || !dateValid(s0.date) || !str(s0.startedAt,70) || (s0.completedAt!==null && !str(s0.completedAt,70))
        || (s0.restUntil!==null && !num(s0.restUntil,0,4e15))
        || (s0.scheduledTime!==undefined && (!s0.scheduledTime||!gymTimeValid(s0.scheduledTime.start)
            ||!gymDurationValid(s0.scheduledTime.duration)
            ||(s0.scheduledTime.start!==null&&gymClockMinutes(s0.scheduledTime.start)+s0.scheduledTime.duration>26*60)))
        || !Array.isArray(s0.exercises) || !distinct(s0.exercises)) throw Error("session");
      for(const ex of s0.exercises) {
        if(!ex || !str(ex.id,100) || !str(ex.exerciseId,100) || !str(ex.name) || !str(ex.note,1500) || !Array.isArray(ex.sets) || !distinct(ex.sets)) throw Error("logged exercise");
        for(const set of ex.sets) if(!set || !str(set.id,100) || !["work","warmup"].includes(set.kind) || !nullable(set.reps,0,1000)
          || !nullable(set.weightKg,0,2000) || !nullable(set.rpe,1,10) || !nullable(set.rir,0,10) || typeof set.done !== "boolean" || !str(set.note,1000)) throw Error("set");
      }
    }
    if(s.activePlanId && !s.plans.some(x=>x.id===s.activePlanId)) throw Error("active plan");
    // Date-specific, non-recurring workouts use templates from existing plans.
    // Older Gym stores have no oneOffWorkouts and remain fully compatible.
    if(s.oneOffWorkouts!==undefined){
      if(!Array.isArray(s.oneOffWorkouts) || s.oneOffWorkouts.length>20000
        || !distinct(s.oneOffWorkouts) || s.oneOffWorkouts.some(item=>
          !item || !str(item.id,100) || !item.id.startsWith("manual-")
          || !str(item.planId,100) || !str(item.dayId,100) || !dateValid(item.date)
          || !gymTimeValid(item.start) || item.start===null
          || !gymDurationValid(item.duration)
          || gymClockMinutes(item.start)+item.duration>26*60
          || !s.plans.some(p=>p.id===item.planId&&p.days.some(day=>day.id===item.dayId&&!day.templateDayId))
        ))throw Error("one-off workouts");
    }
    if(s.activations!==undefined && (!Array.isArray(s.activations)
      || !distinct(s.activations.map(x=>({id:x.effectiveFrom})))
      || s.activations.some(x=>!x||!dateValid(x.effectiveFrom)||!(x.planId===null || str(x.planId,100))))) throw Error("activations");
    for(const [key,date] of Object.entries(s.moves)) if(!str(key,300)||!dateValid(date)) throw Error("move");
    // Optional tombstones keep past single-occurrence removals stable without
    // mutating the recurring plan or its historical schedule revisions.
    if(s.deletedOccurrences!==undefined){
      if(!Array.isArray(s.deletedOccurrences)
        ||s.deletedOccurrences.length>20000
        ||new Set(s.deletedOccurrences).size!==s.deletedOccurrences.length
        ||s.deletedOccurrences.some(key=>typeof key!=="string"||key.length>300
          ||key.split("|").length!==3||!key.split("|")[0]||!key.split("|")[1]
          ||!dateValid(key.split("|")[2])))throw Error("deleted occurrences");
    }
    if(s.occurrenceTimes!==undefined){
      if(!s.occurrenceTimes||typeof s.occurrenceTimes!=="object"||Array.isArray(s.occurrenceTimes))throw Error("occurrence times");
      for(const [key,time] of Object.entries(s.occurrenceTimes)){
        if(!str(key,300)||!key || !time || !gymTimeValid(time.start) || time.start===null
          || !gymDurationValid(time.duration) || gymClockMinutes(time.start)+time.duration>26*60)throw Error("occurrence time");
      }
    }
    return {store:s,blocked:false};
  }catch{ return {store:emptyGymStore(),blocked:true}; }
}
export function readGymStore(): {store:GymStore;blocked:boolean} {
  if(typeof window==="undefined") return {store:emptyGymStore(),blocked:false};
  try{
    const value = parseGymStore(window.localStorage.getItem(GYM_STORAGE_KEY));
    // Valid older saved stores need the new catalog too. Never modify malformed data.
    return value.blocked ? value : {...value,store:extendGymExerciseCatalog(value.store)};
  }
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
export function activeGymPlanOnDate(store:GymStore,date:string):GymPlan|null {
  if(!dateValid(date))return null;
  const history=store.activations??[];
  const id=history.length
    ? history.filter(x=>x.effectiveFrom<=date).sort((a,b)=>b.effectiveFrom.localeCompare(a.effectiveFrom))[0]?.planId
    : store.activePlanId; // Backwards-compatible with unversioned preview fixtures.
  return store.plans.find(p=>p.id===id)??null;
}
export function setActiveGymPlan(store:GymStore,planId:string|null,date:string):GymStore {
  if(!dateValid(date) || (planId!==null && !store.plans.some(p=>p.id===planId && (!p.createdOn || p.createdOn<=date))))return store;
  const activations=(store.activations??[]).filter(x=>x.effectiveFrom<date);
  activations.push({planId,effectiveFrom:date});
  return {...store,activePlanId:planId,activations};
}
export function gymDayWeekdayOnDate(day:GymPlanDay,date:string):number|null {
  if(!dateValid(date))return null;
  if(!day.scheduleHistory?.length)return day.weekday; // Older unversioned plans.
  const revision=day.scheduleHistory.filter(x=>x.effectiveFrom<=date)
    .sort((a,b)=>b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
  return revision?.weekday??null;
}
/** No default start time: existing workout schedules remain valid and untimed. */
export function gymDayTimeOnDate(day:GymPlanDay,date:string):GymTime {
  if(!dateValid(date))return {start:null,duration:60};
  const revision=day.timeHistory?.filter(x=>x.effectiveFrom<=date)
    .sort((a,b)=>b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
  return revision?{start:revision.start,duration:revision.duration}:{start:null,duration:60};
}
export function gymOccurrenceTime(store:GymStore,occ:GymOccurrence):GymTime {
  // A started session is factual history even after deleting/editing its plan.
  if(occ.session?.scheduledTime)return occ.session.scheduledTime;
  const oneOff=store.oneOffWorkouts?.find(item=>item.id===occ.key);
  if(oneOff)return {start:oneOff.start,duration:oneOff.duration};
  const override=store.occurrenceTimes?.[occ.key];
  if(override)return override;
  const day=store.plans.find(p=>p.id===occ.planId)?.days.find(d=>d.id===occ.dayId);
  return day?gymDayTimeOnDate(day,occ.originalDate):{start:null,duration:60};
}
/** Time changes are future-effective and do not rewrite prior calendar dates. */
export function setGymWeekdayTime(store:GymStore,planId:string,weekdayValue:number,
  start:string|null,duration:number,today:string):GymStore {
  if(!dateValid(today)||!Number.isInteger(weekdayValue)||weekdayValue<0||weekdayValue>6
    ||!gymTimeValid(start)||!gymDurationValid(duration)
    ||(start!==null&&gymClockMinutes(start)+duration>26*60)
    ||activeGymPlanOnDate(store,today)?.id!==planId)return store;
  const plan=store.plans.find(p=>p.id===planId);
  const days=plan?.days.filter(d=>gymDayWeekdayOnDate(d,today)===weekdayValue)??[];
  if(days.length!==1)return store;
  const day=days[0], old=gymDayTimeOnDate(day,today);
  if(old.start===start&&old.duration===duration)return store;
  const revisions=(day.timeHistory??[]).filter(x=>x.effectiveFrom<today);
  return {...store,plans:store.plans.map(p=>p.id===planId?
    {...p,days:p.days.map(d=>d.id===day.id?
      {...d,timeHistory:[...revisions,{effectiveFrom:today,start,duration}]}:d)}:p)};
}
export function setGymDayWeekday(plan:GymPlan,dayId:string,weekdayValue:number,today:string):GymPlan {
  if(!dateValid(today) || !Number.isInteger(weekdayValue) || weekdayValue<0 || weekdayValue>6)return plan;
  return {...plan,days:plan.days.map(day=>{
    if(day.id!==dayId || day.weekday===weekdayValue)return day;
    // Weekday edits apply from the next day; today's earlier occurrences
    // and completed workout keys remain at their originally scheduled date.
    const effectiveFrom=dateShift(today,1);
    const original=day.scheduleHistory?.length ? day.scheduleHistory
      : [{effectiveFrom:plan.createdOn??today,weekday:day.weekday}];
    return {...day,weekday:weekdayValue,scheduleHistory:[
      ...original.filter(x=>x.effectiveFrom<effectiveFrom),
      {effectiveFrom,weekday:weekdayValue},
    ]};
  })};
}
/**
 * Update one recurring weekday without destroying past occurrences or sessions.
 * Repeated days reference one canonical workout template; logged sessions keep their own snapshots.
 * Disabled rows keep their identity and past sessions, while explicit date moves remain authoritative.
 */
export function setGymWeekdayAssignment(store:GymStore,planId:string,dayOfWeek:number,
  templateDayId:string|null,today:string):GymStore {
  if(!dateValid(today)||!Number.isInteger(dayOfWeek)||dayOfWeek<0||dayOfWeek>6)return store;
  const plan=store.plans.find(p=>p.id===planId);
  if(!plan||!plan.days.length||activeGymPlanOnDate(store,today)?.id!==planId)return store;
  const source=templateDayId===null?null:plan.days.find(d=>d.id===templateDayId);
  if(templateDayId!==null&&!source)return store;
  const current=plan.days.filter(d=>gymDayWeekdayOnDate(d,today)===dayOfWeek);
  // Repeat calls must not duplicate training slots.
  if(current.length===1&&source&&(current[0].templateDayId??current[0].id)===(source.templateDayId??source.id))return store;
  if(current.length===0&&!source)return store;
  const revision=(day:GymPlanDay,weekdayValue:number|null):GymPlanDay=>{
    const initial=day.scheduleHistory?.length?day.scheduleHistory:
      [{effectiveFrom:plan.createdOn??today,weekday:day.weekday}];
    const retained=initial.filter(x=>x.effectiveFrom<today);
    return {...day,scheduleHistory:[...retained,{effectiveFrom:today,weekday:weekdayValue}]};
  };
  const retainedTime=current.length===1?gymDayTimeOnDate(current[0],today):{start:null,duration:60};
  const updated=plan.days.map(day=>current.some(x=>x.id===day.id)?revision(day,null):day);
  if(source){
    updated.push({id:uid("day"),name:source.name,weekday:dayOfWeek,
      templateDayId:source.templateDayId??source.id,
      scheduleHistory:[{effectiveFrom:today,weekday:dayOfWeek}],
      timeHistory:[{effectiveFrom:today,...retainedTime}],exercises:[]});
  }
  return {...store,plans:store.plans.map(p=>p.id===planId?{...p,days:updated}:p)};
}

export function assignmentsOnDate(store:GymStore,date:string):GymOccurrence[] {
  if(!dateValid(date))return [];
  const result:GymOccurrence[]=[];
  const append=(plan:GymPlan,day:GymPlanDay,origin:string)=>{
    const key=occurrenceKey(plan.id,day.id,origin);
    if(store.deletedOccurrences?.includes(key))return;
    // A move was validated when saved. Subsequent changes to the recurring
    // weekday must not silently erase that one-off date assignment.
    const explicitMove=Object.prototype.hasOwnProperty.call(store.moves,key)&&store.moves[key]===date;
    if((plan.createdOn && origin<plan.createdOn) || (store.moves[key]??origin)!==date
      ||activeGymPlanOnDate(store,origin)?.id!==plan.id
      ||(!explicitMove&&gymDayWeekdayOnDate(day,origin)!==weekday(origin)))return;
    const session=store.sessions.find(s=>s.occurrenceKey===key)??null;
    if(result.some(x=>x.key===key))return;
    result.push({key,planId:plan.id,dayId:day.id,name:session?.title??(plan.days.find(x=>x.id===day.templateDayId)?.name??day.name),
      date,originalDate:origin,completed:!!session?.completedAt,session});
  };
  const todayPlan=activeGymPlanOnDate(store,date);
  if(todayPlan && (!todayPlan.createdOn || date>=todayPlan.createdOn))
    for(const d of todayPlan.days)if(gymDayWeekdayOnDate(d,date)===weekday(date))append(todayPlan,d,date);
  for(const [key,target] of Object.entries(store.moves)){
    if(target!==date)continue;
    const [planId,dayId,origin,...rest]=key.split("|");
    if(rest.length || !dateValid(origin))continue;
    const plan=store.plans.find(p=>p.id===planId), day=plan?.days.find(x=>x.id===dayId);
    if(plan&&day)append(plan,day,origin);
  }
  // A one-off is a real occurrence, independently dated and never repeated.
  // It can use the same template as other one-offs on this date.
  for(const item of store.oneOffWorkouts??[]){
    if(item.date!==date || store.deletedOccurrences?.includes(item.id))continue;
    const plan=store.plans.find(p=>p.id===item.planId);
    const day=plan?.days.find(d=>d.id===item.dayId);
    if(!plan||!day||result.some(x=>x.key===item.id))continue;
    const session=store.sessions.find(s=>s.occurrenceKey===item.id)??null;
    result.push({key:item.id,planId:item.planId,dayId:item.dayId,name:session?.title??day.name,
      date,originalDate:item.date,completed:!!session?.completedAt,session});
  }
  // Sessions are factual history even when the plan was later deactivated,
  // removed or assigned a new weekday. Never hide a recorded completion.
  for(const session of store.sessions.filter(s=>s.date===date
    &&!store.deletedOccurrences?.includes(s.occurrenceKey))){
    if(result.some(x=>x.key===session.occurrenceKey))continue;
    const originalDate=session.occurrenceKey.split("|")[2]??date;
    result.push({key:session.occurrenceKey,planId:session.planId,dayId:session.dayId,
      name:session.title,date,originalDate,completed:!!session.completedAt,session});
  }
  return result.sort((a,b)=>a.name.localeCompare(b.name,"cs")||a.key.localeCompare(b.key));
}
/** Delete exactly one scheduled/historical workout, including its logged sets and
 * progress contribution. The original recurring template remains untouched.
 * A tombstone prevents the removed past occurrence from being recreated.
 */
export function deleteGymOccurrence(store:GymStore,key:string,date:string):GymStore{
  if(!dateValid(date)||store.deletedOccurrences?.includes(key)
    ||!assignmentsOnDate(store,date).some(o=>o.key===key))return store;
  const oneOff=store.oneOffWorkouts?.find(item=>item.id===key);
  if(oneOff){
    return {...store,oneOffWorkouts:(store.oneOffWorkouts??[]).filter(item=>item.id!==key),
      sessions:store.sessions.filter(session=>session.occurrenceKey!==key)};
  }
  const moves={...store.moves};
  delete moves[key];
  const occurrenceTimes={...(store.occurrenceTimes??{})};
  delete occurrenceTimes[key];
  return {...store,
    sessions:store.sessions.filter(session=>session.occurrenceKey!==key),
    moves,occurrenceTimes,
    deletedOccurrences:[...(store.deletedOccurrences??[]),key],
  };
}
/** Add a single future workout without changing any recurring weekday. */
export function addGymOneOff(store:GymStore,planId:string,dayId:string,date:string,
  start:string,duration:number,id:string):GymStore {
  const plan=store.plans.find(p=>p.id===planId);
  const day=plan?.days.find(d=>d.id===dayId&&!d.templateDayId);
  if(!plan||!day||!dateValid(date)||(plan.createdOn!==undefined&&date<plan.createdOn)
    ||!gymTimeValid(start)||start===null||!gymDurationValid(duration)
    ||gymClockMinutes(start)+duration>26*60
    ||!str(id,100)||!id.startsWith("manual-")
    ||(store.oneOffWorkouts??[]).some(item=>item.id===id)
    ||store.sessions.some(session=>session.occurrenceKey===id))return store;
  return {...store,oneOffWorkouts:[...(store.oneOffWorkouts??[]),
    {id,planId,dayId,date,start,duration}]};
}
export function moveOccurrence(store:GymStore,key:string,target:string):GymStore {
  const [planId,dayId,origin,...rest]=key.split("|");
  const plan=store.plans.find(p=>p.id===planId);
  const day=plan?.days.find(x=>x.id===dayId);
  if(!dateValid(target)||!dateValid(origin)||rest.length||!plan||!day
    ||(plan.createdOn && (target<plan.createdOn || origin<plan.createdOn))
    ||activeGymPlanOnDate(store,origin)?.id!==planId
    ||!(gymDayWeekdayOnDate(day,origin)===weekday(origin)||Object.prototype.hasOwnProperty.call(store.moves,key))
    ||store.sessions.some(s=>s.occurrenceKey===key))return store;
  const moves={...store.moves};
  // Reverting to the original day must still retain a one-off booking if
  // that weekday was subsequently removed from the recurring plan.
  if(target===origin&&gymDayWeekdayOnDate(day,origin)===weekday(origin))delete moves[key];
  else moves[key]=target;
  return {...store,moves};
}
/**
 * Move a SINGLE unstarted workout in the Week calendar, preserving its
 * recurring template and all other weeks. A date move keeps the occurrence key,
 * and its new clock time is stored independently of weekday timeHistory.
 */
/**
 * Adjust the start/end of one scheduled Gym occurrence only. Recurring days use
 * the existing per-occurrence override; manual blocks retain their own record.
 * Sessions already started are factual history and stay immutable here.
 */
export function setGymOccurrenceTime(
  store:GymStore,key:string,date:string,start:string,duration:number,today:string,
):GymStore {
  if(!dateValid(date)||!dateValid(today)||date<today||!gymTimeValid(start)
    ||start===null||!gymDurationValid(duration)||gymClockMinutes(start)+duration>26*60)return store;
  const occurrence=assignmentsOnDate(store,date).find(item=>item.key===key);
  if(!occurrence||occurrence.session)return store;
  const previous=gymOccurrenceTime(store,occurrence);
  if(previous.start===start&&previous.duration===duration)return store;
  const manual=store.oneOffWorkouts?.find(item=>item.id===key);
  if(manual) {
    return {...store,oneOffWorkouts:(store.oneOffWorkouts??[]).map(item=>
      item.id===key?{...item,start,duration}:item)};
  }
  const day=store.plans.find(plan=>plan.id===occurrence.planId)
    ?.days.find(item=>item.id===occurrence.dayId);
  if(!day)return store;
  const expected=gymDayTimeOnDate(day,occurrence.originalDate);
  const occurrenceTimes={...(store.occurrenceTimes??{})};
  if(expected.start===start&&expected.duration===duration)delete occurrenceTimes[key];
  else occurrenceTimes[key]={start,duration};
  return {...store,occurrenceTimes};
}
/**
 * Atomic time/date/duration edit for one unstarted workout. Do not validate the
 * target date using the OLD duration: shortening and moving can be valid even
 * when the intermediate schedule would extend beyond 02:00.
 */
export function setGymOccurrenceSchedule(
  store:GymStore,key:string,fromDate:string,targetDate:string,start:string,duration:number,today:string,
):GymStore {
  if(!dateValid(today)||!dateValid(fromDate)||!dateValid(targetDate)
    ||fromDate<today||targetDate<today||!gymTimeValid(start)||start===null
    ||!gymDurationValid(duration)||gymClockMinutes(start)+duration>26*60)return store;
  const source=assignmentsOnDate(store,fromDate).find(item=>item.key===key);
  if(!source||source.session)return store;
  if(fromDate===targetDate)return setGymOccurrenceTime(store,key,fromDate,start,duration,today);
  const manual=store.oneOffWorkouts?.find(item=>item.id===key);
  if(manual){
    if(manual.date!==fromDate)return store;
    return {...store,oneOffWorkouts:(store.oneOffWorkouts??[]).map(item=>
      item.id===key?{...item,date:targetDate,start,duration}:item)};
  }
  const moved=moveOccurrence(store,key,targetDate);
  if(moved===store||!assignmentsOnDate(moved,targetDate).some(item=>item.key===key))return store;
  const day=store.plans.find(plan=>plan.id===source.planId)
    ?.days.find(item=>item.id===source.dayId);
  if(!day)return store;
  const template=gymDayTimeOnDate(day,source.originalDate);
  const occurrenceTimes={...(moved.occurrenceTimes??{})};
  if(template.start===start&&template.duration===duration)delete occurrenceTimes[key];
  else occurrenceTimes[key]={start,duration};
  return {...moved,occurrenceTimes};
}
export function rescheduleGymOccurrence(store:GymStore,key:string,fromDate:string,targetDate:string,start:string,today:string):GymStore {
  if(!dateValid(today)||!dateValid(fromDate)||!dateValid(targetDate)
    ||fromDate<today||targetDate<today||!gymTimeValid(start)||start===null)return store;
  const oneOff=store.oneOffWorkouts?.find(item=>item.id===key);
  if(oneOff){
    if(oneOff.date!==fromDate || store.sessions.some(s=>s.occurrenceKey===key)
      || gymClockMinutes(start)+oneOff.duration>26*60)return store;
    if(oneOff.date===targetDate && oneOff.start===start)return store;
    return {...store,oneOffWorkouts:(store.oneOffWorkouts??[]).map(item=>
      item.id===key?{...item,date:targetDate,start}:item)};
  }
  const occurrence=assignmentsOnDate(store,fromDate).find(item=>item.key===key);
  if(!occurrence||occurrence.session)return store;
  const time=gymOccurrenceTime(store,occurrence);
  if(!gymDurationValid(time.duration)||gymClockMinutes(start)+time.duration>26*60)return store;
  const moved=moveOccurrence(store,key,targetDate);
  if(moved===store||!assignmentsOnDate(moved,targetDate).some(item=>item.key===key))return store;
  const day=moved.plans.find(plan=>plan.id===occurrence.planId)?.days.find(item=>item.id===occurrence.dayId);
  const templateTime=day?gymDayTimeOnDate(day,occurrence.originalDate):null;
  const occurrenceTimes={...(moved.occurrenceTimes??{})};
  // Reverting to the template also removes the one-off time exception.
  if(templateTime?.start===start&&templateTime.duration===time.duration)delete occurrenceTimes[key];
  else occurrenceTimes[key]={start,duration:time.duration};
  return {...moved,occurrenceTimes};
}
export function uid(prefix:string) {return prefix+"-"+crypto.randomUUID();}
export function newSet(kind:GymSet["kind"]="work"):GymSet {return {id:uid("set"),kind,reps:null,weightKg:null,rpe:null,rir:null,done:false,note:""};}
export function startSession(store:GymStore,key:string,date:string,now=new Date().toISOString()):GymStore {
  const found=assignmentsOnDate(store,date).find(x=>x.key===key);
  if(!found || found.session)return store;
  const plan=store.plans.find(p=>p.id===found.planId);
  const day=plan?.days.find(x=>x.id===found.dayId);
  if(!plan||!day)return store;
  const template=day.templateDayId?plan.days.find(x=>x.id===day.templateDayId):day;
  if(!template)return store;
  const exercises=template.exercises.map(x=>({id:uid("log-ex"),exerciseId:x.exerciseId,
    name:store.exercises.find(e=>e.id===x.exerciseId)?.name??"Neznámý cvik",
    sets:Array.from({length:x.sets},()=>newSet()),note:""}));
  return {...store,sessions:[...store.sessions,{id:uid("session"),occurrenceKey:key,planId:found.planId,dayId:found.dayId,
    date,title:found.name,startedAt:now,completedAt:null,restUntil:null,
    scheduledTime:gymOccurrenceTime(store,found),exercises}]};
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
export function makeGymPlan(name:string,template:GymTemplate,createdOn?:string):GymPlan {
  const now=new Date();
  const localDay=createdOn??[now.getFullYear(),String(now.getMonth()+1).padStart(2,"0"),String(now.getDate()).padStart(2,"0")].join("-");
  if(!dateValid(localDay))throw Error("Neplatné datum vytvoření plánu.");
  const templates:Record<GymTemplate,Array<[string,number,string[]]>>={
    "ppl":[["Push",1,["bench-press","incline-dumbbell","overhead-press","lateral-raise","triceps-pushdown"]],["Pull",3,["pull-up","cable-row","biceps-curl"]],["Lower",5,["squat","romanian-deadlift","leg-curl","calf-raise"]]],
    "upper-lower":[["Upper",1,["bench-press","lat-pulldown","overhead-press","biceps-curl"]],["Lower",4,["squat","romanian-deadlift","leg-press","calf-raise"]]],
    "full-body":[["Full Body",1,["squat","bench-press","cable-row"]],["Full Body B",4,["romanian-deadlift","overhead-press","lat-pulldown"]]],
    "custom":[["Vlastní trénink",1,[]]]
  };
  return {id:uid("plan"),name:name.trim()||"Můj plán",createdOn:localDay,days:templates[template].map(([title,weekday,ids])=>({
    id:uid("day"),name:title,weekday,scheduleHistory:[{effectiveFrom:localDay,weekday}],exercises:ids.map(exerciseId=>({id:uid("plan-ex"),exerciseId,sets:3,reps:10,restSeconds:90}))
  }))};
}