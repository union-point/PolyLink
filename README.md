# PolyLink

A university alumni/lecturer networking course project using static HTML/CSS and vanilla JavaScript ES modules. The frontend works with persistent mock data without an API server. A Microsoft SQL Server backend remains to be designed and implemented.

## Run the demo

```sh
python3 server.py --port 8001
```

Open [the profile](http://127.0.0.1:8001/profile.html) using the same host and port throughout. Default port is 8000; `--bind` defaults to `127.0.0.1`. Serve over HTTP; ES modules do not work reliably from `file://`. No npm install or build is required. CDN fonts/styles can still require internet: offline here means **no backend**.

A fresh/reset dataset signs in the seeded owner automatically. After logout, use `demo.alumni@polytechnic.am` or `demo.lecturer@polytechnic.am` with `DemoPass123!`. Public fixture accounts are `demo.user5@polytechnic.am` through `demo.user8@polytechnic.am`. Verification code: `123456`. These are fictional local demonstration credentials.

[Developer controls](http://127.0.0.1:8001/dev-tools.html) reset mock-owned records, end the session, inject latency/one-shot operation errors, enable demo 2FA and inject incoming messages. Data and uploaded images persist in IndexedDB; different origins/ports have separate datasets. Reset restores the demo graph without clearing unrelated browser storage or HTTP credentials.

## Data access

Controllers call `js/services/index.js`; `js/data/client.js` selects the provider from `js/config.js`. `mock` is the default. For a real backend, select `http`, set `apiBaseUrl`, and reconcile route/payload/DTO mappings in `js/data/http/`. Product controllers do not need transport changes for equivalent service contracts.

The HTTP adapter is scaffolding, verified with simulated responses; no live API compatibility is claimed. Missing chat/settings/second-factor/reply contracts fail explicitly. There is no silent fallback to mock data. Do not deploy demo credentials, fixed OTPs or mock password hashing as production authentication.

Implemented mock flows include registration/onboarding/login/recovery/2FA, owner/public profiles with media and education/certificates, announcements/comments, forum topics/replies/likes, filtered people search, direct/group chat and settings/export/account lifecycle. Language/notification preferences persist; translation/email delivery, official eligibility verification, real encryption and tutorial videos are not implemented.

## Documentation

- [Frontend architecture, flows and API contracts](docs/frontend_context.md)
- [Backend/domain/MS SQL Server design requirements](docs/backend_design_context.md)
- [Incremental refactoring phases and verification evidence](docs/REFACTOR.md)
- [Profile module guide](js/profile/README.md)

Database design assets were analyzed from the original checkout but `DB/` is Git-ignored and may be absent from a clone. The backend context distinguishes declared SQL from missing requirements. Desktop flows and failures were manually checked; true mobile visual acceptance remains unconfirmed because the available browser viewport override did not apply the requested width. No project build/test toolchain was added.
