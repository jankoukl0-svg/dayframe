"use client";

import { useEffect, useRef } from "react";

type ReadingBook = {
  id: string;
  title: string;
  finishedAt?: string;
};

type ReadingLibrary = {
  current?: ReadingBook | null;
  reading?: ReadingBook[];
  completed?: ReadingBook[];
};

type BookMetadata = {
  titleKey?: string;
  coverUrl?: string;
  author?: string;
  fetchedAt?: string;
  [key: string]: unknown;
};

type MetadataStore = Record<string, BookMetadata>;

type OpenLibraryDoc = {
  title?: string;
  author_name?: string[];
  cover_i?: number;
  cover_edition_key?: string;
  isbn?: string[];
};

type OpenLibraryResponse = { docs?: OpenLibraryDoc[] };

const LIBRARY_KEY = "dayframe-reading-library-v1";
const METADATA_KEY = "dayframe-reading-book-metadata-v1";
const METADATA_SYNC_EVENT = "dayframe-reading-book-metadata-sync";

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function readLibrary(): ReadingLibrary {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(LIBRARY_KEY) || "{}") as ReadingLibrary;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function readMetadata(): MetadataStore {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(METADATA_KEY) || "{}") as MetadataStore;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeCover(book: ReadingBook, coverUrl: string | undefined, failedUrl?: string) {
  const library = readLibrary();
  const stillPresent = [library.current, ...(library.reading ?? []), ...(library.completed ?? [])]
    .some((item) => item?.id === book.id && normalize(item.title) === normalize(book.title));
  if (!stillPresent) return;
  const store = readMetadata();
  const existing = store[book.id] ?? {};
  if (existing.coverUrl && existing.coverUrl !== failedUrl) return;
  if (!coverUrl && !existing.coverUrl) return;
  const next = { ...existing, titleKey: normalize(book.title) } as BookMetadata;
  if (coverUrl) {
    next.coverUrl = coverUrl;
    next.notFound = false;
    next.fetchedAt ??= new Date().toISOString();
  } else {
    delete next.coverUrl;
  }
  store[book.id] = next;
  window.localStorage.setItem(METADATA_KEY, JSON.stringify(store));
  window.dispatchEvent(new Event(METADATA_SYNC_EVENT));
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
  return score - Math.abs(candidate.length - query.length) * 0.15;
}

async function lookupCoverCandidates(title: string, author?: string) {
  const params = new URLSearchParams({
    title: title.trim(),
    fields: "title,author_name,cover_i,cover_edition_key,isbn",
    limit: "20",
  });
  const response = await fetch(`https://openlibrary.org/search.json?${params.toString()}`, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Open Library ${response.status}`);
  const payload = await response.json() as OpenLibraryResponse;
  const docs = Array.isArray(payload.docs) ? payload.docs : [];
  const authorKey = normalize(author || "");
  const matching = docs
    .filter((doc) => scoreDoc(doc, title) >= 100)
    .sort((left, right) => {
      const rank = (doc: OpenLibraryDoc) => {
        const authorMatch = authorKey && doc.author_name?.some((name) => normalize(name) === authorKey);
        return scoreDoc(doc, title) + (authorMatch ? 500 : 0);
      };
      return rank(right) - rank(left);
    });

  // An exact-title result can lack a cover even when a different edition has one.
  const urls: string[] = [];
  for (const doc of matching) {
    if (doc.cover_edition_key) {
      urls.push(`https://covers.openlibrary.org/b/olid/${encodeURIComponent(doc.cover_edition_key)}-M.jpg?default=false`);
    }
    const coverId = Number(doc.cover_i);
    if (Number.isFinite(coverId) && coverId > 0) {
      urls.push(`https://covers.openlibrary.org/b/id/${coverId}-M.jpg?default=false`);
    }
    for (const isbn of doc.isbn?.slice(0, 2) ?? []) {
      if (isbn) urls.push(`https://covers.openlibrary.org/b/isbn/${encodeURIComponent(isbn)}-M.jpg?default=false`);
    }
  }
  return [...new Set(urls)].slice(0, 12);
}

function imageLoads(url: string) {
  return new Promise<boolean>((resolve) => {
    const image = new Image();
    let settled = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      image.onload = null;
      image.onerror = null;
      resolve(value);
    };
    const timer = window.setTimeout(() => finish(false), 7000);
    image.onload = () => finish(image.naturalWidth > 0);
    image.onerror = () => finish(false);
    image.src = url;
  });
}

async function recoverBookCover(book: ReadingBook, failedUrl: string | undefined) {
  const metadata = readMetadata()[book.id];
  const candidates = await lookupCoverCandidates(book.title, metadata?.author);
  for (const candidate of candidates) {
    if (candidate === failedUrl) continue;
    if (await imageLoads(candidate)) {
      writeCover(book, candidate, failedUrl);
      return true;
    }
  }
  // Only remove a demonstrably broken existing URL, never other book metadata.
  if (failedUrl) writeCover(book, undefined, failedUrl);
  return false;
}

function findBookForImage(image: HTMLImageElement, library: ReadingLibrary) {
  // Every active book now has its own card and its own cover image.
  const activeCard = image.closest<HTMLElement>("[data-reading-active-book]");
  if (activeCard) {
    const bookId = activeCard.dataset.readingActiveBook;
    return [library.current, ...(Array.isArray(library.reading) ? library.reading : [])]
      .find((book) => book?.id === bookId) ?? null;
  }

  const article = image.closest<HTMLElement>(".df2-reading-book-history-list article");
  const list = article?.parentElement;
  if (!article || !list) return null;
  const articles = [...list.querySelectorAll<HTMLElement>(":scope > article")];
  const index = articles.indexOf(article);
  if (index < 0) return null;
  const completed = [...(library.completed ?? [])]
    .sort((left, right) => (right.finishedAt || "").localeCompare(left.finishedAt || ""));
  return completed[index] ?? null;
}

export function ReadingCoverRecoveryController() {
  const recovering = useRef(new Set<string>());
  const retryAfter = useRef(new Map<string, number>());

  useEffect(() => {
    const attemptBook = (book: ReadingBook, failedUrl?: string) => {
      const now = Date.now();
      if (recovering.current.has(book.id) || (retryAfter.current.get(book.id) ?? 0) > now) return;
      // Avoid repeated Open Library requests on every 350 ms UI scan.
      retryAfter.current.set(book.id, now + 15 * 60_000);
      recovering.current.add(book.id);
      recoverBookCover(book, failedUrl)
        .catch(() => {
          // A temporary network/API failure can be retried without a page reload.
          retryAfter.current.set(book.id, Date.now() + 60_000);
        })
        .finally(() => recovering.current.delete(book.id));
    };

    const attempt = (image: HTMLImageElement) => {
      const book = findBookForImage(image, readLibrary());
      if (book) attemptBook(book, image.currentSrc || image.src);
    };

    const attach = (image: HTMLImageElement) => {
      if (image.dataset.readingCoverRecoveryAttached !== "true") {
        image.dataset.readingCoverRecoveryAttached = "true";
        image.addEventListener("error", () => attempt(image), { once: true });
      }
      // A failed <img> survives temporary HTTP/network errors. Keep checking it
      // after the backoff; its one-shot error listener cannot fire a second time.
      if (image.complete && image.naturalWidth === 0) attempt(image);
    };

    const scan = () => {
      document
        .querySelectorAll<HTMLImageElement>("[data-reading-active-book] .df2-reading-book-cover img, .df2-reading-book-history-cover img")
        .forEach(attach);

      // Previously, recovery only listened to <img> errors. Once a failed cover
      // had been removed (or Open Library returned metadata without a cover),
      // no <img> existed, so the placeholder could never recover.
      const library = readLibrary();
      const metadata = readMetadata();
      document.querySelectorAll<HTMLElement>("[data-reading-active-book]").forEach((card) => {
        if (card.querySelector(".df2-reading-book-cover img")) return;
        const book = [library.current, ...(library.reading ?? [])]
          .find((item) => item?.id === card.dataset.readingActiveBook);
        if (!book) return;
        const entry = metadata[book.id];
        if (!entry || entry.titleKey !== normalize(book.title) || entry.coverUrl) return;
        attemptBook(book);
      });
    };

    scan();
    const timer = window.setInterval(scan, 350);
    return () => window.clearInterval(timer);
  }, []);

  return null;
}
