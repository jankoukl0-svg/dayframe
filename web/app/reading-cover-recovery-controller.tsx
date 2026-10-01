"use client";

import { useEffect, useRef } from "react";

type ReadingBook = {
  id: string;
  title: string;
};

type ReadingLibrary = {
  current?: ReadingBook | null;
  completed?: ReadingBook[];
};

type BookMetadata = {
  titleKey?: string;
  coverUrl?: string;
  fetchedAt?: string;
  [key: string]: unknown;
};

type MetadataStore = Record<string, BookMetadata>;

type OpenLibraryDoc = {
  title?: string;
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

function writeCover(book: ReadingBook, coverUrl?: string) {
  const store = readMetadata();
  const existing = store[book.id] ?? {};
  const next = { ...existing, titleKey: normalize(book.title) } as BookMetadata;
  if (coverUrl) next.coverUrl = coverUrl;
  else delete next.coverUrl;
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

async function lookupCoverCandidates(title: string) {
  const params = new URLSearchParams({
    title: title.trim(),
    fields: "title,cover_i,cover_edition_key,isbn",
    limit: "10",
  });
  const response = await fetch(`https://openlibrary.org/search.json?${params.toString()}`, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Open Library ${response.status}`);
  const payload = await response.json() as OpenLibraryResponse;
  const docs = Array.isArray(payload.docs) ? payload.docs : [];
  const best = [...docs].sort((left, right) => scoreDoc(right, title) - scoreDoc(left, title))[0];
  if (!best || scoreDoc(best, title) < 1) return [];

  const urls: string[] = [];
  if (best.cover_edition_key) {
    urls.push(`https://covers.openlibrary.org/b/olid/${encodeURIComponent(best.cover_edition_key)}-M.jpg?default=false`);
  }
  for (const isbn of best.isbn?.slice(0, 4) ?? []) {
    if (isbn) urls.push(`https://covers.openlibrary.org/b/isbn/${encodeURIComponent(isbn)}-M.jpg?default=false`);
  }
  const coverId = Number(best.cover_i);
  if (Number.isFinite(coverId) && coverId > 0) {
    urls.push(`https://covers.openlibrary.org/b/id/${coverId}-M.jpg?default=false`);
  }
  return [...new Set(urls)];
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
  const candidates = await lookupCoverCandidates(book.title);
  for (const candidate of candidates) {
    if (candidate === failedUrl) continue;
    if (await imageLoads(candidate)) {
      writeCover(book, candidate);
      return true;
    }
  }
  writeCover(book, undefined);
  return false;
}

function findBookForImage(image: HTMLImageElement, library: ReadingLibrary) {
  if (image.closest(".df2-reading-real-cover-host")) return library.current ?? null;
  const article = image.closest(".df2-reading-book-history-list article");
  const title = article?.querySelector<HTMLElement>(".df2-reading-history-copy > strong")?.textContent?.trim();
  if (!title) return null;
  return (library.completed ?? []).find((book) => book.title === title) ?? null;
}

export function ReadingCoverRecoveryController() {
  const recovering = useRef(new Set<string>());

  useEffect(() => {
    const attempt = (image: HTMLImageElement) => {
      const library = readLibrary();
      const book = findBookForImage(image, library);
      if (!book || recovering.current.has(book.id)) return;
      recovering.current.add(book.id);
      const failedUrl = image.currentSrc || image.src;
      recoverBookCover(book, failedUrl)
        .catch(() => {
          // Keep the existing metadata if the lookup service itself is unavailable.
        })
        .finally(() => recovering.current.delete(book.id));
    };

    const attach = (image: HTMLImageElement) => {
      if (image.dataset.readingCoverRecoveryAttached === "true") return;
      image.dataset.readingCoverRecoveryAttached = "true";
      image.addEventListener("error", () => attempt(image), { once: true });
      if (image.complete && image.naturalWidth === 0) attempt(image);
    };

    const scan = () => {
      document
        .querySelectorAll<HTMLImageElement>(".df2-reading-real-cover-host img, .df2-reading-book-history-cover img")
        .forEach(attach);
    };

    scan();
    const timer = window.setInterval(scan, 350);
    return () => window.clearInterval(timer);
  }, []);

  return null;
}
