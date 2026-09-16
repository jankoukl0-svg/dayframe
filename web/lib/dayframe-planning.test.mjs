import test from "node:test";
import assert from "node:assert/strict";
import { planCapturedTasks, localDateKey } from "./dayframe-planning.ts";

const now = (clock = "10:00") => new Date(`2026-09-16T${clock}:00`);
const capture = (id, extra = {}) => ({ id, title: `Úkol ${id}`, duration: 45, priority: "normal", category: "Studium", createdAt: "2026-09-16T09:00:00Z", ...extra });
const block = (id, start, end, extra = {}) => ({ id, title: `Blok ${id}`, start, end, category: "Studium", completed: false, ...extra });

test("adds a title to today's next gap without moving existing work", () => {
  const original = [block(1, "10:00", "11:00", { fixed: true }), block(2, "11:00", "12:00")];
  const result = planCapturedTasks(original, [], [capture(3)], now());
  assert.deepEqual(result.today.filter(t => t.id < 3), original);
  assert.deepEqual(result.placements[0], { id: 3, title: "Úkol 3", day: "today", start: "12:00", end: "12:45" });
  assert.equal(original.length, 2);
});

test("protects breakfast and lunch", () => {
  assert.equal(planCapturedTasks([], [], [capture(1)], now("09:00")).placements[0].start, "10:00");
  assert.equal(planCapturedTasks([], [], [capture(1)], now("12:45")).placements[0].start, "14:00");
});

test("uses tomorrow when today has no capacity", () => {
  const result = planCapturedTasks([], [block(2, "10:00", "11:00")], [capture(1)], now("22:00"));
  assert.equal(result.placements[0].day, "tomorrow");
  assert.equal(result.placements[0].start, "11:00");
});

test("keeps an impossible task pending instead of overlapping or dropping it", () => {
  const occupied = [block(2, "10:00", "22:30")];
  const item = capture(1);
  const result = planCapturedTasks(occupied, occupied, [item], now());
  assert.deepEqual(result.pending, [item]);
  assert.equal(result.placements.length, 0);
  assert.deepEqual(result.today, occupied);
  const retried = planCapturedTasks(result.today, [], result.pending, now());
  assert.equal(retried.pending.length, 0);
  assert.equal(retried.placements[0].day, "tomorrow");
});

test("honors an explicit day and its deadline", () => {
  const today = capture(1, { targetDate: "2026-09-16", deadline: "11:00" });
  assert.deepEqual(planCapturedTasks([], [], [today], now("11:00")).pending, [today]);
  const tomorrow = capture(2, { targetDate: "2026-09-17" });
  assert.equal(planCapturedTasks([], [], [tomorrow], now()).placements[0].day, "tomorrow");
});

test("does not carry a stale task forward until the user chooses a day", () => {
  const stale = capture(1, { createdAt: "2026-09-15T09:00:00Z" });
  const untouched = planCapturedTasks([], [], [stale], now());
  assert.deepEqual(untouched.pending, [stale]);
  assert.equal(untouched.placements.length, 0);

  const chosenTomorrow = { ...stale, targetDate: "2026-09-17" };
  const moved = planCapturedTasks([], [], [chosenTomorrow], now());
  assert.equal(moved.pending.length, 0);
  assert.equal(moved.placements[0].day, "tomorrow");
});

test("understands optional scheduling hints in the title", () => {
  const smart = capture(10, { title: "Matematika zítra 60 min do 18:00 důležité" });
  const result = planCapturedTasks([], [], [smart], now());
  const placed = result.tomorrow.find(task => task.id === 10);
  assert.equal(result.placements[0].day, "tomorrow");
  assert.equal(result.placements[0].title, "Matematika");
  assert.equal(placed.duration, 60);
  assert.equal(placed.deadline, "18:00");
  assert.equal(placed.priority, "high");
});

test("manual controls override smart hints field by field", () => {
  const manual = capture(11, {
    title: "Ekonomie zítra 60 min do 18:00 důležité",
    duration: 30,
    targetDate: "2026-09-16",
    deadline: "17:00",
    priority: "low",
  });
  const result = planCapturedTasks([], [], [manual], now());
  const placed = result.today.find(task => task.id === 11);
  assert.equal(result.placements[0].day, "today");
  assert.equal(placed.duration, 30);
  assert.equal(placed.deadline, "17:00");
  assert.equal(placed.priority, "low");
});

test("migrates old captures, uses priority, and never duplicates placed IDs", () => {
  const result = planCapturedTasks([], [], [capture(1), capture(2, { priority: "high" }), capture(2)], now());
  assert.equal(result.placements[0].id, 2);
  assert.equal(result.today.length, 2);
  assert.equal(result.pending.length, 0);
});

test("expired dates and invalid durations are retained for correction", () => {
  const waiting = [capture(1, { targetDate: "2026-09-15" }), capture(2, { duration: Number.NaN })];
  assert.equal(planCapturedTasks([], [], waiting, now()).pending.length, 2);
});

test("tomorrow selection works across month and year boundaries", () => {
  const late = new Date(2026, 11, 31, 23, 0);
  assert.equal(localDateKey(late), "2026-12-31");
  assert.equal(planCapturedTasks([], [], [capture(1, { targetDate: "2027-01-01" })], late).placements[0].day, "tomorrow");
});
