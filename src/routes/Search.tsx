import { useCallback, useEffect, useState } from 'react'
import type { Engine, ReviewItem, RunRecord } from '../lib/types.ts'
import type { Category } from '../lib/categories.ts'
import { categoryById } from '../lib/categories.ts'
import { ENGINE_LABEL } from '../lib/merge.ts'
import { api } from '../api.ts'
import type { Decision, RunSummary } from '../api.ts'
import { go, link } from '../router.ts'
import { useApp } from '../state.tsx'
import { Badge, Claims, CopyButton, EngineChips, Field, Flags, deadlineText } from '../components/ui.tsx'
import type { Tone } from '../components/ui.tsx'

const ENGINES: { id: Exclude<Engine, 'manual'>; url: string; hint: string }[] = [
  { id: 'perplexity', url: 'https://www.perplexity.ai/', hint: 'Use Labs or Research mode.' },
  { id: 'chatgpt', url: 'https://chatgpt.com/', hint: 'Use Deep Research.' },
  { id: 'claude', url: 'https://claude.ai/', hint: 'Turn on web search / research.' },
  { id: 'gemini', url: 'https://gemini.google.com/app', hint: 'Use Deep Research.' },
]

// ---------------------------------------------------------------- home

export function SearchHome() {
  const { toast } = useApp()
  const [data, setData] = useState<{ categories: Category[]; runs: RunSummary[] } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    api.searches().then(setData).catch((e: Error) => toast(e.message))
  }, [toast])

  const start = async (id: string) => {
    setBusy(id)
    try {
      const run = await api.newRun(id)
      go('search', run.id)
    } catch (e) {
      toast((e as Error).message)
      setBusy(null)
    }
  }

  if (!data) return <div className="empty">Loading...</div>
  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Search console</h1>
          <div className="muted">Pick a category, run the generated prompt in each engine, paste the answers back. One category per session.</div>
        </div>
      </div>
      <div className="grid cols-2">
        {data.categories.map((c) => {
          const runs = data.runs.filter((r) => r.categoryId === c.id)
          return (
            <div className="card" key={c.id}>
              <div className="row between">
                <h2>
                  ({c.letter}) {c.label}
                </h2>
                <button className="btn primary" disabled={busy !== null} onClick={() => start(c.id)}>
                  {busy === c.id ? 'Starting...' : 'New run'}
                </button>
              </div>
              <div className="muted small" style={{ marginTop: 8 }}>{c.focus}</div>
              {runs.length > 0 && (
                <div className="stack" style={{ marginTop: 10 }}>
                  <div className="muted small">Previous runs</div>
                  {runs.slice(0, 4).map((r) => (
                    <div key={r.id} className="row between small">
                      <a href={link('search', r.id)}>{r.createdAt.slice(0, 16).replace('T', ' ')}</a>
                      <span className="muted">
                        {r.engines.length}/{ENGINES.length} engines, {r.items} leads, {r.decided} decided
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- run

export function RunView({ runId }: { runId: string }) {
  const { toast, reload } = useApp()
  const [run, setRun] = useState<RunRecord | null>(null)
  const [texts, setTexts] = useState<Partial<Record<Engine, string>>>({})
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    api.run(runId).then(setRun).catch((e: Error) => toast(e.message))
  }, [runId, toast])

  const submit = async (engine: Engine) => {
    setBusy(engine)
    try {
      setRun(await api.paste(runId, engine, texts[engine] ?? ''))
      setTexts((t) => ({ ...t, [engine]: '' }))
    } catch (e) {
      toast((e as Error).message)
    } finally {
      setBusy(null)
    }
  }
  const remove = async (engine: Engine) => {
    setBusy(engine)
    try {
      setRun(await api.unpaste(runId, engine))
    } catch (e) {
      toast((e as Error).message)
    } finally {
      setBusy(null)
    }
  }
  const decide = useCallback(
    async (d: Decision) => {
      try {
        const r = await api.commit(runId, [d])
        setRun(r.run)
        await reload()
        if (r.errors.length) toast(r.errors[0]!.error)
        else toast(d.action === 'skip' ? 'Skipped.' : d.action === 'add' ? 'Added to the tracker.' : 'Claims attached.', 'ok')
      } catch (e) {
        toast((e as Error).message)
      }
    },
    [runId, reload, toast],
  )

  const addAll = async (items: ReviewItem[]) => {
    setBusy('all')
    try {
      const r = await api.commit(runId, items.map((it) => ({ key: it.key, action: 'add' as const })))
      setRun(r.run)
      await reload()
      const added = `Added ${r.added.length} to the tracker as unverified. Find them in the Verify tab.`
      if (r.errors.length) toast(`${added} ${r.errors.length} not added: ${r.errors.map((e) => e.error).join(' ')}`)
      else toast(added, 'ok')
    } catch (e) {
      toast((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  if (!run) return <div className="empty">Loading...</div>
  const cat = categoryById(run.categoryId)
  const addable = run.review.filter((i) => i.outcome === 'new' && !run.decisions[i.key])
  const pasted = Object.keys(run.pastes) as Engine[]
  const groups: { outcome: ReviewItem['outcome']; title: string; note: string; open: boolean }[] = [
    { outcome: 'new', title: 'New leads', note: 'Not in your tracker and no rule blocks them.', open: true },
    { outcome: 'review', title: 'Possible duplicates: your call', note: 'Looks close to something you already track (different cycle, similar name, or shared URL).', open: true },
    { outcome: 'duplicate', title: 'Already tracked', note: 'These match a tracker row. Attach the new claims to see whether any engine disagrees with what you have.', open: true },
    { outcome: 'excluded', title: 'Auto-excluded by your rules', note: 'Pell-restricted, degree-holder-only, aggregator or commercial. Add one anyway if a rule is wrong.', open: false },
  ]

  return (
    <div>
      <div className="page-head">
        <div>
          <a href={link('search')} className="small">
            Back to categories
          </a>
          <h1>
            {cat ? `(${cat.letter}) ${cat.label}` : run.categoryId}
          </h1>
          <div className="muted small">Run {run.id}, started {run.createdAt.slice(0, 16).replace('T', ' ')}</div>
        </div>
      </div>

      <h2>1. Run the prompt, paste the answer</h2>
      <div className="grid cols-3">
        {ENGINES.map((e) => {
          const paste = run.pastes[e.id]
          return (
            <div className="card" key={e.id}>
              <div className="row between">
                <h3>{ENGINE_LABEL[e.id]}</h3>
                <a href={e.url} target="_blank" rel="noreferrer" className="small">
                  Open {ENGINE_LABEL[e.id]}
                </a>
              </div>
              <div className="muted small">{e.hint}</div>
              <div className="row" style={{ margin: '8px 0' }}>
                <CopyButton text={run.prompts[e.id] ?? ''} label="Copy prompt" className="btn primary" />
              </div>
              <details>
                <summary className="small">Preview the prompt</summary>
                <pre className="prompt">{run.prompts[e.id]}</pre>
              </details>
              {paste && (
                <div className="row between" style={{ margin: '8px 0' }}>
                  <span>
                    <Badge tone={paste.rowCount ? 'ok' : 'bad'}>
                      {paste.rowCount} lead{paste.rowCount === 1 ? '' : 's'} ({paste.format})
                    </Badge>{' '}
                    <span className="muted small">pasted {paste.pastedAt.slice(11, 16)}</span>
                  </span>
                  <button className="btn small danger" disabled={busy !== null} onClick={() => remove(e.id)}>
                    Remove
                  </button>
                </div>
              )}
              {paste?.errors.map((m) => (
                <div key={m} className="flag warn">
                  {m}
                </div>
              ))}
              <Field label={paste ? 'Replace with a new paste' : "Paste the engine's full answer"}>
                <textarea
                  rows={5}
                  value={texts[e.id] ?? ''}
                  onChange={(ev) => setTexts((t) => ({ ...t, [e.id]: ev.target.value }))}
                  placeholder="```json [ ... ] ```"
                />
              </Field>
              <div style={{ marginTop: 8 }}>
                <button className="btn" disabled={busy !== null || !(texts[e.id] ?? '').trim()} onClick={() => submit(e.id)}>
                  {busy === e.id ? 'Parsing...' : paste ? 'Replace and re-review' : 'Parse and review'}
                </button>
              </div>
            </div>
          )
        })}
      </div>

      <h2 style={{ marginTop: 24 }}>2. Review</h2>
      {pasted.length === 0 ? (
        <div className="card empty">Paste at least one engine's answer above and the merged review appears here.</div>
      ) : (
        <>
          <div className="muted small" style={{ marginBottom: 8 }}>
            {run.review.length} distinct program{run.review.length === 1 ? '' : 's'} from {pasted.length} engine{pasted.length === 1 ? '' : 's'}
            {run.invalidRows > 0 ? `, ${run.invalidRows} row${run.invalidRows === 1 ? '' : 's'} dropped for having no program name` : ''}.
            Nothing here changes your tracker until you press a button, and nothing becomes official until you verify it.
          </div>
          <div className="card flat row between" style={{ marginBottom: 12 }}>
            <span className="small">
              <strong>{addable.length}</strong> new lead{addable.length === 1 ? '' : 's'} not yet decided. Possible duplicates, already-tracked and auto-excluded leads are left for you to decide one by one.
            </span>
            <button className="btn primary" disabled={busy !== null || addable.length === 0} onClick={() => addAll(addable)}>
              {busy === 'all' ? 'Adding...' : `Add all ${addable.length} new to tracker`}
            </button>
          </div>
          {groups.map((g) => {
            const items = run.review.filter((i) => i.outcome === g.outcome)
            if (!items.length) return null
            return (
              <details key={g.outcome} open={g.open} style={{ marginBottom: 12 }}>
                <summary>
                  <strong>
                    {g.title} ({items.length})
                  </strong>{' '}
                  <span className="muted small">{g.note}</span>
                </summary>
                <div style={{ marginTop: 8 }}>
                  {items.map((it) => (
                    <ReviewCard key={it.key} item={it} decision={run.decisions[it.key]} onDecide={decide} />
                  ))}
                </div>
              </details>
            )
          })}
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- one lead

const OUTCOME_TONE: Record<ReviewItem['outcome'], Tone> = { new: 'ok', review: 'warn', duplicate: 'info', excluded: 'bad' }
const short = (s: string, n = 260) => (s.length > n ? s.slice(0, n) + '...' : s)

function ReviewCard({ item, decision, onDecide }: { item: ReviewItem; decision?: RunRecord['decisions'][string]; onDecide: (d: Decision) => void }) {
  const d = item.draft
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(d.programName)
  const [url, setUrl] = useState(d.officialUrl)
  const [cycle, setCycle] = useState(d.programCycle)
  const [date, setDate] = useState(d.deadline.date ?? '')
  const [time, setTime] = useState(d.deadline.time ?? '')
  const [tz, setTz] = useState(d.deadline.timezone ?? '')
  const [sending, setSending] = useState(false)

  const send = async (dec: Decision) => {
    setSending(true)
    await onDecide(dec)
    setSending(false)
  }
  const edits = editing ? { programName: name, officialUrl: url, programCycle: cycle, deadline: { date, time, timezone: tz } } : undefined
  const conflicts = d.flags.filter((f) => f.kind === 'conflict')
  const other = d.flags.filter((f) => f.kind !== 'conflict')

  return (
    <div className="card" style={decision ? { opacity: 0.65 } : undefined}>
      <div className="row between">
        <div>
          <strong>{d.programName}</strong> <span className="muted">{d.sponsor}</span>{' '}
          <EngineChips engines={item.engines} />
        </div>
        <span className="row">
          {decision ? (
            <Badge tone={decision.action === 'skip' ? 'muted' : 'ok'}>
              {decision.action === 'add' ? 'Added' : decision.action === 'attach' ? 'Attached' : 'Skipped'}
            </Badge>
          ) : (
            <Badge tone={OUTCOME_TONE[item.outcome]}>{item.outcome}</Badge>
          )}
          {decision?.oppId && (
            <a className="small" href={link('tracker', decision.oppId)}>
              Open
            </a>
          )}
        </span>
      </div>

      <div className="grid cols-2 small" style={{ margin: '8px 0' }}>
        <div className="stack">
          <div>
            <span className="muted">Cycle:</span> {d.programCycle || '-'} <span className="muted">Where:</span> {d.location || '-'}
          </div>
          <div>
            <span className="muted">Deadline:</span> <strong>{deadlineText(d)}</strong>
          </div>
          <div>
            <span className="muted">URL:</span>{' '}
            {d.officialUrl ? (
              <a href={d.officialUrl} target="_blank" rel="noreferrer">
                {d.officialUrl}
              </a>
            ) : (
              '-'
            )}
          </div>
          {d.claims.deadlineEvidence?.[0] && (
            <div className="muted">Evidence: "{short(d.claims.deadlineEvidence[0].value, 200)}"</div>
          )}
        </div>
        <div className="stack">
          {d.funding.details && <div><span className="muted">Funding:</span> {short(d.funding.details)}</div>}
          {d.eligibilitySummary && <div><span className="muted">Eligibility:</span> {short(d.eligibilitySummary)}</div>}
          {d.materialsText && <div><span className="muted">Materials:</span> {short(d.materialsText, 160)}</div>}
        </div>
      </div>

      {conflicts.length > 0 && (
        <div style={{ marginBottom: 6 }}>
          <Flags flags={conflicts} />
        </div>
      )}
      {other.length > 0 && <Flags flags={other} />}

      {item.match && (
        <div className="small" style={{ marginTop: 6 }}>
          <Badge tone="info">matches</Badge>{' '}
          <a href={link('tracker', item.match.id)}>{item.match.programName}</a> <span className="muted">({item.match.reason})</span>
        </div>
      )}
      {item.diffs.length > 0 && (
        <table className="diff small">
          <thead>
            <tr>
              <th>Field</th>
              <th>Your tracker</th>
              <th>Engines say</th>
            </tr>
          </thead>
          <tbody>
            {item.diffs.map((x, i) => (
              <tr key={i}>
                <td>{x.field}</td>
                <td>{short(x.tracker, 120)}</td>
                <td>
                  <strong>{short(x.incoming, 120)}</strong>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {item.mergeReasons.length > 0 && item.engines.length > 1 && (
        <div className="muted small">Merged across engines: {item.mergeReasons.join(', ')}.</div>
      )}

      <details style={{ marginTop: 6 }}>
        <summary className="small">Who said what</summary>
        <Claims claims={d.claims} />
      </details>

      {!decision && (
        <>
          {editing && (
            <div className="fields" style={{ margin: '10px 0' }}>
              <Field label="Program name" wide>
                <input value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
              <Field label="Official URL" wide>
                <input value={url} onChange={(e) => setUrl(e.target.value)} />
              </Field>
              <Field label="Cycle">
                <input value={cycle} onChange={(e) => setCycle(e.target.value)} />
              </Field>
              <Field label="Deadline date">
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </Field>
              <Field label="Time (24h)">
                <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
              </Field>
              <Field label="Timezone (IANA)">
                <input value={tz} onChange={(e) => setTz(e.target.value)} placeholder="America/New_York" />
              </Field>
            </div>
          )}
          <div className="row" style={{ marginTop: 10 }}>
            {item.outcome !== 'duplicate' && (
              <button className="btn primary" disabled={sending} onClick={() => send({ key: item.key, action: 'add', edits })}>
                {item.outcome === 'new' ? 'Add to tracker' : item.outcome === 'review' ? 'Add as a separate program' : 'Add anyway'}
              </button>
            )}
            {item.match && (
              <button className="btn" disabled={sending} onClick={() => send({ key: item.key, action: 'attach', matchId: item.match!.id })}>
                Attach claims to "{short(item.match.programName, 30)}"
              </button>
            )}
            {item.outcome !== 'duplicate' && (
              <button className="btn small" onClick={() => setEditing((v) => !v)}>
                {editing ? 'Cancel edit' : 'Edit before adding'}
              </button>
            )}
            <button className="btn small" disabled={sending} onClick={() => send({ key: item.key, action: 'skip' })}>
              Skip
            </button>
          </div>
        </>
      )}
    </div>
  )
}
