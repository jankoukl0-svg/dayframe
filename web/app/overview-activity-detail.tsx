"use client";
import {useMemo, useState} from "react";
import {activityIdentity, type ActivityLedger, type ActivityItem} from "@/lib/dayframe-activity-analytics";

const number = new Intl.NumberFormat("cs-CZ");
function minutesLabel(minutes: number) {
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return h ? h + " h" + (m ? " " + m + " min" : "") : m + " min";
}
function dateLabel(date: string) {
  return new Intl.DateTimeFormat("cs-CZ", {weekday:"long", day:"numeric", month:"long"})
    .format(new Date(date + "T12:00:00"));
}
function isMatch(item: {title: string; category: string}, category: string, query: string, selected: string | null) {
  return (category === "all" || item.category === category)
    && (!selected || activityIdentity(item.category, item.title) === selected)
    && (!query || (item.title + " " + item.category).toLocaleLowerCase("cs").includes(query.toLocaleLowerCase("cs")));
}
export function OverviewActivityDetail({ledger, colors}: {
  ledger: ActivityLedger; colors: Record<string, string>;
}) {
  const [category, setCategory] = useState("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string|null>(null);
  const [openDays, setOpenDays] = useState<string[]>([]);
  const categoryOptions = ledger.categories.map(c => c.name);
  const selectedCategory = category === "all" || categoryOptions.includes(category) ? category : "all";
  const activities = useMemo(() => ledger.activities.filter(item => isMatch(item, selectedCategory, query, selected)), [ledger, selectedCategory, query, selected]);
  const visibleTotal = activities.reduce((sum, item) => sum + item.minutes, 0);
  const days = useMemo(() => ledger.days.map(day => {
    const items = day.items.filter((item: ActivityItem) => isMatch(item, selectedCategory, query, selected));
    return {...day, items, minutes: items.reduce((sum, item) => sum + item.minutes, 0)};
  }).filter(day => day.items.length > 0), [ledger, selectedCategory, query, selected]);
  const max = Math.max(1, ...activities.map(item => item.minutes));
  return <>
    <section className="df2-overview-activity-detail" aria-label="Čas podle činností" data-activity-breakdown>
      <div className="df2-overview-section-head">
        <div><h2>Čas podle činností</h2><p>Každá dokončená činnost a její součet za vybrané období.</p></div>
        <span>{number.format(ledger.activities.length)} činností · {minutesLabel(ledger.minutes)}</span>
      </div>
      <div className="df2-overview-activity-controls">
        <label>Oblast
          <select aria-label="Filtrovat oblast" value={selectedCategory} onChange={event=>{setCategory(event.target.value);setSelected(null);}}>
            <option value="all">Všechny oblasti</option>
            {categoryOptions.map(value=><option key={value} value={value}>{value}</option>)}
          </select>
        </label>
        <label>Hledat
          <input type="search" aria-label="Hledat činnost" placeholder="Název činnosti…" value={query} onChange={event=>{setQuery(event.target.value);setSelected(null);}}/>
        </label>
        {selected && <button type="button" className="df2-overview-clear-activity" onClick={()=>setSelected(null)}>Zrušit výběr</button>}
      </div>
      <div className="df2-overview-activity-total">{activities.length
        ? <span>Zobrazeno <strong>{minutesLabel(visibleTotal)}</strong> · {activities.reduce((sum,item)=>sum+item.count,0)} bloků</span>
        : <span>Žádná dokončená činnost neodpovídá filtru.</span>}
      </div>
      <div className="df2-overview-activity-chart" role="list" aria-label="Činnosti seřazené podle času">
        {activities.map(item=><button type="button" role="listitem" key={item.key}
          aria-pressed={selected===item.key} data-activity-chart-row data-category={item.category}
          onClick={()=>setSelected(selected===item.key?null:item.key)}
          title={item.title + " · " + item.category + " · " + minutesLabel(item.minutes)}>
          <span className="df2-overview-activity-label"><strong>{item.title}</strong><small>{item.category} · {item.count}×</small></span>
          <span className="df2-overview-activity-meter"><i style={{width:(item.minutes/max*100)+"%", backgroundColor:colors[item.category]||"var(--accent-dark)"}}/></span>
          <span className="df2-overview-activity-value"><strong>{minutesLabel(item.minutes)}</strong><small>{item.share} % celku</small></span>
        </button>)}
      </div>
      <p className="df2-overview-activity-note">Čas vychází ze skutečně zaznamenané délky, pokud existuje. Jinak se použije délka dokončeného bloku, nikoli čas nedokončených plánů. Kliknutím na činnost zobrazíš její jednotlivé záznamy.</p>
    </section>
    <section className="df2-overview-activity-detail" aria-label="Podrobný deník aktivit" data-activity-ledger>
      <div className="df2-overview-section-head">
        <div><h2>Deník aktivit</h2><p>Jednotlivé dokončené bloky s datem, časem a délkou.</p></div>
        <span>{days.length} {days.length===1?"den":days.length<5?"dny":"dní"} · {minutesLabel(visibleTotal)}</span>
      </div>
      {days.length ? <div className="df2-overview-ledger-days">
        {days.map(day=>{
          const open=openDays.includes(day.date);
          return <article key={day.date} data-activity-day={day.date}>
            <button className="df2-overview-ledger-day-toggle" type="button" aria-expanded={open}
              onClick={()=>setOpenDays(current=>open?current.filter(date=>date!==day.date):[...current,day.date])}>
              <span className="df2-overview-ledger-day-title">{dateLabel(day.date)}</span>
              <span>{day.items.length} {day.items.length===1?"blok":"bloky"} · <strong>{minutesLabel(day.minutes)}</strong></span>
              <i aria-hidden="true">{open?"⌃":"⌄"}</i>
            </button>
            {open && <div className="df2-overview-ledger-items">
              {day.items.map(item=><div className="df2-overview-ledger-entry" key={item.key}
                data-activity-record-source={item.source}>
                <span className="df2-overview-ledger-time">{item.start??"—"}</span>
                <span className="df2-overview-ledger-title"><strong>{item.title}</strong><small>{item.category} · {item.source==="measured"?"Zaznamenaný čas":"Délka dokončeného bloku"}</small></span>
                <strong className="df2-overview-ledger-duration">{minutesLabel(item.minutes)}</strong>
              </div>)}
            </div>}
          </article>;
        })}
      </div> : <p className="df2-overview-empty">Pro toto období nejsou dostupné dokončené bloky odpovídající filtru.</p>}
      {ledger.scheduled>0 && <p className="df2-overview-activity-note">U {ledger.scheduled} dokončených bloků není uložený skutečně měřený čas; jejich délka je převzata z kalendáře. Přesný čas lze opravit v historii Týdne.</p>}
    </section>
  </>;
}
