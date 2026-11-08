import { supplementOccurrences, supplementDaypartForTime, SUPPLEMENT_DAYPARTS, type SupplementStore, type SupplementDaypart } from "./dayframe-supplements.ts";

export type HistoryDose = {
  key: string; time: string; name: string; supplementId: string;
  part: SupplementDaypart; status: "taken" | "skipped" | "unrecorded";
};
export type HistoryDay = {
  date: string; planned: number; taken: number; skipped: number; unrecorded: number;
  doses: HistoryDose[];
};
export type HistoryProduct = {
  id: string; name: string; planned: number; taken: number; skipped: number; unrecorded: number;
};
export type SupplementHistorySummary = {
  days: HistoryDay[]; products: HistoryProduct[];
  planned: number; taken: number; skipped: number; unrecorded: number;
  percentage: number | null; streak: number;
};
function shiftDay(date: string, delta: number) {
  const day = new Date(date + "T12:00:00");
  day.setDate(day.getDate() + delta);
  return [day.getFullYear(), String(day.getMonth() + 1).padStart(2, "0"), String(day.getDate()).padStart(2, "0")].join("-");
}
function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value + "T12:00:00"))
    && shiftDay(value, 0) === value;
}
export function supplementHistoryDay(store: SupplementStore, date: string): HistoryDay {
  const doses = supplementOccurrences(store, date).map(item => ({
    key: item.key, time: item.time, name: item.supplement.name,
    supplementId: item.supplement.id, part: supplementDaypartForTime(item.time),
    status: item.intake?.status ?? "unrecorded",
  }) satisfies HistoryDose);
  const taken = doses.filter(item => item.status === "taken").length;
  const skipped = doses.filter(item => item.status === "skipped").length;
  return { date, doses, planned: doses.length, taken, skipped, unrecorded: doses.length - taken - skipped };
}
/**
 * Read-only analytics over the historical schedule revisions and actual check-ins.
 * Unrecorded doses are never relabelled "skipped", including past dates.
 * Today and future are not included beyond the supplied planning day.
 */
export function supplementHistorySummary(store: SupplementStore, from: string, to: string, today: string): SupplementHistorySummary {
  const empty: SupplementHistorySummary = { days: [], products: [], planned: 0, taken: 0, skipped: 0, unrecorded: 0, percentage: null, streak: 0 };
  if (!validDate(from) || !validDate(to) || !validDate(today) || from > to || from > today) return empty;
  const until = to > today ? today : to;
  const days: HistoryDay[] = [];
  const perProduct = new Map<string, HistoryProduct>();
  for (let date = from; date <= until && days.length < 366; date = shiftDay(date, 1)) {
    const day = supplementHistoryDay(store, date);
    days.push(day);
    for (const dose of day.doses) {
      let product = perProduct.get(dose.supplementId);
      if (!product) {
        product = { id: dose.supplementId, name: dose.name, planned: 0, taken: 0, skipped: 0, unrecorded: 0 };
        perProduct.set(dose.supplementId, product);
      }
      product.planned++;
      product[dose.status]++;
    }
  }
  const planned = days.reduce((sum, day) => sum + day.planned, 0);
  const taken = days.reduce((sum, day) => sum + day.taken, 0);
  const skipped = days.reduce((sum, day) => sum + day.skipped, 0);
  const unrecorded = days.reduce((sum, day) => sum + day.unrecorded, 0);
  // Streak counts consecutive fully completed scheduled days. An unfinished
  // current day and schedule-free days do not break yesterday's streak.
  let streak = 0;
  for (let offset = 0; offset < 366; offset++) {
    const day = supplementHistoryDay(store, shiftDay(today, -offset));
    if (!day.planned) continue;
    if (offset === 0 && day.taken < day.planned) continue;
    if (day.taken !== day.planned) break;
    streak++;
  }
  return {
    days: days.reverse(),
    products: [...perProduct.values()].sort((a, b) => (a.taken / a.planned) - (b.taken / b.planned) || a.name.localeCompare(b.name, "cs")),
    planned, taken, skipped, unrecorded,
    percentage: planned ? Math.round(100 * taken / planned) : null, streak,
  };
}
export function groupHistoryDoses(doses: HistoryDose[]) {
  return SUPPLEMENT_DAYPARTS.map(part => ({
    ...part, doses: doses.filter(dose => dose.part === part.id),
  })).filter(group => group.doses.length > 0);
}
