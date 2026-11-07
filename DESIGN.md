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


## Admin management surfaces

The three admin pages share `js/admin/management.js`, `js/admin/shell.js` and
`css/admin.css`; identity remains separate from member navigation and bootstrap.
Reuse the app palette from `css/style.css` and its light/dark variants. Shared admin
CSS owns named spacing, widths, radii and control heights; no page-specific styles.

Use styled native selects/date inputs, semantic tables in keyboard-scrollable
regions and native modal forms. On narrow screens, fields scroll inside the dialog
while its actions stay visible. `js/shared/ui.js` owns confirmation, pending and
status behavior; confirmations opened from a native dialog live in its top layer.

Show lock reasons as text, disable prohibited actions, preserve failed-save drafts
and require explicit discard on reload. Save/delete announce success and return
focus to a surviving control. Periodic session checks preserve typing focus;
resume/offline checks suspend sensitive dialogs and restore drafts only after the
same identity is confirmed. Logout/expiry/account changes purge transient content.

Search text is intentionally transient because registry identifiers are private.
The selected resource is URL state. No member data or demo admin credentials belong
in the shell. Armenian copy follows existing short action labels and feedback.
