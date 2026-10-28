# Settings product decisions

Approved by the user on 23 October 2026. These decisions take precedence over older proposals for the same behavior in `specification_gaps.md`. They record approved policy; see [settings backend](settings_backend.md) for implemented behavior, deployment and acceptance evidence.

Publication-policy update (29 October 2026): the newer [posts decisions](posts_decisions.md) supersede the historical new-announcement notification proposal below. This version notifies an announcement author about non-self comments; notifications for newly published announcements are deferred. The older decision text is retained as history.

## Email change

Authorization policy addition approved on 24 October 2026: the proposed new email must use the exact normalized `polytechnic.am` domain, including for existing admitted accounts. Preserve any verified registry claim and role; changing a lecturer’s address does not require a new registry match. See [authorization plan](authorization_plan.md).

- Require the current password and a verification code sent to the proposed new address.
- Keep the current address unchanged until verification completes.
- If email-based 2FA is enabled, additionally require a code sent to the current address. Without 2FA, no old-address code is required.
- After successful completion, send a change notification to the old address.
- Preserve other sessions.
- Allow one active email-change request per account. Starting a replacement request invalidates the previous request and its codes.
- Reuse the project's existing authentication-code expiry, attempt limits and resend limits.
- The verified new address becomes the address for login, recovery and subsequent email-factor codes. Preserve the existing 2FA enabled/disabled state.
- When 2FA is enabled and the old mailbox is unavailable, use a separate account-recovery process; do not bypass old-address verification with a password alone. The specific recovery procedure remains to be defined before offering this fallback.

## Email-based 2FA setting

- The switch controls the existing email-based login factor.
- Require only the current password to enable or disable it. No additional email code is required for either change.

## Profile privacy

- A closed profile remains discoverable in people search. Other members cannot open its profile page; the owner retains access.
- Existing posts, forum topics and replies remain visible under the normal content-access rules. Show the author's name and avatar without an actionable link to a closed profile.
- Closing a profile does not prohibit new direct conversations, including conversations started from publications. Existing conversations continue to work. Blocking controls restrictions on communication independently.
- The show-email preference permits disclosure only on a profile page accessible to the viewer. A closed profile hides the email from other members regardless of this preference; search results must not disclose it.
- Email disclosure is disabled by default.

## Notifications

- Implement both email and browser notifications in the initial notification scope. Browser notifications are delivered only while the site is open, including when its tab is in the background. Delivery after all site tabs are closed is outside scope; Web Push subscriptions are not required for this scope.
- The email master switch disables activity emails while preserving category preferences. Login/recovery codes and security notifications remain enabled independently.
- New-announcement notifications cover all new announcements without specialty matching. Do not notify authors of their own announcements.
- Forum-reply notifications go to the topic author, excluding their own replies.
- Suppress direct-message notifications for blocked contacts and muted chats. Group multiple messages into one email and recheck unread state before sending it.
- All four existing notification preferences default to enabled for new accounts and existing accounts without saved preferences. Browser permission must not be inferred from these stored defaults.
- The email master switch controls email only. Category preferences for announcements, forum replies and direct messages apply to both channels.
- Provide a separate "Notifications in this browser" control. Request browser notification permission only after the user enables it; enablement is separate for each browser/device and remains subject to browser permission.
- Message notifications show the sender's name and a generic "New message" label, without message plaintext.
- Suppress browser notifications for messages already read in the currently open chat. Group unread-message notifications by chat.

## Language, defaults and theme

- Store `hy`, `en` and `ru` as supported language preference codes. Translation work is separate from the settings backend; until translations ship, the effective interface remains Armenian and the UI explicitly explains that fallback.
- New accounts default to `hy`; preserve existing users' saved language preferences.
- New profiles default to public. Preserve existing profile visibility. Email disclosure defaults to disabled as approved above.
- Theme remains local to each browser and is not synchronized through the account.

## Full account export

- Include the caller's profile, settings, education, certificates, posts, comments, forum topics/replies, own sent messages and own files. Exclude passwords, tokens, encryption keys and other participants' message bodies.
- Export own encrypted messages as readable data by decrypting them in the browser through the existing client mechanism. Explicitly report history that cannot be decrypted rather than silently omitting it.
- Deliver a ZIP containing JSON data and separate image/document files.
- Require the current password before full export.

## Account lifecycle and UI promises

- Preserve the implemented deactivation policy: immediately suspend access, retain data, and require administrator intervention for reactivation.
- Replace the blanket "delete all data" promise with an accurate explanation of erased and retained data.
- Retain posts, comments, forum topics and replies with a non-identifying deleted-author representation so that other users' discussions survive. This is an approved target behavior and must be checked against existing lifecycle implementation before release.
- Delete the caller's message bodies and attachments under the existing lifecycle policy. Preserve required neutral references/tombstones as described in M6.

## Remaining scope boundaries

- The separate recovery procedure for an unavailable old mailbox while email-based 2FA is enabled is not yet specified. Do not offer a password-only bypass; this does not block the normal email-change flow.
- Production backup retention and restore/deletion-ledger rehearsal remain M7 work, as documented in M6. Do not invent a retention period or claim immediate erasure from backups.
- API contracts, archive resource limits, notification batching intervals and implementation details must be documented and verified during development. These are not additional approved product promises.
