"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
  current: ReadingBook | null;
  completed: ReadingBook[];
};

type BookMetadata = {
  titleKey: string;
  author?: string;
  publisher?: string;
  genre?: string;
  coverUrl?: string;
  openLibraryKey?: string;
  fetchedAt: string;
  notFound?: boolean;
};

type MetadataStore = Record<string, BookMetadata>;
type LookupStatus = "idle" | "loading" | "found" | "not-found" | "error";

type OpenLibraryDoc = {
  key?: string;
  title?: string;
  author_name?: string[];
  cover_i?: number;
  publisher?: string[];
  subject?: string[];
};

type OpenLibraryResponse = { docs?: OpenLibraryDoc[] };

const LIBRARY_KEY = "dayframe-reading-library-v1";
const METADATA_KEY = "dayframe-reading-book-metadata-v1";
const METADATA_SYNC_EVENT = "dayframe-reading-book-metadata-sync";
const EMPTY_LIBRARY: ReadingLibrary = { current: null, completed: [] };
const lookupCache = new Map<string, Promise<BookMetadata>>();

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function sanitizeBook(value: unknown): ReadingBook | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const id = typeof raw.id === "string" ? raw.id : "";
  const title = typeof raw.title === "string" ? raw.title.trim() : "";
  const totalPages = Math.max(0, Math.round(Number(raw.totalPages) || 0));
  const currentPage = Math.max(0, Math.round(Number(raw.currentPage) || 0));
  const startedAt = typeof raw.startedAt === "string" ? raw.startedAt : "";
  const finishedAt = typeof raw.finishedAt === "string" ? raw.finishedAt : undefined;
  if (!id || !title) return null;
  return { id, title, totalPages, currentPage, startedAt, finishedAt };
}

function readLibrary(): ReadingLibrary {
  try {
    const raw = JSON.parse(window.localStorage.getItem(LIBRARY_KEY) || "null") as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return EMPTY_LIBRARY;
    const source = raw as Record<string, unknown>;
    const current = sanitizeBook(source.current);
    const completed = Array.isArray(source.completed)
      ? source.completed.map(sanitizeBook).filter((book): book is ReadingBook => Boolean(book))
      : [];
    return { current, completed };
  } catch {
    return EMPTY_LIBRARY;
  }
}

function sanitizeMetadata(value: unknown): BookMetadata | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const titleKey = typeof raw.titleKey === "string" ? raw.titleKey : "";
  const fetchedAt = typeof raw.fetchedAt === "string" ? raw.fetchedAt : "";
  if (!titleKey || !fetchedAt) return null;
  return {
    titleKey,
    fetchedAt,
    author: typeof raw.author === "string" ? raw.author : undefined,
    publisher: typeof raw.publisher === "string" ? raw.publisher : undefined,
    genre: typeof raw.genre === "string" ? raw.genre : undefined,
    coverUrl: typeof raw.coverUrl === "string" ? raw.coverUrl : undefined,
    openLibraryKey: typeof raw.openLibraryKey === "string" ? raw.openLibraryKey : undefined,
    notFound: raw.notFound === true,
  };
}

function readMetadata(): MetadataStore {
  try {
    const raw = JSON.parse(window.localStorage.getItem(METADATA_KEY) || "{}") as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    return Object.fromEntries(
      Object.entries(raw as Record<string, unknown>)
        .map(([id, value]) => [id, sanitizeMetadata(value)] as const)
        .filter((entry): entry is [string, BookMetadata] => Boolean(entry[1])),
    );
  } catch {
    return {};
  }
}

function writeMetadata(store: MetadataStore) {
  window.localStorage.setItem(METADATA_KEY, JSON.stringify(store));
  window.dispatchEvent(new Event(METADATA_SYNC_EVENT));
}

function sameJson(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function scoreDoc(doc: OpenLibraryDoc, title: string) {
  const query = normalize(title);
  const candidate = normalize(doc.title || "");
  if (!candidate) return -1;
  if (candidate === query) return 1000;
  let score = 0;
  if (candidate.startsWith(query) || query.startsWith(candidate)) score += 120;
  const queryWords = new Set(query.split(" ").filter(Boolean));
  const candidateWords = new Set(candidate.split(" ").filter(Boolean));
  for (const word of queryWords) if (candidateWords.has(word)) score += 20;
  score -= Math.abs(candidate.length - query.length) * 0.15;
  return score;
}

function pickGenre(subjects: string[] | undefined) {
  if (!subjects?.length) return undefined;
  const blocked = /accessible book|protected daisy|large type|juvenile literature|translations into|bibliography/i;
  const priority = /econom|finance|business|history|biograph|psycholog|philosoph|science|technology|fiction|fantasy|mystery|thriller|romance|self-help|politic|management|invest|marketing/i;
  return subjects.find((subject) => subject.length <= 48 && priority.test(subject) && !blocked.test(subject))
    ?? subjects.find((subject) => subject.length <= 48 && !blocked.test(subject));
}

async function fetchBookMetadata(title: string): Promise<BookMetadata> {
  const titleKey = normalize(title);
  if (!titleKey) return { titleKey, fetchedAt: new Date().toISOString(), notFound: true };

  const params = new URLSearchParams({
    title: title.trim(),
    fields: "key,title,author_name,cover_i,publisher,subject",
    limit: "8",
  });
  const response = await fetch(`https://openlibrary.org/search.json?${params.toString()}`, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Open Library ${response.status}`);
  const payload = await response.json() as OpenLibraryResponse;
  const docs = Array.isArray(payload.docs) ? payload.docs : [];
  const best = [...docs].sort((left, right) => scoreDoc(right, title) - scoreDoc(left, title))[0];
  if (!best || scoreDoc(best, title) < 1) {
    return { titleKey, fetchedAt: new Date().toISOString(), notFound: true };
  }

  const coverId = Number(best.cover_i);
  return {
    titleKey,
    fetchedAt: new Date().toISOString(),
    author: best.author_name?.find(Boolean),
    publisher: best.publisher?.find(Boolean),
    genre: pickGenre(best.subject),
    coverUrl: Number.isFinite(coverId) && coverId > 0
      ? `https://covers.openlibrary.org/b/id/${coverId}-M.jpg?default=false`
      : undefined,
    openLibraryKey: best.key,
  };
}

function lookupBook(title: string) {
  const key = normalize(title);
  const existing = lookupCache.get(key);
  if (existing) return existing;
  const request = fetchBookMetadata(title).catch((error) => {
    lookupCache.delete(key);
    throw error;
  });
  lookupCache.set(key, request);
  return request;
}

function metadataForBook(book: ReadingBook | null, store: MetadataStore) {
  if (!book) return null;
  const value = store[book.id];
  if (!value || value.titleKey !== normalize(book.title)) return null;
  return value;
}

function dateLabel(value: string | undefined) {
  if (!value) return "?";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "?";
  return new Intl.DateTimeFormat("cs-CZ", { day: "numeric", month: "short", year: "numeric" }).format(date);
}

function readingSpan(book: ReadingBook) {
  return `${dateLabel(book.startedAt)} – ${dateLabel(book.finishedAt)}`;
}

function pageLabel(pages: number) {
  if (pages === 1) return "1 strana";
  if (pages >= 2 && pages <= 4) return `${pages} strany`;
  return `${pages} stran`;
}

function metadataLine(metadata: BookMetadata | null) {
  if (!metadata || metadata.notFound) return [];
  return [metadata.author, metadata.publisher, metadata.genre].filter((value): value is string => Boolean(value));
}

export function ReadingMetadataController() {
  const [library, setLibrary] = useState<ReadingLibrary>(EMPTY_LIBRARY);
  const [metadata, setMetadata] = useState<MetadataStore>({});
  const [coverHost, setCoverHost] = useState<HTMLElement | null>(null);
  const [currentMetaHost, setCurrentMetaHost] = useState<HTMLElement | null>(null);
  const [historyHost, setHistoryHost] = useState<HTMLElement | null>(null);
  const [previewHost, setPreviewHost] = useState<HTMLElement | null>(null);
  const [previewTitle, setPreviewTitle] = useState("");
  const [previewMetadata, setPreviewMetadata] = useState<BookMetadata | null>(null);
  const [previewStatus, setPreviewStatus] = useState<LookupStatus>("idle");
  const enrichingRef = useRef(new Set<string>());

  useEffect(() => {
    const sync = () => {
      const nextLibrary = readLibrary();
      const nextMetadata = readMetadata();
      setLibrary((current) => sameJson(current, nextLibrary) ? current : nextLibrary);
      setMetadata((current) => sameJson(current, nextMetadata) ? current : nextMetadata);

      const card = document.querySelector<HTMLElement>(".df2-reading-card");
      if (!card) {
        setCoverHost(null);
        setCurrentMetaHost(null);
        setHistoryHost(null);
        setPreviewHost(null);
        setPreviewTitle("");
        return;
      }

      const cover = card.querySelector<HTMLElement>(".df2-reading-book-cover");
      if (cover) {
        let host = cover.querySelector<HTMLElement>("[data-reading-real-cover-host]");
        if (!host) {
          host = document.createElement("span");
          host.dataset.readingRealCoverHost = "true";
          host.className = "df2-reading-real-cover-host";
          cover.appendChild(host);
        }
        setCoverHost((current) => current === host ? current : host);
      } else {
        setCoverHost(null);
      }

      const bookCopy = card.querySelector<HTMLElement>(".df2-reading-current-book > div");
      const title = bookCopy?.querySelector<HTMLElement>(":scope > strong") ?? null;
      if (bookCopy && title && nextLibrary.current) {
        let host = bookCopy.querySelector<HTMLElement>("[data-reading-current-meta-host]");
        if (!host) {
          host = document.createElement("div");
          host.dataset.readingCurrentMetaHost = "true";
          host.className = "df2-reading-current-meta-host";
          title.insertAdjacentElement("afterend", host);
        }
        setCurrentMetaHost((current) => current === host ? current : host);
      } else {
        setCurrentMetaHost(null);
      }

      let history = card.querySelector<HTMLElement>("[data-reading-book-history-host]");
      if (!history) {
        history = document.createElement("div");
        history.dataset.readingBookHistoryHost = "true";
        history.className = "df2-reading-book-history-host";
        card.appendChild(history);
      }
      setHistoryHost((current) => current === history ? current : history);

      const modal = document.querySelector<HTMLElement>(".df2-reading-modal");
      const firstLabel = modal?.querySelector<HTMLElement>("form > label:first-child") ?? null;
      const titleInput = firstLabel?.querySelector<HTMLInputElement>("input") ?? null;
      if (firstLabel && titleInput) {
        let host = modal?.querySelector<HTMLElement>("[data-reading-lookup-preview-host]") ?? null;
        if (!host) {
          host = document.createElement("div");
          host.dataset.readingLookupPreviewHost = "true";
          host.className = "df2-reading-lookup-preview-host";
          firstLabel.insertAdjacentElement("afterend", host);
        }
        setPreviewHost((current) => current === host ? current : host);
        setPreviewTitle((current) => current === titleInput.value ? current : titleInput.value);
      } else {
        setPreviewHost(null);
        setPreviewTitle("");
      }
    };

    sync();
    const timer = window.setInterval(sync, 300);
    window.addEventListener("dayframe-reading-library-sync", sync);
    window.addEventListener(METADATA_SYNC_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("dayframe-reading-library-sync", sync);
      window.removeEventListener(METADATA_SYNC_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  useEffect(() => {
    const books = [library.current, ...library.completed].filter((book): book is ReadingBook => Boolean(book));
    const missing = books.find((book) => {
      const entry = metadata[book.id];
      return !entry || entry.titleKey !== normalize(book.title);
    });
    if (!missing || enrichingRef.current.has(missing.id)) return;

    enrichingRef.current.add(missing.id);
    lookupBook(missing.title)
      .then((result) => {
        const nextStore = { ...readMetadata(), [missing.id]: result };
        writeMetadata(nextStore);
        setMetadata(nextStore);
      })
      .catch(() => {
        const fallback: BookMetadata = {
          titleKey: normalize(missing.title),
          fetchedAt: new Date().toISOString(),
          notFound: true,
        };
        const nextStore = { ...readMetadata(), [missing.id]: fallback };
        writeMetadata(nextStore);
        setMetadata(nextStore);
      })
      .finally(() => enrichingRef.current.delete(missing.id));
  }, [library, metadata]);

  useEffect(() => {
    const title = previewTitle.trim();
    if (!previewHost || normalize(title).length < 3) {
      setPreviewMetadata(null);
      setPreviewStatus("idle");
      return;
    }

    const saved = [library.current, ...library.completed]
      .filter((book): book is ReadingBook => Boolean(book))
      .find((book) => normalize(book.title) === normalize(title));
    const savedMetadata = saved ? metadataForBook(saved, metadata) : null;
    if (savedMetadata && !savedMetadata.notFound) {
      setPreviewMetadata(savedMetadata);
      setPreviewStatus("found");
      return;
    }

    let cancelled = false;
    setPreviewStatus("loading");
    const timer = window.setTimeout(() => {
      lookupBook(title)
        .then((result) => {
          if (cancelled) return;
          setPreviewMetadata(result.notFound ? null : result);
          setPreviewStatus(result.notFound ? "not-found" : "found");
        })
        .catch(() => {
          if (cancelled) return;
          setPreviewMetadata(null);
          setPreviewStatus("error");
        });
    }, 450);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [previewHost, previewTitle, library, metadata]);

  const currentMetadata = metadataForBook(library.current, metadata);
  const currentMetaParts = metadataLine(currentMetadata);
  const completedBooks = useMemo(
    () => [...library.completed].sort((left, right) => (right.finishedAt || "").localeCompare(left.finishedAt || "")),
    [library.completed],
  );

  useEffect(() => {
    const cover = coverHost?.parentElement;
    if (!cover) return;
    const hasCover = Boolean(library.current && currentMetadata?.coverUrl);
    cover.classList.toggle("has-real-cover", hasCover);
    return () => cover.classList.remove("has-real-cover");
  }, [coverHost, library.current, currentMetadata?.coverUrl]);

  const coverPortal = coverHost && library.current && currentMetadata?.coverUrl ? createPortal(
    <img src={currentMetadata.coverUrl} alt={`Obálka knihy ${library.current.title}`} />,
    coverHost,
  ) : null;

  const currentMetaPortal = currentMetaHost && currentMetaParts.length ? createPortal(
    <div className="df2-reading-current-meta">
      {currentMetaParts.map((part) => <span key={part}>{part}</span>)}
    </div>,
    currentMetaHost,
  ) : null;

  const historyPortal = historyHost && completedBooks.length ? createPortal(
    <section className="df2-reading-book-history" aria-label="Historie knih">
      <div className="df2-reading-book-history-head">
        <h3>Historie knih</h3>
        <span>{completedBooks.length}</span>
      </div>
      <div className="df2-reading-book-history-list">
        {completedBooks.map((book) => {
          const bookMetadata = metadataForBook(book, metadata);
          const details = [bookMetadata?.publisher, bookMetadata?.genre].filter((value): value is string => Boolean(value));
          return (
            <article key={book.id}>
              <div className="df2-reading-history-cover">
                {bookMetadata?.coverUrl
                  ? <img src={bookMetadata.coverUrl} alt={`Obálka knihy ${book.title}`} loading="lazy" />
                  : <i aria-hidden="true" />}
              </div>
              <div className="df2-reading-history-copy">
                <strong>{book.title}</strong>
                {bookMetadata?.author && <span className="df2-reading-history-author">{bookMetadata.author}</span>}
                <span>{readingSpan(book)} · {pageLabel(book.totalPages)}</span>
                {details.length > 0 && <small>{details.join(" · ")}</small>}
              </div>
            </article>
          );
        })}
      </div>
    </section>,
    historyHost,
  ) : null;

  const previewPortal = previewHost ? createPortal(
    <div className={`df2-reading-lookup-preview ${previewStatus}`} aria-live="polite">
      {previewStatus === "loading" && <span>Hledám obálku a údaje…</span>}
      {previewStatus === "found" && previewMetadata && (
        <>
          <div className="df2-reading-lookup-cover">
            {previewMetadata.coverUrl
              ? <img src={previewMetadata.coverUrl} alt="Nalezená obálka knihy" />
              : <i aria-hidden="true" />}
          </div>
          <div>
            <strong>Údaje nalezeny</strong>
            {previewMetadata.author && <span>{previewMetadata.author}</span>}
            {previewMetadata.publisher && <span>Vydavatel: {previewMetadata.publisher}</span>}
            {previewMetadata.genre && <span>Žánr: {previewMetadata.genre}</span>}
          </div>
        </>
      )}
      {previewStatus === "not-found" && <span>Obálku ani metadata se nepodařilo najít. Knihu můžeš uložit i tak.</span>}
      {previewStatus === "error" && <span>Metadata jsou teď nedostupná. Knihu můžeš uložit normálně.</span>}
    </div>,
    previewHost,
  ) : null;

  return <>{coverPortal}{currentMetaPortal}{historyPortal}{previewPortal}</>;
}
