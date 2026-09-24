/**
 * The SQLite schema (docs/spec/04-derived.md "SQLite").
 *
 * `csv` and `json` flatten the same tables with the same column names. Where
 * they disagree, this schema is right and the other is a bug — this file is
 * therefore the one place column names for the derived tables are decided.
 */

export const SCHEMA_SQL = `
-- \`cover_*\` mirror \`GameState.cover\` (core/fold.ts) field for field. All three
-- are nullable: a game may have no cover; \`cover_url\` is null for a cover
-- promoted from the user's own photo; \`cover_sha256\` is null while a provider
-- cover is a URL that was never downloaded. \`cover_source\` is \`user\` or
-- \`provider\`, and is what makes invariant 11 -- a user cover is never replaced
-- by enrichment -- visible to a consumer. There is no \`cover_path\` column, for
-- the same reason \`attachments\` has none: \`assets/<sha256[0:2]>/<sha256>.webp\`
-- is 01-model.md's rule and belongs to it.
CREATE TABLE games (
  game_id      TEXT PRIMARY KEY,
  slug         TEXT NOT NULL,
  title        TEXT NOT NULL,
  release_year INTEGER,
  developer    TEXT,
  publisher    TEXT,
  status       TEXT NOT NULL,
  cover_sha256 TEXT,
  cover_url    TEXT,
  cover_source TEXT
);

CREATE TABLE game_platforms (
  game_id  TEXT NOT NULL REFERENCES games(game_id),
  platform TEXT NOT NULL
);

CREATE TABLE game_genres (
  game_id TEXT NOT NULL REFERENCES games(game_id),
  genre   TEXT NOT NULL
);

-- \`note\` and \`verdict\` are the run's two pieces of prose, both nullable and
-- both carried for the same reason \`sessions.note\` always has been: prose in a
-- TEXT column is a value like any other, and a consumer that cannot read it
-- here has to parse a Markdown note to get it back. \`note\` is the line filed
-- with \`run.close\` / \`run.import\`; \`verdict\` is the latest \`run.verdict\`
-- text, last filing wins (core/fold.ts). Multi-valued facts -- genres,
-- platforms -- are the ones a flat row genuinely cannot hold, and those stay in
-- their join tables.
CREATE TABLE runs (
  run_id              TEXT PRIMARY KEY,
  game_id             TEXT NOT NULL REFERENCES games(game_id),
  platform            TEXT,
  platform_raw        TEXT,
  form                TEXT,
  mode                TEXT,
  started_on          TEXT NOT NULL,
  ended_on            TEXT,
  outcome             TEXT,
  completion_criteria TEXT,
  rating              INTEGER,
  difficulty          TEXT,
  minutes             INTEGER NOT NULL,
  hours_source        TEXT NOT NULL,
  replay              INTEGER NOT NULL,
  note                TEXT,
  verdict             TEXT
);

CREATE TABLE sessions (
  session_id  TEXT PRIMARY KEY,
  run_id      TEXT NOT NULL REFERENCES runs(run_id),
  started_at  TEXT NOT NULL,
  ended_at    TEXT,
  minutes     INTEGER NOT NULL,
  logical_day TEXT NOT NULL,
  note        TEXT
);

CREATE TABLE breaks (
  break_id   TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(session_id),
  started_at TEXT NOT NULL,
  ended_at   TEXT,
  minutes    INTEGER NOT NULL
);

CREATE TABLE aliases (
  game_id TEXT NOT NULL REFERENCES games(game_id),
  alias   TEXT NOT NULL
);

-- One row per photo on record, resolved to what it belongs to. \`game_id\` is
-- always known (a session implies a run implies a game); the narrower two are
-- null for a photo filed against the game itself. \`target\` is the fold's own
-- key -- an event id, or a game id -- kept for the same reason
-- \`runs.platform_raw\` is: the resolved view, plus the way back to the log.
-- There is no \`ext\` column and no \`path\` column: ingestion normalizes every
-- image to WebP and hashes the result, so the file is
-- \`assets/<sha256[0:2]>/<sha256>.webp\` and nothing about it varies per row.
-- That rule is 01-model.md's and belongs to it.
CREATE TABLE attachments (
  sha256      TEXT NOT NULL,
  kind        TEXT NOT NULL,
  caption     TEXT,
  captured_at TEXT,
  filed_at    TEXT NOT NULL,
  game_id     TEXT NOT NULL REFERENCES games(game_id),
  run_id      TEXT REFERENCES runs(run_id),
  session_id  TEXT REFERENCES sessions(session_id),
  target      TEXT NOT NULL
);

-- Raw, for auditing. One row per event on record, id-ordered — chronological,
-- since ids are ULIDs appended in file order. Payload as recorded: amend and
-- revoke are rows here too, never applied, exactly as 01-model.md describes them.
CREATE TABLE events (
  event_id TEXT PRIMARY KEY,
  ts       TEXT NOT NULL,
  type     TEXT NOT NULL,
  source   TEXT NOT NULL,
  payload  TEXT NOT NULL
);

CREATE INDEX idx_game_platforms_game ON game_platforms(game_id);
CREATE INDEX idx_game_genres_game ON game_genres(game_id);
CREATE INDEX idx_runs_game ON runs(game_id);
CREATE INDEX idx_sessions_run ON sessions(run_id);
CREATE INDEX idx_breaks_session ON breaks(session_id);
CREATE INDEX idx_aliases_game ON aliases(game_id);
CREATE INDEX idx_attachments_game ON attachments(game_id);
CREATE INDEX idx_attachments_run ON attachments(run_id);
CREATE INDEX idx_attachments_session ON attachments(session_id);

-- One row per finished run, flattened — the shape most questions ask in.
CREATE VIEW v_finished AS
SELECT
  r.run_id,
  r.game_id,
  g.title,
  g.slug,
  r.platform,
  r.form,
  r.mode,
  r.started_on,
  r.ended_on,
  r.completion_criteria,
  r.rating,
  r.difficulty,
  r.minutes,
  ROUND(r.minutes / 60.0, 1) AS hours,
  r.hours_source,
  r.replay,
  g.developer,
  g.publisher,
  g.release_year,
  (SELECT GROUP_CONCAT(genre, ', ') FROM game_genres WHERE game_genres.game_id = g.game_id) AS genres
FROM runs r
JOIN games g ON g.game_id = r.game_id
WHERE r.outcome = 'finished';

-- Counts, hours and mean rating per year of completion. \`ended_on\` may be
-- year, month or day precision; the first four characters are the year in
-- every case (01-model.md date_precision).
CREATE VIEW v_by_year AS
SELECT
  SUBSTR(ended_on, 1, 4) AS year,
  COUNT(*) AS runs,
  ROUND(SUM(minutes) / 60.0, 1) AS hours,
  ROUND(AVG(rating), 2) AS mean_rating
FROM runs
WHERE outcome = 'finished' AND ended_on IS NOT NULL
GROUP BY year
ORDER BY year;

-- Same, per genre.
CREATE VIEW v_by_genre AS
SELECT
  gg.genre AS genre,
  COUNT(*) AS runs,
  ROUND(SUM(r.minutes) / 60.0, 1) AS hours,
  ROUND(AVG(r.rating), 2) AS mean_rating
FROM runs r
JOIN game_genres gg ON gg.game_id = r.game_id
WHERE r.outcome = 'finished'
GROUP BY gg.genre
ORDER BY gg.genre;

-- For a calendar heatmap: one row per logical day actually played.
CREATE VIEW v_sessions_by_day AS
SELECT
  logical_day,
  COUNT(*) AS sessions,
  ROUND(SUM(minutes) / 60.0, 1) AS hours
FROM sessions
GROUP BY logical_day
ORDER BY logical_day;
`
