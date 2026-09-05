// Logical dump of a gamereg data/log.db, used only by image.yml's clean-room
// golden check. Mirrors test/helpers.ts's dumpDatabase(): SQLite's on-disk
// layout is not stable across library versions, so log.db is compared by
// schema and contents rather than by bytes (CLAUDE.md, non-negotiable 2's own
// caveat). Kept as a standalone file rather than inlined in the workflow
// because escaping this much SQL through YAML-in-bash quoting is its own
// source of bugs.
'use strict'
const { DatabaseSync } = require('node:sqlite')

const db = new DatabaseSync(process.argv[2], { readOnly: true })
const objects = db
  .prepare("SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name")
  .all()

for (const object of objects) {
  console.log(`-- ${object.type} ${object.name}`)
  console.log((object.sql ?? '').trim())
}
for (const object of objects) {
  if (object.type !== 'table' && object.type !== 'view') continue
  console.log(`-- rows ${object.name}`)
  for (const row of db.prepare(`SELECT * FROM "${object.name}"`).all()) {
    console.log(
      Object.entries(row)
        .map(([column, value]) => `${column}=${JSON.stringify(value)}`)
        .join(' | '),
    )
  }
}
db.close()
