"use client";
import { useMemo, useState } from "react";
import {SupplementPhoto} from "./supplement-photo";
import {SupplementAutoLookup} from "./supplement-auto-lookup";
import type {SupplementLookupMatch} from "@/lib/dayframe-supplement-lookup";
import {deleteSupplementPhoto,saveSupplementPhoto,validSupplementPhoto} from "@/lib/dayframe-supplement-photos";
import {readSupplementStore} from "@/lib/dayframe-supplements";
import { useSupplementStore } from "./use-supplement-store";
import { buySupplement, lowStockSupplements, markSupplementIntake, newSupplement, supplementOccurrences,
  supplementStats, withSupplementSchedule, type Supplement } from "@/lib/dayframe-supplements";
import { addDaysKey } from "@/lib/dayframe-calendar";

type Tab="today"|"library"|"shopping"|"history";
const DAYS=["Ne","Po","Út","St","Čt","Pá","So"];
function czNum(n:number){return new Intl.NumberFormat("cs-CZ",{maximumFractionDigits:2}).format(n);}
function fromInput(v:string,min:number,max:number){return Math.min(max,Math.max(min,Number(v)||0));}
export function SupplementsPage({today}:{today:string}){
  const {store,hydrated,blocked,error,persist}=useSupplementStore();
  const [tab,setTab]=useState<Tab>("today");
  const [draft,setDraft]=useState<Supplement|null>(null);
  const [stockAtOpen,setStockAtOpen]=useState<number|null>(null);
  const [fieldsAtOpen,setFieldsAtOpen]=useState<Supplement|null>(null);
  const [scheduleAtOpen,setScheduleAtOpen]=useState<{times:string[];weekdays:number[];active:boolean}|null>(null);
  const [draftTimes,setDraftTimes]=useState("");
  const [photoFile,setPhotoFile]=useState<File|null>(null);
  const [photoAction,setPhotoAction]=useState<"keep"|"replace"|"remove">("keep");
  const [photoBusy,setPhotoBusy]=useState(false);
  const [autoPhotoBusy,setAutoPhotoBusy]=useState(false);
  const [photoManual,setPhotoManual]=useState(false);
  const [lookupHint,setLookupHint]=useState<string|null>(null);
  const [search,setSearch]=useState("");
  const [editError,setEditError]=useState("");
  const [notice,setNotice]=useState("");
  const due=useMemo(()=>supplementOccurrences(store,today),[store,today]);
  const takenCount=due.filter(x=>x.intake?.status==="taken").length;
  const skippedCount=due.filter(x=>x.intake?.status==="skipped").length;
  const pendingCount=due.length-takenCount-skippedCount;
  const dueGroups=useMemo(()=>{
    const groups:Array<{time:string;items:typeof due}>=[];
    for(const occurrence of due){
      const last=groups[groups.length-1];
      if(last?.time===occurrence.time)last.items.push(occurrence);
      else groups.push({time:occurrence.time,items:[occurrence]});
    }
    return groups;
  },[due]);
  const low=useMemo(()=>lowStockSupplements(store),[store]);
  const stats=useMemo(()=>supplementStats(store,addDaysKey(today,-29),today),[store,today]);
  const records=store.intakes.filter(x=>x.date>=addDaysKey(today,-29)&&x.date<=today)
    .slice().sort((a,b)=>b.date.localeCompare(a.date)||b.time.localeCompare(a.time));
  const showEdit=(item:Supplement)=>{
    setDraft({...item,weekdays:[...item.weekdays],times:[...item.times]});
    setStockAtOpen(item.stock);
    setFieldsAtOpen({...item,weekdays:[...item.weekdays],times:[...item.times]});
    setScheduleAtOpen({times:[...item.times],weekdays:[...item.weekdays],active:item.active});
    setDraftTimes(item.times.join(", "));
    setPhotoFile(null);setPhotoAction("keep");
    setPhotoManual(false);setAutoPhotoBusy(false);setLookupHint(null);
    setEditError("");
  };
  const acceptLookup=(match:SupplementLookupMatch)=>{
    setDraft(current=>{
      if(!current)return current;
      const newItem=!store.supplements.some(s=>s.id===current.id);
      return {...current,name:match.name.slice(0,160),brand:match.brand.slice(0,100),
        sourceUrl:match.sourceUrl.slice(0,700),
        packServings:newItem&&current.packServings===30&&match.packServings!==null
          ?match.packServings:current.packServings,
        units:newItem&&current.units==="kapsle"&&match.packUnit
          ?match.packUnit:current.units,
        packPriceCzk:current.packPriceCzk??match.priceCzk};
    });
    setEditError("");
  };
  const saveDraft=async()=>{
    if(!draft||photoBusy||autoPhotoBusy||blocked)return;
    const times=[...new Set(draftTimes.split(/[;,\n]+/).map(s=>s.trim()).filter(Boolean))].sort();
    if(!draft.name.trim()){setEditError("Zadej název suplementu.");return;}
    if(!draft.doseLabel.trim()){setEditError("Doplň dávku přesně podle obalu nebo doporučení odborníka.");return;}
    if(!times.length||times.some(t=>! /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(t))){
      setEditError("Zadej čas ve formátu HH:MM, případně více časů oddělených čárkou.");return;
    }
    if(!draft.weekdays.length){setEditError("Vyber alespoň jeden den v týdnu.");return;}
    if(draft.stock!==null&&draft.stock<0){setEditError("Zásoba nemůže být záporná.");return;}
    if(photoAction==="replace"&&(!photoFile||!validSupplementPhoto(photoFile))){
      setEditError("Vyber JPG, PNG nebo WebP do 6 MB.");return;
    }
    const item={...draft,name:draft.name.trim(),brand:draft.brand.trim(),doseLabel:draft.doseLabel.trim(),
      weekdays:[...draft.weekdays].sort(),times};
    let newPhotoId:string|undefined;
    let committed=false;
    setPhotoBusy(true);setEditError("");
    try{
      if(photoAction==="replace"&&photoFile){
        newPhotoId="supp-photo-"+crypto.randomUUID();
        await saveSupplementPhoto(newPhotoId,photoFile);
      }
      const ok=persist(s=>{
      const current=s.supplements.find(x=>x.id===item.id);
      if(photoAction!=="keep" && (current?.photoId??undefined)!==(fieldsAtOpen?.photoId??undefined))return null;
      // The editor may have been open while another tab logged an intake or
      // purchase. Preserve the latest stock unless the user explicitly edited it.
      const explicitlyChangedStock=item.stock!==stockAtOpen;
      const stock=current&&!explicitlyChangedStock?current.stock:item.stock;
      const activeEdited=!scheduleAtOpen || item.active!==scheduleAtOpen.active;
      const weekdaysEdited=!scheduleAtOpen || [...item.weekdays].sort().join(",")!==[...scheduleAtOpen.weekdays].sort().join(",");
      const timesEdited=!scheduleAtOpen || item.times.join(",")!==[...scheduleAtOpen.times].sort().join(",");
      // Rebase each untouched editor field onto the latest persisted value.
      // A different tab may have changed the shopping flag, pack size, price,
      // notes or dose while this modal was open. Only explicitly edited fields
      // should win; never write the stale full draft over concurrent changes.
      const rebased:Supplement=current?{...current}:{...item};
      const editableFields=["name","brand","doseLabel","servingsPerIntake","units",
        "lowStockAt","packServings","packPriceCzk","sourceUrl","notes"] as const;
      for(const field of editableFields) {
        if(!fieldsAtOpen || item[field]!==fieldsAtOpen[field]) {
          Object.assign(rebased,{[field]:item[field]});
        }
      }
      if(photoAction==="replace")rebased.photoId=newPhotoId;
      if(photoAction==="remove")delete rebased.photoId;
      // Shopping is changed outside this modal, so always retain latest state.
      // Schedule properties must be merged independently: pausing a supplement
      // in one tab must not revert a newly saved time or weekday in another.
      rebased.stock=stock;
      if(activeEdited)rebased.active=item.active;
      if(weekdaysEdited)rebased.weekdays=[...item.weekdays];
      if(timesEdited)rebased.times=[...item.times];
      const scheduled=withSupplementSchedule(rebased,today,current);
      const resetBaseline=!!current && (explicitlyChangedStock || (current.stock===null)!==(stock===null));
      return {...s,
        supplements:current?s.supplements.map(x=>x.id===item.id?scheduled:x):[...s.supplements,scheduled],
        // Absolute recounts and tracking changes create a new stock baseline:
        // undoing an older intake must not add a phantom serving to it.
        intakes:resetBaseline?s.intakes.map(x=>x.supplementId===item.id?
          {...x,stockDeducted:0}:x):s.intakes};
      });
      if(!ok){
        setEditError("Suplement nebo fotografii se nepodařilo uložit. Záznam zůstal zachovaný.");
        return;
      }
      committed=true;
      setDraft(null);setPhotoFile(null);setPhotoAction("keep");setEditError("");setNotice("");
      const oldId=fieldsAtOpen?.photoId;
      if(photoAction!=="keep"&&oldId&&oldId!==newPhotoId){
        const current=readSupplementStore();
        if(!current.blocked&&!current.store.supplements.some(x=>x.photoId===oldId)){
          try{await deleteSupplementPhoto(oldId);}
          catch{setNotice("Změna je uložená, starou kopii fotografie se nepodařilo odstranit.");}
        }
      }
    }catch{
      if(!committed)setEditError("Fotografii nelze uložit. Zkus menší JPG, PNG nebo WebP; uložené údaje zůstaly zachované.");
    }finally{
      if(!committed&&newPhotoId){try{await deleteSupplementPhoto(newPhotoId);}catch{/* Unreferenced upload. */}}
      setPhotoBusy(false);
    }
  };
  const mark=(key:string,status:"taken"|"skipped")=>{
    const before=store.intakes.find(x=>x.key===key);
    const preview=markSupplementIntake(store,key,status);
    if(preview===store){setNotice("Nedostatečná zásoba pro potvrzení dávky. Nejprve uprav zásoby nebo potvrď nákup.");return;}
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
      <div><span>ZDRAVÍ · DENNÍ REŽIM</span><h2>Suplementy</h2><p>Dnešní dávky, moje produkty a zásoby na jednom místě.</p></div>
      <button type="button" className="df2-accent-button" disabled={blocked} onClick={()=>showEdit({...newSupplement(""),doseLabel:""})}>+ Přidat suplement</button>
    </header>
    <nav className="df2-supplements-nav" aria-label="Suplementy navigace">
      {([["today","Dnes"],["library","Moje suplementy"],["shopping","K nákupu"],["history","Historie"]] as const).map(([value,label])=>
        <button type="button" key={value} aria-current={tab===value?"page":undefined} onClick={()=>setTab(value)}>{label}{value==="shopping"&&low.length>0?" ("+low.length+")":""}</button>)}
    </nav>
    {(blocked||error||notice)&&<p className={blocked||error?"df2-hygiene-error":"df2-supplements-notice"} role="status">
      {blocked?"Uložená data suplementů nelze bezpečně načíst. Změny jsou zablokované.":error||notice}</p>}
    {tab==="today"&&<div className="df2-supplements-main" data-supplements-today>
      <div className="df2-supplements-overview">
        <div className="df2-supplements-overview-copy">
          <span>DENNÍ PŘEHLED</span>
          <h3><strong>{takenCount}</strong><span> / {due.length}</span> dávek užito</h3>
          <p>{!due.length?"Na dnešek nemáš žádné plánované dávky.":pendingCount===0?"Dnešní dávky jsou vyřízené.":`Zbývá ${pendingCount} ${pendingCount===1?"dávka":pendingCount<5?"dávky":"dávek"} k potvrzení.`}</p>
        </div>
        <div className="df2-supplements-overview-progress">
          <strong>{due.length?Math.round(takenCount/due.length*100):0} %</strong>
          <div className="df2-supplements-progress-track" role="progressbar" aria-label="Dnes užité dávky"
            aria-valuemin={0} aria-valuemax={due.length||1} aria-valuenow={takenCount}>
            <span style={{width:(due.length?100*takenCount/due.length:0)+"%"}}/>
          </div>
          <div className="df2-supplements-overview-detail">
            <span>Čeká <strong>{pendingCount}</strong></span>
            <span>Vynecháno <strong>{skippedCount}</strong></span>
            {low.length>0&&<button type="button" onClick={()=>setTab("shopping")}>Dokoupit <strong>{low.length}</strong> ↗</button>}
          </div>
        </div>
      </div>
      {due.length?<div className="df2-supplements-groups">
        {dueGroups.map(group=><section className="df2-supplements-time-group" key={group.time} aria-label={"Dávky v "+group.time}>
          <div className="df2-supplements-group-heading">
            <h3><time dateTime={today+"T"+group.time}>{group.time}</time></h3>
            <span>{group.items.length} {group.items.length===1?"dávka":group.items.length<5?"dávky":"dávek"}</span>
          </div>
          <div className="df2-supplements-due">
            {group.items.map(x=><article className={"df2-supplements-dose-card"+(x.intake?.status?" is-"+x.intake.status:"")}
              key={x.key} data-supplement-occurrence={x.key} data-intake-status={x.intake?.status??"pending"}>
              <div className="df2-supplements-dose-body">
                <SupplementPhoto photoId={x.supplement.photoId} name={x.supplement.name}/>
                <div className="df2-supplements-due-copy">
                  <div className="df2-supplements-dose-status">
                    {x.intake?.status==="taken"?<span className="is-taken">✓ Užito</span>:
                      x.intake?.status==="skipped"?<span className="is-skipped">Vynecháno</span>:<span>Naplánováno</span>}
                  </div>
                  <strong>{x.supplement.name}</strong>
                  <small>{x.supplement.brand||"Bez značky"} · {x.supplement.doseLabel}</small>
                  {x.supplement.stock!==null&&<small className="df2-supplements-stock-note">Zbývá {czNum(x.supplement.stock)} {x.supplement.units}</small>}
                </div>
              </div>
              <div className="df2-supplements-due-actions">
                <button type="button" disabled={blocked} aria-pressed={x.intake?.status==="taken"}
                  onClick={()=>mark(x.key,"taken")}>{x.intake?.status==="taken"?"✓ Užito":"Užito"}</button>
                <button type="button" disabled={blocked} aria-pressed={x.intake?.status==="skipped"}
                  onClick={()=>mark(x.key,"skipped")}>{x.intake?.status==="skipped"?"✓ Vynecháno":"Vynechat"}</button>
              </div>
            </article>)}
          </div>
        </section>)}
      </div>:<div className="df2-supplements-empty"><strong>Pro dnešek máš hotovo.</strong><span>Nemáš naplánované žádné dávky. Rozvrh můžeš změnit v Moje suplementy.</span>
        <button type="button" onClick={()=>setTab("library")}>Moje suplementy →</button></div>}
      <p className="df2-health-helper df2-supplements-footnote">Užití a vynechání se promítá do denního přehledu i historie. Dávkování nastavuj podle etikety nebo doporučení odborníka.</p>
    </div>}
    {tab==="library"&&<div className="df2-supplements-main">
      <input type="search" placeholder="Hledat suplement podle názvu nebo značky" aria-label="Hledat suplement"
        value={search} onChange={e=>setSearch(e.target.value)}/>
      <div className="df2-supplements-library" data-supplements-library>
        {store.supplements.filter(x=>(x.name+" "+x.brand).toLocaleLowerCase("cs").includes(search.toLocaleLowerCase("cs")))
          .sort((a,b)=>a.name.localeCompare(b.name,"cs")).map(item=><article key={item.id} data-supplement-id={item.id}>
            <SupplementPhoto photoId={item.photoId} name={item.name}/>
            <div className="df2-supplements-library-copy">
              <span className={"df2-supplements-product-status"+(!item.active?" is-paused":"")}>{item.active?"● Aktivní":"Pozastaveno"}</span>
              <h3>{item.name}</h3><p>{item.brand||"Bez značky"}</p>
              <small>{item.doseLabel} · {item.times.join(", ")}</small>
              <small>{item.stock===null?"Zásoby nesledovány":"Na skladě "+czNum(item.stock)+" "+item.units}</small>
              {!!item.notes&&<p className="df2-supplements-note">{item.notes}</p>}
            </div>
            <div className="df2-supplements-card-actions">
              <button type="button" className="df2-supplements-edit-action" onClick={()=>showEdit(item)}>Upravit</button>
              <button type="button" disabled={blocked} onClick={()=>persist(s=>({...s,supplements:s.supplements.map(x=>x.id===item.id?
                withSupplementSchedule({...x,active:!x.active},today,x):x)}))}>
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
          <SupplementPhoto photoId={item.photoId} name={item.name}/>
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
    {draft&&<div className="df2-modal-backdrop" onMouseDown={e=>{if(!photoBusy&&!autoPhotoBusy&&e.target===e.currentTarget)setDraft(null);}}>
      <section className="df2-modal df2-hygiene-modal df2-supplements-editor" role="dialog" aria-modal="true" aria-label="Editor suplementu">
        <header><div><h2>{store.supplements.some(x=>x.id===draft.id)?"Upravit suplement":"Nový suplement"}</h2></div>
          <button type="button" aria-label="Zavřít" disabled={photoBusy||autoPhotoBusy} onClick={()=>setDraft(null)}>×</button></header>
        <SupplementAutoLookup hint={lookupHint} onApply={acceptLookup}
          manualPhoto={photoManual} onBusy={setAutoPhotoBusy}
          onPhoto={file=>{if(!photoManual){setPhotoFile(file);setPhotoAction("replace");}}}/>
        <div className="df2-supplements-photo-editor">
          <SupplementPhoto large photoId={photoAction==="remove"?undefined:draft.photoId} previewFile={photoAction==="replace"?photoFile:null} name={draft.name||"suplementu"}/>
          <div className="df2-supplements-photo-inputs">
            <strong>Fotografie produktu</strong>
            <small>Přidej vlastní fotku balení. JPG, PNG nebo WebP do 6 MB. Zůstane jen v tomto prohlížeči.</small>
            <label className="df2-supplements-upload">Vybrat fotografii
              <input type="file" accept="image/jpeg,image/png,image/webp" aria-label="Nahrát fotografii suplementu"
                disabled={photoBusy||blocked} onChange={e=>{
                  const file=e.target.files?.[0];e.currentTarget.value="";
                  if(!file)return;
                  if(!validSupplementPhoto(file)){setEditError("Vyber JPG, PNG nebo WebP do 6 MB.");return;}
                  setPhotoManual(true);setPhotoFile(file);setPhotoAction("replace");setEditError("");
                }}/>
            </label>
            {(photoAction==="replace"||photoAction!=="remove"&&!!draft.photoId)&&
              <button type="button" className="df2-supplements-remove-photo" disabled={photoBusy||blocked}
                onClick={()=>{setPhotoManual(true);setPhotoFile(null);setPhotoAction("remove");}}>Odebrat fotografii</button>}
          </div>
        </div>
        <div className="df2-supplements-editor-fields">
          <label>Název<input autoFocus aria-label="Název suplementu" value={draft.name} maxLength={160}
            onChange={e=>{setDraft({...draft,name:e.target.value});setLookupHint(e.target.value);}}/></label>
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
            onChange={e=>{setDraft({...draft,sourceUrl:e.target.value});setLookupHint(e.target.value);}}/></label>
          <label>Poznámky a upozornění<textarea aria-label="Poznámky suplementu" rows={2} value={draft.notes} maxLength={1500}
            onChange={e=>setDraft({...draft,notes:e.target.value})}/></label>
        </div>
        <p className="df2-health-helper">Zadávej jen dávkování potvrzené etiketou nebo odborníkem. Změny rozvrhu a pozastavení se projeví od následujícího dne, aby dnešní historie zůstala zachovaná. U interakcí s léky, zdravotních omezení či nejasností se poraď s lékárníkem nebo lékařem.</p>
        {editError&&<p className="df2-hygiene-error" role="alert">{editError}</p>}
        <div className="df2-modal-actions"><button className="df2-primary" disabled={blocked||photoBusy||autoPhotoBusy} type="button" onClick={saveDraft}>{photoBusy?"Ukládám…":"Uložit suplement"}</button></div>
      </section>
    </div>}
  </section>;
}