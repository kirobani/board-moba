# Board MOBA programming contest

Build the strongest team you can. Aim for reliable play against different opponents, on different seeds and on both sides of the board.

## Clock

- Minutes 0–180 are for development, practice matches and lineup changes.
- Minutes 180–210 are for checking results, completing the roster and submitting the team.
- The referee closes submissions at minute 210. A valid submission received before the deadline is sealed immediately. Early submission is allowed.

Please make as much use of the development time as you reasonably can. Check the clock whenever you are unsure. First build a complete team that can finish games, then use the remaining time to fix recurring weaknesses and retest. Run `node referee.cjs time_left` to see the development and submission deadlines. The referee credits confirmed platform or referee downtime. After any interruption, check the updated clock before proceeding.

## Practice

Start with the two side-swapped baseline example replays if useful. Study lanes, objective spawns, engagements and pushes. Play your team against the baselines and play your own candidate lineups against each other. Compare games on the same seed with the sides swapped, inspect losses and retest promising changes across more seeds. The referee offers public rules, results and replays. Both baseline implementations are private. Keep work in your assigned workspace and use the referee's public tools for practice.

## Roster and core player

Set the five player IDs and the core role in your team's `roster.json`. Each ID must contain 1–10 ASCII letters or digits. You can borrow names from model jokes, fiction, anime, history or esports, or make up your own.

```json
{
  "coreRole": "jungle",
  "playerIds": {
    "top": "LuBu",
    "mid": "Gojo",
    "jungle": "Baron",
    "adc": "Uzi",
    "support": "Paimon"
  }
}
```

On a map turn, the named core proposes one order using the public observation, or returns null. Each of the other four roles independently receives the same public observation and that one proposal through `decide(observation, reference)`, with `reference.coreRole` and `reference.coreOrder`. The proposal is visible only to your team.

The coach calls `decide(observation, proposals)` and may replace one allied order, including the core's. The coach can also start an engagement on behalf of one hero, using the coach's own cooldown and replacing that hero's order. Both teams submit before simultaneous map damage. The final battle uses the fixed published turn order and calls only the current actor. The team shares a 2,000 ms decision budget.

## Deliverables

Each team needs `roster.json` and the six synchronous CommonJS modules `top.cjs`, `mid.cjs`, `jungle.cjs`, `adc.cjs`, `support.cjs`, and `coach.cjs`. You can change the core during development. The IDs, core and source are sealed together at submission.

Upload the final team through the referee. **Run the clock check again immediately before submitting**, then submit and confirm the referee receipt. The referee will play 20 games against the standard baseline and 20 against the pressure baseline on ten new seeds per baseline, one game on each side per seed. A valid submission can be accepted before its evaluation finishes. The referee reports both sides separately. Replays are available for practice review.
