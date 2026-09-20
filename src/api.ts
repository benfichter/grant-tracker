import type { CategoryId, DraftFile, Engine, Opportunity, PageVerification, Profile, RunRecord } from './lib/types.ts'
import type { Category } from './lib/categories.ts'

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (res.status === 204) return undefined as T
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`)
  return data as T
}

export interface RunSummary {
  id: string
  categoryId: CategoryId
  createdAt: string
  engines: string[]
  items: number
  decided: number
}

export interface Decision {
  key: string
  action: 'add' | 'attach' | 'skip'
  matchId?: string
  edits?: Record<string, unknown>
}

export const api = {
  profile: () => call<Profile>('GET', '/api/profile'),
  saveProfile: (p: Profile) => call<Profile>('PUT', '/api/profile', p),
  opps: () => call<Opportunity[]>('GET', '/api/opportunities'),
  addOpp: (b: Record<string, unknown>) => call<Opportunity>('POST', '/api/opportunities', b),
  patchOpp: (id: string, b: Record<string, unknown>) =>
    call<{ opportunity: Opportunity; warnings: string[] }>('PATCH', `/api/opportunities/${encodeURIComponent(id)}`, b),
  deleteOpp: (id: string) => call<void>('DELETE', `/api/opportunities/${encodeURIComponent(id)}`),
  confirm: (id: string, b: Record<string, unknown>) => call<Opportunity>('POST', `/api/opportunities/${encodeURIComponent(id)}/confirm`, b),
  verify: (b: { oppId?: string; url?: string; programName?: string; deadlineDate?: string }) => call<PageVerification>('POST', '/api/verify', b),
  searches: () => call<{ categories: Category[]; runs: RunSummary[] }>('GET', '/api/searches'),
  newRun: (categoryId: string) => call<RunRecord>('POST', `/api/searches/${categoryId}/runs`),
  run: (id: string) => call<RunRecord>('GET', `/api/runs/${encodeURIComponent(id)}`),
  paste: (id: string, engine: Engine, text: string) => call<RunRecord>('POST', `/api/runs/${encodeURIComponent(id)}/paste`, { engine, text }),
  unpaste: (id: string, engine: Engine) => call<RunRecord>('DELETE', `/api/runs/${encodeURIComponent(id)}/paste/${engine}`),
  commit: (id: string, decisions: Decision[]) =>
    call<{ added: string[]; attached: string[]; errors: { key: string; error: string }[]; run: RunRecord }>('POST', `/api/runs/${encodeURIComponent(id)}/commit`, { decisions }),
  drafts: (oppId: string) => call<DraftFile[]>('GET', `/api/drafts/${encodeURIComponent(oppId)}`),
  draft: (oppId: string, materialId: string) => call<DraftFile>('GET', `/api/drafts/${encodeURIComponent(oppId)}/${encodeURIComponent(materialId)}`),
  saveDraft: (oppId: string, materialId: string, b: { text: string; source: string; note?: string }) =>
    call<DraftFile>('POST', `/api/drafts/${encodeURIComponent(oppId)}/${encodeURIComponent(materialId)}`, b),
}
