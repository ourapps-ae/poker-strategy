// The part of the poker-odds interface that strategy reads (ae/poker-odds 1.0.0).
export type Card = string;

export type OddsLike = {
  winChance(hole: Card[], board: Card[], ranges: number | number[], trials: number, rng: () => number): number;
};
