import type { FitInputs, Opportunity } from './types.ts'

export const FIT_WEIGHTS: Record<keyof FitInputs, number> = {
  funding: 30,
  academic: 25,
  travel: 20,
  chance: 15,
  network: 10,
}

export const FIT_LABELS: Record<keyof FitInputs, string> = {
  funding: 'Funding',
  academic: 'Technical / academic fit',
  travel: 'Travel value',
  chance: 'Selectivity-adjusted chance',
  network: 'Network / career value',
}

const clamp = (n: number) => Math.min(5, Math.max(1, Number.isFinite(n) ? n : 1))

/** 30*funding + 25*academic + 20*travel + 15*chance + 10*network, each rated 1-5 and scaled to its weight. */
export function fitScore(f: FitInputs): number {
  let total = 0
  for (const k of Object.keys(FIT_WEIGHTS) as (keyof FitInputs)[]) total += (clamp(f[k]) / 5) * FIT_WEIGHTS[k]
  return Math.round(total)
}

export function effectiveFit(o: Pick<Opportunity, 'fit' | 'fitOverride'>): number | undefined {
  if (o.fitOverride != null && Number.isFinite(o.fitOverride)) return o.fitOverride
  return o.fit ? fitScore(o.fit) : undefined
}
