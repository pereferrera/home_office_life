import { DAY_SECONDS, SAVE_KEY, actionsFor, deserialize, hourOf, newGame, perform, seasonOf, serialize, tick, zones } from "./game.js";

const $ = (selector) => document.querySelector(selector);
const game = $("#game");
const title = $("#title-screen");
const actionDialog = $("#action-dialog");
let state = null;
let speed = 2;
let paused = false;
let lastFrame = performance.now();
let saveAccumulator = 0;
let audioContext;
let animationTimer;
let renderedEvent = "";

function hasSave() { try { return Boolean(localStorage.getItem(SAVE_KEY)); } catch { return false; } }
$("#continue-game").hidden = !hasSave();
if (new URLSearchParams(location.search).has("play")) start(newGame());

$("#new-game").addEventListener("click", () => start(newGame()));
$("#continue-game").addEventListener("click", () => {
  try { start(deserialize(localStorage.getItem(SAVE_KEY))); } catch { start(newGame()); }
});

function start(nextState) {
  state = nextState;
  title.hidden = true;
  game.hidden = false;
  render();
  lastFrame = performance.now();
}

function loop(now) {
  if (state && !paused && !state.ended) {
    const delta = Math.min(1, (now - lastFrame) / 1000);
    tick(state, delta, speed);
    saveAccumulator += delta;
    if (saveAccumulator > 2) { save(); saveAccumulator = 0; }
    render();
  }
  lastFrame = now;
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

function render() {
  if (!state) return;
  const season = seasonOf(state.day);
  const hour = hourOf(state);
  $("#date-label").textContent = `${season} · Day ${state.day}`;
  $("#time-label").textContent = `${String(hour).padStart(2, "0")}:00 · Age ${state.age}`;
  $("#season-icon").textContent = { Spring: "✿", Summer: "☀", Autumn: "◆", Winter: "❄" }[season];
  for (const key of ["health", "energy", "mood"]) {
    $(`#${key}-value`).textContent = Math.round(state[key]);
    $(`#${key}-meter`).value = state[key];
  }
  $("#money-value").textContent = new Intl.NumberFormat("en", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(state.money);
  $("#job-value").textContent = state.job;
  $("#job-value").className = state.job === "Employed" ? "good" : "warning";
  $("#day-progress").textContent = `Day ${state.day.toLocaleString()} of 3,650`;
  $("#latest-event").textContent = state.journal[0]?.text || "The room is quiet.";
  renderWorldEvent();
  $("#scene").dataset.time = hour >= 20 || hour < 6 ? "night" : hour < 7 || hour >= 19 ? "twilight" : "day";
  $("#scene").dataset.season = season.toLowerCase();
  const condition = Math.min(state.health, state.energy) <= 15 ? "critical" : Math.min(state.health, state.energy) <= 35 ? "exhausted" : Math.min(state.health, state.energy) <= 55 ? "tired" : "well";
  $("#scene").dataset.condition = condition;
  $("#condition-label").textContent = { well: "", tired: "TIRED", exhausted: "EXHAUSTED", critical: "IN CRISIS" }[condition];
  $("#janus").className = `janus at-${state.location} doing-${state.activity}`;
  $("#pause-toggle").textContent = paused ? "▶" : "Ⅱ";
  if (state.ended && !$("#ending-dialog").open) showEnding();
}

document.querySelectorAll(".hotspot").forEach(button => button.addEventListener("click", () => openActions(button.dataset.zone)));
function openActions(zone) {
  if (state.ended) return;
  paused = true;
  const info = zones[zone];
  $("#action-kicker").textContent = info.label.toUpperCase();
  $("#action-title").textContent = "What should Janus do?";
  $("#action-copy").textContent = info.copy;
  const list = $("#action-list");
  list.replaceChildren(...actionsFor(zone, state).map(action => {
    const button = document.createElement("button");
    button.disabled = action.disabled;
    button.innerHTML = `<span><strong>${action.title}</strong><small>${action.disabledReason || action.note}</small></span><b>›</b>`;
    button.addEventListener("click", () => {
      perform(state, action);
      clearTimeout(animationTimer);
      animationTimer = setTimeout(() => { if (state && !state.ended) { state.activity = "idle"; save(); render(); } }, action.id === "sleep" ? 6000 : 4000);
      chime(); save(); actionDialog.close(); paused = false; render();
    });
    return button;
  }));
  actionDialog.showModal();
}

function renderWorldEvent() {
  const event = state.worldEvent || { kind: "world", title: "Life continues", text: state.journal[0]?.text || "The room is quiet.", deltas: [] };
  $("#event-kind").textContent = event.kind === "action" ? "ACTION OUTCOME" : event.kind === "warning" ? "NEEDS ATTENTION" : "WORLD EVENT";
  $("#event-title").textContent = event.title;
  $("#event-message").textContent = event.text;
  const names = { health: "Health", energy: "Energy", mood: "Mood", money: "Balance" };
  $("#event-deltas").replaceChildren(...(event.deltas || []).map(delta => {
    const chip = document.createElement("span");
    const positive = delta.value > 0;
    chip.className = positive ? "positive" : "negative";
    const amount = delta.key === "money" ? `€${Math.abs(delta.value)}` : Math.abs(Math.round(delta.value));
    chip.textContent = `${names[delta.key]} ${positive ? "+" : "−"}${amount}`;
    return chip;
  }));
  const fingerprint = `${event.title}|${event.text}`;
  if (fingerprint !== renderedEvent) {
    renderedEvent = fingerprint;
    const panel = $("#world-event");
    panel.classList.remove("arrive");
    requestAnimationFrame(() => panel.classList.add("arrive"));
  }
}

document.querySelectorAll("[data-close]").forEach(button => button.addEventListener("click", () => button.closest("dialog").close()));
document.querySelectorAll("dialog:not([data-static])").forEach(dialog => dialog.addEventListener("close", () => { paused = false; }));
$("#pause-toggle").addEventListener("click", () => { paused = !paused; render(); showToast(paused ? "Time paused" : "Time resumes"); });
$("#menu-toggle").addEventListener("click", () => { paused = true; $("#menu-dialog").showModal(); });
$("#speed-select").addEventListener("change", event => { speed = Number(event.target.value); });
$("#journal-toggle").addEventListener("click", () => {
  paused = true;
  $("#journal-list").replaceChildren(...state.journal.map(entry => {
    const li = document.createElement("li");
    li.innerHTML = `<time>Day ${entry.day}, ${String(entry.hour).padStart(2, "0")}:00</time><p>${entry.text}</p>`;
    return li;
  }));
  $("#journal-dialog").showModal();
});
$("#restart-game").addEventListener("click", restart);
$("#ending-restart").addEventListener("click", restart);
function restart() {
  state = newGame();
  document.querySelectorAll("dialog[open]").forEach(dialog => dialog.close());
  paused = false; save(); render();
}

function showEnding() {
  $("#ending-kicker").textContent = state.ended.type === "win" ? "A NEW BEGINNING" : "THE END";
  $("#ending-title").textContent = state.ended.title;
  $("#ending-copy").textContent = state.ended.copy;
  paused = true; save(); $("#ending-dialog").showModal();
}
function save() { try { localStorage.setItem(SAVE_KEY, serialize(state)); } catch {} }
function showToast(text) { const toast = $("#toast"); toast.textContent = text; toast.classList.add("show"); setTimeout(() => toast.classList.remove("show"), 1800); }
$("#sound-toggle").addEventListener("click", event => { event.currentTarget.classList.toggle("muted"); event.currentTarget.textContent = event.currentTarget.classList.contains("muted") ? "×" : "♪"; chime(); });
function chime() {
  if ($("#sound-toggle").classList.contains("muted")) return;
  audioContext ||= new AudioContext();
  const oscillator = audioContext.createOscillator(); const gain = audioContext.createGain();
  oscillator.type = "sine"; oscillator.frequency.setValueAtTime(440, audioContext.currentTime); oscillator.frequency.exponentialRampToValueAtTime(660, audioContext.currentTime + .16);
  gain.gain.setValueAtTime(.06, audioContext.currentTime); gain.gain.exponentialRampToValueAtTime(.001, audioContext.currentTime + .35);
  oscillator.connect(gain).connect(audioContext.destination); oscillator.start(); oscillator.stop(audioContext.currentTime + .36);
}
