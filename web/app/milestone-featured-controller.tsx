"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

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
  const [editorHost, setEditorHost] = useState<HTMLElement | null>(null);
  const [editingMilestoneId, setEditingMilestoneId] = useState<string | null>(null);
  const signatureRef = useRef("");
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const editorModalRef = useRef<HTMLFormElement | null>(null);

  useEffect(() => {
    const saved = window.localStorage.getItem(FEATURED_KEY);
    setSelectedId(saved || "auto");
  }, []);

  useEffect(() => {
    const sync = () => {
      const currentMilestones = readMilestones();
      const signature = JSON.stringify(currentMilestones.map(({ id, title, date }) => [id, title, date]));
      if (signature !== signatureRef.current) {
        signatureRef.current = signature;
        setMilestones(currentMilestones);
      }

      const card = document.querySelector<HTMLButtonElement>(".df2-event-countdown");
      if (!card || card.getClientRects().length === 0) {
        setAnchor(null);
        setOpen(false);
      } else {
        const rect = card.getBoundingClientRect();
        const nextAnchor = { top: rect.top, right: rect.right };
        setAnchor((current) => sameAnchor(current, nextAnchor) ? current : nextAnchor);

        const today = localDateKey(new Date());
        const upcoming = currentMilestones.filter((milestone) => milestone.date >= today);
        const pinned = selectedId === "auto" ? null : upcoming.find((milestone) => milestone.id === selectedId) ?? null;
        const shown = pinned ?? upcoming[0] ?? null;

        const label = card.querySelector<HTMLElement>(":scope > span");
        const count = card.querySelector<HTMLElement>(":scope > strong");
        const title = card.querySelector<HTMLElement>(":scope > b");
        const date = card.querySelector<HTMLElement>(":scope > small");

        if (label && count && title) {
          const wantedLabel = pinned ? "Vybraný termín" : "Nejbližší termín";
          if (label.textContent !== wantedLabel) label.textContent = wantedLabel;

          if (!shown) {
            if (count.textContent !== "—") count.textContent = "—";
            if (title.textContent !== "Přidat milník") title.textContent = "Přidat milník";
            if (date) date.textContent = "";
            card.setAttribute("aria-label", "Přidat důležitý termín");
          } else {
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
          }
        }
      }

      const milestoneModal = [...document.querySelectorAll<HTMLFormElement>(".df2-modal")]
        .find((modal) => modal.querySelector("h2")?.textContent?.trim() === "Upravit milník") ?? null;

      if (!milestoneModal) {
        editorModalRef.current = null;
        setEditorHost(null);
        setEditingMilestoneId(null);
        return;
      }

      if (milestoneModal !== editorModalRef.current) {
        editorModalRef.current = milestoneModal;
        const titleInput = milestoneModal.querySelector<HTMLInputElement>('input[name="title"]');
        const dateInput = milestoneModal.querySelector<HTMLInputElement>('input[name="date"]');
        const editingMilestone = currentMilestones.find((milestone) => (
          milestone.title === titleInput?.value && milestone.date === dateInput?.value
        )) ?? null;

        let host = milestoneModal.querySelector<HTMLElement>("[data-featured-milestone-host]");
        if (!host) {
          host = document.createElement("div");
          host.dataset.featuredMilestoneHost = "true";
          host.className = "df2-milestone-featured-host";
          const actions = milestoneModal.querySelector(".df2-modal-actions");
          milestoneModal.insertBefore(host, actions ?? null);
        }

        setEditorHost(host);
        setEditingMilestoneId(editingMilestone?.id ?? null);
      }
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

  const today = localDateKey(new Date());
  const upcoming = milestones.filter((milestone) => milestone.date >= today);
  const manual = selectedId !== "auto" && upcoming.some((milestone) => milestone.id === selectedId);
  const menuLeft = anchor ? Math.max(8, anchor.right - 278) : 8;

  function choose(id: string, closeMenu = true) {
    setSelectedId(id);
    window.localStorage.setItem(FEATURED_KEY, id);
    if (closeMenu) setOpen(false);
  }

  const editorToggle = editorHost && editingMilestoneId
    ? createPortal(
      <label className="df2-milestone-featured-toggle">
        <input
          type="checkbox"
          checked={selectedId === editingMilestoneId}
          onChange={(event) => {
            if (event.target.checked) choose(editingMilestoneId, false);
            else if (selectedId === editingMilestoneId) choose("auto", false);
          }}
          aria-label="Zobrazovat na Dnes"
        />
        <span>Zobrazovat na Dnes</span>
      </label>,
      editorHost,
    )
    : null;

  return (
    <>
      {anchor && (
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
      )}

      {anchor && open && (
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

      {editorToggle}
    </>
  );
}
