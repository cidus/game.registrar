/**
 * The `html` target (docs/spec/07-targets.md).
 *
 * One self-contained file: data embedded as JSON, the table sorted and
 * filtered by plain JavaScript, no build step, no CDN, no network at
 * runtime. Opens straight from the filesystem. Labels come from `i18n/`; the
 * embedded data stays in schema tokens, same as `csv` and `sqlite`
 * (04-derived.md).
 */
import { formatHours } from '../core/duration.ts'
import type { GameState, RunState, VaultState } from '../core/fold.ts'
import type { DatePrecision } from '../core/vocab.ts'
import type { PlannedFile, Target, TargetContext } from './types.ts'

type Row = {
  title: string
  platform: string | null
  started_on: string | null
  ended_on: string | null
  minutes: number
  hours: string
  hours_source: string
  rating: number | null
  difficulty: string | null
  completion_criteria: string | null
  open: boolean
}

/** A date shown only as precisely as it was recorded (04-derived.md). */
function date(value: string | null, precision: DatePrecision | null): string | null {
  if (value === null) return null
  if (precision === 'year') return value.slice(0, 4)
  if (precision === 'month') return value.slice(0, 7)
  return value
}

/** Same order as `Games.md`: open runs first, then by `ended_on` descending. */
function rowsOf(state: VaultState): Row[] {
  const pairs: { game: GameState; run: RunState }[] = state.games.flatMap((game) =>
    game.runs.map((run) => ({ game, run })),
  )
  pairs.sort((left, right) => {
    if (left.run.open !== right.run.open) return left.run.open ? -1 : 1
    const key = `${left.run.ended_on ?? ''}|${left.run.run_id}`
    const other = `${right.run.ended_on ?? ''}|${right.run.run_id}`
    return key < other ? 1 : key > other ? -1 : 0
  })
  return pairs.map(({ game, run }) => ({
    title: game.title,
    platform: run.platform,
    started_on: date(run.started_on, run.started_precision),
    ended_on: date(run.ended_on, run.ended_precision),
    minutes: run.minutes,
    hours: formatHours(run.minutes),
    hours_source: run.hours_source,
    rating: run.rating,
    difficulty: run.difficulty,
    completion_criteria: run.completion_criteria,
    open: run.open,
  }))
}

/** Escapes the one character that would otherwise close the embedding `<script>` tag early. */
function embedJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c')
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

const STYLE = `
  :root { color-scheme: light dark; }
  body { font: 14px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 2rem; }
  h1 { font-size: 1.1rem; }
  input[type="search"] { font: inherit; padding: 0.4rem 0.6rem; width: 100%; max-width: 24rem; margin-bottom: 1rem; }
  table { border-collapse: collapse; width: 100%; }
  th, td { text-align: left; padding: 0.35rem 0.6rem; border-bottom: 1px solid #8884; }
  th { cursor: pointer; user-select: none; white-space: nowrap; }
  th[aria-sort="ascending"]::after { content: " \\2191"; }
  th[aria-sort="descending"]::after { content: " \\2193"; }
  td.num { text-align: right; }
  tbody tr.open td.status { font-style: italic; }
`.trim()

const SCRIPT = `
(function () {
  var data = window.__GAMEREG_RUNS__;
  var tbody = document.querySelector("tbody");
  var search = document.getElementById("filter");
  var headers = Array.prototype.slice.call(document.querySelectorAll("th[data-key]"));
  var sortKey = null;
  var sortDir = 1;

  function cell(value) { return value === null || value === undefined ? "" : String(value); }

  function render() {
    var term = (search.value || "").toLowerCase();
    var rows = data.filter(function (row) {
      if (term === "") return true;
      return (row.title + " " + cell(row.platform)).toLowerCase().indexOf(term) !== -1;
    });
    if (sortKey !== null) {
      rows = rows.slice().sort(function (a, b) {
        var x = a[sortKey];
        var y = b[sortKey];
        if (x === y) return 0;
        if (x === null || x === undefined) return 1;
        if (y === null || y === undefined) return -1;
        return (x < y ? -1 : 1) * sortDir;
      });
    }
    tbody.innerHTML = "";
    rows.forEach(function (row) {
      var tr = document.createElement("tr");
      if (row.open) tr.className = "open";
      var hours = row.hours + (row.hours_source !== "measured" ? " *" : "");
      var status = row.open ? "playing" : cell(row.completion_criteria);
      [row.title, cell(row.platform), cell(row.started_on), cell(row.ended_on), hours, cell(row.rating), cell(row.difficulty), status].forEach(
        function (value, index) {
          var td = document.createElement("td");
          td.textContent = value;
          if (index === 4 || index === 5) td.className = "num";
          if (index === 7) td.className = "status";
          tr.appendChild(td);
        },
      );
      tbody.appendChild(tr);
    });
  }

  headers.forEach(function (th) {
    th.addEventListener("click", function () {
      var key = th.getAttribute("data-key");
      if (sortKey === key) {
        sortDir = -sortDir;
      } else {
        sortKey = key;
        sortDir = 1;
      }
      headers.forEach(function (other) { other.removeAttribute("aria-sort"); });
      th.setAttribute("aria-sort", sortDir === 1 ? "ascending" : "descending");
      render();
    });
  });
  search.addEventListener("input", render);
  render();
})();
`.trim()

export const html: Target = {
  name: 'html',
  since: 1,

  plan(state: VaultState, context: TargetContext): PlannedFile[] {
    const bundle = context.bundle
    const rows = rowsOf(state)
    const columns: { key: keyof Row; label: string }[] = [
      { key: 'title', label: bundle.t('table.game') },
      { key: 'platform', label: bundle.t('table.platform') },
      { key: 'started_on', label: bundle.t('table.started') },
      { key: 'ended_on', label: bundle.t('table.ended') },
      { key: 'hours', label: bundle.t('table.hours') },
      { key: 'rating', label: bundle.t('table.rating') },
      { key: 'difficulty', label: bundle.t('table.difficulty') },
      { key: 'completion_criteria', label: bundle.t('table.criteria') },
    ]

    const document = `<!doctype html>
<html lang="${escapeHtml(bundle.locale)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(bundle.t('table.title'))}</title>
<style>${STYLE}</style>
</head>
<body>
<h1>${escapeHtml(bundle.t('table.title'))}</h1>
<input type="search" id="filter" placeholder="${escapeHtml(bundle.t('table.game'))}">
<table>
<thead>
<tr>${columns.map((column) => `<th data-key="${column.key}">${escapeHtml(column.label)}</th>`).join('')}</tr>
</thead>
<tbody></tbody>
</table>
<script>window.__GAMEREG_RUNS__ = ${embedJson(rows)};</script>
<script>${SCRIPT}</script>
</body>
</html>
`

    return [{ path: 'Games.html', content: document, policy: 'replace' }]
  },
}
