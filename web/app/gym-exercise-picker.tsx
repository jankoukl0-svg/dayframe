"use client";
import {useEffect,useId,useMemo,useRef,useState} from "react";
import {type GymExercise} from "@/lib/dayframe-gym";
import {defaultGymExerciseFilter,GYM_EXERCISE_GROUPS,searchGymExercises,
  type GymExerciseFilter} from "@/lib/dayframe-gym-exercise-groups";

export function GymExercisePicker({exercises,label,dayName="",disabled=false,placement="up",onSelect}:{
  exercises:readonly GymExercise[];
  label:string;
  dayName?:string;
  disabled?:boolean;
  placement?:"up"|"down";
  onSelect:(exercise:GymExercise)=>boolean|void;
}){
  const [open,setOpen]=useState(false);
  const [query,setQuery]=useState("");
  const [filter,setFilter]=useState<GymExerciseFilter>(()=>defaultGymExerciseFilter(dayName));
  const container=useRef<HTMLDivElement>(null);
  const search=useRef<HTMLInputElement>(null);
  const toggle=useRef<HTMLButtonElement>(null);
  const id=useId();
  const groups=useMemo(()=>searchGymExercises(exercises,query,filter),[exercises,query,filter]);
  const count=groups.reduce((sum,g)=>sum+g.items.length,0);

  const close=()=>{
    setOpen(false);setQuery("");
    setFilter(defaultGymExerciseFilter(dayName));
  };
  useEffect(()=>{
    if(!open)return;
    search.current?.focus();
    const pointer=(event:PointerEvent)=>{
      if(!container.current?.contains(event.target as Node))close();
    };
    document.addEventListener("pointerdown",pointer);
    return()=>document.removeEventListener("pointerdown",pointer);
  // The panel's close action deliberately resets search after each selection.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[open,dayName]);
  const choose=(ex:GymExercise)=>{
    if(disabled)return;
    const success=onSelect(ex);
    if(success===false)return;
    close();
    toggle.current?.focus();
  };
  return <div ref={container} className={"df2-gym-exercise-picker"+(open?" is-open":"")} data-placement={placement} data-gym-exercise-picker>
    <button ref={toggle} type="button" className="df2-gym-picker-toggle"
      aria-label={label} aria-expanded={open} aria-controls={id} disabled={disabled}
      onClick={()=>open?close():(setQuery(""),setFilter(defaultGymExerciseFilter(dayName)),setOpen(true))}>
      <span>{label.startsWith("Vyměnit")?"Vyměnit cvik":"+ Přidat cvik"}</span><span aria-hidden="true">{open?"⌃":"⌄"}</span>
    </button>
    {open&&<div id={id} role="region" aria-label={"Výběr cviku – "+label}
      className="df2-gym-picker-panel" onKeyDown={event=>{
        if(event.key==="Escape"){event.stopPropagation();close();toggle.current?.focus();}
        if(event.key==="Enter"&&event.target===search.current&&groups[0]?.items[0]){
          event.preventDefault();choose(groups[0].items[0]);
        }
      }}>
      <input ref={search} type="search" aria-label="Hledat cvik" placeholder="Hledat cvik nebo partii…"
        value={query} onChange={event=>{
          const value=event.target.value;
          // Typing searches every group so even a Push exercise can be found
          // from a Pull day's default view; chips still narrow results on demand.
          if(value.trim()&&!query.trim())setFilter("Vše");
          setQuery(value);
        }}/>
      <div className="df2-gym-picker-filters" role="group" aria-label="Skupina cviků">
        {(["Vše",...GYM_EXERCISE_GROUPS] as GymExerciseFilter[]).map(g=><button
          type="button" key={g} aria-pressed={filter===g} onClick={()=>setFilter(g)}>{g}</button>)}
      </div>
      <div className="df2-gym-picker-results" data-gym-picker-results>
        {!count?<p className="df2-gym-picker-empty">Žádné odpovídající cviky. Zkus jiný název nebo kategorii.</p>:
          groups.map(g=><section key={g.group} aria-label={g.group} className="df2-gym-picker-group">
            <h4>{g.group} <small>({g.items.length})</small></h4>
            {g.items.map(ex=><button type="button" key={ex.id} data-gym-picker-exercise={ex.id}
              onClick={()=>choose(ex)}>
              <span>{ex.name}</span><small>{ex.muscle} · {ex.equipment}{ex.custom?" · Vlastní":""}</small>
            </button>)}
          </section>)}
      </div>
      <p className="df2-gym-picker-hint">{count} cviků · Enter vybere první výsledek, Esc zavře nabídku</p>
    </div>}
  </div>;
}
