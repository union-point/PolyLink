# Profile page — approved product decisions

These decisions guide planning for the profile page. They record agreed behavior, not an implementation claim.

- All sections and actions already present in the profile interface must work, including basic profile editing, education, certificates, images, and announcements.
- The university-verified name cannot be changed. Other profile data can be edited.
- Education choices must come only from existing database reference lists. Do not allow free-text entries or provide a mechanism to request missing entries for now.
- Avatar and cover images remain accessible by direct link even when the profile is private.
- When edits conflict, the last save wins.

Clarifications approved on 6 November 2026:

- Offer university, degree, institute and specialization from the reference lists. Require university; the other three may remain unspecified.
- Education dates may be years or months and may be unknown. Preserve existing precision. Distinguish ongoing study from an unknown end date using a separate control.
- Require certificate name and issuing organization. Issue month and credential link remain optional.
- Accept JPEG/PNG profile images up to 5 MiB.

The [implementation plan](profile_implementation_plan.md) and [profile API](profile_implementation.md) document technical choices and delivered behavior.
