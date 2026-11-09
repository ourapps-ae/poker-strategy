// Copies of the current poker-hand-ranking and poker-odds implementation/server files,
// used only to bind the poker-odds interface to real code in this component's tests.
import { createOdds } from "./poker-odds/odds.ts";
import { handRanking } from "./hand-ranking/ranking.ts";

export const realOdds = createOdds(handRanking);
