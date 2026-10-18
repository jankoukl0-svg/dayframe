"use client";
import { useEffect, useMemo, useState } from "react";
import { useGymStore } from "./use-gym-store";
import {GymExercisePicker} from "./gym-exercise-picker";
import {removeTravelBlocksWhere} from "@/lib/dayframe-travel";
import {
  assignmentsOnDate, dateShift, gymMetrics, gymDayWeekdayOnDate, gymDayTimeOnDate, setGymWeekdayAssignment, setGymWeekdayTime, lastExercisePerformance, weekday,
  makeGymPlan, newSet, startSession, uid, setActiveGymPlan,
  type GymExercise, type GymPlan, type GymPlanDay, type GymPlanExercise,
  type GymSession, type GymSessionExercise, type GymSet, type GymTemplate
} from "@/lib/dayframe-gym";

const WEEKDAYS = ["Neděle","Pondělí","Úterý","Středa","Čtvrtek","Pátek","Sobota"];
type GymView="workout"|"plans"|"progress";
const numberValue = (raw:string,min:number,max:number):number|null => raw.trim()===""?null:Math.max(min,Math.min(max,Number(raw)||0));
const pretty = (date:string)=>new Intl.DateTimeFormat("cs-CZ",{weekday:"short",day:"numeric",month:"numeric"}).format(new Date(date+"T12:00:00"));
const formatKg = (value:number)=>new Intl.NumberFormat("cs-CZ",{maximumFractionDigits:1}).format(value)+" kg";

export function GymPage({today,focusKey,focusDate,onFocusHandled}:{today:string;focusKey?:string|null;focusDate?:string|null;onFocusHandled?:()=>void}) {
  const {store,hydrated,blocked,error,persist}=useGymStore();
  const [view,setView]=useState<GymView>("workout");
  const [selectedDayId,setSelectedDayId]=useState<string|null>(null);
  const [selectedSession,setSelectedSession]=useState<string|null>(null);
  // A calendar shortcut targets an exact scheduled workout rather than the next one.
  const [focusedWorkout,setFocusedWorkout]=useState<{key:string;date:string}|null>(null);
  const [newPlanName,setNewPlanName]=useState("");
  const [template,setTemplate]=useState<GymTemplate>("upper-lower");
  const [newPlan,setNewPlan]=useState(false);
  const [editedPlanId,setEditedPlanId]=useState<string|null>(null);
  const [planNameDraft,setPlanNameDraft]=useState<{id:string;value:string}|null>(null);
  const [dayNameDrafts,setDayNameDrafts]=useState<Record<string,string>>({});
  const [newExercise,setNewExercise]=useState(false);
  const [exerciseDraft,setExerciseDraft]=useState({name:"",muscle:"",equipment:"",kind:"Silový",technique:"",photoUrl:""});
  const [restSeconds,setRestSeconds]=useState(90);
  const [clock,setClock]=useState(()=>Date.now());
  const [message,setMessage]=useState("");

  useEffect(()=>{
    if(!hydrated||!focusKey)return;
    setView("workout");
    const current=store.sessions.find(s=>s.occurrenceKey===focusKey);
    if(current){
      setSelectedSession(current.id);
      setFocusedWorkout(null);
    }else{
      const targetDate=focusDate||today;
      const occurrence=assignmentsOnDate(store,targetDate).find(o=>o.key===focusKey);
      if(occurrence){
        const day=store.plans.find(p=>p.id===occurrence.planId)?.days.find(d=>d.id===occurrence.dayId);
        setSelectedDayId(day?.templateDayId??day?.id??null);
        setFocusedWorkout({key:occurrence.key,date:occurrence.date});
        setSelectedSession(null);
      }
    }
    onFocusHandled?.();
  },[hydrated,focusKey,focusDate,today,store.sessions,store.plans,store.moves,store.activations,onFocusHandled]);
  const session=store.sessions.find(x=>x.id===selectedSession)??null;
  useEffect(()=>{if(!session?.restUntil || session.restUntil<=Date.now())return;
    const deadline=session.restUntil;
    const timer=window.setInterval(()=>{
      const now=Date.now();setClock(now);
      if(now>=deadline)window.clearInterval(timer);
    },1000);
    return ()=>window.clearInterval(timer);
  },[session?.restUntil]);
  const plan=store.plans.find(p=>p.id===(editedPlanId||store.activePlanId))??null;
  const metrics=useMemo(()=>gymMetrics(store),[store]);
  const activePlan=store.plans.find(p=>p.id===store.activePlanId)??null;
  // An older Week entry can belong to a plan which is no longer active.
  const focusedTarget=focusedWorkout
    ?assignmentsOnDate(store,focusedWorkout.date).find(o=>o.key===focusedWorkout.key)??null
    :null;
  const focusedPlan=store.plans.find(p=>p.id===focusedTarget?.planId)??null;
  const previewPlan=focusedPlan??activePlan;
  const activeDay=previewPlan?.days.find(d=>d.id===selectedDayId)??previewPlan?.days[0]??null;
  // The dashboard defaults to today but explicit Week links keep their exact target.
  const currentDates=useMemo(()=>Array.from({length:22},(_,i)=>dateShift(today,i)),[today]);
  const upcomingOccurrences=useMemo(()=>currentDates.flatMap(date=>assignmentsOnDate(store,date))
    .filter(o=>!o.completed).sort((a,b)=>a.date.localeCompare(b.date)),[currentDates,store]);
  const nearest=upcomingOccurrences[0]??null;
  const matchesActiveDay=(dayId:string)=>dayId===activeDay?.id
    ||previewPlan?.days.find(d=>d.id===dayId)?.templateDayId===activeDay?.id;
  const focusedOccurrence=focusedTarget&&matchesActiveDay(focusedTarget.dayId)?focusedTarget:null;
  const activeDayOccurrence=focusedOccurrence??upcomingOccurrences.find(o=>
    o.planId===previewPlan?.id&&matchesActiveDay(o.dayId))??null;
  const monday=dateShift(today,-((weekday(today)+6)%7));
  const weekDates=Array.from({length:7},(_,i)=>dateShift(monday,i));
  const completedWeek=metrics.workouts.filter(w=>w.date>=monday&&w.date<=weekDates[6]).length;
  const selectedWeekOccurrences=weekDates.flatMap(day=>assignmentsOnDate(store,day));
  // One reusable template per named workout: duplicates in the week are intentional.
  const gymTemplates=previewPlan?.days.filter(d=>!d.templateDayId)??[];
  const activeGymTemplates=activePlan?.days.filter(d=>!d.templateDayId)??[];
  // Template weekdays come from currently active recurrence revisions,
  // not the legacy weekday fallback used by the schedule-history model.
  const activeDayWeekdays=[...new Set((previewPlan?.days??[])
    .filter(d=>(d.templateDayId??d.id)===activeDay?.id)
    .map(d=>gymDayWeekdayOnDate(d,today))
    .filter((n):n is number=>n!==null))]
    .sort((a,b)=>(a+6)%7-(b+6)%7);
  const activeDayScheduleLabel=activeDayWeekdays.length
    ?activeDayWeekdays.map(d=>WEEKDAYS[d]).join(" · "):"Nenaplánováno";
  const scheduleLabels=["Neděle","Pondělí","Úterý","Středa","Čtvrtek","Pátek","Sobota"];
  const weekTotal=selectedWeekOccurrences.length;
  const weekDayShort=["Po","Út","St","Čt","Pá","So","Ne"];
  const exerciseName=(id:string)=>store.exercises.find(ex=>ex.id===id)?.name??"Neznámý cvik";
  const createQuickPpl=()=>{
    if(blocked||store.activePlanId)return;
    const created=makeGymPlan("Push / Pull / Lower","ppl",today);
    if(persist(s=>{
      if(s.activePlanId)return s;
      return setActiveGymPlan({...s,plans:[...s.plans,created]},created.id,today);
    })){setSelectedDayId(created.days[0]?.id??null);setEditedPlanId(null);setMessage("");}
  };
  const savePlan=(id:string,fn:(plan:GymPlan)=>GymPlan)=>persist(s=>({...s,plans:s.plans.map(p=>p.id===id?fn(p):p)}));
  const saveSession=(id:string,fn:(session:GymSession)=>GymSession)=>persist(s=>({...s,sessions:s.sessions.map(x=>{
    if(x.id!==id)return x;
    const updated=fn(x);
    const validDone=updated.exercises.some(ex=>ex.sets.some(set=>set.done && set.reps!==null && set.weightKg!==null));
    // Invalidate a completed workout as soon as its final valid done set
    // is unchecked, edited to empty, removed, or replaced.
    return updated.completedAt && !validDone ? {...updated,completedAt:null,restUntil:null} : updated;
  })}));
  const changeSet=(exId:string,setId:string,patch:Partial<GymSet>)=>{
    if(!session)return;
    saveSession(session.id,s=>({...s,exercises:s.exercises.map(ex=>ex.id!==exId?ex:{
      ...ex,sets:ex.sets.map(set=>set.id===setId?{
        ...set,...patch,
        done: ((patch.reps===null || patch.weightKg===null) ? false : (patch.done??set.done)),
      }:set)
    })}));
  };
  const changeSessionExercise=(exId:string,fn:(e:GymSessionExercise)=>GymSessionExercise)=>{
    if(!session)return;
    saveSession(session.id,s=>({...s,exercises:s.exercises.map(ex=>ex.id===exId?fn(ex):ex)}));
  };
  const showSession=(key:string,date:string)=>{
    const occurrence=assignmentsOnDate(store,date).find(x=>x.key===key);
    if(!occurrence)return;
    if(occurrence.session){setSelectedSession(occurrence.session.id);setMessage("");return;}
    if(blocked)return;
    const ok=persist(s=>startSession(s,key,date));
    if(ok){const result=readLater();const newly=result.sessions.find(s=>s.occurrenceKey===key);
      if(newly)setSelectedSession(newly.id);}
  };
  const readLater=()=>{ // Latest snapshot after a synchronous persistent update.
    const raw=window.localStorage.getItem("dayframe-gym-v1");
    try { return JSON.parse(raw||"{}") as typeof store; } catch { return store; }
  };
  const markSet=(ex:GymSessionExercise,set:GymSet)=>{
    if(set.done){changeSet(ex.id,set.id,{done:false});return;}
    if(set.reps===null || set.weightKg===null){setMessage("Před dokončením série vyplň opakování a váhu (u cviků s vlastní vahou může být 0 kg).");return;}
    if(!session)return;
    const sessionPlan=store.plans.find(p=>p.id===session.planId);
    const assignedDay=sessionPlan?.days.find(d=>d.id===session.dayId);
    const sourceDay=assignedDay?.templateDayId?sessionPlan?.days.find(d=>d.id===assignedDay.templateDayId):assignedDay;
    const rest=sourceDay?.exercises.find(e=>e.exerciseId===ex.exerciseId)?.restSeconds??90;
    saveSession(session.id,s=>({...s,restUntil:rest?Date.now()+rest*1000:null,
      exercises:s.exercises.map(item=>item.id!==ex.id?item:{...item,sets:item.sets.map(x=>x.id===set.id?{...x,done:true}:x)})}));
    setMessage("");
  };
  const doneSession=()=>{
    if(!session)return;
    if(!session.completedAt && !session.exercises.some(e=>e.sets.some(x=>x.done))){setMessage("Nejdřív dokonči alespoň jednu sérii.");return;}
    saveSession(session.id,s=>({...s,completedAt:s.completedAt?null:new Date().toISOString(),restUntil:null}));
    setMessage("");
  };
  const submitPlan=()=>{
    if(!newPlanName.trim()){setMessage("Zadej název plánu.");return;}
    const next=makeGymPlan(newPlanName.trim(),template,today);
    if(persist(s=>{
      const created={...s,plans:[...s.plans,next]};
      return s.activePlanId?created:setActiveGymPlan(created,next.id,today);
    })){setEditedPlanId(next.id);setView("plans");setNewPlan(false);setNewPlanName("");setMessage("");}
  };
  const addExercise=()=>{
    if(!exerciseDraft.name.trim()){setMessage("Zadej název cviku.");return;}
    const item:GymExercise={id:uid("exercise"),name:exerciseDraft.name.trim(),muscle:exerciseDraft.muscle.trim()||"Ostatní",
      equipment:exerciseDraft.equipment.trim()||"Jiné",kind:exerciseDraft.kind,technique:exerciseDraft.technique.trim(),
      photoUrl:exerciseDraft.photoUrl.trim()||undefined,custom:true};
    if(persist(s=>({...s,exercises:[...s.exercises,item]}))){
      setNewExercise(false);setExerciseDraft({name:"",muscle:"",equipment:"",kind:"Silový",technique:"",photoUrl:""});setMessage("");
    }
  };
  const restRemaining=session?.restUntil?Math.max(0,Math.ceil((session.restUntil-clock)/1000)):0;
  const history=store.sessions.slice().sort((a,b)=>b.startedAt.localeCompare(a.startedAt));
  const totalSets=session?.exercises.reduce((sum,ex)=>sum+ex.sets.length,0)??0;
  const doneSets=session?.exercises.reduce((sum,ex)=>sum+ex.sets.filter(set=>set.done).length,0)??0;

  if(!hydrated)return <div className="df2-gym-loading">Načítám tréninkový deník…</div>;
  return <div className="df2-gym" data-gym-root>
    <header className="df2-gym-heading"><div><h2>Gym & Tréninky</h2></div>
      <button type="button" disabled={blocked} className="df2-gym-new-plan" onClick={()=>{setNewPlan(true);setMessage("");}}>+ Tréninkový plán</button>
    </header>
    <nav className="df2-gym-nav" aria-label="Gym navigace">
      {([["workout","Tréninky"],["plans","Plány"],["progress","Progres"]] as const).map(([key,label])=>
        <button type="button" aria-current={view===key?"page":undefined} key={key} onClick={()=>{setView(key);setMessage("");}}>{label}</button>)}
    </nav>
    {(blocked||error||message) && <p role="alert" className="df2-hygiene-error">{blocked?"Uložený tréninkový deník nelze bezpečně načíst. Změny jsou zablokované.":error||message}</p>}

    {view==="workout" && <div className="df2-gym-panel">
      {session ? <section className="df2-gym-session" aria-label="Tréninkový deník">
        <header className="df2-gym-section-head df2-gym-session-heading">
          <div><span>{pretty(session.date)} · {session.completedAt?"Dokončeno":"Tréninkový deník"}</span>
            <h3>{session.title}</h3><small>{doneSets} z {totalSets} sérií hotovo</small></div>
          <button type="button" onClick={()=>setSelectedSession(null)}>← Zpět na plán</button>
        </header>
        <div className="df2-gym-session-progress" role="progressbar" aria-label="Dokončené série" aria-valuemin={0}
          aria-valuemax={totalSets} aria-valuenow={doneSets}>
          <span style={{width:(totalSets?doneSets/totalSets*100:0)+"%"}}/>
        </div>
        <div className="df2-gym-rest" role="timer" aria-label="Přestávka mezi sériemi">
          <div><small>Odpočinek mezi sériemi</small><strong>{String(Math.floor(restRemaining/60)).padStart(2,"0")}:{String(restRemaining%60).padStart(2,"0")}</strong></div>
          <details className="df2-gym-rest-settings"><summary>Nastavit odpočinek</summary>
            <div className="df2-gym-rest-buttons">{[60,90,120,180].map(n=><button type="button" key={n} onClick={()=>
              saveSession(session.id,s=>({...s,restUntil:Date.now()+n*1000}))}>{n}s</button>)}
              <input type="number" aria-label="Vlastní přestávka v sekundách" min="10" max="1800" value={restSeconds}
                onChange={e=>setRestSeconds(Math.max(10,Math.min(1800,Number(e.target.value)||10)))}/>
              <button type="button" onClick={()=>saveSession(session.id,s=>({...s,restUntil:Date.now()+restSeconds*1000}))}>Spustit</button>
              <button type="button" onClick={()=>saveSession(session.id,s=>({...s,restUntil:null}))}>Zrušit</button>
            </div>
          </details>
        </div>
        {session.exercises.map((ex,exIndex)=>{
          const previous=lastExercisePerformance(store,ex.exerciseId,session.date,session.id);
          return <section className="df2-gym-log-exercise" data-gym-log-exercise={ex.exerciseId} key={ex.id}>
            <header><div><small>CVIK {exIndex+1}</small><h4>{ex.name}</h4>
              <p>{previous.length?"Minule: "+previous.map(x=>x.weightKg+" kg × "+x.reps).join(" · "):"Zatím bez historických výkonů"}</p></div>
              <div className="df2-gym-inline">
                <GymExercisePicker exercises={store.exercises} label={"Vyměnit cvik "+ex.name}
                  dayName={session.title} placement="down" disabled={blocked} onSelect={next=>{
                    if(next.id===ex.exerciseId)return true;
                    return saveSession(session.id,s=>({...s,exercises:s.exercises.map(x=>x.id===ex.id?
                      {...x,exerciseId:next.id,name:next.name,note:"",
                        sets:x.sets.map(set=>({...set,weightKg:null,reps:null,rpe:null,rir:null,done:false,note:""}))}:x)}));
                  }}/>
                <button type="button" aria-label={"Posunout "+ex.name+" nahoru"} disabled={!exIndex} onClick={()=>
                  saveSession(session.id,s=>{const list=[...s.exercises];[list[exIndex-1],list[exIndex]]=[list[exIndex],list[exIndex-1]];return {...s,exercises:list};})}>↑</button>
                <button type="button" aria-label={"Posunout "+ex.name+" dolů"} disabled={exIndex===session.exercises.length-1} onClick={()=>
                  saveSession(session.id,s=>{const list=[...s.exercises];[list[exIndex+1],list[exIndex]]=[list[exIndex],list[exIndex+1]];return {...s,exercises:list};})}>↓</button>
                <button type="button" onClick={()=>saveSession(session.id,s=>({...s,exercises:s.exercises.filter(item=>item.id!==ex.id)}))}>Odebrat</button>
              </div></header>
            <div className="df2-gym-set-table">
              <div className="df2-gym-set-labels"><span>Série</span><span>Váha (kg)</span><span>Opakování</span><span>Hotovo</span></div>
              {ex.sets.map((set,index)=><div className={"df2-gym-set "+(set.done?"done":"")} key={set.id} data-gym-set>
                <button type="button" title="Změnit typ série" onClick={()=>changeSet(ex.id,set.id,{kind:set.kind==="work"?"warmup":"work"})}>{set.kind==="warmup"?"W":"#"+(index+1)}</button>
                {([["weightKg","Váha v kg",2000,.5],["reps","Opakování",1000,1]] as const).map(([field,label,max,step])=>
                  <input key={field} aria-label={label+" série "+(index+1)+" cviku "+ex.name} type="number" min="0" max={max} step={step}
                    value={set[field]??""} placeholder="—" onChange={e=>changeSet(ex.id,set.id,{[field]:numberValue(e.target.value,0,max)})}/>)}
                <button type="button" className="df2-gym-set-done" aria-label={"Dokončit sérii "+(index+1)+" cviku "+ex.name}
                  aria-pressed={set.done} onClick={()=>markSet(ex,set)}>{set.done?"✓":"○"}</button>
                <details className="df2-gym-set-extras"><summary>Další možnosti série {index+1}</summary>
                  <div className="df2-gym-set-extra-fields">
                    {([["rpe","RPE"],["rir","RIR"]] as const).map(([field,label])=>
                      <label key={field}>{label}<input aria-label={label+" série "+(index+1)+" cviku "+ex.name}
                        type="number" min={field==="rpe"?1:0} max={10} step=".5" value={set[field]??""}
                        onChange={e=>changeSet(ex.id,set.id,{[field]:numberValue(e.target.value,field==="rpe"?1:0,10)})}/></label>)}
                    <input className="df2-gym-set-note" aria-label={"Poznámka série "+(index+1)+" cviku "+ex.name}
                      placeholder="Poznámka k sérii" value={set.note}
                      onChange={e=>changeSet(ex.id,set.id,{note:e.target.value.slice(0,1000)})}/>
                    <button type="button" className="df2-gym-delete-set" aria-label={"Smazat sérii "+(index+1)+" cviku "+ex.name}
                      onClick={()=>changeSessionExercise(ex.id,e=>({...e,sets:e.sets.filter(item=>item.id!==set.id)}))}>Smazat sérii</button>
                  </div>
                </details>
              </div>)}
            </div>
            <div className="df2-gym-inline">
              <button type="button" onClick={()=>changeSessionExercise(ex.id,e=>({...e,sets:[...e.sets,newSet()]}))}>+ Série</button>
              <button type="button" onClick={()=>changeSessionExercise(ex.id,e=>({...e,sets:[...e.sets,newSet("warmup")]}))}>+ Zahřívací</button>
            </div>
            <textarea aria-label={"Poznámky cviku "+ex.name} rows={2} placeholder="Poznámky k cviku"
              value={ex.note} onChange={e=>changeSessionExercise(ex.id,item=>({...item,note:e.target.value.slice(0,1500)}))}/>
          </section>;
        })}
        <div className="df2-gym-inline">
          <GymExercisePicker exercises={store.exercises} label="Přidat cvik během tréninku"
            dayName={session.title} disabled={blocked} onSelect={exercise=>
              saveSession(session.id,s=>({...s,exercises:[...s.exercises,
                {id:uid("log-ex"),exerciseId:exercise.id,name:exercise.name,sets:[newSet(),newSet(),newSet()],note:""}]}))
            }/>
          <button className="df2-primary" type="button" onClick={doneSession}>{session.completedAt?"Znovu otevřít trénink":"Dokončit trénink"}</button>
        </div>
      </section> : <>
        <div className="df2-gym-summary" data-gym-summary>
          <div><small>Aktivní plán</small><strong>{activePlan?.name??"Nenastaveno"}</strong></div>
          <div><small>Tento týden</small><strong>{completedWeek} / {weekTotal} tréninků</strong>
            <progress aria-label="Splnění týdenního plánu" value={Math.min(completedWeek,weekTotal)} max={Math.max(1,weekTotal)}/></div>
          <div><small>Nejbližší termín</small><strong>{nearest?nearest.name+" · "+pretty(nearest.date):"Zatím neplánováno"}</strong></div>
        </div>
        {!previewPlan ? <section className="df2-gym-welcome" data-gym-setup>
          <div><h3>Tvůj split: Push / Pull / Lower</h3>
            <div className="df2-gym-welcome-split">
              <span><strong>Push</strong><small>Hrudník · ramena · triceps</small></span>
              <span><strong>Pull</strong><small>Záda · biceps</small></span>
              <span><strong>Lower</strong><small>Nohy · core</small></span>
            </div>
          </div>
          <button type="button" className="df2-accent-button" disabled={blocked} onClick={createQuickPpl}>Použít split Push / Pull / Lower →</button>
        </section> : <>
          <section className="df2-gym-split" data-gym-split>
            <div className="df2-gym-focus-head"><div><span>TVŮJ TRÉNINK</span><h3>Vyber trénink</h3></div>
              <div className="df2-gym-inline">
                {focusedPlan&&focusedPlan.id!==activePlan?.id&&<button type="button"
                  onClick={()=>{setFocusedWorkout(null);setSelectedDayId(null);}}>
                  ← Aktivní plán
                </button>}
                <button type="button" onClick={()=>{setEditedPlanId(previewPlan.id);setView("plans");}}>Upravit plán</button>
              </div>
            </div>
            <div className="df2-gym-split-days" role="group" aria-label="Výběr tréninku">
              {gymTemplates.map(day=><button key={day.id} type="button" data-gym-day={day.name}
                aria-pressed={activeDay?.id===day.id} onClick={()=>{
                  setSelectedDayId(day.id);
                  if(previewPlan?.id===activePlan?.id)setFocusedWorkout(null);
                }}>
                <strong>{day.name}</strong><small>{day.exercises.length} cviků</small>
              </button>)}
            </div>
            {activeDay&&<section className="df2-gym-workout-preview" data-gym-workout-preview>
              <div className="df2-gym-workout-top">
                <div><span>VYBRANÝ TRÉNINK</span><h3>{activeDay.name}</h3>
                  <small>{focusedPlan&&focusedPlan.id!==activePlan?.id?focusedPlan.name+" · původní plán · ":""}{activeDayScheduleLabel} · {activeDay.exercises.length} cviků
                    {activeDayOccurrence?" · další "+pretty(activeDayOccurrence.date):""}</small></div>
                <div className="df2-gym-workout-actions">
                  {activeDayOccurrence&&<button type="button" className="df2-primary" disabled={blocked}
                    onClick={()=>showSession(activeDayOccurrence.key,activeDayOccurrence.date)}>
                    {activeDayOccurrence.session?"Pokračovat":"Zahájit trénink"} →</button>}
                  <button type="button" onClick={()=>{setEditedPlanId(previewPlan.id);setView("plans");}}>Upravit cviky</button>
                </div>
              </div>
              {activeDay.exercises.length?<div className="df2-gym-preview-list" role="list" aria-label={"Cviky "+activeDay.name}>
                {activeDay.exercises.map((ex,i)=><div className="df2-gym-preview-row" role="listitem" key={ex.id}>
                  <span><small>{String(i+1).padStart(2,"0")}</small><strong>{exerciseName(ex.exerciseId)}</strong></span>
                  <small className="df2-gym-preview-target">{ex.sets} série × {ex.reps} opak.</small>
                </div>)}
              </div>:<div className="df2-gym-preview-empty">Zatím bez cviků. Přidej první přes „Upravit cviky“.</div>}
            </section>}
          </section>
          {activePlan&&<section className="df2-gym-week-strip df2-gym-week-planner" data-gym-week>
            <div className="df2-gym-week-heading"><div>
              <h3>Tvůj týdenní plán</h3>
            </div><strong>{activePlan.days.filter(d=>gymDayWeekdayOnDate(d,today)!==null).length} tréninků týdně</strong></div>
            <div className="df2-gym-week-planner-grid">{weekDates.map((date,index)=>{
              const dayOfWeek=weekday(date);
              const configured=activePlan.days.find(d=>gymDayWeekdayOnDate(d,today)===dayOfWeek);
              const isPast=date<today;
              const scheduled=selectedWeekOccurrences.filter(o=>o.date===date);
              const hasSession=scheduled.some(o=>o.session);
              const matchingTemplate=activeGymTemplates.find(d=>d.id===(configured?.templateDayId??configured?.id));
              const trainingTime=configured?gymDayTimeOnDate(configured,today):{start:null,duration:60};
              return <div key={date} className={"df2-gym-week-planner-day "+(date===today?"is-today":"")}
                data-gym-weekday={dayOfWeek}>
                <div><strong>{weekDayShort[index]}</strong><small>{date.slice(8)}.{date.slice(5,7)}.</small></div>
                <label className="df2-gym-week-picker">
                  <span className="df2-visually-hidden">{scheduleLabels[dayOfWeek]} – typ tréninku</span>
                  <select aria-label={scheduleLabels[dayOfWeek]+" – typ tréninku"} value={matchingTemplate?.id??""}
                    disabled={blocked||(hasSession&&!isPast)} onChange={e=>{
                      const id=e.target.value||null;
                      const ok=persist(s=>setGymWeekdayAssignment(s,activePlan.id,dayOfWeek,id,today));
                      if(ok)setMessage("");
                    }}>
                    <option value="">Volno</option>
                    {activeGymTemplates.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </label>
                {configured&&<div className="df2-gym-week-time" data-gym-week-time={dayOfWeek}>
                  <label><span>Čas</span>
                    <input type="time" aria-label={scheduleLabels[dayOfWeek]+" – čas tréninku"}
                      min="08:00" max="23:45" step={900} value={trainingTime.start??""}
                      disabled={blocked||(hasSession&&!isPast)}
                      onChange={e=>persist(s=>setGymWeekdayTime(s,activePlan.id,dayOfWeek,e.target.value||null,trainingTime.duration,today))}/>
                  </label>
                  <label><span>Délka</span>
                    <select aria-label={scheduleLabels[dayOfWeek]+" – délka tréninku"} value={trainingTime.duration}
                      disabled={blocked||(hasSession&&!isPast)}
                      onChange={e=>persist(s=>setGymWeekdayTime(s,activePlan.id,dayOfWeek,trainingTime.start,Number(e.target.value),today))}>
                      {[30,45,60,75,90,120,150,180].map(n=><option key={n} value={n}>{n} min</option>)}
                    </select>
                  </label>
                  {!trainingTime.start&&<small className="df2-gym-week-time-hint">Zvol čas pro zobrazení v kalendáři.</small>}
                </div>}
                {hasSession&&!isPast?<small className="df2-gym-week-status">Rozpracováno · datum je uzamčeno</small>
                  :isPast?<small className="df2-gym-week-status">Změna se projeví v dalších týdnech</small>:null}
              </div>;
            })}</div>
            <p className="df2-gym-week-note">Bez nastaveného času se trénink v kalendáři nezobrazí.</p>
          </section>}
        </>}
        {!!history.length&&<details className="df2-gym-history" data-gym-history>
          <summary>Historie tréninků <span>{history.length} záznamů</span></summary>
          <div className="df2-gym-history-list">
            {history.slice(0,20).map(s=><button key={s.id} type="button" onClick={()=>setSelectedSession(s.id)}>
              <span>{s.date} · {s.title}</span><strong>{s.completedAt?"Dokončeno":"Rozpracováno"}</strong></button>)}
          </div>
        </details>}
      </>}
    </div>}

    {view==="plans" && <div className="df2-gym-panel">
      <div className="df2-gym-section-head"><h3>Moje plány</h3>
        <div className="df2-gym-inline">
          <button type="button" disabled={blocked} onClick={()=>{setMessage("");setNewExercise(true);}}>+ Vlastní cvik</button>
          <button type="button" disabled={blocked} onClick={()=>setNewPlan(true)}>+ Nový plán</button>
        </div>
      </div>
      <div className="df2-gym-plan-switch">{store.plans.map(p=><article key={p.id}>
        <button type="button" aria-pressed={plan?.id===p.id} onClick={()=>setEditedPlanId(p.id)}>{p.name}</button>
        <button type="button" disabled={blocked||store.activePlanId===p.id} onClick={()=>persist(s=>setActiveGymPlan(s,p.id,today))}>
          {store.activePlanId===p.id?"✓ Aktivní":"Aktivovat"}</button>
      </article>)}</div>
      {!store.plans.length && <p className="df2-health-empty">Začni vlastní šablonou PPL, Upper / Lower, Full Body nebo od prázdného plánu.</p>}
      {plan && <section className="df2-gym-plan-edit" data-gym-plan-editor>
        <div className="df2-gym-section-head">
          <label>Název plánu<input aria-label="Název plánu" value={planNameDraft?.id===plan.id?planNameDraft.value:plan.name} maxLength={100}
            onChange={e=>setPlanNameDraft({id:plan.id,value:e.target.value})}
            onBlur={e=>{
              const value=e.target.value.trim();
              if(value) savePlan(plan.id,p=>({...p,name:value}));
              else setMessage("Název plánu nesmí být prázdný.");
              setPlanNameDraft(null);
            }} onKeyDown={e=>{if(e.key==="Enter")e.currentTarget.blur();}}/></label>
          <button type="button" onClick={()=>{
            if(!window.confirm("Smazat plán? Historické tréninky zůstanou zachované."))return;
            const removedPlanId=plan.id;
            const saved=persist(s=>{
              const filtered={...s,plans:s.plans.filter(p=>p.id!==removedPlanId)};
              return s.activePlanId===removedPlanId?setActiveGymPlan(filtered,null,today):filtered;
            });
            if(saved){
              // The occurrence key starts with "<planId>|"; stale exact locations must not linger.
              removeTravelBlocksWhere(key=>key.startsWith("gym:"+removedPlanId+"|"));
              setEditedPlanId(null);
            }
          }}>Smazat plán</button>
        </div>
        {plan.days.filter(d=>!d.templateDayId).map((day,dayIndex)=><article key={day.id} className="df2-gym-day-edit">
          <div className="df2-gym-inline">
            <input aria-label={"Název tréninkového dne "+(dayIndex+1)} value={dayNameDrafts[day.id]??day.name} maxLength={100}
              onChange={e=>setDayNameDrafts(d=>({...d,[day.id]:e.target.value}))}
              onBlur={e=>{
                const value=e.target.value.trim();
                if(value) savePlan(plan.id,p=>({...p,days:p.days.map(d=>d.id===day.id?{...d,name:value}:d)}));
                else setMessage("Název tréninkového dne nesmí být prázdný.");
                setDayNameDrafts(d=>{const next={...d};delete next[day.id];return next;});
              }} onKeyDown={e=>{if(e.key==="Enter")e.currentTarget.blur();}}/>
            <small>Týdenní rozvrh nastavíš v záložce Tréninky</small>
            <button type="button" onClick={()=>savePlan(plan.id,p=>({...p,days:p.days.filter(d=>d.id!==day.id&&d.templateDayId!==day.id)}))}>Odebrat den</button>
          </div>
          {day.exercises.map((item,idx)=><div className="df2-gym-plan-exercise" key={item.id}>
            <strong>{store.exercises.find(e=>e.id===item.exerciseId)?.name??"Neznámý cvik"}</strong>
            {([["sets","Série",1,12],["reps","Cíl opakování",1,100],["restSeconds","Pauza v sekundách",0,1800]] as const).map(([field,label,min,max])=>
              <label key={field}>{label}<input type="number" min={min} max={max} aria-label={label+" "+(idx+1)} value={item[field]}
                onChange={e=>savePlan(plan.id,p=>({...p,days:p.days.map(d=>d.id===day.id?{...d,exercises:d.exercises.map(x=>x.id===item.id?{...x,[field]:Math.round(Math.max(min,Math.min(max,Number(e.target.value)||min)))}:x)}:d)}))}/></label>)}
            <div className="df2-gym-inline">
              <button type="button" aria-label={"Cvik nahoru "+(idx+1)} disabled={!idx} onClick={()=>savePlan(plan.id,p=>({...p,days:p.days.map(d=>{
                if(d.id!==day.id)return d;const list=[...d.exercises];[list[idx-1],list[idx]]=[list[idx],list[idx-1]];return {...d,exercises:list};
              })}))}>↑</button>
              <button type="button" aria-label={"Cvik dolů "+(idx+1)} disabled={idx===day.exercises.length-1} onClick={()=>savePlan(plan.id,p=>({...p,days:p.days.map(d=>{
                if(d.id!==day.id)return d;const list=[...d.exercises];[list[idx],list[idx+1]]=[list[idx+1],list[idx]];return {...d,exercises:list};
              })}))}>↓</button>
              <button type="button" onClick={()=>savePlan(plan.id,p=>({...p,days:p.days.map(d=>d.id===day.id?{...d,exercises:d.exercises.filter(x=>x.id!==item.id)}:d)}))}>×</button>
            </div>
          </div>)}
          <GymExercisePicker exercises={store.exercises} label={"Přidat cvik do "+day.name}
            dayName={day.name} disabled={blocked} onSelect={exercise=>
              savePlan(plan.id,p=>({...p,days:p.days.map(d=>d.id===day.id?{
                ...d,exercises:[...d.exercises,
                  {id:uid("plan-ex"),exerciseId:exercise.id,sets:3,reps:10,restSeconds:90}]
              }:d)}))
            }/>
        </article>)}
        <button type="button" onClick={()=>savePlan(plan.id,p=>({...p,days:[...p.days,{id:uid("day"),name:"Nový trénink",weekday:1,scheduleHistory:[{effectiveFrom:today,weekday:null}],exercises:[]}]}))}>+ Tréninkový den</button>
      </section>}
    </div>}

    {view==="progress" && <div className="df2-gym-panel" data-gym-progress>
      <div className="df2-gym-section-head"><h3>Výsledky a rekordy</h3></div>
      <div className="df2-gym-kpis">
        <article><small>Absolvované tréninky</small><strong>{metrics.workouts.length}</strong></article>
        <article><small>Součet objemu pracovních sérií</small><strong>{formatKg(metrics.totalVolume)}</strong></article>
        <article><small>Dokončené pracovní série</small><strong>{metrics.workouts.reduce((a,w)=>a+w.sets,0)}</strong></article>
      </div>
      <h3>Vývoj tréninkového objemu</h3>
      {metrics.workouts.length?<div className="df2-gym-volume-chart" aria-label="Vývoj objemu">
        {metrics.workouts.slice(-12).map(w=><div key={w.id}>
          <span style={{height:Math.max(3,Math.round(w.volume/Math.max(1,...metrics.workouts.map(x=>x.volume))*100))+"%"}} title={w.title+": "+formatKg(w.volume)} />
          <small>{w.date.slice(5)}</small></div>)}
      </div>:<p className="df2-health-empty">Zatím bez výsledků.</p>}
      <h3>Osobní rekordy podle cviku</h3>
      <div className="df2-gym-pr-list">{[...metrics.byExercise.entries()].map(([id,x])=>
        <article key={id}><strong>{store.exercises.find(e=>e.id===id)?.name??id}</strong>
          <span>Max. váha: {formatKg(x.weight)}</span><span>Odhad 1RM*: {formatKg(x.estimated1RM)}</span><span>Opakování: {x.reps}</span></article>)}</div>
      <p className="df2-health-helper">* Odhad 1RM = váha × (1 + opakování / 30), pouze pro série s 1–12 opakováními. Není to skutečně otestovaný maximální výkon.</p>
    </div>}

    {newPlan && <div className="df2-modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setNewPlan(false);}}>
      <section className="df2-modal df2-hygiene-modal" role="dialog" aria-modal="true" aria-label="Nový tréninkový plán">
        <header><h2>Nový tréninkový plán</h2><button type="button" onClick={()=>setNewPlan(false)} aria-label="Zavřít">×</button></header>
        <label>Název<input autoFocus aria-label="Název nového plánu" value={newPlanName} maxLength={100} onChange={e=>setNewPlanName(e.target.value)}/></label>
        <label>Šablona<select aria-label="Šablona plánu" value={template} onChange={e=>setTemplate(e.target.value as GymTemplate)}>
          <option value="upper-lower">Upper / Lower</option><option value="ppl">Push / Pull / Lower</option>
          <option value="full-body">Full Body</option><option value="custom">Vlastní split</option></select></label>
        <div className="df2-modal-actions"><button type="button" className="df2-primary" onClick={submitPlan}>Vytvořit plán</button></div>
      </section>
    </div>}
    {newExercise && <div className="df2-modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setNewExercise(false);}}>
      <section className="df2-modal df2-hygiene-modal" role="dialog" aria-modal="true" aria-label="Vlastní cvik">
        <header><h2>Vlastní cvik</h2><button type="button" onClick={()=>setNewExercise(false)} aria-label="Zavřít">×</button></header>
        {([["name","Název cviku"],["muscle","Svalová partie"],["equipment","Vybavení"],["kind","Typ cviku"],["technique","Technika"],["photoUrl","Odkaz na foto či demonstraci"]] as const).map(([key,label])=>
          <label key={key}>{label}<input aria-label={label} maxLength={key==="technique"?1500:key==="photoUrl"?600:key==="name"?160:300}
            value={exerciseDraft[key]} onChange={e=>setExerciseDraft(s=>({...s,[key]:e.target.value}))}/></label>)}
        <div className="df2-modal-actions"><button className="df2-primary" type="button" onClick={addExercise}>Uložit cvik</button></div>
      </section>
    </div>}
  </div>;
}
