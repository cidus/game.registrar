/** `gamereg build [target...]` — regenerate every declared artifact. Idempotent. */
import type { Command } from 'commander'

import { readEvents } from '../../core/events.ts'
import { GameregError } from '../../core/errors.ts'
import { fold } from '../../core/fold.ts'
import { TARGET_PHASE } from '../../core/vocab.ts'
import { translator } from '../../i18n/index.ts'
import { build } from '../../targets/build.ts'
import { readManifest } from '../../targets/manifest.ts'
import { createContext } from '../context.ts'
import { emit, emitFailure } from '../output.ts'
import type { Registrar } from '../register.ts'

type Options = { force?: boolean; list?: boolean }

export function registerBuild(registrar: Registrar): void {
  registrar
    .command('build', 'help.build')
    .argument('[target...]', registrar.t('help.arg.target'))
    .option('--force', registrar.t('help.opt.force'))
    .option('--list', registrar.t('help.opt.list'))
    .action(async (names: string[], options: Options, command: Command) => {
      const cli = createContext(command)
      const declared = cli.vault.config.build.targets

      // `--list` reports what the vault declares and what it wrote, and is the
      // one form of `build` that neither plans nor writes.
      if (options.list === true) {
        const manifest = readManifest(cli.vault.manifestFile)
        const targets = declared.map((name) => ({
          target: name,
          since: TARGET_PHASE[name],
          files: manifest?.targets[name]?.files ?? [],
          seeds: manifest?.targets[name]?.seeds ?? [],
        }))
        emit(cli, {
          action: 'build.list',
          result: { targets, manifest: manifest === null ? null : 'present' },
          events: [],
          prose: [
            cli.t('prose.build.declares', { targets: declared.join(', ') }),
            ...targets.map((entry) =>
              cli.t('prose.build.owns', { target: entry.target, count: entry.files.length + entry.seeds.length }),
            ),
          ],
        })
        return
      }

      const state = fold(readEvents(cli.vault.eventsFile), cli.time)
      const result = build(cli.vault, state, translator(cli.locale), {
        force: options.force === true,
        only: names.length > 0 ? names : undefined,
        dryRun: cli.dryRun,
      })

      const payload = {
        targets: result.targets,
        planned: result.planned,
        written: result.written,
        removed: result.removed,
        failed: result.failed,
      }

      if (result.failed.length > 0) {
        // Everything that worked was written; the exit code says something did not.
        process.exitCode = emitFailure(
          cli,
          new GameregError(
            'error',
            'prose.build.failed_count',
            { count: result.failed.length },
            { details: { error: 'target_failed', result: payload } },
          ),
        )
        if (!cli.json && !cli.quiet) {
          for (const failure of result.failed) {
            process.stderr.write(`${cli.t('prose.build.failed', failure)}\n`)
          }
        }
        return
      }

      const prose = cli.dryRun
        ? [
            cli.t('prose.build.plan', { count: result.planned.length }),
            ...result.planned.map((entry) => cli.t('prose.build.plan_line', entry)),
          ]
        : [
            cli.t('prose.build.done', {
              targets: result.targets.join(', '),
              written: result.written.length,
            }),
            ...(result.removed.length > 0
              ? [cli.t('prose.build.removed', { count: result.removed.length })]
              : []),
          ]

      emit(cli, { action: 'build', result: payload, events: [], prose })
    })
}
