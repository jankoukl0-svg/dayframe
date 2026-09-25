"use client";

import { useEffect } from "react";

const STATE_SYNC_EVENT = "dayframe-state-sync";

export function FocusWeekSyncController() {
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target.closest<HTMLButtonElement>("button") : null;
      if (!target || !target.closest(".df2-time-adjust-focus-controls")) return;
      if (target.textContent?.trim() !== "+15 min") return;

      window.setTimeout(() => {
        window.dispatchEvent(new Event(STATE_SYNC_EVENT));
      }, 0);
    };

    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  return null;
}
