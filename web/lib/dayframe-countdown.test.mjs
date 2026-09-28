import test from "node:test";
import assert from "node:assert/strict";
import { daysUntilDate, getDayCountdown } from "./dayframe-countdown.ts";

test("counts the Today timer down to midnight", () => {
  const now = new Date(2026, 8, 17, 20, 0, 0);
  const countdown = getDayCountdown(now);
  assert.equal(countdown.hours, 4);
  assert.equal(countdown.minutes, 0);
  assert.equal(countdown.seconds, 0);
  assert.equal(countdown.end.getDate(), 18);
  assert.equal(countdown.end.getHours(), 0);
  assert.equal(countdown.end.getMinutes(), 0);
  assert.equal(countdown.progressPercent, 75);
});

test("keeps the Today timer at zero between midnight and the 02:00 planning boundary", () => {
  const now = new Date(2026, 8, 18, 1, 15, 0);
  const countdown = getDayCountdown(now);
  assert.equal(countdown.hours, 0);
  assert.equal(countdown.minutes, 0);
  assert.equal(countdown.seconds, 0);
  assert.equal(countdown.progressPercent, 100);
  assert.equal(countdown.end.getDate(), 18);
  assert.equal(countdown.end.getHours(), 0);
});

test("starts a fresh midnight countdown when the new planning day begins at 02:00", () => {
  const now = new Date(2026, 8, 18, 2, 1, 0);
  const countdown = getDayCountdown(now);
  assert.equal(countdown.hours, 21);
  assert.equal(countdown.minutes, 59);
  assert.equal(countdown.end.getDate(), 19);
  assert.equal(countdown.end.getHours(), 0);
  assert.equal(countdown.end.getMinutes(), 0);
});

test("counts calendar days to milestones without DST drift", () => {
  const now = new Date(2026, 9, 24, 22, 0, 0);
  assert.equal(daysUntilDate("2026-10-24", now), 0);
  assert.equal(daysUntilDate("2026-10-25", now), 1);
  assert.equal(daysUntilDate("2026-10-26", now), 2);
});
