# Audit, fix and improve pass: release report

**Dates:** 27–28 November 2026 · **Frontend main at close:** `ecf98bfa` · **Backend main at close:** `d97d0abc`

## Verdict

**Ready for clients, with the founder acceptance walk as the last step.** No P1 or P2 finding is open. Every P1 was fixed, tested and re-checked: two on the live site, the iOS one on a real iPhone. What is left is either polish (P3), a product decision listed in §E, or a check only the founder can do (§F).

## A. What was checked

| Phase | What ran | Size |
|---|---|---|
| A. Inventory | route × state × control sheet from the sweep route lists, the click specs and the file tree, plus admin, emails, outputs, destinations and languages | 360 rows |
| B. Automated sweeps | control sweep and journeys (390/768/1440, 41 routes), control click, axe and focus, tap targets, Lighthouse on 6 public pages (mobile and desktop), a link crawl of the site and help centre, and a page-load audit of 76 routes × 6 widths × 5 languages | 2,280 page loads; 66 internal links, 0 broken |
| C. Live click-through | every control in the inventory on proculink.eu, in a test workspace, with synthetic files only; test sends only | desktop and phone width, all 5 languages |
| D. Real devices | BrowserStack Automate: iPhone SE (iOS 15.4), a recent iPhone, a Pixel and an iPad | about 12 Automate minutes on the old-Safari pass |
| E. Triage | P1 = broken or untrue, P2 = confusing or ugly on a main path, P3 = polish; grouped into file-disjoint waves | 87 findings |
| F. Fix waves | one agent per wave; each fixed its items with 1–3 tests, ran the full local gate, opened a PR, passed CI, merged, and its items were re-checked on the live site | 19 frontend PRs, 5 backend PRs |

## B. Findings and outcome

| Source | Found | Fixed | Closed, no change needed | Deferred (P3 or decision) |
|---|---:|---:|---:|---:|
| Live click-through (L01–L26) | 26 | 23 | 1 | 2 |
| Automated sweeps (F-01–F-18) | 18 | 16 | 1 | 1 |
| Visual review (V-01–V-16) | 16 | 16 | 0 | 0 |
| Real devices (D-01–D-10) | 10 | 9 | 1 | 0 |
| Found during live re-checks (N-01–N-17) | 17 | 11 | 5 | 1 |
| **Total** | **87** | **75** | **8** | **4** |

### The three P1s

1. **One file that couldn't be made blocked every file (L02).** A flow with a standard output that needs values the flow never reads refused to make *any* file, including its plain CSV, and said so twice. Now the other files are made and sent, the document names the missing file once with what it needs, and a held document says why. Backend #373, frontend #459. Live re-checked.
2. **A destination test hid the last real send and claimed a file "arrived" (L04).** A test overwrote "Couldn't send at 19:20" with "Test arrived", including for tests that send nothing. Now the last real send and the last test are on separate lines, and each test is worded by what it proves ("Connection check passed", "Test accepted by the mail server"). Backend #374, frontend #461. Live re-checked.
3. **The site and app were dead on iOS below 16.4 (D-01).** A JavaScript syntax the browser didn't know (class static blocks, from a translation library) stopped every script. Fixed by transpiling that package, with a CI guard that fails the build if the syntax comes back. Frontend #460. Verified on a real iPhone SE with iOS 15.4: home, pricing, help and sign-in work. The PDF preview still needs iOS 16.4 and shows its fallback there.

## C. Pull requests

Frontend (`project-proculink`): #457, #458, #459, #460, #461, #462, #463, #464, #465, #466, #467, #468, #469, #470, #471, #472, #473, #474, #475.
Backend (`ProcuLink`): #372, #373, #374, #375, #376.

The user-facing summary is changelog entry v2.20 (28 November 2026).

## D. Live verification

Every merged wave was re-checked on proculink.eu after its deploy, in a test workspace, with the item list from its PR. Results and screenshots are kept with the audit notes. Not checkable live, and covered instead by tests or by the founder walk:
- the flow-limit state on Flows (no waiting document to trigger it; unit-tested);
- a manual Copy click (an automated click in an unfocused tab shows no change; the code shows "Copied" or a copy-by-hand message);
- the admin workspace-name column (needs an admin account);
- the document header at 1024 px (CI visual baselines cover 390, 768 and 1440);
- the phone bar's translated Documents count (#475; unit-tested).

## E. Deferred, with the reason

| Item | P | Why it is not done here |
|---|---|---|
| Accented value names (Polish "Sposób płatności" read as "Sposob platnosci") | P3 | Keys are ASCII by design; showing accents needs a display name per value. Product decision. |
| On-screen total "1 303.40" vs file "1303,40" | P3 | The screen shows the value as read and the file follows the output settings. Both are correct; a locale display format is a product decision. |
| History: a one-line summary per flow version | P3 | Needs a stored diff per version. New work. |
| Sender and receiver country for standards that need them | P2 for those standards only | No read value carries them, so a field meaning can't fix it. Since #373 the other files are still made and the document says what is missing. Options: derive from VAT number prefixes, or ask in review. Product decision. |
| Header placeholder during a language change | P3 | A language change reloads the page, so keeping the last name needs storage. The placeholder is now in the chosen language. |
| Mobile first paint on public pages | P3 | Home went from 4.45 s to 3.65 s (local Lighthouse, simulated slow 4G) by loading the demo poster late. The rest is the sign-in library on every public page (about 195 kB) plus fonts and core scripts; moving sign-in off public pages is an auth refactor, not polish. Desktop scores 98–99. |
| A photo's third line read with an empty quantity | P3 | Reading quality on one synthetic photo. Noted for the reader work; not a screen defect. |
| App page bodies in German, French, Polish and Estonian | — | By plan: i18n phase 2. Until then the bodies are marked as English so screen readers read them correctly. |
| Native-speaker review of the four languages | — | Machine-assisted translations, reviewed on screen; a native read is advised before selling in those countries. |

## F. Founder acceptance walk (Phase G)

A 15-step script (sign up, upload, check, send, see it sent, change a destination, upgrade page, switch language, help, sign out), done once on a phone and once on a laptop, plus the admin name check and the 1024 px check from §D.

## G. Test health

- `tests/e2e/one-way-in.spec.ts:68` timed out in nearly every full local gate this pass, under parallel load, and passed alone and in CI each time. It needs a longer wait or a serial run before it hides a real failure.
- Every other local e2e red this pass was a timeout that passed on a solo re-run; CI was green on every merged head.

## H. Guards that keep this true

- `gatedCapabilityClaims`, `publicCopyDrift`, `legalCommitments` and `helpCopyMatchesShipped` all pass on the closing main: the site, pricing, legal pages and help say only what the product does.
- New this pass: a client-syntax guard (old Safari), a message-key parity test across the five languages, and tests for each fixed item.
