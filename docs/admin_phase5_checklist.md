# Dynamic publication types: implementation checklist

Reference: existing `events.html`, shared post composer and `js/shared/posts.js`.
Scope: data compatibility and reference refresh; retain the existing CSS, layout,
Armenian copy, native select semantics and generic text badge.

- [x] Accept unique database option codes with the server's 16-character type limit.
- [x] Keep immutable built-in codes and allow custom codes in post DTOs.
- [x] Use current mock state references for options, validation and labels.
- [x] Preserve composer drafts and missing selections; refresh options on window focus
  and reference validation failure. Never silently select another value.
- [x] Refresh feed choices on window focus and preserve valid filters.
- [ ] Verify custom creation, filtering, detail and profile publication rendering,
  removed options, keyboard use, desktop and mobile in browser acceptance.
- [ ] Release server mutations only with system, usage and version protections intact.
