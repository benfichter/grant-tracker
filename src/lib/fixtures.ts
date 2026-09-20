import type { Opportunity, Profile } from './types.ts'

export const TEST_PROFILE: Profile = {
  summary:
    "I'm a U.S. citizen, UMD mathematics major graduating May 2028. 3.9 GPA, University Honors, National Merit Scholar. Led a 45-person STEM nonprofit serving 1,600+ students.",
  facts: {
    citizenship: 'US',
    pellEligible: false,
    standing: 'undergraduate',
    graduation: '2028-05',
    gradCourseworkFrom: '2027',
    classNote: 'You are a junior in AY2026-27 and a senior in AY2027-28.',
  },
  goals: [],
  snippets: [],
}

export function makeOpp(over: Partial<Opportunity> = {}): Opportunity {
  return {
    id: 'test-opp',
    programName: 'Test Program',
    sponsor: 'Test Sponsor',
    officialUrl: 'https://example.org/test',
    programCycle: '2027',
    category: 'research_program',
    location: '',
    deadline: { date: '2027-01-15' },
    funding: { type: '', details: '' },
    eligibilitySummary: '',
    materials: [],
    materialsText: '',
    travelComponent: '',
    notes: '',
    sourceVerified: 'official',
    status: 'researching',
    duplicateKey: '',
    claims: {},
    flags: [],
    ...over,
  }
}

export const NOBLEREACH = makeOpp({
  id: 'noblereach-2027-02',
  programName: 'NobleReach Scholars',
  sponsor: 'NobleReach',
  officialUrl: 'https://noblereach.smapply.us/prog/february_2027_noblereach_scholars/',
  programCycle: 'February 2027',
  deadline: { date: '2026-10-14', time: '23:59', timezone: 'America/New_York' },
})
