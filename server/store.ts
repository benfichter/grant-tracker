import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

export const ROOT = path.resolve(import.meta.dirname, '..')
export const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'data')

/** Ids arrive in URLs and become file names, so only allow a boring character set. */
export function safeId(id: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,120}$/.test(id) || id.includes('..')) throw new HttpError(400, `Invalid id: ${id}`)
  return id
}

export class HttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

const abs = (rel: string) => path.join(DATA_DIR, rel)

export async function readJson<T>(rel: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(abs(rel), 'utf8')) as T
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return fallback
    throw e
  }
}

/** Atomic write: temp file in the same directory, then rename, so an interrupted save cannot corrupt the file. */
export async function writeJson(rel: string, value: unknown): Promise<void> {
  const file = abs(rel)
  await mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  await writeFile(tmp, JSON.stringify(value, null, 2) + '\n', 'utf8')
  await rename(tmp, file)
}

export async function listJson(relDir: string): Promise<string[]> {
  try {
    return (await readdir(abs(relDir))).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5))
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw e
  }
}

// One queue per file: read-modify-write cycles never interleave.
const locks = new Map<string, Promise<unknown>>()
export function update<T, R>(rel: string, fallback: T, fn: (current: T) => Promise<{ next: T; result: R }> | { next: T; result: R }): Promise<R> {
  const prev = locks.get(rel) ?? Promise.resolve()
  const run = prev.catch(() => undefined).then(async () => {
    const current = await readJson<T>(rel, fallback)
    const { next, result } = await fn(current)
    await writeJson(rel, next)
    return result
  })
  locks.set(rel, run)
  return run
}
