import test from 'node:test'
import assert from 'node:assert/strict'
import { bestDuplicateOf, findDuplicatePairs, scoreDuplicate } from './duplicates.ts'
import { makeOpp } from './fixtures.ts'

const RISE = makeOpp({
  id: 'rise-germany-2027',
  programName: 'RISE Germany',
  sponsor: 'DAAD',
  officialUrl: 'https://www.daad.de/en/rise-germany/',
  programCycle: 'Summer 2027',
  deadline: { date: '2026-11-30' },
})
const RISE_LONG = makeOpp({
  id: 'daad-rise-germany-2027',
  programName: 'DAAD RISE Germany (Research Internships in Science and Engineering)',
  sponsor: 'DAAD',
  officialUrl: 'daad.de/en/rise-germany',
  programCycle: 'Summer 2027',
  deadline: { date: '2026-11-30' },
})

test('the same program under a longer name is a likely duplicate, and the evidence says why', () => {
  const s = scoreDuplicate(RISE, RISE_LONG)
  assert.equal(s.level, 'likely')
  assert.deepEqual(
    s.signals.map((x) => x.code).sort(),
    ['cycle', 'deadline', 'name', 'sponsor', 'url'],
  )
})

test('unrelated programs that share a homepage, sponsor and location are not flagged', () => {
  const a = makeOpp({ id: 'a', programName: 'Data Science Summer Camp', sponsor: 'Big University', officialUrl: 'https://bigu.edu', location: 'Boston', programCycle: 'Summer 2027', deadline: { date: '2027-02-01' } })
  const b = makeOpp({ id: 'b', programName: 'Robotics Research Fellowship', sponsor: 'Big University', officialUrl: 'https://bigu.edu/', location: 'Boston', programCycle: 'Summer 2027', deadline: { date: '2027-03-01' } })
  assert.equal(scoreDuplicate(a, b).level, undefined)
})

test('the same program in a different cycle year is never a likely duplicate', () => {
  const a = makeOpp({ id: 'a', programName: 'Kepler Fellowship', sponsor: 'Kepler Fund', officialUrl: 'https://kepler.org/fellowship', programCycle: 'Summer 2026', deadline: { date: '2026-01-10' } })
  const b = makeOpp({ id: 'b', programName: 'Kepler Fellowship', sponsor: 'Kepler Fund', officialUrl: 'https://kepler.org/fellowship', programCycle: 'Summer 2027', deadline: { date: '2027-01-10' } })
  const s = scoreDuplicate(a, b)
  assert.notEqual(s.level, 'likely')
  assert.ok(s.signals.some((x) => x.code === 'cycle' && x.weight < 0))
})

test('cycle text is compared by year, so re-worded cycles still match', () => {
  const a = makeOpp({ programCycle: 'Summer 2027' })
  const b = makeOpp({ programCycle: '2027 cycle (details to be posted late 2026)' })
  assert.ok(scoreDuplicate(a, b).signals.some((x) => x.code === 'cycle' && x.weight > 0))
})

test('findDuplicatePairs ignores closed rows and pairs marked not-a-duplicate (either direction)', () => {
  assert.equal(findDuplicatePairs([RISE, RISE_LONG]).length, 1)
  assert.equal(findDuplicatePairs([RISE, { ...RISE_LONG, status: 'skipped' }]).length, 0)
  assert.equal(findDuplicatePairs([{ ...RISE, notDuplicateOf: [RISE_LONG.id] }, RISE_LONG]).length, 0)
  assert.equal(findDuplicatePairs([RISE, { ...RISE_LONG, notDuplicateOf: [RISE.id] }]).length, 0)
})

test('pairs come back best first', () => {
  const weaker = makeOpp({ id: 'w', programName: 'RISE Germany Extra Program Names', sponsor: 'Other', officialUrl: '', programCycle: 'Summer 2027', deadline: { date: '2026-11-30' } })
  const pairs = findDuplicatePairs([weaker, RISE, RISE_LONG])
  assert.ok(pairs.length >= 2)
  assert.deepEqual(pairs.map((p) => p.score), [...pairs.map((p) => p.score)].sort((x, y) => y - x))
})

test('bestDuplicateOf counts skipped rows: a duplicate of something you already skipped is still a duplicate', () => {
  const hit = bestDuplicateOf(RISE, [{ ...RISE_LONG, status: 'skipped' }])
  assert.equal(hit?.row.id, RISE_LONG.id)
  assert.equal(bestDuplicateOf(RISE, [makeOpp({ id: 'z', programName: 'Something Else Entirely', sponsor: 'Nobody', officialUrl: 'https://nowhere.org/x', programCycle: '2030', deadline: {} })]), undefined)
})
