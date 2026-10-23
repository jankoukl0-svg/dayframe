/**
 * A book at its final page is completed, regardless of whether the progress
 * came from the reading editor, a reading session, or older saved data.
 * Keep the legacy "current" slot and the extra "reading" list compatible.
 */
export type ReadingProgressBook = {
  id: string;
  title: string;
  currentPage: number;
  totalPages: number;
  startedAt: string;
  finishedAt?: string;
};

export type ReadingProgressLibrary = {
  current?: ReadingProgressBook | null;
  reading?: ReadingProgressBook[];
  completed?: ReadingProgressBook[];
};

export function completeFullyReadBooks<T extends ReadingProgressLibrary>(
  library: T,
  finishedAt: string,
): T {
  const active = [
    ...(library.current ? [library.current] : []),
    ...(Array.isArray(library.reading) ? library.reading : []),
  ];
  const finished = active.filter((book) =>
    Number.isFinite(book.currentPage)
    && Number.isFinite(book.totalPages)
    && book.totalPages > 0
    && book.currentPage >= book.totalPages
  );
  if (!finished.length) return library;

  const remaining = active.filter((book) => !finished.includes(book));
  const completed = Array.isArray(library.completed) ? [...library.completed] : [];
  const seen = new Set(completed.map((book) => book.id));
  for (const book of finished) {
    if (seen.has(book.id)) continue;
    completed.push({ ...book, currentPage: book.totalPages, finishedAt: book.finishedAt || finishedAt });
    seen.add(book.id);
  }
  return {
    ...library,
    current: remaining[0] ?? null,
    reading: remaining.slice(1),
    completed,
  };
}
