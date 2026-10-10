"use client";
import { useEffect, useMemo, useState } from "react";
import { useGymStore } from "./use-gym-store";
import {
  assignmentsOnDate, dateShift, gymMetrics, lastExercisePerformance,
  makeGymPlan, moveOccurrence, newSet, startSession, uid,
  type GymExercise, type GymPlan, type GymPlanDay, type GymPlanExercise,
  type GymSession, type GymSessionExercise, type GymSet, type GymTemplate
} from "@/lib/dayframe-gym";

const WEEKDAYS = ["Neděle","Pondělí","Úterý","Středa","Čtvrtek","Pátek","Sobota"];
type GymView="workout"|"plans"|"exercises"|"progress";
const numberValue = (raw:string,min:number,max:number):number|null => raw.trim()===""?null:Math.max(min,Math.min(max,Number(raw)||0));
const pretty = (date:string)=>new Intl.DateTimeFormat("cs-CZ",{weekday:"short",day:"numeric",month:"numeric"}).format(new Date(date+"T12:00:00"));
const formatKg = (value:number)=>new Intl.NumberFormat("cs-CZ",{maximumFractionDigits:1}).format(value)+" kg";

export function GymPage({today,focusKey,focusDate,onFocusHandled}:{today:string;focusKey?:string|null;focusDate?:string|null;onFocusHandled?:()=>void}) {
  const {store,hydrated,blocked,error,persist}=useGymStore();
  const [view,setView]=useState<GymView>("workout");
  const [selectedDate,setSelectedDate]=useState(today);
  const [selectedSession,setSelectedSession]=useState<string|null>(null);
  const [highlightKey,setHighlightKey]=useState<string|null>(null);
  const [newPlanName,setNewPlanName]=useState("");
  const [template,setTemplate]=useState<GymTemplate>("upper-lower");
  const [newPlan,setNewPlan]=useState(false);
  const [editedPlanId,setEditedPlanId]=useState<string|null>(null);
  const [planNameDraft,setPlanNameDraft]=useState<{id:string;value:string}|null>(null);
  const [dayNameDrafts,setDayNameDrafts]=useState<Record<string,string>>({});
  const [exerciseQuery,setExerciseQuery]=useState("");
  const [newExercise,setNewExercise]=useState(false);
  const [exerciseDraft,setExerciseDraft]=useState({name:"",muscle:"",equipment:"",kind:"Silový",technique:"",photoUrl:""});
  const [restSeconds,setRestSeconds]=useState(90);
  const [clock,setClock]=useState(()=>Date.now());
  const [message,setMessage]=useState("");

  useEffect(()=>{if(!hydrated||!focusKey)return;setView("workout");setHighlightKey(focusKey);setSelectedDate(focusDate||today);
    const current=store.sessions.find(s=>s.occurrenceKey===focusKey);
    if(current)setSelectedSession(current.id);
    onFocusHandled?.();
  },[hydrated,focusKey,focusDate,today,store.sessions,onFocusHandled]);
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
  const days=useMemo(()=>Array.from({length:14},(_,i)=>dateShift(selectedDate,i-3)),[selectedDate]);
  const occurrences=useMemo(()=>days.flatMap(date=>assignmentsOnDate(store,date)),[days,store]);
  const metrics=useMemo(()=>gymMetrics(store),[store]);
  const library=useMemo(()=>store.exercises.filter(e=>[e.name,e.muscle,e.equipment].join(" ").toLocaleLowerCase("cs")
    .includes(exerciseQuery.toLocaleLowerCase("cs"))).sort((a,b)=>a.name.localeCompare(b.name,"cs")),[store.exercises,exerciseQuery]);
  const savePlan=(id:string,fn:(plan:GymPlan)=>GymPlan)=>persist(s=>({...s,plans:s.plans.map(p=>p.id===id?fn(p):p)}));
  const saveSession=(id:string,fn:(session:GymSession)=>GymSession)=>persist(s=>({...s,sessions:s.sessions.map(x=>x.id===id?fn(x):x)}));
  const changeSet=(exId:string,setId:string,patch:Partial<GymSet>)=>{
    if(!session)return;
    saveSession(session.id,s=>({...s,exercises:s.exercises.map(ex=>ex.id!==exId?ex:{
      ...ex,sets:ex.sets.map(set=>set.id===setId?{...set,...patch}:set)
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
    const rest=store.plans.find(p=>p.id===session.planId)?.days.find(d=>d.id===session.dayId)?.exercises.find(e=>e.exerciseId===ex.exerciseId)?.restSeconds??90;
    saveSession(session.id,s=>({...s,restUntil:rest?Date.now()+rest*1000:null,
      exercises:s.exercises.map(item=>item.id!==ex.id?item:{...item,sets:item.sets.map(x=>x.id===set.id?{...x,done:true}:x)})}));
    setMessage("");
  };
  const doneSession=()=>{
    if(!session)return;
    if(!session.exercises.some(e=>e.sets.some(x=>x.done))){setMessage("Nejdřív dokonči alespoň jednu sérii.");return;}
    saveSession(session.id,s=>({...s,completedAt:s.completedAt?null:new Date().toISOString(),restUntil:null}));
    setMessage("");
  };
  const submitPlan=()=>{
    if(!newPlanName.trim()){setMessage("Zadej název plánu.");return;}
    const next=makeGymPlan(newPlanName.trim(),template);
    if(persist(s=>({...s,plans:[...s.plans,next],activePlanId:s.activePlanId??next.id}))){setEditedPlanId(next.id);setView("plans");setNewPlan(false);setNewPlanName("");setMessage("");}
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

  if(!hydrated)return <div className="df2-gym-loading">Načítám tréninkový deník…</div>;
  return <div className="df2-gym" data-gym-root>
    <header className="df2-gym-heading"><div><span>ETAPA 2 · TRÉNINKOVÝ DENÍK</span><h2>Gym & Tréninky</h2>
      <p>Plán, cviky, série i historie na jednom místě.</p></div>
      <button type="button" disabled={blocked} className="df2-accent-button" onClick={()=>{setNewPlan(true);setMessage("");}}>+ Tréninkový plán</button>
    </header>
    <nav className="df2-gym-nav" aria-label="Gym navigace">
      {([["workout","Tréninky"],["plans","Plány"],["exercises","Cviky"],["progress","Progres"]] as const).map(([key,label])=>
        <button type="button" aria-current={view===key?"page":undefined} key={key} onClick={()=>{setView(key);setMessage("");}}>{label}</button>)}
    </nav>
    {(blocked||error||message) && <p role="alert" className="df2-hygiene-error">{blocked?"Uložený tréninkový deník nelze bezpečně načíst. Změny jsou zablokované.":error||message}</p>}

    {view==="workout" && <div className="df2-gym-panel">
      {session ? <section className="df2-gym-session" aria-label="Tréninkový deník">
        <header className="df2-gym-section-head"><div><span>{session.date} · {session.completedAt?"Dokončeno":"Probíhá"}</span><h3>{session.title}</h3></div>
          <button type="button" onClick={()=>setSelectedSession(null)}>← Zpět na plán</button></header>
        <div className="df2-gym-rest" role="timer" aria-label="Přestávka mezi sériemi">
          <div><small>Odpočinek</small><strong>{String(Math.floor(restRemaining/60)).padStart(2,"0")}:{String(restRemaining%60).padStart(2,"0")}</strong></div>
          <div className="df2-gym-rest-buttons">{[60,90,120,180].map(n=><button type="button" key={n} onClick={()=>
            saveSession(session.id,s=>({...s,restUntil:Date.now()+n*1000}))}>{n}s</button>)}
            <input type="number" aria-label="Vlastní přestávka v sekundách" min="10" max="1800" value={restSeconds}
              onChange={e=>setRestSeconds(Math.max(10,Math.min(1800,Number(e.target.value)||10)))}/>
            <button type="button" onClick={()=>saveSession(session.id,s=>({...s,restUntil:Date.now()+restSeconds*1000}))}>Spustit</button>
            <button type="button" onClick={()=>saveSession(session.id,s=>({...s,restUntil:null}))}>Zrušit</button>
          </div>
        </div>
        {session.exercises.map((ex,exIndex)=>{
          const previous=lastExercisePerformance(store,ex.exerciseId,session.date,session.id);
          return <section className="df2-gym-log-exercise" data-gym-log-exercise={ex.exerciseId} key={ex.id}>
            <header><div><small>CVIK {exIndex+1}</small><h4>{ex.name}</h4>
              <p>{previous.length?"Minule: "+previous.map(x=>x.weightKg+" kg × "+x.reps).join(" · "):"Zatím bez historických výkonů"}</p></div>
              <div className="df2-gym-inline">
                <select aria-label={"Vyměnit cvik "+ex.name} value={ex.exerciseId} onChange={e=>{
                  const next=store.exercises.find(x=>x.id===e.target.value);if(!next)return;
                  changeSessionExercise(ex.id,x=>({...x,exerciseId:next.id,name:next.name,note:"",
                    sets:x.sets.map(set=>({...set,weightKg:null,reps:null,rpe:null,rir:null,done:false,note:""}))}));
                }}>{store.exercises.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}</select>
                <button type="button" aria-label={"Posunout "+ex.name+" nahoru"} disabled={!exIndex} onClick={()=>
                  saveSession(session.id,s=>{const list=[...s.exercises];[list[exIndex-1],list[exIndex]]=[list[exIndex],list[exIndex-1]];return {...s,exercises:list};})}>↑</button>
                <button type="button" aria-label={"Posunout "+ex.name+" dolů"} disabled={exIndex===session.exercises.length-1} onClick={()=>
                  saveSession(session.id,s=>{const list=[...s.exercises];[list[exIndex+1],list[exIndex]]=[list[exIndex],list[exIndex+1]];return {...s,exercises:list};})}>↓</button>
                <button type="button" onClick={()=>saveSession(session.id,s=>({...s,exercises:s.exercises.filter(item=>item.id!==ex.id)}))}>Odebrat</button>
              </div></header>
            <div className="df2-gym-set-table">
              <div className="df2-gym-set-labels"><span>Série</span><span>kg</span><span>Opak.</span><span>RPE</span><span>RIR</span><span>Hotovo</span></div>
              {ex.sets.map((set,index)=><div className={"df2-gym-set "+(set.done?"done":"")} key={set.id} data-gym-set>
                <button type="button" title="Změnit typ série" onClick={()=>changeSet(ex.id,set.id,{kind:set.kind==="work"?"warmup":"work"})}>{set.kind==="warmup"?"W":"#"+(index+1)}</button>
                {([["weightKg","Váha v kg",2000,.5],["reps","Opakování",1000,1],["rpe","RPE",10,.5],["rir","RIR",10,.5]] as const).map(([field,label,max,step])=>
                  <input key={field} aria-label={label+" série "+(index+1)+" cviku "+ex.name} type="number" min="0" max={max} step={step}
                    value={set[field]??""} placeholder="—" onChange={e=>changeSet(ex.id,set.id,{[field]:numberValue(e.target.value,field==="rpe"?1:0,max)})}/>)}
                <button type="button" className="df2-gym-set-done" aria-label={"Dokončit sérii "+(index+1)+" cviku "+ex.name}
                  aria-pressed={set.done} onClick={()=>markSet(ex,set)}>{set.done?"✓":"○"}</button>
                <input className="df2-gym-set-note" aria-label={"Poznámka série "+(index+1)+" cviku "+ex.name} placeholder="Poznámka k sérii"
                  value={set.note} onChange={e=>changeSet(ex.id,set.id,{note:e.target.value.slice(0,1000)})}/>
                <button type="button" className="df2-gym-delete-set" aria-label={"Smazat sérii "+(index+1)+" cviku "+ex.name}
                  onClick={()=>changeSessionExercise(ex.id,e=>({...e,sets:e.sets.filter(item=>item.id!==set.id)}))}>×</button>
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
          <select aria-label="Přidat cvik během tréninku" defaultValue="" onChange={e=>{
            const x=store.exercises.find(item=>item.id===e.target.value);if(!x)return;
            saveSession(session.id,s=>({...s,exercises:[...s.exercises,{id:uid("log-ex"),exerciseId:x.id,name:x.name,sets:[newSet(),newSet(),newSet()],note:""}]}));
            e.target.value="";
          }}><option value="">+ Přidat cvik</option>{store.exercises.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select>
          <button className="df2-primary" type="button" onClick={doneSession}>{session.completedAt?"Znovu otevřít trénink":"Dokončit trénink"}</button>
        </div>
      </section> : <>
        <div className="df2-gym-section-head"><div><span>AKTIVNÍ PLÁN</span><h3>{store.plans.find(p=>p.id===store.activePlanId)?.name??"Zatím žádný aktivní plán"}</h3></div>
          <button type="button" onClick={()=>setView("plans")}>Spravovat plány</button></div>
        <div className="df2-gym-inline"><label>Prohlížet od data <input type="date" value={selectedDate} onChange={e=>setSelectedDate(e.target.value||today)}/></label>
          <button type="button" onClick={()=>setSelectedDate(today)}>Tento týden</button></div>
        {occurrences.length?<div className="df2-gym-appointments">{occurrences.map(occ=>
          <article key={occ.key} data-gym-occurrence={occ.key} className={highlightKey===occ.key?"is-highlighted":""}>
            <div><time dateTime={occ.date}>{pretty(occ.date)}</time><strong>{occ.name}</strong>
              <small>{occ.completed?"✓ Dokončeno":occ.session?"Rozpracováno":occ.originalDate!==occ.date?"Přesunuto z "+pretty(occ.originalDate):"Naplánováno"}</small></div>
            <div className="df2-gym-inline">
              {!occ.session && <input type="date" aria-label={"Přesunout "+occ.name+" z "+occ.originalDate} min={today} value={occ.date}
                onChange={e=>persist(s=>moveOccurrence(s,occ.key,e.target.value))}/>}
              <button type="button" onClick={()=>showSession(occ.key,occ.date)}>{occ.completed?"Zobrazit / upravit":occ.session?"Pokračovat":"Zahájit"}</button>
            </div>
          </article>)}</div>:
          <p className="df2-health-empty">Žádné tréninky v tomto období. Vytvoř a aktivuj plán nebo změň zobrazené datum.</p>}
        {!!history.length && <section className="df2-gym-history"><h3>Historie tréninků</h3>
          {history.slice(0,20).map(s=><button key={s.id} type="button" onClick={()=>setSelectedSession(s.id)}>
            <span>{s.date} · {s.title}</span><strong>{s.completedAt?"Dokončeno":"Rozpracováno"}</strong></button>)}
        </section>}
      </>}
    </div>}

    {view==="plans" && <div className="df2-gym-panel">
      <div className="df2-gym-section-head"><h3>Moje plány</h3><button type="button" onClick={()=>setNewPlan(true)}>+ Nový plán</button></div>
      <div className="df2-gym-plan-switch">{store.plans.map(p=><article key={p.id}>
        <button type="button" aria-pressed={plan?.id===p.id} onClick={()=>setEditedPlanId(p.id)}>{p.name}</button>
        <button type="button" disabled={blocked||store.activePlanId===p.id} onClick={()=>persist(s=>({...s,activePlanId:p.id}))}>
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
            persist(s=>({...s,plans:s.plans.filter(p=>p.id!==plan.id),activePlanId:s.activePlanId===plan.id?null:s.activePlanId}));
            setEditedPlanId(null);
          }}>Smazat plán</button>
        </div>
        {plan.days.map((day,dayIndex)=><article key={day.id} className="df2-gym-day-edit">
          <div className="df2-gym-inline">
            <input aria-label={"Název tréninkového dne "+(dayIndex+1)} value={dayNameDrafts[day.id]??day.name} maxLength={100}
              onChange={e=>setDayNameDrafts(d=>({...d,[day.id]:e.target.value}))}
              onBlur={e=>{
                const value=e.target.value.trim();
                if(value) savePlan(plan.id,p=>({...p,days:p.days.map(d=>d.id===day.id?{...d,name:value}:d)}));
                else setMessage("Název tréninkového dne nesmí být prázdný.");
                setDayNameDrafts(d=>{const next={...d};delete next[day.id];return next;});
              }} onKeyDown={e=>{if(e.key==="Enter")e.currentTarget.blur();}}/>
            <select aria-label={"Den v týdnu "+day.name} value={day.weekday}
              onChange={e=>savePlan(plan.id,p=>({...p,days:p.days.map(d=>d.id===day.id?{...d,weekday:Number(e.target.value)}:d)}))}>
              {WEEKDAYS.map((name,index)=><option key={index} value={index}>{name}</option>)}</select>
            <button type="button" onClick={()=>savePlan(plan.id,p=>({...p,days:p.days.filter(d=>d.id!==day.id)}))}>Odebrat den</button>
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
          <select aria-label={"Přidat cvik do "+day.name} value="" onChange={e=>{
            if(!e.target.value)return;const exerciseId=e.target.value;
            savePlan(plan.id,p=>({...p,days:p.days.map(d=>d.id===day.id?{...d,exercises:[...d.exercises,{id:uid("plan-ex"),exerciseId,sets:3,reps:10,restSeconds:90}]}:d)}));
          }}><option value="">+ Přidat cvik</option>{store.exercises.map(ex=><option key={ex.id} value={ex.id}>{ex.name}</option>)}</select>
        </article>)}
        <button type="button" onClick={()=>savePlan(plan.id,p=>({...p,days:[...p.days,{id:uid("day"),name:"Nový trénink",weekday:1,exercises:[]}]}))}>+ Tréninkový den</button>
      </section>}
    </div>}

    {view==="exercises" && <div className="df2-gym-panel">
      <div className="df2-gym-section-head"><h3>Knihovna cviků</h3><button type="button" onClick={()=>setNewExercise(true)}>+ Vlastní cvik</button></div>
      <input type="search" placeholder="Hledat cvik, partii nebo vybavení" aria-label="Hledat cviky"
        value={exerciseQuery} onChange={e=>setExerciseQuery(e.target.value)}/>
      <div className="df2-gym-library">{library.map(ex=><article key={ex.id}>
        <div><strong>{ex.name}</strong><small>{ex.muscle} · {ex.equipment} · {ex.kind}</small>
          <p>{ex.technique||"Bez popisu techniky"}</p>{ex.photoUrl && /^https:\/\//.test(ex.photoUrl)&&
          <a target="_blank" rel="noreferrer" href={ex.photoUrl}>Demonstrace / fotografie ↗</a>}</div>
      </article>)}</div>
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
      </div>:<p className="df2-health-empty">Po dokončení prvního tréninku se zde objeví historie a progres.</p>}
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
          <option value="upper-lower">Upper / Lower</option><option value="ppl">Push / Pull / Legs</option>
          <option value="full-body">Full Body</option><option value="custom">Vlastní split</option></select></label>
        <div className="df2-modal-actions"><button type="button" className="df2-primary" onClick={submitPlan}>Vytvořit plán</button></div>
      </section>
    </div>}
    {newExercise && <div className="df2-modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setNewExercise(false);}}>
      <section className="df2-modal df2-hygiene-modal" role="dialog" aria-modal="true" aria-label="Vlastní cvik">
        <header><h2>Vlastní cvik</h2><button type="button" onClick={()=>setNewExercise(false)} aria-label="Zavřít">×</button></header>
        {([["name","Název cviku"],["muscle","Svalová partie"],["equipment","Vybavení"],["kind","Typ cviku"],["technique","Technika"],["photoUrl","Odkaz na foto či demonstraci"]] as const).map(([key,label])=>
          <label key={key}>{label}<input aria-label={label} maxLength={key==="technique"?1500:600}
            value={exerciseDraft[key]} onChange={e=>setExerciseDraft(s=>({...s,[key]:e.target.value}))}/></label>)}
        <div className="df2-modal-actions"><button className="df2-primary" type="button" onClick={addExercise}>Uložit cvik</button></div>
      </section>
    </div>}
  </div>;
}
