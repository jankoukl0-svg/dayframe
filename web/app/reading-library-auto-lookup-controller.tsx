"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

type LookupStatus = "idle" | "loading" | "found" | "not-found" | "error";

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

type BookLookup = {
  titleKey: string;
  title: string;
  author?: string;
  publisher?: string;
  genre?: string;
  coverUrl?: string;
  pages: number;
};

const lookupCache = new Map<string, Promise<BookLookup | null>>();

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
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

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
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

async function fetchBook(title: string): Promise<BookLookup | null> {
  const titleKey = normalize(title);
  if (!titleKey) return null;
  const params = new URLSearchParams({
    title: title.trim(),
    fields: "key,title,author_name,cover_i,publisher,subject,number_of_pages_median",
    limit: "10",
  });
  const response = await fetch(`https://openlibrary.org/search.json?${params.toString()}`, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Open Library ${response.status}`);
  const payload = await response.json() as OpenLibraryResponse;
  const docs = Array.isArray(payload.docs) ? payload.docs : [];
  const best = [...docs].sort((left, right) => scoreDoc(right, title) - scoreDoc(left, title))[0];
  if (!best || scoreDoc(best, title) < 1) return null;

  let pages = Math.round(Number(best.number_of_pages_median) || 0);
  if (pages < 1) pages = await pagesFromEditions(best.key);
  if (pages < 1) return null;

  const coverId = Number(best.cover_i);
  return {
    titleKey,
    title: best.title?.trim() || title.trim(),
    author: best.author_name?.find(Boolean),
    publisher: best.publisher?.find(Boolean),
    genre: pickGenre(best.subject),
    coverUrl: Number.isFinite(coverId) && coverId > 0
      ? `https://covers.openlibrary.org/b/id/${coverId}-M.jpg?default=false`
      : undefined,
    pages,
  };
}

function lookupBook(title: string) {
  const key = normalize(title);
  const existing = lookupCache.get(key);
  if (existing) return existing;
  const request = fetchBook(title).catch((error) => {
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

export function ReadingLibraryAutoLookupController() {
  const [form, setForm] = useState<HTMLFormElement | null>(null);
  const [titleInput, setTitleInput] = useState<HTMLInputElement | null>(null);
  const [pagesInput, setPagesInput] = useState<HTMLInputElement | null>(null);
  const [previewHost, setPreviewHost] = useState<HTMLElement | null>(null);
  const [title, setTitle] = useState("");
  const [status, setStatus] = useState<LookupStatus>("idle");
  const [match, setMatch] = useState<BookLookup | null>(null);

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
    if (pagesInput) setReactInputValue(pagesInput, "");
    if (normalize(value).length < 2) {
      setStatus("idle");
      return;
    }

    let cancelled = false;
    setStatus("loading");
    const timer = window.setTimeout(() => {
      lookupBook(value)
        .then((result) => {
          if (cancelled) return;
          if (!result) {
            setStatus("not-found");
            return;
          }
          setMatch(result);
          setStatus("found");
          if (pagesInput) setReactInputValue(pagesInput, String(result.pages));
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

  const description = useMemo(() => {
    if (!match) return "";
    return [match.author, match.publisher, match.genre].filter(Boolean).join(" · ");
  }, [match]);

  if (!previewHost) return null;

  return createPortal(
    <div className={`df2-reading-library-auto-preview ${status}`} aria-live="polite">
      {status === "idle" && <span className="df2-reading-library-auto-hint">Stačí napsat název. Zbytek doplníme automaticky.</span>}
      {status === "loading" && <span className="df2-reading-library-auto-hint">Hledám knihu…</span>}
      {status === "not-found" && <span className="df2-reading-library-auto-error">Knihu nebo spolehlivý počet stran se nepodařilo dohledat. Zkus přesnější název.</span>}
      {status === "error" && <span className="df2-reading-library-auto-error">Databáze knih je teď nedostupná. Zkus to za chvíli znovu.</span>}
      {status === "found" && match && (
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
      )}
    </div>,
    previewHost,
  );
}
