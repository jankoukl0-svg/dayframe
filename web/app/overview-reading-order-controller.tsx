"use client";

import { useEffect } from "react";

export function OverviewReadingOrderController() {
  useEffect(() => {
    const sync = () => {
      const view = document.querySelector<HTMLElement>(".df2-history-view");
      const bottomGrid = view?.querySelector<HTMLElement>(".df2-overview-bottom-grid") ?? null;
      const readingHost = view?.querySelector<HTMLElement>("[data-reading-overview-host]") ?? null;
      if (!bottomGrid || !readingHost) return;
      if (readingHost.previousElementSibling === bottomGrid) return;
      bottomGrid.insertAdjacentElement("afterend", readingHost);
    };

    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    const timer = window.setInterval(sync, 400);
    return () => {
      observer.disconnect();
      window.clearInterval(timer);
    };
  }, []);

  return null;
}
