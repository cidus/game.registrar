# Configuration reference

A vault has two settings files at its root: `gamereg.config.json` and
`gamereg.secrets.json`. This page lists every key in both, taken from
[src/core/config.ts](../../src/core/config.ts),
[src/core/secrets.ts](../../src/core/secrets.ts) and
[src/cli/commands/init.ts](../../src/cli/commands/init.ts). Environment
variables such as `GAMEREG_VAULT` and `GAMEREG_LOCALE` are in
[environment.md](environment.md).

| File | Holds | Written by | Committed |
|---|---|---|---|
| `gamereg.config.json` | Every setting on this page except credentials | `gamereg init`, `gamereg platform add\|remove` | Yes |
| `gamereg.secrets.json` | Provider credentials | `gamereg init`, only when the file is missing | No. `init` adds it to `.gitignore` |

- Every key is optional. A missing key takes its default, and a vault with no
  config file uses the defaults shown in [Full example](#full-example).
- An unknown key exits 2 at any level, including inside a platform entry. The
  message names the full key path and lists the keys valid at that level.
  Background: [ADR 0015](../decisions/0015-unknown-config-keys-exit-2.md).
- Every command loads the config before it does anything else, so a file that
  fails to load stops every command. See [Validation](#validation).

## Creating the file

`gamereg init` writes `gamereg.config.json` with every key present. It also
creates `gamereg.secrets.json` with empty values if the vault has none, and
adds `gamereg.secrets.json` to `.gitignore`. See
[02-cli: `gamereg init`](../spec/02-cli.md#gamereg-init).

- If a config file already exists, `init` exits 7 and changes nothing. With
  `--yes` it overwrites the file, and the current values become the defaults
  for its flags and prompts.
- If the existing config fails to load, `init` exits 2 with the load error,
  with or without `--yes`. Fix or delete the file by hand.
- `--dry-run` writes nothing.
- When prompting is allowed, `init` asks for each setting in the table below
  that no flag gave. When it is not allowed (no terminal, `--json`,
  `--non-interactive`, `GAMEREG_NON_INTERACTIVE` or `CI`), it asks nothing and
  keeps the current values.

| `init` flag | Key | Notes |
|---|---|---|
| `--locale <tag>` (the global flag) | `locale` | Trimmed. Blank writes `null`. Not validated. |
| `--timezone <tz>` | `timezone` | Trimmed. Blank writes `null`. Not validated. |
| `--day-cutoff <hh:mm>` | `day_cutoff` | The hour needs two digits: `05:00` works, `5:00` exits 2. |
| `--platform <platform>` | `defaults.platform` | Trimmed and otherwise stored as typed (`switch` stays `switch`). Blank writes `null`. |
| `--form <form>` | `defaults.form` | Must be in the vocabulary, or exit 2. |
| `--mode <mode>` | `defaults.mode` | Must be in the vocabulary, or exit 2. |
| `--platforms <list>` | `platforms` | Comma-separated. Replaces the list. Each name is canonicalized against the built-in table and stored with its built-in synonyms. |
| `--targets <list>` | `build.targets` | Comma-separated. Replaces the list. Must be known target names, or exit 2. |
| `--csv-dir <dir>` | `build.csv.dir` | Trailing slashes are removed. |

No flag or prompt sets `checkin.*` or `images.*`. To change them, edit the file.

`gamereg platform add` and `gamereg platform remove` rewrite the whole file.
Every key is written out, keys left out of a hand-written file reappear with
their defaults, and the JSON is indented by two spaces. A platform with no
synonyms is written as a plain string. `platform remove` of a platform that is
not in the list writes nothing.

The container entrypoint runs `gamereg init` only when the vault has no config
file, passing `GAMEREG_TIMEZONE`, `GAMEREG_DAY_CUTOFF`, `GAMEREG_TARGETS`,
`GAMEREG_PLATFORMS` and `GAMEREG_LOCALE` as the matching flags. See
[environment.md](environment.md) and [container.md](container.md).

## Full example

This is what `gamereg init` writes with no flags and no prompts. Every value is
the default.

```json
{
  "locale": null,
  "timezone": null,
  "day_cutoff": "05:00",
  "defaults": {
    "platform": null,
    "form": "digital",
    "mode": "solo"
  },
  "platforms": [],
  "build": {
    "targets": [
      "obsidian"
    ],
    "csv": {
      "dir": "data"
    }
  },
  "checkin": {
    "after": "4h",
    "clock": [
      "01:00"
    ],
    "chase_at": "09:00",
    "backoff": [
      "2h",
      "3h",
      "5h"
    ],
    "max_per_session": 3,
    "reply_window": "45m",
    "quiet_hours": [
      "02:00",
      "09:00"
    ]
  },
  "images": {
    "max_edge": 2000,
    "quality": 82,
    "keep_original": false,
    "publish": false
  }
}
```

## Top level

| Key | Type | Default | Accepted values | Set by |
|---|---|---|---|---|
| `locale` | string or `null` | `null` | Any string. Only a tag matching a shipped bundle (`en`, `pt-BR`) has an effect. | `init --locale` |
| `timezone` | string or `null` | `null` | An IANA zone name, such as `America/Sao_Paulo` | `init --timezone` |
| `day_cutoff` | string | `"05:00"` | A [time of day](#times-of-day) | `init --day-cutoff` |

### `locale`

- Sets the language of human-readable output: prose, prompts, help text and
  error messages. JSON output and stored data are never translated.
- The language comes from the first of these that is set and matches a
  bundle: the `--locale` flag, `locale`, `GAMEREG_LOCALE`, `LC_ALL`, `LANG`.
  If none matches, it is `en`.
- A value is normalized before matching (`pt_BR.UTF-8` becomes `pt-BR`), then
  matched exactly or by base language (`pt` gives `pt-BR`). A value that
  matches nothing is skipped without an error.

### `timezone`

- `null`: new events are stamped in the system zone of the machine running
  `gamereg`, and instants already in the log keep the offset they were
  recorded with. A session's logical day is therefore the local day where it
  was recorded.
- A zone name: new events are stamped in that zone, and every logged instant
  is converted to it when the log is read. Changing the value can move past
  sessions to a different logical day. See
  [01-model: Logical day](../spec/01-model.md#logical-day) and
  [ADR 0025](../decisions/0025-no-timezone-detection.md).
- The zone also applies to `--at` values with no offset (`HH:MM`,
  `YYYY-MM-DD HH:MM`) and to the check-in times (see [`checkin`](#checkin)).

### `day_cutoff`

- A session belongs to the logical day of the moment it opened; a session that
  opens before the cutoff counts toward the previous day. This is recomputed
  every time the log is read, so changing the cutoff moves past sessions too.
- `start` stores a new run's `started_on`, and `finish` and `drop` store
  `ended_on`, as the logical day under the cutoff in effect at that moment.
  Changing the cutoff later does not move these stored dates.
- The `day_cutoff` check-in trigger fires when this time passes with a session
  open. See [`checkin.chase_at`](#checkinchase_at).

## `defaults`

| Key | Type | Default | Accepted values | Set by |
|---|---|---|---|---|
| `defaults.platform` | string or `null` | `null` | Any string. Platforms are never validated. | `init --platform` |
| `defaults.form` | string | `"digital"` | `physical`, `digital`, `emulator`, `subscription`, `borrowed`, `cloud`, `demo` | `init --form` |
| `defaults.mode` | string | `"solo"` | `solo`, `coop`, `versus`, `mixed` | `init --mode` |

These fill in a new run's platform, form and mode. They are read by `start`,
`past` and `import`.

### `defaults.platform`

A new run's platform is the first of these that gives one:

1. `--platform` (for `import`, the mapped `platform` column)
2. the platform of the game's most recent run
3. `defaults.platform`
4. the single platform that the game's catalog entry and [`platforms`](#platforms)
   have in common, when there is exactly one
5. none: the run is recorded with no platform

`start` and `past` without `--ended` use all five steps. `past --ended` and
`import` skip step 4. Every candidate goes through the platform table, so
`switch` is filed as `Nintendo Switch`.

### `defaults.form` and `defaults.mode`

- A new run's form is `--form` (or the mapped `form` column), then the form of
  the game's most recent run, then `defaults.form`. Mode follows the same order
  with `--mode` and `defaults.mode`.
- A string that is not in the vocabulary exits 2. The message names the field
  as `form` or `mode` and does not name the file.

## `platforms`

| Key | Type | Default | Accepted values | Set by |
|---|---|---|---|---|
| `platforms` | array | `[]` | Platform entries, described below | `init --platforms`, `platform add\|remove` |

An entry is either a string or an object:

```json
{
  "platforms": [
    "PS5",
    { "name": "Mega Drive", "aliases": ["Genesis", "MD"] }
  ]
}
```

| Entry form | Rules |
|---|---|
| `"PS5"` | Same as `{ "name": "PS5", "aliases": [] }`. A blank string is dropped. |
| `{ "name", "aliases" }` | `name` is a non-empty string. `aliases` is optional and must be an array; members that are not strings, or are blank, are dropped. Any other key, such as `alias`, exits 2 as `platforms[].<key>`. |

- **Spelling table.** A typed platform is looked up by name and alias in these
  entries first, then in the built-in table, comparing normalized text. A
  platform found in neither is kept as typed. No platform is ever rejected.
- **Built-in groups.** An entry that shares any spelling with a built-in
  platform takes all of that built-in platform's spellings. For example, the
  built-in `PC` lists `Steam Deck` as a synonym, so an entry named `Steam Deck`
  makes `PC` and `Windows` file as `Steam Deck`.
- **Applied on read.** `build` re-applies the table to runs already in the
  log, so editing an entry changes how past runs are shown without an amend.
- **Suggestions.** Platforms in both the game's catalog entry and this list are
  offered first and rank `search` results. When exactly one exists, `start`
  uses it without asking (step 4 in [`defaults.platform`](#defaultsplatform)).
- **Writers.** Only `init --platforms` and `platform add|remove` change the
  list. A platform typed on any other command is never added to it.
  `init --platforms` canonicalizes each name first, so
  `init --platforms "Steam Deck"` stores `PC`.

See [02-cli: Platform vocabulary](../spec/02-cli.md#platform-vocabulary).
Background: [ADR 0005](../decisions/0005-platform-list-is-not-a-validator.md),
[ADR 0011](../decisions/0011-canonicalize-platforms-on-input-and-read.md),
[ADR 0022](../decisions/0022-steam-deck-is-pc.md).

## `build`

| Key | Type | Default | Accepted values | Set by |
|---|---|---|---|---|
| `build.targets` | array of strings | `["obsidian"]` | `obsidian`, `csv`, `sqlite`, `json`, `html`, `stats`, `quartz` | `init --targets` |
| `build.csv.dir` | string | `"data"` | A directory relative to the vault root. `""` means the vault root. | `init --csv-dir` |

### `build.targets`

- `gamereg build` builds every listed target. `gamereg build <target>...`
  builds only the named targets; a name that is not in the list exits 2.
- On the next full build, a target removed from the list has the files it
  wrote deleted, as recorded in the build manifest. Seeded files, such as
  `Game Database.base`, are kept.
- Duplicate names are dropped, keeping the first. `[]` is accepted: a full
  build then writes nothing and deletes every file that earlier builds wrote,
  except seeded files.
- An unknown name exits 2 and lists the valid ones.

See [07-targets: Declaring targets](../spec/07-targets.md#declaring-targets) and
[build-outputs.md](../guides/build-outputs.md). Background:
[ADR 0030](../decisions/0030-deletion-is-one-manifest-whitelist.md).

### `build.csv.dir`

- The directory where the `csv` target writes `games.csv`, `runs.csv` and
  `sessions.csv`. Ignored unless `csv` is in `build.targets`.
- Trailing slashes are removed when the file loads.
- A path outside the vault (absolute, or using `..`) loads without an error.
  The build then exits 1: `A build target planned to write outside the vault`.
- When the value changes, the next full build writes the files in the new
  directory and deletes the ones in the old directory.

## `checkin`

Check-ins are questions about a session that is still open. `gamereg due`
reads these keys, together with `day_cutoff`, and `gamereg checkin --expire`
reads `reply_window`. Every value is checked when the file loads, and a
malformed one exits 2, naming the key. See
[05-agent: Check-ins](../spec/05-agent.md#check-ins).

| Key | Type | Default | Accepted values | Set by |
|---|---|---|---|---|
| `checkin.after` | string or `null` | `"4h"` | A [duration](#durations), or `null` | File only |
| `checkin.clock` | array of strings | `["01:00"]` | [Times of day](#times-of-day). May be empty. | File only |
| `checkin.chase_at` | string or `null` | `"09:00"` | A [time of day](#times-of-day), or `null` | File only |
| `checkin.backoff` | array of strings | `["2h", "3h", "5h"]` | [Durations](#durations). May be empty. | File only |
| `checkin.max_per_session` | integer | `3` | `0` or greater | File only |
| `checkin.reply_window` | string | `"45m"` | A [duration](#durations). `null` exits 2. | File only |
| `checkin.quiet_hours` | array of strings | `["02:00", "09:00"]` | `[]`, or exactly two [times of day](#times-of-day) `[from, to]` | File only |

- `gamereg due` returns at most one trigger per open session. When several
  have fired, `day_cutoff` wins, then `duration`, then `clock`. Background:
  [ADR 0032](../decisions/0032-one-due-row-per-session.md).
- Times of day are compared in the zone of the instant being evaluated. That
  is [`timezone`](#timezone) when it is set, and otherwise the system zone of
  the machine running `gamereg due`. An `--at` value with an explicit UTC
  offset is evaluated in that offset.

### `checkin.after`

- The `duration` trigger fires once a session has been open this long,
  counting from when it opened, with breaks included. It stays fired, so quiet
  hours, backoff and the ceiling only delay it.
- `null` turns off the `duration` trigger and nothing else. Leaving the key out
  keeps `4h`.

> [!NOTE]
> `after: null` does not silence check-ins: the `clock` trigger still fires at
> its default `01:00`. To stop everything except the `day_cutoff` chase, also
> set `"clock": []`.

### `checkin.clock`

- The `clock` trigger fires when one of these times passes while a session is
  open. Its threshold is the most recent listed time that passed after the
  session opened.
- `[]` turns off the `clock` trigger.

### `checkin.chase_at`

- The `day_cutoff` trigger fires when [`day_cutoff`](#day_cutoff) passes with
  the session still open. The question is delivered at the first `chase_at` at
  or after that crossing, which in practice means the first `gamereg due` call
  at or after that time.
- `null` delivers at the crossing itself.
- Once a `day_cutoff` check-in is filed at or after the delivery time, that
  crossing is not returned again. `quiet_hours`, `backoff` and
  `max_per_session` do not apply to this trigger.
- Background: [ADR 0002](../decisions/0002-chase-has-its-own-slot.md).

### `checkin.backoff`

- After a check-in, `duration` and `clock` wait before firing again. The wait
  is `backoff[n - 1]`, where `n` is the number of check-ins filed on the
  session so far from any trigger, counted from the last one. Past the end of
  the list, the last entry repeats.
- `[]` means no wait. `day_cutoff` never waits.

### `checkin.max_per_session`

- Once a session has this many check-ins from `duration` and `clock`, those two
  triggers stop for that session. `day_cutoff` check-ins are neither counted
  nor capped.
- `0` turns off `duration` and `clock` entirely.

### `checkin.reply_window`

- `gamereg checkin --expire` amends every `snoozed` check-in at least this old
  to `no_reply`, on open and closed sessions alike.
- `gamereg due` does not read this key.

### `checkin.quiet_hours`

- `[from, to]` is a window that includes `from` and excludes `to`, and crosses
  midnight when `from` is later than `to`. `[]`, or equal `from` and `to`,
  means no quiet hours.
- Inside the window, `due` returns no `duration` or `clock` trigger. They are
  held, not dropped, and are returned once the window ends. `day_cutoff`
  ignores quiet hours. Background:
  [ADR 0033](../decisions/0033-quiet-hours-evaluated-now.md).
- A list with one entry, or more than two, exits 2.

## `images`

These keys control how photos and covers are stored and published. See
[04-derived: Image ingestion](../spec/04-derived.md#image-ingestion).

| Key | Type | Default | Accepted values | Set by |
|---|---|---|---|---|
| `images.max_edge` | number | `2000` | A whole number of pixels, from 1 to 20000 | File only |
| `images.quality` | number | `82` | A whole number from 1 to 100 | File only |
| `images.keep_original` | boolean | `false` | `true`, `false` | File only |
| `images.publish` | boolean | `false` | `true`, `false` | File only |

### `images.max_edge` and `images.quality`

- An image is auto-rotated and resized so its longest side is at most
  `max_edge` (smaller images are never enlarged), then encoded as WebP at
  `quality`.
- Both apply to every `--photo` (`start`, `end`, `finish`, `drop`, `past`,
  `attach`, `cover`) and to covers downloaded by `enrich --covers`.
- An image is identified by the hash of its encoded bytes, so changing either
  key gives images ingested afterwards a different hash. Stored images are not
  re-encoded.
- Both are checked when the file loads: a value outside the range, a fraction or
  a non-number exits 2 naming the key, before any image is touched.

### `images.keep_original`

- `true`: ingestion also writes a second copy to
  `assets/<sha[0:2]>/<sha>.original.<format>`, at the source's resolution and in
  its format (`jpeg`, `png`, and so on) rather than resized and re-encoded to
  WebP. `<sha>` is the hash of the normalized WebP. The copy is written once,
  and no event refers to it.
- The copy goes through the same strip as the normalized image: it is
  re-encoded with its orientation applied and no metadata carried through, so
  EXIF and GPS are gone from it too (invariant 12).
- Every build that runs `obsidian` links these files into `obsidian/assets/`.
  Every build that runs `quartz` with `images.publish: true` links them into
  `quartz/content/assets/`, so a published site serves the full-resolution
  copies as well.

### `images.publish`

- Only the `quartz` target reads this key.
- `false`: site notes show a placeholder sentence where an image would be,
  table cells stay empty, and run pages leave out the `cover` property.
- `true`: site pages embed the images, and every build that runs `quartz` links
  the whole `assets/` directory into `quartz/content/assets/` (copying when a
  hardlink is not possible). That includes every stored file, originals and
  images no page shows.
- Setting it back to `false` removes the embeds but no files: everything
  already linked stays in `quartz/content/assets/` until you delete it.
- `obsidian/assets/` is filled whatever the value. The heatmap SVGs that
  `quartz` writes do not depend on it.

See [04-derived: Publication](../spec/04-derived.md#publication) and
[publish-site.md](../guides/publish-site.md). Background:
[ADR 0055](../decisions/0055-one-publish-switch-rendered.md).

## Validation

Every setting is checked when the file loads, so a mistake is reported by the
next command rather than hours later by the one that happens to use it.

| Condition | Result |
|---|---|
| The file is not valid JSON, or its top level is not an object | Exit 2: `<file> is not valid JSON.` |
| An unknown key at any level, including a removed one such as `checkin.persona_prompt` | Exit 2: `<file>: "<key>" is not a setting gamereg knows. Valid at that level: ...` |
| A known key with the wrong type, a malformed value or a value out of range | Exit 2: `<file>: "<key>" does not accept "<value>".` |
| `timezone` is a string but not a zone in the IANA database | Exit 2, the same message |
| `defaults.form`, `defaults.mode` or a `build.targets` entry is outside its vocabulary | Exit 2, listing the valid values |
| A `platforms` entry is neither a string nor an object, has no `name`, or has a non-array `aliases` | Exit 2: `<file> is not valid JSON.`, although the JSON is valid |
| `build.csv.dir` points outside the vault | Loads. The build exits 1 |
| `locale` matches no bundle | Loads. The next language source is used |

A whole block that is not an object — `"defaults": "x"`, `"images": null` — is
ignored and its defaults apply. `null` is otherwise accepted only where the type
column lists it.

## Formats

### Durations

Used by `checkin.after`, `checkin.backoff` and `checkin.reply_window`.

| Form | Example | Minutes |
|---|---|---|
| Whole minutes | `90` | 90 |
| Minutes with a unit | `40m`, `40min` | 40 |
| Hours | `2h` | 120 |
| Hours and minutes | `1h20`, `1h20m` | 80 |
| Hours and minutes with a colon | `1:20` | 80 |

- Letter case and surrounding whitespace are ignored. Spaces between the parts
  are allowed (`2 h`, `1h 20m`).
- In the last two forms the minutes are 0 to 59. The colon form needs exactly
  two minute digits.
- Decimals (`1.5h`) and negative values exit 2.

### Times of day

Used by `day_cutoff`, `checkin.clock`, `checkin.chase_at` and
`checkin.quiet_hours`.

- `H:MM` or `HH:MM`: the hour is 0 to 23, the minutes two digits from 00 to 59.
  `5:00` and `05:00` are the same time. `24:00` exits 2.
- Surrounding whitespace is not allowed.
- `gamereg init --day-cutoff` is stricter and needs a two-digit hour.

## `gamereg.secrets.json`

The file is keyed by provider. IGDB is the only provider and has two fields.
This is the file as `gamereg init` creates it:

```json
{
  "igdb": {
    "client_id": "",
    "client_secret": ""
  }
}
```

| Field | Environment variable | Type | Default |
|---|---|---|---|
| `igdb.client_id` | `IGDB_CLIENT_ID` | string | `""` |
| `igdb.client_secret` | `IGDB_CLIENT_SECRET` | string | `""` |

- **Precedence.** Each field is resolved on its own: the environment variable
  first, then the file. An empty string in either place counts as not set, so
  an empty variable does not hide a value in the file.
- **Written by `init` only.** `init` creates the file only when it is missing
  and never overwrites it. It also adds `gamereg.secrets.json` to the vault's
  `.gitignore`, creating that file if needed and never adding the line twice.
  No other command writes the file, and no command takes a credential as a
  flag.
- **When it is read.** By `enrich`, and by `search` when no local game matches
  and `--local-only` is not given. No other command reads it.
- **Missing credential.** `enrich` reports each game as failed and exits 6,
  naming the variable:
  `igdb is not configured: IGDB_CLIENT_ID is not set, in the environment or in gamereg.secrets.json.`
  `search` skips IGDB and returns no provider results.
- **Validation.** Unknown providers and fields are accepted and ignored. A
  provider value that is not an object is skipped, and so is a field value that
  is not a string. If the file is not valid JSON, or its top level is not an
  object, `enrich` exits 2, and so does a `search` that reaches the provider
  step.
- **Permissions.** The file is created with the process's default file mode,
  not restricted to its owner: under the common umask `022` it is `0644`.

See [02-cli: Provider credentials](../spec/02-cli.md#provider-credentials) and
[metadata-and-covers.md](../guides/metadata-and-covers.md).

## See also

- [environment.md](environment.md): environment variables, including the ones
  the container passes to `init`
- [build-outputs.md](../guides/build-outputs.md): choosing build targets
- [05-agent: Anti-nagging rules](../spec/05-agent.md#anti-nagging-rules): what
  the check-in keys are for
- [02-cli: Time parsing for `--at`](../spec/02-cli.md#time-parsing-for---at)
- [Decision records](../decisions/README.md)
