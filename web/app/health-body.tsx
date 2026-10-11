"use client";
import {useCallback,useEffect,useMemo,useState} from "react";
import {CartesianGrid,Line,LineChart,ResponsiveContainer,Tooltip,XAxis,YAxis} from "recharts";
import {addDaysKey} from "@/lib/dayframe-calendar";
import {
  BODY_METRICS, blankMeasurements, bodyChange, bodyCheckInStatus, bodyEntryForDate,
  bodyGoalProgress, bodySeries, createBodyGoal, latestMetric, uid, upsertBodyEntry,
  validBodyDate, type BodyMetric, type BodyMeasurements, type BodyEntry, type BodyGoal, type BodyPhoto
} from "@/lib/dayframe-body";
import {deleteBodyPhoto,loadBodyPhoto,saveBodyPhoto} from "@/lib/dayframe-body-photos";
import {useBodyStore} from "./use-body-store";

const DAYS=["Neděle","Pondělí","Úterý","Středa","Čtvrtek","Pátek","Sobota"];
type Panel="overview"|"measurements"|"goals"|"photos";
const nf=(n:number)=>new Intl.NumberFormat("cs-CZ",{maximumFractionDigits:2}).format(n);
const unit=(m:BodyMetric)=>BODY_METRICS.find(x=>x.key===m)!;
const dateLabel=(d:string)=>new Intl.DateTimeFormat("cs-CZ",{day:"numeric",month:"short",year:"numeric"}).format(new Date(d+"T12:00:00"));
const decimal=(v:string)=>v.trim()===""?null:Number(v.replace(",",".")) ;
const metricLabel=(m:BodyMetric,v:number)=>nf(v)+" "+unit(m).unit;
const validPhoto=(file:File)=>["image/jpeg","image/png","image/webp"].includes(file.type)&&file.size>0&&file.size<=6*1024*1024;
function PhotoTile({photo,onRemove}:{photo:BodyPhoto;onRemove:(id:string)=>void}){
  const [url,setUrl]=useState<string|null>(null);
  const [error,setError]=useState("");
  useEffect(()=>{
    let disposed=false;let blobUrl:string|null=null;
    loadBodyPhoto(photo.id).then(blob=>{
      if(disposed)return;
      if(!blob){setError("Soubor není v tomto prohlížeči dostupný.");return;}
      blobUrl=URL.createObjectURL(blob);setUrl(blobUrl);
    }).catch(()=>{if(!disposed)setError("Fotografii se nepodařilo načíst.");});
    return()=>{disposed=true;if(blobUrl)URL.revokeObjectURL(blobUrl);};
  },[photo.id]);
  return <article className="df2-body-photo-card" data-body-photo={photo.id}>
    {url?<img src={url} alt={photo.caption||"Soukromá progresová fotografie"} loading="lazy"/>:<div className="df2-body-photo-unavailable">{error||"Načítání fotografie…"}</div>}
    <div><time dateTime={photo.date}>{dateLabel(photo.date)}</time>{photo.caption&&<strong>{photo.caption}</strong>}
      <div className="df2-body-inline">{url&&<a href={url} download={"dayframe-progress-"+photo.date+"."+(photo.mimeType==="image/png"?"png":photo.mimeType==="image/webp"?"webp":"jpg")}>Uložit fotku</a>}
        <button type="button" onClick={()=>onRemove(photo.id)}>Odstranit</button></div>
    </div>
  </article>;
}
export function BodyPage({today,focusDate}:{today:string;focusDate?:string|null}){
  const {store,hydrated,blocked,error,persist}=useBodyStore();
  const [panel,setPanel]=useState<Panel>("overview");
  const [date,setDate]=useState(today);
  const [draft,setDraft]=useState<BodyMeasurements>(()=>blankMeasurements());
  const [note,setNote]=useState("");
  const [draftAtOpen,setDraftAtOpen]=useState<BodyEntry|null>(null);
  const [editError,setEditError]=useState("");
  const [metric,setMetric]=useState<BodyMetric>("weightKg");
  const [windowDays,setWindowDays]=useState<number|null>(90);
  const [goalMetric,setGoalMetric]=useState<BodyMetric>("weightKg");
  const [goalTarget,setGoalTarget]=useState("");
  const [goalDeadline,setGoalDeadline]=useState("");
  const [photoDate,setPhotoDate]=useState(today);
  const [photoCaption,setPhotoCaption]=useState("");
  const [photoFile,setPhotoFile]=useState<File|null>(null);
  const [photoBusy,setPhotoBusy]=useState(false);
  const [notice,setNotice]=useState("");
  const entries=useMemo(()=>store.entries.filter(x=>x.date<=today).slice().sort((a,b)=>b.date.localeCompare(a.date)),[store.entries,today]);
  const status=bodyCheckInStatus(store,today);
  const weight=latestMetric(store,"weightKg",today);
  const waist=latestMetric(store,"waistCm",today);
  const deltaWeight=bodyChange(store,"weightKg",today);
  const chart=useMemo(()=>bodySeries(store,metric,today,windowDays),[store,metric,today,windowDays]);
  const goals=store.goals.slice().sort((a,b)=>Number(b.active)-Number(a.active));
  const photos=store.photos.filter(x=>x.date<=today).slice().sort((a,b)=>b.date.localeCompare(a.date));
  const clearFeedback=()=>{setEditError("");setNotice("");};
  const loadDate=useCallback((key:string)=>{
    setDate(key);const row=bodyEntryForDate(store,key);
    setDraft(row?{...row.metrics}:blankMeasurements());setNote(row?.note??"");setDraftAtOpen(row?{...row,metrics:{...row.metrics}}:null);
    clearFeedback();
  },[store]);
  useEffect(()=>{if(!focusDate)return;setPanel("measurements");loadDate(focusDate);},[focusDate,loadDate]);
  // The day changes only when navigating back into Health. Do not overwrite an
  // in-progress edit when records are synchronized from another tab.
  const setSelectedDate=(key:string)=>{if(validBodyDate(key)&&key<=today)loadDate(key);};

  const saveEntry=()=>{
    if(!validBodyDate(date)||date>today){setEditError("Vyber platné datum, nejpozději dnes.");return;}
    if(!BODY_METRICS.some(m=>draft[m.key]!==null)){setEditError("Vyplň alespoň jednu naměřenou hodnotu.");return;}
    for(const def of BODY_METRICS){
      const v=draft[def.key];
      if(v!==null&&(!Number.isFinite(v)||v<def.min||v>def.max)){setEditError("Zkontroluj "+def.name.toLowerCase()+".");return;}
    }
    const now=new Date().toISOString();
    const ok=persist(s=>{
      const current=bodyEntryForDate(s,date);
      const combined:BodyMeasurements=current?{...current.metrics}:{...draft};
      // Preserve measurement fields that were updated in another tab while
      // this editor remained open; only locally changed fields replace them.
      for(const m of BODY_METRICS){
        if(!current||!draftAtOpen||draft[m.key]!==draftAtOpen.metrics[m.key])combined[m.key]=draft[m.key];
      }
      const mergedNote=current&&draftAtOpen&&note===draftAtOpen.note?current.note:note;
      if(!BODY_METRICS.some(m=>combined[m.key]!==null))return s;
      return upsertBodyEntry(s,{id:current?.id??uid("measurement"),date,metrics:combined,
        note:mergedNote.slice(0,1500),createdAt:current?.createdAt??now,updatedAt:now});
    });
    if(ok){setNotice("Měření bylo uloženo.");setEditError("");const actual=bodyEntryForDate(
      // State listener refreshes store after write; current snapshot is already
      // persistent, so the draft is reloaded on the next explicit date selection.
      store,date);
      if(!actual)setPanel("overview");
    }
  };
  const deleteEntry=(entry:BodyEntry)=>{
    if(!window.confirm("Odstranit měření z "+dateLabel(entry.date)+"? Fotografie a cíle zůstanou zachované."))return;
    if(persist(s=>({...s,entries:s.entries.filter(x=>x.id!==entry.id)}))){
      if(entry.date===date){setDraft(blankMeasurements());setNote("");setDraftAtOpen(null);}
      setNotice("Měření odstraněno.");
    }
  };
  const addGoal=()=>{
    const value=decimal(goalTarget);const def=unit(goalMetric);
    if(value===null||!Number.isFinite(value)||value<def.min||value>def.max){
      setEditError("Zadej platnou cílovou hodnotu pro "+def.name.toLowerCase()+".");return;
    }
    if(goalDeadline && (!validBodyDate(goalDeadline)||goalDeadline<today)){
      setEditError("Termín cíle nemůže být v minulosti.");return;
    }
    if(persist(s=>createBodyGoal(s,goalMetric,value,today,goalDeadline||null))){
      setGoalTarget("");setGoalDeadline("");clearFeedback();
    }
  };
  const addPhoto=async()=>{
    if(!photoFile||!validPhoto(photoFile)){setEditError("Vyber JPG, PNG nebo WebP do 6 MB.");return;}
    if(!validBodyDate(photoDate)||photoDate>today){setEditError("Vyber platné datum fotografie.");return;}
    if(blocked||photoBusy)return;
    setPhotoBusy(true);setEditError("");
    const id=uid("photo");
    try{
      await saveBodyPhoto(id,photoFile);
      const ok=persist(s=>({...s,photos:[...s.photos,{id,date:photoDate,mimeType:photoFile.type,
        caption:photoCaption.trim().slice(0,300),createdAt:new Date().toISOString()}]}));
      if(!ok){await deleteBodyPhoto(id);setEditError("Fotografii se nepodařilo propojit se záznamem.");}
      else{setPhotoFile(null);setPhotoCaption("");setNotice("Fotografie byla bezpečně uložena v tomto prohlížeči.");}
    }catch(e){setEditError(e instanceof Error?e.message:"Fotografii se nepodařilo uložit.");}
    finally{setPhotoBusy(false);}
  };
  const removePhoto=async(id:string)=>{
    if(blocked||!window.confirm("Odstranit fotografii z tohoto prohlížeče?"))return;
    try{
      await deleteBodyPhoto(id);
      if(persist(s=>({...s,photos:s.photos.filter(x=>x.id!==id)})))setNotice("Fotografie odstraněna.");
    }catch{setEditError("Fotografii se nepodařilo odstranit z lokálního úložiště.");}
  };
  if(!hydrated)return <section className="df2-body">Načítám Tělo & Progress…</section>;
  return <section className="df2-body" data-body-root aria-label="Tělo a progress">
    <header className="df2-body-head"><div><span>ETAPA 4 · TĚLO & PROGRESS</span><h2>Tělo & Progress</h2>
      <p>Měření, historie, osobní cíle a soukromé fotografie.</p></div>
      <button type="button" className="df2-accent-button" disabled={blocked} onClick={()=>{loadDate(today);setPanel("measurements");}}>+ Zapsat měření</button>
    </header>
    <nav className="df2-body-nav" aria-label="Tělo navigace">{([
      ["overview","Přehled"],["measurements","Měření"],["goals","Cíle"],["photos","Fotografie"]
    ] as const).map(([key,label])=><button type="button" key={key}
      aria-current={panel===key?"page":undefined} onClick={()=>{setPanel(key);clearFeedback();}}>{label}</button>)}</nav>
    {(blocked||error||editError)&&<p role="alert" className="df2-hygiene-error">{blocked?"Data měření nelze bezpečně načíst. Změny jsou zablokované.":error||editError}</p>}
    {notice&&<p className="df2-body-notice" role="status">{notice}</p>}

    {panel==="overview"&&<div className="df2-body-content">
      <div className="df2-body-kpis">
        <article><small>Poslední hmotnost</small><strong>{weight===null?"—":metricLabel("weightKg",weight)}</strong>
          <span>{deltaWeight===null?"Zatím bez srovnání":(deltaWeight>0?"+":"")+metricLabel("weightKg",deltaWeight)+" od prvního zápisu"}</span></article>
        <article><small>Poslední pas</small><strong>{waist===null?"—":metricLabel("waistCm",waist)}</strong>
          <span>{latestMetric(store,"waistCm",today)===null?"Zatím bez měření":"Poslední zaznamenaná hodnota"}</span></article>
        <article><small>Záznamy</small><strong>{entries.length}</strong>
          <span>{entries.length?dateLabel(entries[0].date)+" · poslední měření":"Přidej první měření"}</span></article>
      </div>
      <section className="df2-body-section">
        <div className="df2-body-section-head"><div><h3>Vývoj měření</h3><p>Zobrazujeme pouze tebou zadaná data.</p></div>
          <button type="button" onClick={()=>setPanel("measurements")}>Všechna měření →</button></div>
        <div className="df2-body-filters">
          <label>Metrika<select aria-label="Metrika grafu" value={metric} onChange={e=>setMetric(e.target.value as BodyMetric)}>
            {BODY_METRICS.map(m=><option key={m.key} value={m.key}>{m.name}</option>)}</select></label>
          <label>Období<select aria-label="Období grafu" value={windowDays??"all"}
            onChange={e=>setWindowDays(e.target.value==="all"?null:Number(e.target.value))}>
            <option value="30">30 dní</option><option value="90">90 dní</option>
            <option value="365">1 rok</option><option value="all">Vše</option></select></label>
        </div>
        {chart.length?<div className="df2-body-chart" data-body-chart>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={chart} margin={{top:12,right:22,bottom:4,left:2}}>
              <CartesianGrid strokeDasharray="3 4" stroke="var(--line)"/>
              <XAxis dataKey="date" tickFormatter={(d:string)=>d.slice(5)} tick={{fontSize:10,fill:"var(--muted)"}}/>
              <YAxis width={42} domain={["auto","auto"]} tick={{fontSize:10,fill:"var(--muted)"}}/>
              <Tooltip formatter={(value)=>[nf(Number(value))+" "+unit(metric).unit,unit(metric).name]} labelFormatter={(label)=>dateLabel(String(label))}/>
              <Line type="monotone" dataKey="value" stroke="var(--accent-dark)" strokeWidth={2} dot={{r:3}} activeDot={{r:5}}/>
            </LineChart>
          </ResponsiveContainer>
        </div>:<p className="df2-health-empty">Pro vybranou metriku zatím nemáš měření v tomto období.</p>}
      </section>
      <section className="df2-body-section">
        <div className="df2-body-section-head"><div><h3>Pravidelné měření</h3><p>Do stránky Dnes se přidá jeden odkaz na měření pouze ve zvolené dny.</p></div></div>
        <div className="df2-body-filters">
          <label>Frekvence<select aria-label="Frekvence měření" value={store.schedule.frequency} disabled={blocked}
            onChange={e=>persist(s=>({...s,schedule:{...s.schedule,frequency:e.target.value as "off"|"daily"|"weekly"}}))}>
            <option value="off">Bez připomínání</option><option value="daily">Každý den</option>
            <option value="weekly">Jednou týdně</option></select></label>
          {store.schedule.frequency==="weekly"&&<label>Den v týdnu<select aria-label="Den měření" value={store.schedule.weekday} disabled={blocked}
            onChange={e=>persist(s=>({...s,schedule:{...s.schedule,weekday:Number(e.target.value)}}))}>
            {DAYS.map((d,i)=><option value={i} key={d}>{d}</option>)}</select></label>}
        </div>
        <p className="df2-body-status">{!status.due?"Dnes není plánovaná kontrola.":status.complete?"✓ Dnešní měření je zapsané.":"Dnes máš naplánované měření."}</p>
      </section>
      <section className="df2-body-section">
        <div className="df2-body-section-head"><h3>Osobní cíle</h3><button type="button" onClick={()=>setPanel("goals")}>Spravovat cíle →</button></div>
        {goals.filter(g=>g.active).length?goals.filter(g=>g.active).slice(0,3).map(g=>{
          const p=bodyGoalProgress(store,g,today);
          return <div className="df2-body-goal" key={g.id}><div><strong>{unit(g.metric).name} · {metricLabel(g.metric,g.target)}</strong>
            <small>{p.current===null?"Zatím bez měření":metricLabel(g.metric,p.current)+(p.reached?" · Cíl dosažen":" · aktuálně")}</small></div>
            {p.percent!==null&&<progress value={p.percent} max="100" aria-label={"Plnění cíle "+unit(g.metric).name}/>}</div>;
        }):<p className="df2-health-empty">Zatím nemáš vytvořený žádný cíl.</p>}
      </section>
    </div>}

    {panel==="measurements"&&<div className="df2-body-content">
      <section className="df2-body-section" data-body-editor>
        <div className="df2-body-section-head"><div><h3>{bodyEntryForDate(store,date)?"Upravit měření":"Nové měření"}</h3>
          <p>Můžeš vyplnit jen ty údaje, které skutečně měříš.</p></div></div>
        <label className="df2-body-date">Datum měření<input aria-label="Datum měření" type="date" max={today} value={date}
          onChange={e=>setSelectedDate(e.target.value)}/></label>
        <div className="df2-body-measure-grid">{BODY_METRICS.map(m=><label key={m.key}>{m.name} ({m.unit})
          <input type="number" aria-label={m.name} min={m.min} max={m.max} step=".1" inputMode="decimal"
            value={draft[m.key]??""} placeholder="—"
            onChange={e=>setDraft(d=>({...d,[m.key]:decimal(e.target.value)}))}/></label>)}</div>
        <label className="df2-body-note">Poznámka<textarea aria-label="Poznámka k měření" rows={2} maxLength={1500} value={note}
          onChange={e=>setNote(e.target.value)}/></label>
        <div className="df2-body-inline">
          <button className="df2-primary" type="button" disabled={blocked} onClick={saveEntry}>Uložit měření</button>
          <button type="button" onClick={()=>loadDate(today)}>Dnešní datum</button>
        </div>
      </section>
      <section className="df2-body-section"><h3>Historie měření</h3>
        {entries.length?<div className="df2-body-history">{entries.map(e=><article key={e.id} data-body-entry={e.date}>
          <div><time dateTime={e.date}>{dateLabel(e.date)}</time><strong>{BODY_METRICS.filter(m=>e.metrics[m.key]!==null)
            .map(m=>m.name+": "+metricLabel(m.key,e.metrics[m.key]!)).join(" · ")}</strong>
            {e.note&&<small>{e.note}</small>}</div>
          <div className="df2-body-inline"><button type="button" onClick={()=>loadDate(e.date)}>Upravit</button>
            <button type="button" disabled={blocked} onClick={()=>deleteEntry(e)}>Smazat</button></div>
        </article>)}</div>:<p className="df2-health-empty">Zatím nemáš uložené žádné tělesné měření.</p>}
      </section>
    </div>}

    {panel==="goals"&&<div className="df2-body-content">
      <section className="df2-body-section"><h3>Nový osobní cíl</h3>
        <div className="df2-body-filters">
          <label>Metrika<select aria-label="Metrika cíle" value={goalMetric} onChange={e=>setGoalMetric(e.target.value as BodyMetric)}>
            {BODY_METRICS.map(m=><option key={m.key} value={m.key}>{m.name}</option>)}</select></label>
          <label>Cílová hodnota ({unit(goalMetric).unit})<input type="number" min={unit(goalMetric).min}
            max={unit(goalMetric).max} step=".1" aria-label="Cílová hodnota" value={goalTarget}
            onChange={e=>setGoalTarget(e.target.value)}/></label>
          <label>Termín (nepovinný)<input type="date" min={today} value={goalDeadline}
            aria-label="Termín cíle" onChange={e=>setGoalDeadline(e.target.value)}/></label>
          <button type="button" className="df2-primary" disabled={blocked} onClick={addGoal}>+ Vytvořit cíl</button>
        </div>
        <p className="df2-health-helper">Výchozí hodnota se převezme z posledního zapsaného měření. Cíl je osobní evidence, nikoliv zdravotní doporučení.</p>
      </section>
      <section className="df2-body-section"><h3>Moje cíle</h3>
        {goals.length?<div className="df2-body-goals-list">{goals.map(g=>{
          const p=bodyGoalProgress(store,g,today);
          return <article key={g.id} data-body-goal={g.id}><div><strong>{unit(g.metric).name}: {metricLabel(g.metric,g.target)}</strong>
            <small>{g.deadline?"Do "+dateLabel(g.deadline)+" · ":""}{!g.active?"Pozastavený":p.reached?"Cíl dosažen":p.current===null?"Bez aktuální hodnoty":metricLabel(g.metric,p.current)+" aktuálně"}</small>
            {p.percent!==null&&<progress value={p.percent} max={100} aria-label={"Plnění cíle "+unit(g.metric).name}/>}</div>
            <div className="df2-body-inline"><button type="button" disabled={blocked} onClick={()=>persist(s=>({...s,goals:s.goals.map(x=>x.id===g.id?{...x,active:!x.active}:x)}))}>{g.active?"Pozastavit":"Aktivovat"}</button>
              <button type="button" disabled={blocked} onClick={()=>{if(window.confirm("Smazat tento cíl?"))persist(s=>({...s,goals:s.goals.filter(x=>x.id!==g.id)}));}}>Smazat</button></div>
          </article>;
        })}</div>:<p className="df2-health-empty">Zatím nemáš definovaný žádný cíl.</p>}
      </section>
    </div>}

    {panel==="photos"&&<div className="df2-body-content">
      <section className="df2-body-section">
        <h3>Soukromé progresové fotografie</h3>
        <p className="df2-health-helper">Fotografie zůstávají pouze v úložišti tohoto prohlížeče (IndexedDB). Nejsou odesílány na server ani synchronizovány mezi zařízeními. Při vymazání dat webu o ně můžeš přijít. Každou lze uložit samostatně.</p>
        <div className="df2-body-photo-editor">
          <label>Fotografie (JPG, PNG nebo WebP, max. 6 MB)<input type="file" accept="image/jpeg,image/png,image/webp"
            aria-label="Vybrat progresovou fotografii" onChange={e=>{setPhotoFile(e.target.files?.[0]??null);setEditError("");}}/></label>
          <label>Datum<input type="date" aria-label="Datum fotografie" max={today} value={photoDate}
            onChange={e=>setPhotoDate(e.target.value)}/></label>
          <label>Popisek (nepovinný)<input type="text" aria-label="Popisek fotografie" maxLength={300}
            value={photoCaption} onChange={e=>setPhotoCaption(e.target.value)}/></label>
          <button type="button" className="df2-primary" disabled={blocked||photoBusy||!photoFile}
            onClick={addPhoto}>{photoBusy?"Ukládání…":"Uložit fotografii"}</button>
        </div>
      </section>
      <section className="df2-body-section"><h3>Galerie</h3>
        {photos.length?<div className="df2-body-gallery">{photos.map(p=><PhotoTile key={p.id} photo={p} onRemove={removePhoto}/>)}</div>
          :<p className="df2-health-empty">Žádné fotografie. Přidávání je dobrovolné.</p>}
      </section>
    </div>}
  </section>;
}
