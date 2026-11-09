import assert from "node:assert/strict";
import test from "node:test";
import { createStrategy, type DecisionInput, type OddsLike } from "../implementation/server/index.ts";
import { realOdds } from "./support/odds.ts";
import { computerTurn } from "../examples/consumer.ts";

type Call = { ranges: number | number[]; trials: number };
function stub(equity: number, calls: Call[] = []): OddsLike {
  return { winChance: (_h, _b, ranges, trials) => { calls.push({ ranges, trials }); return equity; } };
}
const half = () => 0.5; // noise is zero when the generator returns one half

function input(over: Partial<DecisionInput> = {}): DecisionInput {
  return {
    hole: ["Ac", "Kd"], board: ["2c", "7d", "9h"], street: "flop", stack: 5000, bet: 0, seat: 3, button: 1, seats: 9, sb: 25, bb: 50,
    currentBet: 0, lastFullRaiseTo: 0, pot: 200,
    legal: { fold: true, check: true, call: null, bet: { min: 50, max: 5000, opening: true } },
    opponents: [{ id: "o", seat: 5, bet: 0, totalIn: 100, lastAction: null }],
    ...over,
  };
}
const facing = (toCall: number, over: Partial<DecisionInput> = {}) => input({
  currentBet: toCall, bet: 0, pot: 200,
  legal: { fold: true, check: false, call: toCall, bet: null },
  opponents: [{ id: "o", seat: 5, bet: toCall, totalIn: 100 + toCall, lastAction: "bet" }], ...over,
});

test("not this player's turn gives no action", () => {
  const s = createStrategy({ odds: stub(0.9) });
  assert.equal(s.decide(input({ legal: { fold: false, check: false, call: null, bet: null } }), half), null);
});

test("settings are checked", () => {
  assert.throws(() => createStrategy({ odds: stub(0.5) }, { difficulty: 4 as 1 }), RangeError);
  assert.throws(() => createStrategy({ odds: stub(0.5) }, { aggression: 101 }), RangeError);
  assert.throws(() => createStrategy({ odds: stub(0.5) }, { aggression: -1 }), RangeError);
  assert.deepEqual(createStrategy({ odds: stub(0.5) }).settings, { difficulty: 2, aggression: 50 });
});

test("after the flop with nothing to call: a strong hand bets about the pot, a weak one checks", () => {
  const s = createStrategy({ odds: stub(0.9) });
  assert.deepEqual(s.decide(input(), half), { type: "bet", to: 150 });
  const medium = createStrategy({ odds: stub(0.6) });
  assert.deepEqual(medium.decide(input(), half), { type: "bet", to: 100 });
  assert.deepEqual(createStrategy({ odds: stub(0.2) }).decide(input(), half), { type: "check" });
});

test("a bet is clamped to the legal range and rounded to the small blind", () => {
  const s = createStrategy({ odds: stub(0.9) });
  const small = input({ pot: 20, legal: { fold: true, check: true, call: null, bet: { min: 50, max: 5000, opening: true } } });
  assert.deepEqual(s.decide(small, half), { type: "bet", to: 50 });
  const short = input({ pot: 4000, stack: 300, legal: { fold: true, check: true, call: null, bet: { min: 50, max: 300, opening: true } } });
  assert.deepEqual(s.decide(short, half), { type: "bet", to: 300 });
  const odd = input({ pot: 333 });
  const action = s.decide(odd, half);
  assert.equal(action?.type, "bet");
  assert.equal((action as { to: number }).to % 25, 0);
});

test("facing a bet: call above the pot odds, fold below, raise with a very strong hand", () => {
  assert.deepEqual(createStrategy({ odds: stub(0.65) }).decide(facing(200), half), { type: "call" });
  assert.deepEqual(createStrategy({ odds: stub(0.3) }).decide(facing(200), half), { type: "fold" });
  const raise = createStrategy({ odds: stub(0.95) }).decide(facing(200, { legal: { fold: true, check: false, call: 200, bet: { min: 400, max: 5000, opening: false } } }), half);
  assert.equal(raise?.type, "bet");
  assert.ok((raise as { to: number }).to >= 400);
});

test("a pre-flop short stack pushes with a good hand and otherwise folds to a raise", () => {
  const short = (over: Partial<DecisionInput> = {}) => input({ street: "preflop", board: [], stack: 400, currentBet: 100, bet: 0, lastFullRaiseTo: 100, bb: 50, pot: 175,
    legal: { fold: true, check: false, call: 100, bet: { min: 200, max: 400, opening: false } }, ...over });
  assert.deepEqual(createStrategy({ odds: stub(0.9) }).decide(short(), half), { type: "bet", to: 400 });
  assert.deepEqual(createStrategy({ odds: stub(0.2) }).decide(short(), half), { type: "fold" });
});

test("pre-flop with nothing to call: check without a strong hand", () => {
  const free = input({ street: "preflop", board: [], currentBet: 50, bet: 50, lastFullRaiseTo: 50, pot: 125, stack: 5000,
    legal: { fold: true, check: true, call: null, bet: { min: 100, max: 5050, opening: false } } });
  assert.deepEqual(createStrategy({ odds: stub(0.4) }).decide(free, half), { type: "check" });
});

test("aggression raises a hand that a passive setting only calls", () => {
  const open = input({ street: "preflop", board: [], currentBet: 50, bet: 0, lastFullRaiseTo: 50, pot: 75,
    legal: { fold: true, check: false, call: 50, bet: { min: 100, max: 5000, opening: false } }, opponents: [{ id: "o", seat: 2, bet: 50, totalIn: 50, lastAction: "blind" }] });
  const passive = createStrategy({ odds: stub(0.6) }, { aggression: 0 }).decide(open, half);
  const bold = createStrategy({ odds: stub(0.6) }, { aggression: 100 }).decide(open, half);
  assert.deepEqual(passive, { type: "call" });
  assert.equal(bold?.type, "bet");
  const styled = createStrategy({ odds: stub(0.6) }, { aggression: 0 }).decide({ ...open, style: { aggr: 1 } }, half);
  assert.equal(styled?.type, "bet");
});

test("difficulty sets how many boards are sampled and whether opponents are read", () => {
  const trials: Record<number, number[]> = {};
  const ranges: Record<number, (number | number[])[]> = {};
  for (const difficulty of [1, 2, 3] as const) {
    const calls: Call[] = [];
    const s = createStrategy({ odds: stub(0.5, calls) }, { difficulty });
    s.decide(input({ opponents: [{ id: "a", seat: 5, bet: 0, totalIn: 100, lastAction: "raise" }, { id: "b", seat: 6, bet: 0, totalIn: 100, lastAction: "call" }] }), half);
    s.decide(input({ board: [], street: "preflop", currentBet: 50, lastFullRaiseTo: 50, legal: { fold: true, check: false, call: 50, bet: { min: 100, max: 5000, opening: false } } }), half);
    trials[difficulty] = calls.map((c) => c.trials);
    ranges[difficulty] = calls.map((c) => c.ranges);
  }
  assert.deepEqual(trials[1], [120, 80]);
  assert.deepEqual(trials[2], [300, 200]);
  assert.deepEqual(trials[3], [900, 600]);
  assert.deepEqual(ranges[1][0], [0, 0]);
  assert.deepEqual(ranges[2][0], [7, 4]);
  assert.deepEqual(ranges[3][0], [7, 4]);
});

test("memory: an opponent seen betting often lowers the equity needed to call", () => {
  const spot = (overrides: Partial<DecisionInput> = {}) => facing(200, { pot: 200, ...overrides });
  // Without a read the opponent counts as 0.35 aggressive: needs 0.6, so 0.55 folds.
  assert.deepEqual(createStrategy({ odds: stub(0.55) }).decide(spot(), half, {}), { type: "fold" });
  const seen = { o: { actions: 8, aggressive: 8, calls: 0, folds: 0, vpip: 0, handsSeen: 4 } };
  assert.deepEqual(createStrategy({ odds: stub(0.55) }).decide(spot(), half, seen), { type: "call" });
  assert.deepEqual(createStrategy({ odds: stub(0.55) }, { difficulty: 1 }).decide(spot(), half, seen), { type: "fold" });
});

test("observe and learnHand keep the counts the reads use", () => {
  const s = createStrategy({ odds: stub(0.5) });
  const m: Record<string, { actions: number; aggressive: number; calls: number; folds: number; vpip: number; handsSeen: number }> = {};
  s.observe(m, { street: "preflop" }, "a", { type: "call" });
  s.observe(m, { street: "preflop" }, "a", { type: "bet", to: 200 });
  s.observe(m, { street: "flop" }, "a", { type: "fold" });
  s.observe(m, { street: "flop" }, "a", { type: "check" });
  s.learnHand(m, ["a", "b"]);
  assert.deepEqual(m.a, { actions: 4, aggressive: 1, calls: 1, folds: 1, vpip: 2, handsSeen: 1 });
  assert.equal(m.b.handsSeen, 1);
});

test("real odds: aces open, seven-deuce folds to a large raise, every bet is legal", () => {
  const s = createStrategy({ odds: realOdds }, { difficulty: 3 });
  let n = 7;
  const rng = () => { n = (n * 1103515245 + 12345) & 0x7fffffff; return n / 0x7fffffff; };
  const open = input({ hole: ["Ac", "Ad"], street: "preflop", board: [], currentBet: 50, bet: 0, lastFullRaiseTo: 50, pot: 75,
    legal: { fold: true, check: false, call: 50, bet: { min: 100, max: 5000, opening: false } }, opponents: [{ id: "o", seat: 2, bet: 50, totalIn: 50, lastAction: "blind" }] });
  const aces = s.decide(open, rng);
  assert.equal(aces?.type, "bet");
  assert.ok((aces as { to: number }).to >= 100 && (aces as { to: number }).to <= 5000);
  const trash = input({ hole: ["7c", "2d"], street: "preflop", board: [], currentBet: 400, bet: 0, lastFullRaiseTo: 400, pot: 475, stack: 1500,
    legal: { fold: true, check: false, call: 400, bet: { min: 750, max: 1500, opening: false } }, opponents: [{ id: "o", seat: 2, bet: 400, totalIn: 400, lastAction: "raise" }] });
  assert.deepEqual(s.decide(trash, rng), { type: "fold" });
});

test("consumer example runs without a game", () => {
  let n = 3;
  const rng = () => { n = (n * 1103515245 + 12345) & 0x7fffffff; return n / 0x7fffffff; };
  const action = computerTurn(realOdds, { hole: ["Ac", "Ad"], board: ["As", "Ah", "2c"], stack: 5000, pot: 300, toCall: 0, bigBlind: 50, opponents: 2 }, rng);
  assert.ok(action && ["bet", "check"].includes(action.type));
});

// ---- the computer-players form: newMemory, choose, observe ----

test("newMemory is a fresh empty plain object each time", () => {
  const s = createStrategy({ odds: stub(0.5) });
  const a = s.newMemory();
  assert.deepEqual(a, {});
  a.x = { actions: 1, aggressive: 0, calls: 0, folds: 0, vpip: 0, handsSeen: 0 };
  assert.deepEqual(s.newMemory(), {});
  assert.deepEqual(JSON.parse(JSON.stringify(a)), a);
});

test("choose gives the same move as decide for the same observation, whoever the player is", () => {
  const s = createStrategy({ odds: stub(0.95) });
  const memory = s.newMemory();
  for (const obs of [input(), facing(100), input({ street: "preflop", board: [], currentBet: 50, lastFullRaiseTo: 50, bet: 0, legal: { fold: true, check: false, call: 50, bet: { min: 100, max: 5000, opening: false } } })]) {
    assert.deepEqual(s.choose(obs, "p1", half, memory), s.decide(obs, half, memory));
    assert.deepEqual(s.choose(obs, "someone-else", half, memory), s.decide(obs, half, memory));
  }
  assert.notEqual(s.choose(input(), "p1", half, memory), null);
});

test("choose returns null when there is nothing to decide: no observation, not this player's turn, or not an observation", () => {
  const s = createStrategy({ odds: stub(0.9) });
  for (const none of [null, undefined, 5, "x", {}, { hole: ["Ac"] }, { ...input(), legal: null }, { ...input(), opponents: null }]) assert.equal(s.choose(none, "p", half, {}), null, JSON.stringify(none));
  assert.equal(s.choose(input({ legal: { fold: false, check: false, call: null, bet: null } }), "p", half, {}), null);
});

test("choose does not change the memory it is given, and works without one", () => {
  const s = createStrategy({ odds: stub(0.9) });
  const memory = s.newMemory();
  s.observe(memory, { street: "flop" }, "o", { type: "bet", to: 100 });
  const before = JSON.stringify(memory);
  for (let i = 0; i < 5; i++) s.choose(facing(100), "p", Math.random, memory);
  assert.equal(JSON.stringify(memory), before);
  assert.notEqual(s.choose(input(), "p", half), null);
});

test("choose never plays a bet outside what the rules allow, over many random draws (real odds)", () => {
  const s = createStrategy({ odds: realOdds });
  let seed = 7;
  const rng = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const observation = facing(100, { hole: ["7c", "2d"], board: ["Ks", "9h", "4d"], legal: { fold: true, check: false, call: 100, bet: { min: 200, max: 5000, opening: false } } });
  for (let i = 0; i < 30; i++) {
    const move = s.choose(observation, "p", rng, s.newMemory());
    assert.ok(move !== null);
    if (move.type === "bet") assert.ok(observation.legal.bet && move.to >= observation.legal.bet.min && move.to <= observation.legal.bet.max);
    if (move.type === "check") assert.equal(observation.legal.check, true);
  }
});

test("observe with an observation counts the mover from the observation's street and returns the same memory", () => {
  const s = createStrategy({ odds: stub(0.5) });
  const memory = s.newMemory();
  const pre = input({ street: "preflop" });
  assert.equal(s.observe(memory, pre, "a", { type: "call" }), memory);
  s.observe(memory, pre, "a", { type: "bet", to: 200 });
  s.observe(memory, input({ street: "flop" }), "a", { type: "fold" });
  s.observe(memory, input({ street: "river" }), "a", { type: "check" });
  assert.deepEqual(memory.a, { actions: 4, aggressive: 1, calls: 1, folds: 1, vpip: 2, handsSeen: 0 });
});

test("observe ignores moves it does not count and observations with no street, and never throws on them", () => {
  const s = createStrategy({ odds: stub(0.5) });
  const memory = s.newMemory();
  for (const move of [{ type: "show", cards: [0, 1] }, { type: "sitOut" }, null, undefined, 5, "fold"]) assert.equal(s.observe(memory, input(), "a", move), memory);
  assert.deepEqual(memory, {});
  s.observe(memory, null, "a", { type: "call" });
  s.observe(memory, {}, "b", { type: "call" });
  assert.equal(memory.a.vpip + memory.b.vpip, 0, "no street: a call is counted but not as a pre-flop entry");
  assert.deepEqual([memory.a.calls, memory.b.calls], [1, 1]);
});

test("memory written by observe is plain JSON and read back by choose, an aggressive opponent lowers the call bar", () => {
  const s = createStrategy({ odds: stub(0.45) });
  const calm = s.newMemory();
  const wild = s.newMemory();
  for (let i = 0; i < 12; i++) {
    s.observe(calm, input({ street: "flop" }), "o", { type: "check" });
    s.observe(wild, input({ street: "flop" }), "o", { type: "bet", to: 200 });
  }
  const restored = JSON.parse(JSON.stringify(wild));
  assert.deepEqual(restored, wild);
  const obs = facing(120);
  assert.deepEqual(s.choose(obs, "p", half, restored), s.choose(obs, "p", half, wild));
});
