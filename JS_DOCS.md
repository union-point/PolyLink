# JavaScript documentation

The previous global/API-wrapper documentation described a disconnected prototype and is superseded by [frontend_context.md](frontend_context.md).

Live integration points:

- `js/config.js`: provider selection and endpoint/CDN configuration.
- `js/services/index.js`: async feature operations consumed by controllers.
- `js/data/client.js`: provider loading and normalized errors.
- `js/data/mock/`: coherent fixtures, IndexedDB transactions and mock business rules.
- `js/data/http/`: Axios transport, route allowlists and response normalization.
- `js/shared/`: UI/session/theme/content/auth/code-input rendering helpers.
- `js/profile/`, `js/forum/`, `js/chat/`, `js/user/`: page/domain-specific modules.

Controllers do not access transports or persisted datasets directly. DTOs are documented in `js/data/models.js` and the frontend context. The removed `js/api/`, `js/core/` and duplicate utility files exist only in Git history. See [docs/REFACTOR.md](docs/REFACTOR.md) for manual acceptance evidence and limitations.
