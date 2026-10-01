"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";

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

type BookMetadata = {
  author?: string;
  publisher?: string;
  genre?: string;
  coverUrl?: string;
};

type MetadataStore = Record<string, BookMetadata>;
type SortMode = "newest" | "oldest" | "title" | "pages";

type PastBookDraft = {
  title: string;
  totalPages: string;
  startedAt: string;
  finishedAt: string;
};

const LIBRARY_KEY = "dayframe-reading-library-v1";
const METADATA_KEY = "dayframe-reading-book-metadata-v1";
const LIBRARY_SYNC_EVENT = "dayframe-reading-library-sync";
const METADATA_SYNC_EVENT = "dayframe-reading-book-metadata-sync";

function todayKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function emptyDraft(): PastBookDraft {
  return {
    title: "",
    totalPages: "",
    startedAt: "",
    finishedAt: todayKey(),
  };
}

function readLibrary(): ReadingLibrary {
  try {
    const value = JSON.parse(window.localStorage.getItem(LIBRARY_KEY) || "{}") as unknown;
    return value && typeof value === "object" && !Array.isArray(value) ? value as ReadingLibrary : {};
  } catch {
    return {};
  }
}

function readMetadata(): MetadataStore {
  try {
    const value = JSON.parse(window.localStorage.getItem(METADATA_KEY) || "{}") as unknown;
    return value && typeof value === "object" && !Array.isArray(value) ? value as MetadataStore : {};
  } catch {
    return {};
  }
}

function sameJson(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function bookDate(value: string | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateLabel(value: string | undefined) {
  const date = bookDate(value);
  if (!date) return "—";
  return new Intl.DateTimeFormat("cs-CZ", { day: "numeric", month: "short", year: "numeric" }).format(date);
}

function readingSpan(book: ReadingBook) {
  const start = dateLabel(book.startedAt);
  const end = dateLabel(book.finishedAt);
  return start === "—" ? end : `${start} – ${end}`;
}

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function pageLabel(count: number) {
  const pages = Math.max(0, Math.round(Number(count) || 0));
  if (pages === 1) return "1 strana";
  if (pages >= 2 && pages <= 4) return `${pages} strany`;
  return `${pages} stran`;
}

function newBookId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return `book-${crypto.randomUUID()}`;
  return `book-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function toIsoDate(value: string, fallback: Date) {
  const date = value ? new Date(`${value}T12:00:00`) : fallback;
  return Number.isNaN(date.getTime()) ? fallback.toISOString() : date.toISOString();
}

function yearForBook(book: ReadingBook) {
  return bookDate(book.finishedAt)?.getFullYear() ?? 0;
}

export function ReadingLibraryController() {
  const [buttonHost, setButtonHost] = useState<HTMLElement | null>(null);
  const [library, setLibrary] = useState<ReadingLibrary>({});
  const [metadata, setMetadata] = useState<MetadataStore>({});
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [year, setYear] = useState("all");
  const [genre, setGenre] = useState("all");
  const [sort, setSort] = useState<SortMode>("newest");
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<PastBookDraft>(() => emptyDraft());
  const [formError, setFormError] = useState("");

  useEffect(() => {
    const sync = () => {
      const card = document.querySelector<HTMLElement>(".df2-reading-card");
      const head = card?.querySelector<HTMLElement>(".df2-reading-head") ?? null;
      if (!head) {
        setButtonHost(null);
      } else {
        let host = head.querySelector<HTMLElement>("[data-reading-library-button-host]");
        if (!host) {
          host = document.createElement("span");
          host.dataset.readingLibraryButtonHost = "true";
          host.className = "df2-reading-library-button-host";
          head.appendChild(host);
        }
        setButtonHost((current) => current === host ? current : host);
      }

      const nextLibrary = readLibrary();
      const nextMetadata = readMetadata();
      setLibrary((current) => sameJson(current, nextLibrary) ? current : nextLibrary);
      setMetadata((current) => sameJson(current, nextMetadata) ? current : nextMetadata);
    };

    sync();
    const timer = window.setInterval(sync, 350);
    window.addEventListener(LIBRARY_SYNC_EVENT, sync);
    window.addEventListener(METADATA_SYNC_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener(LIBRARY_SYNC_EVENT, sync);
      window.removeEventListener(METADATA_SYNC_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (adding) {
        setAdding(false);
        setFormError("");
      } else {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, adding]);

  const books = useMemo(
    () => (Array.isArray(library.completed) ? library.completed : [])
      .filter((book): book is ReadingBook => Boolean(book?.id && book?.title && book?.finishedAt)),
    [library],
  );

  const years = useMemo(
    () => [...new Set(books.map(yearForBook).filter(Boolean))].sort((a, b) => b - a),
    [books],
  );

  const genres = useMemo(
    () => [...new Set(books.map((book) => metadata[book.id]?.genre?.trim()).filter((value): value is string => Boolean(value)))]
      .sort((a, b) => a.localeCompare(b, "cs")),
    [books, metadata],
  );

  const filteredBooks = useMemo(() => {
    const needle = normalize(query);
    const next = books.filter((book) => {
      const meta = metadata[book.id] ?? {};
      if (year !== "all" && String(yearForBook(book)) !== year) return false;
      if (genre !== "all" && meta.genre !== genre) return false;
      if (!needle) return true;
      return [book.title, meta.author, meta.publisher, meta.genre]
        .filter(Boolean)
        .some((value) => normalize(String(value)).includes(needle));
    });

    return next.sort((left, right) => {
      if (sort === "oldest") return String(left.finishedAt).localeCompare(String(right.finishedAt));
      if (sort === "title") return left.title.localeCompare(right.title, "cs");
      if (sort === "pages") return (right.totalPages || 0) - (left.totalPages || 0);
      return String(right.finishedAt).localeCompare(String(left.finishedAt));
    });
  }, [books, metadata, query, year, genre, sort]);

  const totalPages = books.reduce((sum, book) => sum + Math.max(0, Number(book.totalPages) || 0), 0);
  const currentYear = new Date().getFullYear();
  const thisYearBooks = books.filter((book) => yearForBook(book) === currentYear).length;

  const savePastBook = (event: FormEvent) => {
    event.preventDefault();
    const title = draft.title.trim();
    const pages = Math.round(Number(draft.totalPages));
    if (!title) {
      setFormError("Zadej název knihy.");
      return;
    }
    if (!Number.isFinite(pages) || pages < 1) {
      setFormError("Počet stran musí být alespoň 1.");
      return;
    }
    if (!draft.finishedAt) {
      setFormError("Zadej datum dočtení.");
      return;
    }
    if (draft.finishedAt > todayKey()) {
      setFormError("Datum dočtení nemůže být v budoucnosti.");
      return;
    }

    const finishedFallback = new Date();
    const finishedAt = toIsoDate(draft.finishedAt, finishedFallback);
    const startedAt = toIsoDate(draft.startedAt, new Date(finishedAt));
    if (new Date(startedAt).getTime() > new Date(finishedAt).getTime()) {
      setFormError("Začátek čtení nemůže být po datu dočtení.");
      return;
    }

    const completed = Array.isArray(library.completed) ? library.completed : [];
    const nextBook: ReadingBook = {
      id: newBookId(),
      title,
      currentPage: pages,
      totalPages: pages,
      startedAt,
      finishedAt,
    };
    const nextLibrary: ReadingLibrary = {
      version: 1,
      current: library.current ?? null,
      completed: [...completed, nextBook],
    };
    window.localStorage.setItem(LIBRARY_KEY, JSON.stringify(nextLibrary));
    window.dispatchEvent(new Event(LIBRARY_SYNC_EVENT));
    setLibrary(nextLibrary);
    setDraft(emptyDraft());
    setFormError("");
    setAdding(false);
  };

  const openPastBookForm = () => {
    setDraft(emptyDraft());
    setFormError("");
    setAdding(true);
  };

  const buttonPortal = buttonHost ? createPortal(
    <button type="button" className="df2-reading-library-open" onClick={() => setOpen(true)}>
      Knihovna{books.length ? ` · ${books.length}` : ""}
    </button>,
    buttonHost,
  ) : null;

  const modalPortal = open ? createPortal(
    <div
      className="df2-reading-library-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) setOpen(false);
      }}
    >
      <section className="df2-reading-library-modal" role="dialog" aria-modal="true" aria-labelledby="df2-reading-library-title">
        <header className="df2-reading-library-head">
          <div>
            <span>Čtenářský archiv</span>
            <h2 id="df2-reading-library-title">Moje knihovna</h2>
          </div>
          <div className="df2-reading-library-head-actions">
            <button type="button" className="df2-reading-library-add" onClick={openPastBookForm}>+ Přidat přečtenou</button>
            <button type="button" className="df2-reading-library-close" aria-label="Zavřít knihovnu" onClick={() => setOpen(false)}>×</button>
          </div>
        </header>

        <div className="df2-reading-library-summary">
          <div><span>Celkem</span><strong>{books.length}</strong><small>knih</small></div>
          <div><span>{currentYear}</span><strong>{thisYearBooks}</strong><small>přečteno letos</small></div>
          <div><span>Strany</span><strong>{totalPages.toLocaleString("cs-CZ")}</strong><small>celkem</small></div>
        </div>

        <div className="df2-reading-library-toolbar">
          <label className="df2-reading-library-search">
            <span className="sr-only">Hledat v knihovně</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Hledat knihu, autora…" />
          </label>
          <select aria-label="Filtrovat podle roku" value={year} onChange={(event) => setYear(event.target.value)}>
            <option value="all">Všechny roky</option>
            {years.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
          <select aria-label="Filtrovat podle žánru" value={genre} onChange={(event) => setGenre(event.target.value)}>
            <option value="all">Všechny žánry</option>
            {genres.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
          <select aria-label="Řazení knih" value={sort} onChange={(event) => setSort(event.target.value as SortMode)}>
            <option value="newest">Nejnovější</option>
            <option value="oldest">Nejstarší</option>
            <option value="title">Podle názvu</option>
            <option value="pages">Nejvíc stran</option>
          </select>
        </div>

        {adding && (
          <form className="df2-reading-library-add-form" onSubmit={savePastBook}>
            <div className="df2-reading-library-add-form-head">
              <div><span>Zpětný záznam</span><strong>Přidat přečtenou knihu</strong></div>
              <button type="button" onClick={() => { setAdding(false); setFormError(""); }}>Zrušit</button>
            </div>
            <div className="df2-reading-library-add-grid">
              <label className="wide"><span>Název knihy</span><input autoFocus value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} /></label>
              <label><span>Počet stran</span><input type="number" min="1" value={draft.totalPages} onChange={(event) => setDraft((current) => ({ ...current, totalPages: event.target.value }))} /></label>
              <label><span>Začátek čtení</span><input type="date" max={draft.finishedAt || todayKey()} value={draft.startedAt} onChange={(event) => setDraft((current) => ({ ...current, startedAt: event.target.value }))} /></label>
              <label><span>Dočteno</span><input type="date" max={todayKey()} value={draft.finishedAt} onChange={(event) => setDraft((current) => ({ ...current, finishedAt: event.target.value }))} /></label>
            </div>
            {formError && <p className="df2-reading-library-error" role="alert">{formError}</p>}
            <div className="df2-reading-library-add-actions"><button type="submit">Uložit do knihovny</button></div>
          </form>
        )}

        <div className="df2-reading-library-results-head">
          <strong>{filteredBooks.length === books.length ? `${books.length} knih` : `${filteredBooks.length} z ${books.length}`}</strong>
        </div>

        {filteredBooks.length ? (
          <div className="df2-reading-library-grid-list">
            {filteredBooks.map((book) => {
              const meta = metadata[book.id] ?? {};
              return (
                <article key={book.id} className="df2-reading-library-book">
                  <div className="df2-reading-library-cover" aria-hidden="true">
                    {meta.coverUrl ? <img src={meta.coverUrl} alt="" loading="lazy" decoding="async" /> : <i />}
                  </div>
                  <div className="df2-reading-library-copy">
                    <span className="df2-reading-library-date">{readingSpan(book)}</span>
                    <strong>{book.title}</strong>
                    {meta.author && <span className="df2-reading-library-author">{meta.author}</span>}
                    <div className="df2-reading-library-meta">
                      <span>{pageLabel(book.totalPages)}</span>
                      {meta.genre && <span>{meta.genre}</span>}
                      {meta.publisher && <span>{meta.publisher}</span>}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="df2-reading-library-empty">
            <strong>{books.length ? "Žádná kniha neodpovídá filtru" : "Knihovna je zatím prázdná"}</strong>
            <span>{books.length ? "Zkus upravit hledání nebo filtry." : "Dočtené knihy se sem budou ukládat automaticky."}</span>
          </div>
        )}
      </section>
    </div>,
    document.body,
  ) : null;

  return <>{buttonPortal}{modalPortal}</>;
}
