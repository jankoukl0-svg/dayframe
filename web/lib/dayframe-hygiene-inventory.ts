import { addDaysKey, dateFromKey } from "@/lib/dayframe-calendar";
import type { HygieneProduct } from "@/lib/dayframe-hygiene";

const isDateKey = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);

export type HygieneShoppingItem = {
  product: HygieneProduct;
  needed: number;
  source: "manual" | "threshold" | "both";
};

export type HygieneInventoryAlert = {
  product: HygieneProduct;
  kind: "expiry" | "replacement";
  dueOn: string;
  daysLeft: number;
  state: "overdue" | "soon";
  detail: string;
};

function daysBetween(from: string, to: string): number {
  const first = dateFromKey(from);
  const second = dateFromKey(to);
  return Math.round((Date.UTC(second.getFullYear(), second.getMonth(), second.getDate())
    - Date.UTC(first.getFullYear(), first.getMonth(), first.getDate())) / 86400000);
}

export function addCalendarMonthsClamped(dateKey: string, months: number): string | null {
  if (!isDateKey(dateKey) || !Number.isInteger(months) || months < 1 || months > 60) return null;
  const day = dateFromKey(dateKey);
  if (Number.isNaN(day.getTime())) return null;
  const result = new Date(day.getFullYear(), day.getMonth() + months, 1, 12);
  const last = new Date(result.getFullYear(), result.getMonth() + 1, 0, 12).getDate();
  result.setDate(Math.min(day.getDate(), last));
  return [result.getFullYear(), String(result.getMonth() + 1).padStart(2, "0"), String(result.getDate()).padStart(2, "0")].join("-");
}

export function effectiveExpiry(product: HygieneProduct): { date: string; reason: string } | null {
  const labelDate = isDateKey(product.expiresOn) ? product.expiresOn : null;
  const openedDate = product.paoMonths && product.openedOn
    ? addCalendarMonthsClamped(product.openedOn, product.paoMonths) : null;
  if (labelDate && openedDate) return labelDate <= openedDate
    ? { date: labelDate, reason: "Datum spotřeby" }
    : { date: openedDate, reason: "Po otevření (PAO)" };
  if (labelDate) return { date: labelDate, reason: "Datum spotřeby" };
  if (openedDate) return { date: openedDate, reason: "Po otevření (PAO)" };
  return null;
}

/** Derived, no auto-decay: only counts entered by the user are tracked. */
export function hygieneShoppingList(products: HygieneProduct[]): HygieneShoppingItem[] {
  return products
    .filter((product) => !product.archived)
    .flatMap((product) => {
      const threshold = product.stockMinimum !== undefined && product.stockMinimum !== null
        && product.stockCount !== undefined && product.stockCount !== null
        && product.stockCount <= product.stockMinimum;
      const manual = product.stockStatus === "low";
      if (!threshold && !manual) return [];
      const needed = threshold ? Math.max(1, (product.stockMinimum ?? 0) + 1 - (product.stockCount ?? 0)) : 1;
      return [{ product, needed, source: threshold && manual ? "both" as const : threshold
        ? "threshold" as const : "manual" as const }];
    })
    .sort((a, b) => a.product.name.localeCompare(b.product.name, "cs"));
}

export function hygieneInventoryAlerts(products: HygieneProduct[], today: string): HygieneInventoryAlert[] {
  const alerts: HygieneInventoryAlert[] = [];
  for (const product of products) {
    if (product.archived) continue;
    const expiry = effectiveExpiry(product);
    if (expiry) {
      const daysLeft = daysBetween(today, expiry.date);
      if (daysLeft <= 30) alerts.push({
        product, kind: "expiry", dueOn: expiry.date, daysLeft,
        state: daysLeft < 0 ? "overdue" : "soon", detail: expiry.reason,
      });
    }
    if (product.replacementEveryDays && isDateKey(product.lastReplacedOn ?? "")) {
      const dueOn = addDaysKey(product.lastReplacedOn!, product.replacementEveryDays);
      const daysLeft = daysBetween(today, dueOn);
      if (daysLeft <= 14) alerts.push({
        product, kind: "replacement", dueOn, daysLeft,
        state: daysLeft < 0 ? "overdue" : "soon", detail: "Výměna hygienické pomůcky",
      });
    }
  }
  return alerts.sort((a, b) => a.dueOn.localeCompare(b.dueOn)
    || a.product.name.localeCompare(b.product.name, "cs"));
}

export function recordHygienePurchase(product: HygieneProduct, packages: number): HygieneProduct {
  if (!Number.isInteger(packages) || packages < 1 || packages > 10000) return product;
  return {
    ...product,
    stockStatus: "ok",
    stockCount: product.stockCount == null ? null : Math.min(10000, product.stockCount + packages),
  };
}

export function hygieneShoppingCost(items: HygieneShoppingItem[]): { known: number; missing: number } {
  return items.reduce((total, item) => {
    if (item.product.priceCzk == null) return { ...total, missing: total.missing + 1 };
    return { ...total, known: total.known + item.product.priceCzk * item.needed };
  }, { known: 0, missing: 0 });
}
