# Add metadata and cover art

Fill in each game's developer, publisher, release year, genres, platforms and
cover art from IGDB, and use your own photos as attachments or covers. This is
for games recorded with `--no-metadata`, imported from a spreadsheet, or
recorded while offline.

## Before you start

- A register with at least one game ([Getting started](../getting-started.md)).
- For metadata and provider covers: an IGDB API client id and client secret.
  IGDB issues them through a Twitch developer application. See the
  [IGDB API documentation](https://api-docs.igdb.com/).
- For your own photos: nothing else. Photos never use the network.

## How gamereg uses the network

- `gamereg enrich` is the only command that fetches data and records it.
- `gamereg search` also asks IGDB, but only when nothing on record matches and
  `--local-only` is not given. It records nothing.
- Every command that records, such as `start`, `end`, `finish`, `past`,
  `import`, `attach` and `cover`, works offline. A provider that is down or not
  configured never stops you from recording. See invariant 5 in
  [00-architecture](../spec/00-architecture.md#invariants).

## 1. Configure IGDB credentials

Put the client id and secret in `gamereg.secrets.json` at the root of the
register. `gamereg init` created that file with empty values:

```json
{
  "igdb": {
    "client_id": "your-client-id",
    "client_secret": "your-client-secret"
  }
}
```

Alternatively, set them as environment variables:

```bash
export IGDB_CLIENT_ID=your-client-id
export IGDB_CLIENT_SECRET=your-client-secret
```

Each field is looked up on its own, from the environment variable first and
then from the file. An empty value counts as not set. No command accepts a
credential as a flag.

> [!WARNING]
> Keep `gamereg.secrets.json` out of git. `gamereg init` adds it to the
> register's `.gitignore`, so do not remove that line.

When a field is missing, `enrich` exits with code 6 and names it:

```text
igdb is not configured: IGDB_CLIENT_ID is not set, in the environment or in gamereg.secrets.json.
```

For the details, see the
[configuration reference](../reference/configuration.md#gameregsecretsjson) and
[environment variables](../reference/environment.md).

## 2. Enrich your games

Enrich one game by name, or every game that still needs it:

```bash
gamereg enrich "Hollow Knight" --covers
gamereg enrich --missing --covers
```

| Form | Which games | When several catalog entries match |
|---|---|---|
| `gamereg enrich "<query>"` | One game on record. The query finds the game offline, and the same text is then sent to IGDB's search. | A menu at a terminal, exit code 3 otherwise. |
| `gamereg enrich --missing` | Every game that has never been enriched from the provider. | The game is skipped. It never prompts. |
| `gamereg enrich --all` | Every game on record, fetched again. | The game is skipped. It never prompts. |

| Option | Effect |
|---|---|
| `--covers` | Also download cover art, except for a game whose cover is your own. With `--missing`, it also selects games that have metadata but no cover. |
| `--match igdb:<id>` | Fetch that catalog entry directly instead of searching. Cannot be combined with `--all`. |
| `--id game:<id>` | Select the game on record by its `game_id` instead of by title. |
| `--provider igdb` | The provider to use. IGDB is currently the only one. |

`--missing` cannot be combined with `--all`, `--match` or a query. Each of
those combinations exits with code 2.

Use `--missing --covers` for regular runs, because it reaches the network only
for games that need it. The maintenance script
[scripts/autobuild.sh](../../scripts/autobuild.sh) runs exactly this command
whenever the register has changes.

For each matched game, `enrich` appends one `game.enrich` event. The event
holds IGDB's title, release year, developer, publisher, genres, platforms and
id. With `--covers`, the cover image is downloaded into `assets/` through the
same pipeline as your photos (step 4). If the download fails, only the image's
URL is kept. When IGDB's title differs from yours, IGDB's title replaces yours
and your spelling is kept as an alias, so searching for it still finds the
game. Run `gamereg build` to see the result in the notes.

The command reports each game as enriched, skipped or failed:

```text
Hollow Knight — enriched from igdb.
3 games had no confident match at any provider and were left as they were.
```

| Exit code | Meaning |
|---|---|
| 0 | Done. Games with no confident match are reported as skipped. |
| 3 | A single named game matched several catalog entries. `candidates` lists them. |
| 6 | The provider could not be reached or is not configured. Games already enriched in that run are still recorded. |

## 3. Resolve an ambiguous or missing match

`enrich` accepts a match only when IGDB has exactly one entry whose title equals
yours after [normalization](../spec/03-resolution.md#normalization). An edition
that IGDB lists separately, such as a Deluxe Edition, counts as a different
entry. When several entries match, the platforms already recorded on the game's
runs narrow the choice, and settle it when only one entry fits.

When several matches remain:

- At a terminal, pick one from the menu.
- From a script, or with `--json`, `enrich` exits with code 3 and lists
  `candidates`, each with a `ref` such as `igdb:<id>`. Run it again with the
  one you want:

  ```bash
  gamereg enrich "Hollow Knight" --match igdb:<id> --covers
  ```

When nothing matches because the stored title searches badly, pass a better
spelling that still finds the game on record. The text is sent to IGDB exactly
as typed, and a confident match corrects the stored title:

```bash
gamereg enrich "Pac-Man"
```

You can also start from a catalog entry. When nothing on record matches,
`gamereg search "<title>"` lists IGDB's candidates. Pass one of them to
`start` or `past` with `--id`, and the game is created with that IGDB
reference, without any network request:

```bash
gamereg start "Celeste" --id igdb:<id>
```

The next `gamereg enrich --missing` fetches the rest of the game's data by that
id, without searching.

## 4. Attach your own photos

Before anything is recorded, every photo goes through the same local pipeline:

1. It is rotated upright and resized so that its longest side is at most
   `images.max_edge` pixels (2000 by default).
2. It is encoded as WebP at `images.quality` (82 by default).
3. It is stored as `assets/<first two characters>/<sha256>.webp`, named by the
   SHA-256 hash of the encoded bytes. The same photo attached twice is stored
   once.
4. All EXIF metadata, including GPS location, is removed. The capture time is
   kept as `captured_at`. When the command has no `--at`, gamereg suggests that
   time: `The photo's own clock says 2026-09-14 22:40 — pass --at to use it.`

See [04-derived: Image ingestion](../spec/04-derived.md#image-ingestion).

To attach photos while recording, pass `--photo` to `start`, `end`, `finish`,
`drop` or `past`. Repeat the flag for several photos. `--caption` captions the
photo just before it:

```bash
gamereg end --photo ending.jpg --caption "Credits rolled" --photo stats.jpg --kind screenshot
```

To attach photos after the fact, use `attach`. A game title attaches the photo
to the game. An event id attaches it to that moment:

```bash
gamereg attach "Chrono Trigger" --photo shelf.jpg --kind box
gamereg attach <event_id> --photo stats.jpg --kind screenshot
```

`--kind` is one of `screenshot`, `photo`, `box`, `media` or `other` (the
default), and it applies to every photo in the command. In the CLI it is only a
label. It does not make a photo the cover, and it does not change a run's form.
Pass `--as-cover` for the first, and `--form physical` on `start` or `past` for
the second. The chat agent sets both itself when a photo shows a box or a
cartridge ([Chat agent](chat-agent.md)).

## 5. Set, promote or reset a cover

A game's cover comes either from the provider (`source: provider`) or from you
(`source: user`). `enrich` never replaces your cover, not even with `--covers`,
and it does not download provider art for a game whose cover is yours.

| To | Run |
|---|---|
| Use a photo as the cover while recording | `gamereg start "Chrono Trigger" --photo box.jpg --kind box --as-cover` |
| Set the cover from a file | `gamereg cover "Chrono Trigger" --photo box.jpg` |
| Use a photo already attached to the game | `gamereg cover "Chrono Trigger" --from <sha256>` |
| Go back to the provider's art | `gamereg cover "Chrono Trigger" --reset` |

- `--as-cover` uses the first `--photo` of the same command. Without a
  `--photo`, it exits with code 2.
- `cover` takes exactly one of `--photo`, `--from` or `--reset`. Any other
  number exits with code 2.
- `--from` takes the `sha256` of a photo attached to that game. You can find it
  in the `attachments` list a command prints with `--json`, or in the file name
  under `assets/`.
- `--reset` records that the provider's cover applies again, and your photo
  stays attached. To download the provider's cover, run
  `gamereg enrich "Chrono Trigger" --covers`.

The cover appears in the notes and in the Cover column of `Game List.md`. It
appears on a published site only when `images.publish` is `true`.

## 6. Adjust image settings

| Key | Default | Effect |
|---|---|---|
| `images.max_edge` | `2000` | The longest side, in pixels, of a stored image. |
| `images.quality` | `82` | The WebP quality of a stored image. |
| `images.keep_original` | `false` | Also keep a full-resolution copy in the source format, stripped of metadata like the WebP. |
| `images.publish` | `false` | Copy photos and covers into the `quartz` site output. |

Changing `max_edge` or `quality` affects only images ingested afterwards. See
the [configuration reference](../reference/configuration.md#images).

Every copy a photo produces is stripped of EXIF and GPS on ingest, the kept
original included ([details](../reference/configuration.md#imageskeep_original)).

## See also

- [02-cli: `gamereg enrich`](../spec/02-cli.md#gamereg-enrich-query---provider-igdb---match-ref---all---missing---covers)
- [02-cli: Attachments](../spec/02-cli.md#attachments) and
  [`gamereg cover`](../spec/02-cli.md#gamereg-cover-query)
- [02-cli: Provider credentials](../spec/02-cli.md#provider-credentials)
- [04-derived: EXIF is read, then stripped](../spec/04-derived.md#exif-is-read-then-stripped)
- [Import a spreadsheet](import-spreadsheet.md)
- [Publish a site](publish-site.md)
