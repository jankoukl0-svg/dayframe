"use client";

import { useEffect } from "react";

const AUTO_PAUSE_ATTRIBUTE = "focusManualAutoPause";
const START_ATTRIBUTE = "focusManualStart";

export function FocusManualStartController() {
  useEffect(() => {
    let currentControls: HTMLElement | null = null;
    let hasStarted = false;

    const sync = () => {
      const controls = document.querySelector<HTMLElement>(".df2-time-adjust-focus-controls");
      if (!controls) {
        currentControls = null;
        hasStarted = false;
        return;
      }

      if (controls !== currentControls) {
        currentControls = controls;
        hasStarted = false;
      }

      const button = controls.querySelector<HTMLButtonElement>(".df2-time-pause");
      if (!button || hasStarted) return;

      const text = button.textContent?.trim() ?? "";
      if (text === "Pauza") {
        button.dataset[AUTO_PAUSE_ATTRIBUTE] = "true";
        button.click();
        window.setTimeout(() => {
          delete button.dataset[AUTO_PAUSE_ATTRIBUTE];
          sync();
        }, 0);
        return;
      }

      if (text === "Pokračovat") {
        button.textContent = "Start";
        button.dataset[START_ATTRIBUTE] = "true";
      }
    };

    const onClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const button = target.closest(".df2-time-adjust-focus-controls .df2-time-pause");
      if (!(button instanceof HTMLButtonElement)) return;
      if (button.dataset[AUTO_PAUSE_ATTRIBUTE] === "true") return;
      if (button.textContent?.trim() === "Start") {
        hasStarted = true;
        delete button.dataset[START_ATTRIBUTE];
      }
    };

    document.addEventListener("click", onClick, true);
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    const timer = window.setInterval(sync, 120);
    sync();

    return () => {
      document.removeEventListener("click", onClick, true);
      observer.disconnect();
      window.clearInterval(timer);
    };
  }, []);

  return null;
}
