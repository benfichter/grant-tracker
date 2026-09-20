# Application tracker

A local React app that runs the opportunity-hunting loop. You run the searches in Perplexity, ChatGPT and Claude by hand;
the app tells you what to search, takes the answers back, validates them, tracks the results and helps with drafts.
No API keys, no paid services, nothing is submitted for you.

```
npm install
npm run dev        # API on :5174, app on http://localhost:5173
npm test           # unit + API integration tests
npm run typecheck
```

The first start seeds `data/` from `tracker.csv` and `profile/profile.md`. After that `data/*.json` is the source of truth
(plain JSON, git-friendly). The seed never overwrites existing rows.

## The weekly routine

1. **Search tab**: pick one category, press **New run**. The app builds a prompt for each engine from your profile, the
   category, and the programs you already track.
2. Copy each prompt into its engine (Perplexity Labs, ChatGPT Deep Research, Claude with web search) and paste each answer
   back. The prompt asks for a JSON array; markdown tables and CSV also parse.
3. **Review**. The app merges the three answers, shows where the engines disagree (with who said what), applies your
   eligibility rules, and sorts each lead: new, possible duplicate, already tracked, or auto-excluded. Add, attach to an
   existing row, or skip. Nothing changes until you press a button.
4. **Verify tab**: for each new row press **Check page** (the server fetches the official page and reports the name and any
   dates it finds), then confirm by hand. That confirmation is the only way a row becomes `official`.
5. **Dashboard**: deadlines by urgency, plus the `.ics` calendar (28/21/14/7/3/1-day reminders) for official rows.
6. **Drafts tab**: track materials per application, copy a draft prompt, paste the draft back, and get it audited.

## Rules the app enforces

- A deadline is never guessed. If two engines disagree and neither has a majority, the date is left empty and the row goes to the
  verify queue.
- A page check only reports. `POST /api/opportunities/:id/confirm` is the only route to `official`, and editing an official
  row's deadline or URL sends it back to `unverified`.
- Calendar reminders are only created for `official` rows without an undismissed eligibility blocker.
- Eligibility rules (`src/lib/eligibility.ts`) flag: Pell/Gilman, degree-holder-only ("recent graduates", "current
  undergraduates not accepted"), graduate-only, class-year limits, need-based/FAFSA, fee-based programs, commercial tour
  operators, aggregator-only sources. They are keyword heuristics and advisory: dismiss a flag if it is wrong.
- The draft audit checks word/character limits, placeholders, unanswered parts of the prompt (keyword heuristic), claims that are
  not in your profile (Pell, first-generation, hardship, graduate standing), and figures that do not trace back to your profile.
  It is a second pair of eyes, not a substitute for reading the draft.

## Layout

```
data/                 profile.json, opportunities.json, runs/, drafts/
server/               Express API (loopback only), page checker, seed
src/lib/              pure TypeScript shared by server and UI (parse, dedupe, merge, eligibility, deadlines, ICS, audit, prompts)
src/routes/           Dashboard, Search, Tracker, Verify, Drafts
tracker.csv           seed input (kept)
profile/profile.md    seed input (kept)
```

`src/lib` and `server` run under Node's native type stripping, so shared files use type-only TypeScript (no enums, namespaces
or parameter properties) and explicit `.ts` import extensions.
