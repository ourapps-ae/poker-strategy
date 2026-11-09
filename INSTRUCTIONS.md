# Poker strategy instructions

## For the agent
Select this component when the recipe includes computer players. Connect its hand-ranking and poker-odds inputs, and connect its player-strategy output to computer-players. Map the recipe's 'computer players' difficulty answer to `difficulty` and a general 'how bold' answer to `aggression`.

- Select package `ourapps-ae/poker-strategy` version `0.3.0`.
- Settings to configure:
  - `difficulty` (integer; optional; default `2`)
  - `aggression` (integer; optional; default `50`)
- Connect the provided `player-strategy` (ae/player-strategy 1.0.0) to the consumer that needs it.
- Supply `hand-ranking` (ae/hand-ranking 1.0.0) from the component that provides it.
- Supply `poker-odds` (ae/poker-odds 1.0.0) from the component that provides it.
- No accounts or keys are needed.

## For the developer
No accounts or keys. `difficulty` is 1, 2 or 3 (default 2, the recipe's reference strength). `aggression` is 0 to 100 (default 50), used when a bot has no style of its own. Keep one memory object per room and store it with the room if bots should remember across a restart.

## How to check
From the component directory:

- `node --test tests/server.test.ts` (web, required-local; tools: node 26.5.0)
- `python3.12 -B /Users/george/Projects/com/my/tools/check_component.py components/poker-strategy` validates the manifest, sidecars and runs the required-local suite.
