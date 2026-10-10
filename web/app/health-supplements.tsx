"use client";
import { useMemo, useState } from "react";
import { useSupplementStore } from "./use-supplement-store";
import { buySupplement, lowStockSupplements, markSupplementIntake, newSupplement, supplementOccurrences,
  supplementStats, type Supplement } from "@/lib/dayframe-supplements";
import { addDaysKey } from "@/lib/dayframe-calendar";

type Tab="today"|"library"|"shopping"|"history";
const DAYS=["Ne","Po","Út","St","Čt","Pá","So"];
function czNum(n:number){return new Intl.NumberFormat("cs-CZ",{maximumFractionDigits:2}).format(n);}
function fromInput(v:string,min:number,max:number){return Math.min(max,Math.max(min,Number(v)||0));}
export function SupplementsPage({today}:{today:string}){
  const {store,hydrated,blocked,error,persist}=useSupplementStore();
  const [tab,setTab]=useState<Tab>("today");
  const [draft,setDraft]=useState<Supplement|null>(null);
  const [draftTimes,setDraftTimes]=useState("");
  const [search,setSearch]=useState("");
  const [editError,setEditError]=useState("");
  const [notice,setNotice]=useState("");
  const due=useMemo(()=>supplementOccurrences(store,today),[store,today]);
  const low=useMemo(()=>lowStockSupplements(store),[store]);
  const stats=useMemo(()=>supplementStats(store,addDaysKey(today,-29),today),[store,today]);
  const records=store.intakes.filter(x=>x.date<=today).slice().sort((a,b)=>b.date.localeCompare(a.date)||b.time.localeCompare(a.time)).slice(0,70);
  const showEdit=(item:Supplement)=>{
    setDraft({...item,weekdays:[...item.weekdays],times:[...item.times]});
    setDraftTimes(item.times.join(", "));
    setEditError("");
  };
  const saveDraft=()=>{
    if(!draft)return;
    const times=[...new Set(draftTimes.split(/[;,\n]+/).map(s=>s.trim()).filter(Boolean))].sort();
    if(!draft.name.trim()){setEditError("Zadej název suplementu.");return;}
    if(!draft.doseLabel.trim()){setEditError("Doplň dávku přesně podle obalu nebo doporučení odborníka.");return;}
    if(!times.length||times.some(t=>! /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(t))){
      setEditError("Zadej čas ve formátu HH:MM, případně více časů oddělených čárkou.");return;
    }
    if(!draft.weekdays.length){setEditError("Vyber alespoň jeden den v týdnu.");return;}
    if(draft.stock!==null&&draft.stock<0){setEditError("Zásoba nemůže být záporná.");return;}
    const item={...draft,name:draft.name.trim(),brand:draft.brand.trim(),doseLabel:draft.doseLabel.trim(),
      weekdays:[...draft.weekdays].sort(),times};
    const ok=persist(s=>({...s,supplements:s.supplements.some(x=>x.id===item.id)
      ?s.supplements.map(x=>x.id===item.id?item:x):[...s.supplements,item]}));
    if(ok){setDraft(null);setEditError("");setNotice("");}
  };
  const mark=(key:string,status:"taken"|"skipped")=>{
    const before=store.intakes.find(x=>x.key===key);
    const ok=persist(s=>markSupplementIntake(s,key,status));
    const after=before?.status===status?"Záznam byl vrácen do nesplněného stavu.":"Záznam byl uložen.";
    if(ok)setNotice(after);
  };
  const stockAdjust=(item:Supplement,amount:number)=>{
    if(item.stock===null)return;
    persist(s=>({...s,supplements:s.supplements.map(x=>x.id===item.id?{...x,stock:Math.min(1000000,Math.max(0,(x.stock??0)+amount))}:x)}));
  };
  if(!hydrated)return <section className="df2-supplements">Načítám suplementy…</section>;
  return <section className="df2-supplements" aria-label="Suplementy">
    <header className="df2-supplements-head">
      <div><span>ETAPA 3 · EVIDENCE</span><h2>Suplementy</h2><p>Dávky přepisuj podle etikety nebo doporučení odborníka. Aplikace je sama neurčuje.</p></div>
      <button type="button" className="df2-accent-button" disabled={blocked} onClick={()=>showEdit({...newSupplement(""),doseLabel:""})}>+ Přidat suplement</button>
    </header>
    <nav className="df2-supplements-nav" aria-label="Suplementy navigace">
      {([["today","Dnes"],["library","Moje suplementy"],["shopping","K nákupu"],["history","Historie"]] as const).map(([value,label])=>
        <button type="button" key={value} aria-current={tab===value?"page":undefined} onClick={()=>setTab(value)}>{label}{value==="shopping"&&low.length>0?" ("+low.length+")":""}</button>)}
    </nav>
    {(blocked||error||notice)&&<p className={blocked||error?"df2-hygiene-error":"df2-supplements-notice"} role="status">
      {blocked?"Uložená data suplementů nelze bezpečně načíst. Změny jsou zablokované.":error||notice}</p>}
    {tab==="today"&&<div className="df2-supplements-main">
      <div className="df2-supplements-stats"><article><small>Naplánováno</small><strong>{due.length}</strong></article>
        <article><small>Užito</small><strong>{due.filter(x=>x.intake?.status==="taken").length}</strong></article>
        <article><small>K nákupu</small><strong>{low.length}</strong></article></div>
      {due.length?<div className="df2-supplements-due">
        {due.map(x=><article key={x.key} data-supplement-occurrence={x.key}>
          <div className="df2-supplements-due-copy">
            <time dateTime={today+"T"+x.time}>{x.time}</time><strong>{x.supplement.name}</strong>
            <small>{x.supplement.brand||"Bez značky"} · {x.supplement.doseLabel}</small>
            {x.supplement.stock!==null&&<small>Zbývá {czNum(x.supplement.stock)} {x.supplement.units}</small>}
          </div>
          <div className="df2-supplements-due-actions">
            <button type="button" disabled={blocked} aria-pressed={x.intake?.status==="taken"}
              onClick={()=>mark(x.key,"taken")}>{x.intake?.status==="taken"?"✓ Užito":"Užito"}</button>
            <button type="button" disabled={blocked} aria-pressed={x.intake?.status==="skipped"}
              onClick={()=>mark(x.key,"skipped")}>{x.intake?.status==="skipped"?"✓ Vynecháno":"Vynechat"}</button>
          </div>
        </article>)}
      </div>:<p className="df2-health-empty">Na dnešek nemáš naplánované suplementy. Přidej první nebo uprav jejich rozvrh.</p>}
      <p className="df2-health-helper">Odškrtnutí dávky se promítne i na stránku Dnes. Sledované zásoby se odečítají jen po potvrzení užití a při vrácení záznamu se opraví.</p>
    </div>}
    {tab==="library"&&<div className="df2-supplements-main">
      <input type="search" placeholder="Hledat suplement podle názvu nebo značky" aria-label="Hledat suplement"
        value={search} onChange={e=>setSearch(e.target.value)}/>
      <div className="df2-supplements-library">
        {store.supplements.filter(x=>(x.name+" "+x.brand).toLocaleLowerCase("cs").includes(search.toLocaleLowerCase("cs")))
          .sort((a,b)=>a.name.localeCompare(b.name,"cs")).map(item=><article key={item.id} data-supplement-id={item.id}>
            <div><span>{item.active?"Aktivní":"Pozastaveno"}</span><h3>{item.name}</h3><p>{item.brand||"Bez značky"}</p>
              <small>{item.doseLabel} · {item.times.join(", ")}</small>
              <small>{item.stock===null?"Zásoby nejsou sledované":"Na skladě "+czNum(item.stock)+" "+item.units}</small>
              {!!item.notes&&<p>{item.notes}</p>}
            </div>
            <div className="df2-supplements-card-actions">
              <button type="button" onClick={()=>showEdit(item)}>Upravit</button>
              <button type="button" disabled={blocked} onClick={()=>persist(s=>({...s,supplements:s.supplements.map(x=>x.id===item.id?{...x,active:!x.active}:x)}))}>
                {item.active?"Pozastavit":"Aktivovat"}</button>
              <button type="button" disabled={blocked} onClick={()=>persist(s=>({...s,supplements:s.supplements.map(x=>x.id===item.id?{...x,shopping:!x.shopping}:x)}))}>
                {item.shopping?"Odebrat z nákupu":"Přidat k nákupu"}</button>
              {item.stock!==null&&<div className="df2-supplements-stock-actions">
                <button type="button" aria-label={"Odebrat jednotku "+item.name} onClick={()=>stockAdjust(item,-1)} disabled={blocked}>−</button>
                <button type="button" aria-label={"Přidat jednotku "+item.name} onClick={()=>stockAdjust(item,1)} disabled={blocked}>+</button>
              </div>}
            </div>
          </article>)}
      </div>
      {!store.supplements.length&&<p className="df2-health-empty">Zatím nemáš uložené žádné suplementy.</p>}
    </div>}
    {tab==="shopping"&&<div className="df2-supplements-main">
      <div className="df2-gym-section-head"><h3>K nákupu a zásoby</h3></div>
      {low.length?<div className="df2-supplements-shopping">
        {low.map(item=><article key={item.id}>
          <div><strong>{item.name}</strong><small>{item.stock===null?"Ruční seznam":"Na skladě "+czNum(item.stock)+" / minimum "+item.lowStockAt}</small>
            <small>Balení: {item.packServings} {item.units}{item.packPriceCzk!==null?" · "+czNum(item.packPriceCzk)+" Kč":""}</small></div>
          <div className="df2-supplements-card-actions">
            {item.sourceUrl.startsWith("https://")&&<a href={item.sourceUrl} target="_blank" rel="noreferrer">Otevřít produkt ↗</a>}
            <button type="button" disabled={blocked||item.stock===null}
              onClick={()=>persist(s=>buySupplement(s,item.id,today))}>Potvrdit nákup (+ balení)</button>
            <button type="button" disabled={blocked} onClick={()=>persist(s=>({...s,supplements:s.supplements.map(x=>x.id===item.id?{...x,shopping:false}:x)}))}>Odebrat ze seznamu</button>
          </div>
        </article>)}
      </div>:<p className="df2-health-empty">Žádný suplement není pod minimální zásobou ani ručně označený k nákupu.</p>}
      <p className="df2-health-helper">Nákup přičítá pouze deklarovanou velikost balení. Automatický nákup ani objednávky neprovádíme.</p>
    </div>}
    {tab==="history"&&<div className="df2-supplements-main" data-supplements-history>
      <div className="df2-gym-section-head"><h3>Posledních 30 dní</h3></div>
      <div className="df2-supplements-stats"><article><small>Plánované dávky</small><strong>{stats.planned}</strong></article>
        <article><small>Užito</small><strong>{stats.taken}</strong></article>
        <article><small>Vynecháno</small><strong>{stats.skipped}</strong></article></div>
      {records.length?<div className="df2-supplements-history">
        {records.map(r=><div key={r.key}><time dateTime={r.date}>{r.date} · {r.time}</time>
          <strong>{store.supplements.find(x=>x.id===r.supplementId)?.name||"Dřívější suplement"}</strong>
          <span>{r.status==="taken"?"✓ Užito":"Vynecháno"}</span></div>)}
      </div>:<p className="df2-health-empty">Historie zatím neobsahuje žádné záznamy.</p>}
      {store.purchases.length>0&&<><h3>Historie nákupů</h3><div className="df2-supplements-history">
        {store.purchases.slice().reverse().map(p=><div key={p.id}><time dateTime={p.date}>{p.date}</time>
          <strong>{store.supplements.find(x=>x.id===p.supplementId)?.name||"Dřívější suplement"}</strong>
          <span>+ {czNum(p.servings)}{p.paidCzk===null?"":" · "+czNum(p.paidCzk)+" Kč"}</span></div>)}</div></>}
    </div>}
    {draft&&<div className="df2-modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setDraft(null);}}>
      <section className="df2-modal df2-hygiene-modal df2-supplements-editor" role="dialog" aria-modal="true" aria-label="Editor suplementu">
        <header><div><h2>{store.supplements.some(x=>x.id===draft.id)?"Upravit suplement":"Nový suplement"}</h2></div>
          <button type="button" aria-label="Zavřít" onClick={()=>setDraft(null)}>×</button></header>
        <div className="df2-supplements-editor-fields">
          <label>Název<input autoFocus aria-label="Název suplementu" value={draft.name} maxLength={160}
            onChange={e=>setDraft({...draft,name:e.target.value})}/></label>
          <label>Značka<input aria-label="Značka suplementu" value={draft.brand} maxLength={100}
            onChange={e=>setDraft({...draft,brand:e.target.value})}/></label>
          <label>Dávka dle obalu / odborníka<input aria-label="Dávkování" placeholder="Přepiš dávku, ne automatický návrh" value={draft.doseLabel} maxLength={240}
            onChange={e=>setDraft({...draft,doseLabel:e.target.value})}/></label>
          <label>Počet jednotek v dávce<input type="number" min=".01" max="10000" step=".5" aria-label="Jednotek v dávce" value={draft.servingsPerIntake}
            onChange={e=>setDraft({...draft,servingsPerIntake:fromInput(e.target.value,.01,10000)})}/></label>
          <label>Jednotka<input aria-label="Jednotka suplementu" value={draft.units} maxLength={50}
            onChange={e=>setDraft({...draft,units:e.target.value})}/></label>
          <label>Časy (HH:MM, více odděl čárkou)<input aria-label="Časy užívání" value={draftTimes}
            onChange={e=>setDraftTimes(e.target.value)}/></label>
        </div>
        <fieldset className="df2-supplements-weekdays"><legend>Dny užívání</legend>
          {DAYS.map((label,n)=><label key={n}><input type="checkbox" checked={draft.weekdays.includes(n)}
            onChange={e=>setDraft({...draft,weekdays:e.target.checked?[...draft.weekdays,n]:draft.weekdays.filter(x=>x!==n)})}/>{label}</label>)}
        </fieldset>
        <label className="df2-hygiene-switch"><input type="checkbox" checked={draft.active}
          onChange={e=>setDraft({...draft,active:e.target.checked})}/>Aktivní</label>
        <div className="df2-supplements-editor-fields">
          <label className="df2-hygiene-switch"><input type="checkbox" checked={draft.stock!==null}
            onChange={e=>setDraft({...draft,stock:e.target.checked?0:null})}/>Sledovat zásoby</label>
          {draft.stock!==null&&<label>Aktuální zásoba<input type="number" min="0" max="1000000" step=".5"
            aria-label="Aktuální zásoba" value={draft.stock} onChange={e=>setDraft({...draft,stock:fromInput(e.target.value,0,1000000)})}/></label>}
          <label>Minimum zásoby<input type="number" min="0" max="1000000" aria-label="Minimální zásoba"
            value={draft.lowStockAt} onChange={e=>setDraft({...draft,lowStockAt:fromInput(e.target.value,0,1000000)})}/></label>
          <label>Počet jednotek v balení<input type="number" min=".01" step="1" aria-label="Velikost balení"
            value={draft.packServings} onChange={e=>setDraft({...draft,packServings:fromInput(e.target.value,.01,1000000)})}/></label>
          <label>Cena balení Kč (nepovinné)<input type="number" min="0" step="1" aria-label="Cena balení"
            value={draft.packPriceCzk??""} onChange={e=>setDraft({...draft,packPriceCzk:e.target.value?fromInput(e.target.value,0,1000000):null})}/></label>
          <label>Odkaz na produkt (nepovinné)<input type="url" aria-label="Odkaz na suplement" value={draft.sourceUrl}
            onChange={e=>setDraft({...draft,sourceUrl:e.target.value})}/></label>
          <label>Poznámky a upozornění<textarea aria-label="Poznámky suplementu" rows={2} value={draft.notes} maxLength={1500}
            onChange={e=>setDraft({...draft,notes:e.target.value})}/></label>
        </div>
        <p className="df2-health-helper">Zadávej jen dávkování potvrzené etiketou nebo odborníkem. U interakcí s léky, zdravotních omezení či nejasností se poraď s lékárníkem nebo lékařem.</p>
        {editError&&<p className="df2-hygiene-error" role="alert">{editError}</p>}
        <div className="df2-modal-actions"><button className="df2-primary" disabled={blocked} type="button" onClick={saveDraft}>Uložit suplement</button></div>
      </section>
    </div>}
  </section>;
}