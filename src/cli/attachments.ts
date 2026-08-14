/**
 * `--photo`, `--caption`, `--kind`, `--as-cover` — the attachment flags shared
 * by every recording command (docs/spec/02-cli.md "Attachments").
 *
 * `--caption` captions the `--photo` immediately before it, so pairing has to
 * walk this invocation's own argv in order: Commander accumulates repeated
 * options into independent arrays and loses which caption went with which
 * photo (`--photo a --photo b --caption "for b"` must not caption `a`).
 */
import type { Command } from 'commander'

import type { Attachment } from '../core/fold.ts'
import { GameregError } from '../core/errors.ts'
import { ATTACHMENT_KIND, checkEnum } from '../core/vocab.ts'
import type { Vault } from '../core/vault.ts'
import { ingestImage } from '../images/ingest.ts'
import type { Cli } from './context.ts'
import { stage, type Workspace } from './workspace.ts'

export type PhotoSpec = { path: string; caption: string | null }

function flagName(token: string): string {
  const equals = token.indexOf('=')
  return equals === -1 ? token : token.slice(0, equals)
}

function flagValue(token: string): string | undefined {
  const equals = token.indexOf('=')
  return equals === -1 ? undefined : token.slice(equals + 1)
}

/**
 * Walks this invocation's own raw argv — never Commander's accumulated
 * `--photo`/`--caption` arrays, which preserve neither order nor pairing.
 * `rawArgs` is only ever set on the `Command` `.parseAsync` was called on
 * (the root program), so this follows `.parent` up to it, the same way
 * `mergeGlobals` (context.ts) walks down.
 */
export function photoSpecsFrom(command: Command): PhotoSpec[] {
  let root: Command = command
  while (root.parent !== null) root = root.parent
  // `rawArgs` is set by Commander at parse time but not part of its public
  // typings — it is the array `.parseAsync` was called with, verbatim.
  const args = (root as Command & { rawArgs: string[] }).rawArgs.slice(2)

  const specs: PhotoSpec[] = []
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index] ?? ''
    const name = flagName(token)
    if (name === '--photo') {
      const value = flagValue(token) ?? args[(index += 1)]
      if (value !== undefined) specs.push({ path: value, caption: null })
    } else if (name === '--caption') {
      const value = flagValue(token) ?? args[(index += 1)]
      const last = specs.at(-1)
      if (last !== undefined && value !== undefined) last.caption = value
    }
  }
  return specs
}

export type IngestedPhoto = { attachment: Attachment; written: boolean }

/** Ingests every `--photo`, in order. Never touches the log — the caller decides where the record lands. */
export async function ingestAttachments(
  vault: Vault,
  specs: readonly PhotoSpec[],
  kind: string | undefined,
): Promise<IngestedPhoto[]> {
  const attachmentKind = kind === undefined ? 'other' : checkEnum('kind', kind, ATTACHMENT_KIND)
  const out: IngestedPhoto[] = []
  for (const spec of specs) {
    const result = await ingestImage(vault, spec.path)
    out.push({
      written: result.written,
      attachment: {
        sha256: result.sha256,
        ext: result.ext,
        caption: spec.caption,
        captured_at: result.captured_at,
        kind: attachmentKind,
      },
    })
  }
  return out
}

export type AttachmentBundle = {
  attachments: Attachment[]
  photos: IngestedPhoto[]
  /** The first photo's own timestamp, only when `--at` did not already answer it. */
  suggestedAt: string | null
}

/** Everything a recording command needs from its `--photo`/`--caption`/`--kind` flags. */
export async function collectAttachments(
  cli: Cli,
  command: Command,
  kind: string | undefined,
): Promise<AttachmentBundle> {
  const specs = photoSpecsFrom(command)
  const photos = await ingestAttachments(cli.vault, specs, kind)
  const suggestedAt = cli.atGiven
    ? null
    : (photos.find((photo) => photo.attachment.captured_at !== null)?.attachment.captured_at ?? null)
  return { attachments: photos.map((photo) => photo.attachment), photos, suggestedAt }
}

/**
 * `--as-cover` promotes the first photo to the game's cover, `source: user`
 * (docs/spec/02-cli.md). A user cover is never replaced by `enrich`
 * afterwards, `--covers --force` included (01-model.md "Cover precedence").
 */
export function stageCoverFromFirst(
  cli: Cli,
  workspace: Workspace,
  gameId: string,
  photos: readonly IngestedPhoto[],
): void {
  const first = photos[0]
  if (first === undefined) {
    throw new GameregError('usage', 'error.as_cover_without_photo')
  }
  stage(cli, workspace, 'game.cover', { game_id: gameId, sha256: first.attachment.sha256, source: 'user' })
}

export function attachmentProse(cli: Cli, photos: readonly IngestedPhoto[], asCover: boolean): string[] {
  if (photos.length === 0) return []
  const prose = [
    cli.t(photos.length === 1 ? 'prose.attachment.one' : 'prose.attachment.many', { count: photos.length }),
  ]
  if (asCover) prose.push(cli.t('prose.attachment.cover'))
  return prose
}

export function suggestedAtProse(cli: Cli, suggestedAt: string | null): string[] {
  if (suggestedAt === null) return []
  return [cli.t('prose.attachment.suggested_at', { time: suggestedAt.replace('T', ' ').slice(0, 16) })]
}

/** The JSON-safe shape of one ingested photo, for a command's `result.attachments`. */
export function attachmentResult(photo: IngestedPhoto): Record<string, unknown> {
  return { ...photo.attachment, written: photo.written }
}
