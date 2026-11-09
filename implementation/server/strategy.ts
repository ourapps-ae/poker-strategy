// Decisions for computer players: win chance by simulation, pot odds, position, a style (how tight,
// how aggressive, how often it bluffs) and a memory of how each opponent has played.
// Pure: the table state arrives as a DecisionInput, randomness as a function, the result is an action.
import type { Card, OddsLike } from "./types.ts";

export type Street = "preflop" | "flop" | "turn" | "river";

export type Action = { type: "fold" } | { type: "check" } | { type: "call" } | { type: "bet"; to: number };

// How a player plays: 0 to 1 each. Names and which player gets which style belong to the caller.
export type Style = { tight: number; aggr: number; bluff: number };

export type OpponentStats = { actions: number; aggressive: number; calls: number; folds: number; vpip: number; handsSeen: number };
export type StrategyMemory = { [playerId: string]: OpponentStats };

export type LastActionKind = "blind" | "fold" | "check" | "call" | "bet" | "raise" | "allIn";

export type Opponent = {
  id: string;
  seat: number;
  // Chips in front of the opponent this street, and in total this hand.
  bet: number;
  totalIn: number;
  lastAction: LastActionKind | null;
};

// What the strategy needs to know at its turn.
export type DecisionInput = {
  hole: Card[];
  board: Card[];
  street: Street;
  // Chips behind, and chips already in front this street.
  stack: number;
  bet: number;
  seat: number;
  button: number;
  seats: number;
  sb: number;
  bb: number;
  currentBet: number;
  lastFullRaiseTo: number;
  // Chips wagered this hand by everyone, folded players included.
  pot: number;
  // What the rules allow now: fold present means it is this player's turn. `bet` is a total for the street.
  legal: { fold: boolean; check: boolean; call: number | null; bet: { min: number; max: number; opening: boolean } | null };
  // Opponents still in the hand (not folded), all-in ones included.
  opponents: Opponent[];
  style?: Partial<Style>;
};

export type StrategySettings = {
  // 1 plays quickly and loosely, 2 is the reference strength, 3 samples more and plays steadier.
  difficulty: 1 | 2 | 3;
  // 0 to 100: how readily it bets and raises, used when the style gives no `aggr`.
  aggression: number;
};

export const DEFAULT_SETTINGS: StrategySettings = { difficulty: 2, aggression: 50 };

type Level = { preflopTrials: number; postflopTrials: number; noise: number; readsOpponents: boolean };

// Difficulty 2 is the recipe's computer player; 1 and 3 change sampling, noise and opponent reads.
const LEVELS: Record<1 | 2 | 3, Level> = {
  1: { preflopTrials: 80, postflopTrials: 120, noise: 0.16, readsOpponents: false },
  2: { preflopTrials: 200, postflopTrials: 300, noise: 0.08, readsOpponents: true },
  3: { preflopTrials: 600, postflopTrials: 900, noise: 0.04, readsOpponents: true },
};

export type Strategy = {
  settings: StrategySettings;
  // The action to take, or null when it is not this player's turn.
  decide(input: DecisionInput, rng: () => number, memory?: StrategyMemory): Action | null;
  // Count how a player acted, for the read other decisions make on them. `observation` is the one the mover had (its
  // `street` is used). Changes `memory` in place and returns it.
  observe(memory: StrategyMemory, observation: { street?: Street | null } | null, playerId: string, action: unknown): StrategyMemory;
  // A fresh, empty memory (plain JSON).
  newMemory(): StrategyMemory;
  // The computer-players form of `decide`: `observation` is a DecisionInput (or null when the game has none, such as
  // when it is not this player's turn). Returns the move or null. Never changes `memory`.
  choose(observation: unknown, playerId: string, rng: () => number, memory?: StrategyMemory): Action | null;
  // A hand was dealt to these players.
  learnHand(memory: StrategyMemory, playerIds: string[]): void;
};

export function emptyStats(): OpponentStats {
  return { actions: 0, aggressive: 0, calls: 0, folds: 0, vpip: 0, handsSeen: 0 };
}

export function createStrategy(deps: { odds: OddsLike }, settings: Partial<StrategySettings> = {}): Strategy {
  const merged = { ...DEFAULT_SETTINGS, ...settings };
  if (![1, 2, 3].includes(merged.difficulty)) throw new RangeError("difficulty is 1, 2 or 3");
  if (!Number.isFinite(merged.aggression) || merged.aggression < 0 || merged.aggression > 100) throw new RangeError("aggression is 0 to 100");
  const level = LEVELS[merged.difficulty];
  const { odds } = deps;

  const styleOf = (style: Partial<Style> | undefined): Style => ({ tight: style?.tight ?? 0.5, aggr: style?.aggr ?? merged.aggression / 100, bluff: style?.bluff ?? 0.3 });

  function decide(input: DecisionInput, rng: () => number, memory: StrategyMemory = {}): Action | null {
    const { legal, board } = input;
    if (!legal.fold) return null;
    const seats = input.seats;
    const dist = (seat: number, from: number) => (((seat - from) % seats) + seats) % seats || seats;
    const live = input.opponents;
    const n = live.length;
    const pot = input.pot;
    const toCall = legal.call ?? 0;
    const pers = styleOf(input.style);
    const bb = input.bb;
    const ranges = live.map((p) => (level.readsOpponents ? assumedRange(p, bb) : 0));
    const e = odds.winChance(input.hole, board, ranges, board.length ? level.postflopTrials : level.preflopTrials, rng);
    const r = e * (n + 1);
    const potOdds = toCall > 0 ? toCall / (pot + toCall) : 0;
    const noise = (rng() - 0.5) * level.noise;
    const aggrOpp = level.readsOpponents ? average(live.map((p) => aggression(memory[p.id]))) : 0.35;
    const total = input.stack + input.bet;
    // Share of the stack this call would cost: big commitments need big hands.
    const commit = total > 0 ? toCall / total : 1;
    const late = live.filter((p) => dist(p.seat, input.button) > dist(input.seat, input.button)).length <= 1;

    const raiseTo = (want: number): Action | null => {
      if (!legal.bet) return null;
      const rounded = Math.round(want / input.sb) * input.sb;
      return { type: "bet", to: Math.min(legal.bet.max, Math.max(legal.bet.min, rounded)) };
    };
    const callOrCheck = (): Action => (toCall > 0 ? { type: "call" } : { type: "check" });
    const foldOrCheck = (): Action => (toCall > 0 ? { type: "fold" } : { type: "check" });

    if (input.street === "preflop") {
      const stackBB = total / bb;
      const unopened = input.lastFullRaiseTo === bb;
      // Facing a raise (or a re-raise) takes a much better hand than opening does.
      const facing = input.currentBet / bb;
      const heat = facing <= 1 ? 0 : facing < 6 ? 0.4 : 0.7;
      const raiseT = 1.3 - 0.25 * pers.aggr - (late ? 0.1 : 0) + 0.2 * pers.tight + heat + noise;
      const callT = 1.0 - 0.15 * (1 - pers.tight) + noise;
      if (stackBB < 12 && legal.bet) {
        const pushT = (unopened ? 1.25 : 1.45) - 0.15 * pers.aggr;
        if (r > pushT || (toCall === 0 && r > 1.05 && rng() < pers.aggr * 0.5)) return raiseTo(legal.bet.max);
        if (toCall === 0) return { type: "check" };
        return potOdds < 0.2 && r > 0.95 ? { type: "call" } : { type: "fold" };
      }
      if (legal.bet && r > raiseT + 0.5 * commit) {
        const limpers = live.filter((p) => p.totalIn >= bb && p.bet === input.currentBet).length;
        const want = unopened ? bb * 2.5 + limpers * bb : input.currentBet * (2.2 + 0.6 * pers.aggr);
        return raiseTo(want);
      }
      if (toCall === 0) return legal.bet && r > 1.05 && rng() < pers.aggr * 0.2 ? raiseTo(bb * 3) ?? { type: "check" } : { type: "check" };
      if (commit > 0.3) return r > 1.75 ? { type: "call" } : { type: "fold" };
      if (r > 1.45 || (r > 1.25 && commit <= 0.1)) return { type: "call" };
      if (r > callT && toCall <= Math.max(0.15 * total, 3 * bb)) return { type: "call" };
      if (n === 1 && toCall <= bb && r > 0.85) return { type: "call" };
      return { type: "fold" };
    }

    const streetNo = input.street === "flop" ? 0 : input.street === "turn" ? 1 : 2;
    const betT = 0.5 + 0.12 * (n - 1) - 0.15 * pers.aggr + 0.1 * pers.tight + 0.05 * streetNo + noise;
    if (toCall === 0) {
      if (legal.bet && e > betT) return raiseTo(pot * (e > 0.8 ? 0.75 : 0.55)) ?? callOrCheck();
      if (legal.bet && n <= 2 && rng() < pers.bluff * 0.25) return raiseTo(pot * 0.5) ?? callOrCheck();
      return { type: "check" };
    }
    const needed = Math.max(potOdds * (1 + 0.4 * pers.tight) - 0.15 * (aggrOpp - 0.35), 0.3 + 0.55 * commit);
    if (legal.bet && e > 0.75 - 0.1 * pers.aggr + 0.25 * commit + noise) {
      const want = total / pot < 1.5 ? legal.bet.max : Math.max(input.currentBet * 2.5, pot * 0.7);
      return raiseTo(want) ?? callOrCheck();
    }
    if (e > needed) return { type: "call" };
    if (legal.bet && n === 1 && toCall < 0.3 * pot && rng() < pers.bluff * 0.12) return raiseTo(input.currentBet * 3) ?? foldOrCheck();
    return { type: "fold" };
  }

  // What an opponent's play so far says about their cards: raisers hold the top quarter or so,
  // callers the top half, blinds and checkers anything.
  function assumedRange(p: Opponent, bb: number): number {
    const k = p.lastAction;
    if (k === "raise" || k === "allIn" || k === "bet") return 7;
    if (p.totalIn > bb || k === "call") return 4;
    return 0;
  }

  function observe(memory: StrategyMemory, observation: { street?: Street | null } | null, playerId: string, move: unknown): StrategyMemory {
    const street = observation?.street ?? null;
    const action = move as Action | null;
    if (!action || (action.type !== "fold" && action.type !== "check" && action.type !== "call" && action.type !== "bet")) return memory;
    const s = (memory[playerId] ??= emptyStats());
    s.actions += 1;
    if (action.type === "bet") s.aggressive += 1;
    if (action.type === "call") s.calls += 1;
    if (action.type === "fold") s.folds += 1;
    if (street === "preflop" && (action.type === "call" || action.type === "bet")) s.vpip += 1;
    return memory;
  }

  function newMemory(): StrategyMemory {
    return {};
  }

  // A DecisionInput has these; anything else (null, a view with no hole cards) is not a turn to decide.
  const isDecisionInput = (x: unknown): x is DecisionInput => {
    const d = x as DecisionInput | null;
    return !!d && typeof d === "object" && Array.isArray(d.hole) && Array.isArray(d.board) && Array.isArray(d.opponents) && !!d.legal && typeof d.legal === "object";
  };

  function choose(observation: unknown, _playerId: string, rng: () => number, memory: StrategyMemory = {}): Action | null {
    return isDecisionInput(observation) ? decide(observation, rng, memory) : null;
  }

  function learnHand(memory: StrategyMemory, playerIds: string[]): void {
    for (const id of playerIds) (memory[id] ??= emptyStats()).handsSeen += 1;
  }

  return { settings: merged, decide, observe, learnHand, newMemory, choose };
}

function average(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0.35;
}

function aggression(s: OpponentStats | undefined): number {
  if (!s || s.actions < 6) return 0.35;
  return s.aggressive / s.actions;
}
