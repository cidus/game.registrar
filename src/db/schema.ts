/**
 * The SQLite schema (docs/spec/04-derived.md "SQLite").
 *
 * `csv` and `json` flatten the same tables with the same column names. Where
 * they disagree, this schema is right and the other is a bug — this file is
 * therefore the one place column names for the derived tables are decided.
 */

export const SCHEMA_SQL = `
CREATE TABLE games (
  game_id      TEXT PRIMARY KEY,
  slug         TEXT NOT NULL,
  title        TEXT NOT NULL,
  release_year INTEGER,
  developer    TEXT,
  publisher    TEXT,
  status       TEXT NOT NULL
);

CREATE TABLE game_platforms (
  game_id  TEXT NOT NULL REFERENCES games(game_id),
  platform TEXT NOT NULL
);

CREATE TABLE game_genres (
  game_id TEXT NOT NULL REFERENCES games(game_id),
  genre   TEXT NOT NULL
);

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
  replay              INTEGER NOT NULL
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
