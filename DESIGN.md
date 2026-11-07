# PolyLink UI context

PolyLink uses Armenian UI copy, Vanilla HTML/CSS/JavaScript and the existing
blue-and-white application theme. Preserve existing page layouts and shared
components when extending behavior.

## Publication surfaces

Canonical references: `events.html`, `css/posts.css`, `js/posts/form.js`,
`js/posts/cards.js` and `js/shared/posts.js`. Profile publications and detail pages
reuse these components. CSS files own colors, spacing, typography and focus
styles; JavaScript must not introduce a parallel token system.

Publication type and sphere controls use styled native `<select>` elements.
Keep their platform keyboard and mobile picker behavior. Render reference labels
as text using the existing escaping helper; custom types use the same badge as
built-in types. No new type-specific layout or icon is required.

On reference refresh, preserve valid selections and composer text. Preserve a
removed composer selection as a disabled unavailable option until the user
chooses another value. Fetch choices again on window focus and after reference
validation errors. Ignore superseded responses. Keep save disabled while choices
are unavailable and expose a retry action through the shared status component.

Verify desktop and narrow layouts, visible focus, native picker keyboard use,
HTML-like labels, stale choices, loading/errors and shared profile/detail cards.
