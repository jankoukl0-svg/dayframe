import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const [base, head = "HEAD"] = process.argv.slice(2);
if (!base) {
  console.error("Usage: node scripts/select-e2e-tests.mjs <base-sha> [head-sha]");
  process.exit(2);
}

const webRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  cwd: webRoot,
  encoding: "utf8",
}).trim();

const changed = execFileSync("git", ["diff", "--name-only", `${base}...${head}`], {
  cwd: repoRoot,
  encoding: "utf8",
})
  .split("\n")
  .map((entry) => entry.trim())
  .filter(Boolean);

const availableSpecs = new Set(
  readdirSync(path.join(webRoot, "e2e")).filter((name) => name.endsWith(".spec.mjs")),
);
const selected = new Set();

function add(name) {
  if (availableSpecs.has(name)) selected.add(name);
}

function addPrefix(prefix) {
  for (const name of availableSpecs) {
    if (name.startsWith(prefix)) selected.add(name);
  }
}

for (const file of changed) {
  if (file.startsWith("web/e2e/") && file.endsWith(".spec.mjs")) {
    add(path.basename(file));
  }

  const lower = file.toLowerCase();
  const ext = path.extname(lower);
  const stem = path.basename(lower, ext);
  const derivedStems = new Set([
    stem,
    stem.replace(/-controller$/, ""),
    stem.replace(/-view$/, ""),
    stem.replace(/-model$/, ""),
  ]);

  if (file.startsWith("web/app/") || file.startsWith("web/lib/")) {
    for (const derivedStem of derivedStems) {
      add(`${derivedStem}.spec.mjs`);
      addPrefix(`${derivedStem}-`);
    }
  }

  if (lower.includes("daily-checklist")) add("daily-checklist.spec.mjs");

  if (lower.includes("reading")) {
    addPrefix("reading-");
    add("overview-reading-order.spec.mjs");
  }

  if (lower.includes("focus")) {
    addPrefix("focus-");
    add("active-completion-safety.spec.mjs");
    add("execution-tracking.spec.mjs");
  }

  if (lower.includes("jarvis")) {
    addPrefix("jarvis-");
    add("today-briefing.spec.mjs");
  }

  if (lower.includes("milestone")) {
    addPrefix("milestone-");
    add("month-calendar.spec.mjs");
  }

  if (lower.includes("routine")) addPrefix("routine-");
  if (lower.includes("label")) addPrefix("label-");
  if (lower.includes("notification")) add("notifications.spec.mjs");
  if (lower.includes("google-calendar")) addPrefix("google-calendar");

  if (
    lower.includes("week") ||
    lower.includes("calendar") ||
    lower.includes("planning") ||
    lower.includes("dayframe-calendar")
  ) {
    add("dayframe-calendar.spec.mjs");
    addPrefix("week-");
    add("cross-day-move-safety.spec.mjs");
  }

  if (
    file === "web/app/dayframe-v2.tsx" ||
    file === "web/app/dayframe-v2.css" ||
    file === "web/preview/main.tsx" ||
    file === "web/app/page.tsx"
  ) {
    add("dayframe-calendar.spec.mjs");
    add("visual-harmony.spec.mjs");
    add("today-briefing.spec.mjs");
  }
}

if (selected.size === 0) {
  add("dayframe-calendar.spec.mjs");
  add("visual-harmony.spec.mjs");
}

process.stdout.write([...selected].sort().join(" "));
