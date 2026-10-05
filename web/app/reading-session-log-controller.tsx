"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { planningDateKey, planningMinute, timeToMinutes } from "../lib/dayframe-calendar";

type PeriodMode = "week" | "month" | "year";
type PeriodRange = { start: Date; end: Date };

type StoredTask = {
  id: string;
  title: string;
  date: string;
  duration: number;
  start?: string;
  end?: string;
  category?: string;
  routineId?: string;
  completed?: boolean;
};

type StoredState = {
  plans?: Record<string, StoredTask[]>;
};

type ReadingBook = {
  id: string;
  title: string;
  currentPage: number;
  totalPages: number;
  startedAt: string;
  finishedAt?: string;
};

type ReadingLibrary = {
  version?: number;
  current?: ReadingBook | null;
  completed?: ReadingBook[];
};

type ReadingSession = {
  id: string;
  taskId: string;
  date: string;
  bookId?: string;
  bookTitle: string;
  pages: number;
  durationMinutes: number;
  loggedAt: string;
};

type ReadingSessionStore = {
  version: 1;
  entries: ReadingSession[];
  skippedTaskIds: string[];
};

type PendingReading = {
  taskId: string;
  date: string;
};

type PendingReadingTask = PendingReading & {
  key: string;
  title: string;
  durationMinutes: number;
};

type ReadingDaySummary = {
  date: string;
  pages: number;
  books: string[];
};

type PeriodSnapshot = {
  mode: PeriodMode;
  rangeKey: string;
  pages: number;
  entries: number;
  days: ReadingDaySummary[];
};

const STATE_KEY = "dayframe-v1";
const LIBRARY_KEY = "dayframe-reading-library-v1";
const SESSION_KEY = "dayframe-reading-sessions-v1";
const PENDING_KEY = "dayframe-reading-pending-v1";
const STATE_SYNC_EVENT = "dayframe-state-sync";
const LIBRARY_SYNC_EVENT = "dayframe-reading-library-sync";
const SESSION_SYNC_EVENT = "dayframe-reading-session-sync";

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function isReadingTask(task: StoredTask) {
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

function taskKey(task: Pick<StoredTask, "id" | "date">) {
  return `${task.date}:${task.id}`;
}

function pendingKey(item: PendingReading) {
  return `${item.date}:${item.taskId}`;
}

function readState(): StoredState {
  try {
    return JSON.parse(window.localStorage.getItem(STATE_KEY) || "{}") as StoredState;
  } catch {
    return {};
  }
}

function readLibrary(): ReadingLibrary {
  try {
    const value = JSON.parse(window.localStorage.getItem(LIBRARY_KEY) || "{}") as unknown;
    return value && typeof value === "object" && !Array.isArray(value) ? value as ReadingLibrary : {};
  } catch {
    return {};
  }
}

function writeLibrary(library: ReadingLibrary) {
  window.localStorage.setItem(LIBRARY_KEY, JSON.stringify(library));
  window.dispatchEvent(new Event(LIBRARY_SYNC_EVENT));
}

function sanitizeSession(value: unknown): ReadingSession | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const taskId = typeof raw.taskId === "string" ? raw.taskId : "";
  const date = typeof raw.date === "string" ? raw.date : "";
  const bookTitle = typeof raw.bookTitle === "string" ? raw.bookTitle.trim() : "";
  const pages = Math.max(0, Math.round(Number(raw.pages) || 0));
  if (!taskId || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !bookTitle || pages < 1) return null;
  return {
    id: typeof raw.id === "string" && raw.id ? raw.id : `reading-${taskId}-${date}`,
    taskId,
    date,
    bookId: typeof raw.bookId === "string" && raw.bookId ? raw.bookId : undefined,
    bookTitle,
    pages,
    durationMinutes: Math.max(0, Math.round(Number(raw.durationMinutes) || 0)),
    loggedAt: typeof raw.loggedAt === "string" && raw.loggedAt ? raw.loggedAt : new Date().toISOString(),
  };
}

function readSessionStore(): ReadingSessionStore {
  try {
    const raw = JSON.parse(window.localStorage.getItem(SESSION_KEY) || "null") as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { version: 1, entries: [], skippedTaskIds: [] };
    const source = raw as Record<string, unknown>;
    const entries = Array.isArray(source.entries)
      ? source.entries.map(sanitizeSession).filter((item): item is ReadingSession => Boolean(item))
      : [];
    const skippedTaskIds = Array.isArray(source.skippedTaskIds)
      ? source.skippedTaskIds.filter((item): item is string => typeof item === "string")
      : [];
    return { version: 1, entries, skippedTaskIds };
  } catch {
    return { version: 1, entries: [], skippedTaskIds: [] };
  }
}

function writeSessionStore(store: ReadingSessionStore) {
  window.localStorage.setItem(SESSION_KEY, JSON.stringify(store));
  window.dispatchEvent(new Event(SESSION_SYNC_EVENT));
}

function readPending(): PendingReading[] {
  try {
    const raw = JSON.parse(window.localStorage.getItem(PENDING_KEY) || "[]") as unknown;
    if (!Array.isArray(raw)) return [];
    return raw
      .map((value): PendingReading | null => {
        if (!value || typeof value !== "object" || Array.isArray(value)) return null;
        const source = value as Record<string, unknown>;
        const taskId = typeof source.taskId === "string" ? source.taskId : "";
        const date = typeof source.date === "string" ? source.date : "";
        return taskId && /^\d{4}-\d{2}-\d{2}$/.test(date) ? { taskId, date } : null;
      })
      .filter((value): value is PendingReading => Boolean(value));
  } catch {
    return [];
  }
}

function writePending(pending: PendingReading[]) {
  window.localStorage.setItem(PENDING_KEY, JSON.stringify(pending));
  window.dispatchEvent(new Event(SESSION_SYNC_EVENT));
}

function addPending(items: PendingReading[]) {
  if (!items.length) return;
  const current = readPending();
  const keys = new Set(current.map(pendingKey));
  let changed = false;
  for (const item of items) {
    if (keys.has(pendingKey(item))) continue;
    current.push(item);
    keys.add(pendingKey(item));
    changed = true;
  }
  if (changed) writePending(current);
}

function removePending(item: PendingReading) {
  const key = pendingKey(item);
  const next = readPending().filter((candidate) => pendingKey(candidate) !== key);
  writePending(next);
}

function completedReadingTasks(state: StoredState) {
  const tasks: StoredTask[] = [];
  for (const [date, dayTasks] of Object.entries(state.plans ?? {})) {
    for (const task of dayTasks ?? []) {
      if (!task.completed || !isReadingTask(task)) continue;
      tasks.push({ ...task, date: task.date || date });
    }
  }
  return tasks;
}

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

function parseRange(view: HTMLElement): { mode: PeriodMode; range: PeriodRange } | null {
  const mode = view.dataset.historyMode as PeriodMode | undefined;
  if (mode !== "week" && mode !== "month" && mode !== "year") return null;
  const label = view.querySelector<HTMLElement>(".df2-history-period-nav > strong")?.textContent?.trim() || "";
  if (!label) return null;

  if (mode === "year") {
    const year = Number(label.match(/\d{4}/)?.[0]);
    return year ? { mode, range: { start: new Date(year, 0, 1, 12), end: new Date(year, 11, 31, 12) } } : null;
  }

  if (mode === "month") {
    const normalized = normalize(label);
    const year = Number(normalized.match(/\d{4}/)?.[0]);
    const monthNames = ["leden", "unor", "brezen", "duben", "kveten", "cerven", "cervenec", "srpen", "zari", "rijen", "listopad", "prosinec"];
    const month = monthNames.findIndex((name) => normalized.startsWith(name));
    return year && month >= 0
      ? { mode, range: { start: new Date(year, month, 1, 12), end: new Date(year, month + 1, 0, 12) } }
      : null;
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

function buildPeriodSnapshot(store: ReadingSessionStore, mode: PeriodMode, range: PeriodRange): PeriodSnapshot {
  const startKey = localDateKey(range.start);
  const endKey = localDateKey(range.end);
  const entries = store.entries.filter((entry) => entry.date >= startKey && entry.date <= endKey);
  const days: ReadingDaySummary[] = [];

  if (mode === "week") {
    for (let date = atNoon(range.start); date.getTime() <= range.end.getTime(); date = addDays(date, 1)) {
      const dateKey = localDateKey(date);
      const dayEntries = entries.filter((entry) => entry.date === dateKey);
      days.push({
        date: dateKey,
        pages: dayEntries.reduce((sum, entry) => sum + entry.pages, 0),
        books: [...new Set(dayEntries.map((entry) => entry.bookTitle))],
      });
    }
  }

  return {
    mode,
    rangeKey: `${startKey}:${endKey}`,
    pages: entries.reduce((sum, entry) => sum + entry.pages, 0),
    entries: entries.length,
    days,
  };
}

function formatPageCount(count: number) {
  if (count === 1) return "1 strana";
  if (count >= 2 && count <= 4) return `${count} strany`;
  return `${count} stran`;
}

function findClickedTask(button: HTMLButtonElement, state: StoredState, now: Date) {
  const date = planningDateKey(now);
  const tasks = state.plans?.[date] ?? [];
  const focusView = button.closest<HTMLElement>(".df2-focus-view");
  const focusTaskId = focusView?.dataset.focusTaskId;
  if (focusTaskId) {
    const exact = tasks.find((task) => !task.completed && task.id === focusTaskId);
    if (exact) return exact;
  }

  const nowCard = button.closest<HTMLElement>(".df2-now-card");
  const title = focusView?.querySelector("h1")?.textContent?.trim()
    || nowCard?.querySelector("h2")?.textContent?.trim();
  if (!title) return null;
  const matching = tasks.filter((task) => !task.completed && task.title === title);
  if (matching.length === 1) return matching[0];
  if (!matching.length) return null;
  const minute = planningMinute(now);
  return matching
    .sort((left, right) => Math.abs(timeToMinutes(left.start) - minute) - Math.abs(timeToMinutes(right.start) - minute))[0] ?? null;
}

function newSessionId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return `reading-${crypto.randomUUID()}`;
  return `reading-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function sameJson(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function ReadingSessionLogController() {
  const [historyHost, setHistoryHost] = useState<HTMLElement | null>(null);
  const [period, setPeriod] = useState<PeriodSnapshot | null>(null);
  const [queue, setQueue] = useState<PendingReadingTask[]>([]);
  const [modalLibrary, setModalLibrary] = useState<ReadingLibrary>({});
  const [bookChoice, setBookChoice] = useState("");
  const [manualTitle, setManualTitle] = useState("");
  const [pages, setPages] = useState("");
  const [formError, setFormError] = useState("");
  const initialized = useRef(false);
  const completedKeys = useRef<Set<string>>(new Set());
  const snoozed = useRef<Set<string>>(new Set());

  const active = queue[0] ?? null;
  const activeKey = active?.key ?? "";

  useEffect(() => {
    const refresh = () => {
      const state = readState();
      const completed = completedReadingTasks(state);
      const nextCompletedKeys = new Set(completed.map(taskKey));

      if (initialized.current) {
        const newlyCompleted = completed
          .filter((task) => !completedKeys.current.has(taskKey(task)))
          .map((task) => ({ taskId: task.id, date: task.date }));
        completedKeys.current = nextCompletedKeys;
        addPending(newlyCompleted);
      } else {
        initialized.current = true;
        completedKeys.current = nextCompletedKeys;
      }

      const sessionStore = readSessionStore();
      const logged = new Set(sessionStore.entries.map((entry) => `${entry.date}:${entry.taskId}`));
      const skipped = new Set(sessionStore.skippedTaskIds);
      const byKey = new Map(completed.map((task) => [taskKey(task), task]));
      const nextQueue = readPending()
        .map((item) => ({ item, key: pendingKey(item), task: byKey.get(pendingKey(item)) }))
        .filter(({ key, task }) => Boolean(task) && !logged.has(key) && !skipped.has(key) && !snoozed.current.has(key))
        .map(({ item, key, task }) => ({
          ...item,
          key,
          title: task?.title || "Čtení",
          durationMinutes: Math.max(0, Math.round(Number(task?.duration) || 0)),
        }));
      setQueue((current) => sameJson(current, nextQueue) ? current : nextQueue);

      const view = document.querySelector<HTMLElement>(".df2-history-view");
      const card = view?.querySelector<HTMLElement>(".df2-reading-card") ?? null;
      if (!view || !card) {
        setHistoryHost((current) => current === null ? current : null);
        setPeriod((current) => current === null ? current : null);
        return;
      }

      let host = card.querySelector<HTMLElement>("[data-reading-session-history-host]");
      if (!host) {
        host = document.createElement("div");
        host.dataset.readingSessionHistoryHost = "true";
        host.className = "df2-reading-session-history-host";
        card.appendChild(host);
      }
      setHistoryHost((current) => current === host ? current : host);

      const parsed = parseRange(view);
      if (!parsed) return;
      const nextPeriod = buildPeriodSnapshot(sessionStore, parsed.mode, parsed.range);
      setPeriod((current) => sameJson(current, nextPeriod) ? current : nextPeriod);
    };

    const onDoneClick = (event: MouseEvent) => {
      const button = event.target instanceof Element
        ? event.target.closest<HTMLButtonElement>("button.df2-time-done")
        : null;
      if (!button) return;
      const state = readState();
      const task = findClickedTask(button, state, new Date());
      if (!task || task.completed || !isReadingTask(task)) return;
      addPending([{ taskId: task.id, date: task.date || planningDateKey(new Date()) }]);
    };

    refresh();
    document.addEventListener("click", onDoneClick, true);
    const timer = window.setInterval(refresh, 350);
    window.addEventListener(STATE_SYNC_EVENT, refresh);
    window.addEventListener(LIBRARY_SYNC_EVENT, refresh);
    window.addEventListener(SESSION_SYNC_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      document.removeEventListener("click", onDoneClick, true);
      window.clearInterval(timer);
      window.removeEventListener(STATE_SYNC_EVENT, refresh);
      window.removeEventListener(LIBRARY_SYNC_EVENT, refresh);
      window.removeEventListener(SESSION_SYNC_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  useEffect(() => {
    if (!active) return;
    const library = readLibrary();
    setModalLibrary(library);
    const completed = Array.isArray(library.completed) ? library.completed : [];
    setBookChoice(library.current?.id ?? completed[completed.length - 1]?.id ?? "__manual__");
    setManualTitle("");
    setPages("");
    setFormError("");
  }, [activeKey]);

  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      snoozed.current.add(active.key);
      setQueue((current) => current.filter((item) => item.key !== active.key));
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [activeKey]);

  const saveSession = (event: FormEvent) => {
    event.preventDefault();
    if (!active) return;
    const pageCount = Math.round(Number(pages));
    if (!Number.isFinite(pageCount) || pageCount < 1) {
      setFormError("Zadej počet přečtených stran.");
      return;
    }

    const library = readLibrary();
    const completedBooks = Array.isArray(library.completed) ? library.completed : [];
    const currentBook = library.current ?? null;
    const selected = bookChoice === currentBook?.id
      ? currentBook
      : completedBooks.find((book) => book.id === bookChoice) ?? null;
    const title = bookChoice === "__manual__" ? manualTitle.trim() : selected?.title?.trim() || "";

    if (!title) {
      setFormError("Vyber knihu nebo zadej její název.");
      return;
    }

    if (currentBook && selected?.id === currentBook.id) {
      const remaining = Math.max(0, currentBook.totalPages - currentBook.currentPage);
      if (pageCount > remaining) {
        setFormError(`V knize zbývá ${formatPageCount(remaining)}. Zkontroluj počet stran.`);
        return;
      }
      writeLibrary({
        ...library,
        version: 1,
        current: { ...currentBook, currentPage: currentBook.currentPage + pageCount },
        completed: completedBooks,
      });
    }

    const store = readSessionStore();
    const entry: ReadingSession = {
      id: newSessionId(),
      taskId: active.taskId,
      date: active.date,
      bookId: selected?.id,
      bookTitle: title,
      pages: pageCount,
      durationMinutes: active.durationMinutes,
      loggedAt: new Date().toISOString(),
    };
    const nextStore: ReadingSessionStore = {
      version: 1,
      entries: [...store.entries.filter((item) => `${item.date}:${item.taskId}` !== active.key), entry],
      skippedTaskIds: store.skippedTaskIds.filter((key) => key !== active.key),
    };
    writeSessionStore(nextStore);
    removePending(active);
    setQueue((current) => current.filter((item) => item.key !== active.key));
  };

  const skipSession = () => {
    if (!active) return;
    const store = readSessionStore();
    writeSessionStore({
      ...store,
      skippedTaskIds: [...new Set([...store.skippedTaskIds, active.key])],
    });
    removePending(active);
    setQueue((current) => current.filter((item) => item.key !== active.key));
  };

  const later = () => {
    if (!active) return;
    snoozed.current.add(active.key);
    setQueue((current) => current.filter((item) => item.key !== active.key));
  };

  const historyPortal = historyHost && period ? createPortal(
    <section className="df2-reading-page-history" aria-label="Historie přečtených stran">
      <header>
        <div>
          <span>Strany v období</span>
          <small>{period.entries ? `${period.entries} ${period.entries === 1 ? "záznam" : period.entries >= 2 && period.entries <= 4 ? "záznamy" : "záznamů"}` : "Zatím bez záznamu"}</small>
        </div>
        <strong>{formatPageCount(period.pages)}</strong>
      </header>
      {period.mode === "week" && (
        <div className="df2-reading-page-days">
          {period.days.map((day) => {
            const date = new Date(`${day.date}T12:00:00`);
            return (
              <article key={day.date} className={day.pages ? "has-pages" : ""} data-reading-page-date={day.date}>
                <time dateTime={day.date}>
                  <span>{new Intl.DateTimeFormat("cs-CZ", { weekday: "short" }).format(date).replace(".", "")}</span>
                  <small>{new Intl.DateTimeFormat("cs-CZ", { day: "numeric", month: "numeric" }).format(date)}</small>
                </time>
                <strong>{day.pages}</strong>
                <span>{day.pages === 1 ? "strana" : day.pages >= 2 && day.pages <= 4 ? "strany" : "stran"}</span>
                <small title={day.books.join(" · ")}>{day.books.length ? day.books.join(" · ") : "Bez záznamu"}</small>
              </article>
            );
          })}
        </div>
      )}
    </section>,
    historyHost,
  ) : null;

  const completedOptions = [...(Array.isArray(modalLibrary.completed) ? modalLibrary.completed : [])]
    .sort((left, right) => String(right.finishedAt || "").localeCompare(String(left.finishedAt || "")));

  const modalPortal = active ? createPortal(
    <div className="df2-reading-session-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) later(); }}>
      <section className="df2-reading-session-modal" role="dialog" aria-modal="true" aria-labelledby="df2-reading-session-title">
        <header>
          <div>
            <span>Čtecí blok dokončen</span>
            <h2 id="df2-reading-session-title">Zapsat čtení</h2>
            <p>{active.title}{active.durationMinutes ? ` · ${active.durationMinutes} min` : ""}</p>
          </div>
          <button type="button" aria-label="Zapsat čtení později" onClick={later}>×</button>
        </header>

        <form onSubmit={saveSession}>
          <label>
            <span>Kniha</span>
            <select value={bookChoice} onChange={(event) => setBookChoice(event.target.value)}>
              {modalLibrary.current && <option value={modalLibrary.current.id}>{modalLibrary.current.title} · aktuálně čtu</option>}
              {completedOptions.map((book) => <option key={book.id} value={book.id}>{book.title}</option>)}
              <option value="__manual__">Jiná kniha…</option>
            </select>
          </label>
          {bookChoice === "__manual__" && (
            <label>
              <span>Název knihy</span>
              <input
                autoFocus
                value={manualTitle}
                onChange={(event) => setManualTitle(event.target.value)}
                placeholder="Např. The Undercover Economist"
              />
            </label>
          )}
          <label>
            <span>Kolik stran jsi přečetl?</span>
            <input
              autoFocus={bookChoice !== "__manual__"}
              type="number"
              min="1"
              inputMode="numeric"
              value={pages}
              onChange={(event) => setPages(event.target.value)}
              placeholder="Např. 18"
            />
          </label>
          {modalLibrary.current?.id === bookChoice && (
            <small className="df2-reading-session-progress-note">
              Teď jsi na straně {modalLibrary.current.currentPage} z {modalLibrary.current.totalPages}. Po uložení se postup v knize posune automaticky.
            </small>
          )}
          {formError && <p className="df2-reading-session-error" role="alert">{formError}</p>}
          <div className="df2-reading-session-actions">
            <button type="button" className="quiet" onClick={skipSession}>Nezapisovat</button>
            <button type="submit" className="primary">Uložit záznam</button>
          </div>
        </form>
      </section>
    </div>,
    document.body,
  ) : null;

  return <>{historyPortal}{modalPortal}</>;
}
