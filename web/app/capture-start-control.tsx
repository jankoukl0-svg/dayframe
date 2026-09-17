"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const MANUAL_START_TOKEN = /\s*\[\[start:\d{1,2}:\d{2}\]\]\s*/gi;
const TARGET_DATE_TOKEN = /\s*\[\[date:\d{4}-\d{2}-\d{2}\]\]\s*/gi;

function setNativeInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function formatTargetDate(value: string) {
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("cs-CZ", { weekday: "short", day: "numeric", month: "numeric" }).format(date);
}

export function CaptureStartControl() {
  const [target, setTarget] = useState<Element | null>(null);
  const [defaultsTarget, setDefaultsTarget] = useState<Element | null>(null);
  const [start, setStart] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const bypassNextSubmit = useRef(false);

  useEffect(() => {
    const refresh = () => {
      setTarget(document.querySelector(".quick-capture .capture-option-fields"));
      setDefaultsTarget(document.querySelector(".quick-capture .capture-defaults"));
    };
    refresh();
    const observer = new MutationObserver(refresh);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const handleDate = (event: Event) => {
      const date = (event as CustomEvent<{ date?: string }>).detail?.date;
      if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) setTargetDate(date);
    };
    window.addEventListener("dayframe:capture-date", handleDate as EventListener);
    return () => window.removeEventListener("dayframe:capture-date", handleDate as EventListener);
  }, []);

  useEffect(() => {
    const form = document.querySelector<HTMLFormElement>(".quick-capture");
    if (!form) return;

    const handleSubmit = (event: Event) => {
      if (bypassNextSubmit.current || (!start && !targetDate)) return;
      const input = form.querySelector<HTMLInputElement>("#capture-task-name");
      if (!input) return;

      event.preventDefault();
      event.stopImmediatePropagation();

      const cleanTitle = input.value
        .replace(MANUAL_START_TOKEN, " ")
        .replace(TARGET_DATE_TOKEN, " ")
        .replace(/\s{2,}/g, " ")
        .trim();
      const tokens = [
        targetDate ? `[[date:${targetDate}]]` : "",
        start ? `[[start:${start}]]` : "",
      ].filter(Boolean).join(" ");
      setNativeInputValue(input, `${cleanTitle} ${tokens}`.trim());
      bypassNextSubmit.current = true;

      window.setTimeout(() => {
        form.requestSubmit();
        window.setTimeout(() => {
          bypassNextSubmit.current = false;
          setStart("");
          setTargetDate("");
        }, 0);
      }, 0);
    };

    form.addEventListener("submit", handleSubmit, true);
    return () => form.removeEventListener("submit", handleSubmit, true);
  }, [start, targetDate, target]);

  return (
    <>
      {target && createPortal(
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
      )}
      {defaultsTarget && targetDate && createPortal(
        <span className="capture-selected-date">
          {formatTargetDate(targetDate)}
          <button type="button" onClick={() => setTargetDate("")} aria-label="Zrušit vybraný den">×</button>
        </span>,
        defaultsTarget,
      )}
    </>
  );
}
