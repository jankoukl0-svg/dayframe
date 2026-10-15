"use client";

import { useCallback, useEffect, useState } from "react";
import { HYGIENE_STORAGE_KEY, HYGIENE_SYNC_EVENT, loadHygieneStore, type HygieneStore } from "@/lib/dayframe-hygiene";
import { readWeekCareTimes, saveWeekCareTime, WEEK_CARE_STORAGE_KEY, WEEK_CARE_SYNC_EVENT, type SundayCareId, type WeekCareTimes } from "@/lib/dayframe-week-care";

/** Reuses Hygiene's authoritative records; stores only movable calendar positions separately. */
export function useWeekCare(planningKey: string) {
  const [store, setStore] = useState<HygieneStore | null>(null);
  const [times, setTimes] = useState<WeekCareTimes>({});
  const [hydrated, setHydrated] = useState(false);
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    const sync = () => {
      const hygiene = loadHygieneStore(planningKey);
      const placement = readWeekCareTimes();
      setStore(hygiene.blocked ? null : hygiene.store);
      setTimes(placement.times);
      setBlocked(hygiene.blocked || placement.blocked);
      setHydrated(true);
    };
    sync();
    const onStorage = (event: StorageEvent) => {
      if (!event.key || event.key === HYGIENE_STORAGE_KEY || event.key === WEEK_CARE_STORAGE_KEY) sync();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener(HYGIENE_SYNC_EVENT, sync);
    window.addEventListener(WEEK_CARE_SYNC_EVENT, sync);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(HYGIENE_SYNC_EVENT, sync);
      window.removeEventListener(WEEK_CARE_SYNC_EVENT, sync);
    };
  }, [planningKey]);

  const move = useCallback((date: string, id: SundayCareId, start: string) => {
    if (blocked) return false;
    return saveWeekCareTime(date, id, start);
  }, [blocked]);

  return { store, times, hydrated, blocked, move };
}
