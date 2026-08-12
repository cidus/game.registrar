import { monotonicFactory } from 'ulid'

/**
 * Monotonic within a process: two events appended in the same millisecond keep
 * their relative order, which the fold depends on (docs/spec/01-model.md).
 */
const factory = monotonicFactory()

export const newId = (): string => factory()

const ULID_RE = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/

export const isUlid = (value: string): boolean => ULID_RE.test(value)
