export const DAY_SECONDS = 120;
export const SAVE_KEY = "home-office-life-save-v1";

const clamp = (value) => Math.max(0, Math.min(100, Math.round(value * 10) / 10));
const choice = (items, random) => items[Math.floor(random() * items.length)];

export function newGame() {
  const state = {
    version: 3, elapsed: 0, day: 1, age: 30, health: 82, energy: 72, mood: 68,
    money: 1000, job: "Employed",
    workedToday: false, moodCareToday: false, neglectedWork: 0, lowMoodDays: 0, lowHealthDays: 0,
    negativeBalanceHours: 0,
    sinceMealHours: 2, sinceSleepHours: 1, recoveryHours: 0, warnings: {}, location: "bed", activity: "idle", ended: null,
    worldEvent: { kind: "world", title: "A new day", text: "You wake to the familiar hum of the apartment.", deltas: [] },
    journal: [{ day: 1, hour: 8, text: "You wake to the familiar hum of the apartment." }]
  };
  state.dayStart = snapshot(state);
  return state;
}

export function hourOf(state) { return Math.floor((8 + state.elapsed / DAY_SECONDS * 24) % 24); }
export function seasonOf(day) { return ["Spring", "Summer", "Autumn", "Winter"][Math.floor((day - 1) / 10) % 4]; }

function wakefulnessCap(hoursAwake) {
  if (hoursAwake <= 8) return 100;
  return clamp(100 - (hoursAwake - 8) * 11.875);
}

function nourishmentCap(hoursWithoutFood) {
  if (hoursWithoutFood <= 8) return 100;
  if (hoursWithoutFood <= 24) return clamp(100 - (hoursWithoutFood - 8) * (55 / 16));
  return clamp(45 - (hoursWithoutFood - 24) * (45 / 24));
}

export function tick(state, realSeconds, speed = 1, { sleeping = false } = {}) {
  if (state.ended) return state;
  const previousDay = state.day;
  const gameSeconds = realSeconds * speed;
  const hours = gameSeconds / DAY_SECONDS * 24;
  const priorMealHours = state.sinceMealHours;
  const priorSleepHours = state.sinceSleepHours;
  const priorEnergy = state.energy;
  const recoveryExposure = Math.min(hours, state.recoveryHours || 0);
  state.elapsed += gameSeconds;
  state.sinceMealHours += hours;
  state.sinceSleepHours = sleeping ? 0 : state.sinceSleepHours + hours;
  state.recoveryHours = Math.max(0, (state.recoveryHours || 0) - hours);
  state.negativeBalanceHours = state.money < 0 ? (state.negativeBalanceHours || 0) + hours : 0;
  state.mood = clamp(state.mood - hours * (sleeping ? 0.08 : 0.2));
  const hungerPenalty = state.sinceMealHours > 10 ? 0.9 : 0;
  const fatiguePenalty = !sleeping && state.sinceSleepHours > 16 ? 1.6 : 0;
  state.energy = clamp(state.energy - hours * (sleeping ? 0.08 : 1.15 + hungerPenalty + fatiguePenalty));
  if (!sleeping) state.energy = Math.min(state.energy, wakefulnessCap(state.sinceSleepHours));
  const hungryExposure = exposure(priorMealHours, state.sinceMealHours, 10);
  const exhaustedExposure = sleeping ? 0 : exposure(priorSleepHours, state.sinceSleepHours, 16);
  const depletedPenalty = sleeping ? 0 : hours * (priorEnergy <= 0 ? 1.8 : state.energy <= 0 ? 1.2 : state.energy <= 20 ? 0.75 : 0);
  state.health = clamp(state.health + recoveryExposure * 0.6 - hungryExposure * 0.95 - exhaustedExposure * 1.65 - depletedPenalty);
  state.health = Math.min(state.health, nourishmentCap(state.sinceMealHours));
  thresholdEvents(state, priorMealHours, priorSleepHours);
  const derivedDay = Math.floor(state.elapsed / DAY_SECONDS) + 1;
  while (state.day < derivedDay) finishDay(state);
  if (state.day !== previousDay) state.age = 30 + Math.floor((state.day - 1) / 365);
  evaluateEnding(state);
  return state;
}

function exposure(before, after, threshold) {
  return Math.max(0, after - threshold) - Math.max(0, before - threshold);
}

function thresholdEvents(state, priorMealHours, priorSleepHours) {
  if (priorMealHours < 10 && state.sinceMealHours >= 10) {
    announce(state, "Hunger is setting in", "Janus has gone ten hours without food. Energy drains faster, and his maximum health will keep falling until he eats.", [], "warning");
  }
  if (priorSleepHours < 16 && state.sinceSleepHours >= 16) {
    announce(state, "Exhaustion is taking hold", "Janus has been awake for sixteen hours. His energy and health are now falling quickly.", [], "warning");
  }
}

function finishDay(state) {
  const before = state.dayStart || snapshot(state);
  const completedWork = state.workedToday;
  const caredForMood = state.moodCareToday;
  state.day += 1;
  state.money -= 80;
  if (state.job !== "Fired") {
    if (state.workedToday) {
      state.money += 100;
      state.neglectedWork = Math.max(0, state.neglectedWork - 1);
    } else {
      state.neglectedWork += 1;
      state.mood = clamp(state.mood - 3);
      if (state.neglectedWork >= 3) {
        state.job = "Fired";
      } else if (state.neglectedWork >= 1) state.job = "At risk";
    }
  }
  state.workedToday = false;
  state.moodCareToday = false;
  if (!caredForMood) state.mood = clamp(state.mood - 7);
  if (state.health < 18) state.lowHealthDays += 1; else state.lowHealthDays = 0;
  if (state.mood < 12) state.lowMoodDays += 1; else state.lowMoodDays = 0;
  const workText = state.job === "Fired" ? "The company has ended Janus's contract." : completedWork ? "Work was completed; €100 pay arrived." : "No work was completed, and the job is now at risk.";
  const moodText = caredForMood ? "Something in the day felt worthwhile." : "The empty routine weighed heavily on Janus.";
  announce(state, `Day ${state.day - 1} has passed`, `${workText} Living costs took €80. ${moodText}`, deltas(before, state), state.health < before.health || !caredForMood ? "warning" : "world", 0);
  state.dayStart = snapshot(state);
}

export const zones = {
  bed: { label: "The bed", copy: "The sheets remember every late night and every fresh start." },
  couch: { label: "The couch", copy: "A place to disappear for an hour—or make something honest." },
  window: { label: "The window", copy: "The city continues beyond the glass, whether you join it or not." },
  kitchen: { label: "The kitchen", copy: "A small counter can still hold a decent meal." },
  desk: { label: "The desk", copy: "Work, distraction, and possibility share the same screen." }
};

const catalog = {
  bed: [
    { id: "sleep", title: "Sleep properly", note: "8 hours · deeply restorative", duration: 8, sleep: true, effect: { energy: 62, health: 7, mood: 3 }, text: "You let the room go dark and give tomorrow a fair chance." },
    { id: "nap", title: "Take a short nap", note: "2 hours · restore some energy", duration: 2, sleep: true, effect: { energy: 24, mood: 2 }, text: "A short sleep softens the hard edges of the day." },
    { id: "scroll", title: "Scroll in bed", note: "1 hour · easy, rarely restorative", duration: 1, effect: { energy: -7, health: -3, mood: -3 }, text: "An hour dissolves into other people's lives." },
    { id: "snooze", title: "Hit snooze repeatedly", note: "1½ hours · little real recovery", duration: 1.5, sleep: true, effect: { energy: 9, health: -2, mood: -2 }, text: "Broken sleep leaves you unsure whether you rested at all." },
    { id: "podcast", title: "Listen to a science podcast", note: "1 hour · curious but screen-free", duration: 1, effect: { energy: -2, mood: 5 }, text: "A strange idea about deep space follows you into the quiet." },
    { id: "early", title: "Turn in early", note: "6 hours · sensible recovery", duration: 6, sleep: true, effect: { energy: 46, health: 4, mood: 2 }, text: "For once, you stop before the day has wrung you dry." }
  ],
  couch: [
    { id: "guitar", title: "Play the guitar", note: "2 hours · a strong mood lift", duration: 2, minEnergy: 10, moodCare: true, effect: { energy: -7, mood: 20 }, text: "A clumsy chord becomes a melody worth remembering." },
    { id: "read", title: "Read a good book", note: "2 hours · quiet restoration", duration: 2, moodCare: true, effect: { energy: -3, mood: 15 }, text: "For a while, the room grows larger than its walls." },
    { id: "binge", title: "Binge a series", note: "4 hours · comfortable, costly", duration: 4, effect: { energy: -14, mood: 5, health: -7 }, text: "One episode becomes four. The silence returns afterward." },
    { id: "game", title: "Start an old video game", note: "3 hours · nostalgic escape", duration: 3, moodCare: true, effect: { energy: -9, mood: 16 }, text: "The familiar start screen makes the room feel briefly weightless." },
    { id: "stretch", title: "Follow a yoga video", note: "1 hour · gentle movement", duration: 1, minEnergy: 8, moodCare: true, effect: { energy: -4, health: 6, mood: 10 }, text: "Several awkward poses later, your shoulders finally unclench." },
    { id: "album", title: "Listen to a whole album", note: "1 hour · no multitasking", duration: 1, moodCare: true, effect: { energy: -2, mood: 14 }, text: "You do nothing but listen, and the hour feels unusually complete." }
  ],
  window: [
    { id: "breathe", title: "Open the window", note: "30 minutes · clear your head", duration: .5, moodCare: true, effect: { mood: 9, energy: 2 }, text: "Cool air and distant traffic remind you the world is still there." },
    { id: "walk", title: "Go for a walk", note: "2 hours · good for body and mind", duration: 2, minEnergy: 15, moodCare: true, effect: { health: 8, energy: -8, mood: 18 }, text: "You walk without a destination and return more present than before." },
    { id: "neighbor", title: "Message an old friend", note: "1 hour · connection can surprise you", duration: 1, moodCare: true, effect: { mood: 24 }, text: "The reply comes quickly: ‘I was hoping you'd write.’" },
    { id: "jog", title: "Attempt a short jog", note: "1 hour · tiring but healthy", duration: 1, minEnergy: 30, moodCare: true, effect: { health: 10, energy: -14, mood: 12 }, text: "It is not graceful, but the air feels excellent afterward." },
    { id: "errand", title: "Browse the neighborhood shops", note: "2 hours · €30", duration: 2, cost: 30, minEnergy: 10, moodCare: true, effect: { energy: -6, mood: 14 }, text: "You return with good bread and proof that the city still exists." },
    { id: "people", title: "People-watch with tea", note: "1 hour · a quiet reset", duration: 1, moodCare: true, effect: { energy: -2, mood: 12 }, text: "Tiny lives cross the pavement below, each headed somewhere." }
  ],
  kitchen: [
    { id: "meal", title: "Cook a proper meal", note: "1½ hours · €16 · restores health", duration: 1.5, cost: 16, minEnergy: 12, meal: true, recoveryHours: 6, effect: { health: 18, energy: 18, mood: 4 }, text: "You chop, stir, taste—and sit down to something real." },
    { id: "simple", title: "Make pasta again", note: "45 minutes · €8 · restores health", duration: .75, cost: 8, minEnergy: 6, meal: true, recoveryHours: 3, effect: { energy: 12, health: 10 }, text: "It is simple, warm, and enough." },
    { id: "coffee", title: "Make strong coffee", note: "15 minutes · borrowed energy", duration: .25, cost: 2, effect: { energy: 16, health: -5 }, text: "The first sip feels like a plan. The second feels like momentum." },
    { id: "takeout", title: "Order spicy takeout", note: "45 minutes · €40 · some recovery", duration: .75, cost: 40, meal: true, recoveryHours: 2, effect: { health: 6, energy: 15, mood: 8 }, text: "The doorbell rings with far more excitement than it should." },
    { id: "snack", title: "Assemble a chaotic snack plate", note: "20 minutes · €7 · minimal recovery", duration: .33, cost: 7, meal: true, effect: { health: 3, energy: 7, mood: 2 }, text: "Crackers, cheese, and an apple become a meal by committee." },
    { id: "bake", title: "Try baking bread", note: "3 hours · €14 · restores health", duration: 3, cost: 14, minEnergy: 20, meal: true, moodCare: true, recoveryHours: 4, effect: { energy: 8, health: 10, mood: 18 }, text: "The loaf is lopsided, warm, and entirely yours." }
  ],
  desk: [
    { id: "work", title: "Focus on your job", note: "4 hours · protects your income", duration: 4, minEnergy: 25, work: true, effect: { energy: -18, mood: -4 }, text: "You close the distracting tabs and finish something difficult." },
    { id: "freelance", title: "Take a freelance ticket", note: "3 hours · earn €60 now", duration: 3, minEnergy: 20, income: 60, effect: { energy: -14, mood: -3 }, text: "A small bug, a clear invoice, and sixty euros earned outside the day job." },
    { id: "learn", title: "Learn something new", note: "3 hours · satisfying but demanding", duration: 3, minEnergy: 18, moodCare: true, effect: { energy: -12, mood: 13 }, text: "A difficult idea finally clicks. The future opens by a fraction." },
    { id: "side", title: "Build a tiny project", note: "4 hours · uncertain but meaningful", duration: 4, minEnergy: 25, moodCare: true, effect: { energy: -17, mood: 18 }, text: "You make a small thing that did not exist this morning.", chance: true },
    { id: "trade", title: "Try your luck trading", note: "2 hours · extremely risky", duration: 2, minEnergy: 8, effect: { energy: -8, health: -3, mood: -2 }, text: "Numbers flash across the screen.", gamble: true },
    { id: "opensource", title: "Fix an open-source bug", note: "3 hours · useful and absorbing", duration: 3, minEnergy: 20, moodCare: true, effect: { energy: -14, mood: 14 }, text: "Your tiny patch joins a project used by people you will never meet." },
    { id: "cleanup", title: "Clean up the desktop", note: "1 hour · digitally overdue", duration: 1, minEnergy: 5, effect: { energy: -4, mood: 5 }, text: "The files find folders. The folders get names. Order briefly wins." },
    { id: "doomscroll", title: "Doomscroll tech news", note: "2 hours · almost never worth it", duration: 2, effect: { energy: -10, health: -4, mood: -9 }, text: "Every headline demands urgency and leaves nothing useful behind." }
  ]
};

const ESSENTIAL_ACTIONS = { bed: ["sleep"], kitchen: ["meal", "coffee"], desk: ["work", "freelance"] };
export function actionsFor(zone, state, random = Math.random) {
  const available = catalog[zone].map(action => {
    const lowEnergy = action.minEnergy > state.energy;
    const unaffordable = action.cost && state.money - action.cost < -100;
    const unavailableWork = action.id === "work" && state.job === "Fired";
    return { ...action, disabled: Boolean(lowEnergy || unaffordable || unavailableWork), disabledReason: lowEnergy ? `Needs ${action.minEnergy} energy` : unaffordable ? "Credit limit reached" : unavailableWork ? "No job to return to" : "" };
  });
  const essentialIds = ESSENTIAL_ACTIONS[zone] || [];
  const essentials = essentialIds.map(id => available.find(action => action.id === id)).filter(Boolean);
  const pool = available.filter(action => !essentialIds.includes(action.id));
  for (let index = pool.length - 1; index > 0; index--) {
    const swap = Math.floor(random() * (index + 1));
    [pool[index], pool[swap]] = [pool[swap], pool[index]];
  }
  return [...essentials, ...pool].slice(0, 3);
}

export function perform(state, action, random = Math.random) {
  if (state.ended || action.disabled || action.minEnergy > state.energy || (action.cost && state.money - action.cost < -100)) return state;
  const before = snapshot(state);
  state.location = Object.entries(catalog).find(([, list]) => list.some(item => item.id === action.id))?.[0] || state.location;
  state.activity = action.id;
  state.money -= action.cost || 0;
  state.money += action.income || 0;
  for (const [key, delta] of Object.entries(action.effect || {})) state[key] = clamp(state[key] + delta);
  if (action.work) { state.workedToday = true; state.job = "Employed"; }
  if (action.moodCare) state.moodCareToday = true;
  if (action.meal) {
    state.sinceMealHours = 0;
    state.recoveryHours = action.recoveryHours || 0;
  }
  if (action.sleep) state.sinceSleepHours = 0;
  let text = action.text;
  if (action.gamble) {
    const won = random() < .38;
    const amount = won ? choice([70, 150, 300], random) : choice([120, 250, 450], random);
    state.money += won ? amount : -amount;
    state.mood = clamp(state.mood + (won ? 8 : -12));
    text = won ? `Against the odds, the numbers settle €${amount} in your favor.` : `The graph drops. €${amount} disappears before you can reconsider.`;
  }
  if (action.chance && random() < .14) {
    state.money += 120;
    text += " A stranger finds it online and pays €120 to use it.";
  }
  tick(state, action.duration / 24 * DAY_SECONDS, 1, { sleeping: Boolean(action.sleep) });
  announce(state, action.title, text, deltas(before, state), "action", hourOf(state));
  return state;
}

export function log(state, text, hour = hourOf(state)) {
  state.journal.unshift({ day: state.day, hour, text });
  state.journal = state.journal.slice(0, 100);
}

const TRACKED = ["health", "energy", "mood", "money"];
function snapshot(state) { return Object.fromEntries(TRACKED.map(key => [key, state[key]])); }
function deltas(before, after) {
  return TRACKED.flatMap(key => {
    const change = Math.round((after[key] - before[key]) * 10) / 10;
    return Math.abs(change) < .1 ? [] : [{ key, value: change }];
  });
}
function announce(state, title, text, changes = [], kind = "world", hour = hourOf(state)) {
  state.worldEvent = { kind, title, text, deltas: changes };
  log(state, `${title}: ${text}`, hour);
}

export function evaluateEnding(state) {
  if (state.health <= 0 || state.lowHealthDays >= 3) state.ended = { type: "loss", title: "The body keeps the score", copy: "After too many days without care, Janus's health gives out. A small life still needs tending." };
  else if (state.lowMoodDays >= 3) state.ended = { type: "loss", title: "The room grows too quiet", copy: "Janus can no longer continue alone. His story closes here—gently, without spectacle. Outside the window, help was always worth reaching for." };
  else if (state.money < -150 || state.negativeBalanceHours >= 24) state.ended = { type: "loss", title: "No longer home", copy: "Debt and overdue living costs have overwhelmed Janus. He has to leave the apartment behind." };
  else if (state.mood >= 85 && state.health >= 85 && state.money >= 2500 && state.day > 30) state.ended = { type: "win", title: "A life beyond the window", copy: "The small, steady choices became a direction. Janus is no longer waiting for life to begin—he is living it." };
  else if (state.day > 3650) state.ended = { type: "neutral", title: "Ten years, quietly lived", copy: "Janus is forty now. The room has changed in little ways, though life remains much as it was." };
  return state.ended;
}

export function serialize(state) { return JSON.stringify(state); }
export function deserialize(raw) {
  const parsed = JSON.parse(raw);
  if (![1, 2, 3].includes(parsed.version) || !Array.isArray(parsed.journal)) throw new Error("Unsupported save");
  if (parsed.version === 1) {
    parsed.sinceMealHours = Math.max(0, (100 - parsed.fullness) / 2.2);
    parsed.sinceSleepHours = Math.max(0, (100 - parsed.rest) / 2.1);
    parsed.warnings = {};
    parsed.worldEvent = { kind: "world", title: "Life continues", text: parsed.journal[0]?.text || "The apartment is quiet.", deltas: [] };
  }
  if (parsed.version < 3) {
    parsed.version = 3;
    delete parsed.fullness;
    delete parsed.rest;
    delete parsed.purpose;
    parsed.dayStart = snapshot(parsed);
  }
  parsed.recoveryHours ??= 0;
  parsed.moodCareToday ??= false;
  parsed.negativeBalanceHours ??= 0;
  return parsed;
}
