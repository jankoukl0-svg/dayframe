"use client";

import { useEffect, useRef } from "react";

type PeriodMode = "week" | "month" | "year";

function atNoon(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12);
}

function startOfWeek(date: Date) {
  const next = atNoon(date);
  next.setDate(next.getDate() - ((next.getDay() + 6) % 7));
  return next;
}

function periodKey(mode: PeriodMode, date: Date) {
  if (mode === "year") return String(date.getFullYear());
  if (mode === "month") return `${date.getFullYear()}-${date.getMonth()}`;
  return startOfWeek(date).toISOString().slice(0, 10);
}

export function HistoryPeriodRolloverController() {
  const lastNow = useRef(new Date());
  const lastMode = useRef<PeriodMode>("week");
  const wasCurrent = useRef<Record<PeriodMode, boolean>>({ week: true, month: true, year: true });
  const advancePending = useRef(false);

  useEffect(() => {
    const sync = () => {
      const currentNow = new Date();
      const view = document.querySelector<HTMLElement>(".df2-history-view");
      const visibleMode = view?.dataset.historyMode as PeriodMode | undefined;
      const mode = visibleMode ?? lastMode.current;

      if (periodKey(lastMode.current, lastNow.current) !== periodKey(lastMode.current, currentNow)
        && wasCurrent.current[lastMode.current]) {
        advancePending.current = true;
      }

      lastNow.current = currentNow;
      lastMode.current = mode;

      if (!view) return;

      const todayButton = view.querySelector<HTMLButtonElement>(".df2-history-today");
      if (advancePending.current && todayButton) {
        todayButton.click();
        advancePending.current = false;
        wasCurrent.current[mode] = true;
        return;
      }

      wasCurrent.current[mode] = !todayButton;
    };

    sync();
    const timer = window.setInterval(sync, 500);
    return () => window.clearInterval(timer);
  }, []);

  return null;
}
