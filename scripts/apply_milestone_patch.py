from pathlib import Path
import re


def sub_once(text: str, pattern: str, replacement: str, label: str, flags: int = 0) -> str:
    updated, count = re.subn(pattern, replacement, text, count=1, flags=flags)
    if count != 1:
        raise SystemExit(f"{label}: expected 1 match, found {count}")
    return updated


app_path = Path("web/app/dayframe-v2.tsx")
app = app_path.read_text()

app = sub_once(
    app,
    r'(  const \[milestoneDate, setMilestoneDate\] = useState\(""\);\n)(  const focusTimer)',
    r'\1  const [editingMilestoneId, setEditingMilestoneId] = useState<string | null>(null);\n\2',
    "milestone state",
)

app = sub_once(
    app,
    r'      if \(event\.key === "Escape"\) setEditing\(null\);',
    '      if (event.key === "Escape") {\n        setEditing(null);\n        setEditingMilestoneId(null);\n      }',
    "escape handler",
)

marker = '''  function addNewMilestone(event: React.FormEvent) {
    event.preventDefault();
    if (!milestoneTitle.trim() || !milestoneDate) return;
    setData((current) => addMilestone(current, milestoneTitle, milestoneDate));
    setMilestoneTitle("");
    setMilestoneDate("");
  }
'''
if marker not in app:
    raise SystemExit("add milestone marker not found")
addition = marker + '''
  function saveMilestoneEdit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingMilestoneId) return;
    const form = new FormData(event.currentTarget);
    const title = String(form.get("title") || "").trim();
    const date = String(form.get("date") || "");
    const note = String(form.get("note") || "").trim();
    if (!title || !date) return;
    setData((current) => ({
      ...current,
      milestones: current.milestones
        .map((milestone) => milestone.id === editingMilestoneId
          ? { ...milestone, title, date, note: note || "Vlastní termín" }
          : milestone)
        .sort((a, b) => a.date.localeCompare(b.date)),
    }));
    setEditingMilestoneId(null);
  }

  function removeMilestone(id: string) {
    setData((current) => ({ ...current, milestones: current.milestones.filter((milestone) => milestone.id !== id) }));
    setEditingMilestoneId(null);
  }

  const editingMilestone = editingMilestoneId
    ? data.milestones.find((milestone) => milestone.id === editingMilestoneId) ?? null
    : null;
'''
app = app.replace(marker, addition, 1)

old_list = '<div className="df2-milestones">{[...data.milestones].sort((a, b) => a.date.localeCompare(b.date)).map((milestone) => <article key={milestone.id}><div><span>{milestone.note}</span><strong>{milestone.title}</strong></div><div className="df2-milestone-remaining"><strong>{daysUntilDate(milestone.date, now)}</strong><span>dní</span></div><time>{longDate(milestone.date)}</time></article>)}</div>'
new_list = '<div className="df2-milestones">{[...data.milestones].sort((a, b) => a.date.localeCompare(b.date)).map((milestone) => <article key={milestone.id} role="button" tabIndex={0} title="Upravit milník" onClick={() => setEditingMilestoneId(milestone.id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setEditingMilestoneId(milestone.id); } }}><div><span>{milestone.note}</span><strong>{milestone.title}</strong></div><div className="df2-milestone-remaining"><strong>{daysUntilDate(milestone.date, now)}</strong><span>dní</span></div><time>{longDate(milestone.date)}</time></article>)}</div>'
if old_list not in app:
    raise SystemExit("milestone list not found")
app = app.replace(old_list, new_list, 1)

modal_anchor = '''      {editing && (
        <div className="df2-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditing(null); }}>'''
if modal_anchor not in app:
    raise SystemExit("task modal anchor not found")
milestone_modal = '''      {editingMilestone && (
        <div className="df2-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditingMilestoneId(null); }}>
          <form className="df2-modal" onSubmit={saveMilestoneEdit}>
            <header><div><span>Milník</span><h2>Upravit milník</h2></div><button type="button" onClick={() => setEditingMilestoneId(null)}>×</button></header>
            <label>Název<input name="title" autoFocus defaultValue={editingMilestone.title} /></label>
            <div className="df2-form-grid"><label>Datum<input name="date" type="date" defaultValue={editingMilestone.date} /></label><label>Popisek<input name="note" defaultValue={editingMilestone.note} placeholder="Např. hlavní termín" /></label></div>
            <div className="df2-modal-actions"><button className="df2-primary">Uložit změny</button><button type="button" className="danger" onClick={() => removeMilestone(editingMilestone.id)}>Smazat milník</button></div>
          </form>
        </div>
      )}

'''
app = app.replace(modal_anchor, milestone_modal + modal_anchor, 1)
app_path.write_text(app)

css_path = Path("web/app/dayframe-v2.css")
css = css_path.read_text()
old_css = '.df2-milestones article { display: flex; align-items: center; justify-content: space-between; gap: 18px; min-height: 78px; padding: 12px 4px; border-bottom: 1px solid var(--line); }\n.df2-milestones article > div { display: grid; gap: 5px; }'
new_css = '.df2-milestones article { display: flex; align-items: center; justify-content: space-between; gap: 18px; min-height: 78px; padding: 12px 4px; border-bottom: 1px solid var(--line); cursor: pointer; transition: background .12s ease, padding .12s ease; }\n.df2-milestones article:hover { padding-inline: 10px; background: var(--paper); }\n.df2-milestones article:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }\n.df2-milestones article > div { display: grid; gap: 5px; }'
if old_css not in css:
    raise SystemExit("milestone css not found")
css_path.write_text(css.replace(old_css, new_css, 1))

test_path = Path("web/e2e/dayframe-calendar.spec.mjs")
test = test_path.read_text()
old_end = '''  await targetAfterSave.locator(".df2-week-task").filter({ hasText: "Zeměpis" }).click();
  await expect(page.getByRole("heading", { name: "Upravit" })).toBeVisible();
});'''
new_end = '''  await targetAfterSave.locator(".df2-week-task").filter({ hasText: "Zeměpis" }).click();
  await expect(page.getByRole("heading", { name: "Upravit" })).toBeVisible();
  await page.locator(".df2-modal header > button").click();

  await page.locator(".df2-sidebar nav button").filter({ hasText: "Milníky" }).click();
  const milestone = page.locator(".df2-milestones article").filter({ hasText: "Dokončit CFI Excel" });
  await milestone.click();
  await expect(page.getByRole("heading", { name: "Upravit milník" })).toBeVisible();
  await page.locator('.df2-modal input[name="title"]').fill("Dokončit CFI Excel test");
  await page.locator('.df2-modal input[name="date"]').fill("2026-11-02");
  await page.locator('.df2-modal input[name="note"]').fill("Aktualizovaný termín");
  await page.getByRole("button", { name: "Uložit změny" }).click();
  await expect(page.locator(".df2-milestones")).toContainText("Dokončit CFI Excel test");
  await expect(page.locator(".df2-milestones")).toContainText("Aktualizovaný termín");
});'''
if old_end not in test:
    raise SystemExit("browser test anchor not found")
test_path.write_text(test.replace(old_end, new_end, 1))
