"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";

type Birthday = {
  id: string;
  name: string;
  day: number;
  month: number;
  birthYear?: number;
  note?: string;
};

const BIRTHDAYS_STORAGE_KEY = "dayframe-birthdays-v1";
const BIRTHDAYS_SYNC_EVENT = "dayframe-birthdays-sync";
const DAY_MS = 86_400_000;
const MONTHS = ["Leden", "Únor", "Březen", "Duben", "Květen", "Červen", "Červenec", "Srpen", "Září", "Říjen", "Listopad", "Prosinec"];

function localDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function parseDateKey(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

function validMonthDay(month: number, day: number) {
  if (!Number.isInteger(month) || !Number.isInteger(day) || month < 1 || month > 12 || day < 1) return false;
  const probe = new Date(2024, month - 1, day, 12);
  return probe.getMonth() === month - 1 && probe.getDate() === day;
}

function isLeapYear(year: number) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function birthdayOccursOn(birthday: Birthday, occurrence: { year: number; month: number; day: number }) {
  if (birthday.month === occurrence.month && birthday.day === occurrence.day) return true;
  return birthday.month === 2
    && birthday.day === 29
    && occurrence.month === 2
    && occurrence.day === 28
    && !isLeapYear(occurrence.year);
}

function readBirthdays(): Birthday[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(BIRTHDAYS_STORAGE_KEY) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is Birthday => Boolean(
        item
        && typeof item === "object"
        && typeof (item as Birthday).id === "string"
        && typeof (item as Birthday).name === "string"
        && Number.isInteger((item as Birthday).day)
        && Number.isInteger((item as Birthday).month)
        && validMonthDay((item as Birthday).month, (item as Birthday).day),
      ))
      .map((birthday) => ({
        ...birthday,
        birthYear: Number.isInteger(birthday.birthYear) ? birthday.birthYear : undefined,
        note: typeof birthday.note === "string" ? birthday.note : undefined,
      }))
      .sort((left, right) => left.month - right.month || left.day - right.day || left.name.localeCompare(right.name, "cs"));
  } catch {
    return [];
  }
}

function writeBirthdays(birthdays: Birthday[]) {
  const sorted = [...birthdays].sort((left, right) => left.month - right.month || left.day - right.day || left.name.localeCompare(right.name, "cs"));
  window.localStorage.setItem(BIRTHDAYS_STORAGE_KEY, JSON.stringify(sorted));
  window.dispatchEvent(new Event(BIRTHDAYS_SYNC_EVENT));
  return sorted;
}

function daysFromToday(dateKey: string) {
  const parsed = parseDateKey(dateKey);
  if (!parsed) return null;
  const now = new Date();
  const target = Date.UTC(parsed.year, parsed.month - 1, parsed.day);
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target - today) / DAY_MS);
}

function relativeLabel(days: number) {
  if (days === 0) return "dnes";
  if (days === 1) return "zítra";
  if (days > 1) return `za ${days} ${days <= 4 ? "dny" : "dní"}`;
  if (days === -1) return "před 1 dnem";
  return `před ${Math.abs(days)} dny`;
}

function birthdayDetail(birthday: Birthday, occurrenceYear: number, dateKey: string) {
  const age = birthday.birthYear && occurrenceYear >= birthday.birthYear ? occurrenceYear - birthday.birthYear : null;
  const ageText = age && age > 0 ? `${age}. narozeniny` : "Narozeniny";
  const days = daysFromToday(dateKey);
  return days === null ? ageText : `${ageText} · ${relativeLabel(days)}`;
}

function syncCalendarDom() {
  const birthdays = readBirthdays();
  const days = document.querySelectorAll<HTMLElement>(".df2-month-day[data-date]");

  days.forEach((cell) => {
    const key = cell.dataset.date || "";
    const parsed = parseDateKey(key);
    if (!parsed) return;

    const header = cell.querySelector<HTMLElement>(":scope > header");
    const calendarAdd = header?.querySelector<HTMLButtonElement>('button[aria-label^="Přidat do kalendáře "], button[aria-label^="Přidat milník "]');
    if (header && calendarAdd && !header.querySelector("[data-birthday-add-date]")) {
      const add = document.createElement("button");
      add.type = "button";
      add.className = "df2-birthday-add-button";
      add.dataset.birthdayAddDate = key;
      add.setAttribute("aria-label", `Přidat narozeniny ${key}`);
      add.title = "Přidat narozeniny";
      add.textContent = "🎂";
      header.insertBefore(add, calendarAdd);
    }

    const events = cell.querySelector<HTMLElement>(".df2-month-events");
    if (!events) return;
    const matches = birthdays.filter((birthday) => birthdayOccursOn(birthday, parsed));
    const wantedIds = new Set(matches.map((birthday) => birthday.id));

    events.querySelectorAll<HTMLElement>(".df2-month-birthday[data-birthday-id]").forEach((existing) => {
      if (!wantedIds.has(existing.dataset.birthdayId || "")) existing.remove();
    });

    matches.forEach((birthday) => {
      let card = events.querySelector<HTMLButtonElement>(`.df2-month-birthday[data-birthday-id="${CSS.escape(birthday.id)}"]`);
      if (!card) {
        card = document.createElement("button");
        card.type = "button";
        card.className = "df2-month-birthday";
        card.dataset.birthdayId = birthday.id;
        events.appendChild(card);
      }

      const detail = birthdayDetail(birthday, parsed.year, key);
      const signature = `${birthday.name}|${detail}|${birthday.note || ""}`;
      if (card.dataset.birthdaySignature !== signature) {
        const title = document.createElement("strong");
        title.textContent = birthday.name;
        const meta = document.createElement("small");
        meta.textContent = detail;
        card.replaceChildren(title, meta);
        card.dataset.birthdaySignature = signature;
      }
      card.title = birthday.note?.trim() ? `${birthday.name} — ${birthday.note.trim()}` : birthday.name;
    });
  });
}

export function BirthdayCalendarController() {
  const [mounted, setMounted] = useState(false);
  const [creatingDate, setCreatingDate] = useState<string | null>(null);
  const [editing, setEditing] = useState<Birthday | null>(null);
  const modalRef = useRef<HTMLFormElement | null>(null);

  useEffect(() => {
    setMounted(true);
    const sync = () => syncCalendarDom();
    const click = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const add = target?.closest<HTMLElement>("[data-birthday-add-date]");
      if (add?.dataset.birthdayAddDate) {
        event.preventDefault();
        event.stopPropagation();
        setEditing(null);
        setCreatingDate(add.dataset.birthdayAddDate);
        return;
      }
      const card = target?.closest<HTMLElement>(".df2-month-birthday[data-birthday-id]");
      if (card?.dataset.birthdayId) {
        const birthday = readBirthdays().find((item) => item.id === card.dataset.birthdayId) ?? null;
        if (birthday) {
          event.preventDefault();
          event.stopPropagation();
          setCreatingDate(null);
          setEditing(birthday);
        }
      }
    };
    const keyboard = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (creatingDate || editing) {
        setCreatingDate(null);
        setEditing(null);
      }
    };

    sync();
    document.addEventListener("click", click, true);
    window.addEventListener(BIRTHDAYS_SYNC_EVENT, sync);
    window.addEventListener("storage", sync);
    window.addEventListener("keydown", keyboard);
    const timer = window.setInterval(sync, 250);

    return () => {
      document.removeEventListener("click", click, true);
      window.removeEventListener(BIRTHDAYS_SYNC_EVENT, sync);
      window.removeEventListener("storage", sync);
      window.removeEventListener("keydown", keyboard);
      window.clearInterval(timer);
    };
  }, [creatingDate, editing]);

  useEffect(() => {
    if (!creatingDate && !editing) return;
    window.requestAnimationFrame(() => modalRef.current?.querySelector<HTMLInputElement>('input[name="name"]')?.focus());
  }, [creatingDate, editing]);

  const close = () => {
    setCreatingDate(null);
    setEditing(null);
  };

  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") || "").trim();
    const day = Number(form.get("day"));
    const month = Number(form.get("month"));
    const birthYearRaw = String(form.get("birthYear") || "").trim();
    const birthYear = birthYearRaw ? Number(birthYearRaw) : undefined;
    const note = String(form.get("note") || "").trim();
    const currentYear = new Date().getFullYear();
    if (!name || !validMonthDay(month, day)) return;
    if (birthYear !== undefined && (!Number.isInteger(birthYear) || birthYear < 1900 || birthYear > currentYear)) return;

    const birthdays = readBirthdays();
    if (editing) {
      writeBirthdays(birthdays.map((birthday) => birthday.id === editing.id
        ? { ...birthday, name, day, month, birthYear, note: note || undefined }
        : birthday));
    } else {
      writeBirthdays([
        ...birthdays,
        {
          id: `birthday-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          name,
          day,
          month,
          birthYear,
          note: note || undefined,
        },
      ]);
    }
    close();
    window.requestAnimationFrame(syncCalendarDom);
  };

  const remove = () => {
    if (!editing) return;
    writeBirthdays(readBirthdays().filter((birthday) => birthday.id !== editing.id));
    close();
    window.requestAnimationFrame(syncCalendarDom);
  };

  const parsedCreating = creatingDate ? parseDateKey(creatingDate) : null;
  const shown = editing ?? (parsedCreating ? {
    id: "",
    name: "",
    day: parsedCreating.day,
    month: parsedCreating.month,
    note: "",
  } satisfies Birthday : null);

  if (!mounted || !shown) return null;

  return createPortal(
    <div className="df2-modal-backdrop df2-birthday-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
      <form ref={modalRef} className="df2-modal df2-birthday-modal" onSubmit={save}>
        <header>
          <div><p>Každý rok</p><h2>{editing ? "Upravit narozeniny" : "Nové narozeniny"}</h2></div>
          <button type="button" onClick={close}>×</button>
        </header>
        <label>Jméno<input name="name" defaultValue={shown.name} placeholder="Např. Tomáš" required /></label>
        <div className="df2-birthday-date-fields">
          <label>Den<input name="day" type="number" min="1" max="31" defaultValue={shown.day} required /></label>
          <label>Měsíc<select name="month" defaultValue={shown.month}>{MONTHS.map((month, index) => <option key={month} value={index + 1}>{month}</option>)}</select></label>
          <label>Rok narození <span>volitelně</span><input name="birthYear" type="number" min="1900" max={new Date().getFullYear()} defaultValue={shown.birthYear ?? ""} placeholder="2006" /></label>
        </div>
        <label>Poznámka<textarea name="note" rows={3} defaultValue={shown.note ?? ""} placeholder="Např. koupit dárek…" /></label>
        <p className="df2-birthday-repeat-note">🎂 Narozeniny se v kalendáři automaticky zobrazí každý rok. 29. února se v nepřestupném roce zobrazí 28. února.</p>
        <div className="df2-modal-actions">
          <button className="df2-primary">{editing ? "Uložit změny" : "Přidat narozeniny"}</button>
          {editing && <button type="button" className="danger" onClick={remove}>Smazat narozeniny</button>}
        </div>
      </form>
    </div>,
    document.body,
  );
}
