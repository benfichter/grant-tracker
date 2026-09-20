import type { CategoryId } from './types.ts'

export interface Category {
  id: CategoryId
  letter: string
  label: string
  /** What the discovery prompt asks each engine to find. */
  focus: string
  queryHints: string[]
}

export const CATEGORIES: Category[] = [
  {
    id: 'research_program',
    letter: 'a',
    label: 'Funded international research programs',
    focus:
      'Funded international research programs in mathematics, computer science, quantum information/computing, or cryptography that accept current U.S. undergraduates (REUs abroad, DAAD RISE-style placements, summer research at foreign institutes, etc.).',
    queryHints: [
      'funded summer research abroad undergraduate mathematics 2027',
      'quantum computing research internship undergraduate international 2027 stipend',
      'cryptography research program undergraduate Europe Asia funded',
    ],
  },
  {
    id: 'conference_travel',
    letter: 'b',
    label: 'Conference and workshop travel grants',
    focus:
      'Travel grants, registration waivers and stipends that let an undergraduate attend or present at math, theoretical CS, quantum, or security conferences and workshops (including NSF-funded travel support).',
    queryHints: [
      'undergraduate travel grant quantum information conference 2027',
      'number theory conference undergraduate travel support 2027',
      'theoretical computer science workshop student travel award 2027',
    ],
  },
  {
    id: 'public_interest_cohort',
    letter: 'c',
    label: 'Public-interest tech, cyber, AI and national-security cohorts',
    focus:
      'Selective cohorts, fellowships and scholarship-for-service programs in public-interest technology, cybersecurity, AI policy/safety and national security that accept current undergraduates (not recent-graduate-only or professional-only programs).',
    queryHints: [
      'undergraduate cybersecurity fellowship 2027 current undergraduates',
      'undergraduate AI policy fellowship 2027 stipend',
      'public interest technology undergraduate summer fellowship 2027',
      'national security scholarship undergraduate mathematics U.S. citizen 2027',
    ],
  },
  {
    id: 'study_abroad',
    letter: 'd',
    label: 'Non-Pell study-abroad scholarships',
    focus:
      'Study-abroad scholarships an undergraduate can win WITHOUT being Pell-eligible (merit, field-specific, language, national-security-linked, UMD-specific). Exclude Gilman and any Pell-restricted award.',
    queryHints: [
      'study abroad scholarship merit-based no Pell requirement 2027',
      'UMD education abroad scholarships 2027',
      'Boren Awards undergraduate 2027 deadline',
    ],
  },
  {
    id: 'summer_school',
    letter: 'e',
    label: 'Summer schools and workshops with stipends or fee waivers',
    focus:
      'Summer schools, bootcamps and workshops in math, quantum, cryptography or AI that provide a stipend, fee waiver, or funded travel to undergraduates.',
    queryHints: [
      'quantum summer school undergraduate fee waiver 2027',
      'mathematics summer school undergraduate funded 2027',
      'cryptography summer school student stipend 2027',
    ],
  },
  {
    id: 'competition',
    letter: 'f',
    label: 'International competitions, delegations and hackathons',
    focus:
      'International competitions, delegations and hackathons with travel support (math contests, CTFs, quantum hackathons, ICPC-style events) that admit undergraduates.',
    queryHints: [
      'international hackathon travel support undergraduate 2027',
      'CTF finals travel sponsored students 2027',
      'quantum hackathon travel funding 2027',
    ],
  },
]

export function categoryById(id: string): Category | undefined {
  return CATEGORIES.find((c) => c.id === id)
}
