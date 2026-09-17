import test from "node:test";
import assert from "node:assert/strict";
import { daysUntilDate, getDayCountdown } from "./dayframe-countdown.ts";

test("counts down to the 00:30 Dayframe day boundary", () => {
  const now = new Date(2026, 8, 17, 20, 0, 0);
  const countdown = getDayCountdown(now);
  assert.equal(countdown.hours, 4);
  assert.equal(countdown.minutes, 30);
  assert.equal(countdown.seconds, 0);
  assert.equal(countdown.end.getDate(), 18);
  assert.equal(countdown.end.getHours(), 0);
  assert.equal(countdown.end.getMinutes(), 30);
});

test("resets the day countdown after 00:30", () => {
  const now = new Date(2026, 8, 18, 0, 31, 0);
  const countdown = getDayCountdown(now);
  assert.equal(countdown.end.getDate(), 19);
  assert.equal(countdown.end.getHours(), 0);
  assert.equal(countdown.end.getMinutes(), 30);
});

test("counts calendar days to milestones without DST drift", () => {
  const now = new Date(2026, 9, 24, 22, 0, 0);
  assert.equal(daysUntilDate("2026-10-24", now), 0);
  assert.equal(daysUntilDate("2026-10-25", now), 1);
  assert.equal(daysUntilDate("2026-10-26", now), 2);
});
