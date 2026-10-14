# Frontend refactoring record

The frontend remains a static multi-page vanilla-JavaScript site. The default target
is a persistent mock demo with no API server. CDN dependencies still require internet.

## Working conventions

- Each independently reviewable change is checked and committed before starting the next.
- Preserve existing layouts, Armenian copy, keyboard interaction and intended navigation.
- Page controllers will use `js/services/index.js`; transport and mock storage stay behind it.
- `js/config.js` selects `mock` or `http`. Missing backend contracts must fail explicitly.
- Use manual browser verification, without introducing a Node build/test toolchain.

## Baseline

`baseline/profile-desktop.png` and `baseline/events-desktop.png` capture the original
desktop pages before migration. The original profile contains duplicate certificate
sections and repeated biography text; these are known defects, not extra domain records.

| Pages | Controls to preserve and make testable |
| --- | --- |
| Login, registration, onboarding | Visibility toggles, validation, role selection, years, biography and image preview; register/onboard/login navigation |
| Recovery and 2FA | Six digits, paste/backspace, resend timer, verification, password strength/matching |
| Owner/public profiles | Intro editing, save/cancel, education/certificates CRUD, credential link, photos, announcements/comments, contact action |
| Announcements | Editor formatting, creation/cancel, category/sphere filters, comments |
| Forum/list/topic/create | Classification, durable topic selection, replies, helpful likes, sorting and publication |
| Search | Text, specialization/institute/year filters, profile and contact actions |
| Messaging | Contact selection/search, separate histories, text/images, emoji/copy, menu actions |
| Settings | Theme, language preference, account/security/privacy/notification settings, export, deactivate/delete |
| Help, tutorials, policies | FAQ, category filters, navigation; honest feedback for missing tutorial videos |

## Acceptance checklist for each migrated feature

1. Open with only a local static server. Compare desktop/mobile layout and light/dark theme.
2. Exercise every control, cancel, keyboard action and navigation destination.
3. Create/edit/delete, navigate away and reload; verify durable IDs and coherent records.
4. Inject latency and a one-time operation failure; verify pending state, preserved input,
   retry and no false success. Invalid input must remain on the form.
5. Check console errors and browser requests. Mock mode must make no API requests.
6. Check cross-feature references and reset. Reset must affect only mock-owned data.
7. Inspect the Git diff, record evidence here, and make one focused commit.

## Progress

- Baseline/context documentation captured.
- Baseline initialization fixes verified: forum filters leave one matching card; registration
  initializes without errors; duplicate classic/module auth script tags removed.
- Provider infrastructure and a developer-only `dev-tools.html` are introduced.
  Browser-verified: seeded session initializes, sign-out survives reload, reset restores
  the session, and the developer page emits no console errors. Existing product pages
  are not yet migrated.
- Service/mock/HTTP contracts are scaffolding until browser verification and feature wiring.
- Announcements migrated and browser-verified: both filters, empty state, invalid-save
  feedback, unique IDs (`post-101` after reload), persistent plain-text comments,
  a delayed failed save that retains the modal/draft, and a successful retry.
  Desktop editor/cancel checked against baseline; no console errors. The available
  browser viewport override did not change its measured width, so mobile visual QA
  remains pending rather than being reported as passed.
- Login/registration/onboarding migrated. Browser-verified: bad credentials stay on
  login, seeded login navigates to profile, mismatched registration passwords fail,
  new registration navigates to onboarding, lecturer controls hide study years,
  reversed years fail, and a valid graduate onboarding persists a new demo session.
  The owner profile still renders legacy fixtures until its migration.
- Recovery/2FA migrated. Browser-verified: wrong codes stay on verification, six-digit
  clipboard paste works, mismatched reset passwords fail, reset returns to login,
  old credentials fail and new demo credentials succeed. 2FA preference creates a
  separate login challenge; incorrect codes fail, its resend timer survives reload,
  correct verification succeeds, and revisiting the consumed flow cannot sign in.
- Pending migrations: profiles, forum/search, messaging,
  settings, shared behavior and removal of obsolete API/global fixtures.

## Run

From the repository root: `python3 server.py`, then open `http://localhost:8000/login.html`.
To avoid an occupied port: `python3 -m http.server 8001 --bind 127.0.0.1`.
ES modules must be served over HTTP rather than opened as `file://` URLs.
