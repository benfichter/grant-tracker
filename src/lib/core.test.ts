import test from 'node:test'
import assert from 'node:assert/strict'
import { duplicateKey, normalizeUrl, normCycle } from './normalize.ts'
import { ratio } from './similarity.ts'
import { addDays, daysBetween, findDates, normalizeDate, normalizeTime, normalizeTz, zonedToUtc } from './dates.ts'
import { fitScore } from './fit.ts'

test('normalizeUrl lowercases host, strips www, query, fragment and trailing slash', () => {
  assert.equal(normalizeUrl('https://www.NobleReach.smapply.us/prog/x/?utm=1#top'), 'noblereach.smapply.us/prog/x')
  assert.equal(normalizeUrl('example.org/a/'), 'example.org/a')
  assert.equal(normalizeUrl(''), '')
  assert.equal(normalizeUrl('http://'), '')
})

test('duplicateKey canonicalises month abbreviations in the cycle', () => {
  assert.equal(duplicateKey('NobleReach', 'NobleReach Scholars', 'Feb 2027'), duplicateKey('NobleReach', 'NobleReach Scholars', 'February 2027'))
  assert.equal(normCycle('Sept. 2027'), 'september 2027')
})

test('ratio matches Python difflib on the value the old script produced', () => {
  // dedupe.py printed "sponsor+title similarity 0.87" for exactly this pair.
  const a = 'noblereach noblereach scholar program'
  const b = 'noblereach noblereach scholars'
  assert.equal(ratio(a, b).toFixed(2), '0.87')
  assert.equal(ratio('', ''), 1)
  assert.equal(ratio('abc', 'xyz'), 0)
  assert.equal(ratio('abcd', 'abcd'), 1)
})

test('normalizeDate handles common formats and rejects ambiguity', () => {
  assert.equal(normalizeDate('2027-01-15'), '2027-01-15')
  assert.equal(normalizeDate('January 15, 2027'), '2027-01-15')
  assert.equal(normalizeDate('Jan 5th, 2027 at 11:59 PM ET'), '2027-01-05')
  assert.equal(normalizeDate('15 March 2027'), '2027-03-15')
  assert.equal(normalizeDate('3/15/2027'), '2027-03-15')
  assert.equal(normalizeDate('15/3/2027'), '2027-03-15')
  assert.equal(normalizeDate('Oct 14 2026 11:59 PM (EDT)'), '2026-10-14')
  assert.equal(normalizeDate('Rolling'), undefined)
  assert.equal(normalizeDate('February 30, 2027'), undefined)
  assert.equal(normalizeDate('Opens Sept 9, 2026; closes Oct 14, 2026'), undefined)
  assert.equal(findDates('2027-01-15 and again 2027-01-15').length, 2)
})

test('normalizeTime and normalizeTz', () => {
  assert.equal(normalizeTime('11:59 PM'), '23:59')
  assert.equal(normalizeTime('12:00 am'), '00:00')
  assert.equal(normalizeTime('noon'), '12:00')
  assert.equal(normalizeTime('23:59'), '23:59')
  assert.equal(normalizeTime('soon'), undefined)
  assert.equal(normalizeTz('11:59 PM EDT'), 'America/New_York')
  assert.equal(normalizeTz('America/Chicago'), 'America/Chicago')
  assert.equal(normalizeTz('anywhere on earth'), 'Etc/GMT+12')
  assert.equal(normalizeTz(''), undefined)
})

test('zonedToUtc converts wall time to UTC across DST', () => {
  assert.equal(zonedToUtc('2026-10-14', '23:59', 'America/New_York')?.toISOString(), '2026-10-15T03:59:00.000Z')
  assert.equal(zonedToUtc('2027-01-15', '23:59', 'America/New_York')?.toISOString(), '2027-01-16T04:59:00.000Z')
  assert.equal(zonedToUtc('2027-01-15', '12:00', 'Not/AZone'), undefined)
})

test('day arithmetic', () => {
  assert.equal(daysBetween('2026-09-20', '2026-09-30'), 10)
  assert.equal(daysBetween('2026-09-20', '2026-10-14'), 24)
  assert.equal(addDays('2026-10-14', -28), '2026-09-16')
  assert.equal(addDays('2026-12-31', 1), '2027-01-01')
})

test('fitScore uses the 30/25/20/15/10 weights', () => {
  assert.equal(fitScore({ funding: 5, academic: 5, travel: 5, chance: 5, network: 5 }), 100)
  assert.equal(fitScore({ funding: 1, academic: 1, travel: 1, chance: 1, network: 1 }), 20)
  assert.equal(fitScore({ funding: 5, academic: 3, travel: 4, chance: 2, network: 3 }), 30 + 15 + 16 + 6 + 6)
})
