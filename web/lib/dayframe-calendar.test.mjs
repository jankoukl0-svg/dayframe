import test from "node:test";
import assert from "node:assert/strict";
import {
  addTask,
  findSlot,
  getTasksForDate,
  localDateKey,
  materializeRange,
  migrateStoredState,
  moveTask,
  replanWeek,
} from "./dayframe-calendar.ts";

const now = new Date("2026-09-17T10:00:00");

test("migrates schema 4 today, tomorrow and future waiting tasks without leaking tokens", () => {
  const old = {
    schema: 4,
    date: "2026-09-17",
    tasks: [{ id: 1001, title: "Matika [[start:17:00]]", start: "17:00", end: "18:00", category: "Matika", completed: false, fixed: true }],
    tomorrowDate: "2026-09-18",
    tomorrowTasks: [],
    inboxTasks: [{ id: 2001, title: "Zeměpis [[date:2026-09-19]]", duration: 20, priority: "normal", category: "Studium", createdAt: "2026-09-17T09:00:00Z", targetDate: "2026-09-19" }],
  };
  const state = migrateStoredState(old, now);
  assert.equal(state.schema, 5);
  assert.equal(state.plans["2026-09-17"][0].title, "Matika");
  assert.equal(state.plans["2026-09-17"][0].mode, "flexible");
  assert.equal(state.plans["2026-09-17"][0].requestedStart, "17:00");
  assert.equal(state.plans["2026-09-19"][0].title, "Zeměpis");
});

test("schema 5 lock state is normalized away without losing the chosen time", () => {
  const state = migrateStoredState({
    schema: 5,
    plans: {
      "2026-09-18": [{
        id: "old-fixed",
        title: "Matika",
        date: "2026-09-18",
        duration: 60,
        start: "16:00",
        end: "17:00",
        priority: "normal",
        category: "Matika",
        mode: "fixed",
        completed: false,
        source: "user",
        dateLocked: true,
        autoScheduled: false,
        createdAt: now.toISOString(),
      }],
    },
    backlog: [],
    routines: [],
    routineSkips: [],
    milestones: [],
    dismissedOverdueKeys: [],
  }, now);
  const task = state.plans["2026-09-18"][0];
  assert.equal(task.mode, "flexible");
  assert.equal(task.requestedStart, "16:00");
  assert.equal(task.autoScheduled, false);
});

test("materializes recurring routines as real dated blocks", () => {
  const state = migrateStoredState(null, now);
  const ready = materializeRange(state, "2026-09-17", "2026-09-20", now);
  const sunday = getTasksForDate(ready, "2026-09-20");
  assert.ok(sunday.some((task) => task.title === "Čtení knihy" && task.start === "22:40"));
  assert.ok(sunday.some((task) => task.title === "Naplánovat další týden" && task.start === "14:00"));
  assert.ok(sunday.every((task) => task.mode === "flexible"));
});

test("auto planner scans the whole week when no day is chosen", () => {
  let state = migrateStoredState(null, now);
  state.routines = [];
  state.plans = {
    "2026-09-17": [{ id: "busy", title: "Busy", date: "2026-09-17", duration: 750, start: "10:00", end: "22:30", priority: "normal", category: "X", mode: "flexible", completed: false, source: "user", dateLocked: true, createdAt: now.toISOString() }],
  };
  const result = addTask(state, { title: "Deep work", duration: 60, priority: "high", category: "Studium", repeat: "none" }, now);
  assert.equal(result.status, "scheduled");
  assert.equal(result.task.date, "2026-09-18");
});

test("automatic scheduling still avoids the lunch preference", () => {
  const occupied = [{
    id: "morning",
    title: "Morning",
    date: "2026-09-18",
    duration: 180,
    start: "10:00",
    end: "13:00",
    priority: "normal",
    category: "X",
    mode: "flexible",
    completed: false,
    source: "user",
    dateLocked: true,
    createdAt: now.toISOString(),
  }];
  const slot = findSlot(occupied, "2026-09-18", 60, now);
  assert.deepEqual(slot, { start: "14:00", end: "15:00" });
});

test("manual drag may place a task inside the lunch hour", () => {
  let state = migrateStoredState(null, now);
  state.routines = [];
  const added = addTask(state, { title: "Obědový call", date: "2026-09-18", duration: 30, priority: "normal", category: "Osobní", repeat: "none" }, now);
  const moved = moveTask(added.state, added.task.id, "2026-09-18", "13:15", now);
  assert.equal(moved.error, undefined);
  assert.equal(moved.task.start, "13:15");
  assert.equal(moved.task.end, "13:45");
  assert.equal(moved.task.mode, "flexible");
  assert.equal(moved.task.requestedStart, "13:15");
  assert.equal(moved.task.autoScheduled, false);
});

test("a task explicitly assigned to a day stays on that day", () => {
  const state = migrateStoredState(null, now);
  const result = addTask(state, { title: "Zeměpis", date: "2026-09-19", duration: 20, priority: "normal", category: "Studium", repeat: "none" }, now);
  assert.equal(result.task.date, "2026-09-19");
  assert.equal(result.task.dateLocked, true);
});

test("dragging a task keeps the chosen time without creating a lock mode", () => {
  let state = migrateStoredState(null, now);
  state.routines = [];
  const added = addTask(state, { title: "Matika", date: "2026-09-18", duration: 60, priority: "normal", category: "Matika", repeat: "none" }, now);
  const moved = moveTask(added.state, added.task.id, "2026-09-19", "16:00", now);
  assert.equal(moved.error, undefined);
  assert.equal(moved.task.date, "2026-09-19");
  assert.equal(moved.task.start, "16:00");
  assert.equal(moved.task.mode, "flexible");
  assert.equal(moved.task.requestedStart, "16:00");
  assert.equal(moved.task.autoScheduled, false);
});

test("explicit weekly replan keeps manually chosen dates and times in place", () => {
  let state = migrateStoredState(null, now);
  state.routines = [];
  const added = addTask(state, { title: "Manual", date: "2026-09-19", duration: 30, priority: "normal", category: "Studium", repeat: "none" }, now);
  const before = added.task.start;
  const replanned = replanWeek(added.state, now, now);
  const after = replanned.plans["2026-09-19"].find((task) => task.id === added.task.id);
  assert.equal(after.start, before);
  assert.equal(localDateKey(now), "2026-09-17");
});