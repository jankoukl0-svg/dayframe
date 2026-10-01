"use client";

import { useEffect, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";

type PeriodMode = "week" | "month" | "year";
type PeriodRange = { start: Date; end: Date };
type Task = {
  id: string;
  title: string;
  date: string;
  duration: number;
  category?: string;
  routineId?: string;
  completed?: boolean;
};
type StoredState = { plans?: Record<string, Task[]> };
type ReadingSummary = {
  minutes: number;
  days: number;
  blocks: number;
  averageMinutes: number;
  longestStreak: number;
};
type ReadingSnapshot = ReadingSummary & {
  previousMinutes: number;
  mode: PeriodMode;
  rangeKey: string;
  year: number;
};
type ReadingBook = {
  id: string;
  title: string;
  currentPage: number;
  totalPages: number;
  startedAt: string;
};
type CompletedReadingBook = ReadingBook & {
  finishedAt: string;
};
type ReadingLibrary = {
  version: 1;
  current: ReadingBook | null;
  completed: CompletedReadingBook[];
};
type BookDraft = {
  title: string;
  currentPage: string;
  totalPages: string;
};

const STORAGE_KEY = "dayframe-v1";
const READING_LIBRARY_KEY = "dayframe-reading-library-v1";
const READING_LIBRARY_SYNC_EVENT = "dayframe-reading-library-sync";
const EMPTY_SUMMARY: ReadingSummary = { minutes: 0, days: 0, blocks: 0, averageMinutes: 0, longestStreak: 0 };
const EMPTY_LIBRARY: ReadingLibrary = { version: 1, current: null, completed: [] };
const EMPTY_DRAFT: BookDraft = { title: "", currentPage: "0", totalPages: "" };

function atNoon(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12);
}

function localDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function addDays(date: Date, days: number) {
  const next = atNoon(date);
  next.setDate(next.getDate() + days);
  return next;
}

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function isReadingTask(task: Task) {
  if (task.routineId === "read") return true;
  const title = normalize(task.title || "");
  const category = normalize(task.category || "");
  return category === "cteni"
    || category === "reading"
    || title === "cteni"
    || title === "cteni knihy"
    || title.startsWith("cteni ")
    || title === "reading"
    || title.startsWith("reading ");
}

function readState(): StoredState {
  try {
    return JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "{}") as StoredState;
  } catch {
    return {};
  }
}

function sanitizeBook(value: unknown): ReadingBook | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const title = typeof raw.title === "string" ? raw.title.trim() : "";
  const totalPages = Math.max(0, Math.round(Number(raw.totalPages) || 0));
  const currentPage = Math.min(totalPages, Math.max(0, Math.round(Number(raw.currentPage) || 0)));
  const id = typeof raw.id === "string" && raw.id ? raw.id : `book-${Date.now()}`;
  const startedAt = typeof raw.startedAt === "string" && raw.startedAt ? raw.startedAt : new Date().toISOString();
  if (!title || totalPages < 1) return null;
  return { id, title, currentPage, totalPages, startedAt };
}

function sanitizeCompletedBook(value: unknown): CompletedReadingBook | null {
  const book = sanitizeBook(value);
  if (!book || !value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const finishedAt = typeof raw.finishedAt === "string" && raw.finishedAt ? raw.finishedAt : "";
  if (!finishedAt || Number.isNaN(new Date(finishedAt).getTime())) return null;
  return { ...book, currentPage: book.totalPages, finishedAt };
}

function readLibrary(): ReadingLibrary {
  try {
    const raw = JSON.parse(window.localStorage.getItem(READING_LIBRARY_KEY) || "null") as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return EMPTY_LIBRARY;
    const source = raw as Record<string, unknown>;
    const current = sanitizeBook(source.current);
    const completed = Array.isArray(source.completed)
      ? source.completed.map(sanitizeCompletedBook).filter((book): book is CompletedReadingBook => Boolean(book))
      : [];
    return { version: 1, current, completed };
  } catch {
    return EMPTY_LIBRARY;
  }
}

function writeLibrary(library: ReadingLibrary) {
  window.localStorage.setItem(READING_LIBRARY_KEY, JSON.stringify(library));
  window.dispatchEvent(new Event(READING_LIBRARY_SYNC_EVENT));
}

function sameLibrary(left: ReadingLibrary, right: ReadingLibrary) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function parseRange(view: HTMLElement): { mode: PeriodMode; range: PeriodRange } | null {
  const mode = view.dataset.historyMode as PeriodMode | undefined;
  if (mode !== "week" && mode !== "month" && mode !== "year") return null;
  const label = view.querySelector<HTMLElement>(".df2-history-period-nav > strong")?.textContent?.trim() || "";
  if (!label) return null;

  if (mode === "year") {
    const year = Number(label.match(/\d{4}/)?.[0]);
    if (!year) return null;
    return {
      mode,
      range: {
        start: new Date(year, 0, 1, 12),
        end: new Date(year, 11, 31, 12),
      },
    };
  }

  if (mode === "month") {
    const normalized = normalize(label);
    const year = Number(normalized.match(/\d{4}/)?.[0]);
    if (!year) return null;
    const monthNames = ["leden", "unor", "brezen", "duben", "kveten", "cerven", "cervenec", "srpen", "zari", "rijen", "listopad", "prosinec"];
    const month = monthNames.findIndex((name) => normalized.startsWith(name));
    if (month < 0) return null;
    return {
      mode,
      range: {
        start: new Date(year, month, 1, 12),
        end: new Date(year, month + 1, 0, 12),
      },
    };
  }

  const dates = [...label.matchAll(/(\d{1,2})\.\s*(\d{1,2})\./g)];
  const year = Number(label.match(/\d{4}/)?.[0]);
  if (dates.length < 2 || !year) return null;
  const startDay = Number(dates[0][1]);
  const startMonth = Number(dates[0][2]);
  const endDay = Number(dates[1][1]);
  const endMonth = Number(dates[1][2]);
  const startYear = startMonth > endMonth ? year - 1 : year;
  return {
    mode,
    range: {
      start: new Date(startYear, startMonth - 1, startDay, 12),
      end: new Date(year, endMonth - 1, endDay, 12),
    },
  };
}

function summarizeReading(state: StoredState, range: PeriodRange, now: Date): ReadingSummary {
  const today = atNoon(now);
  if (range.start.getTime() > today.getTime()) return EMPTY_SUMMARY;
  const effectiveEnd = range.end.getTime() < today.getTime() ? range.end : today;
  let minutes = 0;
  let days = 0;
  let blocks = 0;
  let streak = 0;
  let longestStreak = 0;

  for (let date = atNoon(range.start); date.getTime() <= effectiveEnd.getTime(); date = addDays(date, 1)) {
    const readingTasks = (state.plans?.[localDateKey(date)] ?? [])
      .filter((task) => task.completed && isReadingTask(task));
    const dayMinutes = readingTasks.reduce((sum, task) => sum + Math.max(0, Number(task.duration) || 0), 0);
    blocks += readingTasks.length;
    minutes += dayMinutes;
    if (dayMinutes > 0) {
      days += 1;
      streak += 1;
      longestStreak = Math.max(longestStreak, streak);
    } else {
      streak = 0;
    }
  }

  return {
    minutes,
    days,
    blocks,
    averageMinutes: days ? Math.round(minutes / days) : 0,
    longestStreak,
  };
}

function previousRange(mode: PeriodMode, range: PeriodRange, now: Date): PeriodRange {
  let start: Date;
  let end: Date;
  if (mode === "week") {
    start = addDays(range.start, -7);
    end = addDays(range.end, -7);
  } else if (mode === "month") {
    start = new Date(range.start.getFullYear(), range.start.getMonth() - 1, 1, 12);
    end = new Date(range.start.getFullYear(), range.start.getMonth(), 0, 12);
  } else {
    start = new Date(range.start.getFullYear() - 1, 0, 1, 12);
    end = new Date(range.start.getFullYear() - 1, 11, 31, 12);
  }

  const today = atNoon(now);
  const isCurrent = today.getTime() >= range.start.getTime() && today.getTime() <= range.end.getTime();
  if (!isCurrent) return { start, end };
  const elapsedDays = Math.max(0, Math.round((today.getTime() - range.start.getTime()) / 86_400_000));
  const comparableEnd = addDays(start, elapsedDays);
  return { start, end: comparableEnd.getTime() < end.getTime() ? comparableEnd : end };
}

function formatMinutes(minutes: number) {
  const safe = Math.max(0, Math.round(minutes));
  const hours = Math.floor(safe / 60);
  const rest = safe % 60;
  if (!hours) return `${rest} min`;
  if (!rest) return `${hours} h`;
  return `${hours} h ${rest} min`;
}

function deltaLabel(current: number, previous: number) {
  if (!previous) return current ? "Nové období" : "Bez změny";
  const delta = Math.round(((current - previous) / previous) * 100);
  if (!delta) return "Stejně jako minule";
  return `${delta > 0 ? "+" : "−"}${Math.abs(delta)} % oproti minule`;
}

function sameSnapshot(left: ReadingSnapshot | null, right: ReadingSnapshot) {
  return Boolean(left)
    && left?.minutes === right.minutes
    && left?.days === right.days
    && left?.blocks === right.blocks
    && left?.averageMinutes === right.averageMinutes
    && left?.longestStreak === right.longestStreak
    && left?.previousMinutes === right.previousMinutes
    && left?.mode === right.mode
    && left?.rangeKey === right.rangeKey
    && left?.year === right.year;
}

function readingYearSummary(library: ReadingLibrary, year: number) {
  const books = library.completed.filter((book) => new Date(book.finishedAt).getFullYear() === year);
  return {
    books: books.length,
    pages: books.reduce((sum, book) => sum + book.totalPages, 0),
  };
}

function formatBookCount(count: number) {
  if (count === 1) return "1 kniha";
  if (count >= 2 && count <= 4) return `${count} knihy`;
  return `${count} knih`;
}

function formatPageCount(count: number) {
  if (count === 1) return "1 strana";
  if (count >= 2 && count <= 4) return `${count} strany`;
  return `${count} stran`;
}

function newBookId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return `book-${crypto.randomUUID()}`;
  return `book-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function bookDraft(book: ReadingBook | null): BookDraft {
  if (!book) return EMPTY_DRAFT;
  return {
    title: book.title,
    currentPage: String(book.currentPage),
    totalPages: String(book.totalPages),
  };
}

function validateDraft(draft: BookDraft) {
  const title = draft.title.trim();
  const currentPage = Math.round(Number(draft.currentPage));
  const totalPages = Math.round(Number(draft.totalPages));
  if (!title) return { error: "Zadej název knihy." } as const;
  if (!Number.isFinite(totalPages) || totalPages < 1) return { error: "Počet stran musí být alespoň 1." } as const;
  if (!Number.isFinite(currentPage) || currentPage < 0) return { error: "Aktuální strana nemůže být záporná." } as const;
  if (currentPage > totalPages) return { error: "Aktuální strana nemůže být vyšší než počet stran knihy." } as const;
  return { title, currentPage, totalPages, error: null } as const;
}

export function ReadingOverviewController() {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [snapshot, setSnapshot] = useState<ReadingSnapshot | null>(null);
  const [library, setLibrary] = useState<ReadingLibrary>(EMPTY_LIBRARY);
  const [managerOpen, setManagerOpen] = useState(false);
  const [draft, setDraft] = useState<BookDraft>(EMPTY_DRAFT);
  const [formError, setFormError] = useState("");

  useEffect(() => {
    const sync = () => {
      const view = document.querySelector<HTMLElement>(".df2-history-view");
      const trend = view?.querySelector<HTMLElement>(".df2-history-trend") ?? null;
      if (!view || !trend) {
        setHost((current) => current === null ? current : null);
        return;
      }

      let nextHost = view.querySelector<HTMLElement>("[data-reading-overview-host]");
      if (!nextHost) {
        nextHost = document.createElement("div");
        nextHost.dataset.readingOverviewHost = "true";
        nextHost.className = "df2-reading-overview-host";
        trend.insertAdjacentElement("afterend", nextHost);
      }
      setHost((current) => current === nextHost ? current : nextHost);

      const parsed = parseRange(view);
      if (!parsed) return;
      const now = new Date();
      const state = readState();
      const current = summarizeReading(state, parsed.range, now);
      const previous = summarizeReading(state, previousRange(parsed.mode, parsed.range, now), now);
      const nextSnapshot: ReadingSnapshot = {
        ...current,
        previousMinutes: previous.minutes,
        mode: parsed.mode,
        rangeKey: `${localDateKey(parsed.range.start)}:${localDateKey(parsed.range.end)}`,
        year: parsed.range.end.getFullYear(),
      };
      setSnapshot((existing) => sameSnapshot(existing, nextSnapshot) ? existing : nextSnapshot);

      const nextLibrary = readLibrary();
      setLibrary((existing) => sameLibrary(existing, nextLibrary) ? existing : nextLibrary);
    };

    sync();
    const timer = window.setInterval(sync, 350);
    window.addEventListener("dayframe-state-sync", sync);
    window.addEventListener(READING_LIBRARY_SYNC_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("dayframe-state-sync", sync);
      window.removeEventListener(READING_LIBRARY_SYNC_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  useEffect(() => {
    if (!managerOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setManagerOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [managerOpen]);

  const openManager = () => {
    setDraft(bookDraft(library.current));
    setFormError("");
    setManagerOpen(true);
  };

  const saveBook = (event: FormEvent) => {
    event.preventDefault();
    const valid = validateDraft(draft);
    if (valid.error) {
      setFormError(valid.error);
      return;
    }
    const nextCurrent: ReadingBook = {
      id: library.current?.id ?? newBookId(),
      title: valid.title,
      currentPage: valid.currentPage,
      totalPages: valid.totalPages,
      startedAt: library.current?.startedAt ?? new Date().toISOString(),
    };
    const nextLibrary = { ...library, current: nextCurrent };
    writeLibrary(nextLibrary);
    setLibrary(nextLibrary);
    setManagerOpen(false);
  };

  const finishBook = () => {
    const valid = validateDraft(draft);
    if (valid.error) {
      setFormError(valid.error);
      return;
    }
    const now = new Date().toISOString();
    const finished: CompletedReadingBook = {
      id: library.current?.id ?? newBookId(),
      title: valid.title,
      currentPage: valid.totalPages,
      totalPages: valid.totalPages,
      startedAt: library.current?.startedAt ?? now,
      finishedAt: now,
    };
    const nextLibrary: ReadingLibrary = {
      version: 1,
      current: null,
      completed: [...library.completed, finished],
    };
    writeLibrary(nextLibrary);
    setLibrary(nextLibrary);
    setDraft(EMPTY_DRAFT);
    setManagerOpen(false);
  };

  const removeCompletedBook = (id: string) => {
    const nextLibrary = {
      ...library,
      completed: library.completed.filter((book) => book.id !== id),
    };
    writeLibrary(nextLibrary);
    setLibrary(nextLibrary);
  };

  if (!host || !snapshot) return null;

  const currentBook = library.current;
  const progress = currentBook ? Math.round((currentBook.currentPage / currentBook.totalPages) * 100) : 0;
  const yearSummary = readingYearSummary(library, snapshot.year);
  const completedBooks = [...library.completed].sort((left, right) => right.finishedAt.localeCompare(left.finishedAt));

  const cardPortal = createPortal(
    <section className="df2-reading-card" aria-label="Čtení">
      <div className="df2-overview-section-head df2-reading-head">
        <h2>Čtení</h2>
        <button type="button" className="df2-reading-manage" onClick={openManager}>
          {currentBook ? "Upravit knihu" : "Přidat knihu"}
        </button>
      </div>

      <div className="df2-reading-library-grid">
        <div className={`df2-reading-current-book${currentBook ? "" : " empty"}`}>
          <i className="df2-reading-book-cover" aria-hidden="true"><span /></i>
          <div>
            <span>Aktuálně čtu</span>
            {currentBook ? (
              <>
                <strong>{currentBook.title}</strong>
                <div className="df2-reading-progress-copy">
                  <span>Strana {currentBook.currentPage} z {currentBook.totalPages}</span>
                  <strong>{progress} %</strong>
                </div>
                <div className="df2-reading-progress" aria-label={`${progress} % knihy přečteno`}>
                  <i style={{ width: `${progress}%` }} />
                </div>
              </>
            ) : (
              <>
                <strong>Žádná rozečtená kniha</strong>
                <button type="button" onClick={openManager}>Začít novou knihu</button>
              </>
            )}
          </div>
        </div>

        <div className="df2-reading-year-summary">
          <span>Přečteno · {snapshot.year}</span>
          <strong>{formatBookCount(yearSummary.books)}</strong>
          <small>{formatPageCount(yearSummary.pages)}</small>
        </div>
      </div>

      <div className="df2-reading-card-grid">
        <div className="df2-reading-primary">
          <span>Čas čtení</span>
          <strong>{formatMinutes(snapshot.minutes)}</strong>
          <small>{deltaLabel(snapshot.minutes, snapshot.previousMinutes)}</small>
        </div>
        <div className="df2-reading-stat">
          <strong>{snapshot.days}</strong>
          <span>dní čtení</span>
        </div>
        <div className="df2-reading-stat">
          <strong>{formatMinutes(snapshot.averageMinutes)}</strong>
          <span>průměr / den</span>
        </div>
        <div className="df2-reading-stat">
          <strong>{snapshot.longestStreak}</strong>
          <span>dní nejdelší série</span>
        </div>
      </div>
    </section>,
    host,
  );

  const managerPortal = managerOpen ? createPortal(
    <div
      className="df2-reading-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) setManagerOpen(false);
      }}
    >
      <div className="df2-reading-modal" role="dialog" aria-modal="true" aria-labelledby="df2-reading-modal-title">
        <div className="df2-reading-modal-head">
          <div>
            <span>{currentBook ? "Aktuální kniha" : "Nová kniha"}</span>
            <h2 id="df2-reading-modal-title">{currentBook ? "Upravit čtení" : "Co právě čteš?"}</h2>
          </div>
          <button type="button" aria-label="Zavřít správu knih" onClick={() => setManagerOpen(false)}>×</button>
        </div>

        <form onSubmit={saveBook}>
          <label>
            <span>Název knihy</span>
            <input
              autoFocus
              value={draft.title}
              onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
              placeholder="Např. The Intelligent Investor"
            />
          </label>
          <div className="df2-reading-modal-pages">
            <label>
              <span>Aktuální strana</span>
              <input
                type="number"
                min="0"
                inputMode="numeric"
                value={draft.currentPage}
                onChange={(event) => setDraft((current) => ({ ...current, currentPage: event.target.value }))}
              />
            </label>
            <label>
              <span>Počet stran</span>
              <input
                type="number"
                min="1"
                inputMode="numeric"
                value={draft.totalPages}
                onChange={(event) => setDraft((current) => ({ ...current, totalPages: event.target.value }))}
              />
            </label>
          </div>
          {formError && <p className="df2-reading-form-error" role="alert">{formError}</p>}
          <div className="df2-reading-modal-actions">
            {currentBook && <button type="button" className="df2-reading-finish" onClick={finishBook}>Dočteno</button>}
            <button type="submit" className="df2-reading-save">{currentBook ? "Uložit" : "Začít číst"}</button>
          </div>
        </form>

        {completedBooks.length > 0 && (
          <section className="df2-reading-completed">
            <h3>Přečtené knihy</h3>
            <div>
              {completedBooks.map((book) => (
                <article key={book.id}>
                  <div>
                    <strong>{book.title}</strong>
                    <span>{formatPageCount(book.totalPages)} · {new Intl.DateTimeFormat("cs-CZ", { day: "numeric", month: "short", year: "numeric" }).format(new Date(book.finishedAt))}</span>
                  </div>
                  <button type="button" onClick={() => removeCompletedBook(book.id)}>Odstranit</button>
                </article>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>,
    document.body,
  ) : null;

  return <>{cardPortal}{managerPortal}</>;
}
