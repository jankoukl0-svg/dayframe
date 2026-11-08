"use client";
import { useMemo, useState } from "react";
import { addDaysKey } from "@/lib/dayframe-calendar";
import type { SupplementStore } from "@/lib/dayframe-supplements";
import { groupHistoryDoses, supplementHistorySummary } from "@/lib/dayframe-supplement-history";

const DATE_FORMAT = new Intl.DateTimeFormat("cs-CZ", { day: "numeric", month: "long", year: "numeric" });
const DAY_FORMAT = new Intl.DateTimeFormat("cs-CZ", { weekday: "long" });
function dateLabel(date: string) {
  return DATE_FORMAT.format(new Date(date + "T12:00:00"));
}
function statusLabel(status: "taken" | "skipped" | "unrecorded") {
  return status === "taken" ? "✓ Užito" : status === "skipped" ? "Vynecháno" : "Bez záznamu";
}
function dateDays(from: string, to: string) {
  return Math.round((Date.parse(to + "T12:00:00") - Date.parse(from + "T12:00:00")) / 86400000) + 1;
}
export function SupplementHistoryDashboard({store, today, onToday}: {
  store: SupplementStore; today: string; onToday: () => void;
}) {
  const [period, setPeriod] = useState<"7" | "30" | "90" | "custom">("30");
  const [customFrom, setCustomFrom] = useState(addDaysKey(today, -29));
  const [customTo, setCustomTo] = useState(today);
  const from = period === "custom" ? customFrom : addDaysKey(today, 1 - Number(period));
  const to = period === "custom" ? customTo : today;
  const valid = from <= to && to <= today && dateDays(from, to) <= 366;
  const summary = useMemo(() => valid ? supplementHistorySummary(store, from, to, today) : null, [store, from, to, today, valid]);
  const days = summary?.days ?? [];
  const activeDays = days.filter(day => day.planned > 0);
  return <div className="df2-supplement-history-dashboard" data-supplements-history>
    <header className="df2-supplement-history-toolbar">
      <div><h3>Historie užívání</h3><p>Plnění plánu podle skutečných záznamů, ne jen seznam odkliknutí.</p></div>
      <div className="df2-supplement-history-filters" role="group" aria-label="Období historie">
        {([["7", "7 dní"], ["30", "30 dní"], ["90", "90 dní"], ["custom", "Vlastní"]] as const).map(([key,label]) =>
          <button key={key} type="button" aria-pressed={period === key} onClick={() => setPeriod(key)}>{label}</button>)}
      </div>
    </header>
    {period === "custom" && <div className="df2-supplement-history-custom">
      <label>Od data<input type="date" aria-label="Od data" max={today} value={customFrom} onChange={event => setCustomFrom(event.target.value)}/></label>
      <label>Do data<input type="date" aria-label="Do data" min={customFrom} max={today} value={customTo} onChange={event => setCustomTo(event.target.value)}/></label>
    </div>}
    {!valid ? <p className="df2-supplement-history-info" role="alert">Vyber platné období do dneška, maximálně 366 dní.</p> : summary && <>
      <div className="df2-supplement-history-metrics">
        <article className="is-primary">
          <span>Plnění plánu</span><strong>{summary.percentage === null ? "—" : summary.percentage + " %"}</strong>
          <div className="df2-supplement-history-progress" role="progressbar" aria-label="Plnění plánu"
            aria-valuemin={0} aria-valuemax={summary.planned || 1} aria-valuenow={summary.taken}>
            <span style={{width: (summary.percentage ?? 0) + "%"}}/>
          </div>
          <small>{summary.taken} z {summary.planned} naplánovaných dávek</small>
        </article>
        <article><span>Užito</span><strong>{summary.taken}</strong><small>Potvrzené dávky</small></article>
        <article><span>Vynecháno</span><strong>{summary.skipped}</strong><small>Výslovně označeno</small></article>
        <article><span>Bez záznamu</span><strong>{summary.unrecorded}</strong><small>Neznamená automaticky vynecháno</small></article>
      </div>
      <div className="df2-supplement-history-insight">
        <div><span className="df2-supplement-history-eyebrow">Série splněných dní</span>
          <strong>{summary.streak} {summary.streak === 1 ? "den" : summary.streak < 5 ? "dny" : "dní"}</strong>
          <p>Počítají se dny se všemi naplánovanými dávkami potvrzenými jako užité. Dny bez plánu se přeskočí.</p></div>
        <div><span className="df2-supplement-history-eyebrow">Rozsah přehledu</span>
          <strong>{activeDays.length} {activeDays.length === 1 ? "den" : activeDays.length < 5 ? "dny" : "dní"} s plánem</strong>
          <p>{dateLabel(from)} – {dateLabel(to)}</p></div>
      </div>
      <section className="df2-supplement-history-section" aria-labelledby="supp-history-trend">
        <div className="df2-supplement-history-section-head">
          <h3 id="supp-history-trend">Přehled po dnech</h3>
          <span>Zelená: vše užito · Oranžová: část · Šedá: bez záznamu</span>
        </div>
        {activeDays.length ? <div className="df2-supplement-history-days" role="list" aria-label="Denní plnění užívání">
          {activeDays.slice().reverse().map(day => {
            const state = day.taken === day.planned ? "complete" : day.taken > 0 ? "partial" : day.skipped ? "skipped" : "unrecorded";
            return <div key={day.date} role="listitem" className={"df2-supplement-history-day is-" + state}
              title={dateLabel(day.date) + ": " + day.taken + " / " + day.planned + " užito, " + day.skipped + " vynecháno, " + day.unrecorded + " bez záznamu"}
              aria-label={dateLabel(day.date) + ": " + day.taken + " z " + day.planned + " užito"}>
              <time dateTime={day.date}>{Number(day.date.slice(-2))}.</time>
              <strong>{day.taken}/{day.planned}</strong>
            </div>;
          })}
        </div> : <p className="df2-supplement-history-info">V tomto období nebyly naplánovány žádné dávky.</p>}
      </section>
      {summary.products.length > 0 && <section className="df2-supplement-history-section" aria-labelledby="supp-history-products">
        <div className="df2-supplement-history-section-head"><h3 id="supp-history-products">Podle suplementů</h3><span>Řazeno od nejnižšího plnění</span></div>
        <div className="df2-supplement-history-products">
          {summary.products.map(product => <div key={product.id} className="df2-supplement-history-product">
            <div><strong>{product.name}</strong><small>{product.taken}/{product.planned} užito · {product.skipped} vynecháno · {product.unrecorded} bez záznamu</small></div>
            <div className="df2-supplement-history-product-progress" role="progressbar"
              aria-label={"Plnění: " + product.name} aria-valuemin={0} aria-valuemax={product.planned} aria-valuenow={product.taken}>
              <span style={{width: (product.taken / product.planned * 100) + "%"}}/>
            </div><b>{Math.round(product.taken / product.planned * 100)} %</b>
          </div>)}
        </div>
      </section>}
      <section className="df2-supplement-history-section" aria-labelledby="supp-history-detail">
        <div className="df2-supplement-history-section-head"><h3 id="supp-history-detail">Denní historie</h3><span>Rozklikni den pro jednotlivé dávky</span></div>
        <div className="df2-supplement-history-detail">
          {activeDays.length ? activeDays.map((day,index) => <details key={day.date} data-supplement-history-day={day.date} open={undefined} defaultOpen={index === 0}>
            <summary><span className="df2-supplement-history-chevron" aria-hidden="true">⌄</span>
              <span className="df2-supplement-history-date"><time dateTime={day.date}>{dateLabel(day.date)}</time>
                <small>{DAY_FORMAT.format(new Date(day.date + "T12:00:00"))}</small></span>
              <strong>{day.taken}/{day.planned} užito</strong>
              <span className={"df2-supplement-history-badge " + (day.taken === day.planned ? "is-complete" : day.taken ? "is-partial" : "is-pending")}>
                {day.taken === day.planned ? "Splněno" : day.skipped ? day.skipped + " vynecháno" : day.unrecorded + " bez záznamu"}
              </span>
            </summary>
            <div className="df2-supplement-history-detail-body">{groupHistoryDoses(day.doses).map(group => <div key={group.id} className="df2-supplement-history-daypart">
              <h4>{group.label}</h4>
              {group.doses.map(dose => <div key={dose.key} className="df2-supplement-history-dose">
                <time dateTime={day.date + "T" + dose.time}>{dose.time}</time><strong>{dose.name}</strong>
                <span className={"is-" + dose.status}>{statusLabel(dose.status)}</span>
              </div>)}
            </div>)}</div>
          </details>) : <p className="df2-supplement-history-info">Zatím zde nejsou naplánované dávky.</p>}
        </div>
        <p className="df2-supplement-history-footnote">Bez záznamu znamená pouze to, že dávka nebyla potvrzena ani výslovně vynechána. Záznamy za dnešek upravíš v <button type="button" onClick={onToday}>Dnes →</button>.</p>
      </section>
      {!!store.purchases.length && <details className="df2-supplement-history-purchases">
        <summary>Historie nákupů <span>{store.purchases.length} záznamů</span></summary>
        <div className="df2-supplements-history">{store.purchases.slice().reverse().map(p => <div key={p.id}>
          <time dateTime={p.date}>{p.date}</time>
          <strong>{store.supplements.find(s => s.id === p.supplementId)?.name ?? "Dřívější suplement"}</strong>
          <span>+ {p.servings} {p.paidCzk === null ? "" : "· " + p.paidCzk + " Kč"}</span>
        </div>)}</div>
      </details>}
    </>}
  </div>;
}
