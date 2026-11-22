"use client";
import {useMemo, useState} from "react";
import {activityIdentity, type ActivityLedger, type ActivityItem} from "@/lib/dayframe-activity-analytics";

const number = new Intl.NumberFormat("cs-CZ");
function minutesLabel(minutes: number) {
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return h ? h + " h" + (m ? " " + m + " min" : "") : m + " min";
}
function blocksLabel(count: number) {
  return count + " " + (count === 1 ? "blok" : count >= 2 && count <= 4 ? "bloky" : "bloků");
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
type CategoryGroup = {name: string; minutes: number; items: ActivityItem[]};
export function OverviewActivityDetail({ledger, colors}: {
  ledger: ActivityLedger; colors: Record<string, string>;
}) {
  const [category, setCategory] = useState("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string|null>(null);
  const [openCategories, setOpenCategories] = useState<string[]>([]);
  const [openDays, setOpenDays] = useState<string[]>([]);
  const categoryOptions = ledger.categories.map(c => c.name);
  const selectedCategory = category === "all" || categoryOptions.includes(category) ? category : "all";
  const days = useMemo(() => ledger.days.map(day => {
    const items = day.items.filter(item => isMatch(item, selectedCategory, query, selected));
    return {...day, items, minutes: items.reduce((sum, item) => sum + item.minutes, 0)};
  }).filter(day => day.items.length > 0), [ledger, selectedCategory, query, selected]);
  // A category owns individual completed blocks, not one synthetic row per title.
  // Build only from the same filtered ledger that drives the dated history below.
  const categoryGroups = useMemo(() => {
    const grouped = new Map<string, CategoryGroup>();
    for (const day of days) for (const item of day.items) {
      const group = grouped.get(item.category) ?? {name: item.category, minutes: 0, items: []};
      group.minutes += item.minutes;
      group.items.push(item);
      grouped.set(item.category, group);
    }
    return [...grouped.values()].sort((a,b) =>
      b.minutes - a.minutes || a.name.localeCompare(b.name, "cs"));
  }, [days]);
  const visibleTotal = categoryGroups.reduce((sum, group) => sum + group.minutes, 0);
  const visibleBlocks = categoryGroups.reduce((sum, group) => sum + group.items.length, 0);
  const maxCategory = Math.max(1, ...categoryGroups.map(group => group.minutes));
  function handleSearch(value: string) {
    setQuery(value);
    setSelected(null);
    if (value.trim()) {
      const needle = value.trim().toLocaleLowerCase("cs");
      const matches = ledger.activities.filter(item =>
        (item.title + " " + item.category).toLocaleLowerCase("cs").includes(needle));
      setOpenCategories(current => [...new Set([...current, ...matches.map(item => item.category)])]);
    }
  }
  return <>
    <section className="df2-overview-activity-detail" aria-label="Čas podle činností" data-activity-breakdown>
      <div className="df2-overview-section-head">
        <div><h2>Čas podle oblastí</h2><p>Nejprve součet za oblast; rozkliknutím zobrazíš každý dokončený blok.</p></div>
        <span>{number.format(ledger.categories.length)} oblastí · {minutesLabel(ledger.minutes)}</span>
      </div>
      <div className="df2-overview-activity-controls">
        <label>Oblast
          <select aria-label="Filtrovat oblast" value={selectedCategory} onChange={event=>{
            const next = event.target.value;
            setCategory(next);
            setSelected(null);
            if (next !== "all") setOpenCategories(current => [...new Set([...current, next])]);
          }}>
            <option value="all">Všechny oblasti</option>
            {categoryOptions.map(value=><option key={value} value={value}>{value}</option>)}
          </select>
        </label>
        <label>Hledat
          <input type="search" aria-label="Hledat činnost" placeholder="Název bloku nebo oblast…" value={query} onChange={event=>handleSearch(event.target.value)}/>
        </label>
        {selected && <button type="button" className="df2-overview-clear-activity" onClick={()=>setSelected(null)}>Zrušit výběr</button>}
      </div>
      <div className="df2-overview-activity-total">{visibleBlocks
        ? <span>Zobrazeno <strong>{minutesLabel(visibleTotal)}</strong> · {blocksLabel(visibleBlocks)}</span>
        : <span>Žádný dokončený blok neodpovídá filtru.</span>}
      </div>
      <div className="df2-overview-activity-chart" role="list" aria-label="Oblasti seřazené podle času">
        {categoryGroups.map(group=>{
          const open = openCategories.includes(group.name);
          const groupMax = Math.max(1, ...group.items.map(item => item.minutes));
          return <div className="df2-overview-activity-group" role="listitem" key={group.name} data-activity-category={group.name}>
            <button type="button" className="df2-overview-activity-category-toggle" data-activity-category-row data-category={group.name}
              aria-expanded={open} onClick={()=>setOpenCategories(current =>
                open ? current.filter(name => name !== group.name) : [...current, group.name])}>
              <span className="df2-overview-activity-label"><strong>{group.name}</strong><small>{blocksLabel(group.items.length)}</small></span>
              <span className="df2-overview-activity-meter"><i style={{width:(group.minutes/maxCategory*100)+"%", backgroundColor:colors[group.name]||"var(--accent-dark)"}}/></span>
              <span className="df2-overview-activity-value"><strong>{minutesLabel(group.minutes)}</strong><small>{visibleTotal ? Math.round(group.minutes / visibleTotal * 100) : 0} % zobrazeného času</small></span>
              <span className="df2-overview-activity-chevron" aria-hidden="true">{open?"⌃":"⌄"}</span>
            </button>
            {open && <div className="df2-overview-activity-group-items" role="list" aria-label={"Dokončené bloky – " + group.name}>
              {group.items.map(item=><div key={item.key} role="listitem">
                <button type="button" className="df2-overview-activity-item"
                  aria-pressed={selected===activityIdentity(item.category,item.title)}
                  data-activity-chart-row data-category={item.category} data-activity-block-date={item.date}
                  onClick={()=>setSelected(selected===activityIdentity(item.category,item.title)?null:activityIdentity(item.category,item.title))}
                  title={item.title + " · " + dateLabel(item.date) + " · " + minutesLabel(item.minutes)}>
                  <span className="df2-overview-activity-label"><strong>{item.title}</strong><small>{dateLabel(item.date)}{item.start?" · "+item.start:""}</small></span>
                  <span className="df2-overview-activity-meter"><i style={{width:(item.minutes/groupMax*100)+"%", backgroundColor:colors[group.name]||"var(--accent-dark)"}}/></span>
                  <span className="df2-overview-activity-value"><strong>{minutesLabel(item.minutes)}</strong><small>{item.source==="measured"?"Zaznamenáno":"Délka bloku"}</small></span>
                </button>
              </div>)}
            </div>}
          </div>;
        })}
      </div>
      <p className="df2-overview-activity-note">Zobrazují se jen dokončené bloky. Přednost má skutečně zaznamenaný čas; jinak délka bloku. Kliknutím na jednotlivý blok vyfiltruješ v deníku záznamy stejné činnosti.</p>
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
              <span>{blocksLabel(day.items.length)} · <strong>{minutesLabel(day.minutes)}</strong></span>
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
