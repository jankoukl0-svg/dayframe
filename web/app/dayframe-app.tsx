"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { localDateKey, planCapturedTasks, type InboxTask, type Priority, type Task } from "@/lib/dayframe-planning";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type View = "today" | "inbox" | "focus" | "milestones" | "settings";
type Milestone = { id: number; title: string; date: string; note: string };
type TaskSeed = Omit<Task, "id" | "completed">;
type TaskEditDraft = {
  title: string;
  duration: string;
  deadline: string;
  priority: Priority;
  category: string;
  fixed: boolean;
  start: string;
  end: string;
};

const plans: Record<number, TaskSeed[]> = {
  0: [
    { title: "Naplánovat další týden", start: "14:00", end: "14:30", category: "Plánování" },
    { title: "VŠE English test", start: "15:00", end: "16:00", category: "VŠE AJ", fixed: true },
    { title: "Čtení knihy", start: "22:40", end: "23:00", category: "Rutina", fixed: true },
  ],
  1: [
    { title: "CFI / Excel", start: "10:00", end: "11:30", category: "Finance" },
    { title: "Matematika", start: "12:00", end: "13:00", category: "Matika" },
    { title: "Běžná angličtina", start: "14:00", end: "15:00", category: "Angličtina" },
    { title: "VŠE English test", start: "15:00", end: "16:00", category: "VŠE AJ", fixed: true },
    { title: "Čtení knihy", start: "22:40", end: "23:00", category: "Rutina", fixed: true },
  ],
  2: [
    { title: "Ekonomie z učebnice", start: "10:00", end: "11:30", category: "Ekonomie" },
    { title: "Běžná angličtina", start: "12:00", end: "13:00", category: "Angličtina" },
    { title: "CFI / Excel", start: "14:00", end: "15:00", category: "Finance" },
    { title: "Čtení knihy", start: "22:40", end: "23:00", category: "Rutina", fixed: true },
  ],
  3: [
    { title: "Matematika", start: "10:00", end: "11:30", category: "Matika" },
    { title: "CFI / Excel", start: "12:00", end: "13:00", category: "Finance" },
    { title: "Běžná angličtina", start: "14:00", end: "15:00", category: "Angličtina" },
    { title: "VŠE English test", start: "15:00", end: "16:00", category: "VŠE AJ", fixed: true },
    { title: "Čtení knihy", start: "22:40", end: "23:00", category: "Rutina", fixed: true },
  ],
  4: [
    { title: "Ekonomie z učebnice", start: "10:00", end: "11:30", category: "Ekonomie" },
    { title: "Matematika", start: "12:00", end: "13:00", category: "Matika" },
    { title: "Běžná angličtina", start: "14:00", end: "15:00", category: "Angličtina" },
    { title: "Čtení knihy", start: "22:40", end: "23:00", category: "Rutina", fixed: true },
  ],
  5: [
    { title: "CFI / Excel", start: "10:00", end: "11:30", category: "Finance" },
    { title: "Ekonomie z učebnice", start: "12:00", end: "13:00", category: "Ekonomie" },
    { title: "Opakování týdne", start: "14:00", end: "15:00", category: "Opakování" },
    { title: "VŠE English test", start: "15:00", end: "16:00", category: "VŠE AJ", fixed: true },
    { title: "Čtení knihy", start: "22:40", end: "23:00", category: "Rutina", fixed: true },
  ],
  6: [
    { title: "Dohnat resty týdne", start: "10:00", end: "11:00", category: "Flex blok" },
    { title: "Běžná angličtina", start: "12:00", end: "13:00", category: "Angličtina" },
    { title: "Čtení knihy", start: "22:40", end: "23:00", category: "Rutina", fixed: true },
  ],
};

const initialMilestones: Milestone[] = [
  { id: 1, title: "Přijímací zkouška VŠE", date: "2027-04-05", note: "Hlavní termín" },
  { id: 2, title: "Dokončit CFI Excel", date: "2026-10-31", note: "Kurz a certifikát" },
  { id: 3, title: "Začít přípravu SCIO", date: "2026-11-15", note: "Nový studijní blok" },
];

const navigation: Array<{ id: View; label: string; mobileLabel: string; shortcut: string }> = [
  { id: "today", label: "Dnes", mobileLabel: "Dnes", shortcut: "1" },
  { id: "inbox", label: "Přidat úkol", mobileLabel: "+ Úkol", shortcut: "2" },
  { id: "focus", label: "Soustředění", mobileLabel: "Focus", shortcut: "3" },
  { id: "milestones", label: "Milníky", mobileLabel: "Termíny", shortcut: "4" },
  { id: "settings", label: "Nastavení", mobileLabel: "Více", shortcut: "5" },
];

const viewTitles: Record<View, string> = {
  today: "Dnešní plán",
  inbox: "Naplánovat úkol",
  focus: "Soustředění",
  milestones: "Milníky",
  settings: "Nastavení",
};

function formatRemaining(ms: number) {
  const safe = Math.max(0, ms);
  return {
    h: Math.floor(safe / 3_600_000),
    m: Math.floor((safe % 3_600_000) / 60_000),
    s: Math.floor((safe % 60_000) / 1000),
  };
}

function minutesBetween(start: string, end: string) {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  return eh * 60 + em - (sh * 60 + sm);
}

function timeToMinutes(time: string) {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

function minutesToTime(total: number) {
  const safe = Math.max(0, Math.min(23 * 60 + 59, total));
  return `${Math.floor(safe / 60).toString().padStart(2, "0")}:${(safe % 60).toString().padStart(2, "0")}`;
}

function roundToQuarter(minutes: number) {
  return Math.ceil(minutes / 15) * 15;
}

function priorityRank(priority: Priority | undefined) {
  return priority === "high" ? 0 : priority === "low" ? 2 : 1;
}

function scheduleFlexibleTasks(items: Task[], currentTime: Date) {
  const dayStart = 10 * 60;
  const dayCutoff = 22 * 60 + 30;
  const from = Math.max(dayStart, roundToQuarter(currentTime.getHours() * 60 + currentTime.getMinutes()));
  const occupied = items
    .filter((task) => task.fixed || task.completed)
    .map((task) => ({ start: timeToMinutes(task.start), end: timeToMinutes(task.end) }));
  occupied.push({ start: 13 * 60, end: 14 * 60 });
  const flexible = items
    .filter((task) => !task.fixed && !task.completed)
    .sort((a, b) => {
      const priorityDifference = priorityRank(a.priority) - priorityRank(b.priority);
      if (priorityDifference) return priorityDifference;
      return (a.deadline ?? "22:30").localeCompare(b.deadline ?? "22:30");
    });

  const updates = new Map<number, Task>();
  const unplacedIds: number[] = [];
  let lateCount = 0;

  flexible.forEach((task) => {
    const duration = Math.max(15, task.duration ?? minutesBetween(task.start, task.end));
    const requestedDeadline = Math.min(dayCutoff, timeToMinutes(task.deadline ?? "22:30"));
    const earliestStart = Math.max(from, task.notBefore ? timeToMinutes(task.notBefore) : from);
    const findSlot = (limit: number) => {
      for (let candidate = earliestStart; candidate + duration <= limit; candidate += 15) {
        const collision = occupied.some((block) => candidate < block.end && candidate + duration > block.start);
        if (!collision) return candidate;
      }
      return null;
    };

    let start = findSlot(requestedDeadline);
    let late = false;
    if (start === null) {
      start = findSlot(dayCutoff);
      late = true;
    }

    if (start === null) {
      updates.set(task.id, { ...task, late: true });
      unplacedIds.push(task.id);
      lateCount += 1;
      return;
    }

    occupied.push({ start, end: start + duration });
    occupied.sort((a, b) => a.start - b.start);
    updates.set(task.id, {
      ...task,
      start: minutesToTime(start),
      end: minutesToTime(start + duration),
      duration,
      autoScheduled: true,
      late,
    });
    if (late) lateCount += 1;
  });

  return {
    tasks: items
      .map((task) => updates.get(task.id) ?? task)
      .sort((a, b) => a.start.localeCompare(b.start)),
    lateCount,
    unplacedIds,
  };
}

function daysUntil(date: string, now: Date) {
  const target = new Date(`${date}T00:00:00`);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.max(0, Math.ceil((target.getTime() - today.getTime()) / 86_400_000));
}

function formatDate(date: string) {
  return new Intl.DateTimeFormat("cs-CZ", { day: "numeric", month: "long", year: "numeric" }).format(
    new Date(`${date}T00:00:00`),
  );
}

function nextDate(date: Date) {
  const result = new Date(date);
  result.setDate(result.getDate() + 1);
  return result;
}

function makeTasksForDate(date: Date) {
  return (plans[date.getDay()] ?? []).map((task, index) => ({
    ...task,
    id: Number(`${date.getDay() + 1}${index + 1}`),
    completed: false,
    duration: minutesBetween(task.start, task.end),
    deadline: task.fixed ? task.end : "22:30",
    priority: "normal" as Priority,
    autoScheduled: false,
  }));
}

function makeDayTasks() {
  return makeTasksForDate(new Date());
}

function migrateSavedTasks(savedTasks: Task[] | undefined) {
  const fresh = makeDayTasks();
  if (!savedTasks?.length) return fresh;

  const scheduledTitles = new Set(fresh.map((task) => task.title));
  const savedByTitle = new Map(savedTasks.map((task) => [task.title, task]));
  const schedule = fresh.map((task) => ({
    ...task,
    completed: savedByTitle.get(task.title)?.completed ?? false,
  }));
  const custom = savedTasks
    .filter((task) => !scheduledTitles.has(task.title))
    .map((task) => ({
      ...task,
      fixed: false,
      duration: task.duration ?? Math.max(15, minutesBetween(task.start, task.end)),
      deadline: task.deadline ?? "22:30",
      priority: task.priority ?? ("normal" as Priority),
    }));
  return [...schedule, ...custom].sort((a, b) => a.start.localeCompare(b.start));
}

function preserveCustomTasks(items: Task[]): InboxTask[] {
  return items.filter((task) => task.id > 1000 && !task.completed).map((task) => ({
    id: task.id, title: task.title, duration: task.duration ?? minutesBetween(task.start, task.end),
    priority: task.priority ?? "normal", category: task.category,
    deadline: task.deadline ?? "22:30", createdAt: new Date(task.id).toISOString(),
  }));
}

export function DayframeApp() {
  const [activeView, setActiveView] = useState<View>("today");
  const [now, setNow] = useState(new Date());
  const [tasks, setTasks] = useState<Task[]>([]);
  const [inboxTasks, setInboxTasks] = useState<InboxTask[]>([]);
  const [tomorrowTasks, setTomorrowTasks] = useState<Task[]>([]);
  const [planDate, setPlanDate] = useState(() => localDateKey(new Date()));
  const [milestones, setMilestones] = useState(initialMilestones);
  const [hydrated, setHydrated] = useState(false);
  const [focusSeconds, setFocusSeconds] = useState(50 * 60);
  const [focusRunning, setFocusRunning] = useState(false);
  const [strictMode, setStrictMode] = useState(true);
  const [notifications, setNotifications] = useState(true);
  const [milestoneDialog, setMilestoneDialog] = useState(false);
  const [intentDialog, setIntentDialog] = useState(false);
  const [dismissedOverdueKeys, setDismissedOverdueKeys] = useState<string[]>([]);
  const [captureTask, setCaptureTask] = useState<{
    title: string;
    duration: string;
    priority: Priority;
    category: string;
    when: "auto" | "today" | "tomorrow";
    deadline: string;
  }>({ title: "", duration: "45", priority: "normal", category: "Studium", when: "auto", deadline: "22:30" });
  const [planningNotice, setPlanningNotice] = useState<{
    id: number;
    title: string;
    day: "today" | "tomorrow" | "waiting";
    start?: string;
    end?: string;
  } | null>(null);
  const [editingCaptureId, setEditingCaptureId] = useState<number | null>(null);
  const captureInputRef = useRef<HTMLInputElement>(null);
  const [editingTaskId, setEditingTaskId] = useState<number | null>(null);
  const [editingDay, setEditingDay] = useState<"today" | "tomorrow">("today");
  const [editError, setEditError] = useState("");
  const [editTask, setEditTask] = useState<TaskEditDraft>({
    title: "",
    duration: "45",
    deadline: "22:30",
    priority: "normal",
    category: "Studium",
    fixed: false,
    start: "16:00",
    end: "16:45",
  });
  const [newMilestone, setNewMilestone] = useState({ title: "", date: "2027-04-05" });
  const focusRef = useRef<number | null>(null);
  const currentDateKey = localDateKey(now);
  const planningMinute = now.getHours() * 60 + now.getMinutes();

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("dayframe-v1");
      const currentDate = new Date();
      const tomorrowDate = nextDate(currentDate);
      const today = localDateKey(currentDate);
      const tomorrow = localDateKey(tomorrowDate);
      if (saved) {
        const parsed = JSON.parse(saved) as {
          schema?: number;
          date?: string;
          tasks?: Task[];
          inboxTasks?: InboxTask[];
          tomorrowDate?: string;
          tomorrowTasks?: Task[];
          milestones?: Milestone[];
          dismissedOverdueKeys?: string[];
        };
        if (parsed.date === today && Array.isArray(parsed.tasks)) {
          setTasks((parsed.schema ?? 0) >= 2 ? parsed.tasks : migrateSavedTasks(parsed.tasks));
          setDismissedOverdueKeys(parsed.dismissedOverdueKeys ?? []);
        } else if (parsed.tomorrowDate === today && Array.isArray(parsed.tomorrowTasks)) {
          setTasks(parsed.tomorrowTasks.map((task) => ({ ...task, completed: false })));
        } else {
          setTasks(makeTasksForDate(currentDate));
        }
        setInboxTasks([
          ...(parsed.inboxTasks ?? []),
          ...(parsed.date && parsed.date < today ? preserveCustomTasks(parsed.tasks ?? []) : []),
          ...(parsed.tomorrowDate && parsed.tomorrowDate < today ? preserveCustomTasks(parsed.tomorrowTasks ?? []) : []),
        ]);
        setTomorrowTasks(
          parsed.tomorrowDate === tomorrow && Array.isArray(parsed.tomorrowTasks)
            ? parsed.tomorrowTasks
            : makeTasksForDate(tomorrowDate),
        );
        if (Array.isArray(parsed.milestones)) setMilestones(parsed.milestones);
      } else {
        setTasks(makeTasksForDate(currentDate));
        setTomorrowTasks(makeTasksForDate(tomorrowDate));
      }
    } catch {
      setTasks(makeDayTasks());
      setTomorrowTasks(makeTasksForDate(nextDate(new Date())));
    }
    setPlanDate(localDateKey(new Date()));
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated || planDate === currentDateKey) return;
    const yesterdayTomorrow = localDateKey(nextDate(new Date(`${planDate}T12:00:00`)));
    setInboxTasks((items) => [...items, ...preserveCustomTasks(tasks),
      ...(yesterdayTomorrow < currentDateKey ? preserveCustomTasks(tomorrowTasks) : [])]);
    setTasks(yesterdayTomorrow === currentDateKey ? tomorrowTasks : makeTasksForDate(new Date()));
    setTomorrowTasks(makeTasksForDate(nextDate(new Date())));
    setDismissedOverdueKeys([]);
    setPlanningNotice(null);
    setEditingTaskId(null);
    setPlanDate(currentDateKey);
  }, [hydrated, currentDateKey, planDate, tasks, tomorrowTasks]);

  useEffect(() => {
    if (!hydrated || !inboxTasks.length || planDate !== currentDateKey) return;
    const result = planCapturedTasks(tasks, tomorrowTasks, inboxTasks, new Date());
    if (result.placements.length || result.pending.length !== inboxTasks.length) {
      setTasks(result.today);
      setTomorrowTasks(result.tomorrow);
      setInboxTasks(result.pending);
      const placement = result.placements.find((item) => item.id === planningNotice?.id);
      if (placement) setPlanningNotice(placement);
    }
  }, [hydrated, tasks, tomorrowTasks, inboxTasks, planDate, currentDateKey, planningMinute, planningNotice?.id]);

  useEffect(() => {
    if (!hydrated || planDate !== localDateKey(new Date())) return;
    window.localStorage.setItem(
      "dayframe-v1",
      JSON.stringify({
        schema: 4,
        date: planDate,
        tasks,
        inboxTasks,
        tomorrowDate: localDateKey(nextDate(new Date())),
        tomorrowTasks,
        milestones,
        dismissedOverdueKeys,
      }),
    );
  }, [hydrated, tasks, inboxTasks, tomorrowTasks, milestones, dismissedOverdueKeys, planDate]);

  useEffect(() => {
    if (focusRunning) {
      focusRef.current = window.setInterval(() => {
        setFocusSeconds((value) => {
          if (value <= 1) {
            setFocusRunning(false);
            return 0;
          }
          return value - 1;
        });
      }, 1000);
    }
    return () => {
      if (focusRef.current) window.clearInterval(focusRef.current);
    };
  }, [focusRunning]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, [contenteditable='true']")) return;
      const match = navigation.find((item) => item.shortcut === event.key);
      if (match) setActiveView(match.id);
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);

  const dayEnd = useMemo(() => {
    const end = new Date(now);
    end.setHours(0, 30, 0, 0);
    if (end <= now) end.setDate(end.getDate() + 1);
    return end;
  }, [now]);

  const remaining = formatRemaining(dayEnd.getTime() - now.getTime());
  const dayLength = 15.5 * 60 * 60 * 1000;
  const remainingPercent = Math.min(100, Math.max(0, ((dayEnd.getTime() - now.getTime()) / dayLength) * 100));
  const totalPlanned = tasks.reduce((sum, task) => sum + minutesBetween(task.start, task.end), 0);
  const completedMinutes = tasks
    .filter((task) => task.completed)
    .reduce((sum, task) => sum + minutesBetween(task.start, task.end), 0);
  const progress = totalPlanned ? Math.round((completedMinutes / totalPlanned) * 100) : 0;
  const nextTask = tasks.find((task) => !task.completed) ?? null;
  const currentMinute = now.getHours() * 60 + now.getMinutes();
  const overdueTasks = tasks.filter(
    (task) => !task.completed && timeToMinutes(task.end) <= currentMinute,
  );
  const missedTasks = overdueTasks.filter(
    (task) => !dismissedOverdueKeys.includes(`${task.id}:${task.end}`),
  );
  const autoPlannedCount = tasks.filter((task) => task.autoScheduled && !task.completed).length;
  const tomorrowDate = nextDate(now);
  const tomorrowDateLabel = new Intl.DateTimeFormat("cs-CZ", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(tomorrowDate);
  const tomorrowPlanned = tomorrowTasks.reduce((sum, task) => sum + minutesBetween(task.start, task.end), 0);
  const editingTask = (editingDay === "today" ? tasks : tomorrowTasks).find((task) => task.id === editingTaskId) ?? null;
  const nextMilestone = [...milestones].sort((a, b) => a.date.localeCompare(b.date))[0] ?? null;
  const dateLabel = new Intl.DateTimeFormat("cs-CZ", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(now);
  const focusMinutes = Math.floor(focusSeconds / 60).toString().padStart(2, "0");
  const focusSecs = (focusSeconds % 60).toString().padStart(2, "0");
  const focusProgress = ((50 * 60 - focusSeconds) / (50 * 60)) * 100;

  function toggleTask(id: number) {
    setTasks((items) => items.map((task) => (task.id === id ? { ...task, completed: !task.completed } : task)));
  }

  function openTaskEditor(task: Task, day: "today" | "tomorrow" = "today") {
    setEditError("");
    setEditingDay(day);
    setEditingTaskId(task.id);
    setEditTask({
      title: task.title,
      duration: String(task.duration ?? Math.max(15, minutesBetween(task.start, task.end))),
      deadline: task.deadline ?? "22:30",
      priority: task.priority ?? "normal",
      category: task.category,
      fixed: Boolean(task.fixed),
      start: task.start,
      end: task.end,
    });
  }

  function applyReplan(items: Task[], day: "today" | "tomorrow") {
    const result = scheduleFlexibleTasks(items, day === "today" ? new Date() : planningStartForTomorrow());
    const overflow = result.tasks.filter((task) => result.unplacedIds.includes(task.id)).map((task, index) => ({
      id: task.id > 1000 ? task.id : Date.now() + index,
      title: task.title, duration: task.duration ?? minutesBetween(task.start, task.end),
      category: task.category, priority: task.priority ?? "normal" as Priority,
      createdAt: new Date().toISOString(), deadline: task.deadline ?? "22:30",
      targetDate: day === "tomorrow" ? localDateKey(nextDate(new Date())) : undefined,
    }));
    const placedTasks = result.tasks.filter((task) => !result.unplacedIds.includes(task.id));
    const placed = planCapturedTasks(day === "today" ? placedTasks : tasks, day === "tomorrow" ? placedTasks : tomorrowTasks, [...inboxTasks, ...overflow], new Date());
    setTasks(placed.today);
    setTomorrowTasks(placed.tomorrow);
    setInboxTasks(placed.pending);
    setPlanningNotice(null);
  }

  function saveTaskEdits() {
    if (editingTaskId === null || !editTask.title.trim()) return;
    const items = editingDay === "today" ? tasks : tomorrowTasks;
    const duration = editTask.fixed ? minutesBetween(editTask.start, editTask.end) : Number(editTask.duration);
    if (!Number.isFinite(duration) || duration <= 0 || (!editTask.fixed && !editTask.deadline)) {
      setEditError("Zkontroluj délku a čas. Konec musí být po začátku.");
      return;
    }
    if (editTask.fixed && items.some((task) => task.id !== editingTaskId
      && timeToMinutes(editTask.start) < timeToMinutes(task.end)
      && timeToMinutes(editTask.end) > timeToMinutes(task.start))) {
      setEditError("V tomto čase už máš jiný blok. Vyber volný čas, nebo vypni pevný čas.");
      return;
    }
    const updated = items.map((task) => task.id !== editingTaskId ? task : ({
      ...task, title: editTask.title.trim(), category: editTask.category,
      priority: editTask.priority, fixed: editTask.fixed, duration,
      deadline: editTask.fixed ? editTask.end : editTask.deadline,
      start: editTask.fixed ? editTask.start : task.start,
      end: editTask.fixed ? editTask.end : task.end,
      autoScheduled: !editTask.fixed, late: false, notBefore: undefined,
    }));
    if (editTask.fixed || editingTask?.completed) {
      const updateTasks = editingDay === "today" ? setTasks : setTomorrowTasks;
      updateTasks(updated.sort((a, b) => a.start.localeCompare(b.start)));
    } else {
      applyReplan(updated, editingDay);
    }
    setEditingTaskId(null);
    setPlanningNotice(null);
  }

  function delayTask() {
    if (editingTaskId === null) return;
    const notBefore = minutesToTime(Math.min(23 * 60, roundToQuarter(currentMinute) + 30));
    applyReplan(tasks.map((task) => task.id === editingTaskId
      ? { ...task, fixed: false, notBefore, autoScheduled: true, late: false }
      : task), "today");
    setEditingTaskId(null);
  }

  function deleteTask() {
    if (editingTaskId === null) return;
    const updateTasks = editingDay === "today" ? setTasks : setTomorrowTasks;
    updateTasks((items) => items.filter((task) => task.id !== editingTaskId));
    setEditingTaskId(null);
    setPlanningNotice(null);
  }

  function captureAndPlan() {
    if (!hydrated || !captureTask.title.trim()) return;
    const id = editingCaptureId ?? Math.max(Date.now(), ...[...tasks, ...tomorrowTasks, ...inboxTasks].map((task) => task.id + 1));
    const item: InboxTask = {
      id,
      title: captureTask.title.trim(),
      duration: Number(captureTask.duration),
      priority: captureTask.priority,
      category: captureTask.category,
      createdAt: new Date().toISOString(),
      deadline: captureTask.deadline || "22:30",
      targetDate: captureTask.when === "auto" ? undefined : localDateKey(captureTask.when === "today" ? new Date() : nextDate(new Date())),
    };
    const result = planCapturedTasks(tasks, tomorrowTasks, [...inboxTasks.filter((task) => task.id !== id), item], new Date());
    setTasks(result.today);
    setTomorrowTasks(result.tomorrow);
    setInboxTasks(result.pending);
    setPlanningNotice(result.placements.find((task) => task.id === id) ?? { id, title: item.title, day: "waiting" });
    resetCapture();
    captureInputRef.current?.focus();
  }

  function resetCapture() {
    setEditingCaptureId(null);
    setCaptureTask({ title: "", duration: "45", priority: "normal", category: "Studium", when: "auto", deadline: "22:30" });
  }

  function editWaitingTask(item: InboxTask) {
    setEditingCaptureId(item.id);
    setCaptureTask({
      title: item.title, duration: String(item.duration), priority: item.priority, category: item.category,
      deadline: item.deadline ?? "22:30",
      when: item.targetDate === currentDateKey ? "today" : item.targetDate === localDateKey(nextDate(now)) ? "tomorrow" : "auto",
    });
    captureInputRef.current?.focus();
  }

  function undoCapture() {
    if (!planningNotice) return;
    const id = planningNotice.id;
    setTasks((items) => items.filter((task) => task.id !== id));
    setTomorrowTasks((items) => items.filter((task) => task.id !== id));
    setInboxTasks((items) => items.filter((task) => task.id !== id));
    setPlanningNotice(null);
  }

  function planningStartForTomorrow() {
    const start = nextDate(new Date());
    start.setHours(10, 0, 0, 0);
    return start;
  }

  function replanDay() {
    const keysToDismiss = overdueTasks.map((task) => `${task.id}:${task.end}`);
    setDismissedOverdueKeys((keys) => [...new Set([...keys, ...keysToDismiss])]);
    applyReplan(tasks, "today");
  }

  function addMilestone() {
    if (!newMilestone.title.trim() || !newMilestone.date) return;
    setMilestones((items) =>
      [...items, { id: Date.now(), title: newMilestone.title.trim(), date: newMilestone.date, note: "Vlastní termín" }]
        .sort((a, b) => a.date.localeCompare(b.date)),
    );
    setNewMilestone({ title: "", date: "2027-04-05" });
    setMilestoneDialog(false);
  }

  function startFocus() {
    if (focusSeconds === 0) setFocusSeconds(50 * 60);
    setActiveView("focus");
    setFocusRunning(true);
  }

  function resetFocus() {
    setFocusRunning(false);
    setFocusSeconds(50 * 60);
  }

  return (
    <main className={`dayframe-root ${activeView === "focus" ? "focus-mode" : ""}`}>
      <div className="dayframe-shell">
        <aside className="side-panel" aria-label="Hlavní navigace">
          <button className="wordmark" onClick={() => setActiveView("today")} aria-label="Dayframe, přejít na dnešek">
            <span className="wordmark-frame">D</span><strong>Dayframe</strong>
          </button>
          <nav>
            {navigation.map((item) => (
              <button key={item.id} className={activeView === item.id ? "active" : ""} onClick={() => setActiveView(item.id)} aria-current={activeView === item.id ? "page" : undefined}>
                <span className="nav-label">{item.label}</span><kbd>{item.shortcut}</kbd>
              </button>
            ))}
          </nav>
          <div className="side-footer"><span>Den končí</span><strong>00:30</strong><small>Lokální data · Windows</small></div>
        </aside>

        <section className="main-column">
          <header className="page-header">
            <div><p>{dateLabel}</p><h1>{viewTitles[activeView]}</h1></div>
            {activeView === "today" && (
              <Button variant="outline" className="quiet-button" onClick={() => setActiveView("inbox")}>+ Nový úkol</Button>
            )}
          </header>

          {activeView === "today" && (
            <div className="today-view">
              <section className="day-ruler" aria-label="Odpočet do konce dne">
                <div className="day-ruler-copy"><span>Do konce dne</span><strong aria-label={`${remaining.h} hodin ${remaining.m} minut ${remaining.s} sekund`}>{remaining.h.toString().padStart(2, "0")}:{remaining.m.toString().padStart(2, "0")}<em>:{remaining.s.toString().padStart(2, "0")}</em></strong><span>Konec 00:30</span></div>
                <div className="day-track" aria-hidden="true"><span style={{ width: `${100 - remainingPercent}%` }} /><i style={{ left: `${100 - remainingPercent}%` }} /></div>
                <div className="day-scale" aria-hidden="true"><span>09</span><span>12</span><span>15</span><span>18</span><span>21</span><span>00:30</span></div>
              </section>

              <section className="now-block">
                <div className="now-label"><span>Teď</span><small>{nextTask ? `${nextTask.start}–${nextTask.end}` : "Hotovo"}</small></div>
                {nextTask ? <><div className="now-copy"><h2>{nextTask.title}</h2><p>{nextTask.category} · {minutesBetween(nextTask.start, nextTask.end)} minut</p></div><Button className="primary-action" onClick={startFocus}>Zahájit blok</Button></> : <div className="now-copy"><h2>Dnešní plán je hotový</h2><p>Můžeš mít volno.</p></div>}
              </section>

              {missedTasks.length > 0 && (
                <section className="planner-strip needs-attention" aria-live="polite">
                  <div>
                    <span>Plán potřebuje upravit</span>
                    <p>{missedTasks.length === 1 ? `„${missedTasks[0].title}“ měl skončit v ${missedTasks[0].end}, ale ještě není hotový.` : `Několik bloků už skončilo, ale ještě nejsou označené jako hotové.`}</p>
                  </div>
                  <Button variant="outline" className="planner-button" onClick={replanDay}>Přepočítat od teď</Button>
                </section>
              )}

              <section className="timeline-section">
                <div className="section-heading"><div><h2>Časová osa</h2><p>Klikni na úkol pro úpravu; políčko označí hotovo.</p></div><div className="day-summary"><strong>{Math.floor(totalPlanned / 60)} h {totalPlanned % 60} min</strong><span>{autoPlannedCount ? `${autoPlannedCount} automaticky` : "naplánováno"}</span></div></div>
                <div className="timeline-list">
                  {!hydrated ? [0, 1, 2, 3].map((item) => <div className="timeline-skeleton" key={item}><Skeleton className="skeleton-time" /><Skeleton className="skeleton-line" /></div>) : tasks.length ? tasks.map((task) => (
                    <article key={task.id} className={`timeline-row ${task.completed ? "done" : ""} ${nextTask?.id === task.id ? "next" : ""}`}>
                      <button className="task-open" onClick={() => openTaskEditor(task)} aria-label={`Upravit úkol ${task.title}`}>
                        <span className="task-time"><strong>{task.start}</strong><small>{task.end}</small></span><span className="timeline-node" aria-hidden="true" /><span className="task-copy"><strong>{task.title}</strong><small>{task.category}{task.priority === "high" ? " · vysoká priorita" : ""}{task.fixed ? " · pevný blok" : task.autoScheduled ? " · automaticky" : " · flexibilní"}{task.late ? " · po termínu" : ""}</small></span><span className="task-duration">{minutesBetween(task.start, task.end)} min</span>
                      </button>
                      <button className="task-check" onClick={() => toggleTask(task.id)} aria-label={task.completed ? `Označit ${task.title} jako nesplněný` : `Označit ${task.title} jako hotový`}>{task.completed ? "✓" : ""}</button>
                    </article>
                  )) : <div className="empty-day"><strong>Dnes nemáš žádné bloky.</strong><button onClick={() => setActiveView("inbox")}>Přidat první</button></div>}
                </div>
              </section>
            </div>
          )}

          {activeView === "inbox" && (
            <section className="planning-view">
              <form className="quick-capture" onSubmit={(event) => { event.preventDefault(); captureAndPlan(); }}>
                <Label className="capture-label" htmlFor="capture-task-name">Co potřebuješ udělat?</Label>
                <p className="capture-intro">Najdu volný čas dnes. Pokud se úkol nevejde, zařadím ho na zítřek.</p>
                <div className="capture-entry">
                  <Input ref={captureInputRef} autoFocus required maxLength={180} id="capture-task-name" value={captureTask.title} onChange={(event) => setCaptureTask({ ...captureTask, title: event.target.value })} placeholder="Např. projít kapitolu o dluhopisech" />
                  <Button type="submit" disabled={!hydrated || !captureTask.title.trim()} className="primary-action">{editingCaptureId ? "Uložit a naplánovat" : "Naplánovat"}</Button>
                </div>
                <div className="capture-defaults">
                  <span>{captureTask.duration} minut · {captureTask.when === "today" ? "pouze dnes" : captureTask.when === "tomorrow" ? "pouze zítra" : "den i čas vyberu automaticky"}</span>
                  {editingCaptureId !== null && <button type="button" onClick={resetCapture}>Zrušit úpravu</button>}
                </div>
                <details className="capture-options" open={editingCaptureId !== null ? true : undefined}>
                  <summary>Upravit délku a podrobnosti</summary>
                  <div className="capture-option-fields">
                    <div className="two-fields">
                      <div>
                        <Label htmlFor="capture-task-duration">Jak dlouho to zabere?</Label>
                        <Select value={captureTask.duration} onValueChange={(value) => setCaptureTask({ ...captureTask, duration: value })}>
                          <SelectTrigger id="capture-task-duration" className="dayframe-select"><SelectValue /></SelectTrigger>
                          <SelectContent className="dayframe-select-content"><SelectItem value="20">20 minut</SelectItem><SelectItem value="25">25 minut</SelectItem><SelectItem value="30">30 minut</SelectItem><SelectItem value="45">45 minut</SelectItem><SelectItem value="60">60 minut</SelectItem><SelectItem value="90">90 minut</SelectItem></SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label htmlFor="capture-task-when">Kdy to potřebuješ?</Label>
                        <Select value={captureTask.when} onValueChange={(value) => setCaptureTask({ ...captureTask, when: value as "auto" | "today" | "tomorrow" })}>
                          <SelectTrigger id="capture-task-when" className="dayframe-select"><SelectValue /></SelectTrigger>
                          <SelectContent className="dayframe-select-content"><SelectItem value="auto">Nechat na Dayframe</SelectItem><SelectItem value="today">Musí to být dnes</SelectItem><SelectItem value="tomorrow">Až zítra</SelectItem></SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="two-fields">
                      <div><Label htmlFor="capture-task-deadline">Nejpozději v daný den</Label><Input id="capture-task-deadline" required type="time" value={captureTask.deadline} onChange={(event) => setCaptureTask({ ...captureTask, deadline: event.target.value })} /></div>
                      <div>
                        <Label htmlFor="capture-task-priority">Důležitost</Label>
                        <Select value={captureTask.priority} onValueChange={(value) => setCaptureTask({ ...captureTask, priority: value as Priority })}>
                          <SelectTrigger id="capture-task-priority" className="dayframe-select"><SelectValue /></SelectTrigger>
                          <SelectContent className="dayframe-select-content"><SelectItem value="high">Důležité</SelectItem><SelectItem value="normal">Běžné</SelectItem><SelectItem value="low">Nespěchá</SelectItem></SelectContent>
                        </Select>
                      </div>
                    </div>
                    <Label htmlFor="capture-task-category">Oblast</Label>
                    <Select value={captureTask.category} onValueChange={(value) => setCaptureTask({ ...captureTask, category: value })}>
                      <SelectTrigger id="capture-task-category" className="dayframe-select"><SelectValue /></SelectTrigger>
                      <SelectContent className="dayframe-select-content"><SelectItem value="Studium">Studium</SelectItem><SelectItem value="Finance">Finance</SelectItem><SelectItem value="Matika">Matika</SelectItem><SelectItem value="Angličtina">Angličtina</SelectItem><SelectItem value="Ekonomie">Ekonomie</SelectItem><SelectItem value="Osobní">Osobní</SelectItem></SelectContent>
                    </Select>
                  </div>
                </details>
              </form>

              {planningNotice && (
                <section className={`capture-result ${planningNotice.day === "waiting" ? "waiting" : ""}`} role="status">
                  <div>
                    <span>{planningNotice.day === "waiting" ? "Úkol je uložený" : planningNotice.day === "today" ? `Dnes · ${planningNotice.start}–${planningNotice.end}` : `Zítra · ${planningNotice.start}–${planningNotice.end}`}</span>
                    <h2>{planningNotice.title}</h2>
                    <p>{planningNotice.day === "waiting" ? "Do zvoleného času se nevejde. Níže můžeš upravit délku nebo termín." : planningNotice.day === "today" ? "Je v dnešním plánu. Ostatní bloky zůstaly na svém místě." : "Na zítřek má své místo. Až den začne, uvidíš ho v Dnes."}</p>
                  </div>
                  <div className="capture-result-actions">
                    {planningNotice.day !== "waiting" && <button type="button" className="row-action primary-text" onClick={() => {
                      if (planningNotice.day === "today") setActiveView("today");
                      else document.getElementById("tomorrow-plan")?.scrollIntoView({ behavior: "smooth", block: "start" });
                    }}>Ukázat v plánu</button>}
                    <button type="button" className="row-action" onClick={undoCapture}>Vzít zpět</button>
                  </div>
                </section>
              )}

              {inboxTasks.length > 0 && (
                <section className="waiting-section">
                  <div className="planning-section-heading"><div><h2>{inboxTasks.length === 1 ? "Jeden úkol zatím nemá čas" : "Tyto úkoly zatím nemají čas"}</h2><p>Úkoly zůstávají uložené. Když se v plánu uvolní místo, zařadím je automaticky.</p></div></div>
                  <div className="planning-list">
                    {inboxTasks.map((task) => (
                      <article key={task.id} className="planning-row waiting-row">
                        <div className="planning-copy"><strong>{task.title}</strong><small>{task.duration} min · {task.targetDate && task.targetDate < currentDateKey ? "Zadaný den už uplynul. Uprav termín." : task.targetDate === currentDateKey ? "Dnes se do termínu nevejde." : task.targetDate ? "Zítra se do termínu nevejde." : "Dnes ani zítra se do termínu nevejde."}</small></div>
                        <div className="waiting-actions">
                          <button className="row-action primary-text" onClick={() => editWaitingTask(task)}>Upravit</button>
                          <AlertDialog><AlertDialogTrigger asChild><button className="row-action">Smazat</button></AlertDialogTrigger><AlertDialogContent className="dayframe-dialog"><AlertDialogHeader><AlertDialogTitle>Smazat „{task.title}“?</AlertDialogTitle><AlertDialogDescription>Úkol se odstraní. Tuto akci nejde vrátit.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Zrušit</AlertDialogCancel><AlertDialogAction onClick={() => { setInboxTasks((items) => items.filter((item) => item.id !== task.id)); if (planningNotice?.id === task.id) setPlanningNotice(null); if (editingCaptureId === task.id) resetCapture(); }}>Smazat</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
                        </div>
                      </article>
                    ))}
                  </div>
                </section>
              )}

              <section className="tomorrow-section" id="tomorrow-plan">
                <div className="planning-section-heading tomorrow-heading">
                  <div><span>{tomorrowDateLabel}</span><h2>Zítra už máš připraveno</h2></div>
                  <div className="tomorrow-load"><strong>{Math.floor(tomorrowPlanned / 60)} h {tomorrowPlanned % 60} min</strong><small>{tomorrowTasks.length} bloků</small></div>
                </div>
                <div className="tomorrow-list">
                  {tomorrowTasks.length ? tomorrowTasks.map((task) => (
                    <article key={task.id} className="tomorrow-row">
                      <span className="tomorrow-time"><strong>{task.start}</strong><small>{task.end}</small></span>
                      <span className="tomorrow-rule" aria-hidden="true" />
                      <span className="planning-copy"><strong>{task.title}</strong><small>{task.duration ?? minutesBetween(task.start, task.end)} min · {task.fixed ? "pevný čas" : "naplánováno"}</small></span>
                      <button className="row-action" onClick={() => openTaskEditor(task, "tomorrow")}>Upravit</button>
                    </article>
                  )) : <div className="planning-empty"><strong>Zítřek je zatím volný.</strong><p>Nové úkoly sem zařadím, pokud dnes nebude místo.</p></div>}
                </div>
              </section>
            </section>
          )}

          {activeView === "focus" && (
            <section className="focus-stage">
              <div className="focus-status-line"><span className={focusRunning ? "active" : ""} />{focusRunning ? "Hlídač je aktivní" : "Blok je připravený"}</div>
              <div className="focus-task"><p>{nextTask ? `${nextTask.start}–${nextTask.end} · ${nextTask.category}` : "Volný focus blok"}</p><h2>{nextTask?.title ?? "Soustředění bez úkolu"}</h2></div>
              <div className="focus-time" aria-label={`${focusMinutes} minut ${focusSecs} sekund`}><span>{focusMinutes}</span><em>:</em><span>{focusSecs}</span></div>
              <div className="focus-track" aria-hidden="true"><span style={{ width: `${focusProgress}%` }} /></div>
              <div className="focus-controls"><Button className="focus-primary" onClick={() => setFocusRunning(!focusRunning)}>{focusRunning ? "Pozastavit" : "Spustit 50 minut"}</Button><Button variant="outline" className="focus-secondary" onClick={resetFocus}>Začít znovu</Button></div>
              <div className="focus-policy"><div><span>Povolené</span><strong>Excel, CFI v prohlížeči, Kalkulačka</strong></div><div><span>Blokované</span><strong>YouTube, Instagram, hry</strong></div><div><span>Režim zásahu</span><strong>{strictMode ? "Přísný · 3 úrovně" : "Pouze upozornění"}</strong></div></div>
              <button className="test-intervention" onClick={() => setIntentDialog(true)}>Vyzkoušet zásah hlídače</button>
            </section>
          )}

          {activeView === "milestones" && (
            <section className="milestones-view">
              <div className="section-heading milestone-heading"><div><h2>Důležité termíny</h2><p>Termín, zbývající čas a další konkrétní krok.</p></div><Dialog open={milestoneDialog} onOpenChange={setMilestoneDialog}><DialogTrigger asChild><Button className="primary-action">+ Nový milník</Button></DialogTrigger><DialogContent className="dayframe-dialog"><DialogHeader><DialogTitle>Nový milník</DialogTitle><DialogDescription>Datum, které má zůstat na očích.</DialogDescription></DialogHeader><div className="dialog-fields"><Label htmlFor="milestone-name">Název</Label><Input id="milestone-name" value={newMilestone.title} onChange={(event) => setNewMilestone({ ...newMilestone, title: event.target.value })} placeholder="Např. přijímací zkouška" /><Label htmlFor="milestone-date">Datum</Label><Input id="milestone-date" type="date" value={newMilestone.date} onChange={(event) => setNewMilestone({ ...newMilestone, date: event.target.value })} /><Button className="primary-action" onClick={addMilestone}>Uložit milník</Button></div></DialogContent></Dialog></div>
              <div className="milestone-list">{[...milestones].sort((a, b) => a.date.localeCompare(b.date)).map((milestone, index) => <article className={index === 0 ? "priority" : ""} key={milestone.id}><div className="milestone-index">{String(index + 1).padStart(2, "0")}</div><div className="milestone-copy"><span>{milestone.note}</span><h3>{milestone.title}</h3><p>{formatDate(milestone.date)}</p></div><div className="milestone-days"><strong>{daysUntil(milestone.date, now)}</strong><span>dní</span></div><button aria-label={`Otevřít ${milestone.title}`}>Otevřít</button></article>)}</div>
            </section>
          )}

          {activeView === "settings" && (
            <section className="settings-view">
              <div className="settings-intro"><h2>Chování aplikace</h2><p>Nastavení platí pro tento počítač. Synchronizaci zařízení zapojíme později.</p></div>
              <div className="settings-list"><div><span><strong>Systémová upozornění</strong><small>Začátky bloků a odbočení od práce</small></span><Switch checked={notifications} onCheckedChange={setNotifications} /></div><div><span><strong>Přísný focus režim</strong><small>Třetí odbočení otevře Intent Gate</small></span><Switch checked={strictMode} onCheckedChange={setStrictMode} /></div><button><span><strong>Konec dne</strong><small>Čas hlavního odpočtu</small></span><em>00:30</em></button><button><span><strong>Rušivé aplikace</strong><small>YouTube, Instagram, hry a další</small></span><em>Upravit</em></button></div>
              <div className="privacy-note"><strong>Soukromí</strong><p>V náhledu zůstávají data pouze v tomto prohlížeči. Windows aplikace bude číst název aktivního programu lokálně a bez souhlasu ho nebude odesílat.</p></div>
            </section>
          )}
        </section>

        <aside className="context-rail">
          {activeView === "focus" ? (
            <>
              <section><span className="rail-label">Aktivní ochrana</span><h2>{strictMode ? "Přísný režim" : "Lehký režim"}</h2><p className="rail-copy">Při opakovaném odbočení se Dayframe vrátí do popředí a vyžádá si konkrétní důvod.</p></section>
              <section><span className="rail-label">Průběh bloku</span><dl className="focus-stats"><div><dt>Odbočení</dt><dd>0</dd></div><div><dt>Čistý čas</dt><dd>{Math.floor((50 * 60 - focusSeconds) / 60)} min</dd></div><div><dt>Zbývá</dt><dd>{focusMinutes}:{focusSecs}</dd></div></dl></section>
              <section><span className="rail-label">Po dokončení</span><p className="rail-copy">Krátká pauza 10 minut, potom další blok podle plánu.</p></section>
            </>
          ) : activeView === "inbox" ? (
            <>
              <section><span className="rail-label">Čas najdu za tebe</span><h2>Stačí název úkolu.</h2><p className="rail-copy">Pokud délku nezměníš, vyhradím 45 minut. Hotové i naplánované bloky nechám na místě.</p></section>
              <section><span className="rail-label">S čím počítám</span><dl className="capacity-list"><div><dt>Začátek práce</dt><dd>10:00</dd></div><div><dt>Oběd</dt><dd>13–14</dd></div><div><dt>Nejpozději hotovo</dt><dd>22:30</dd></div></dl><p className="rail-copy">Čas hledám dnes a zítra. Důležitost a termín určují pořadí čekajících úkolů.</p></section>
              <section><span className="rail-label">Chceš jiný čas?</span><p className="rail-copy">Před přidáním otevři podrobnosti. U naplánovaného úkolu stačí kliknout na Upravit.</p></section>
            </>
          ) : (
            <>
              {activeView === "today" && missedTasks.length > 0 && (
                <section className="rail-planner">
                  <span className="rail-label">Chytrý plán</span>
                  <h2>{missedTasks.length === 1 ? "Blok nebyl dokončen" : "Plán je po čase"}</h2>
                  <p className="rail-copy">Priorita určuje pořadí. Pevné bloky a hotové úkoly zůstávají na místě.</p>
                  <button onClick={replanDay}>Přepočítat od teď</button>
                </section>
              )}
              <section><span className="rail-label">Nejbližší termín</span><h2>{nextMilestone?.title ?? "Bez termínu"}</h2><div className="deadline-number"><strong>{nextMilestone ? daysUntil(nextMilestone.date, now) : 0}</strong><span>dní</span></div><p className="rail-copy">{nextMilestone ? formatDate(nextMilestone.date) : "Přidej první milník"}</p></section>
              <section><span className="rail-label">Dnešní kapacita</span><dl className="capacity-list"><div><dt>Naplánováno</dt><dd>{Math.floor(totalPlanned / 60)} h {totalPlanned % 60} min</dd></div><div><dt>Dokončeno</dt><dd>{Math.floor(completedMinutes / 60)} h {completedMinutes % 60} min</dd></div><div><dt>Postup</dt><dd>{progress} %</dd></div></dl></section>
              <section><span className="rail-label">Tento týden</span><div className="week-table">{["Po", "Út", "St", "Čt", "Pá", "So", "Ne"].map((day, index) => <div key={day} className={index === ((now.getDay() + 6) % 7) ? "today" : ""}><span>{day}</span><i /><small>{[3.5, 4, 2.5, 3.5, 3.5, 2, 0][index]} h</small></div>)}</div></section>
              <section className="agent-state"><span className="status-dot" /><div><strong>Hlídač připraven</strong><p>Aktivuje se při spuštění focus bloku.</p></div></section>
            </>
          )}
        </aside>

        <nav className="mobile-nav" aria-label="Mobilní navigace">{navigation.map((item) => <button key={item.id} className={activeView === item.id ? "active" : ""} onClick={() => setActiveView(item.id)}>{item.mobileLabel}</button>)}</nav>
      </div>

      <Dialog open={editingTaskId !== null} onOpenChange={(open) => { if (!open) setEditingTaskId(null) }}>
        <DialogContent className="dayframe-dialog task-editor-dialog">
          <DialogHeader>
            <DialogTitle>Upravit úkol</DialogTitle>
            <DialogDescription>{editingTask?.completed ? "Úkol je označený jako hotový." : editingDay === "tomorrow" ? "Změny se uloží do zítřejšího plánu." : "Změny se uloží do dnešní časové osy."}</DialogDescription>
          </DialogHeader>
          <div className="dialog-fields">
            <Label htmlFor="edit-task-name">Název</Label>
            <Input id="edit-task-name" value={editTask.title} onChange={(event) => setEditTask({ ...editTask, title: event.target.value })} />
            <div className="edit-mode-row">
              <span><strong>Pevný čas</strong><small>{editTask.fixed ? "Dayframe tento blok neposune." : "Úkol se může při přepočtu přesunout."}</small></span>
              <Switch checked={editTask.fixed} onCheckedChange={(checked) => setEditTask({ ...editTask, fixed: checked })} aria-label="Pevný čas" />
            </div>
            {editTask.fixed ? (
              <div className="two-fields">
                <div><Label htmlFor="edit-task-start">Začátek</Label><Input id="edit-task-start" type="time" value={editTask.start} onChange={(event) => setEditTask({ ...editTask, start: event.target.value })} /></div>
                <div><Label htmlFor="edit-task-end">Konec</Label><Input id="edit-task-end" type="time" value={editTask.end} onChange={(event) => setEditTask({ ...editTask, end: event.target.value })} /></div>
              </div>
            ) : (
              <div className="two-fields">
                <div>
                  <Label htmlFor="edit-task-duration">Délka</Label>
                  <Select value={editTask.duration} onValueChange={(value) => setEditTask({ ...editTask, duration: value })}>
                    <SelectTrigger id="edit-task-duration" className="dayframe-select"><SelectValue /></SelectTrigger>
                    <SelectContent className="dayframe-select-content"><SelectItem value="20">20 minut</SelectItem><SelectItem value="25">25 minut</SelectItem><SelectItem value="30">30 minut</SelectItem><SelectItem value="45">45 minut</SelectItem><SelectItem value="60">60 minut</SelectItem><SelectItem value="90">90 minut</SelectItem></SelectContent>
                  </Select>
                </div>
                <div><Label htmlFor="edit-task-deadline">Dokončit nejpozději</Label><Input id="edit-task-deadline" type="time" value={editTask.deadline} onChange={(event) => setEditTask({ ...editTask, deadline: event.target.value })} /></div>
              </div>
            )}
            <div className="two-fields">
              <div>
                <Label htmlFor="edit-task-priority">Priorita</Label>
                <Select value={editTask.priority} onValueChange={(value) => setEditTask({ ...editTask, priority: value as Priority })}>
                  <SelectTrigger id="edit-task-priority" className="dayframe-select"><SelectValue /></SelectTrigger>
                  <SelectContent className="dayframe-select-content"><SelectItem value="high">Vysoká</SelectItem><SelectItem value="normal">Běžná</SelectItem><SelectItem value="low">Nízká</SelectItem></SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="edit-task-category">Oblast</Label>
                <Select value={editTask.category} onValueChange={(value) => setEditTask({ ...editTask, category: value })}>
                  <SelectTrigger id="edit-task-category" className="dayframe-select"><SelectValue /></SelectTrigger>
                  <SelectContent className="dayframe-select-content"><SelectItem value="Studium">Studium</SelectItem><SelectItem value="Finance">Finance</SelectItem><SelectItem value="Matika">Matika</SelectItem><SelectItem value="Angličtina">Angličtina</SelectItem><SelectItem value="VŠE AJ">VŠE AJ</SelectItem><SelectItem value="Ekonomie">Ekonomie</SelectItem><SelectItem value="Opakování">Opakování</SelectItem><SelectItem value="Flex blok">Flex blok</SelectItem><SelectItem value="Rutina">Rutina</SelectItem><SelectItem value="Osobní">Osobní</SelectItem></SelectContent>
                </Select>
              </div>
            </div>
            <div className="task-editor-actions">
              <Button className="primary-action" onClick={saveTaskEdits}>Uložit změny</Button>
              {!editTask.fixed && editingDay === "today" && <Button variant="outline" className="delay-action" onClick={delayTask}>Odložit o 30 minut</Button>}
            </div>
            {editError && <p role="alert" className="edit-error">{editError}</p>}
            <AlertDialog>
              <AlertDialogTrigger asChild><button className="delete-task">Smazat úkol</button></AlertDialogTrigger>
              <AlertDialogContent className="dayframe-dialog destructive-confirm">
                <AlertDialogHeader><AlertDialogTitle>Smazat „{editingTask?.title}“?</AlertDialogTitle><AlertDialogDescription>Úkol se odstraní z {editingDay === "tomorrow" ? "zítřejšího" : "dnešního"} plánu. Tuto akci nejde vrátit.</AlertDialogDescription></AlertDialogHeader>
                <AlertDialogFooter><AlertDialogCancel className="quiet-button">Zrušit</AlertDialogCancel><AlertDialogAction className="delete-confirm" onClick={deleteTask}>Smazat</AlertDialogAction></AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={intentDialog} onOpenChange={setIntentDialog}>
        <DialogContent className="intent-dialog"><DialogHeader><DialogDescription>Zachyceno · YouTube</DialogDescription><DialogTitle>Proč právě teď opouštíš svůj blok?</DialogTitle></DialogHeader><p>Máš pracovat na úkolu „{nextTask?.title ?? "Soustředění"}“. Tohle je třetí odbočení během deseti minut.</p><Label htmlFor="intent-reason">Konkrétní důvod</Label><Input id="intent-reason" placeholder="Např. potřebuji najít výukové video…" /><div className="intent-actions"><Button className="focus-primary" onClick={() => setIntentDialog(false)}>Vrátit se k práci</Button><Button variant="outline" className="focus-secondary" onClick={() => { setFocusRunning(false); setIntentDialog(false) }}>Povolit 5 minut</Button></div></DialogContent>
      </Dialog>
    </main>
  );
}
