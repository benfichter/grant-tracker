import { useState } from 'react'
import type { ReactNode } from 'react'
import type { Claim, ClaimField, Engine, Flag, Opportunity, Verification } from '../lib/types.ts'
import { ENGINE_LABEL } from '../lib/merge.ts'
import { daysBetween } from '../lib/dates.ts'

export type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'muted'

export function Badge({ tone = 'muted', children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span className={`badge ${tone}`} title={title}>
      {children}
    </span>
  )
}

const VERIF_TONE: Record<Verification, Tone> = { official: 'ok', secondary: 'warn', recurring_estimate: 'warn', unverified: 'bad' }
export function VerifBadge({ v }: { v: Verification }) {
  return <Badge tone={VERIF_TONE[v]}>{v.replace('_', ' ')}</Badge>
}

const CHIP: Record<Engine, string> = { perplexity: 'P', chatgpt: 'G', claude: 'C', manual: 'M' }
export function EngineChips({ engines }: { engines: Engine[] }) {
  return (
    <span>
      {engines.map((e) => (
        <span key={e} className="chip" title={ENGINE_LABEL[e]}>
          {CHIP[e]}
        </span>
      ))}
    </span>
  )
}

export function Flags({ flags, onToggle }: { flags: Flag[]; onToggle?: (code: string) => void }) {
  if (!flags.length) return null
  const order = { block: 0, warn: 1, info: 2 }
  const sorted = [...flags].sort((a, b) => order[a.severity] - order[b.severity])
  return (
    <div className="stack">
      {sorted.map((f) => (
        <div key={f.code} className={`flag ${f.severity} ${f.dismissed ? 'dismissed' : ''}`}>
          <span>
            <strong>{f.severity === 'block' ? 'Blocker: ' : f.severity === 'warn' ? 'Check: ' : ''}</strong>
            {f.message}
          </span>
          {onToggle && f.severity !== 'info' && (
            <button className="btn small" onClick={() => onToggle(f.code)}>
              {f.dismissed ? 'Restore' : 'Dismiss'}
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

export function CopyButton({ text, label = 'Copy', className = 'btn' }: { text: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      className={className}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setDone(true)
          setTimeout(() => setDone(false), 1500)
        } catch {
          window.prompt('Copy this text:', text)
        }
      }}
    >
      {done ? 'Copied' : label}
    </button>
  )
}

export function Claims({ claims }: { claims: Partial<Record<ClaimField, Claim[]>> }) {
  const entries = Object.entries(claims) as [ClaimField, Claim[]][]
  if (!entries.length) return <div className="muted small">No per-engine claims recorded (seeded or added by hand).</div>
  return (
    <div className="scroll-x">
      <table>
        <tbody>
          {entries.map(([field, list]) => (
            <tr key={field}>
              <td className="muted nowrap">{field}</td>
              <td>
                {list.map((c, i) => (
                  <div key={i}>
                    <EngineChips engines={c.engines} /> {c.value.length > 240 ? c.value.slice(0, 240) + '...' : c.value}
                  </div>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function daysLabel(days: number): string {
  if (days < 0) return `${-days}d ago`
  if (days === 0) return 'today'
  return days === 1 ? 'tomorrow' : `in ${days}d`
}

const TZ_SHORT: Record<string, string> = {
  'America/New_York': 'ET',
  'America/Chicago': 'CT',
  'America/Denver': 'MT',
  'America/Los_Angeles': 'PT',
  'Europe/London': 'UK',
  UTC: 'UTC',
}

export function deadlineText(o: Pick<Opportunity, 'deadline'>): string {
  const d = o.deadline
  if (!d.date) return 'no deadline'
  const tz = d.timezone ? (TZ_SHORT[d.timezone] ?? d.timezone.split('/').pop()!.replace(/_/g, ' ')) : undefined
  return [d.date, d.time, tz].filter(Boolean).join(' ')
}

export function DeadlineCell({ o, today }: { o: Opportunity; today: string }) {
  if (!o.deadline.date) return <span className="muted">none</span>
  const days = daysBetween(today, o.deadline.date)
  const tone: Tone = days < 0 ? 'muted' : days <= 7 ? 'bad' : days <= 21 ? 'warn' : 'muted'
  return (
    <span>
      <span className="nowrap">{deadlineText(o)}</span> <Badge tone={tone}>{daysLabel(days)}</Badge>
    </span>
  )
}

export function Field({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <label className={wide ? 'wide' : undefined}>
      {label}
      {children}
    </label>
  )
}

export const blocked = (o: Opportunity) => o.flags.some((f) => f.severity === 'block' && !f.dismissed)
