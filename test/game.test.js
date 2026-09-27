import test from "node:test";
import assert from "node:assert/strict";
import { actionsFor, deserialize, newGame, perform, serialize, tick } from "../src/game.js";

test("time advances and energy decays", () => {
  const state = newGame();
  tick(state, 10);
  assert.equal(state.day, 1);
  assert.ok(state.energy < 72);
});

test("doing nothing for a full day visibly harms energy and health", () => {
  const state = newGame();
  const initial = { energy: state.energy, health: state.health };
  tick(state, 120);
  tick(state, 120);
  assert.equal(state.day, 3);
  assert.equal(state.energy, 0);
  assert.ok(state.health < initial.health - 50);
  assert.equal(state.worldEvent.title, "Day 2 has passed");
  assert.ok(state.worldEvent.deltas.some(delta => delta.key === "health" && delta.value < 0));
});

test("a completed day charges rent and rewards work", () => {
  const state = newGame();
  const work = actionsFor("desk", state).find(action => action.id === "work");
  perform(state, work, () => .5);
  tick(state, 120);
  assert.ok(state.day >= 2);
  assert.equal(state.job, "Employed");
  assert.equal(state.money, 1020);
});

test("neglecting work eventually loses the job", () => {
  const state = newGame();
  tick(state, 360);
  assert.equal(state.job, "Fired");
});

test("actions apply costs and benefits", () => {
  const state = newGame();
  const meal = actionsFor("kitchen", state, () => .5).find(action => action.id === "meal");
  state.sinceMealHours = 18;
  perform(state, meal, () => .5);
  assert.equal(state.money, 984);
  assert.equal(state.sinceMealHours, 1.5);
  assert.ok(state.energy > 72);
  assert.equal(state.location, "kitchen");
  assert.equal(state.worldEvent.kind, "action");
  assert.ok(state.worldEvent.deltas.some(delta => delta.key === "energy" && delta.value > 0));
});

test("a proper meal visibly restores low health", () => {
  const state = newGame();
  state.health = 20;
  state.energy = 30;
  state.sinceMealHours = 20;
  const meal = actionsFor("kitchen", state, () => .5).find(action => action.id === "meal");
  perform(state, meal, () => .5);
  assert.ok(state.health >= 38);
  assert.ok(state.recoveryHours > 0);
});

test("health continues recovering for several hours after a proper meal", () => {
  const state = newGame();
  state.health = 20;
  state.energy = 50;
  state.sinceMealHours = 20;
  const meal = actionsFor("kitchen", state, () => .5).find(action => action.id === "meal");
  perform(state, meal, () => .5);
  const healthAfterMeal = state.health;
  tick(state, 10);
  assert.ok(state.health > healthAfterMeal);
  assert.ok(state.recoveryHours < 4.5);
});

test("sleep resets wakefulness while time advances", () => {
  const state = newGame();
  state.sinceSleepHours = 22;
  const sleep = actionsFor("bed", state, () => .5).find(action => action.id === "sleep");
  perform(state, sleep, () => .5);
  assert.equal(state.sinceSleepHours, 0);
  assert.ok(state.energy > 90);
  assert.equal(state.activity, "sleep");
});

test("each interaction offers three choices from a larger catalog", () => {
  const state = newGame();
  const first = actionsFor("couch", state, () => 0);
  const second = actionsFor("couch", state, () => .9);
  assert.equal(first.length, 3);
  assert.equal(second.length, 3);
  assert.notDeepEqual(first.map(action => action.id), second.map(action => action.id));
});

test("zero energy rapidly damages health", () => {
  const state = newGame();
  state.energy = 0;
  tick(state, 120);
  assert.ok(state.health < 40);
});

test("sixteen waking hours cap energy near zero regardless of prior energy", () => {
  const state = newGame();
  state.energy = 100;
  tick(state, 75);
  assert.equal(state.sinceSleepHours, 16);
  assert.ok(state.energy <= 5);
});

test("sleep removes the wakefulness energy ceiling", () => {
  const state = newGame();
  state.sinceSleepHours = 16;
  state.energy = 5;
  const sleep = actionsFor("bed", state, () => .5).find(action => action.id === "sleep");
  perform(state, sleep, () => .5);
  assert.equal(state.sinceSleepHours, 0);
  assert.ok(state.energy > 60);
});

test("sleep cannot hide the health cost of going without food", () => {
  const state = newGame();
  state.health = 100;
  const sleep = actionsFor("bed", state, () => .5).find(action => action.id === "sleep");
  perform(state, sleep, () => .5);
  perform(state, sleep, () => .5);
  assert.equal(state.sinceMealHours, 18);
  assert.ok(state.health <= 66);
});

test("forty-eight hours without food reduces health to zero even while sleeping", () => {
  const state = newGame();
  state.health = 100;
  tick(state, 230, 1, { sleeping: true });
  assert.equal(state.sinceMealHours, 48);
  assert.equal(state.health, 0);
  assert.equal(state.ended?.type, "loss");
});

test("zero energy blocks demanding actions but leaves sleep available", () => {
  const state = newGame();
  state.energy = 0;
  const work = actionsFor("desk", state, () => .5).find(action => action.id === "work");
  const sleep = actionsFor("bed", state, () => .5).find(action => action.id === "sleep");
  assert.equal(work.disabled, true);
  assert.match(work.disabledReason, /energy/);
  assert.equal(sleep.disabled, false);
});

test("careless finances can trigger a fast loss", () => {
  const state = newGame();
  state.money = -100;
  tick(state, 120);
  assert.equal(state.money, -180);
  assert.equal(state.ended?.type, "loss");
  assert.equal(state.ended?.title, "No longer home");
});

test("one continuous day below zero ends the game", () => {
  const state = newGame();
  state.money = -1;
  tick(state, 119);
  assert.equal(state.ended, null);
  tick(state, 1);
  assert.equal(state.negativeBalanceHours, 24);
  assert.equal(state.ended?.title, "No longer home");
});

test("returning to a positive balance resets the debt clock", () => {
  const state = newGame();
  state.money = -1;
  tick(state, 60);
  assert.equal(state.negativeBalanceHours, 12);
  state.money = 10;
  tick(state, 1);
  assert.equal(state.negativeBalanceHours, 0);
  assert.equal(state.ended, null);
});

test("kitchen and desk always include their anchor actions", () => {
  const state = newGame();
  for (const random of [0, .25, .5, .75, .99]) {
    const kitchen = actionsFor("kitchen", state, () => random).map(action => action.id);
    const desk = actionsFor("desk", state, () => random).map(action => action.id);
    assert.ok(kitchen.includes("meal"));
    assert.ok(kitchen.includes("coffee"));
    assert.ok(desk.includes("work"));
    assert.ok(desk.includes("freelance"));
  }
});

test("freelance work provides immediate secondary income", () => {
  const state = newGame();
  const freelance = actionsFor("desk", state, () => .5).find(action => action.id === "freelance");
  perform(state, freelance, () => .5);
  assert.equal(state.money, 1060);
});

test("an eat work sleep routine quickly ends in depression", () => {
  const state = newGame();
  for (let day = 0; day < 11 && !state.ended; day++) {
    const work = actionsFor("desk", state, () => .5).find(action => action.id === "work");
    const meal = actionsFor("kitchen", state, () => .5).find(action => action.id === "meal");
    const sleep = actionsFor("bed", state, () => .5).find(action => action.id === "sleep");
    perform(state, work, () => .5);
    perform(state, meal, () => .5);
    perform(state, sleep, () => .5);
    tick(state, 52.5);
  }
  assert.equal(state.mood, 0);
  assert.equal(state.ended?.title, "The room grows too quiet");
  assert.ok(state.day <= 11);
});

test("deliberate mood care strongly counters daily decay", () => {
  const state = newGame();
  state.mood = 30;
  const guitar = actionsFor("couch", state, () => .5).find(action => action.id === "guitar");
  perform(state, guitar, () => .5);
  tick(state, 110);
  assert.equal(state.day, 2);
  assert.ok(state.mood > 40);
  assert.equal(state.lowMoodDays, 0);
});

test("old saves migrate away from hidden dimensions", () => {
  const old = { ...newGame(), version: 2, fullness: 50, rest: 60, purpose: 20 };
  const migrated = deserialize(JSON.stringify(old));
  assert.equal(migrated.version, 3);
  assert.equal("fullness" in migrated, false);
  assert.equal("rest" in migrated, false);
  assert.equal("purpose" in migrated, false);
});

test("save data round trips", () => {
  const state = newGame();
  state.money = 432;
  assert.deepEqual(deserialize(serialize(state)), state);
});
