from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected 1 match, found {count}")
    return text.replace(old, new, 1)


app_path = Path("web/app/dayframe-v2.tsx")
app = app_path.read_text()

replacements = [
    (
        '<div className="df2-sidebar-bottom"><span>Den končí</span><strong>00:30</strong><small>hlavní odpočet</small></div>',
        '<div className="df2-sidebar-bottom"><span>Den končí</span><strong>00:30</strong></div>',
        "sidebar countdown copy",
    ),
    (
        '<button className="df2-accent-button" onClick={() => { setData((current) => replanWeek(current, monday, now)); setNotice("Týden byl přepočítán podle priorit a termínů."); }}>Přepočítat týden</button>',
        '<button className="df2-accent-button" onClick={() => setData((current) => replanWeek(current, monday, now))}>Přepočítat týden</button>',
        "week success notice",
    ),
    (
        '                        <div className="df2-day-summary"><span>{tasks.length} bloků</span><span>{Math.floor(totalMinutes(tasks) / 60)} h {totalMinutes(tasks) % 60 || ""}</span></div>\n',
        '',
        "week day summary",
    ),
    (
        '                                <small>{task.category}</small>\n',
        '',
        "week task category",
    ),
    (
        '              <footer className="df2-week-help">Přetažení drží místo, kde blok chytíš, a zarovná nový čas po 15 minutách. Po puštění zůstane blok na zvoleném místě.</footer>\n',
        '',
        "week help copy",
    ),
    (
        '<header className="df2-page-head"><div><p>Rychlé plánování</p><h1>Přidat úkol</h1></div></header>',
        '<header className="df2-page-head"><div><h1>Přidat úkol</h1></div></header>',
        "add subtitle",
    ),
    (
        '<label className="df2-title-input"><span>Co potřebuješ udělat?</span><input',
        '<label className="df2-title-input"><span>Úkol</span><input',
        "task label",
    ),
    (
        '<summary>Další podrobnosti</summary>',
        '<summary>Podrobnosti</summary>',
        "details label",
    ),
    (
        '{draft.title.trim() && <div className="df2-understood"><span>Dayframe rozumí:</span><strong>{cleanSmartTitle(draft.title)}</strong><small>{draft.date ? shortDate(draft.date) : "nejlepší čas během týdne"} · {draft.duration} min{draft.start ? ` · ${draft.start}` : " · čas automaticky"}</small></div>}',
        '{draft.title.trim() && <div className="df2-understood"><strong>{cleanSmartTitle(draft.title)}</strong><small>{draft.date ? shortDate(draft.date) : "Tento týden"} · {draft.duration} min{draft.start ? ` · ${draft.start}` : " · automaticky"}</small></div>}',
        "smart input preview",
    ),
    (
        '{notice && <div className="df2-result"><span>Uloženo</span><strong>{notice}</strong><button onClick={() => { setNotice(""); setView("week"); }}>Ukázat v týdnu</button></div>}',
        '{notice && <div className="df2-result"><strong>{notice}</strong><button onClick={() => { setNotice(""); setView("week"); }}>Týden</button></div>}',
        "save result copy",
    ),
    (
        '<small>{task.duration} min · {task.priority === "high" ? "vysoká priorita" : "čeká na čas"}</small>',
        '<small>{task.duration} min{task.priority === "high" ? " · vysoká priorita" : ""}</small>',
        "backlog copy",
    ),
    (
        '              <small>Focus je záměrně jednoduchý: jeden blok, jeden úkol, žádný kalendář.</small>\n',
        '',
        "focus explanation",
    ),
    (
        '<header className="df2-page-head"><div><p>Důležité termíny</p><h1>Milníky</h1></div></header>',
        '<header className="df2-page-head"><div><h1>Milníky</h1></div></header>',
        "milestones subtitle",
    ),
    (
        '<div><span>{milestone.note}</span><strong>{milestone.title}</strong></div>',
        '<div>{milestone.note !== "Vlastní termín" && <span>{milestone.note}</span>}<strong>{milestone.title}</strong></div>',
        "default milestone note",
    ),
    (
        '<header className="df2-page-head"><div><p>Chování Dayframe</p><h1>Nastavení</h1></div></header>',
        '<header className="df2-page-head"><div><h1>Nastavení</h1></div></header>',
        "settings subtitle",
    ),
    (
        '<div className="df2-settings-card"><div><strong>Pracovní den</strong><span>10:00–22:30 · oběd 13:00–14:00</span></div><div><strong>Hlavní odpočet</strong><span>Den končí v 00:30</span></div><div><strong>Auto-plánování</strong><span>Celý týden · 15min sloty · respektuje ručně zadaný den a čas</span></div><div><strong>Ukládání</strong><span>Lokální kalendář podle data · schema 5</span></div></div>',
        '<div className="df2-settings-card"><div><strong>Pracovní den</strong><span>10:00–22:30 · oběd 13:00–14:00</span></div><div><strong>Hlavní odpočet</strong><span>00:30</span></div><div><strong>Auto-plánování</strong><span>Týden · 15 min</span></div></div>',
        "settings developer copy",
    ),
    (
        '<header><div><span>Milník</span><h2>Upravit milník</h2></div><button type="button" onClick={() => setEditingMilestoneId(null)}>×</button></header>',
        '<header><div><h2>Upravit milník</h2></div><button type="button" onClick={() => setEditingMilestoneId(null)}>×</button></header>',
        "milestone modal label",
    ),
    (
        '<header><div><span>Úkol</span><h2>Upravit</h2></div><button type="button" onClick={() => setEditing(null)}>×</button></header>',
        '<header><div><h2>Upravit</h2></div><button type="button" onClick={() => setEditing(null)}>×</button></header>',
        "task modal label",
    ),
    (
        '            <span>Konec 00:30</span>\n',
        '',
        "day countdown duplicate end",
    ),
    (
        '{nextMilestone ? <><strong>{daysUntilDate(nextMilestone.date, now)}<em>dní</em></strong><b>{nextMilestone.title}</b><small>{longDate(nextMilestone.date)}</small></> : <><strong>—</strong><b>Žádný termín</b><small>Přidej milník</small></>}',
        '{nextMilestone ? <><strong>{daysUntilDate(nextMilestone.date, now)}<em>dní</em></strong><b>{nextMilestone.title}</b><small>{longDate(nextMilestone.date)}</small></> : <><strong>—</strong><b>Přidat milník</b></>}',
        "empty milestone copy",
    ),
    (
        '{activeTask ? <><div><h2>{activeTask.title}</h2><p>{activeTask.category} · {activeTask.duration} min</p></div><div className="df2-now-actions"><button onClick={() => onFocus(activeTask)}>Zahájit blok</button><button onClick={() => onEdit(activeTask)}>Upravit</button></div></> : <div><h2>Teď nemáš žádný blok</h2><p>Přidej úkol nebo si nech volno.</p></div>}',
        '{activeTask ? <><div><h2>{activeTask.title}</h2><p>{activeTask.duration} min</p></div><div className="df2-now-actions"><button onClick={() => onFocus(activeTask)}>Zahájit blok</button><button onClick={() => onEdit(activeTask)}>Upravit</button></div></> : <div><h2>Volno</h2></div>}',
        "now card copy",
    ),
    (
        '{missed.length > 0 && <section className="df2-missed"><header><span>Vyžaduje rozhodnutí</span><strong>{missed.length} {missed.length === 1 ? "nedokončený blok" : "nedokončené bloky"}</strong></header>{missed.map((task) => <article key={task.id}><div><strong>{task.title}</strong><small>měl skončit v {task.end}</small></div><div><button onClick={() => onDone(task.id)}>Hotovo</button><button onClick={() => onTomorrow(task.id)}>Na zítra</button><button onClick={() => onDelete(task.id)}>Zrušit</button></div></article>)}</section>}',
        '{missed.length > 0 && <section className="df2-missed"><header><strong>Nedokončeno · {missed.length}</strong></header>{missed.map((task) => <article key={task.id}><div><strong>{task.title}</strong><small>do {task.end}</small></div><div><button onClick={() => onDone(task.id)}>Hotovo</button><button onClick={() => onTomorrow(task.id)}>Na zítra</button><button onClick={() => onDelete(task.id)}>Zrušit</button></div></article>)}</section>}',
        "missed copy",
    ),
    (
        '<section className="df2-next"><div className="df2-section-head"><h2>Co následuje</h2><span>{completed}/{tasks.length} hotovo{unscheduled ? ` · ${unscheduled} bez času` : ""}</span></div>{nextTasks.length ? nextTasks.map((task) => <button key={task.id} onClick={() => onEdit(task)}><time>{task.start}</time><span><strong>{task.title}</strong><small>{task.category} · {task.duration} min</small></span></button>) : <div className="df2-empty">Žádný další blok.</div>}</section>',
        '<section className="df2-next"><div className="df2-section-head"><h2>Co následuje</h2><span>{completed}/{tasks.length} hotovo{unscheduled ? ` · ${unscheduled} bez času` : ""}</span></div>{nextTasks.length ? nextTasks.map((task) => <button key={task.id} onClick={() => onEdit(task)}><time>{task.start}</time><span><strong>{task.title}</strong><small>{task.duration} min</small></span></button>) : <div className="df2-empty">Volno</div>}</section>',
        "next list copy",
    ),
    (
        '      <footer className="df2-today-status"><span className={missed.length ? "warning" : "ok"} />{missed.length ? "Plán potřebuje rozhodnutí u minulých bloků." : "Plán je realistický. Dayframe nic automaticky nepřenáší do dalšího dne."}</footer>\n',
        '',
        "today status explanation",
    ),
]

for old, new, label in replacements:
    app = replace_once(app, old, new, label)

app_path.write_text(app)

css_path = Path("web/app/dayframe-v2.css")
css = css_path.read_text()
css = replace_once(
    css,
    '.df2-understood { display: grid; grid-template-columns: auto 1fr; gap: 3px 10px; padding: 12px 14px; border-left: 2px solid var(--accent); background: #f3eee9; }\n.df2-understood span { color: var(--muted); font-size: 10px; text-transform: uppercase; }\n.df2-understood strong { font-size: 13px; }\n.df2-understood small { grid-column: 2; color: var(--muted); font-size: 11px; }',
    '.df2-understood { display: flex; align-items: baseline; justify-content: space-between; gap: 14px; padding: 12px 14px; border-left: 2px solid var(--accent); background: #f3eee9; }\n.df2-understood strong { font-size: 13px; }\n.df2-understood small { color: var(--muted); font-size: 11px; }',
    "smart preview styles",
)
css = replace_once(
    css,
    '.df2-result { margin: 22px 0 0; display: grid; grid-template-columns: auto 1fr auto; }\n.df2-result span { font-size: 10px; text-transform: uppercase; }',
    '.df2-result { margin: 22px 0 0; display: grid; grid-template-columns: 1fr auto; }',
    "result styles",
)
css = replace_once(
    css,
    '  .df2-understood { grid-template-columns: 1fr; }\n  .df2-understood small { grid-column: 1; }',
    '  .df2-understood { align-items: flex-start; flex-direction: column; gap: 3px; }',
    "mobile smart preview styles",
)
css_path.write_text(css)
