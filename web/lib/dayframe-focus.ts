export type FocusSession = {
  taskId: string | null;
  title: string;
  category: string;
  totalSeconds: number;
  remainingSeconds: number;
  endsAt: number | null;
  mode: "work" | "break";
  workRemaining?: number;
};
export const FOCUS_KEY = "dayframe-focus-v1";
export function focusRemaining(session: FocusSession | null, now: number) {
  if (!session) return 0;
  return session.endsAt === null ? session.remainingSeconds : Math.max(0, Math.ceil((session.endsAt - now) / 1000));
}
export function pauseFocus(session: FocusSession, now: number): FocusSession {
  return { ...session, remainingSeconds: focusRemaining(session, now), endsAt: null };
}
export function readFocus(raw: string | null): FocusSession | null {
  try {
    const s = JSON.parse(raw ?? "null");
    if (!s || !(s.taskId === null || typeof s.taskId === "string") || typeof s.title !== "string" || typeof s.category !== "string" || !Number.isFinite(s.totalSeconds) || s.totalSeconds < 1 || !Number.isFinite(s.remainingSeconds) || s.remainingSeconds < 0 || !(s.endsAt === null || Number.isFinite(s.endsAt)) || !["work", "break"].includes(s.mode)) return null;
    return s;
  } catch { return null; }
}

export function extendFocus(session: FocusSession, now: number): FocusSession {
  const seconds = focusRemaining(session, now) + 600;
  return { ...session, totalSeconds: session.totalSeconds + 600, remainingSeconds: seconds, endsAt: now + seconds * 1000 };
}
export function breakFocus(session: FocusSession, now: number): FocusSession {
  return { ...session, mode: "break", workRemaining: focusRemaining(session, now), totalSeconds: 300, remainingSeconds: 300, endsAt: now + 300000 };
}
export function resumeWork(session: FocusSession, now: number): FocusSession {
  const seconds = session.workRemaining && session.workRemaining > 0 ? session.workRemaining : 1500;
  return { ...session, mode: "work", workRemaining: undefined, totalSeconds: seconds, remainingSeconds: seconds, endsAt: now + seconds * 1000 };
}
