from pathlib import Path


def replace_once(path, old, new):
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f'missing expected text in {path}: {old[:100]!r}')
    p.write_text(text.replace(old, new, 1))

path = 'web/app/late-reading-controller.tsx'
replace_once(path,
'''function isReadingTask(task: StoredTask | null | undefined) {
  return task?.routineId === "read" || normalizedTitle(task?.title) === "čtení knihy";
}
''',
'''function isReadingTask(task: StoredTask | null | undefined) {
  const title = normalizedTitle(task?.title);
  return task?.routineId === "read" || title === "čtení knihy" || title.includes("čtení");
}
''')
replace_once(path,
'''function usesLateLane(body: HTMLElement, clientY: number, drag: DragInfo) {
  return rawTargetStart(body, clientY, drag) + drag.duration > NORMAL_DAY_END;
}
''',
'''function usesLateLane(body: HTMLElement, clientY: number, drag: DragInfo) {
  return targetStart(body, clientY, drag) + drag.duration >= NORMAL_DAY_END;
}
''')
replace_once(path,
'''      event.preventDefault();
      event.stopPropagation();

      if (!drag.reading) {
        clearPreview();
        return;
      }

      const day = body.closest<HTMLElement>(".df2-week-day");
''',
'''      if (!drag.reading) {
        clearPreview();
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      const day = body.closest<HTMLElement>(".df2-week-day");
''')
replace_once(path,
'''      event.preventDefault();
      event.stopPropagation();

      if (!drag.reading) {
        clearPreview();
        drag = null;
        return;
      }

      const day = body.closest<HTMLElement>(".df2-week-day");
''',
'''      if (!drag.reading) {
        clearPreview();
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      const day = body.closest<HTMLElement>(".df2-week-day");
''')

path = 'web/e2e/week-reading-23.spec.mjs'
p = Path(path)
text = p.read_text()
text = text.replace('23:00–24:00', '23:00–00:00')
text = text.replace('23:00-24:00', '23:00-00:00')
text = text.replace('test("the 23:00 hour stays locked for ordinary tasks", async ({ page }) => {', 'test("ordinary tasks can use the late lane through 02:00", async ({ page }) => {')
text = text.replace('  expect(`${stored.start}-${stored.end}`).toBe("20:00-20:20");\n});\n', '  expect(`${stored.start}-${stored.end}`).toBe("23:00-23:20");\n});\n', 1)
p.write_text(text)
