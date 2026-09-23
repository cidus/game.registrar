// Prepare dependencies before Quartz builds: its theme loader otherwise runs
// npm install during emission. YAML is already a gamereg runtime dependency.
import fs from 'node:fs'
import { parse } from 'yaml'

const [sourcePath, destinationPath, configPath] = process.argv.slice(2)
const source = JSON.parse(fs.readFileSync(sourcePath, 'utf8'))
let destination = {}
try {
  destination = JSON.parse(fs.readFileSync(destinationPath, 'utf8'))
} catch (error) {
  if (error.code !== 'ENOENT') throw error
}
const merged = { ...source }
for (const key of ['dependencies', 'devDependencies']) {
  const upstream = source[key] ?? {}
  const additions = Object.fromEntries(
    Object.entries(destination[key] ?? {}).filter(([name]) => !(name in upstream)),
  )
  if (Object.keys(additions).length) merged[key] = { ...upstream, ...additions }
}

const config = parse(fs.readFileSync(configPath, 'utf8'))
for (const plugin of config?.plugins ?? []) {
  if (plugin.source !== '@quartz-themes/core' || !plugin.enabled) continue
  // QuartzTheme's default when the config does not name a theme (core v1/v2).
  const theme = plugin.options?.theme === undefined ? 'tokyo-night' : plugin.options.theme
  if (typeof theme !== 'string' || !/^[a-z0-9-]+(?:\.[a-z0-9-]+)*$/.test(theme)) {
    throw new Error('Invalid Quartz theme name')
  }
  const name = `@quartz-themes/${theme.split('.')[0]}`
  if (!(name in (merged.dependencies ?? {})) && !(name in (merged.devDependencies ?? {}))) {
    // Let npm resolve the published version and record it in package-lock.json.
    merged.dependencies = { ...merged.dependencies, [name]: '*' }
  }
}
fs.writeFileSync(destinationPath, JSON.stringify(merged, null, 2) + '\n')
