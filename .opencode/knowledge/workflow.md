# Local workflow

Local only: repository `ourapps-ae/poker-strategy` has no commits, pushes, remote changes or publishing without George's say-so. Licence wording remains deferred (`licenceStatus: "deferred"`).
Do not edit `mcinpoker/`, `skull/`, `aepm/`, `OurPoker/proof/` or `OurPoker/recipe/`.
Regenerate: `python3.12 -B /Users/george/Projects/com/my/tools/scaffold_component.py components/poker-strategy --spec components/poker-strategy/authoring/spec.json --render`.
Check: `python3.12 -B /Users/george/Projects/com/my/tools/check_component.py components/poker-strategy`. Suite commands (from the package root): `node --test tests/server.test.ts`.
Always run Python with `-B`; never write bytecode into the repository.
