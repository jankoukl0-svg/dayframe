from pathlib import Path

path = Path("web/app/google-calendar-controller.tsx")
text = path.read_text()

old = '            callback: (response: GoogleTokenResponse) => void;\n'
new = '            callback: (response: GoogleTokenResponse) => void;\n            error_callback?: (error: { type?: string; message?: string }) => void;\n'
if old in text:
    text = text.replace(old, new, 1)
elif new not in text:
    raise SystemExit("Token client error_callback type target not found")

start_marker = '  if (!event.start.dateTime) return [];\n'
end_marker = '}\n\nasync function fetchGoogleEvents'
start = text.find(start_marker)
end = text.find(end_marker, start)
if start < 0 or end < 0:
    raise SystemExit("Timed event normalization block not found")
replacement = '''  if (!event.start.dateTime) return [];
  const startDate = new Date(event.start.dateTime);
  if (Number.isNaN(startDate.getTime())) return [];
  const fallbackEnd = new Date(startDate.getTime() + 60 * 60 * 1000);
  const parsedEnd = event.end?.dateTime ? new Date(event.end.dateTime) : fallbackEnd;
  const endDate = Number.isNaN(parsedEnd.getTime()) || parsedEnd <= startDate ? fallbackEnd : parsedEnd;
  const startKey = dateKey(startDate);
  const endKey = dateKey(endDate);
  const result: CalendarEvent[] = [];
  let cursor = startKey;
  let dayIndex = 0;

  while (cursor <= endKey && dayIndex < 366) {
    const isFirstDay = cursor === startKey;
    const isLastDay = cursor === endKey;
    const segmentStart = isFirstDay ? startDate.getHours() * 60 + startDate.getMinutes() : 0;
    const segmentEnd = isLastDay ? endDate.getHours() * 60 + endDate.getMinutes() : DAY_END;
    if (segmentEnd > segmentStart) {
      result.push({
        id: `${id}-${cursor}`,
        title,
        date: cursor,
        allDay: false,
        startMinute: segmentStart,
        endMinute: segmentEnd,
        timeLabel: `${minutesLabel(segmentStart)}–${minutesLabel(segmentEnd)}`,
        htmlLink,
      });
    }
    if (isLastDay) break;
    cursor = addDaysKey(cursor, 1);
    dayIndex += 1;
  }
  return result;
'''
text = text[:start] + replacement + text[end:]

old = '''      .catch((cause: unknown) => {
        if (cancelled) return;
        if (cause instanceof Error && cause.message === "GOOGLE_AUTH_EXPIRED") {'''
new = '''      .catch((cause: unknown) => {
        if (cancelled) return;
        fetchedRangeRef.current = "";
        if (cause instanceof Error && cause.message === "GOOGLE_AUTH_EXPIRED") {'''
if old in text:
    text = text.replace(old, new, 1)
elif new not in text:
    raise SystemExit("Fetch retry target not found")

old = '''        client_id: clientId,
        scope: GOOGLE_SCOPE,
        callback: (response) => {'''
new = '''        client_id: clientId,
        scope: GOOGLE_SCOPE,
        error_callback: (oauthError) => {
          setConnecting(false);
          const closed = oauthError.type === "popup_closed";
          setError(closed
            ? "Připojení ke Google Kalendáři bylo zavřeno."
            : oauthError.message || "Google přihlášení se nepodařilo otevřít.");
        },
        callback: (response) => {'''
if old in text:
    text = text.replace(old, new, 1)
elif new not in text:
    raise SystemExit("OAuth error callback target not found")

path.write_text(text)
