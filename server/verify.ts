import type { PageVerification } from '../src/lib/types.ts'
import { scanPage } from '../src/lib/pageScan.ts'
import { HttpError } from './store.ts'

const MAX_BYTES = 3 * 1024 * 1024
const MAX_HOPS = 5

/** This is a local tool, but it still should not be pointed at localhost or the LAN by a pasted URL. */
export function blockedHost(host: string): boolean {
  const h = host.toLowerCase()
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true
  if (h.includes(':') || h.startsWith('[')) return true
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(h)
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])]
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
  }
  return false
}

function checkUrl(raw: string): URL {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    throw new HttpError(400, `Not a valid URL: ${raw}`)
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new HttpError(400, 'Only http(s) URLs can be checked.')
  if (blockedHost(u.hostname)) throw new HttpError(400, `Refusing to fetch a local or private address (${u.hostname}).`)
  return u
}

async function readCapped(res: Response): Promise<string> {
  const reader = res.body?.getReader()
  if (!reader) return await res.text()
  const chunks: Uint8Array[] = []
  let total = 0
  while (total < MAX_BYTES) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    total += value.length
  }
  await reader.cancel().catch(() => undefined)
  return new TextDecoder('utf-8', { fatal: false }).decode(Buffer.concat(chunks))
}

/**
 * Fetch an official page and report what is on it. Reports only: nothing here marks anything verified.
 * Redirects are followed by hand so every hop gets the same host check.
 */
export async function checkPage(input: { url: string; programName: string; deadlineDate?: string }): Promise<PageVerification> {
  const checkedAt = new Date().toISOString()
  const base: PageVerification = { checkedAt, url: input.url, ok: false, nameFound: false, deadlineMatch: 'not_checked', dates: [] }
  let url = checkUrl(input.url)
  try {
    for (let hop = 0; hop <= MAX_HOPS; hop++) {
      const res = await fetch(url, {
        redirect: 'manual',
        signal: AbortSignal.timeout(15000),
        headers: { 'user-agent': 'Mozilla/5.0 (compatible; ApplicationTracker/0.1; personal use)', accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5' },
      })
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        url = checkUrl(new URL(res.headers.get('location')!, url).toString())
        await res.body?.cancel().catch(() => undefined)
        continue
      }
      const finalUrl = url.toString()
      if (!res.ok) {
        await res.body?.cancel().catch(() => undefined)
        return { ...base, httpStatus: res.status, finalUrl, error: `HTTP ${res.status}${res.status === 403 ? ': the site blocks automated requests; open it in your browser instead' : ''}` }
      }
      const type = res.headers.get('content-type') ?? ''
      if (!/text\/|html|xml/i.test(type)) {
        await res.body?.cancel().catch(() => undefined)
        return { ...base, ok: true, httpStatus: res.status, finalUrl, error: `Not an HTML page (${type || 'unknown type'}), such as a PDF. Open it yourself.` }
      }
      const scan = scanPage(await readCapped(res), { programName: input.programName, deadlineDate: input.deadlineDate })
      return {
        ...base,
        ok: true,
        httpStatus: res.status,
        finalUrl,
        title: scan.title,
        textLength: scan.textLength,
        nameFound: scan.nameFound,
        deadlineMatch: scan.deadlineMatch,
        dates: scan.dates,
        error: scan.textLength < 300 ? 'Very little text came back; the page may need JavaScript. Open it in your browser to confirm.' : undefined,
      }
    }
    return { ...base, error: `Too many redirects (over ${MAX_HOPS}).` }
  } catch (e) {
    if (e instanceof HttpError) throw e
    const err = e as Error
    return { ...base, error: err.name === 'TimeoutError' ? 'Timed out after 15 seconds.' : `Fetch failed: ${err.message}` }
  }
}
