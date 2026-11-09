// The part of the hand-ranking and card-deck interfaces that odds reads (ae/hand-ranking 1.0.0).
export type Card = string;

export type Evaluation = { score: number; category: string; ranks: number[]; name: string };

export type HandRanking = {
  codes: { ranks: string; suits: string; rankOf(card: Card): number; suitOf(card: Card): number; fullDeck(): Card[] };
  evaluate(cards: Card[]): Evaluation;
  bestFive(cards: Card[], evaluation: Evaluation): Card[];
  patternCards(five: Card[], evaluation: Evaluation): Card[];
};

// A card of a possible hand, in reading order: a known card (`code`) from the viewer's hand or
// the board, or one still to come (`from: "needed"`, code null) known by rank, suit, both or
// neither. Spare cards are the kickers that fill the five without being part of the pattern.
export type OddsCard = { code: Card | null; rank: string | null; suit: string | null; from: "hole" | "board" | "needed"; spare: boolean };

// One way the viewer's hand can finish: the chance its needed cards turn up by the river (1 for
// the hand already made), how it ranks (1 is a royal flush) and its cards in reading order.
export type OddsRow = { category: string; rank: number; probability: number; cards: OddsCard[]; more: boolean };

export type Needed = { rank: string | null; suit: string | null };
