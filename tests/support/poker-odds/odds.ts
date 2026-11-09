// What a player's hand can still become, and the chance of holding the best hand.
// `rows`: the hand already made with the known cards comes first at 100%; then every way of making
// a better hand (the known cards it uses and the cards it still needs) with the chance that those
// needed cards turn up by the river, whatever else comes. The chances are counted exactly; which
// ways exist is read from the boards that can follow: all of them from the flop on, a fixed sample
// before it. `winChance`: the chance of the best hand against opponents, by sampling.
import type { Card, Evaluation, HandRanking, Needed, OddsCard, OddsRow } from "./types.ts";

export type OddsSettings = {
  // Boards sampled before the flop (more than two cards still to come).
  sampleBoards: number;
  // Results kept for the same cards.
  cacheSize: number;
};

export const DEFAULT_SETTINGS: OddsSettings = { sampleBoards: 2000, cacheSize: 500 };

export type Odds = {
  rows(hole: Card[], board: Card[], trials?: number): OddsRow[];
  chance(category: string, needed: Needed[], known: Card[], toCome: number): number;
  shownCards(hole: Card[], board: Card[], kickers?: number): OddsCard[];
  // Chance of holding the best hand at the river, by sampling. `ranges` gives, per opponent, the
  // lowest starting score they are assumed to hold (or a count of unconstrained opponents).
  winChance(hole: Card[], board: Card[], ranges: number | number[], trials: number, rng: () => number): number;
  // Chen's preflop score for two cards: high card, pair, suited and connected. -1 to 20.
  startingScore(cards: Card[]): number;
};

// Categories as rows, best first; a royal flush gets its own row.
const ORDER = ["royalFlush", "straightFlush", "fourOfAKind", "fullHouse", "flush", "straight", "threeOfAKind", "twoPair", "pair", "highCard"] as const;
// Rows under this chance are dropped.
const MIN_ROW = 0.002;

// The way a hand is made: its known cards, the cards still needed, and the rank groups in the
// order they are read (the trips before the pair of a full house, the high card of a straight).
type Pattern = { hole: Card[]; board: Card[]; needed: Needed[]; groups: number[] };
type Spare = { spareHole: Card[]; spareBoard: Card[] };

function choose(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 0; i < k; i++) r = (r * (n - i)) / (i + 1);
  return r;
}

// The same sample of boards for the same cards, so the list does not change between looks.
function seeded(cards: Card[]): () => number {
  let h = 2166136261;
  for (const ch of [...cards].sort().join("")) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => {
    h = (h + 0x6d2b79f5) | 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createOdds(ranking: HandRanking, settings: Partial<OddsSettings> = {}): Odds {
  const { sampleBoards, cacheSize } = { ...DEFAULT_SETTINGS, ...settings };
  const { codes, evaluate, bestFive, patternCards } = ranking;
  const { ranks: RANKS, suits: SUITS, rankOf, suitOf, fullDeck } = codes;
  const categoryOf = (ev: Evaluation) => (ev.category === "straightFlush" && ev.ranks[0] === 12 ? "royalFlush" : ev.category);
  const rankOfCategory = (cat: string) => ORDER.indexOf(cat as (typeof ORDER)[number]) + 1;

  // The same cards always give the same rows; players look many times per street.
  const cache = new Map<string, OddsRow[]>();

  function rows(hole: Card[], board: Card[], trials = sampleBoards): OddsRow[] {
    if (hole.length !== 2) return [];
    const id = `${[...hole].sort().join("")}|${[...board].sort().join("")}|${trials}`;
    const hit = cache.get(id);
    if (hit) return hit;
    const out = compute(hole, board, trials);
    if (cache.size >= cacheSize) cache.delete(cache.keys().next().value as string);
    cache.set(id, out);
    return out;
  }

  function compute(hole: Card[], board: Card[], trials: number): OddsRow[] {
    const [madeCat, madePattern, madeSpare] = made(hole, board);
    const out: OddsRow[] = [{ category: madeCat, rank: rankOfCategory(madeCat), probability: 1, cards: readingOrder(madeCat, madePattern, madeSpare), more: false }];
    const known = [...hole, ...board];
    const used = new Set(known);
    const rest = fullDeck().filter((c) => !used.has(c));
    const need = 5 - board.length;
    if (need === 0) return out;
    const outcomes: Card[][] = [];
    if (need === 1) for (const c of rest) outcomes.push([c]);
    else if (need === 2) for (let i = 0; i < rest.length; i++) for (let j = i + 1; j < rest.length; j++) outcomes.push([rest[i], rest[j]]);
    else {
      const rng = seeded(known);
      for (let t = 0; t < trials; t++) {
        for (let i = 0; i < need; i++) {
          const j = i + Math.floor(rng() * (rest.length - i));
          [rest[i], rest[j]] = [rest[j], rest[i]];
        }
        outcomes.push(rest.slice(0, need));
      }
    }
    // The ways that finish as a better hand, each with the kickers it most often has. Ways of the
    // made hand's own category (a higher two pair) and ways without a hole card (the board's own,
    // shared by everyone) are left out.
    const ways = new Map<string, { cat: string; pattern: Pattern; spares: Map<string, number> }>();
    for (const coming of outcomes) {
      const seven = [...known, ...coming];
      const ev = evaluate(seven);
      const cat = categoryOf(ev);
      if (cat === madeCat) continue;
      const [pattern, spare] = makeup(hole, board, seven, ev);
      if (pattern.hole.length === 0) continue;
      const key = cat + JSON.stringify(pattern);
      const way = ways.get(key) ?? { cat, pattern, spares: new Map<string, number>() };
      const sk = JSON.stringify(spare);
      way.spares.set(sk, (way.spares.get(sk) ?? 0) + 1);
      ways.set(key, way);
    }
    // One row per way as it reads (ways that differ only in a rank not yet known read the same).
    const seen = new Set<string>();
    const value = new Map<OddsRow, number[]>([[out[0], []]]);
    for (const { cat, pattern, spares } of ways.values()) {
      const spare = JSON.parse([...spares.entries()].sort((a, b) => b[1] - a[1])[0][0]) as Spare;
      const cards = readingOrder(cat, pattern, spare);
      const look = cat + cards.filter((c) => !c.spare).map((c) => `${c.code ?? `${c.rank}${c.suit}`}${c.from}`).join(",");
      if (seen.has(look)) continue;
      seen.add(look);
      const probability = chance(cat, pattern.needed, known, need);
      if (probability < MIN_ROW) continue;
      const row: OddsRow = { category: cat, rank: rankOfCategory(cat), probability, cards, more: false };
      out.push(row);
      // Within a category the higher hand: a straight by its top card, otherwise its cards high to
      // low, a card of unknown rank lowest.
      value.set(row, cat === "straight" || cat === "straightFlush" ? [pattern.groups[0]] : cards.filter((c) => !c.spare).map((c) => (c.rank ? RANKS.indexOf(c.rank) : -1)).sort((a, b) => b - a));
    }
    // Most likely first; rows that read the same (as the clients round them) go best hand first.
    const shown = (p: number) => (p >= 0.1 ? Math.round(p * 100) : Math.round(p * 1000) / 10);
    const higher = (a: number[], b: number[]) => { for (let i = 0; i < Math.max(a.length, b.length); i++) if ((a[i] ?? -2) !== (b[i] ?? -2)) return (b[i] ?? -2) - (a[i] ?? -2); return 0; };
    return out.sort((a, b) => shown(b.probability) - shown(a.probability) || a.rank - b.rank || higher(value.get(a)!, value.get(b)!) || b.probability - a.probability);
  }

  // The exact chance that the needed cards are among the n still to come from the unseen deck.
  // Straight flush cards are named exactly; flush cards by suit; the rest by rank, at least as many
  // of each named rank as needed, and cards of no named rank (the board's own pair in a two pair or
  // full house) as that many of one rank not seen yet.
  function chance(cat: string, needed: Needed[], known: Card[], n: number): number {
    if (needed.length > n) return 0;
    if (needed.length === 0 || cat === "highCard") return 1;
    const unseen = 52 - known.length;
    const all = choose(unseen, n);
    if (cat === "straightFlush" || cat === "royalFlush") return choose(unseen - needed.length, n - needed.length) / all;
    if (cat === "flush") {
      const suit = SUITS.indexOf(needed[0].suit ?? "");
      const left = 13 - known.filter((c) => suitOf(c) === suit).length;
      let ways = 0;
      for (let x = needed.length; x <= Math.min(n, left); x++) ways += choose(left, x) * choose(unseen - left, n - x);
      return ways / all;
    }
    const least = new Array<number>(13).fill(0);
    let group = 0;
    for (const nd of needed) {
      if (nd.rank === null) group++;
      else least[RANKS.indexOf(nd.rank)]++;
    }
    // Counts of boards by cards taken so far and whether the group has its rank yet, rank by rank.
    let dp = Array.from({ length: n + 1 }, (_, k) => (k === 0 ? [1, 0] : [0, 0]));
    for (let r = 0; r < 13; r++) {
      const left = 4 - known.filter((c) => rankOf(c) === r).length;
      const fresh = left === 4 && least[r] === 0;
      const next = Array.from({ length: n + 1 }, () => [0, 0]);
      for (let k = 0; k <= n; k++) {
        for (let done = 0; done < 2; done++) {
          if (!dp[k][done]) continue;
          for (let x = least[r]; x <= Math.min(left, n - k); x++) {
            next[k + x][done || (group > 0 && fresh && x >= group) ? 1 : 0] += dp[k][done] * choose(left, x);
          }
        }
      }
      dp = next;
    }
    return dp[n][group > 0 ? 1 : 0] / all;
  }

  // A shown hand on display: its combination in reading order, then its first `kickers` kickers
  // high to low (marked spare), each from the hand or the board.
  function shownCards(hole: Card[], board: Card[], kickers = 0): OddsCard[] {
    const seven = [...hole, ...board];
    const ev = evaluate(seven);
    const five = bestFive(seven, ev);
    const core = patternCards(five, ev);
    const rest = five.filter((c) => !core.includes(c));
    const groups = ev.category === "straight" || ev.category === "straightFlush" ? [ev.ranks[0]]
      : ev.category === "twoPair" || ev.category === "fullHouse" ? ev.ranks.slice(0, 2)
      : ev.category === "flush" ? []
      : [ev.ranks[0]];
    const cards = readingOrder(categoryOf(ev),
      { hole: core.filter((c) => hole.includes(c)), board: core.filter((c) => board.includes(c)), needed: [], groups },
      { spareHole: rest.filter((c) => hole.includes(c)), spareBoard: rest.filter((c) => board.includes(c)) });
    return [...cards.filter((c) => !c.spare), ...cards.filter((c) => c.spare).slice(0, kickers)];
  }

  // The best hand in the known cards: before the flop a pair or the high card, after it whatever
  // the hole cards and the board make.
  function made(hole: Card[], board: Card[]): [string, Pattern, Spare] {
    if (board.length >= 3) {
      const known = [...hole, ...board];
      const ev = evaluate(known);
      return [categoryOf(ev), ...makeup(hole, board, known, ev)];
    }
    const [high, low] = [...hole].sort((a, b) => rankOf(b) - rankOf(a));
    if (rankOf(high) === rankOf(low)) return ["pair", { hole: [...hole].sort(), board: [], needed: [], groups: [rankOf(high)] }, { spareHole: [], spareBoard: [] }];
    return ["highCard", { hole: [high], board: [], needed: [], groups: [rankOf(high)] }, { spareHole: [low], spareBoard: [] }];
  }

  // The cards of a way as a novice reads them: a straight low to high (an ace first in a wheel),
  // otherwise the pattern's rank groups in their ranked order, each high to low, needed cards of
  // unknown rank last; then the kickers, high to low.
  function readingOrder(cat: string, pattern: Pattern, spare: Spare): OddsCard[] {
    const known = (cs: Card[], from: "hole" | "board", isSpare: boolean): OddsCard[] =>
      cs.map((c) => ({ code: c, rank: RANKS[rankOf(c)], suit: SUITS[suitOf(c)], from, spare: isSpare }));
    const main: OddsCard[] = [
      ...known(pattern.hole, "hole", false),
      ...known(pattern.board, "board", false),
      ...pattern.needed.map((n) => ({ code: null, rank: n.rank, suit: n.suit, from: "needed" as const, spare: false })),
    ];
    const rankNo = (c: OddsCard) => (c.rank === null ? -1 : RANKS.indexOf(c.rank));
    if (cat === "straight" || cat === "straightFlush" || cat === "royalFlush") {
      const high = pattern.groups[0] ?? 12;
      // Five-high: the ace reads as a one.
      const value = (c: OddsCard) => (high === 3 && c.rank === RANKS[12] ? -1 : rankNo(c));
      main.sort((a, b) => value(a) - value(b));
    } else {
      const group = (c: OddsCard) => {
        const i = c.rank === null ? -1 : pattern.groups.indexOf(rankNo(c));
        return i < 0 ? pattern.groups.length : i;
      };
      main.sort((a, b) => group(a) - group(b) || rankNo(b) - rankNo(a) || (a.from === "needed" ? 1 : 0) - (b.from === "needed" ? 1 : 0));
    }
    const spares = [...known(spare.spareHole, "hole", true), ...known(spare.spareBoard, "board", true)].sort((a, b) => rankNo(b) - rankNo(a));
    return [...main, ...spares];
  }

  // How a finished hand was made: the pattern's known cards, the cards it still needed described
  // as far as the known cards fix them, and the kickers.
  function makeup(hole: Card[], board: Card[], seven: Card[], ev: Evaluation): [Pattern, Spare] {
    const known = (c: Card) => hole.includes(c) || board.includes(c);
    const five = bestFive(seven, ev);
    let pattern = patternCards(five, ev);
    let needed: Needed[];
    let groups: number[];
    if (ev.category === "flush") {
      // A flush is counted by suit: every known card of the suit, however many more are needed.
      const suit = suitOf(pattern[0]);
      pattern = seven.filter((c) => suitOf(c) === suit && known(c));
      needed = Array.from({ length: Math.max(0, 5 - pattern.length) }, () => ({ rank: null, suit: SUITS[suit] }));
      groups = [];
    } else {
      const coming = pattern.filter((c) => !known(c));
      const anchored = pattern.some(known);
      needed = coming.map((c) => {
        const r = rankOf(c);
        switch (ev.category) {
          case "straightFlush":
            return { rank: RANKS[r], suit: SUITS[suitOf(c)] };
          case "straight":
            return { rank: anchored ? RANKS[r] : null, suit: null };
          case "highCard":
            return { rank: null, suit: null };
          default:
            return { rank: pattern.some((k) => known(k) && rankOf(k) === r) ? RANKS[r] : null, suit: null };
        }
      });
      groups = ev.category === "straight" || ev.category === "straightFlush" ? [ev.ranks[0]]
        : ev.category === "twoPair" || ev.category === "fullHouse" ? ev.ranks.slice(0, 2)
        : [ev.ranks[0]];
    }
    const spare = five.filter((c) => !pattern.includes(c));
    const sortNeeded = (xs: Needed[]) => xs.sort((a, b) => `${a.rank ?? "~"}${a.suit ?? "~"}`.localeCompare(`${b.rank ?? "~"}${b.suit ?? "~"}`));
    return [
      { hole: pattern.filter((c) => hole.includes(c)).sort(), board: pattern.filter((c) => board.includes(c)).sort(), needed: sortNeeded(needed), groups },
      { spareHole: spare.filter((c) => hole.includes(c)).sort(), spareBoard: spare.filter((c) => board.includes(c)).sort() },
    ];
  }

  function startingScore(cards: Card[]): number {
    const r = cards.map(rankOf).sort((a, b) => b - a);
    const high = (x: number) => (x === 12 ? 10 : x === 11 ? 8 : x === 10 ? 7 : x === 9 ? 6 : (x + 2) / 2);
    let score = high(r[0]);
    if (r[0] === r[1]) score = Math.max(5, score * 2);
    if (suitOf(cards[0]) === suitOf(cards[1])) score += 2;
    const gap = r[0] - r[1];
    if (r[0] !== r[1]) score -= gap === 1 ? 0 : gap === 2 ? 1 : gap === 3 ? 2 : gap === 4 ? 4 : 5;
    if (r[0] !== r[1] && gap <= 2 && r[0] < 10) score += 1;
    return Math.ceil(score);
  }

  function winChance(hole: Card[], board: Card[], ranges: number | number[], trials: number, rng: () => number): number {
    const mins = typeof ranges === "number" ? new Array<number>(ranges).fill(0) : ranges;
    const opponents = mins.length;
    if (opponents <= 0) return 1;
    const used = new Set([...hole, ...board]);
    const rest = fullDeck().filter((c) => !used.has(c));
    const need = opponents * 2 + (5 - board.length);
    let won = 0;
    for (let t = 0; t < trials; t++) {
      // Partial shuffle: only the cards this trial needs. Opponent hands outside their range are
      // redrawn a few times.
      for (let i = 0; i < need; i++) {
        const j = i + Math.floor(rng() * (rest.length - i));
        [rest[i], rest[j]] = [rest[j], rest[i]];
      }
      for (let o = 0; o < opponents; o++) {
        for (let tries = 0; tries < 6 && startingScore([rest[o * 2], rest[o * 2 + 1]]) < mins[o]; tries++) {
          for (let k = o * 2; k < o * 2 + 2; k++) {
            const j = k + Math.floor(rng() * (rest.length - k));
            [rest[k], rest[j]] = [rest[j], rest[k]];
          }
        }
      }
      const fullBoard = [...board, ...rest.slice(opponents * 2, need)];
      const mine = evaluate([...hole, ...fullBoard]).score;
      let best = true;
      let ties = 0;
      for (let o = 0; o < opponents && best; o++) {
        const s = evaluate([rest[o * 2], rest[o * 2 + 1], ...fullBoard]).score;
        if (s > mine) best = false;
        else if (s === mine) ties++;
      }
      if (best) won += 1 / (ties + 1);
    }
    return won / trials;
  }

  return { rows, chance, shownCards, winChance, startingScore };
}
