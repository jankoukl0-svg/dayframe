"use client";
import {useEffect,useMemo,useState} from "react";
import {
  PREVENTION_CATEGORIES,PREVENTION_REMIND_DAYS,PREVENTION_REPEAT_MONTHS,
  completePrevention,createPreventionItem,newPreventionDraft,preventionCategoryLabel,
  preventionHistory,preventionTodayRows,updatePreventionItem,validPreventionDraft,
  type PreventionDraft,type PreventionItem
} from "@/lib/dayframe-prevention";
import {usePreventionStore} from "./use-prevention-store";

type Editor={id:string|null;draft:PreventionDraft;baseline:PreventionDraft};
const dateLabel=(key:string)=>new Intl.DateTimeFormat("cs-CZ",{day:"numeric",month:"short",year:"numeric"}).format(new Date(key+"T12:00:00"));
function itemDraft(item:PreventionItem):PreventionDraft{
  return {title:item.title,category:item.category,provider:item.provider,dueDate:item.dueDate,
    reminderDays:item.reminderDays,repeatMonths:item.repeatMonths,active:item.active,notes:item.notes};
}
const statusLabel=(date:string|null,today:string)=>{
  if(!date)return "Bez dalšího termínu";
  if(date<today)return "Po termínu";
  if(date===today)return "Dnes";
  return "Naplánováno";
};

export function PreventionPage({today,focusId,onFocusHandled}:{
  today:string;focusId?:string|null;onFocusHandled?:()=>void;
}){
  const {store,hydrated,blocked,error,persist}=usePreventionStore();
  const [panel,setPanel]=useState<"overview"|"history">("overview");
  const [editor,setEditor]=useState<Editor|null>(null);
  const [completeId,setCompleteId]=useState<string|null>(null);
  const [completeDate,setCompleteDate]=useState(today);
  const [completeNote,setCompleteNote]=useState("");
  const [formError,setFormError]=useState("");
  const [notice,setNotice]=useState("");
  const [showPaused,setShowPaused]=useState(false);
  const active=useMemo(()=>store.items.filter(i=>i.active).slice().sort((a,b)=>
    (a.dueDate??"9999-12-31").localeCompare(b.dueDate??"9999-12-31")
    ||a.title.localeCompare(b.title,"cs")),[store.items]);
  const paused=useMemo(()=>store.items.filter(i=>!i.active).slice().sort((a,b)=>a.title.localeCompare(b.title,"cs")),[store.items]);
  const history=useMemo(()=>preventionHistory(store),[store]);
  const todayRows=useMemo(()=>preventionTodayRows(store,today),[store,today]);
  const overdue=active.filter(i=>i.dueDate!==null&&i.dueDate<today).length;
  const upcoming=active.filter(i=>i.dueDate!==null&&i.dueDate>=today).length;
  const current=completeId?store.items.find(i=>i.id===completeId):null;

  useEffect(()=>{
    if(!hydrated||!focusId)return;
    setPanel("overview");
    const timer=window.setTimeout(()=>{
      document.getElementById("prevention-"+focusId)?.scrollIntoView({block:"center"});
      onFocusHandled?.();
    },60);
    return ()=>window.clearTimeout(timer);
  },[hydrated,focusId,onFocusHandled]);

  const openNew=()=>{
    const draft=newPreventionDraft();
    setEditor({id:null,draft,baseline:{...draft}});setFormError("");setNotice("");
  };
  const openEdit=(item:PreventionItem)=>{
    const draft=itemDraft(item);
    setEditor({id:item.id,draft,baseline:{...draft}});setFormError("");setNotice("");
  };
  const saveEditor=()=>{
    if(!editor)return;
    if(!validPreventionDraft(editor.draft)){setFormError("Vyplň název a zkontroluj údaje termínu.");return;}
    const saved=persist(latest=>editor.id
      ?updatePreventionItem(latest,editor.id,editor.draft,editor.baseline)
      :createPreventionItem(latest,editor.draft));
    if(saved){setEditor(null);setFormError("");setNotice("Záznam prevence byl uložen.");}
  };
  const removeItem=(id:string)=>{
    if(!window.confirm("Opravdu odstranit tento termín včetně celé historie splnění?"))return;
    if(persist(latest=>latest.items.some(i=>i.id===id)
      ?{...latest,items:latest.items.filter(i=>i.id!==id)}:null)){
      setNotice("Záznam byl odstraněn.");setEditor(null);
    }
  };
  const openComplete=(item:PreventionItem)=>{
    if(!item.dueDate)return;
    setCompleteId(item.id);setCompleteDate(today);setCompleteNote("");setFormError("");setNotice("");
  };
  const saveCompletion=()=>{
    if(!completeId||completeDate>today){setFormError("Datum splnění nemůže být v budoucnosti.");return;}
    const saved=persist(latest=>completePrevention(latest,completeId,completeDate,completeNote));
    if(saved){setCompleteId(null);setFormError("");setNotice("Splnění bylo uloženo do historie.");}
  };
  const changeDraft=<K extends keyof PreventionDraft>(key:K,value:PreventionDraft[K])=>{
    setEditor(e=>e?{...e,draft:{...e.draft,[key]:value}}:null);
  };
  const savePaused=(item:PreventionItem)=>persist(latest=>
    updatePreventionItem(latest,item.id,{...itemDraft(item),active:!item.active},itemDraft(item)));

  if(!hydrated)return <section className="df2-prevention" data-prevention-root><p>Načítám prevenci…</p></section>;
  return <section className="df2-prevention" data-prevention-root>
    <header className="df2-prevention-head">
      <div><h2>Prevence</h2></div>
      <button type="button" className="df2-accent-button" disabled={blocked} onClick={openNew}>+ Přidat termín</button>
    </header>
    <nav className="df2-prevention-nav" aria-label="Prevence – sekce">
      <button type="button" aria-current={panel==="overview"?"page":undefined} onClick={()=>setPanel("overview")}>Přehled termínů</button>
      <button type="button" aria-current={panel==="history"?"page":undefined} onClick={()=>setPanel("history")}>Historie</button>
    </nav>
    {(blocked||error||formError)&&<p role="alert" className="df2-prevention-error">{blocked
      ?"Data prevence mají neznámý formát. Ukládání je zablokované.":formError||error}</p>}
    {notice&&<p role="status" className="df2-prevention-notice">{notice}</p>}

    {panel==="overview"&&<div className="df2-prevention-content">
      <div className="df2-prevention-stats">
        <article><small>Nadcházející termíny</small><strong>{upcoming}</strong></article>
        <article><small>Po termínu</small><strong>{overdue}</strong></article>
        <article><small>Historie</small><strong>{history.length}</strong></article>
      </div>
      <section className="df2-prevention-card">
        <div className="df2-prevention-section-head"><div><h3>Moje preventivní termíny</h3></div></div>
        {active.length?<div className="df2-prevention-items">{active.map(item=>
          <article key={item.id} id={"prevention-"+item.id} data-prevention-item={item.id}>
            <div className="df2-prevention-item-main">
              <span className="df2-prevention-category">{preventionCategoryLabel(item.category)}</span>
              <strong>{item.title}</strong>
              <span className="df2-prevention-date">{item.dueDate?dateLabel(item.dueDate):"Bez dalšího termínu"} · {statusLabel(item.dueDate,today)}</span>
              {item.provider&&<small>{item.provider}</small>}
              {item.dueDate&&<small>Připomenout {item.reminderDays===0?"v den termínu":item.reminderDays+" dní předem"}
                {item.repeatMonths>0?" · Opakování po "+item.repeatMonths+" měsících":""}</small>}
              {item.notes&&<p>{item.notes}</p>}
            </div>
            <div className="df2-prevention-actions">
              {item.dueDate&&<button type="button" disabled={blocked} onClick={()=>openComplete(item)}>Zapsat splnění</button>}
              <button type="button" disabled={blocked} onClick={()=>openEdit(item)}>Upravit</button>
              <button type="button" disabled={blocked} onClick={()=>savePaused(item)}>Pozastavit</button>
            </div>
          </article>)}</div>
          :<div className="df2-prevention-empty">Zatím žádné termíny.</div>}
      </section>
      {paused.length>0&&<section className="df2-prevention-card">
        <div className="df2-prevention-section-head"><h3>Pozastavené záznamy</h3>
          <button type="button" onClick={()=>setShowPaused(x=>!x)}>{showPaused?"Skrýt":"Zobrazit"} ({paused.length})</button></div>
        {showPaused&&<div className="df2-prevention-items">{paused.map(item=><article key={item.id} data-prevention-paused={item.id}>
          <div className="df2-prevention-item-main"><strong>{item.title}</strong><small>{item.dueDate?dateLabel(item.dueDate):"Bez dalšího termínu"}</small></div>
          <div className="df2-prevention-actions"><button type="button" disabled={blocked} onClick={()=>savePaused(item)}>Aktivovat</button>
            <button type="button" disabled={blocked} onClick={()=>openEdit(item)}>Upravit</button></div>
        </article>)}</div>}
      </section>}
      <p className="df2-prevention-disclaimer">Intervaly kontrol a očkování nastav podle pokynů lékaře.</p>
    </div>}
    {panel==="history"&&<section className="df2-prevention-card">
      <div className="df2-prevention-section-head"><h3>Historie absolvované prevence</h3><small>{history.length} záznamů</small></div>
      {history.length?<div className="df2-prevention-history">{history.map(({item,history:done})=>
        <article key={done.id} data-prevention-completion={done.id}>
          <div><time dateTime={done.date}>{dateLabel(done.date)}</time><strong>{item.title}</strong>
            <small>Plánovaný termín: {dateLabel(done.scheduledFor)}</small>
            {done.note&&<p>{done.note}</p>}</div>
          <span>{preventionCategoryLabel(item.category)}</span>
        </article>)}</div>:<p className="df2-prevention-empty">Zatím nebylo zapsáno žádné splnění.</p>}
    </section>}

    {editor&&<div className="df2-modal-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget)setEditor(null);}}>
      <section className="df2-modal df2-prevention-modal" role="dialog" aria-modal="true" aria-label="Preventivní termín">
        <header><h2>{editor.id?"Upravit termín":"Nový preventivní termín"}</h2>
          <button type="button" aria-label="Zavřít" onClick={()=>setEditor(null)}>×</button></header>
        <div className="df2-prevention-fields">
          <label>Název<input autoFocus value={editor.draft.title} maxLength={120} onChange={event=>changeDraft("title",event.target.value)}
            placeholder="Např. kontrola u zubaře"/></label>
          <label>Kategorie<select value={editor.draft.category} onChange={event=>changeDraft("category",event.target.value as PreventionDraft["category"])}>
            {PREVENTION_CATEGORIES.map(category=><option value={category.key} key={category.key}>{category.label}</option>)}
          </select></label>
          <label>Datum termínu (volitelné)<input type="date" value={editor.draft.dueDate??""} onChange={event=>changeDraft("dueDate",event.target.value||null)}/></label>
          <label>Poskytovatel / místo (volitelné)<input value={editor.draft.provider} maxLength={140}
            onChange={event=>changeDraft("provider",event.target.value)} placeholder="Ordinace, lékař…"/></label>
          <label>Připomenutí v Dnes<select value={editor.draft.reminderDays} onChange={event=>changeDraft("reminderDays",Number(event.target.value))}>
            {PREVENTION_REMIND_DAYS.map(days=><option value={days} key={days}>{days===0?"V den termínu":days+" dní předem"}</option>)}
          </select></label>
          <label>Opakování po splnění<select value={editor.draft.repeatMonths} onChange={event=>changeDraft("repeatMonths",Number(event.target.value))}>
            {PREVENTION_REPEAT_MONTHS.map(months=><option value={months} key={months}>{months===0?"Neopakovat / ručně":months+" měsíců"}</option>)}
          </select></label>
        </div>
        <label className="df2-prevention-note">Moje poznámka (volitelné)<textarea rows={3} maxLength={1200}
          value={editor.draft.notes} onChange={event=>changeDraft("notes",event.target.value)}
          placeholder="Jen nezbytné organizační informace"/></label>
        <label className="df2-prevention-toggle"><input type="checkbox" checked={editor.draft.active}
          onChange={event=>changeDraft("active",event.target.checked)}/> Aktivní termín</label>
        <div className="df2-prevention-actions">
          <button type="button" className="df2-primary" disabled={blocked} onClick={saveEditor}>Uložit termín</button>
          <button type="button" onClick={()=>setEditor(null)}>Zrušit</button>
          {editor.id&&<button type="button" className="df2-prevention-danger" disabled={blocked}
            onClick={()=>removeItem(editor.id!)}>Odstranit včetně historie</button>}
        </div>
      </section>
    </div>}
    {current&&<div className="df2-modal-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget)setCompleteId(null);}}>
      <section className="df2-modal df2-prevention-modal" role="dialog" aria-modal="true" aria-label="Zapsat absolvovanou prevenci">
        <header><h2>Zapsat absolvovanou prevenci</h2><button type="button" aria-label="Zavřít" onClick={()=>setCompleteId(null)}>×</button></header>
        <p><strong>{current.title}</strong></p>
        <label className="df2-prevention-note">Skutečné datum splnění
          <input aria-label="Skutečné datum splnění" type="date" value={completeDate} max={today}
            onChange={event=>setCompleteDate(event.target.value)}/></label>
        <label className="df2-prevention-note">Poznámka ke splnění (volitelné)
          <textarea rows={3} maxLength={1200} value={completeNote} onChange={event=>setCompleteNote(event.target.value)}/></label>
        {current.repeatMonths>0&&<p>Další termín se spočítá podle tebou zvoleného intervalu od data splnění.</p>}
        <div className="df2-prevention-actions"><button type="button" className="df2-primary" disabled={blocked} onClick={saveCompletion}>Uložit splnění</button>
          <button type="button" onClick={()=>setCompleteId(null)}>Zrušit</button></div>
      </section>
    </div>}
  </section>;
}
