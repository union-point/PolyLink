# Profile modules

`profile-main.js` initializes the owner page; `../user/user-main.js` initializes a
public profile selected by `user.html?id=...`. Both use async feature services.

- `profile-render.js`: shared education, certificates, announcements and comments.
- `profile-sections.js`: owner forms, CRUD and image uploads through the selected provider.
- `profile-editor.js`: headline/biography editing, immutable verified name, save/cancel and pending state.
- `profile-modal.js`: existing modal layout, formatting and asynchronous save handling.
- `contracts.js`, `images.js`: reference IDs, partial dates, validation and mock image normalization.
- `profile-validation.js`: legacy generic validation helpers; profile forms use domain contracts.
- `profile-keyboard.js`: shortcuts, focus and accessible icon activation.

Theme, confirmation, notification, dates and session behavior live in `../shared/ui.js`.
Rendering uses escaped text, sanitized rich HTML and safe URLs from `../shared/content.js`.
No profile module accesses Axios, IndexedDB or persisted user identity directly.
See the [profile API](../../docs/profile_implementation.md), [frontend architecture](../../docs/frontend_context.md) for HTTP limitations and
[live testing](../../LIVE_TESTING.md) for manual checks.
