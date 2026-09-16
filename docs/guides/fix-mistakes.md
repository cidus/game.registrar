# Fix mistakes in the register

Correct a recorded value, withdraw an event, teach the register another name
for a game, and check the log afterwards. The log is append-only, so every fix
is a new event. The original line stays in `data/events.jsonl`, and the fold
applies the correction.

## Before you start

- A register with the mistake in it.
- Commands that show ids print them only in JSON, so add `--json` when you look
  one up.
- `amend` and `revoke` both accept `--dry-run`, which prints the event that
  would be appended and writes nothing.

## Choose the fix

| Situation | Fix |
|---|---|
| A recorded value is wrong: rating, platform, time, note, title | [Amend the event](#2-correct-a-value-with-amend) |
| Something should not be on record at all | [Revoke its events, newest first](#3-withdraw-events-with-revoke) |
| A session was opened on the wrong game | [Undo the session](#4-undo-a-session-opened-on-the-wrong-game) |
| You picked the wrong game from a menu | [Also revoke the alias](#5-undo-a-wrong-pick-from-a-menu) |
| A nickname or misheard title should find an existing game | [Add an alias](#6-teach-a-name-with-alias) |
| A session is still open | Not a correction: run `gamereg end --at <time>`. |
| A run's platform is missing or wrong while you close it | Not a correction: pass `--platform` to `end`, `finish` or `drop`. |

After any fix, [check the log with `doctor`](#7-check-the-log-with-doctor).

## 1. Find the event id

`amend` and `revoke` take an **event** id. The entity ids in results
(`game_id`, `run_id`, `session_id`) are different values, and neither command
accepts them.

| Event | Where its id is |
|---|---|
| `run.open` | `run_open_event_id` in `gamereg status "<game>" --json`, or in `gamereg open --json` while a session is open |
| `run.close` | `run_close_event_id` in `gamereg status "<game>" --json`. It is `null` while the run is open. |
| `run.import`, from `past` or `import` | Both fields above. They hold the same id. |
| `session.open` | `session_open_event_id` in `gamereg open --json`, while the session is open |
| Any other event | The `events` list printed by the command that wrote it, or `data/events.jsonl` |

To find an event in the log, search by type:

```bash
grep '"type":"game.create"' data/events.jsonl
```

If the register builds the `sqlite` target, you can query the `events` table
instead:

```bash
gamereg query "SELECT event_id, type, ts FROM events WHERE type = 'session.close' ORDER BY ts DESC LIMIT 5"
```

## 2. Correct a value with amend

```bash
gamereg amend <event_id> --reason "<why>" --set <field>=<value>
```

- `--reason` is required. It is recorded with the correction.
- Pass at least one `--set`, and repeat it to change several fields at once.
- A value is read as JSON when it parses, so `rating=9` is a number and
  `rating=null` clears the field. Anything else is a string. A `platform` is
  normalized the same way `--platform` is.
- The change shows in `gamereg status` at once, and in the notes at the next
  `gamereg build`.

Each field belongs to one event, so pick the event that carries the field you
want to change:

| Event | Fields you can set |
|---|---|
| `run.open` | `platform`, `form`, `mode`, `started_on`, `date_precision`, `hours`, `replay` |
| `run.close` | `ended_on`, `date_precision`, `outcome`, `completion_criteria`, `rating`, `difficulty`, `note`, `at` |
| `run.import` | Every field of both events above |
| `session.open` | `at` |
| `session.close` | `at`, `break_minutes`, `note` |
| `break.open`, `break.close` | `at` |
| `run.verdict` | `text` |
| `game.create` | `title`, `sort_title`, `release_year`, `developer`, `publisher`, `genres`, `platforms` |

The complete list, id fields included, is `EVENT_FIELDS` in
[src/core/events.ts](../../src/core/events.ts).

Examples:

```bash
gamereg amend <run_close_event_id> --reason "meant 9" --set rating=9
gamereg amend <run_open_event_id> --reason "played on the Switch" --set platform=switch
gamereg amend <session.close event id> --reason "stopped at 23:00" --set at=2026-09-14T23:00:00-03:00
gamereg amend <game.create event id> --reason "capitalization" --set title="Hollow Knight"
```

A successful amend prints:

```text
Event 01M2JFD9H8MEQNQWQ025SEEWQY amended. The original stays on record.
```

`amend` refuses a field that the event does not carry, and lists the fields it
does carry. Setting `rating` on a `run.open` exits with code 2:

```text
A run.open event carries no rating. Amending it would record nothing. Its fields are: run_id, game_id, platform, form, mode, started_on, date_precision, replay, hours.
```

Other refusals:

| Case | Exit code |
|---|---|
| No `--set` given | 2 |
| No `--reason` given | 2 |
| A derived value such as `minutes` or `hours_source`. Amend the timestamps instead, and the duration is recomputed. | 2 |
| The target is itself an `event.amend` or `event.revoke`. Revoke it instead. | 2 |
| No event has that id | 4 |

To undo an amend, revoke the `event.amend` event. The field goes back to its
earlier value.

## 3. Withdraw events with revoke

```bash
gamereg revoke <event_id> --reason "<why>"
```

```text
Event 01M2JFD9T4S2C727P6ZKBW97QD revoked. The original stays on record.
```

The revoked event stays in the file, and the fold ignores it from then on.
`--reason` is required.

What a revoke does to common events:

| Revoked event | Result |
|---|---|
| `run.close` | The run is open again. |
| `run.verdict` | The verdict disappears from the notes at the next build. |
| `event.amend` | The correction no longer applies. |
| `game.alias` | That name no longer finds the game. |

When a mistake produced several events, revoke them in reverse order, newest
first.

> [!WARNING]
> Revoking an event before the events that refer to it leaves orphans. For
> example, a revoked `game.create` leaves its `run.open` and `session.open`
> pointing at a game that no longer exists, and `gamereg doctor` reports both.

> [!NOTE]
> Revoking an `event.revoke` does not currently restore the event it revoked.
> To put something back, record it again, for example with `gamereg finish`
> for a run whose `run.close` you revoked.

## 4. Undo a session opened on the wrong game

1. Find the events the mistaken `start` wrote. They are in its `events` list,
   and at the end of `data/events.jsonl`. `gamereg open --json` also gives
   `session_open_event_id` and `run_open_event_id` while the session is open.
2. Revoke them newest first. Skip any row that does not apply:

   ```bash
   gamereg revoke <session.close event id> --reason "wrong game"
   gamereg revoke <session_open_event_id> --reason "wrong game"
   gamereg revoke <run_open_event_id> --reason "wrong game"
   gamereg revoke <game.create event id> --reason "wrong game"
   ```

   - Revoke `session.close` only if you already ended the session, and any
     break events too.
   - Revoke `run.open` only if `start` opened a new run: its JSON result has
     `"run_opened": true`.
   - Revoke `game.create` only if `start` created the game: its JSON result has
     `"created": true`.

3. Check the log:

   ```bash
   gamereg doctor
   ```

4. Record the session on the right game, with the time it actually started:

   ```bash
   gamereg start "<right game>" --at "2026-09-14 20:00"
   ```

## 5. Undo a wrong pick from a menu

When you pick a game from a menu, or answer an exit code 3 with `--id`, the
command also files a `game.alias` event. That makes your query find the picked
game from then on, without asking. After a wrong pick, the same words keep
finding the wrong game.

1. Undo the session as in [step 4](#4-undo-a-session-opened-on-the-wrong-game).
2. Revoke the `game.alias` event as well. It is listed in the same command's
   `events` list, before the run and session events.
3. Run `gamereg search "<your query>" --local-only` to confirm that the query
   offers the candidates again.

See [03-resolution: Every resolution teaches](../spec/03-resolution.md#every-resolution-teaches).

## 6. Teach a name with alias

```bash
gamereg alias "Hollow Knight" --add "hk"
```

```text
"hk" now refers to Hollow Knight.
```

- The game must already be on record. Otherwise the command exits with code 4.
- Aliases are normalized and belong to one game. Adding an alias that another
  game already has moves it to this game.
- To remove an alias, revoke its `game.alias` event.

An alias is the fix for a title that voice transcription keeps mangling, and
for any abbreviation you use.

## 7. Check the log with doctor

```bash
gamereg doctor
```

```text
The register is in order. 15 events, 1 games, 1 runs.
```

When something is wrong, `doctor` lists each problem and exits with code 1:

```text
2 irregularities found:
  - A run.open event points at something that does not exist.
  - A session.open event points at something that does not exist.
```

It checks for:

- Invalid vocabulary tokens and ratings.
- Sessions that close before they open, and runs or sessions closed twice.
- Events that refer to something that does not exist, and breaks outside a
  session.
- Two games sharing a slug.
- Run notes holding text that the next build would remove, generated-looking
  files that no target owns, and blocks this version does not write.

`doctor` never changes anything. With `--json`, each problem carries an
`event_id` where one applies, which is the id to amend or revoke.

## See also

- [02-cli: `gamereg amend` and `gamereg revoke`](../spec/02-cli.md#gamereg-amend-event_id---reason----set-kv-)
- [02-cli: `gamereg doctor`](../spec/02-cli.md#gamereg-doctor)
- [02-cli: `gamereg alias`](../spec/02-cli.md#gamereg-alias-query---add-alias)
- [01-model: Corrections](../spec/01-model.md#corrections)
- [Import a spreadsheet](import-spreadsheet.md): avoiding mistakes before an
  import writes them
- [Troubleshooting](troubleshooting.md)
