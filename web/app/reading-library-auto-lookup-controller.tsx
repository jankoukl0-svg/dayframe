"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

type LookupStatus = "idle" | "loading" | "found" | "choose" | "not-found" | "error";

type OpenLibraryDoc = {
  key?: string;
  title?: string;
  author_name?: string[];
  cover_i?: number;
  publisher?: string[];
  subject?: string[];
  number_of_pages_median?: number;
};

type OpenLibraryResponse = { docs?: OpenLibraryDoc[] };
type EditionRecord = { number_of_pages?: number };
type EditionsResponse = { entries?: EditionRecord[] };

type GoogleVolume = {
  id?: string;
  volumeInfo?: {
    title?: string;
    authors?: string[];
    publisher?: string;
    categories?: string[];
    pageCount?: number;
    imageLinks?: {
      thumbnail?: string;
      smallThumbnail?: string;
    };
  };
};

type GoogleBooksResponse = { items?: GoogleVolume[] };

type BookLookup = {
  id: string;
  titleKey: string;
  title: string;
  author?: string;
  publisher?: string;
  genre?: string;
  coverUrl?: string;
  pages: number;
  score: number;
};

const lookupCache = new Map<string, Promise<BookLookup[]>>();

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function scoreTitle(candidateTitle: string | undefined, title: string) {
  const query = normalize(title);
  const candidate = normalize(candidateTitle || "");
  if (!candidate) return -1;
  if (candidate === query) return 1000;

  let score = 0;
  if (candidate.startsWith(query) || query.startsWith(candidate)) score += 180;
  if (candidate.includes(query) || query.includes(candidate)) score += 120;

  const queryWords = new Set(query.split(" ").filter(Boolean));
  const candidateWords = new Set(candidate.split(" ").filter(Boolean));
  for (const word of queryWords) if (candidateWords.has(word)) score += 28;
  score -= Math.abs(candidate.length - query.length) * 0.2;
  return score;
}

function pickGenre(subjects: string[] | undefined) {
  if (!subjects?.length) return undefined;
  const blocked = /accessible book|protected daisy|large type|juvenile literature|translations into|bibliography/i;
  const priority = /econom|finance|business|history|biograph|psycholog|philosoph|science|technology|fiction|fantasy|mystery|thriller|romance|self-help|politic|management|invest|marketing/i;
  return subjects.find((subject) => subject.length <= 48 && priority.test(subject) && !blocked.test(subject))
    ?? subjects.find((subject) => subject.length <= 48 && !blocked.test(subject));
}

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

function secureUrl(value: string | undefined) {
  return value?.replace(/^http:/, "https:");
}

async function pagesFromEditions(workKey: string | undefined) {
  if (!workKey?.startsWith("/works/")) return 0;
  const response = await fetch(`https://openlibrary.org${workKey}/editions.json?limit=50`, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) return 0;
  const payload = await response.json() as EditionsResponse;
  const pages = (Array.isArray(payload.entries) ? payload.entries : [])
    .map((entry) => Math.round(Number(entry.number_of_pages) || 0))
    .filter((count) => count >= 20 && count <= 5000);
  return median(pages);
}

async function fetchOpenLibraryCandidates(title: string): Promise<BookLookup[]> {
  const titleKey = normalize(title);
  const params = new URLSearchParams({
    title: title.trim(),
    fields: "key,title,author_name,cover_i,publisher,subject,number_of_pages_median",
    limit: "12",
  });
  const response = await fetch(`https://openlibrary.org/search.json?${params.toString()}`, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Open Library ${response.status}`);
  const payload = await response.json() as OpenLibraryResponse;
  const docs = (Array.isArray(payload.docs) ? payload.docs : [])
    .map((doc) => ({ doc, score: scoreTitle(doc.title, title) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 6);

  const candidates = await Promise.all(docs.map(async ({ doc, score }, index) => {
    let pages = Math.round(Number(doc.number_of_pages_median) || 0);
    if (pages < 1 && index < 3) pages = await pagesFromEditions(doc.key);
    if (pages < 1) return null;

    const coverId = Number(doc.cover_i);
    return {
      id: `ol:${doc.key || `${normalize(doc.title || title)}:${normalize(doc.author_name?.[0] || "")}`}`,
      titleKey,
      title: doc.title?.trim() || title.trim(),
      author: doc.author_name?.find(Boolean),
      publisher: doc.publisher?.find(Boolean),
      genre: pickGenre(doc.subject),
      coverUrl: Number.isFinite(coverId) && coverId > 0
        ? `https://covers.openlibrary.org/b/id/${coverId}-M.jpg?default=false`
        : undefined,
      pages,
      score,
    } satisfies BookLookup;
  }));

  return candidates.filter((candidate): candidate is BookLookup => Boolean(candidate));
}

async function fetchGoogleCandidates(title: string): Promise<BookLookup[]> {
  const titleKey = normalize(title);
  const params = new URLSearchParams({
    q: `intitle:${title.trim()}`,
    maxResults: "10",
    printType: "books",
    orderBy: "relevance",
  });
  const response = await fetch(`https://www.googleapis.com/books/v1/volumes?${params.toString()}`, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Google Books ${response.status}`);
  const payload = await response.json() as GoogleBooksResponse;

  return (Array.isArray(payload.items) ? payload.items : [])
    .map((volume) => {
      const info = volume.volumeInfo;
      const pages = Math.round(Number(info?.pageCount) || 0);
      const score = scoreTitle(info?.title, title);
      if (!info?.title || pages < 1 || score <= 0) return null;
      return {
        id: `google:${volume.id || `${normalize(info.title)}:${normalize(info.authors?.[0] || "")}`}`,
        titleKey,
        title: info.title.trim(),
        author: info.authors?.find(Boolean),
        publisher: info.publisher?.trim() || undefined,
        genre: info.categories?.find(Boolean),
        coverUrl: secureUrl(info.imageLinks?.thumbnail || info.imageLinks?.smallThumbnail),
        pages,
        score,
      } satisfies BookLookup;
    })
    .filter((candidate): candidate is BookLookup => Boolean(candidate));
}

function mergeCandidate(existing: BookLookup, next: BookLookup) {
  const preferred = next.score > existing.score ? next : existing;
  const fallback = preferred === next ? existing : next;
  return {
    ...preferred,
    author: preferred.author || fallback.author,
    publisher: preferred.publisher || fallback.publisher,
    genre: preferred.genre || fallback.genre,
    coverUrl: preferred.coverUrl || fallback.coverUrl,
    pages: preferred.pages || fallback.pages,
    score: Math.max(existing.score, next.score),
  };
}

async function fetchCandidates(title: string): Promise<BookLookup[]> {
  const responses = await Promise.allSettled([
    fetchOpenLibraryCandidates(title),
    fetchGoogleCandidates(title),
  ]);
  if (responses.every((result) => result.status === "rejected")) {
    throw new Error("Book databases unavailable");
  }

  const combined = responses.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  const unique = new Map<string, BookLookup>();
  for (const candidate of combined) {
    const key = `${normalize(candidate.title)}|${normalize(candidate.author || "")}`;
    const existing = unique.get(key);
    unique.set(key, existing ? mergeCandidate(existing, candidate) : candidate);
  }

  return [...unique.values()]
    .sort((left, right) => right.score - left.score || right.pages - left.pages)
    .slice(0, 6);
}

function lookupBooks(title: string) {
  const key = normalize(title);
  const existing = lookupCache.get(key);
  if (existing) return existing;
  const request = fetchCandidates(title).catch((error) => {
    lookupCache.delete(key);
    throw error;
  });
  lookupCache.set(key, request);
  return request;
}

function setReactInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (setter) setter.call(input, value);
  else input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function candidateDescription(candidate: BookLookup) {
  return [candidate.author, candidate.publisher, candidate.genre].filter(Boolean).join(" · ");
}

export function ReadingLibraryAutoLookupController() {
  const [form, setForm] = useState<HTMLFormElement | null>(null);
  const [titleInput, setTitleInput] = useState<HTMLInputElement | null>(null);
  const [pagesInput, setPagesInput] = useState<HTMLInputElement | null>(null);
  const [previewHost, setPreviewHost] = useState<HTMLElement | null>(null);
  const [title, setTitle] = useState("");
  const [status, setStatus] = useState<LookupStatus>("idle");
  const [match, setMatch] = useState<BookLookup | null>(null);
  const [candidates, setCandidates] = useState<BookLookup[]>([]);

  useEffect(() => {
    const sync = () => {
      const nextForm = document.querySelector<HTMLFormElement>(".df2-reading-library-add-form");
      if (!nextForm) {
        setForm(null);
        setTitleInput(null);
        setPagesInput(null);
        setPreviewHost(null);
        return;
      }
      setForm((current) => current === nextForm ? current : nextForm);

      const nextTitle = nextForm.querySelector<HTMLInputElement>(".df2-reading-library-add-grid label.wide input");
      const nextPages = nextForm.querySelector<HTMLInputElement>('input[type="number"]');
      setTitleInput((current) => current === nextTitle ? current : nextTitle);
      setPagesInput((current) => current === nextPages ? current : nextPages);

      const titleLabel = nextTitle?.closest("label") ?? null;
      if (!titleLabel) {
        setPreviewHost(null);
        return;
      }
      let host = nextForm.querySelector<HTMLElement>("[data-reading-library-auto-preview]");
      if (!host) {
        host = document.createElement("div");
        host.dataset.readingLibraryAutoPreview = "true";
        host.className = "df2-reading-library-auto-preview-host";
        titleLabel.insertAdjacentElement("afterend", host);
      }
      setPreviewHost((current) => current === host ? current : host);
      setTitle((current) => current === (nextTitle?.value ?? "") ? current : (nextTitle?.value ?? ""));
    };

    sync();
    const timer = window.setInterval(sync, 250);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!titleInput) return;
    const onInput = () => setTitle(titleInput.value);
    titleInput.addEventListener("input", onInput);
    return () => titleInput.removeEventListener("input", onInput);
  }, [titleInput]);

  useEffect(() => {
    const value = title.trim();
    setMatch(null);
    setCandidates([]);
    if (pagesInput) setReactInputValue(pagesInput, "");
    if (normalize(value).length < 2) {
      setStatus("idle");
      return;
    }

    let cancelled = false;
    setStatus("loading");
    const timer = window.setTimeout(() => {
      lookupBooks(value)
        .then((results) => {
          if (cancelled) return;
          if (!results.length) {
            setStatus("not-found");
            return;
          }

          setCandidates(results);
          const exact = results.filter((candidate) => normalize(candidate.title) === normalize(value));
          const automatic = exact.length === 1
            ? exact[0]
            : results.length === 1
              ? results[0]
              : null;

          if (automatic) {
            setMatch(automatic);
            setStatus("found");
            if (pagesInput) setReactInputValue(pagesInput, String(automatic.pages));
          } else {
            setStatus("choose");
          }
        })
        .catch(() => {
          if (cancelled) return;
          setStatus("error");
        });
    }, 420);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [title, pagesInput]);

  const selectCandidate = (candidate: BookLookup) => {
    setMatch(candidate);
    setStatus("found");
    if (pagesInput) setReactInputValue(pagesInput, String(candidate.pages));
  };

  const showChoices = () => {
    setMatch(null);
    setStatus("choose");
    if (pagesInput) setReactInputValue(pagesInput, "");
  };

  useEffect(() => {
    if (!form) return;
    const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (!submit) return;
    const ready = status === "found" && Boolean(match?.pages);
    submit.disabled = !ready;
    submit.setAttribute("aria-disabled", String(!ready));
    return () => {
      submit.disabled = false;
      submit.removeAttribute("aria-disabled");
    };
  }, [form, status, match]);

  useEffect(() => {
    if (!form) return;
    const onSubmit = (event: SubmitEvent) => {
      const currentTitle = titleInput?.value.trim() ?? "";
      const currentPages = Math.round(Number(pagesInput?.value) || 0);
      if (status === "found" && match && match.titleKey === normalize(currentTitle) && currentPages > 0) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    form.addEventListener("submit", onSubmit, true);
    return () => form.removeEventListener("submit", onSubmit, true);
  }, [form, titleInput, pagesInput, status, match]);

  const description = useMemo(() => match ? candidateDescription(match) : "", [match]);

  if (!previewHost) return null;

  return createPortal(
    <div className={`df2-reading-library-auto-preview ${status}`} aria-live="polite">
      {status === "idle" && <span className="df2-reading-library-auto-hint">Stačí napsat název. Zbytek doplníme automaticky.</span>}
      {status === "loading" && <span className="df2-reading-library-auto-hint">Hledám knihu ve více databázích…</span>}
      {status === "not-found" && <span className="df2-reading-library-auto-error">Knihu nebo spolehlivý počet stran se nepodařilo dohledat. Zkus přesnější název.</span>}
      {status === "error" && <span className="df2-reading-library-auto-error">Databáze knih jsou teď nedostupné. Zkus to za chvíli znovu.</span>}
      {status === "choose" && (
        <div className="df2-reading-library-auto-choices">
          <span className="df2-reading-library-auto-choice-label">Našel jsem více možností. Vyber správnou knihu:</span>
          <div className="df2-reading-library-auto-choice-list">
            {candidates.map((candidate) => {
              const detail = candidateDescription(candidate);
              return (
                <button key={candidate.id} type="button" className="df2-reading-library-auto-choice" onClick={() => selectCandidate(candidate)}>
                  <span className="df2-reading-library-auto-cover" aria-hidden="true">
                    {candidate.coverUrl ? <img src={candidate.coverUrl} alt="" loading="lazy" decoding="async" /> : <span />}
                  </span>
                  <span className="df2-reading-library-auto-choice-copy">
                    <strong>{candidate.title}</strong>
                    {detail && <small>{detail}</small>}
                    <b>{candidate.pages.toLocaleString("cs-CZ")} stran</b>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
      {status === "found" && match && (
        <div>
          <div className="df2-reading-library-auto-match">
            <div className="df2-reading-library-auto-cover" aria-hidden="true">
              {match.coverUrl ? <img src={match.coverUrl} alt="" loading="lazy" decoding="async" /> : <span />}
            </div>
            <div>
              <span>Nalezeno</span>
              <strong>{match.title}</strong>
              {description && <small>{description}</small>}
              <b>{match.pages.toLocaleString("cs-CZ")} stran</b>
            </div>
          </div>
          {candidates.length > 1 && (
            <button type="button" className="df2-reading-library-auto-other" onClick={showChoices}>Jiná kniha</button>
          )}
        </div>
      )}
    </div>,
    previewHost,
  );
}
