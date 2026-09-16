"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const MANUAL_START_TOKEN = /\s*\[\[start:\d{1,2}:\d{2}\]\]\s*/gi;

function setNativeInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

export function CaptureStartControl() {
  const [target, setTarget] = useState<Element | null>(null);
  const [start, setStart] = useState("");
  const bypassNextSubmit = useRef(false);

  useEffect(() => {
    const refresh = () => setTarget(document.querySelector(".quick-capture .capture-option-fields"));
    refresh();
    const observer = new MutationObserver(refresh);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const form = document.querySelector<HTMLFormElement>(".quick-capture");
    if (!form) return;

    const handleSubmit = (event: Event) => {
      if (bypassNextSubmit.current || !start) return;
      const input = form.querySelector<HTMLInputElement>("#capture-task-name");
      if (!input) return;

      event.preventDefault();
      event.stopImmediatePropagation();

      const cleanTitle = input.value.replace(MANUAL_START_TOKEN, " ").replace(/\s{2,}/g, " ").trim();
      setNativeInputValue(input, `${cleanTitle} [[start:${start}]]`);
      bypassNextSubmit.current = true;

      window.setTimeout(() => {
        form.requestSubmit();
        window.setTimeout(() => {
          bypassNextSubmit.current = false;
          setStart("");
        }, 0);
      }, 0);
    };

    form.addEventListener("submit", handleSubmit, true);
    return () => form.removeEventListener("submit", handleSubmit, true);
  }, [start, target]);

  if (!target) return null;

  return createPortal(
    <div className="capture-manual-start">
      <label htmlFor="capture-task-start">Začít v <span>volitelné</span></label>
      <input
        id="capture-task-start"
        type="time"
        value={start}
        onChange={(event) => setStart(event.target.value)}
        aria-describedby="capture-task-start-help"
      />
      <small id="capture-task-start-help">Prázdné = Dayframe najde volné místo sám.</small>
    </div>,
    target,
  );
}
