from pathlib import Path

root = Path(__file__).resolve().parents[1]
app = root / "web/app/dayframe-v2.tsx"
text = app.read_text(encoding="utf-8")
old = '''    const keyHandler = (event: KeyboardEvent) => {\n      const target = event.target as HTMLElement | null;\n      if (target?.matches("input, textarea, select, [contenteditable='true']")) return;\n      if (event.key === "1") setView("today");\n      if (event.key.toLowerCase() === "w") setView("week");\n      if (event.key === "2") openAdd();\n      if (event.key === "3") setView("focus");\n      if (event.key === "4") setView("milestones");\n      if (event.key === "5") setView("settings");\n      if (event.key === "Escape") {\n        setAddingTask(false);\n        setEditing(null);\n        setEditingMilestoneId(null);\n      }\n    };'''
new = '''    const keyHandler = (event: KeyboardEvent) => {\n      const target = event.target as HTMLElement | null;\n      if (event.key === "Escape") {\n        setAddingTask(false);\n        setEditing(null);\n        setEditingMilestoneId(null);\n        return;\n      }\n      if (target?.matches("input, textarea, select, [contenteditable='true']")) return;\n      if (event.key === "1") setView("today");\n      if (event.key.toLowerCase() === "w") setView("week");\n      if (event.key === "2") openAdd();\n      if (event.key === "3") setView("focus");\n      if (event.key === "4") setView("milestones");\n      if (event.key === "5") setView("settings");\n    };'''
assert old in text, "keyboard handler changed"
app.write_text(text.replace(old, new, 1), encoding="utf-8")
