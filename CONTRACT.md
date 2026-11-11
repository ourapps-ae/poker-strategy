# Poker strategy component

## Purpose and facilities
Given what a computer player can see at its turn (its cards, the board, the pot, what the rules allow, who is still in and how they have acted) returns fold, check, call or a bet to a total. The decision weighs the simulated chance of winning against pot odds, the share of the stack a call would cost, position, the street, a little noise and how aggressive each opponent has been so far. Before the flop it adds raise, call and all-in thresholds for short stacks. It does not choose names, schedule when a bot acts or apply the action: those belong to computer-players and the engine.

Facilities: `player-strategy` (Decide fold, check, call or bet for a computer player).

## User inputs
The installer collects two optional integers:

- `difficulty` (integer; optional; default `2`)
- `aggression` (integer; optional; default `50`)

## Artefacts and dependencies
`component.json` maps every `implementation/` source into `components/poker-strategy/`:

- `implementation/server/index.ts` -> `components/poker-strategy/server/index.ts`
- `implementation/server/strategy.ts` -> `components/poker-strategy/server/strategy.ts`
- `implementation/server/types.ts` -> `components/poker-strategy/server/types.ts`

Dependencies: none.
`tools.lock.json` pins verification tools: node 26.5. Licence: `Apache-2.0` (`LICENCE`, `NOTICE`).

## Provided interfaces
- `interfaces/player-strategy.json` defines `player-strategy` (ae/player-strategy) version 1.0.0: an OpenRPC 1.3.2 document, one method per function (a member of a created object is `<Type>.<member>`), with parameter, result and data types as JSON Schema 2020-12 (`components.schemas`) and thrown errors under `errors`.

## Required interfaces
- `hand-ranking` (ae/hand-ranking) version 1.0.0, supplied by the recipe or application.
- `poker-odds` (ae/poker-odds) version 1.0.0, supplied by the recipe or application.

Each `interfaces/required-<id>.json` is a byte copy of the providing component's document.

## Integration
Create it with `createStrategy({ odds }, { difficulty, aggression })`, where `odds` is the poker-odds interface (which itself needs hand-ranking). computer-players calls `decide` when it is a bot's turn and applies the returned action through the game rules; it calls `observe` after every action and `learnHand` after each deal, keeping the memory object between calls. The caller gives each bot an optional style (tight, aggr, bluff from 0 to 1); without one the style is neutral and aggression comes from the setting. computer-players uses the three-operation form: `newMemory()` for a fresh memory, `choose(observation, playerId, rng, memory)` (the observation is the `DecisionInput` the game rules give for that player; null or anything else is no decision) and `observe(memory, observation, playerId, move)` after every move (counts the mover and returns the memory). `decide(input, rng, memory)` is `choose` without the player id.

## Visual definition and connected examples
`visual/definition.json` maps its ports to the provided and required interfaces. `visual/examples/connected.json` connects the component to an illustrative application consumer. Both image formats and a text description are retained under `visual/output/`.

## Infrastructure
No deployed service, account or key. CPU only: a decision samples 200 to 900 boards (difficulty 2: 200 before the flop, 300 after) in a few milliseconds.

## Verification
`node --test tests/server.test.ts` checks turn handling, setting validation, bet sizing, clamping to the legal range and rounding to the small blind, calling and folding against pot odds, short-stack pushing, the effect of aggression and style, the sampling and range reading of each difficulty, memory-based reads, observe and learnHand counts, and real-odds decisions. The extraction at difficulty 2 was compared with the recipe's botAction on 400 random spots (all streets, short and deep stacks, with and without memory and styles): identical actions with the same random sequence. It also checks `newMemory`, `choose` (the same move as `decide`, null for nothing to decide, memory unchanged, bets inside the legal range with real odds) and `observe` (counts per mover, ignored moves, plain-JSON memory).

- `node --test tests/server.test.ts` (web, required-local; tools: node 26.5)

## Scenarios and presentation
A table of four people and two computer players: each computer player is given a style by name, decides in its turn and its action is applied. A teaching table sets difficulty 1 for gentle opponents. A tournament raises difficulty to 3 for the final table.

## Updates and removal
Removing the component removes the files; the memory object is owned by the caller.
