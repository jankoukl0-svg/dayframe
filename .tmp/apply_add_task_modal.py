from pathlib import Path

root = Path(__file__).resolve().parents[1]
app = root / "web/app/dayframe-v2.tsx"
css = root / "web/app/dayframe-v2.css"
old_test = root / "web/e2e/dayframe-calendar.spec.mjs"
new_test = root / "web/e2e/add-task-modal.spec.mjs"

text = app.read_text(encoding="utf-8")

text = text.replace(
    'type View = "today" | "week" | "add" | "focus" | "milestones" | "settings";',
    'type View = "today" | "week" | "focus" | "milestones" | "settings";',
)

text = text.replace(
    '  const [draft, setDraft] = useState<Draft>(() => emptyDraft());\n  const [editing, setEditing] = useState<CalendarTask | null>(null);',
    '  const [draft, setDraft] = useState<Draft>(() => emptyDraft());\n  const [addingTask, setAddingTask] = useState(false);\n  const [editing, setEditing] = useState<CalendarTask | null>(null);',
)

text = text.replace(
    '      if (event.key === "Escape") {\n        setEditing(null);\n        setEditingMilestoneId(null);\n      }',
    '      if (event.key === "Escape") {\n        setAddingTask(false);\n        setEditing(null);\n        setEditingMilestoneId(null);\n      }',
)

old_open = '''  function openAdd(date = "") {\n    setDraft({ ...emptyDraft(), date });\n    setError("");\n    setNotice("");\n    setView("add");\n  }'''
new_open = '''  function openAdd(date = "", start = "") {\n    setDraft({ ...emptyDraft(), date, start });\n    setError("");\n    setNotice("");\n    setAddingTask(true);\n  }\n\n  function closeAdd() {\n    setAddingTask(false);\n    setDraft(emptyDraft());\n    setError("");\n  }'''
assert old_open in text, "openAdd block changed"
text = text.replace(old_open, new_open)

text = text.replace(
    '    setDraft(emptyDraft());\n  }\n\n  function saveEdit',
    '    setDraft(emptyDraft());\n    setAddingTask(false);\n  }\n\n  function saveEdit',
    1,
)

text = text.replace(
    '<NavButton active={view === "add"} onClick={() => openAdd()} label="Přidat úkol" shortcut="2" />',
    '<NavButton active={false} onClick={() => openAdd()} label="Přidat úkol" shortcut="2" />',
)

start_marker = '          {view === "add" && ('
end_marker = '          {view === "focus" && ('
start = text.index(start_marker)
end = text.index(end_marker, start)
text = text[:start] + text[end:]

modal = '''      {addingTask && (\n        <div className="df2-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeAdd(); }}>\n          <form className="df2-modal df2-add-modal df2-add-form" role="dialog" aria-modal="true" aria-labelledby="df2-add-task-title" onSubmit={submitDraft}>\n            <header><div><h2 id="df2-add-task-title">Přidat úkol</h2></div><button type="button" aria-label="Zavřít" onClick={closeAdd}>×</button></header>\n            <label className="df2-title-input"><span>Úkol</span><input autoFocus value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="Např. zeměpis 20 min" /></label>\n            <div className="df2-chips" aria-label="Rychlá nastavení">\n              <label><span>Den</span><input type="date" value={draft.date} min={todayKey} onChange={(event) => setDraft({ ...draft, date: event.target.value })} /></label>\n              <label><span>Délka</span><select value={draft.duration} onChange={(event) => setDraft({ ...draft, duration: Number(event.target.value) })}><option value={20}>20 min</option><option value={30}>30 min</option><option value={45}>45 min</option><option value={60}>60 min</option><option value={90}>90 min</option><option value={120}>120 min</option></select></label>\n              <label><span>Začít v</span><input type="time" value={draft.start} onChange={(event) => setDraft({ ...draft, start: event.target.value })} /></label>\n              <label><span>Priorita</span><select value={draft.priority} onChange={(event) => setDraft({ ...draft, priority: event.target.value as Priority })}><option value="normal">Běžná</option><option value="high">Vysoká</option><option value="low">Nízká</option></select></label>\n            </div>\n            <details className="df2-details">\n              <summary>Podrobnosti</summary>\n              <div className="df2-details-grid">\n                <label>Dokončit do<input type="date" value={draft.dueDate} min={todayKey} onChange={(event) => setDraft({ ...draft, dueDate: event.target.value })} /></label>\n                <label>Nejpozději v<input type="time" value={draft.deadlineTime} onChange={(event) => setDraft({ ...draft, deadlineTime: event.target.value })} /></label>\n                <label>Oblast<select value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value })}>{categories.map((category) => <option key={category}>{category}</option>)}</select></label>\n                <label>Opakování<select value={draft.repeat} onChange={(event) => setDraft({ ...draft, repeat: event.target.value as RepeatRule })}><option value="none">Neopakovat</option><option value="daily">Každý den</option><option value="weekly">Každý týden</option></select></label>\n              </div>\n            </details>\n            {draft.title.trim() && <div className="df2-understood"><strong>{cleanSmartTitle(draft.title)}</strong><small>{draft.date ? shortDate(draft.date) : "Tento týden"} · {draft.duration} min{draft.start ? ` · ${draft.start}` : " · automaticky"}</small></div>}\n            {error && <p className="df2-error">{error}</p>}\n            <div className="df2-modal-actions"><button className="df2-primary" type="submit" disabled={!hydrated || !draft.title.trim()}>Naplánovat</button><button type="button" onClick={closeAdd}>Zrušit</button></div>\n          </form>\n        </div>\n      )}\n\n'''
anchor = '      {editingMilestone && ('
assert anchor in text, "modal anchor changed"
text = text.replace(anchor, modal + anchor, 1)

app.write_text(text, encoding="utf-8")

css_text = css.read_text(encoding="utf-8")
css_patch = '''\n/* Add-task is an action inside the current view, not a standalone destination. */\n.df2-add-modal {\n  width: min(760px, 100%);\n  gap: 18px;\n}\n\n.df2-add-modal .df2-title-input > input {\n  width: 100%;\n}\n\n.df2-add-modal .df2-details {\n  margin-top: 1px;\n}\n\n@media (max-width: 720px) {\n  .df2-add-modal {\n    width: 100%;\n    max-height: calc(100vh - 28px);\n    padding: 18px;\n  }\n\n  .df2-add-modal .df2-chips {\n    display: grid;\n    grid-template-columns: repeat(2, minmax(0, 1fr));\n  }\n\n  .df2-add-modal .df2-chips input,\n  .df2-add-modal .df2-chips select {\n    min-width: 0;\n    width: 100%;\n  }\n}\n'''
if "/* Add-task is an action inside the current view" not in css_text:
    css.write_text(css_text.rstrip() + "\n" + css_patch, encoding="utf-8")

old = old_test.read_text(encoding="utf-8")
old_result = '''  const result = page.locator(".df2-result");\n  await expect(result).toContainText("Zeměpis");\n  await expect(result).not.toContainText("[[");\n\n  await result.getByRole("button", { name: "Týden", exact: true }).click();\n  await expect(page.locator(".df2-week-grid")).toBeVisible();\n  const targetAfterSave = page.locator(".df2-week-day").nth(targetIndex);'''
new_result = '''  await expect(page.getByRole("dialog", { name: "Přidat úkol" })).toHaveCount(0);\n  await expect(page.locator(".df2-week-grid")).toBeVisible();\n  const targetAfterSave = page.locator(".df2-week-day").nth(targetIndex);'''
assert old_result in old, "dayframe-calendar result flow changed"
old = old.replace(old_result, new_result)
old_test.write_text(old, encoding="utf-8")

new_test.write_text(r'''import { test, expect } from "@playwright/test";

const baseUrl = process.env.DAYFRAME_BASE_URL || "http://127.0.0.1:4173";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear());
  await page.goto(baseUrl, { waitUntil: "networkidle" });
});

test("add task opens as a modal without leaving Today and closes with Escape", async ({ page }) => {
  const todayNav = page.locator(".df2-sidebar nav button").filter({ hasText: "Dnes" });
  const addNav = page.locator(".df2-sidebar nav button").filter({ hasText: "Přidat úkol" });

  await expect(todayNav).toHaveClass(/active/);
  await page.getByRole("button", { name: "+ Nový úkol" }).click();

  const dialog = page.getByRole("dialog", { name: "Přidat úkol" });
  await expect(dialog).toBeVisible();
  await expect(todayNav).toHaveClass(/active/);
  await expect(addNav).not.toHaveClass(/active/);

  const expectedToday = await page.evaluate(() => {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  });
  await expect(dialog.locator('input[type="date"]').first()).toHaveValue(expectedToday);

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(todayNav).toHaveClass(/active/);
});

test("sidebar and shortcut 2 open the modal while preserving the active week", async ({ page }) => {
  const weekNav = page.locator(".df2-sidebar nav button").filter({ hasText: "Týden" });
  const addNav = page.locator(".df2-sidebar nav button").filter({ hasText: "Přidat úkol" });
  await weekNav.click();
  await expect(page.locator(".df2-week-grid")).toBeVisible();

  await addNav.click();
  await expect(page.getByRole("dialog", { name: "Přidat úkol" })).toBeVisible();
  await expect(weekNav).toHaveClass(/active/);
  await expect(addNav).not.toHaveClass(/active/);

  await page.getByRole("button", { name: "Zavřít" }).click();
  await page.keyboard.press("2");
  await expect(page.getByRole("dialog", { name: "Přidat úkol" })).toBeVisible();
  await expect(weekNav).toHaveClass(/active/);

  await page.locator(".df2-modal-backdrop").click({ position: { x: 5, y: 5 } });
  await expect(page.getByRole("dialog", { name: "Přidat úkol" })).toHaveCount(0);
  await expect(page.locator(".df2-week-grid")).toBeVisible();
});

test("week day add prefills the date and scheduling returns directly to the week", async ({ page }) => {
  await page.locator(".df2-sidebar nav button").filter({ hasText: "Týden" }).click();
  await expect(page.locator(".df2-week-grid")).toBeVisible();

  const today = page.locator(".df2-week-day.today");
  const expectedDate = await page.evaluate(() => {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  });

  await today.locator(".df2-week-day-head > button").click();
  const dialog = page.getByRole("dialog", { name: "Přidat úkol" });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('input[type="date"]').first()).toHaveValue(expectedDate);

  await dialog.locator(".df2-title-input input").fill("Modal test 20 min");
  await dialog.getByRole("button", { name: "Naplánovat" }).click();

  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".df2-week-grid")).toBeVisible();
  await expect(page.locator(".df2-week-day.today")).toContainText("Modal test");
  await expect(page.locator(".df2-sidebar nav button").filter({ hasText: "Týden" })).toHaveClass(/active/);
});
''', encoding="utf-8")

# Helper files are removed by the workflow after this script succeeds.
