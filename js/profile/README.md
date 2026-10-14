# Profile modules

`profile-main.js` initializes the owner page; `../user/user-main.js` initializes a
public profile selected by `user.html?id=...`. Both use async feature services.

- `profile-render.js`: shared education, certificates, announcements and comments.
- `profile-sections.js`: owner forms, durable CRUD and image uploads.
- `profile-editor.js`: intro editing, save/cancel and pending state.
- `profile-modal.js`: existing modal layout, formatting and asynchronous save handling.
- `profile-validation.js`: form checks; provider validation remains authoritative.
- `profile-keyboard.js`: shortcuts, focus and accessible icon activation.

Theme, confirmation, notification, dates and session behavior live in `../shared/ui.js`.
Rendering uses escaped text, sanitized rich HTML and safe URLs from `../shared/content.js`.
No profile module accesses Axios, IndexedDB or persisted user identity directly.
See ../../frontend_context.md and ../../docs/REFACTOR.md for contracts and manual QA.
