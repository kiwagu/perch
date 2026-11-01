# Working with agents

The repository is organised to be read and built by AI agents, while the architecture stays
with the developer: the developer decides it in the contract and approves each contract commit,
the agents propose patterns with their trade-offs and implement the approved contract, and the
code makes no architectural decisions of its own. The mechanisms below hold that division.

- **A single rule set for all agents.** The rules live in `.cursor/rules/`, the single source;
  `AGENTS.md` and `.claude/CLAUDE.md` are reading lists that point to it. The rules are organised
  as a pyramid: a router (`process-check-rules-skills.mdc`) directs each task to the narrowest
  applicable rule, and each rule states when it applies and when to stop reading.
  [context-smoke-test.md](context-smoke-test.md) lists prompts with the route each must take, so
  a change to the rules is tested like a change to code.
- **Pinned skills.** The vendor skills (shadcn, SurrealQL, SurrealKit, the SurrealDB SDK and
  CLI) are locked in `skills-lock.json`, like dependencies, and installed under
  `.agents/skills/`; the project's own skill, `adding-ui-anchors`, guides a change from the
  model to the tests.
- **A self-describing application.** By default the stands serve the UI manifest built from the
  contract at `/ui-manifest/manifest.json`, and development and e2e builds expose
  `window.__perch.ui.anchors()`, which lists the anchors the current page renders, so agents
  locate elements by their contract names rather than by markup.
- **Files sized for a context window.** Source files trigger a warning at 300 lines and call for
  a split at 500; the size ratchet of the pre-commit hook fails a file at or above 400 lines that
  its baseline does not know, and any baselined file that grows. Each file holds one class or one
  business function; every package and module has a short README of a fixed shape, checked by
  `bun run readme:check`, which gives an agent an overview before it reads the code.
- **Enforced guardrails.** The pre-commit hook formats the code, validates SurrealQL, regenerates
  the models and checks translations, types, lint, READMEs, the contract, file sizes and unit
  tests. A commit on `main` also requires receipts showing that the database and e2e suites
  passed on exactly that tree ([commands.md](../development/commands.md)).
- **Parallel stands.** `mcproc worktree add` gives each branch its own checkout, ports and
  containers, so several agents can run full stacks at once; memory leases queue the stands the
  host cannot accommodate yet ([.mcproc/README.md](../../.mcproc/README.md)).
- **A sufficient contract.** A screen built from the manifest alone should require no guesswork;
  anything that had to be guessed indicates a gap in the contract. A gap is reported in four
  lines (what is needed, the facet that lacks it, the workaround refused, the proposal) and never
  emulated in the code or the tests (`.cursor/rules/contract-gap-no-emulation.mdc`).
