# 03 — Resolution and Disambiguation

The hardest usability problem in the project. Voice transcription mangles game
titles, users type fragments, and franchises repeat names for decades.

## Principle

**Ambiguity is a return value, not a prompt.** The CLI computes candidates and
hands them back. Presentation belongs to the caller.

## Resolution order

Stop at the first step that yields exactly one match.

1. **Explicit id.** `--id igdb:7346` or `--id game:01K...`. No search at all.
   A provider ref with no local match yet is trusted, not searched: a write
   command never touches the network (00-architecture.md invariant 5), so the
   caller — a human picking a candidate from a code-3 menu, or an agent
   re-invoking after `gamereg search` — is assumed to have already resolved
   it. The command creates the game from the query text as its title and the
   ref as its `providers` entry, and `gamereg enrich` fills in the rest later
   from the id already on record — title included: a wrong guess here is
   corrected by the next `enrich`, which also keeps the guessed title
   resolvable as an alias (01-model.md). A `game:` reference gets no such
   leniency — that id was supposed to exist, and its
   absence is `not_found`. Available only where creating a game make sense
   (`start`, `past`), same as `--no-metadata`.
2. **Implied by open state.** For `end` and `break`, a single open session
   resolves the target. No query needed.
3. **Exact alias match.** Normalized lookup against known aliases.
4. **Unique local match.** Normalized substring match against titles in the log.
   A game currently `playing` outranks a finished one on tie.
5. **Ambiguous local match.** Two or more local hits → exit 3 with local
   candidates. Do not call the network: if the user has both Zelda games on
   record, the answer is one of them.
6. **Provider search.** Zero results → exit 4. One high-confidence result →
   auto-resolve. Otherwise → exit 3 with provider candidates.
7. **`--no-metadata`.** Creates a local-only game from the raw string. Always
   available as an escape hatch.

Steps 1–5 are offline and instant. After a few weeks of use, almost every lookup
resolves locally — which matters because the common case is a fragment typed on a
phone.

## Normalization

Applied to both sides of every comparison:

1. Unicode NFD, strip combining marks (`Pokémon` → `Pokemon`)
2. Lowercase
3. Strip punctuation and symbols; collapse whitespace
4. Strip a trailing parenthesized release year: `Final Fantasy VII Remake
   (2020)` ≡ `Final Fantasy VII Remake` — dropped for matching only, and
   only when parenthesized and trailing; a bare trailing number that is
   part of the title itself (`Cyberpunk 2077`) is left untouched
5. Strip leading articles: `the`, `a`, `an`, `o`, `a`, `os`, `as`, `um`, `uma`
6. Normalize edition suffixes: `deluxe edition`, `remastered`, `definitive
   edition`, `goty` → dropped for matching, preserved in the stored title
7. Roman ↔ arabic numeral equivalence: `final fantasy vii` ≡ `final fantasy 7`
8. `&` ≡ `and` ≡ `e`

Rule 7 (roman numerals) matters more than it looks. People say "Final Fantasy
7" and databases store "VII".

**Rule 6 (edition suffixes) does not apply when matching a provider
candidate.** A catalog frequently lists an edition as its own entry, with
its own id — IGDB carries "Final Fantasy VII Remake" and "Final Fantasy VII
Remake: Deluxe Edition" as two different games, not two spellings of one.
Stripping the suffix there would collapse them into the same normalized
string and turn one confident match into a false ambiguity. Provider
matching (`gamereg enrich`) normalizes with edition-stripping off; every
other rule, including the trailing-year one, still applies. Local matching
(steps 3–5) keeps edition-stripping on, since a user typing "Skyrim Special
Edition" against their own single local "Skyrim" record is exactly the case
it exists for.

## Auto-resolution threshold

Auto-resolve from a provider **only** when both hold:

- exactly one result survives the platform filter, **and**
- its normalized title equals the normalized query exactly

Anything short of that asks. A wrong auto-resolution creates a bogus game entry
and a bogus alias, and the user finds out weeks later. Asking costs one tap.

## Candidate shape

```json
{
  "ok": false,
  "code": 3,
  "error": "ambiguous",
  "message": "Two titles match “zelda” on Switch.",
  "query": "zelda",
  "candidates": [
    {
      "ref": "igdb:7346",
      "title": "The Legend of Zelda: Breath of the Wild",
      "year": 2017,
      "platforms": ["Switch", "Wii U"],
      "cover_url": "https://...",
      "source": "provider",
      "in_log": false
    },
    {
      "ref": "game:01K2W8...",
      "title": "The Legend of Zelda: Tears of the Kingdom",
      "year": 2023,
      "platforms": ["Switch"],
      "source": "local",
      "in_log": true,
      "status": "playing"
    }
  ]
}
```

`ref` is what gets passed back as `--id`. Ordering is meaningful: local before
provider, `playing` before everything, then by release year descending.

Cap at 8 candidates. More than that means the query was too vague; include
`"truncated": true` and let the caller ask for a better term.

## The platform hint filters, it does not resolve

`start "zelda" --platform switch` still returns both Breath of the Wild and Tears
of the Kingdom — and Breath of the Wild is also a Wii U game. Treat `--platform`
as a filter that narrows the list, never as an answer. Implementations that
assume a platform hint disambiguates will silently pick wrong.

`gamereg enrich` is a deliberate, narrower exception: once a game is already
identified (an existing local record, or a title that already matched
exactly), a recorded platform may resolve *which catalog SKU* represents
it — a different question from *which game*, where this section's rule
still applies without exception. See 02-cli.md's `enrich` section.

## Every resolution teaches

When the user picks a candidate after a code 3, the command that follows appends
**`game.alias`** with the original query string, normalized.

`"zelda"` asked once, answered once, never asked again. This is what makes the
system feel better over time instead of equally annoying forever.

Aliases are per-game and never global. If the user later wants `zelda` to mean a
different game, `gamereg alias` moves it — appending, as always.

## Consumers

| Caller | Behaviour on code 3 |
|---|---|
| Human at a terminal | Numbered menu, choice applied in-process, exit 0 |
| Agent in chat | Inline buttons or a numbered list, then re-invoke with `--id <ref>` |
| Script or pipe | Exit 3 with `candidates[]`; caller decides |
| Human under `--json` / `--non-interactive` | Print the list and exit 3; re-run with `--id` |

None of these implement search, ranking or normalization. There is exactly one
implementation, in the CLI; these differ only in how the candidates are shown.

The interactive menu must not be a second code path. It consumes the same
candidate array the JSON caller receives, so a bug in ranking is visible in both
or neither.

When the interactive menu resolves a choice, the command **continues in-process**
and exits 0 — the user is not asked to retype the command. It still appends the
`game.alias` event, exactly as the two-step agent path does.

`gamereg enrich` faces a related but distinct ambiguity: not "which game"
but "which catalog record for an already-known game" (e.g. two IGDB entries
titled identically for different platform releases). It reuses this same
exit-3/`candidates[]` shape and the same interactive/non-interactive split
— see 02-cli.md's `enrich` section for the specifics (`--match <ref>`).
