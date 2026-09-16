const WEEK = ["Ne", "Po", "Út", "St", "Čt", "Pá", "So"];
const WEEK_MONDAY = ["Po", "Út", "St", "Čt", "Pá", "So", "Ne"];
const COLORS = { Finance: "blue", Matika: "violet", Angličtina: "green", "VŠE AJ": "cyan", Ekonomie: "orange", Rutina: "orange", Opakování: "violet", Plánování: "violet", "Flex blok": "blue", Vlastní: "blue" };
const PLAN = {
  0: [["Naplánovat další týden","14:00","14:30","Plánování"],["VŠE English test","15:00","16:00","VŠE AJ"],["Čtení knihy","22:40","23:00","Rutina"]],
  1: [["CFI / Excel","10:00","11:30","Finance"],["Matematika","12:00","13:00","Matika"],["Běžná angličtina","14:00","15:00","Angličtina"],["VŠE English test","15:00","16:00","VŠE AJ"],["Čtení knihy","22:40","23:00","Rutina"]],
  2: [["Ekonomie z učebnice","10:00","11:30","Ekonomie"],["Běžná angličtina","12:00","13:00","Angličtina"],["CFI / Excel","14:00","15:00","Finance"],["Čtení knihy","22:40","23:00","Rutina"]],
  3: [["Matematika","10:00","11:30","Matika"],["CFI / Excel","12:00","13:00","Finance"],["Běžná angličtina","14:00","15:00","Angličtina"],["VŠE English test","15:00","16:00","VŠE AJ"],["Čtení knihy","22:40","23:00","Rutina"]],
  4: [["Ekonomie z učebnice","10:00","11:30","Ekonomie"],["Matematika","12:00","13:00","Matika"],["Běžná angličtina","14:00","15:00","Angličtina"],["Čtení knihy","22:40","23:00","Rutina"]],
  5: [["CFI / Excel","10:00","11:30","Finance"],["Ekonomie z učebnice","12:00","13:00","Ekonomie"],["Opakování týdne","14:00","15:00","Opakování"],["VŠE English test","15:00","16:00","VŠE AJ"],["Čtení knihy","22:40","23:00","Rutina"]],
  6: [["Dohnat resty týdne","10:00","11:00","Flex blok"],["Běžná angličtina","12:00","13:00","Angličtina"],["Čtení knihy","22:40","23:00","Rutina"]]
};

const todayKey = () => new Date().toISOString().slice(0, 10);
const taskFromRow = (row, index) => ({ id: `${todayKey()}-${index}`, title: row[0], start: row[1], end: row[2], category: row[3], color: COLORS[row[3]] || "blue", completed: false });
const defaultMilestones = [
  { id: "vse", title: "Přijímací zkouška VŠE", date: "2027-04-05", note: "Hlavní termín" },
  { id: "cfi", title: "Dokončit CFI Excel", date: "2026-10-31", note: "Kurz a certifikát" },
  { id: "scio", title: "Začít přípravu SCIO", date: "2026-11-15", note: "Nový studijní blok" }
];
const defaultSettings = { dayEnd: "00:30", guardEnabled: true, notifications: true, blocked: ["youtube", "instagram", "tiktok", "netflix", "steam", "reddit"] };

function loadState() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem("dayframe-native-v1")); } catch (_) {}
  const tasks = saved?.date === todayKey() && Array.isArray(saved.tasks) ? saved.tasks : (PLAN[new Date().getDay()] || []).map(taskFromRow);
  return { date: todayKey(), tasks, milestones: saved?.milestones || defaultMilestones, settings: { ...defaultSettings, ...(saved?.settings || {}) }, weekly: saved?.weekly || [68, 91, 35, 0, 0, 0, 0] };
}

let state = loadState();
let focusRemaining = 50 * 60;
let focusRunning = false;
let focusTimer = null;
let guardTimer = null;
let strikes = [];
let lastInterventionAt = 0;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const save = () => localStorage.setItem("dayframe-native-v1", JSON.stringify(state));
const minutesBetween = (start, end) => { const [a,b] = start.split(":").map(Number); const [c,d] = end.split(":").map(Number); return c * 60 + d - (a * 60 + b); };
const daysUntil = (value) => { const now = new Date(); const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()); return Math.max(0, Math.ceil((new Date(`${value}T00:00:00`) - today) / 86400000)); };
const formatDate = (value) => new Intl.DateTimeFormat("cs-CZ", { day: "numeric", month: "long", year: "numeric" }).format(new Date(`${value}T00:00:00`));

function renderAll() {
  renderTasks(); renderMilestones(); renderSettings(); renderBlocked(); renderWeek(); updateNext(); updateCompletion(); updateRailMilestone();
}

function renderTasks() {
  const list = $("#task-list"); list.innerHTML = "";
  state.tasks.sort((a,b) => a.start.localeCompare(b.start)).forEach(task => {
    const row = document.createElement("button");
    row.className = `task-row${task.completed ? " done" : ""}`; row.dataset.color = task.color;
    row.innerHTML = `<span class="task-time">${task.start}<small>${task.end}</small></span><i class="task-color"></i><span class="task-copy"><strong class="task-name"></strong><small>${escapeHtml(task.category)} · ${minutesBetween(task.start, task.end)} min</small></span><span class="task-check">${task.completed ? "✓" : ""}</span>`;
    row.querySelector(".task-name").textContent = task.title;
    row.addEventListener("click", () => { task.completed = !task.completed; save(); renderAll(); });
    list.appendChild(row);
  });
}

function updateNext() {
  const task = state.tasks.find(item => !item.completed);
  $("#next-title").textContent = task?.title || "Dnešní plán je hotový";
  $("#next-meta").textContent = task ? `${task.start}–${task.end} · ${task.category}` : "MÁŠ VOLNO";
  $("#focus-task-title").textContent = task?.title || "Volný focus blok";
  $("#start-next").disabled = !task;
}

function updateCompletion() {
  const total = state.tasks.reduce((sum, task) => sum + minutesBetween(task.start, task.end), 0);
  const done = state.tasks.filter(task => task.completed).reduce((sum, task) => sum + minutesBetween(task.start, task.end), 0);
  const percent = total ? Math.round(done / total * 100) : 0;
  $("#completion-percent").textContent = `${percent}%`; $("#completed-time").textContent = `${Math.floor(done/60)} h ${done%60} min`;
  $("#completion-ring").style.setProperty("--angle", `${percent * 3.6}deg`);
  const dayIndex = (new Date().getDay() + 6) % 7; state.weekly[dayIndex] = percent; save();
}

function renderMilestones() {
  const grid = $("#milestone-grid"); grid.innerHTML = "";
  [...state.milestones].sort((a,b) => a.date.localeCompare(b.date)).forEach((item,index) => {
    const card = document.createElement("article"); card.className = `milestone-card${index === 0 ? " featured" : ""}`;
    card.innerHTML = `<p class="milestone-type">${escapeHtml(item.note || "Vlastní termín")}</p><h3></h3><strong class="days">${daysUntil(item.date)}</strong><span>dní zbývá</span><small>${formatDate(item.date)}</small><button type="button">Odstranit</button>`;
    card.querySelector("h3").textContent = item.title;
    card.querySelector("button").addEventListener("click", () => { state.milestones = state.milestones.filter(m => m.id !== item.id); save(); renderAll(); });
    grid.appendChild(card);
  });
}

function updateRailMilestone() {
  const next = [...state.milestones].filter(m => daysUntil(m.date) >= 0).sort((a,b) => a.date.localeCompare(b.date))[0];
  if (!next) return;
  $("#rail-milestone-title").textContent = next.title; $("#rail-days").textContent = daysUntil(next.date); $("#rail-date").textContent = formatDate(next.date);
}

function renderWeek() {
  const current = (new Date().getDay() + 6) % 7; const box = $("#week-bars"); box.innerHTML = "";
  state.weekly.forEach((value,index) => { const bar = document.createElement("div"); bar.className = `week-bar${index === current ? " current" : ""}`; bar.innerHTML = `<i style="height:${Math.max(8,value)}%"></i><span>${WEEK_MONDAY[index]}</span>`; box.appendChild(bar); });
}

function renderSettings() {
  $("#day-end").value = state.settings.dayEnd; $("#guard-enabled").checked = state.settings.guardEnabled; $("#settings-guard-enabled").checked = state.settings.guardEnabled; $("#notifications-enabled").checked = state.settings.notifications;
}

function renderBlocked() {
  const box = $("#blocked-tags"); box.innerHTML = "";
  state.settings.blocked.forEach(name => { const tag = document.createElement("span"); tag.className = "tag"; tag.textContent = name; box.appendChild(tag); });
  $("#blocked-input").value = state.settings.blocked.join(", ");
}

function updateClock() {
  const now = new Date(); const [hour,minute] = state.settings.dayEnd.split(":").map(Number); const target = new Date(now); target.setHours(hour,minute,0,0); if (target <= now) target.setDate(target.getDate()+1);
  const remaining = target - now; $("#hours").textContent = String(Math.floor(remaining/3600000)).padStart(2,"0"); $("#minutes").textContent = String(Math.floor(remaining%3600000/60000)).padStart(2,"0"); $("#seconds").textContent = String(Math.floor(remaining%60000/1000)).padStart(2,"0");
  $("#date-label").textContent = new Intl.DateTimeFormat("cs-CZ", { weekday:"long", day:"numeric", month:"long" }).format(now).toUpperCase();
}

function showView(name) {
  $$(".view").forEach(view => view.classList.toggle("active", view.id === `view-${name}`));
  $$(".nav-button").forEach(button => button.classList.toggle("active", button.dataset.view === name));
  $("#view-title").textContent = ({ today:"Dnešní rámec", focus:"Soustředění", milestones:"Milníky", settings:"Nastavení" })[name];
}

function startFocus() {
  if (focusRemaining <= 0) focusRemaining = 50 * 60;
  focusRunning = true; $("#toggle-focus").textContent = "Pozastavit"; $("#focus-status").textContent = "REŽIM SOUSTŘEDĚNÍ BĚŽÍ"; $("#agent-state").textContent = "Kontroluji aktivní program";
  if (!focusTimer) focusTimer = setInterval(() => { if (!focusRunning) return; focusRemaining = Math.max(0, focusRemaining-1); renderFocusTime(); if (!focusRemaining) stopFocus(true); },1000);
  startGuard();
}
function pauseFocus() { focusRunning = false; $("#toggle-focus").textContent = "Pokračovat"; $("#focus-status").textContent = "BLOK JE POZASTAVEN"; stopGuard(); }
function stopFocus(finished=false) { focusRunning = false; clearInterval(focusTimer); focusTimer = null; stopGuard(); $("#toggle-focus").textContent = "Spustit 50 minut"; $("#focus-status").textContent = finished ? "BLOK DOKONČEN" : "PŘIPRAVENO NA HLUBOKOU PRÁCI"; $("#agent-state").textContent = "Připraven zasáhnout"; }
function resetFocus() { stopFocus(); focusRemaining = 50*60; strikes = []; renderFocusTime(); }
function renderFocusTime() { $("#focus-minutes").textContent = String(Math.floor(focusRemaining/60)).padStart(2,"0"); $("#focus-seconds").textContent = String(focusRemaining%60).padStart(2,"0"); }

async function invoke(command, args={}) {
  if (!window.__TAURI__?.core?.invoke) return null;
  try { return await window.__TAURI__.core.invoke(command,args); } catch (error) { console.warn(`Dayframe command ${command} failed`, error); return null; }
}
function startGuard() { stopGuard(); if (!state.settings.guardEnabled) return; guardTimer = setInterval(checkActiveApp,2000); checkActiveApp(); }
function stopGuard() { if (guardTimer) clearInterval(guardTimer); guardTimer = null; $("#active-app").textContent = "Aktivní program se začne hlídat po spuštění focus bloku."; }
async function checkActiveApp() {
  if (!focusRunning || !state.settings.guardEnabled) return;
  const app = await invoke("get_active_app"); if (!app) { $("#active-app").textContent = "Hlídání funguje pouze v nainstalované Windows aplikaci."; return; }
  const description = `${app.processName || ""} ${app.windowTitle || ""}`.trim(); $("#active-app").textContent = description ? `Aktivní: ${description}` : "Aktivní program nelze přečíst.";
  const lowered = description.toLowerCase(); const match = state.settings.blocked.find(item => lowered.includes(item.toLowerCase()));
  if (match && Date.now() - lastInterventionAt > 8000) intervene(match, description);
}
async function intervene(match, description) {
  lastInterventionAt = Date.now(); const cutoff = Date.now() - 10*60*1000; strikes = strikes.filter(time => time > cutoff); strikes.push(Date.now()); const level = Math.min(3,strikes.length);
  const task = state.tasks.find(item => !item.completed); const taskName = task?.title || "svůj focus blok";
  const bodies = [`Teď máš dělat ${taskName}. Vrať se.`,`Tohle je druhé odbočení. ${match} teď není součást plánu.`,`Třetí odbočení. Než budeš pokračovat, řekni proč.`];
  if (state.settings.notifications) await invoke("notify_guard", { title: `Dayframe · zásah ${level}/3`, body: bodies[level-1] });
  if (level === 3) { await invoke("bring_dayframe_forward"); $("#intent-copy").textContent = `Otevřel jsi ${description || match}, ale právě máš dělat ${taskName}.`; $("#intent-dialog").showModal(); strikes = []; }
}

function escapeHtml(value) { const node = document.createElement("span"); node.textContent = value; return node.innerHTML; }

$$('[data-view]').forEach(button => button.addEventListener("click", () => showView(button.dataset.view)));
$("#start-next").addEventListener("click", () => { showView("focus"); startFocus(); });
$("#toggle-focus").addEventListener("click", () => focusRunning ? pauseFocus() : startFocus());
$("#reset-focus").addEventListener("click", resetFocus);
$("#open-task-dialog").addEventListener("click", () => $("#task-dialog").showModal());
$("#save-task").addEventListener("click", event => { event.preventDefault(); const title = $("#task-name").value.trim(); if (!title) return; state.tasks.push({ id: crypto.randomUUID(), title, start: $("#task-start").value, end: $("#task-end").value, category: $("#task-category").value.trim() || "Vlastní", color:"blue", completed:false }); save(); renderAll(); $("#task-name").value=""; $("#task-dialog").close(); });
$("#open-milestone-dialog").addEventListener("click", () => $("#milestone-dialog").showModal());
$("#save-milestone").addEventListener("click", event => { event.preventDefault(); const title=$("#milestone-name").value.trim(); const date=$("#milestone-date").value; if(!title||!date)return; state.milestones.push({id:crypto.randomUUID(),title,date,note:"Vlastní termín"}); save(); renderAll(); $("#milestone-name").value=""; $("#milestone-dialog").close(); });
$("#edit-blocked").addEventListener("click", () => $("#blocked-dialog").showModal());
$("#save-blocked").addEventListener("click", event => { event.preventDefault(); state.settings.blocked = $("#blocked-input").value.split(",").map(item=>item.trim()).filter(Boolean); save(); renderBlocked(); $("#blocked-dialog").close(); });
$("#day-end").addEventListener("change", event => { state.settings.dayEnd=event.target.value; save(); });
$("#notifications-enabled").addEventListener("change", event => { state.settings.notifications=event.target.checked; save(); });
[$("#guard-enabled"),$("#settings-guard-enabled")].forEach(input => input.addEventListener("change", event => { state.settings.guardEnabled=event.target.checked; save(); renderSettings(); if(focusRunning) startGuard(); }));
$("#return-focus").addEventListener("click", () => { $("#intent-reason").value=""; showView("focus"); });
$("#allow-break").addEventListener("click", () => pauseFocus());

renderAll(); renderFocusTime(); updateClock(); setInterval(updateClock,1000);
