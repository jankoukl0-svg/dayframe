"use client";
import {useCallback,useEffect,useMemo,useState} from "react";
import {CartesianGrid,Line,LineChart,ResponsiveContainer,Tooltip,XAxis,YAxis} from "recharts";
import {
  formatSleepDuration,sleepAverageMinutes,sleepDurationMinutes,sleepEntryForDate,sleepSeries,upsertSleepEntry,
  validSleepDate,type SleepEntry,type SleepQuality
} from "@/lib/dayframe-sleep";
import {useSleepStore} from "./use-sleep-store";

type SleepDraft={bedtime:string;wakeTime:string;quality:SleepQuality|null;note:string};
const DEFAULT_DRAFT:SleepDraft={bedtime:"23:00",wakeTime:"07:00",quality:null,note:""};
const dateLabel=(value:string)=>new Intl.DateTimeFormat("cs-CZ",{day:"numeric",month:"short"}).format(new Date(value+"T12:00:00"));

export function SleepPage({today,focusDate,onFocusHandled}:{today:string;focusDate?:string|null;onFocusHandled?:()=>void}){
  const {store,hydrated,blocked,error,persist}=useSleepStore();
  const [panel,setPanel]=useState<"overview"|"log"|"history">("overview");
  const [date,setDate]=useState(today);
  const [draft,setDraft]=useState<SleepDraft>(DEFAULT_DRAFT);
  const [baseline,setBaseline]=useState<SleepDraft>(DEFAULT_DRAFT);
  const [notice,setNotice]=useState("");
  const [editError,setEditError]=useState("");
  const [windowDays,setWindowDays]=useState<number|null>(30);
  const [targetDraft,setTargetDraft]=useState("");
  const series=useMemo(()=>sleepSeries(store,today,windowDays),[store,today,windowDays]);
  const average=sleepAverageMinutes(store,today,30);
  const latest=useMemo(()=>store.entries.filter(e=>e.date<=today).slice().sort((a,b)=>b.date.localeCompare(a.date))[0]??null,[store.entries,today]);
  const currentDuration=sleepDurationMinutes(date,draft.bedtime,draft.wakeTime);
  const history=useMemo(()=>store.entries.filter(e=>e.date<=today).slice().sort((a,b)=>b.date.localeCompare(a.date)),[store.entries,today]);
  const loadDate=useCallback((key:string)=>{
    const existing=sleepEntryForDate(store,key);
    const value:SleepDraft=existing?{bedtime:existing.bedtime,wakeTime:existing.wakeTime,quality:existing.quality,note:existing.note}:DEFAULT_DRAFT;
    setDate(key);setDraft({...value});setBaseline({...value});setEditError("");setNotice("");setPanel("log");
  },[store]);
  useEffect(()=>{
    if(!hydrated||!focusDate)return;
    loadDate(focusDate);onFocusHandled?.();
  },[hydrated,focusDate,loadDate,onFocusHandled]);

  const saveEntry=()=>{
    setEditError("");
    if(!validSleepDate(date)||date>today){setEditError("Vyber platné datum probuzení.");return;}
    if(currentDuration===null){setEditError("Zadej platné časy. Spánek musí trvat alespoň 30 minut a nejvýše 24 hodin.");return;}
    const currentValue={...draft};
    const saved=persist(current=>{
      const previous=sleepEntryForDate(current,date);
      const merged:SleepDraft=previous?{
        bedtime:currentValue.bedtime!==baseline.bedtime?currentValue.bedtime:previous.bedtime,
        wakeTime:currentValue.wakeTime!==baseline.wakeTime?currentValue.wakeTime:previous.wakeTime,
        quality:currentValue.quality!==baseline.quality?currentValue.quality:previous.quality,
        note:currentValue.note!==baseline.note?currentValue.note:previous.note,
      }:currentValue;
      if(sleepDurationMinutes(date,merged.bedtime,merged.wakeTime)===null)return current;
      const now=new Date().toISOString();
      const entry:SleepEntry={date,...merged,createdAt:previous?.createdAt??now,updatedAt:now};
      return upsertSleepEntry(current,entry);
    });
    if(saved){setNotice("Spánek uložen.");setPanel("overview");}
  };
  const deleteEntry=(dateKey:string)=>{
    if(!window.confirm("Odstranit záznam spánku z "+dateKey+"?"))return;
    if(persist(current=>({...current,entries:current.entries.filter(e=>e.date!==dateKey)})))setNotice("Záznam byl odstraněn.");
  };
  const saveGoal=()=>{
    const minutes=targetDraft===""?null:Number(targetDraft);
    if(minutes!==null&&(!Number.isInteger(minutes)||minutes<180||minutes>840)){setEditError("Cíl musí být mezi 3 a 14 hodinami v celých minutách.");return;}
    if(persist(current=>({...current,goalMinutes:minutes}))){setNotice("Cíl byl uložen.");setEditError("");}
  };
  useEffect(()=>setTargetDraft(store.goalMinutes===null?"":String(store.goalMinutes)),[store.goalMinutes]);

  if(!hydrated)return <section className="df2-sleep" data-sleep-root><p>Načítám záznamy spánku…</p></section>;
  return <section className="df2-sleep" data-sleep-root>
    <header className="df2-sleep-head"><div>
      <span>ETAPA 5 · SPÁNEK</span><h2>Spánek & Regenerace</h2>
      <p>Dobrovolné záznamy skutečného spánku, bez automatických hodnocení zdraví.</p>
    </div><button type="button" className="df2-accent-button" onClick={()=>loadDate(today)}>+ Zapsat spánek</button></header>
    <nav className="df2-sleep-nav" aria-label="Spánek – sekce">
      {([{key:"overview",title:"Přehled"},{key:"log",title:"Záznam"},{key:"history",title:"Historie"}] as const).map(x=>
        <button type="button" key={x.key} aria-current={panel===x.key?"page":undefined}
          onClick={()=>x.key==="log"?loadDate(date):setPanel(x.key)}>{x.title}</button>)}
    </nav>
    {(blocked||error||editError)&&<p className="df2-sleep-error" role="alert">{blocked?"Uložená data spánku mají neznámý formát. Změny jsou zablokované.":error||editError}</p>}
    {notice&&<p className="df2-sleep-notice" role="status">{notice}</p>}
    {panel==="overview"&&<div className="df2-sleep-content">
      <div className="df2-sleep-kpis">
        <article><small>Poslední noc</small><strong>{latest?formatSleepDuration(sleepDurationMinutes(latest.date,latest.bedtime,latest.wakeTime)!):"—"}</strong><span>{latest?dateLabel(latest.date):"Zatím bez záznamů"}</span></article>
        <article><small>Průměr za 30 dní</small><strong>{average!==null?formatSleepDuration(average):"—"}</strong><span>Jen skutečně zapsané noci</span></article>
        <article><small>Kvalita poslední noci</small><strong>{latest?.quality?latest.quality+"/5":"—"}</strong><span>Vlastní subjektivní hodnocení</span></article>
      </div>
      <article className="df2-sleep-card">
        <header className="df2-sleep-card-head"><div><h3>Historie spánku</h3><small>Délka skutečně zapsaných nocí</small></div>
          <label>Období <select aria-label="Období spánkového grafu" value={windowDays===null?"all":String(windowDays)}
            onChange={event=>setWindowDays(event.target.value==="all"?null:Number(event.target.value))}>
            <option value="7">7 dní</option><option value="30">30 dní</option><option value="90">90 dní</option><option value="all">Vše</option>
          </select></label></header>
        {series.length?<div className="df2-sleep-chart" data-sleep-chart>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={series} margin={{top:8,right:16,bottom:8,left:2}}>
              <CartesianGrid strokeDasharray="3 4" vertical={false}/>
              <XAxis dataKey="date" tickFormatter={dateLabel} tick={{fontSize:10}}/>
              <YAxis tick={{fontSize:10}} domain={[0,"dataMax + 60"]} tickFormatter={(v:number)=>String(Math.round(v/60))+" h"}/>
              <Tooltip labelFormatter={(value)=>String(value)} formatter={(value)=>[formatSleepDuration(Number(value)),"Délka"]}/>
              <Line type="monotone" dataKey="minutes" stroke="var(--accent-dark)" strokeWidth={2.5} dot={{r:3}}/>
            </LineChart>
          </ResponsiveContainer>
        </div>:<p className="df2-sleep-empty">Zatím nemáš žádná měření. První noc přidej tlačítkem „Zapsat spánek“.</p>}
      </article>
      <article className="df2-sleep-card"><h3>Volitelný denní záznam</h3>
        <label className="df2-sleep-toggle"><input type="checkbox" checked={store.checkInEnabled} disabled={blocked}
          onChange={event=>persist(current=>({...current,checkInEnabled:event.target.checked}))}/> Přidávat „Zapsat spánek“ do stránky Dnes</label>
        <p>Splní se automaticky uložením jediné noci v tomto modulu. Výchozí nastavení je vypnuté.</p>
        <div className="df2-sleep-goal"><label>Vlastní cíl spánku (minuty, volitelné)
          <input type="number" min="180" max="840" step="1" value={targetDraft} placeholder="Bez cíle"
            onChange={event=>setTargetDraft(event.target.value)} disabled={blocked}/></label>
          <button type="button" disabled={blocked} onClick={saveGoal}>Uložit cíl</button></div>
        {store.goalMinutes!==null&&<small>Nastavený cíl: {formatSleepDuration(store.goalMinutes)}. Nejde o zdravotní doporučení.</small>}
      </article>
    </div>}
    {panel==="log"&&<article className="df2-sleep-card" data-sleep-editor>
      <header className="df2-sleep-card-head"><div><h3>Záznam spánku</h3><small>Datum patří dni, kdy ses probudil.</small></div></header>
      <div className="df2-sleep-fields">
        <label>Datum probuzení<input type="date" aria-label="Datum probuzení" value={date} max={today} onChange={e=>loadDate(e.target.value)}/></label>
        <label>Čas usnutí<input type="time" aria-label="Čas usnutí" value={draft.bedtime} onChange={e=>setDraft(s=>({...s,bedtime:e.target.value}))}/></label>
        <label>Čas probuzení<input type="time" aria-label="Čas probuzení" value={draft.wakeTime} onChange={e=>setDraft(s=>({...s,wakeTime:e.target.value}))}/></label>
        <label>Subjektivní kvalita<select aria-label="Kvalita spánku" value={draft.quality??""} onChange={e=>setDraft(s=>({...s,quality:e.target.value===""?null:Number(e.target.value) as SleepQuality}))}>
          <option value="">Bez hodnocení</option><option value="1">1 · Velmi špatná</option><option value="2">2 · Špatná</option><option value="3">3 · Průměrná</option><option value="4">4 · Dobrá</option><option value="5">5 · Výborná</option>
        </select></label>
      </div>
      <p className="df2-sleep-duration">Vypočtená délka: <strong>{currentDuration!==null?formatSleepDuration(currentDuration):"Neplatné časy"}</strong></p>
      <label className="df2-sleep-note">Poznámka k regeneraci (volitelné)
        <textarea aria-label="Poznámka k regeneraci" maxLength={1000} rows={3} value={draft.note} onChange={e=>setDraft(s=>({...s,note:e.target.value}))} placeholder="Jak ses cítil po probuzení?"/>
      </label>
      <div className="df2-sleep-actions"><button type="button" className="df2-primary" onClick={saveEntry} disabled={blocked||currentDuration===null}>Uložit spánek</button>
        <button type="button" onClick={()=>setPanel("overview")}>Zrušit</button></div>
    </article>}
    {panel==="history"&&<article className="df2-sleep-card"><h3>Uložené noci</h3>
      {history.length?<div className="df2-sleep-history">{history.map(entry=><div key={entry.date} data-sleep-entry={entry.date}>
        <div><time dateTime={entry.date}>{dateLabel(entry.date)}</time><strong>{formatSleepDuration(sleepDurationMinutes(entry.date,entry.bedtime,entry.wakeTime)!)}</strong>
          <small>{entry.bedtime} – {entry.wakeTime} {entry.quality?"· Kvalita "+entry.quality+"/5":""}</small></div>
        <div className="df2-sleep-actions"><button type="button" onClick={()=>loadDate(entry.date)}>Upravit</button><button type="button" disabled={blocked} onClick={()=>deleteEntry(entry.date)}>Odstranit</button></div>
      </div>)}</div>:<p className="df2-sleep-empty">Zatím nemáš žádný záznam spánku.</p>}
    </article>}
  </section>;
}
