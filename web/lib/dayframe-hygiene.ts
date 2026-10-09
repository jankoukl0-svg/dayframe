import { addDaysKey, dateFromKey } from "@/lib/dayframe-calendar";

export const HYGIENE_STORAGE_KEY = "dayframe-hygiene-v1";
export const HYGIENE_SYNC_EVENT = "dayframe-hygiene-sync";

export type HygieneTaskStatus = "done" | "skipped" | "omitted" | "deferred";

export type HygieneSchedule =
  | { type: "daily" }
  | { type: "days"; weekdays: number[] }
  | { type: "weekly"; weekday: number }
  | { type: "interval"; everyDays: number; anchorDate: string }
  | { type: "rolling"; everyDays: number; anchorDate: string; unit: "days" | "weeks" }
  | { type: "monthly"; day: number }
  | { type: "nth-weekday"; week: number; weekday: number }
  | { type: "manual" };

export type HygieneTaskDefinition = {
  id: string;
  title: string;
  section: string;
  active: boolean;
  optional: boolean;
  allowSkip: boolean;
  schedule?: HygieneSchedule;
  productIds?: string[];
  timerSeconds?: number;
};

export type HygieneRoutineDefinition = {
  id: string;
  title: string;
  active: boolean;
  order: number;
  schedule: HygieneSchedule;
  tasks: HygieneTaskDefinition[];
};

export type HygieneProduct = {
  id: string;
  name: string;
  brand: string;
  category: string;
  description: string;
  instructions: string;
  frequency: string;
  usageWhen?: string;
  usageAmount?: string;
  usageDuration?: string;
  precautions?: string;
  openedOn: string;
  expiresOn: string;
  paoMonths: number | null;
  amount: string;
  stockStatus: "ok" | "low";
  shopUrl: string;
  photoKey?: string;
  archived: boolean;
};

export type HygieneProductSnapshot = {
  id: string;
  name: string;
  brand: string;
  instructions: string;
  usageWhen?: string;
  usageAmount?: string;
  usageDuration?: string;
  frequency?: string;
  precautions?: string;
  photoKey?: string;
};

export type HygieneTaskSnapshot = {
  id: string;
  title: string;
  section: string;
  optional: boolean;
  allowSkip: boolean;
  products?: HygieneProductSnapshot[];
  originDate?: string;
};

export type HygieneRoutineRecord = {
  date: string;
  routineId: string;
  routineTitle: string;
  scheduledTasks: HygieneTaskSnapshot[];
  states: Record<string, HygieneTaskStatus>;
  completedOn?: Record<string, string>;
  archived?: boolean;
  carryToday?: boolean;
};

export type HygieneStore = {
  version: 1;
  routines: HygieneRoutineDefinition[];
  products: HygieneProduct[];
  records: Record<string, Record<string, HygieneRoutineRecord>>;
  manualDates: Record<string, string[]>;
  suppressedDates: Record<string, string[]>;
  manualTaskDates: Record<string, string[]>;
  taskReschedules: Record<string, string>;
  lastMaterializedDate: string | null;
};

export type HygieneRoutineStatus = "complete" | "partial" | "missed" | "skipped" | "deferred" | "scheduled";

export type HygieneRoutineSummary = {
  routine: HygieneRoutineDefinition;
  record: HygieneRoutineRecord;
  status: HygieneRoutineStatus;
  handled: number;
  total: number;
  done: number;
  skipped: number;
  optionalDone: number;
};

export type HygieneRoutineStats = {
  plannedDays: number;
  completedDays: number;
  skippedDays: number;
  skippedTasks: number;
  partialDays: number;
  missedDays: number;
  successRate: number;
  currentStreak: number;
  longestStreak: number;
};

const DEFAULT_SECTION = "Péče";

function task(
  id: string,
  title: string,
  section = DEFAULT_SECTION,
  options: Partial<Pick<HygieneTaskDefinition, "optional" | "allowSkip" | "schedule">> = {},
): HygieneTaskDefinition {
  return {
    id,
    title,
    section,
    active: true,
    optional: options.optional === true,
    allowSkip: options.allowSkip === true,
    schedule: options.schedule,
  };
}

export function createDefaultHygieneStore(today: string): HygieneStore {
  const monthlyFirstSunday: HygieneSchedule = { type: "nth-weekday", week: 1, weekday: 0 };

  return {
    version: 1,
    routines: [
      {
        id: "morning",
        title: "Ranní rutina",
        active: true,
        order: 10,
        schedule: { type: "daily" },
        tasks: [
          task("morning-shower", "Ranní sprcha"),
          task("morning-teeth", "Vyčistit zuby"),
          task("morning-face", "Očistit obličej"),
          task("morning-spf", "Hydratační krém + SPF"),
          task("morning-deodorant", "Deodorant"),
          task("morning-grooming", "Úprava vlasů a vousů"),
        ],
      },
      {
        id: "evening",
        title: "Večerní rutina",
        active: true,
        order: 20,
        schedule: { type: "daily" },
        tasks: [
          task("evening-shower", "Večerní sprcha"),
          task("evening-face", "Očištění obličeje"),
          task("evening-skin", "Hydratace pokožky"),
          task("evening-teeth", "Vyčištění zubů"),
          task("evening-interdental", "Mezizubní čištění"),
        ],
      },
      {
        id: "hygiene-day",
        title: "Hygiene Day",
        active: true,
        order: 30,
        schedule: { type: "weekly", weekday: 0 },
        tasks: [
          task("weekly-exfoliation", "Jemná exfoliace těla kartáčem", "Péče o tělo a obličej", { optional: true, allowSkip: true }),
          task("weekly-gua-sha", "Masáž obličeje / Gua Sha", "Péče o tělo a obličej", { optional: true, allowSkip: true }),
          task("weekly-body-hydration", "Hydratace těla", "Péče o tělo a obličej"),
          task("weekly-feet", "Péče o chodidla", "Péče o tělo a obličej"),
          task("weekly-beard", "Holení nebo úprava vousů", "Grooming", { allowSkip: true }),
          task("weekly-hand-nails", "Kontrola a případné stříhání nehtů na rukou", "Grooming", { allowSkip: true }),
          task("weekly-eyebrows", "Úprava obočí podle potřeby", "Grooming", { allowSkip: true }),
          task("weekly-nose-ears", "Zastřižení chloupků v nose a uších podle potřeby", "Grooming", { allowSkip: true }),
          task("weekly-bed", "Převléknout celou postel", "Hygiena prostředí a pomůcek"),
          task("weekly-phone", "Vyčistit mobilní telefon a jeho obal", "Hygiena prostředí a pomůcek"),
          task("weekly-headphones", "Vyčistit sluchátka", "Hygiena prostředí a pomůcek"),
          task("weekly-towels", "Vyměnit ručníky", "Hygiena prostředí a pomůcek"),
          task("weekly-brushes", "Vyčistit hřeben a kartáče", "Hygiena prostředí a pomůcek"),
          task("weekly-razor", "Vyčistit holicí strojek", "Hygiena prostředí a pomůcek"),
          task("monthly-moles", "Kontrola znamének a změn pokožky", "Měsíční péče", { schedule: monthlyFirstSunday }),
          task("monthly-toenails", "Kontrola a případné stříhání nehtů na nohou", "Měsíční péče", { schedule: monthlyFirstSunday }),
          task("monthly-razors", "Kontrola stavu žiletek a hygienických pomůcek", "Měsíční péče", { schedule: monthlyFirstSunday }),
          task("monthly-keyboard", "Důkladnější vyčištění klávesnice a myši", "Měsíční péče", { schedule: monthlyFirstSunday }),
          task("monthly-supplies", "Kontrola a výměna opotřebovaných hygienických potřeb podle potřeby", "Měsíční péče", { schedule: monthlyFirstSunday }),
        ],
      },
    ],
    products: [],
    records: {},
    manualDates: {},
    suppressedDates: {},
    manualTaskDates: {},
    taskReschedules: {},
    lastMaterializedDate: addDaysKey(today, -1),
  };
}

function cleanSchedule(value: unknown): HygieneSchedule | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const schedule = value as Partial<HygieneSchedule>;
  if (schedule.type === "daily") return { type: "daily" };
  if (schedule.type === "manual") return { type: "manual" };
  if (schedule.type === "days") {
    const weekdays = Array.isArray(schedule.weekdays)
      ? [...new Set(schedule.weekdays.filter((day): day is number => Number.isInteger(day) && day >= 0 && day <= 6))]
      : [];
    return weekdays.length ? { type: "days", weekdays } : null;
  }
  if (schedule.type === "weekly" && Number.isInteger(schedule.weekday) && Number(schedule.weekday) >= 0 && Number(schedule.weekday) <= 6) {
    return { type: "weekly", weekday: Number(schedule.weekday) };
  }
  if (schedule.type === "interval" && Number.isInteger(schedule.everyDays) && Number(schedule.everyDays) >= 1 && typeof schedule.anchorDate === "string") {
    return { type: "interval", everyDays: Number(schedule.everyDays), anchorDate: schedule.anchorDate };
  }
  if (schedule.type === "rolling" && Number.isInteger(schedule.everyDays)
    && Number(schedule.everyDays) >= 1 && Number(schedule.everyDays) <= 365
    && typeof schedule.anchorDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(schedule.anchorDate)
    && (schedule.unit === "days" || schedule.unit === "weeks")) {
    return { type: "rolling", everyDays: Number(schedule.everyDays), anchorDate: schedule.anchorDate, unit: schedule.unit };
  }
  if (schedule.type === "monthly" && Number.isInteger(schedule.day) && Number(schedule.day) >= 1 && Number(schedule.day) <= 31) {
    return { type: "monthly", day: Number(schedule.day) };
  }
  if (
    schedule.type === "nth-weekday"
    && Number.isInteger(schedule.week)
    && Number(schedule.week) >= 1
    && Number(schedule.week) <= 5
    && Number.isInteger(schedule.weekday)
    && Number(schedule.weekday) >= 0
    && Number(schedule.weekday) <= 6
  ) {
    return { type: "nth-weekday", week: Number(schedule.week), weekday: Number(schedule.weekday) };
  }
  return null;
}

export function parseHygieneStore(raw: string | null, today: string): { store: HygieneStore; blocked: boolean } {
  if (raw === null) return { store: createDefaultHygieneStore(today), blocked: false };

  try {
    const candidate = JSON.parse(raw) as Partial<HygieneStore>;
    if (
      !candidate
      || candidate.version !== 1
      || !Array.isArray(candidate.routines)
      || !candidate.records
      || typeof candidate.records !== "object"
      || Array.isArray(candidate.records)
      || !candidate.manualDates
      || typeof candidate.manualDates !== "object"
      || Array.isArray(candidate.manualDates)
    ) {
      return { store: createDefaultHygieneStore(today), blocked: true };
    }

    const routines: HygieneRoutineDefinition[] = [];
    const routineIds = new Set<string>();
    for (const rawRoutine of candidate.routines) {
      if (!rawRoutine || typeof rawRoutine !== "object" || Array.isArray(rawRoutine)) {
        return { store: createDefaultHygieneStore(today), blocked: true };
      }
      const routine = rawRoutine as Partial<HygieneRoutineDefinition>;
      const schedule = cleanSchedule(routine.schedule);
      if (
        typeof routine.id !== "string"
        || !routine.id
        || routineIds.has(routine.id)
        || typeof routine.title !== "string"
        || !routine.title.trim()
        || typeof routine.active !== "boolean"
        || !Number.isFinite(routine.order)
        || !schedule
        || !Array.isArray(routine.tasks)
      ) {
        return { store: createDefaultHygieneStore(today), blocked: true };
      }

      const taskIds = new Set<string>();
      const tasks: HygieneTaskDefinition[] = [];
      for (const rawTask of routine.tasks) {
        if (!rawTask || typeof rawTask !== "object" || Array.isArray(rawTask)) {
          return { store: createDefaultHygieneStore(today), blocked: true };
        }
        const item = rawTask as Partial<HygieneTaskDefinition>;
        const taskSchedule = item.schedule === undefined ? undefined : cleanSchedule(item.schedule);
        if (
          typeof item.id !== "string"
          || !item.id
          || taskIds.has(item.id)
          || typeof item.title !== "string"
          || !item.title.trim()
          || typeof item.section !== "string"
          || !item.section.trim()
          || typeof item.active !== "boolean"
          || typeof item.optional !== "boolean"
          || typeof item.allowSkip !== "boolean"
          || (item.schedule !== undefined && !taskSchedule)
        ) {
          return { store: createDefaultHygieneStore(today), blocked: true };
        }
        if (item.timerSeconds !== undefined && (
          !Number.isInteger(item.timerSeconds) || item.timerSeconds < 15 || item.timerSeconds > 7200
        )) return { store: createDefaultHygieneStore(today), blocked: true };
        if (item.productIds !== undefined && (
          !Array.isArray(item.productIds)
          || item.productIds.some((id) => typeof id !== "string" || !id)
        )) return { store: createDefaultHygieneStore(today), blocked: true };
        taskIds.add(item.id);
        tasks.push({
          id: item.id,
          title: item.title.trim(),
          section: item.section.trim(),
          active: item.active,
          optional: item.optional,
          allowSkip: item.allowSkip,
          schedule: taskSchedule ?? undefined,
          productIds: item.productIds ? [...new Set(item.productIds)] : [],
          timerSeconds: item.timerSeconds,
        });
      }

      routineIds.add(routine.id);
      routines.push({
        id: routine.id,
        title: routine.title.trim(),
        active: routine.active,
        order: Number(routine.order),
        schedule,
        tasks,
      });
    }

    const products: HygieneProduct[] = [];
    const productIds = new Set<string>();
    if (candidate.products !== undefined && !Array.isArray(candidate.products)) {
      return { store: createDefaultHygieneStore(today), blocked: true };
    }
    for (const rawProduct of candidate.products ?? []) {
      if (!rawProduct || typeof rawProduct !== "object" || Array.isArray(rawProduct)) {
        return { store: createDefaultHygieneStore(today), blocked: true };
      }
      const product = rawProduct as Partial<HygieneProduct>;
      if (
        typeof product.id !== "string" || !product.id || productIds.has(product.id)
        || typeof product.name !== "string" || !product.name.trim()
        || typeof product.brand !== "string"
        || typeof product.category !== "string"
        || typeof product.description !== "string"
        || typeof product.instructions !== "string"
        || typeof product.frequency !== "string"
        || ["usageWhen", "usageAmount", "usageDuration", "precautions"].some((field) => {
          const value = product[field as keyof HygieneProduct];
          return value !== undefined && typeof value !== "string";
        })
        || typeof product.openedOn !== "string"
        || typeof product.expiresOn !== "string"
        || (product.paoMonths !== null && product.paoMonths !== undefined
          && (!Number.isInteger(product.paoMonths) || product.paoMonths < 1 || product.paoMonths > 60))
        || typeof product.amount !== "string"
        || (product.stockStatus !== "ok" && product.stockStatus !== "low")
        || typeof product.shopUrl !== "string"
        || (product.photoKey !== undefined && (typeof product.photoKey !== "string" || !product.photoKey))
        || typeof product.archived !== "boolean"
      ) return { store: createDefaultHygieneStore(today), blocked: true };
      productIds.add(product.id);
      products.push({
        id: product.id,
        name: product.name.trim(),
        brand: product.brand,
        category: product.category,
        description: product.description,
        instructions: product.instructions,
        frequency: product.frequency,
        usageWhen: product.usageWhen ?? "",
        usageAmount: product.usageAmount ?? "",
        usageDuration: product.usageDuration ?? "",
        precautions: product.precautions ?? "",
        openedOn: product.openedOn,
        expiresOn: product.expiresOn,
        paoMonths: product.paoMonths ?? null,
        amount: product.amount,
        stockStatus: product.stockStatus,
        shopUrl: product.shopUrl,
        photoKey: product.photoKey,
        archived: product.archived,
      });
    }

    const records: HygieneStore["records"] = {};
    for (const [date, dateRecords] of Object.entries(candidate.records)) {
      if (!dateRecords || typeof dateRecords !== "object" || Array.isArray(dateRecords)) {
        return { store: createDefaultHygieneStore(today), blocked: true };
      }
      records[date] = {};
      for (const [routineId, rawRecord] of Object.entries(dateRecords)) {
        if (!rawRecord || typeof rawRecord !== "object" || Array.isArray(rawRecord)) {
          return { store: createDefaultHygieneStore(today), blocked: true };
        }
        const record = rawRecord as Partial<HygieneRoutineRecord>;
        if (
          record.date !== date
          || record.routineId !== routineId
          || typeof record.routineTitle !== "string"
          || !Array.isArray(record.scheduledTasks)
          || !record.states
          || typeof record.states !== "object"
          || Array.isArray(record.states)
        ) {
          return { store: createDefaultHygieneStore(today), blocked: true };
        }
        const snapshots: HygieneTaskSnapshot[] = [];
        for (const rawSnapshot of record.scheduledTasks) {
          if (!rawSnapshot || typeof rawSnapshot !== "object" || Array.isArray(rawSnapshot)) {
            return { store: createDefaultHygieneStore(today), blocked: true };
          }
          const snapshot = rawSnapshot as Partial<HygieneTaskSnapshot>;
          if (
            typeof snapshot.id !== "string"
            || typeof snapshot.title !== "string"
            || typeof snapshot.section !== "string"
            || typeof snapshot.optional !== "boolean"
            || typeof snapshot.allowSkip !== "boolean"
          ) {
            return { store: createDefaultHygieneStore(today), blocked: true };
          }
          if (snapshot.originDate !== undefined && (
            typeof snapshot.originDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(snapshot.originDate)
          )) return { store: createDefaultHygieneStore(today), blocked: true };
          if (snapshot.products !== undefined && (
            !Array.isArray(snapshot.products)
            || snapshot.products.some((product) => !product || typeof product !== "object"
              || typeof product.id !== "string" || typeof product.name !== "string"
              || typeof product.brand !== "string" || typeof product.instructions !== "string"
              || ["usageWhen", "usageAmount", "usageDuration", "frequency", "precautions"].some((field) => {
                const value = product[field as keyof HygieneProductSnapshot];
                return value !== undefined && typeof value !== "string";
              })
              || (product.photoKey !== undefined && typeof product.photoKey !== "string"))
          )) return { store: createDefaultHygieneStore(today), blocked: true };
          snapshots.push({
            products: snapshot.products?.map((product) => ({
              id: product.id,
              name: product.name,
              brand: product.brand,
              instructions: product.instructions,
              usageWhen: product.usageWhen,
              usageAmount: product.usageAmount,
              usageDuration: product.usageDuration,
              frequency: product.frequency,
              precautions: product.precautions,
              photoKey: product.photoKey,
            })) ?? [],
            id: snapshot.id,
            originDate: snapshot.originDate,
            title: snapshot.title,
            section: snapshot.section,
            optional: snapshot.optional,
            allowSkip: snapshot.allowSkip,
          });
        }
        const states: Record<string, HygieneTaskStatus> = {};
        for (const [taskId, state] of Object.entries(record.states)) {
          if (state !== "done" && state !== "skipped" && state !== "omitted" && state !== "deferred") {
            return { store: createDefaultHygieneStore(today), blocked: true };
          }
          states[taskId] = state;
        }
        const completedOn: Record<string, string> = {};
        if (record.completedOn !== undefined) {
          if (!record.completedOn || typeof record.completedOn !== "object" || Array.isArray(record.completedOn)) {
            return { store: createDefaultHygieneStore(today), blocked: true };
          }
          for (const [taskId, date] of Object.entries(record.completedOn)) {
            if (states[taskId] !== "done" || typeof date !== "string"
              || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return { store: createDefaultHygieneStore(today), blocked: true };
            completedOn[taskId] = date;
          }
        }
        if (
          (record.archived !== undefined && typeof record.archived !== "boolean")
          || (record.carryToday !== undefined && typeof record.carryToday !== "boolean")
        ) {
          return { store: createDefaultHygieneStore(today), blocked: true };
        }
        records[date][routineId] = {
          date,
          routineId,
          routineTitle: record.routineTitle,
          scheduledTasks: snapshots,
          states,
          completedOn,
          archived: record.archived === true ? true : undefined,
          carryToday: record.carryToday === true ? true : undefined,
        };
      }
    }

    const manualDates: Record<string, string[]> = {};
    for (const [date, ids] of Object.entries(candidate.manualDates)) {
      if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string")) {
        return { store: createDefaultHygieneStore(today), blocked: true };
      }
      manualDates[date] = [...new Set(ids)];
    }

    const suppressedDates: Record<string, string[]> = {};
    if (candidate.suppressedDates !== undefined) {
      if (
        !candidate.suppressedDates
        || typeof candidate.suppressedDates !== "object"
        || Array.isArray(candidate.suppressedDates)
      ) {
        return { store: createDefaultHygieneStore(today), blocked: true };
      }
      for (const [date, ids] of Object.entries(candidate.suppressedDates)) {
        if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string")) {
          return { store: createDefaultHygieneStore(today), blocked: true };
        }
        suppressedDates[date] = [...new Set(ids)];
      }
    }

    const manualTaskDates: Record<string, string[]> = {};
    if (candidate.manualTaskDates !== undefined && (
      !candidate.manualTaskDates || typeof candidate.manualTaskDates !== "object" || Array.isArray(candidate.manualTaskDates)
    )) return { store: createDefaultHygieneStore(today), blocked: true };
    for (const [taskId, dates] of Object.entries(candidate.manualTaskDates ?? {})) {
      if (!Array.isArray(dates) || dates.some((date) => typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date))) {
        return { store: createDefaultHygieneStore(today), blocked: true };
      }
      manualTaskDates[taskId] = [...new Set(dates)];
    }
    const taskReschedules: Record<string, string> = {};
    if (candidate.taskReschedules !== undefined && (
      !candidate.taskReschedules || typeof candidate.taskReschedules !== "object" || Array.isArray(candidate.taskReschedules)
    )) return { store: createDefaultHygieneStore(today), blocked: true };
    for (const [key, date] of Object.entries(candidate.taskReschedules ?? {})) {
      if (!/^\d{4}-\d{2}-\d{2}\|[^|]+\|[^|]+$/.test(key) || typeof date !== "string"
        || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return { store: createDefaultHygieneStore(today), blocked: true };
      }
      taskReschedules[key] = date;
    }

    return {
      store: {
        version: 1,
        routines,
        products,
        records,
        manualDates,
        suppressedDates,
        manualTaskDates,
        taskReschedules,
        lastMaterializedDate: typeof candidate.lastMaterializedDate === "string" ? candidate.lastMaterializedDate : null,
      },
      blocked: false,
    };
  } catch {
    return { store: createDefaultHygieneStore(today), blocked: true };
  }
}

function dayDiff(from: string, to: string) {
  return Math.round((dateFromKey(to).getTime() - dateFromKey(from).getTime()) / 86_400_000);
}

export function scheduleMatches(schedule: HygieneSchedule, dateKey: string) {
  const date = dateFromKey(dateKey);
  const weekday = date.getDay();

  if (schedule.type === "daily") return true;
  if (schedule.type === "days") return schedule.weekdays.includes(weekday);
  if (schedule.type === "weekly") return weekday === schedule.weekday;
  if (schedule.type === "interval") {
    const difference = dayDiff(schedule.anchorDate, dateKey);
    return difference >= 0 && difference % schedule.everyDays === 0;
  }
  if (schedule.type === "rolling") return dateKey === schedule.anchorDate;
  if (schedule.type === "monthly") return date.getDate() === schedule.day;
  if (schedule.type === "nth-weekday") {
    return weekday === schedule.weekday && Math.ceil(date.getDate() / 7) === schedule.week;
  }
  return false;
}

function routineSuppressedOnDate(store: HygieneStore, routineId: string, dateKey: string) {
  return (store.suppressedDates[dateKey] ?? []).includes(routineId);
}

export function routineScheduledOnDate(store: HygieneStore, routine: HygieneRoutineDefinition, dateKey: string) {
  if (!routine.active || routineSuppressedOnDate(store, routine.id, dateKey)) return false;
  if (routine.schedule.type === "manual") return (store.manualDates[dateKey] ?? []).includes(routine.id);
  return scheduleMatches(routine.schedule, dateKey);
}

export function taskScheduledOnDate(task: HygieneTaskDefinition, dateKey: string, parentScheduled = true) {
  if (!task.active) return false;
  if (!task.schedule) return parentScheduled;
  if (task.schedule.type === "manual") return false;
  return scheduleMatches(task.schedule, dateKey);
}

export function hygieneRollingDueDate(store: HygieneStore, taskId: string, schedule: Extract<HygieneSchedule, { type: "rolling" }>, throughDate: string): string {
  const handled: Array<{ date: string; performed: string }> = [];
  for (const [date, routines] of Object.entries(store.records)) {
    if (date > throughDate || date < schedule.anchorDate) continue;
    for (const record of Object.values(routines)) {
      const status = record.states[taskId];
      if (!status || status === "deferred") continue;
      if (!record.scheduledTasks.some((task) => task.id === taskId)) continue;
      const performed = status === "done" ? record.completedOn?.[taskId] ?? date : date;
      if (performed <= throughDate) handled.push({ date, performed });
    }
  }
  if (!handled.length) return schedule.anchorDate;
  const latest = handled.sort((a, b) => b.performed.localeCompare(a.performed))[0];
  const interval = schedule.everyDays * (schedule.unit === "weeks" ? 7 : 1);
  return addDaysKey(latest.performed, interval);
}

function rescheduleOrigin(store: HygieneStore, routineId: string, taskId: string, date: string): string | undefined {
  for (const [key, target] of Object.entries(store.taskReschedules)) {
    if (target !== date) continue;
    const [origin, routine, task] = key.split("|");
    if (routine === routineId && task === taskId) return origin;
  }
  return undefined;
}

function taskDueOnDate(store: HygieneStore, routine: HygieneRoutineDefinition, task: HygieneTaskDefinition, date: string, parentScheduled: boolean): boolean {
  if (!task.active) return false;
  if (rescheduleOrigin(store, routine.id, task.id, date)) return true;
  const schedule = task.schedule ?? routine.schedule;
  if (schedule.type === "manual") return (store.manualTaskDates[task.id] ?? []).includes(date)
    || (!task.schedule && parentScheduled);
  if (schedule.type === "rolling") {
    const due = hygieneRollingDueDate(store, task.id, schedule, date);
    return due === date;
  }
  return taskScheduledOnDate(task, date, parentScheduled);
}

export function overdueHygieneTasks(store: HygieneStore, today: string) {
  const pending = new Map<string, { date: string; routineId: string; taskId: string; title: string; routineTitle: string }>();
  for (const [date, records] of Object.entries(store.records).sort(([a], [b]) => b.localeCompare(a))) {
    if (date >= today) continue;
    for (const [routineId, record] of Object.entries(records)) {
      const routine = store.routines.find((item) => item.id === routineId && item.active);
      if (!routine) continue;
      for (const snapshot of record.scheduledTasks) {
        const task = routine.tasks.find((item) => item.id === snapshot.id && item.active);
        if (!task || record.states[snapshot.id]) continue;
        const schedule = task.schedule ?? routine.schedule;
        // Daily routines are separate expected occurrences; don't flood the backlog with them.
        if (schedule.type === "daily") continue;
        if (!pending.has(task.id)) pending.set(task.id, {
          date, routineId, taskId: task.id, title: snapshot.title, routineTitle: record.routineTitle,
        });
      }
    }
  }
  return [...pending.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function postponeHygieneTask(store: HygieneStore, fromDate: string, routineId: string, taskId: string, toDate: string): HygieneStore {
  if (toDate <= fromDate || !/^\d{4}-\d{2}-\d{2}$/.test(toDate)) return store;
  const record = store.records[fromDate]?.[routineId];
  const snapshot = record?.scheduledTasks.find((item) => item.id === taskId);
  if (!record || !snapshot || record.states[taskId]) return store;
  const originDate = snapshot.originDate ?? fromDate;
  const next = setHygieneTaskStatus(store, fromDate, routineId, taskId, "deferred");
  return {
    ...next,
    taskReschedules: {
      ...next.taskReschedules,
      [originDate + "|" + routineId + "|" + taskId]: toDate,
    },
  };
}

export function planManualHygieneTask(store: HygieneStore, taskId: string, date: string): HygieneStore {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return store;
  return { ...store, manualTaskDates: {
    ...store.manualTaskDates,
    [taskId]: [...new Set([...(store.manualTaskDates[taskId] ?? []), date])],
  } };
}

export function productSnapshotsForTask(store: HygieneStore, task: HygieneTaskDefinition): HygieneProductSnapshot[] {
  return (task.productIds ?? []).map((id) => store.products.find((product) => product.id === id))
    .filter((product): product is HygieneProduct => Boolean(product && !product.archived))
    .map((product) => ({
      id: product.id,
      name: product.name,
      brand: product.brand,
      instructions: product.instructions,
      usageWhen: product.usageWhen,
      usageAmount: product.usageAmount,
      usageDuration: product.usageDuration,
      frequency: product.frequency,
      precautions: product.precautions,
      photoKey: product.photoKey,
    }));
}

function taskSnapshot(task: HygieneTaskDefinition): HygieneTaskSnapshot {
  return {
    // Avoid duplicating products/instructions for every scheduled or missed day.
    // Capture the actual products only when the task is marked done.
    id: task.id,
    title: task.title,
    section: task.section,
    optional: task.optional,
    allowSkip: task.allowSkip,
  };
}

function routineHasScheduledWorkOnDate(store: HygieneStore, routine: HygieneRoutineDefinition, dateKey: string) {
  if (!routine.active || routineSuppressedOnDate(store, routine.id, dateKey)) return false;
  const parentScheduled = routineScheduledOnDate(store, routine, dateKey);
  return routine.tasks.some((item) => taskDueOnDate(store, routine, item, dateKey, parentScheduled));
}

export function materializeHygieneDate(store: HygieneStore, dateKey: string, refresh = false): HygieneStore {
  const dateRecords = { ...(store.records[dateKey] ?? {}) };
  const scheduledRoutineIds = new Set<string>();
  let changed = false;

  for (const routine of store.routines) {
    if (!routine.active || routineSuppressedOnDate(store, routine.id, dateKey)) continue;
    const parentScheduled = routineScheduledOnDate(store, routine, dateKey);
    const scheduledTasks = routine.tasks
      .filter((item) => taskDueOnDate(store, routine, item, dateKey, parentScheduled))
      .map((item) => ({
        ...taskSnapshot(item),
        originDate: rescheduleOrigin(store, routine.id, item.id, dateKey),
      }));
    if (!scheduledTasks.length) continue;
    scheduledRoutineIds.add(routine.id);

    const existing = dateRecords[routine.id];
    if (!existing) {
      dateRecords[routine.id] = {
        date: dateKey,
        routineId: routine.id,
        routineTitle: routine.title,
        scheduledTasks,
        states: {},
        archived: undefined,
        carryToday: undefined,
      };
      changed = true;
      continue;
    }

    if (refresh) {
      const configuredTaskIds = new Set(scheduledTasks.map((item) => item.id));
      const preservedHandledTasks = existing.scheduledTasks.filter(
        (item) => !configuredTaskIds.has(item.id) && Boolean(existing.states[item.id]),
      );
      const nextScheduledTasks = [
        ...scheduledTasks.map((task) => existing.states[task.id]
          ? existing.scheduledTasks.find((previous) => previous.id === task.id) ?? task
          : task),
        ...preservedHandledTasks,
      ];
      const validTaskIds = new Set(nextScheduledTasks.map((item) => item.id));
      const states = Object.fromEntries(Object.entries(existing.states).filter(([taskId]) => validTaskIds.has(taskId)));
      const next = {
        ...existing,
        routineTitle: routine.title,
        scheduledTasks: nextScheduledTasks,
        states,
        archived: undefined,
        carryToday: undefined,
      };
      if (JSON.stringify(next) !== JSON.stringify(existing)) {
        dateRecords[routine.id] = next;
        changed = true;
      }
    }
  }

  if (refresh) {
    for (const routineId of Object.keys(dateRecords)) {
      if (scheduledRoutineIds.has(routineId)) continue;
      const existing = dateRecords[routineId];
      if (existing.carryToday && Object.keys(existing.states).length > 0) {
        if (existing.archived) {
          dateRecords[routineId] = { ...existing, archived: undefined };
          changed = true;
        }
        continue;
      }
      const hasHandledSnapshot = Object.keys(existing.states).length > 0;
      if (hasHandledSnapshot) {
        if (!existing.archived || existing.carryToday) {
          dateRecords[routineId] = { ...existing, archived: true, carryToday: undefined };
          changed = true;
        }
      } else {
        delete dateRecords[routineId];
        changed = true;
      }
    }
  }

  if (!changed && store.records[dateKey]) return store;
  return {
    ...store,
    records: {
      ...store.records,
      [dateKey]: dateRecords,
    },
  };
}

export function ensureHygieneHistory(store: HygieneStore, today: string): HygieneStore {
  let next = store;
  let cursor = store.lastMaterializedDate;

  if (!cursor) {
    next = materializeHygieneDate(next, today, true);
    return { ...next, lastMaterializedDate: today };
  }

  if (cursor < today) {
    let date = addDaysKey(cursor, 1);
    while (date <= today) {
      next = materializeHygieneDate(next, date, date === today);
      date = addDaysKey(date, 1);
    }
    next = { ...next, lastMaterializedDate: today };
  } else {
    next = materializeHygieneDate(next, today, true);
  }

  return next;
}

export function refreshHygieneToday(store: HygieneStore, today: string) {
  return materializeHygieneDate(store, today, true);
}

export function loadHygieneStore(today: string): { store: HygieneStore; blocked: boolean } {
  if (typeof window === "undefined") return { store: createDefaultHygieneStore(today), blocked: false };
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(HYGIENE_STORAGE_KEY);
  } catch {
    return { store: createDefaultHygieneStore(today), blocked: true };
  }

  const parsed = parseHygieneStore(raw, today);
  if (parsed.blocked) return parsed;
  const ensured = ensureHygieneHistory(parsed.store, today);
  try {
    window.localStorage.setItem(HYGIENE_STORAGE_KEY, JSON.stringify(ensured));
  } catch {
    return { store: parsed.store, blocked: true };
  }
  return { store: ensured, blocked: false };
}

export function saveHygieneStore(store: HygieneStore) {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(HYGIENE_STORAGE_KEY, JSON.stringify(store));
    window.dispatchEvent(new Event(HYGIENE_SYNC_EVENT));
    return true;
  } catch {
    return false;
  }
}

function completionTasks(record: HygieneRoutineRecord) {
  return record.scheduledTasks.filter((item) => !item.optional);
}

export function routineSummary(
  routine: HygieneRoutineDefinition,
  record: HygieneRoutineRecord,
  today: string,
): HygieneRoutineSummary {
  const base = completionTasks(record);
  const handled = base.filter((item) => Boolean(record.states[item.id])).length;
  const done = record.scheduledTasks.filter((item) => record.states[item.id] === "done").length;
  const skipped = record.scheduledTasks.filter((item) => record.states[item.id] === "skipped").length;
  const optionalDone = record.scheduledTasks.filter((item) => item.optional && record.states[item.id] === "done").length;
  const allSkipped = base.length > 0 && base.every((item) => record.states[item.id] === "skipped" || record.states[item.id] === "omitted");
  const deferred = base.some((item) => record.states[item.id] === "deferred");
  const complete = base.length === 0 || handled === base.length;
  const touched = Object.keys(record.states).length > 0;

  let status: HygieneRoutineStatus = "scheduled";
  if (allSkipped) status = "skipped";
  else if (deferred) status = "deferred";
  else if (complete) status = "complete";
  else if (touched) status = "partial";
  else if (record.date < today) status = "missed";

  return {
    routine,
    record,
    status,
    handled,
    total: base.length,
    done,
    skipped,
    optionalDone,
  };
}

export function scheduledRoutineSummaries(store: HygieneStore, dateKey: string, today = dateKey) {
  const dateRecords = store.records[dateKey] ?? {};
  return store.routines
    .filter((routine) => {
      const record = dateRecords[routine.id];
      if (!record || record.archived) return false;
      const hasHandledSnapshot = Object.keys(record.states).length > 0;
      return routineHasScheduledWorkOnDate(store, routine, dateKey) || hasHandledSnapshot;
    })
    .sort((left, right) => left.order - right.order)
    .map((routine) => routineSummary(routine, dateRecords[routine.id], today));
}

export function setHygieneTaskStatus(
  store: HygieneStore,
  dateKey: string,
  routineId: string,
  taskId: string,
  status: HygieneTaskStatus | null,
  performedOn = dateKey,
) {
  const record = store.records[dateKey]?.[routineId];
  if (!record) return store;
  if (!record.scheduledTasks.some((task) => task.id === taskId)) return store;
  const states = { ...record.states };
  const completedOn = { ...(record.completedOn ?? {}) };
  if (status === null) delete states[taskId];
  else states[taskId] = status;
  if (status === "done") completedOn[taskId] = performedOn;
  else delete completedOn[taskId];

  const definition = store.routines.find((routine) => routine.id === routineId)
    ?.tasks.find((task) => task.id === taskId);
  const scheduledTasks = record.scheduledTasks.map((task) => {
    if (task.id !== taskId) return task;
    if (status === "done") {
      // One historical snapshot per completed step, not one per planned day.
      return definition ? { ...task, products: productSnapshotsForTask(store, definition) } : task;
    }
    return { ...task, products: [] };
  });

  return {
    ...store,
    records: {
      ...store.records,
      [dateKey]: {
        ...store.records[dateKey],
        [routineId]: { ...record, states, completedOn, scheduledTasks },
      },
    },
  };
}

export function toggleManualRoutine(store: HygieneStore, dateKey: string, routineId: string, enabled: boolean) {
  const currentManual = store.manualDates[dateKey] ?? [];
  const currentSuppressed = store.suppressedDates[dateKey] ?? [];
  const nextManual = enabled
    ? [...new Set([...currentManual, routineId])]
    : currentManual.filter((id) => id !== routineId);
  const nextSuppressed = enabled
    ? currentSuppressed.filter((id) => id !== routineId)
    : [...new Set([...currentSuppressed, routineId])];
  const next: HygieneStore = {
    ...store,
    manualDates: { ...store.manualDates, [dateKey]: nextManual },
    suppressedDates: { ...store.suppressedDates, [dateKey]: nextSuppressed },
  };
  return refreshHygieneToday(next, dateKey);
}

export function overallHygieneProgress(summaries: HygieneRoutineSummary[]) {
  const total = summaries.reduce((sum, item) => sum + item.total, 0);
  const handled = summaries.reduce((sum, item) => sum + item.handled, 0);
  return {
    handled,
    total,
    percent: total ? Math.round((handled / total) * 100) : 0,
  };
}

export function routineStats(store: HygieneStore, routineId: string, today: string): HygieneRoutineStats {
  const routine = store.routines.find((item) => item.id === routineId);
  const entries = Object.entries(store.records)
    .filter(([date, records]) => date <= today && Boolean(records[routineId]))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, records]) => {
      const record = records[routineId];
      const definition = routine ?? {
        id: routineId,
        title: record.routineTitle,
        active: false,
        order: 999,
        schedule: { type: "manual" } as HygieneSchedule,
        tasks: [],
      };
      return routineSummary(definition, record, today);
    });

  let completedDays = 0;
  let skippedDays = 0;
  let skippedTasks = 0;
  let partialDays = 0;
  let missedDays = 0;
  let longestStreak = 0;
  let running = 0;

  for (const item of entries) {
    skippedTasks += item.skipped;
    if (item.status === "complete") {
      completedDays += 1;
      running += 1;
      longestStreak = Math.max(longestStreak, running);
    } else if (item.status === "skipped") {
      skippedDays += 1;
    } else {
      if (item.status === "partial") partialDays += 1;
      if (item.status === "missed" || item.status === "scheduled") missedDays += item.record.date < today ? 1 : 0;
      if (item.record.date < today || item.status === "partial") running = 0;
    }
  }

  let currentStreak = 0;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const item = entries[index];
    if (item.record.date === today && item.status !== "complete" && item.status !== "skipped") continue;
    if (item.status === "skipped") continue;
    if (item.status !== "complete") break;
    currentStreak += 1;
  }

  const counted = completedDays + partialDays + missedDays;
  return {
    plannedDays: entries.length,
    completedDays,
    skippedDays,
    skippedTasks,
    partialDays,
    missedDays,
    successRate: counted ? Math.round((completedDays / counted) * 100) : 0,
    currentStreak,
    longestStreak,
  };
}

export function historyStatusForDate(store: HygieneStore, routineId: string, dateKey: string, today: string): HygieneRoutineStatus | "not-scheduled" {
  const record = store.records[dateKey]?.[routineId];
  if (!record) return "not-scheduled";
  const routine = store.routines.find((item) => item.id === routineId) ?? {
    id: routineId,
    title: record.routineTitle,
    active: false,
    order: 999,
    schedule: { type: "manual" } as HygieneSchedule,
    tasks: [],
  };
  return routineSummary(routine, record, today).status;
}

export function scheduleLabel(schedule: HygieneSchedule) {
  const days = ["Ne", "Po", "Út", "St", "Čt", "Pá", "So"];
  if (schedule.type === "daily") return "Každý den";
  if (schedule.type === "days") return schedule.weekdays.map((day) => days[day]).join(" · ");
  if (schedule.type === "weekly") return "Každý " + days[schedule.weekday];
  if (schedule.type === "interval") return "Každých " + schedule.everyDays + " dní od data";
  if (schedule.type === "rolling") return "Po " + schedule.everyDays + (schedule.unit === "weeks" ? " týdnech" : " dnech") + " od posledního splnění";
  if (schedule.type === "monthly") return schedule.day + ". den v měsíci";
  if (schedule.type === "nth-weekday") return schedule.week + ". " + days[schedule.weekday] + " v měsíci";
  return "Bez pevné frekvence";
}

export function createRoutineId() {
  return "hygiene-routine-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
}

export function createTaskId() {
  return "hygiene-task-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
}
