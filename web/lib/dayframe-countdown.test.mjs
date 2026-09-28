import test from "node:test";
import assert from "node:assert/strict";
import { daysUntilDate, getDayCountdown } from "./dayframe-countdown.ts";

test("counts down to the 02:00 Dayframe day boundary", () => {
  const now = new Date(2026, 8, 17, 20, 0, 0);
  const countdown = getDayCountdown(now);
  assert.equal(countdown.hours, 6);
  assert.equal(countdown.minutes, 0);
  assert.equal(countdown.seconds, 0);
  assert.equal(countdown.end.getDate(), 18);
  assert.equal(countdown.end.getHours(), 2);
  assert.equal(countdown.end.getMinutes(), 0);
});

test("pins the day countdown at zero after 02:00 until the next day starts", () => {
  const afterEnd = getDayCountdown(new Date(2026, 8, 18, 2, 1, 0));
  assert.equal(afterEnd.hours, 0);
  assert.equal(afterEnd.minutes, 0);
  assert.equal(afterEnd.seconds, 0);
  assert.equal(afterEnd.progressPercent, 100);

  const beforeStart = getDayCountdown(new Date(2026, 8, 18, 7, 59, 59));
  assert.equal(beforeStart.hours, 0);
  assert.equal(beforeStart.minutes, 0);
  assert.equal(beforeStart.seconds, 0);
  assert.equal(beforeStart.progressPercent, 100);
});

test("starts a fresh 18-hour countdown again at 08:00", () => {
  const countdown = getDayCountdown(new Date(2026, 8, 18, 8, 0, 0));
  assert.equal(countdown.hours, 18);
  assert.equal(countdown.minutes, 0);
  assert.equal(countdown.seconds, 0);
  assert.equal(countdown.end.getDate(), 19);
  assert.equal(countdown.end.getHours(), 2);
});

test("counts calendar days to milestones without DST drift", () => {
  const now = new Date(2026, 9, 24, 22, 0, 0);
  assert.equal(daysUntilDate("2026-10-24", now), 0);
  assert.equal(daysUntilDate("2026-10-25", now), 1);
  assert.equal(daysUntilDate("2026-10-26", now), 2);
});
