import test from "node:test";
import assert from "node:assert/strict";
import { addTask, createEmptyState, materializeRange, replanWeek, deleteRoutine, setRoutineActive, updateTask, moveTaskToTomorrow, migrateStoredState, canPlaceAt } from "./dayframe-calendar.ts";
import { loadDayframe, saveDayframe, STORAGE_KEY, MIGRATION_BACKUP_KEY } from "./dayframe-storage.ts";
import { remainingFocusSeconds } from "./dayframe-countdown.ts";

const now = new Date("2026-09-17T09:00:00");
const blank = () => ({ ...createEmptyState(), routines: [] });
const draft = { title: "Studium", duration: 60, category: "Studium", priority: "normal" };

test("retry planning actually places backlog and never duplicates it", () => {
  let state = blank();
  const added = addTask(state, { ...draft, duration: 800 }, now);
  state = { ...added.state, backlog: added.state.backlog.map((task) => ({ ...task, duration: 60 })) };
  const planned = replanWeek(state, now, now);
  assert.equal(planned.backlog.length, 0);
  assert.equal(Object.values(planned.plans).flat().filter((task) => task.id === added.task.id).length, 1);
  assert.equal(replanWeek(planned, now, now).backlog.length, 0);
});

test("replanning preserves missed work and a block already in progress", () => {
  let state = addTask(blank(), draft, now).state;
  state = addTask(state, { ...draft, title: "Další" }, now).state;
  const before = state.plans["2026-09-17"];
  const result = replanWeek(state, now, new Date("2026-09-17T11:30:00"));
  assert.deepEqual(result.plans["2026-09-17"], before);
});

test("routine activation and deletion preserve completed and historical progress", () => {
  let state = materializeRange(createEmptyState(), "2026-09-17", "2026-09-19", now);
  state.plans["2026-09-17"] = state.plans["2026-09-17"].map((task) => task.routineId === "read" ? { ...task, completed: true } : task);
  const off = setRoutineActive(state, "read", false, now);
  assert.equal(off.plans["2026-09-17"].find((task) => task.routineId === "read").completed, true);
  assert.ok(!off.plans["2026-09-18"].some((task) => task.routineId === "read"));
  const on = setRoutineActive(off, "read", true, now);
  assert.equal(on.plans["2026-09-18"].filter((task) => task.routineId === "read").length, 1);
  const removed = deleteRoutine(on, "read", now);
  assert.equal(removed.plans["2026-09-17"].find((task) => task.routineId === "read").completed, true);
});

test("moving a routine in the editor keeps its exception across reloads", () => {
  const state = materializeRange(createEmptyState(), "2026-09-17", "2026-09-19", now);
  const task = state.plans["2026-09-17"].find((task) => task.routineId === "thu-math");
  const result = updateTask(state, task.id, { date: "2026-09-18", start: "17:00" }, now);
  assert.equal(result.error, undefined);
  const reopened = materializeRange(migrateStoredState(JSON.parse(JSON.stringify(result.state)), now), "2026-09-17", "2026-09-19", now);
  assert.ok(!reopened.plans["2026-09-17"].some((item) => item.id === task.id));
  assert.equal(reopened.plans["2026-09-18"].filter((item) => item.id === task.id).length, 1);
});

test("editing the existing late reading block does not reject its own time", () => {
  const state = materializeRange(createEmptyState(), "2026-09-17", "2026-09-17", now);
  const task = state.plans["2026-09-17"].find((task) => task.routineId === "read");
  const result = updateTask(state, task.id, { title: "Čtení 20 stran" }, now);
  assert.equal(result.error, undefined);
  assert.equal(result.task.start, "22:40");
});

test("a new routine starts on the selected day and can be disabled immediately", () => {
  const added = addTask(blank(), { ...draft, date: "2026-09-19", start: "17:00", repeat: "daily" }, now);
  const state = materializeRange(added.state, "2026-09-17", "2026-09-20", now);
  assert.equal(state.plans["2026-09-18"].length, 0);
  assert.equal(state.plans["2026-09-19"].length, 1);
  const off = setRoutineActive(state, state.routines[0].id, false, now);
  assert.equal(off.plans["2026-09-19"].length, 0);
});

test("conflicting routines stay visible without overlapping an existing task", () => {
  let state = addTask(blank(), { ...draft, date: "2026-09-19", start: "17:00" }, now).state;
  state = addTask(state, { ...draft, title: "Rutina", date: "2026-09-18", start: "17:00", repeat: "daily" }, now).state;
  const ready = materializeRange(state, "2026-09-19", "2026-09-19", now);
  assert.equal(ready.plans["2026-09-19"].filter((task) => task.start === "17:00").length, 1);
  assert.ok(ready.plans["2026-09-19"].some((task) => task.title === "Rutina" && !task.start));
});

test("tomorrow deferral updates the old routine deadline", () => {
  const state = materializeRange(createEmptyState(), "2026-09-17", "2026-09-18", now);
  const task = state.plans["2026-09-17"].find((task) => task.routineId === "thu-econ");
  const moved = moveTaskToTomorrow(state, task.id, now);
  const tomorrow = moved.plans["2026-09-18"].find((item) => item.title === task.title && item.source === "user");
  assert.equal(tomorrow.dueDate, "2026-09-18");
  assert.ok(tomorrow.start);
});

test("an explicitly empty migrated day stays empty", () => {
  const migrated = migrateStoredState({ schema: 4, date: "2026-09-17", tasks: [], tomorrowDate: "2026-09-18", tomorrowTasks: [] }, now);
  const ready = materializeRange(migrated, "2026-09-17", "2026-09-18", now);
  assert.deepEqual(ready.plans["2026-09-17"], []);
  assert.deepEqual(ready.plans["2026-09-18"], []);
});

test("past days are not fabricated and expired deadlines retain the task", () => {
  const ready = materializeRange(createEmptyState(), "2026-09-10", "2026-09-17", now);
  assert.equal(ready.plans["2026-09-10"], undefined);
  const result = addTask(blank(), { ...draft, dueDate: "2026-09-16" }, now);
  assert.equal(result.status, "waiting");
  assert.equal(result.state.backlog[0].date, "2026-09-17");
  assert.equal(canPlaceAt([], NaN, 45), false);
});

test("backlog tasks can be edited and scheduled without losing their IDs", () => {
  const added = addTask(blank(), { ...draft, duration: 800 }, now);
  const edited = updateTask(added.state, added.task.id, { date: "2026-09-18", duration: 30 }, now);
  assert.equal(edited.error, undefined);
  assert.equal(edited.state.backlog.length, 0);
  assert.ok(edited.state.plans["2026-09-18"].find((task) => task.id === added.task.id)?.start);
});

const storage = (initial) => {
  const items = new Map([[STORAGE_KEY, initial]]);
  return { getItem: (key) => items.get(key) ?? null, setItem: (key, value) => items.set(key, value) };
};
test("migration backs up exact saved data before writing schema 5", () => {
  const original = JSON.stringify({ schema: 4, date: "2026-09-17", tasks: [{ id: 1, title: "Hotovo", completed: true }], milestones: [] });
  const store = storage(original);
  const state = loadDayframe(store, now);
  saveDayframe(store, state);
  assert.equal(store.getItem(MIGRATION_BACKUP_KEY), original);
  assert.equal(loadDayframe(store, now).plans["2026-09-17"][0].completed, true);
  assert.deepEqual(loadDayframe(store, now).milestones, []);
});
test("unreadable or newer saved data never gets reset or overwritten", () => {
  for (const original of ['{broken', '{"schema":6,"plans":{}}', '{"schema":5,"plans":{"2026-09-17":null}}']) {
    const store = storage(original);
    assert.throws(() => loadDayframe(store, now));
    assert.equal(store.getItem(STORAGE_KEY), original);
  }
});
test("focus counts elapsed wall time even after a background pause", () => {
  assert.equal(remainingFocusSeconds(300_000, 180_000), 120);
  assert.equal(remainingFocusSeconds(300_000, 600_000), 0);
});
