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
