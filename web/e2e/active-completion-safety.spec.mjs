import { test, expect } from "@playwright/test";

function timeToMinutes(value) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours < 8 ? hours * 60 + minutes + 24 * 60 : hours * 60 + minutes;
}

test.beforeEach(async ({ page }) => {
  await page.goto(process.env.DAYFRAME_BASE_URL || "http://127.0.0.1:4173", { waitUntil: "networkidle" });
  await page.evaluate(() => window.localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
  await expect.poll(() => page.evaluate(() => Boolean(window.localStorage.getItem("dayframe-v1")))).toBe(true);
});

test("Hotovo during a live block commits it even when the freed-time choice is ignored", async ({ page }) => {
  const seeded = await page.evaluate(() => {
    const state = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}");
    const now = new Date();
    const clockMinute = now.getHours() * 60 + now.getMinutes();
    const planningMinute = clockMinute < 2 * 60 ? clockMinute + 24 * 60 : clockMinute;
    if (planningMinute < 8 * 60 + 2 || planningMinute > 25 * 60 + 40) return null;

    const planningDate = new Date(now);
    if (clockMinute < 2 * 60) planningDate.setDate(planningDate.getDate() - 1);
    const date = `${planningDate.getFullYear()}-${String(planningDate.getMonth() + 1).padStart(2, "0")}-${String(planningDate.getDate()).padStart(2, "0")}`;
    const startMinute = planningMinute - 10;
    const endMinute = planningMinute + 10;
    const toTime = (value) => {
      const clock = ((value % (24 * 60)) + 24 * 60) % (24 * 60);
      return `${String(Math.floor(clock / 60)).padStart(2, "0")}:${String(clock % 60).padStart(2, "0")}`;
    };

    state.routines = [];
    state.plans[date] = [{
      id: "finish-now-test",
      title: "Dokončit teď",
      date,
      duration: 20,
      start: toTime(startMinute),
      end: toTime(endMinute),
      requestedStart: toTime(startMinute),
      dueDate: date,
      deadlineTime: "23:59",
      priority: "normal",
      category: "Matika",
      mode: "flexible",
      completed: false,
      source: "user",
      dateLocked: true,
      autoScheduled: false,
      createdAt: now.toISOString(),
    }];
    window.localStorage.setItem("dayframe-v1", JSON.stringify(state));
    return { date, originalEnd: toTime(endMinute), originalDuration: 20 };
  });

  test.skip(!seeded, "Current clock is outside the Dayframe planning window.");
  await page.reload({ waitUntil: "networkidle" });

  const done = page.locator(".df2-time-adjust-host").getByRole("button", { name: "Hotovo" });
  await expect(done).toBeVisible();
  await done.click();

  // Do not choose Volno / Začít další. The first Hotovo click must still become final.
  await expect.poll(async () => page.evaluate(({ date }) => {
    const task = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}").plans[date]
      .find((item) => item.id === "finish-now-test");
    return task ? { completed: task.completed, end: task.end, duration: task.duration } : null;
  }, seeded), { timeout: 3500 }).toMatchObject({ completed: true });

  const stored = await page.evaluate(({ date }) => JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}").plans[date]
    .find((item) => item.id === "finish-now-test"), seeded);
  expect(stored.end).not.toBe(seeded.originalEnd);
  expect(stored.duration).toBeLessThan(seeded.originalDuration);
  expect(stored.duration).toBe(timeToMinutes(stored.end) - timeToMinutes(stored.start));
  expect(stored.plannedEnd).toBe(seeded.originalEnd);

  await page.getByRole("button", { name: "Týden" }).click();
  const weekTask = page.locator(".df2-week-task", { hasText: "Dokončit teď" });
  await expect(weekTask).toHaveClass(/done/);
  await expect(weekTask).toContainText(`${stored.start}–${stored.end}`);
});


test("undoing a live completion restores the running execution snapshot", async ({ page }) => {
  const seeded = await page.evaluate(() => {
    const state = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}");
    const now = new Date();
    const clockMinute = now.getHours() * 60 + now.getMinutes();
    const planningMinute = clockMinute < 2 * 60 ? clockMinute + 24 * 60 : clockMinute;
    if (planningMinute < 8 * 60 + 2 || planningMinute > 25 * 60 + 40) return null;

    const planningDate = new Date(now);
    if (clockMinute < 2 * 60) planningDate.setDate(planningDate.getDate() - 1);
    const date = `${planningDate.getFullYear()}-${String(planningDate.getMonth() + 1).padStart(2, "0")}-${String(planningDate.getDate()).padStart(2, "0")}`;
    const startMinute = planningMinute - 10;
    const endMinute = planningMinute + 10;
    const toTime = (value) => {
      const clock = ((value % (24 * 60)) + 24 * 60) % (24 * 60);
      return `${String(Math.floor(clock / 60)).padStart(2, "0")}:${String(clock % 60).padStart(2, "0")}`;
    };
    const actualStartedAt = new Date(now.getTime() - 7 * 60 * 1000).toISOString();
    const actualRunningSince = new Date(now.getTime() - 2 * 60 * 1000).toISOString();

    state.routines = [];
    state.plans[date] = [{
      id: "undo-running-test",
      title: "Živý blok",
      date,
      duration: 20,
      start: toTime(startMinute),
      end: toTime(endMinute),
      requestedStart: toTime(startMinute),
      dueDate: date,
      deadlineTime: "23:59",
      priority: "normal",
      category: "Matika",
      mode: "flexible",
      completed: false,
      source: "user",
      dateLocked: true,
      autoScheduled: false,
      createdAt: now.toISOString(),
      actualStartedAt,
      actualAccumulatedSeconds: 90,
      actualRunningSince,
    }];
    window.localStorage.setItem("dayframe-v1", JSON.stringify(state));
    return { date, actualStartedAt, actualRunningSince };
  });

  test.skip(!seeded, "Current clock is outside the Dayframe planning window.");
  await page.reload({ waitUntil: "networkidle" });

  const done = page.locator(".df2-time-adjust-host").getByRole("button", { name: "Hotovo" });
  await expect(done).toBeVisible();
  await done.evaluate((button) => button.click());

  const completion = page.locator(".df2-active-completion-floating");
  await expect(completion).toContainText("Úkol dokončen");
  await completion.getByRole("button", { name: "Vrátit", exact: true }).click();

  await expect.poll(() => page.evaluate(({ date }) => {
    const task = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}").plans[date]
      .find((item) => item.id === "undo-running-test");
    return task ? {
      completed: task.completed,
      actualStartedAt: task.actualStartedAt,
      actualAccumulatedSeconds: task.actualAccumulatedSeconds,
      actualRunningSince: task.actualRunningSince,
      actualEndedAt: task.actualEndedAt ?? null,
    } : null;
  }, seeded)).toEqual({
    completed: false,
    actualStartedAt: seeded.actualStartedAt,
    actualAccumulatedSeconds: 90,
    actualRunningSince: seeded.actualRunningSince,
    actualEndedAt: null,
  });
});


test("active completion undo preserves edits made after completion", async ({ page }) => {
  const seeded = await page.evaluate(() => {
    const state = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}");
    const now = new Date();
    const clockMinute = now.getHours() * 60 + now.getMinutes();
    const planningMinute = clockMinute < 2 * 60 ? clockMinute + 24 * 60 : clockMinute;
    if (planningMinute < 8 * 60 + 2 || planningMinute > 25 * 60 + 40) return null;

    const planningDate = new Date(now);
    if (clockMinute < 2 * 60) planningDate.setDate(planningDate.getDate() - 1);
    const date = `${planningDate.getFullYear()}-${String(planningDate.getMonth() + 1).padStart(2, "0")}-${String(planningDate.getDate()).padStart(2, "0")}`;
    const startMinute = planningMinute - 10;
    const endMinute = planningMinute + 10;
    const toTime = (value) => {
      const clock = ((value % (24 * 60)) + 24 * 60) % (24 * 60);
      return `${String(Math.floor(clock / 60)).padStart(2, "0")}:${String(clock % 60).padStart(2, "0")}`;
    };

    state.routines = [];
    state.plans[date] = [{
      id: "undo-edited-test",
      title: "Původní název",
      date,
      duration: 20,
      start: toTime(startMinute),
      end: toTime(endMinute),
      requestedStart: toTime(startMinute),
      dueDate: date,
      deadlineTime: "23:59",
      priority: "normal",
      category: "Matika",
      mode: "flexible",
      completed: false,
      source: "user",
      dateLocked: true,
      autoScheduled: false,
      createdAt: now.toISOString(),
    }];
    window.localStorage.setItem("dayframe-v1", JSON.stringify(state));
    return { date };
  });

  test.skip(!seeded, "Current clock is outside the Dayframe planning window.");
  await page.reload({ waitUntil: "networkidle" });

  const done = page.locator(".df2-time-adjust-host").getByRole("button", { name: "Hotovo" });
  await expect(done).toBeVisible();
  await done.click();
  const completion = page.locator(".df2-active-completion-floating");
  await expect(completion).toBeVisible();

  await page.evaluate(({ date }) => {
    const state = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}");
    const task = state.plans[date].find((item) => item.id === "undo-edited-test");
    task.title = "Upravený název";
    task.category = "Finance";
    window.localStorage.setItem("dayframe-v1", JSON.stringify(state));
  }, seeded);

  await completion.getByRole("button", { name: "Vrátit", exact: true }).click();

  await expect.poll(() => page.evaluate(({ date }) => {
    const task = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}").plans[date]
      .find((item) => item.id === "undo-edited-test");
    return task ? { completed: task.completed, title: task.title, category: task.category } : null;
  }, seeded)).toEqual({
    completed: false,
    title: "Upravený název",
    category: "Finance",
  });
});


test("active completion undo follows a task moved to another planning day", async ({ page }) => {
  const seeded = await page.evaluate(() => {
    const state = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}");
    const now = new Date();
    const clockMinute = now.getHours() * 60 + now.getMinutes();
    const planningMinute = clockMinute < 2 * 60 ? clockMinute + 24 * 60 : clockMinute;
    if (planningMinute < 8 * 60 + 2 || planningMinute > 25 * 60 + 40) return null;

    const planningDate = new Date(now);
    if (clockMinute < 2 * 60) planningDate.setDate(planningDate.getDate() - 1);
    const originalDate = `${planningDate.getFullYear()}-${String(planningDate.getMonth() + 1).padStart(2, "0")}-${String(planningDate.getDate()).padStart(2, "0")}`;
    const moved = new Date(planningDate);
    moved.setDate(moved.getDate() + 1);
    const movedDate = `${moved.getFullYear()}-${String(moved.getMonth() + 1).padStart(2, "0")}-${String(moved.getDate()).padStart(2, "0")}`;
    const startMinute = planningMinute - 10;
    const endMinute = planningMinute + 10;
    const toTime = (value) => {
      const clock = ((value % (24 * 60)) + 24 * 60) % (24 * 60);
      return `${String(Math.floor(clock / 60)).padStart(2, "0")}:${String(clock % 60).padStart(2, "0")}`;
    };

    state.routines = [];
    state.plans[originalDate] = [{
      id: "undo-moved-test",
      title: "Přesunutý blok",
      date: originalDate,
      duration: 20,
      start: toTime(startMinute),
      end: toTime(endMinute),
      requestedStart: toTime(startMinute),
      deadlineTime: "23:59",
      priority: "normal",
      category: "Matika",
      mode: "flexible",
      completed: false,
      source: "user",
      dateLocked: true,
      autoScheduled: false,
      createdAt: now.toISOString(),
    }];
    state.plans[movedDate] = state.plans[movedDate] || [];
    window.localStorage.setItem("dayframe-v1", JSON.stringify(state));
    return { originalDate, movedDate };
  });

  test.skip(!seeded, "Current clock is outside the Dayframe planning window.");
  await page.reload({ waitUntil: "networkidle" });

  const done = page.locator(".df2-time-adjust-host").getByRole("button", { name: "Hotovo" });
  await expect(done).toBeVisible();
  await done.click();

  const completion = page.locator(".df2-active-completion-floating");
  await expect(completion).toBeVisible();

  await page.evaluate(({ originalDate, movedDate }) => {
    const state = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}");
    const task = state.plans[originalDate].find((item) => item.id === "undo-moved-test");
    state.plans[originalDate] = state.plans[originalDate].filter((item) => item.id !== "undo-moved-test");
    state.plans[movedDate] = [...(state.plans[movedDate] || []), { ...task, date: movedDate }];
    window.localStorage.setItem("dayframe-v1", JSON.stringify(state));
  }, seeded);

  await completion.getByRole("button", { name: "Vrátit", exact: true }).click();

  await expect.poll(() => page.evaluate(({ movedDate }) => {
    const task = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}").plans[movedDate]
      .find((item) => item.id === "undo-moved-test");
    return task ? { completed: task.completed, date: task.date } : null;
  }, seeded)).toEqual({
    completed: false,
    date: seeded.movedDate,
  });
});

test("active completion undo preserves an edited schedule as one atomic group", async ({ page }) => {
  const seeded = await page.evaluate(() => {
    const state = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}");
    const now = new Date();
    const clockMinute = now.getHours() * 60 + now.getMinutes();
    const planningMinute = clockMinute < 2 * 60 ? clockMinute + 24 * 60 : clockMinute;
    if (planningMinute < 8 * 60 + 2 || planningMinute > 25 * 60 + 40) return null;

    const planningDate = new Date(now);
    if (clockMinute < 2 * 60) planningDate.setDate(planningDate.getDate() - 1);
    const date = `${planningDate.getFullYear()}-${String(planningDate.getMonth() + 1).padStart(2, "0")}-${String(planningDate.getDate()).padStart(2, "0")}`;
    const startMinute = planningMinute - 10;
    const endMinute = planningMinute + 10;
    const toTime = (value) => {
      const clock = ((value % (24 * 60)) + 24 * 60) % (24 * 60);
      return `${String(Math.floor(clock / 60)).padStart(2, "0")}:${String(clock % 60).padStart(2, "0")}`;
    };

    state.routines = [];
    state.plans[date] = [{
      id: "undo-schedule-test",
      title: "Upravený čas",
      date,
      duration: 20,
      start: toTime(startMinute),
      end: toTime(endMinute),
      requestedStart: toTime(startMinute),
      deadlineTime: "23:59",
      priority: "normal",
      category: "Matika",
      mode: "flexible",
      completed: false,
      source: "user",
      dateLocked: true,
      autoScheduled: false,
      createdAt: now.toISOString(),
    }];
    window.localStorage.setItem("dayframe-v1", JSON.stringify(state));
    return { date };
  });

  test.skip(!seeded, "Current clock is outside the Dayframe planning window.");
  await page.reload({ waitUntil: "networkidle" });

  const done = page.locator(".df2-time-adjust-host").getByRole("button", { name: "Hotovo" });
  await expect(done).toBeVisible();
  await done.click();

  const completion = page.locator(".df2-active-completion-floating");
  await expect(completion).toBeVisible();

  const edited = await page.evaluate(({ date }) => {
    const state = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}");
    const task = state.plans[date].find((item) => item.id === "undo-schedule-test");
    const [hours, minutes] = task.start.split(":").map(Number);
    const startMinute = hours * 60 + minutes + 30;
    const toTime = (value) => `${String(Math.floor((value % (24 * 60)) / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
    task.start = toTime(startMinute);
    task.duration = 35;
    task.end = toTime(startMinute + task.duration);
    window.localStorage.setItem("dayframe-v1", JSON.stringify(state));
    return { start: task.start, end: task.end, duration: task.duration };
  }, seeded);

  await completion.getByRole("button", { name: "Vrátit", exact: true }).click();

  await expect.poll(() => page.evaluate(({ date }) => {
    const task = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}").plans[date]
      .find((item) => item.id === "undo-schedule-test");
    return task ? { completed: task.completed, start: task.start, end: task.end, duration: task.duration } : null;
  }, seeded)).toEqual({
    completed: false,
    start: edited.start,
    end: edited.end,
    duration: edited.duration,
  });
});


test("active completion undo stays completed when the original interval is occupied", async ({ page }) => {
  const seeded = await page.evaluate(() => {
    const state = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}");
    const now = new Date();
    const clockMinute = now.getHours() * 60 + now.getMinutes();
    const planningMinute = clockMinute < 2 * 60 ? clockMinute + 24 * 60 : clockMinute;
    if (planningMinute < 8 * 60 + 2 || planningMinute > 25 * 60 + 35) return null;

    const planningDate = new Date(now);
    if (clockMinute < 2 * 60) planningDate.setDate(planningDate.getDate() - 1);
    const date = `${planningDate.getFullYear()}-${String(planningDate.getMonth() + 1).padStart(2, "0")}-${String(planningDate.getDate()).padStart(2, "0")}`;
    const startMinute = planningMinute - 10;
    const endMinute = planningMinute + 15;
    const toTime = (value) => {
      const clock = ((value % (24 * 60)) + 24 * 60) % (24 * 60);
      return `${String(Math.floor(clock / 60)).padStart(2, "0")}:${String(clock % 60).padStart(2, "0")}`;
    };

    state.routines = [];
    state.plans[date] = [{
      id: "undo-conflict-test",
      title: "Původní blok",
      date,
      duration: 25,
      start: toTime(startMinute),
      end: toTime(endMinute),
      requestedStart: toTime(startMinute),
      deadlineTime: "23:59",
      priority: "normal",
      category: "Matika",
      mode: "flexible",
      completed: false,
      source: "user",
      dateLocked: true,
      autoScheduled: false,
      createdAt: now.toISOString(),
    }];
    window.localStorage.setItem("dayframe-v1", JSON.stringify(state));
    return { date, blockerEnd: toTime(endMinute) };
  });

  test.skip(!seeded, "Current clock is outside the Dayframe planning window.");
  await page.reload({ waitUntil: "networkidle" });

  const done = page.locator(".df2-time-adjust-host").getByRole("button", { name: "Hotovo" });
  await expect(done).toBeVisible();
  await done.click();

  const completion = page.locator(".df2-active-completion-floating");
  await expect(completion).toBeVisible();

  const shortenedEnd = await page.evaluate(({ date, blockerEnd }) => {
    const state = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}");
    const task = state.plans[date].find((item) => item.id === "undo-conflict-test");
    state.plans[date].push({
      id: "occupy-freed-time",
      title: "Nový blok ve volném čase",
      date,
      duration: 15,
      start: task.end,
      end: blockerEnd,
      requestedStart: task.end,
      deadlineTime: "23:59",
      priority: "normal",
      category: "Studium",
      mode: "flexible",
      completed: false,
      source: "user",
      dateLocked: true,
      autoScheduled: false,
      createdAt: new Date().toISOString(),
    });
    window.localStorage.setItem("dayframe-v1", JSON.stringify(state));
    return task.end;
  }, seeded);

  await completion.getByRole("button", { name: "Vrátit", exact: true }).click();

  await expect(completion).toContainText("Vrácení by se překrývalo s jiným blokem");
  await expect(completion).toBeVisible();

  await expect.poll(() => page.evaluate(({ date }) => {
    const tasks = JSON.parse(window.localStorage.getItem("dayframe-v1") || "{}").plans[date];
    const task = tasks.find((item) => item.id === "undo-conflict-test");
    const blocker = tasks.find((item) => item.id === "occupy-freed-time");
    return task && blocker ? {
      completed: task.completed,
      end: task.end,
      blockerStart: blocker.start,
    } : null;
  }, seeded)).toEqual({
    completed: true,
    end: shortenedEnd,
    blockerStart: shortenedEnd,
  });
});
