// A computer player without the game: a table described in plain data, one decision out.
import { createStrategy, type Action, type OddsLike, type StrategyMemory } from "../implementation/server/index.ts";

export type SimpleTable = {
  hole: string[]; board: string[]; stack: number; pot: number; toCall: number; bigBlind: number;
  opponents: number;
};

export function computerTurn(odds: OddsLike, table: SimpleTable, rng: () => number, memory: StrategyMemory = {}): Action | null {
  const strategy = createStrategy({ odds }, { difficulty: 2, aggression: 60 });
  const bb = table.bigBlind;
  const currentBet = table.toCall;
  const street = table.board.length === 0 ? "preflop" : table.board.length === 3 ? "flop" : table.board.length === 4 ? "turn" : "river";
  return strategy.decide({
    hole: table.hole, board: table.board, street, stack: table.stack, bet: 0, seat: 0, button: 1, seats: 9,
    sb: bb / 2, bb, currentBet, lastFullRaiseTo: street === "preflop" && currentBet === bb ? bb : currentBet, pot: table.pot,
    legal: { fold: true, check: table.toCall === 0, call: table.toCall > 0 ? Math.min(table.toCall, table.stack) : null,
      bet: table.stack > table.toCall ? { min: Math.min(currentBet + Math.max(bb, currentBet), table.stack), max: table.stack, opening: currentBet === 0 } : null },
    opponents: Array.from({ length: table.opponents }, (_, i) => ({ id: `o${i}`, seat: 2 + i, bet: currentBet, totalIn: bb, lastAction: null })),
  }, rng, memory);
}
