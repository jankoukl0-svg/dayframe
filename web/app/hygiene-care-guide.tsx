"use client";

import { useEffect, useState } from "react";
import type { HygieneProductSnapshot } from "@/lib/dayframe-hygiene";

// The guide displays only user-entered values. It never infers how a product
// should be applied or whether several products are safe together.
export function ProductCareGuide({ product }: { product: Pick<HygieneProductSnapshot,
  "instructions" | "usageWhen" | "usageAmount" | "usageDuration" | "frequency" | "precautions"> }) {
  const details = [
    ["Kdy", product.usageWhen],
    ["Množství", product.usageAmount],
    ["Doba", product.usageDuration],
    ["Frekvence", product.frequency],
  ] as const;
  if (!product.instructions && !product.precautions && !details.some(([, value]) => value)) return null;
  return (
    <div className="df2-care-guide">
      {product.instructions && <p className="df2-care-guide-instructions">{product.instructions}</p>}
      {details.some(([, value]) => value) && (
        <dl>{details.filter(([, value]) => Boolean(value)).map(([label, value]) => (
          <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
        ))}</dl>
      )}
      {product.precautions && <p className="df2-care-guide-caution"><strong>Upozornění:</strong> {product.precautions}</p>}
    </div>
  );
}

function clockLabel(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return String(minutes).padStart(2, "0") + ":" + String(seconds % 60).padStart(2, "0");
}

export function HygieneTaskTimer({ seconds, taskTitle }: { seconds: number; taskTitle: string }) {
  const [remaining, setRemaining] = useState(seconds);
  const [deadline, setDeadline] = useState<number | null>(null);
  useEffect(() => {
    setRemaining(seconds);
    setDeadline(null);
  }, [seconds]);
  useEffect(() => {
    if (deadline === null) return;
    const update = () => {
      const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setRemaining(left);
      if (left === 0) setDeadline(null);
    };
    update();
    const interval = window.setInterval(update, 250);
    return () => window.clearInterval(interval);
  }, [deadline]);

  const running = deadline !== null;
  const finished = remaining === 0 && !running;
  const toggle = () => {
    if (running) {
      setRemaining(Math.max(0, Math.ceil(((deadline ?? 0) - Date.now()) / 1000)));
      setDeadline(null);
    } else {
      const next = remaining > 0 ? remaining : seconds;
      setRemaining(next);
      setDeadline(Date.now() + next * 1000);
    }
  };
  return (
    <div className="df2-care-timer" data-hygiene-timer={taskTitle}>
      <span aria-label={"Časovač " + taskTitle + ": " + clockLabel(remaining)}>{clockLabel(remaining)}</span>
      <button type="button" onClick={toggle} aria-label={(running ? "Pozastavit" : finished ? "Spustit znovu" : remaining < seconds ? "Pokračovat" : "Spustit") + " časovač " + taskTitle}>
        {running ? "Pozastavit" : finished ? "Znovu" : remaining < seconds ? "Pokračovat" : "Spustit"}
      </button>
      {(remaining !== seconds || running) && <button type="button" onClick={() => { setDeadline(null); setRemaining(seconds); }} aria-label={"Resetovat časovač " + taskTitle}>Reset</button>}
      {finished && <strong role="status">Čas vypršel</strong>}
    </div>
  );
}
