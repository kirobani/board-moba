# Referee tools

Use your own task workspace for code and arguments. Read `CHALLENGE.md`, `RULES.txt`, `BALANCE.md` and `API.txt`. The public `config.json`, `map.json` and `engine.cjs` govern precise mechanics. See CHALLENGE.md for the order in which the core, teammates and coach are called.

- Run `node referee.cjs time_left` when you start. If registration is pending, retry this check once the workspace is registered.
- Run `node referee.cjs results @args.json` with `{"run":"baselines"}` in args.json to list two public examples. Use `replay` with `{"run":"baselines","match":"baseline-practice-1","turn":20}` to inspect that example around turn 20.
- Place six modules and `roster.json` in a team directory. Modules can use `require('./engine.cjs')`; the referee provides that file. For local inspection, a folder directly under your workspace may contain a shim named `engine.cjs` with `module.exports = require('../engine.cjs')`. The upload skips this shim. Use `node referee.cjs upload TEAM DIRECTORY`.
- Use `node referee.cjs run_trials @args.json` with `{"candidate":"team","mode":"baselines","pairs":2}` to test both baselines. Use `{"candidate":"team","mode":"self","opponent":"another","pairs":2}` for a side-swapped comparison of your own squads. `replayPairs` controls how many replay pairs to retain. You can have one practice batch running and one queued. If `queued` is true, save the `run` ID and query `results` later. The referee credits shared-queue waiting time after the batch starts.
- Save your final code in the development phase. During the submission phase, check scores and complete the roster. `set_roster` can change the roster. Run `node referee.cjs time_left`, then `node referee.cjs submit @args.json` with `{"squad":"final-team"}`.
- Use `results` to confirm `formalReceivedAt`. In your final response, report the submitted squad, IDs, core and receipt time. The referee runs the two 20-game evaluations, which may finish after the cutoff.

Keep contestant credentials, other contestants' files and referee internals out of the conversation. Use the referee interface for practice, submission and results. During this task, work and reply in English even if a workbench status message or an interruption notice arrives in another language. Resume from these instructions and the existing workspace if interrupted.
