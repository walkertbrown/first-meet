# First Meet

An online powerlifting meet you train for at home or in a gym, judged by your
phone's camera. Try a lift at `/try`: one bodyweight squat, and your phone is
the referee.

- `web/`: the Next.js app. `web/lib/judge/` is the one judge, in TypeScript.
- `shared/rules.json`: every judging number.
- `content/`: the recipes, words and the sample lifts (sources in
  `content/samples/SOURCES.md`).
- `tests/`: unit tests, the judge tests on `tests/clips/`, and end-to-end tests.

## Run it

```sh
npm ci
npm run dev          # http://localhost:3000
npm test             # unit tests
npm run test:judge   # the judge in headless Chromium on tests/clips/
npm run test:e2e     # end-to-end (E2E_BASE_URL=<site> to test a running site)
```

Node 22. MIT licensed.
