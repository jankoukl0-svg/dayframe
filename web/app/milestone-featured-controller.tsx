"use client";

import { useEffect, useRef, useState } from "react";

type Milestone = { id: string; title: string; date: string; note?: string };
type Anchor = { top: number; right: number };

const STATE_KEY = "dayframe-v1";
const FEATURED_KEY = "dayframe-featured-milestone";

function readMilestones(): Milestone[] {
  try {
    const raw = window.localStorage.getItem(STATE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { milestones?: unknown };
    if (!Array.isArray(parsed.milestones)) return [];
    return parsed.milestones
      .filter((item): item is Milestone => Boolean(
        item
        && typeof item === "object"
        && typeof (item as Milestone).id === "string"
        && typeof (item as Milestone).title === "string"
        && typeof (item as Milestone).date === "string",
      ))
      .sort((a, b) => a.date.localeCompare(b.date));
  } catch {
    return [];
  }
}

function localDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function daysUntil(dateKey: string) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
  const target = new Date(`${dateKey}T12:00:00`);
  return Math.max(0, Math.round((target.getTime() - today.getTime()) / 86_400_000));
}

function longDate(dateKey: string) {
  return new Intl.DateTimeFormat("cs-CZ", { day: "numeric", month: "long", year: "numeric" })
    .format(new Date(`${dateKey}T12:00:00`));
}

function sameAnchor(a: Anchor | null, b: Anchor) {
  return Boolean(a && Math.abs(a.top - b.top) < 0.5 && Math.abs(a.right - b.right) < 0.5);
}

export function MilestoneFeaturedController() {
  const [selectedId, setSelectedId] = useState("auto");
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [open, setOpen] = useState(false);
  const signatureRef = useRef("");
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const saved = window.localStorage.getItem(FEATURED_KEY);
    setSelectedId(saved || "auto");
  }, []);

  useEffect(() => {
    let lastCard: HTMLButtonElement | null = null;

    const sync = () => {
      const card = document.querySelector<HTMLButtonElement>(".df2-event-countdown");
      if (!card || card.getClientRects().length === 0) {
        setAnchor(null);
        setOpen(false);
        return;
      }

      lastCard = card;
      const rect = card.getBoundingClientRect();
      const nextAnchor = { top: rect.top, right: rect.right };
      setAnchor((current) => sameAnchor(current, nextAnchor) ? current : nextAnchor);

      const currentMilestones = readMilestones();
      const signature = JSON.stringify(currentMilestones.map(({ id, title, date }) => [id, title, date]));
      if (signature !== signatureRef.current) {
        signatureRef.current = signature;
        setMilestones(currentMilestones);
      }

      const today = localDateKey(new Date());
      const upcoming = currentMilestones.filter((milestone) => milestone.date >= today);
      const pinned = selectedId === "auto" ? null : upcoming.find((milestone) => milestone.id === selectedId) ?? null;
      const shown = pinned ?? upcoming[0] ?? null;

      const label = card.querySelector<HTMLElement>(":scope > span");
      const count = card.querySelector<HTMLElement>(":scope > strong");
      const title = card.querySelector<HTMLElement>(":scope > b");
      const date = card.querySelector<HTMLElement>(":scope > small");

      if (!label || !count || !title) return;

      const wantedLabel = pinned ? "Vybraný termín" : "Nejbližší termín";
      if (label.textContent !== wantedLabel) label.textContent = wantedLabel;

      if (!shown) {
        if (count.textContent !== "—") count.textContent = "—";
        if (title.textContent !== "Přidat milník") title.textContent = "Přidat milník";
        if (date) date.textContent = "";
        card.setAttribute("aria-label", "Přidat důležitý termín");
        return;
      }

      const remaining = daysUntil(shown.date);
      const existingNumber = count.firstChild?.textContent ?? "";
      const existingUnit = count.querySelector("em")?.textContent ?? "";
      if (existingNumber !== String(remaining) || existingUnit !== "dní") {
        const unit = document.createElement("em");
        unit.textContent = "dní";
        count.replaceChildren(document.createTextNode(String(remaining)), unit);
      }
      if (title.textContent !== shown.title) title.textContent = shown.title;
      if (date && date.textContent !== longDate(shown.date)) date.textContent = longDate(shown.date);
      card.setAttribute("aria-label", `${pinned ? "Vybraný" : "Nejbližší"} termín ${shown.title}, zbývá ${remaining} dní`);
    };

    sync();
    const timer = window.setInterval(sync, 180);
    const reposition = () => sync();
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
      lastCard = null;
    };
  }, [selectedId]);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", close, true);
    return () => document.removeEventListener("pointerdown", close, true);
  }, [open]);

  if (!anchor) return null;

  const today = localDateKey(new Date());
  const upcoming = milestones.filter((milestone) => milestone.date >= today);
  const manual = selectedId !== "auto" && upcoming.some((milestone) => milestone.id === selectedId);
  const menuLeft = Math.max(8, anchor.right - 278);

  function choose(id: string) {
    setSelectedId(id);
    window.localStorage.setItem(FEATURED_KEY, id);
    setOpen(false);
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`df2-featured-milestone-trigger${manual ? " selected" : ""}`}
        style={{ top: anchor.top + 12, left: anchor.right - 38 }}
        aria-label="Vybrat zobrazený milník"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        ⋯
      </button>

      {open && (
        <div
          ref={menuRef}
          className="df2-featured-milestone-menu"
          style={{ top: anchor.top + 44, left: menuLeft }}
          role="menu"
          aria-label="Zobrazený milník"
        >
          <button type="button" className={selectedId === "auto" ? "active" : ""} onClick={() => choose("auto")}>
            <strong>Automaticky</strong>
            <small>nejbližší termín</small>
          </button>
          {upcoming.map((milestone) => (
            <button
              key={milestone.id}
              type="button"
              className={selectedId === milestone.id ? "active" : ""}
              onClick={() => choose(milestone.id)}
            >
              <strong>{milestone.title}</strong>
              <small>{daysUntil(milestone.date)} dní · {longDate(milestone.date)}</small>
            </button>
          ))}
        </div>
      )}
    </>
  );
}
