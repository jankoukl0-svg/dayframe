import test from "node:test";
import assert from "node:assert/strict";
import { parseSmartTaskInput } from "./dayframe-smart-input.ts";

test("parses exact start and duration written naturally", () => {
  assert.deepEqual(parseSmartTaskInput("Matematika v 17:30 na 60 minut"), {
    title: "Matematika",
    duration: 60,
    day: undefined,
    targetDate: undefined,
    start: "17:30",
    deadline: undefined,
    priority: undefined,
  });
});

test("parses a bare HH:MM start without requiring wording", () => {
  const parsed = parseSmartTaskInput("Matika 17:30 45 min");
  assert.equal(parsed.title, "Matika");
  assert.equal(parsed.start, "17:30");
  assert.equal(parsed.duration, 45);
});

test("parses the exact user phrasing with duration before start", () => {
  const parsed = parseSmartTaskInput("matika 40 min od 17:00");
  assert.equal(parsed.title, "matika");
  assert.equal(parsed.start, "17:00");
  assert.equal(parsed.duration, 40);
});

test("parses common Czech duration wording and a day", () => {
  const parsed = parseSmartTaskInput("CFI zítra od 16 na hodinu");
  assert.equal(parsed.title, "CFI");
  assert.equal(parsed.day, "tomorrow");
  assert.equal(parsed.start, "16:00");
  assert.equal(parsed.duration, 60);
});

test("parses a start-end range", () => {
  const parsed = parseSmartTaskInput("Angličtina od 18 do 19:30");
  assert.equal(parsed.title, "Angličtina");
  assert.equal(parsed.start, "18:00");
  assert.equal(parsed.duration, 90);
});

test("manual start token wins over a typed start", () => {
  const parsed = parseSmartTaskInput("Ekonomie v 17:00 [[start:15:15]]");
  assert.equal(parsed.title, "Ekonomie");
  assert.equal(parsed.start, "15:15");
});

test("calendar date token targets an exact day without leaking into the title", () => {
  const parsed = parseSmartTaskInput("Pohovor [[date:2026-09-20]] [[start:16:00]]");
  assert.equal(parsed.title, "Pohovor");
  assert.equal(parsed.targetDate, "2026-09-20");
  assert.equal(parsed.start, "16:00");
});
