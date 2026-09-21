import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AuditReport, DraftFile, Engine, Material, Opportunity, Profile, Snippet } from '../lib/types.ts'
import { buildDraftPrompt } from '../lib/prompts.ts'
import { isActive } from '../lib/deadlines.ts'
import { api } from '../api.ts'
import { link } from '../router.ts'
import { useApp } from '../state.tsx'
import { Badge, CopyButton, DeadlineCell, Field } from '../components/ui.tsx'
import type { Tone } from '../components/ui.tsx'

// ---------------------------------------------------------------- home

export function DraftsHome() {
  const { opps, today } = useApp()
  const rows = useMemo(() => opps.filter((o) => isActive(o) && o.materials.length > 0).sort((a, b) => (a.deadline.date ?? '9999').localeCompare(b.deadline.date ?? '9999')), [opps])
  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Materials and drafts</h1>
          <div className="muted">Track what each application needs, draft in Claude, ChatGPT or Gemini, paste the result back, and get it audited.</div>
        </div>
      </div>
      {rows.length === 0 ? (
        <div className="card empty">No active rows list any materials yet. Add them on a tracker row (Materials, separated by semicolons).</div>
      ) : (
        <div className="card scroll-x" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Program</th>
                <th>Deadline</th>
                <th>Materials done</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => {
                const done = o.materials.filter((m) => m.done).length
                return (
                  <tr key={o.id}>
                    <td>
                      <a href={link('drafts', o.id)}>
                        <strong>{o.programName}</strong>
                      </a>
                    </td>
                    <td>
                      <DeadlineCell o={o} today={today} />
                    </td>
                    <td>
                      <div className="row">
                        <div className="progress" style={{ width: 100 }}>
                          <i style={{ width: `${(done / o.materials.length) * 100}%` }} />
                        </div>
                        <span className="small">
                          {done}/{o.materials.length}
                        </span>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <ProfileEditor />
    </div>
  )
}

// ---------------------------------------------------------------- profile + snippet bank

function ProfileEditor() {
  const { profile, act } = useApp()
  const [summary, setSummary] = useState(profile?.summary ?? '')
  const [snippets, setSnippets] = useState<Snippet[]>(profile?.snippets ?? [])
  useEffect(() => {
    if (profile) {
      setSummary(profile.summary)
      setSnippets(profile.snippets)
    }
  }, [profile])
  if (!profile) return null
  const dirty = summary !== profile.summary || JSON.stringify(snippets) !== JSON.stringify(profile.snippets)
  const upd = (i: number, patch: Partial<Snippet>) => setSnippets((s) => s.map((x, j) => (j === i ? { ...x, ...patch } : x)))
  return (
    <div className="card" style={{ marginTop: 24 }}>
      <div className="row between">
        <h2>Profile and snippet bank</h2>
        <button className="btn primary" disabled={!dirty} onClick={() => act(() => api.saveProfile({ ...profile, summary, snippets }), 'Profile saved.')}>
          Save profile
        </button>
      </div>
      <div className="muted small" style={{ marginBottom: 8 }}>
        The summary goes into every search and draft prompt, and the audit treats it as the only source of facts (a figure that is not here gets flagged). Snippets are
        your own wording, which you can tick into a draft prompt.
      </div>
      <Field label="Profile summary">
        <textarea rows={6} value={summary} onChange={(e) => setSummary(e.target.value)} />
      </Field>
      <h3 style={{ marginTop: 14 }}>Snippets</h3>
      <div className="stack">
        {snippets.map((s, i) => (
          <div className="card flat" key={s.id}>
            <div className="row between">
              <input value={s.title} onChange={(e) => upd(i, { title: e.target.value })} style={{ maxWidth: 300 }} />
              <button className="btn small danger" onClick={() => setSnippets((x) => x.filter((_, j) => j !== i))}>
                Remove
              </button>
            </div>
            <textarea rows={2} value={s.text} onChange={(e) => upd(i, { text: e.target.value })} style={{ marginTop: 6 }} />
          </div>
        ))}
        <div>
          <button className="btn" onClick={() => setSnippets((x) => [...x, { id: `snippet-${Date.now().toString(36)}`, title: 'New snippet', tags: [], text: '' }])}>
            Add snippet
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- one application

export function DraftsDetail({ oppId }: { oppId: string }) {
  const { opps, act } = useApp()
  const opp = opps.find((o) => o.id === oppId)
  const [selected, setSelected] = useState<string | null>(null)
  if (!opp) return <div className="card empty">No such row. <a href={link('drafts')}>Back</a></div>

  const saveMaterials = (materials: Material[]) => act(() => api.patchOpp(opp.id, { materials }))
  const patchMaterial = (id: string, patch: Partial<Material>) => saveMaterials(opp.materials.map((m) => (m.id === id ? { ...m, ...patch } : m)))
  const current = opp.materials.find((m) => m.id === selected)

  return (
    <div>
      <div className="page-head">
        <div>
          <a href={link('drafts')} className="small">
            Back to all materials
          </a>
          <h1>{opp.programName}</h1>
          <div className="muted">
            <a href={link('tracker', opp.id)}>Open tracker row</a>
          </div>
        </div>
      </div>

      <div className="card">
        <h2>Checklist</h2>
        {opp.materials.length === 0 && <div className="muted">No materials listed. Add them on the tracker row.</div>}
        <table>
          <tbody>
            {opp.materials.map((m) => (
              <tr key={m.id}>
                <td style={{ width: 30 }}>
                  <input type="checkbox" checked={m.done} onChange={() => patchMaterial(m.id, { done: !m.done })} />
                </td>
                <td>
                  <span style={m.done ? { textDecoration: 'line-through', opacity: 0.6 } : undefined}>{m.label}</span>{' '}
                  <Badge>{m.kind}</Badge>
                  {m.count ? <Badge tone="info">{m.count} needed</Badge> : null}
                  {m.wordLimit ? <span className="muted small"> {m.wordLimit} words</span> : null}
                </td>
                <td style={{ textAlign: 'right' }}>
                  <button className={`btn small ${selected === m.id ? 'primary' : ''}`} onClick={() => setSelected(selected === m.id ? null : m.id)}>
                    {selected === m.id ? 'Close' : m.kind === 'recommendation' || m.kind === 'document' ? 'Notes / draft' : 'Draft this'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {current && <Workbench key={current.id} opp={opp} material={current} onPatch={(p) => patchMaterial(current.id, p)} />}
    </div>
  )
}

// ---------------------------------------------------------------- draft workbench

function Workbench({ opp, material, onPatch }: { opp: Opportunity; material: Material; onPatch: (p: Partial<Material>) => void }) {
  const { profile, today, toast } = useApp()
  const [file, setFile] = useState<DraftFile | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [prompt, setPrompt] = useState(material.prompt ?? '')
  const [words, setWords] = useState(material.wordLimit?.toString() ?? '')
  const [chars, setChars] = useState(material.charLimit?.toString() ?? '')
  const [text, setText] = useState('')
  const [source, setSource] = useState<Engine | 'me'>('claude')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    api.draft(opp.id, material.id).then(setFile).catch((e: Error) => toast(e.message))
  }, [opp.id, material.id, toast])
  useEffect(load, [load])

  const settingsDirty = prompt !== (material.prompt ?? '') || words !== (material.wordLimit?.toString() ?? '') || chars !== (material.charLimit?.toString() ?? '')
  const live: Material = { ...material, prompt: prompt || undefined, wordLimit: words ? Number(words) : undefined, charLimit: chars ? Number(chars) : undefined }
  const draftPrompt = useMemo(
    () => (profile ? buildDraftPrompt({ opportunity: opp, material: live, profile: profile as Profile, snippets: profile.snippets.filter((s) => picked.has(s.id)), today }) : ''),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [opp, prompt, words, chars, picked, profile, today, material],
  )

  const save = async () => {
    setBusy(true)
    try {
      setFile(await api.saveDraft(opp.id, material.id, { text, source, note: note || undefined }))
      setText('')
      setNote('')
    } catch (e) {
      toast((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const versions = [...(file?.versions ?? [])].reverse()
  return (
    <div className="card">
      <h2>{material.label}</h2>

      <h3>1. Settings</h3>
      <div className="fields">
        <Field label="Question / instructions, verbatim from the application" wide>
          <textarea rows={4} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Paste the essay prompt exactly as the application words it." />
        </Field>
        <Field label="Word limit">
          <input type="number" min={0} value={words} onChange={(e) => setWords(e.target.value)} />
        </Field>
        <Field label="Character limit">
          <input type="number" min={0} value={chars} onChange={(e) => setChars(e.target.value)} />
        </Field>
      </div>
      <div style={{ marginTop: 8 }}>
        <button className="btn" disabled={!settingsDirty} onClick={() => onPatch({ prompt: prompt || undefined, wordLimit: words ? Number(words) : undefined, charLimit: chars ? Number(chars) : undefined })}>
          Save settings
        </button>
      </div>

      <h3 style={{ marginTop: 18 }}>2. Draft prompt</h3>
      <div className="muted small">Tick the snippets the draft may draw on, copy the prompt into Claude, ChatGPT or Gemini, then paste what comes back in step 3.</div>
      <div className="row" style={{ margin: '8px 0' }}>
        {profile?.snippets.map((s) => (
          <label className="inline" key={s.id}>
            <input
              type="checkbox"
              checked={picked.has(s.id)}
              onChange={() =>
                setPicked((p) => {
                  const n = new Set(p)
                  if (!n.delete(s.id)) n.add(s.id)
                  return n
                })
              }
            />
            {s.title}
          </label>
        ))}
      </div>
      <CopyButton text={draftPrompt} label="Copy draft prompt" className="btn primary" />
      <details style={{ marginTop: 8 }}>
        <summary className="small">Preview</summary>
        <pre className="prompt">{draftPrompt}</pre>
      </details>

      <h3 style={{ marginTop: 18 }}>3. Paste the draft back</h3>
      <div className="stack">
        <Field label="Draft text">
          <textarea rows={8} value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
        <div className="row">
          <div style={{ width: 180 }}>
            <Field label="Written by">
              <select value={source} onChange={(e) => setSource(e.target.value as Engine | 'me')}>
                <option value="claude">Claude</option>
                <option value="chatgpt">ChatGPT</option>
                <option value="gemini">Gemini</option>
                <option value="perplexity">Perplexity</option>
                <option value="me">Me (edited)</option>
              </select>
            </Field>
          </div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <Field label="Note (optional)">
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="what changed in this version" />
            </Field>
          </div>
        </div>
        <div>
          <button className="btn primary" disabled={busy || !text.trim()} onClick={save}>
            {busy ? 'Auditing...' : `Save as version ${(file?.versions.length ?? 0) + 1} and audit`}
          </button>
        </div>
      </div>

      <h3 style={{ marginTop: 18 }}>Versions</h3>
      {versions.length === 0 && <div className="muted small">Nothing saved yet.</div>}
      {versions.map((v, i) => (
        <div className="card flat" key={v.n} style={i === 0 ? { borderColor: 'var(--accent)' } : undefined}>
          <div className="row between">
            <span>
              <strong>v{v.n}</strong> <span className="muted small">{v.source} · {v.createdAt.slice(0, 16).replace('T', ' ')}{v.note ? ` · ${v.note}` : ''}</span>
            </span>
            <span className="row">
              <CopyButton text={v.text} label="Copy text" className="btn small" />
              <button className="btn small" onClick={() => setText(v.text)}>
                Load into editor
              </button>
            </span>
          </div>
          <AuditView audit={v.audit} />
          <details>
            <summary className="small">Show text</summary>
            <pre className="prompt">{v.text}</pre>
          </details>
        </div>
      ))}
    </div>
  )
}

const TONE: Record<string, Tone> = { pass: 'ok', warn: 'warn', fail: 'bad', info: 'muted' }
const WORD: Record<string, string> = { pass: 'OK', warn: 'CHECK', fail: 'FIX', info: 'NOTE' }

function AuditView({ audit }: { audit: AuditReport }) {
  return (
    <div className="audit" style={{ margin: '8px 0' }}>
      <div className="muted small">
        {audit.words} words, {audit.chars} characters
      </div>
      {audit.checks.map((c) => (
        <div className="item" key={c.code + c.label}>
          <Badge tone={TONE[c.status]}>{WORD[c.status]}</Badge>
          <span className="small">
            <strong>{c.label}.</strong> {c.detail}
          </span>
        </div>
      ))}
    </div>
  )
}
