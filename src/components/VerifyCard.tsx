import { useEffect, useState } from 'react'
import type { Opportunity } from '../lib/types.ts'
import { api } from '../api.ts'
import { useApp } from '../state.tsx'
import { Badge, Field, VerifBadge } from './ui.tsx'
import type { Tone } from './ui.tsx'

const MATCH_TONE: Record<string, Tone> = { exact: 'ok', partial: 'warn', none: 'bad', not_checked: 'muted' }
const MATCH_TEXT: Record<string, string> = {
  exact: 'Deadline found on page',
  partial: 'Month and day found, year not shown',
  none: 'Deadline NOT found on page',
  not_checked: 'No deadline to check',
}

/**
 * Check an official page (reports only), then confirm the row by hand. The server never marks a row official
 * from the page check; this button is the only route to 'official'.
 */
export function VerifyCard({ opp }: { opp: Opportunity }) {
  const { act } = useApp()
  const [busy, setBusy] = useState(false)
  const [date, setDate] = useState(opp.deadline.date ?? '')
  const [time, setTime] = useState(opp.deadline.time ?? '')
  const [tz, setTz] = useState(opp.deadline.timezone ?? '')
  const [url, setUrl] = useState(opp.officialUrl)
  const [note, setNote] = useState('')
  const [self, setSelf] = useState(false)

  useEffect(() => {
    setDate(opp.deadline.date ?? '')
    setTime(opp.deadline.time ?? '')
    setTz(opp.deadline.timezone ?? '')
    setUrl(opp.officialUrl)
  }, [opp.id, opp.deadline.date, opp.deadline.time, opp.deadline.timezone, opp.officialUrl])

  const v = opp.verification
  const exact = v?.deadlineMatch === 'exact' && v.url === url && (opp.deadline.date ?? '') === date
  const isOfficial = opp.sourceVerified === 'official'

  const check = async () => {
    setBusy(true)
    await act(() => api.verify({ oppId: opp.id, url, programName: opp.programName, deadlineDate: date || undefined }))
    setBusy(false)
  }
  const confirm = async () => {
    setBusy(true)
    const r = await act(
      () => api.confirm(opp.id, { deadline: { date, time, timezone: tz }, officialUrl: url, note: note || undefined }),
      'Confirmed as official.',
    )
    if (r) {
      setNote('')
      setSelf(false)
    }
    setBusy(false)
  }

  return (
    <div className="stack">
      <div className="row between">
        <span className="row">
          <VerifBadge v={opp.sourceVerified} />
          {opp.lastChecked && <span className="muted small">last checked {opp.lastChecked}</span>}
          {v?.confirmedAt && isOfficial && <span className="muted small">confirmed {v.confirmedAt.slice(0, 10)}</span>}
        </span>
        {url && (
          <a href={url} target="_blank" rel="noreferrer" className="small">
            Open official page
          </a>
        )}
      </div>

      <div className="fields">
        <Field label="Official URL" wide>
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://..." />
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

      <div className="row">
        <button className="btn" disabled={busy || !url} onClick={check}>
          {busy ? 'Working...' : 'Check page'}
        </button>
        <span className="muted small">Fetches the page and reports what it says. It does not verify anything by itself.</span>
      </div>

      {v && (
        <div className="card flat">
          <div className="row">
            <Badge tone={v.ok ? 'ok' : 'bad'}>{v.httpStatus ? `HTTP ${v.httpStatus}` : v.ok ? 'earlier check' : 'no response'}</Badge>
            <Badge tone={v.nameFound ? 'ok' : 'warn'}>{v.nameFound ? 'Program name on page' : 'Program name not found'}</Badge>
            <Badge tone={MATCH_TONE[v.deadlineMatch] ?? 'muted'}>{MATCH_TEXT[v.deadlineMatch]}</Badge>
            <span className="muted small">checked {v.checkedAt.slice(0, 16).replace('T', ' ')}</span>
          </div>
          {v.title && <div className="small muted">Page title: {v.title}</div>}
          {v.finalUrl && v.finalUrl !== v.url && <div className="small muted">Redirected to {v.finalUrl}</div>}
          {v.error && <div className="small" style={{ color: 'var(--warn)' }}>{v.error}</div>}
          {v.dates.length > 0 && (
            <details open={v.deadlineMatch !== 'exact'}>
              <summary>Dates on the page ({v.dates.length})</summary>
              <table>
                <tbody>
                  {v.dates.map((d, i) => (
                    <tr key={i}>
                      <td className="nowrap mono">{d.iso}</td>
                      <td className="small">{d.snippet}</td>
                      <td>
                        <button className="btn small" onClick={() => d.iso && setDate(d.iso)}>
                          Use this date
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
        </div>
      )}

      <div className="stack">
        <Field label="Note (optional)">
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. deadline shown under 'How to apply'" />
        </Field>
        {!exact && (
          <label className="inline">
            <input type="checkbox" checked={self} onChange={(e) => setSelf(e.target.checked)} />
            The page check did not confirm this deadline; I read the official page myself and it matches.
          </label>
        )}
        <div>
          <button className="btn primary" disabled={busy || !url || (!exact && !self)} onClick={confirm}>
            {isOfficial ? 'Re-confirm as official' : 'Confirm as official'}
          </button>
        </div>
      </div>
    </div>
  )
}
