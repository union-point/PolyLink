# Posts and announcements — approved product decisions

Approved through the product discussion concluded on 29 October 2026. This document records the agreed first-version behavior; it does not claim that the functionality has been implemented.

## Purpose and structure

- Keep the existing announcement structure: title, free-form body, announcement type, and professional direction (sphere).
- Keep three announcement types: job, internship, and training/course.
- Add an explicit direction selector to the publication form. The direction must not be taken implicitly from the feed filter.
- Load directions from the database and include an “Other” option. Operators manage the direction list; users select an existing option rather than creating directions.

## Access and ownership

- All signed-in, admitted users can read announcements and comments.
- Both graduates and lecturers can publish announcements and add comments.
- Authors can edit and delete their own announcements and comments.
- Profile privacy does not hide an author's published announcements from the shared feed.
- An announcement author cannot delete other users' comments merely because they own the announcement.

## Content and validation

- New announcements require a title, body, type, and direction. “Other” is a valid direction selection.
- The title limit is 255 characters; the body limit is 20,000 characters.
- Support paragraphs, bold, italic, and safe links in announcement bodies. Apply safe formatting and sanitization rules on the server as well as in rendering.
- Comments contain plain text, with a limit of 2,000 characters.
- Photos and file attachments are outside the first-version scope.

## Editing and deletion

- Authors can edit all announcement fields at any time.
- Show an “edited” indication after an announcement is changed.
- Editing does not move an announcement to the top of the feed.
- Concurrent edits use last-successful-save-wins behavior. Do not introduce optimistic conflict warnings or reject a save merely because another edit was saved first.
- Deleting an announcement also deletes its comments. Ask for confirmation before deletion.
- Do not add closing, reopening, expiration, or an open/closed status filter. An announcement remains in the feed until its author deletes it.

## Feed, filters, and comments

- Order announcements from newest to oldest by publication time.
- Load announcements in batches of 20 using a “Show more” button.
- Apply type and direction filters together.
- Load comments on demand in batches of 20, with newest-first and oldest-first choices. The UI starts newest-first; the API retains oldest-first when no sort is specified.

## Individual announcement page

- Keep individual announcement pages for direct links and notifications; feed cards show a static post-type badge instead of an open-announcement link.
- Notification navigation opens the relevant announcement.
- Show an unavailable state for a deleted announcement.

## Notifications

- Notify an announcement's author when another user adds a comment to that announcement.
- Do not notify the author about their own comments.
- Provide notifications inside the application.
- Send email only when allowed by the recipient's notification settings.
- Do not send notifications about newly published announcements in the first version. Direction-based recipient rules for such notifications are deferred.

## Existing announcements

- Preserve existing records that have missing titles, types, or directions.
- If an existing announcement has no title, omit the title entirely. Do not show a “No title” placeholder.
- Missing type or direction may be displayed as “Not specified,” as accepted in the legacy-record proposal; the later correction specifically removes the missing-title placeholder.
- When an existing announcement is edited, require all currently mandatory fields to be completed.
- Apply the same safe formatting rules to existing announcement bodies.

## Unsaved input and errors

- When closing a form with unsaved changes, ask whether to discard the changes.
- Keep all entered text in the form when submission fails.

## Scope boundary

The agreed first version includes real server operations, ownership checks, database integration, the shared feed, publication and editing forms, comments, individual announcement pages, and comment notifications. Implementation planning should cover these capabilities and their validation without reopening the approved product decisions above.

Closing/expiration, attachments, new-announcement notifications, and edit-conflict warnings are excluded from this version. No implementation changes or deployment were requested as part of recording these decisions.
