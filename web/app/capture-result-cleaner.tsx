"use client";

import { useEffect } from "react";
import { parseSmartTaskInput } from "@/lib/dayframe-smart-input";

/** Keeps internal scheduling tokens and smart-input hints out of user-facing capture confirmations. */
export function CaptureResultCleaner() {
  useEffect(() => {
    const clean = () => {
      document.querySelectorAll<HTMLElement>(".capture-result h2").forEach((heading) => {
        const raw = heading.textContent?.trim();
        if (!raw) return;
        const title = parseSmartTaskInput(raw).title;
        if (title && title !== raw) heading.textContent = title;
      });
    };

    clean();
    const observer = new MutationObserver(clean);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, []);

  return null;
}
