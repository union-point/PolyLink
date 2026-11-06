# Profile page implementation plan

Product authority: [profile decisions](profile_decisions.md). The implementation covers existing profile actions, with an immutable verified name and last-successful-save-wins updates.

1. Add education date precision and ongoing state, preserve legacy dates, and store managed covers alongside existing avatars. Update explicit schema validation and enrollment writes.
2. Provide admitted-owner profile, education and certificate operations. Read real records on authorized profile pages; preserve privacy and email rules. Education uses existing university/degree/institute/specialization IDs only; university is required. Dates may be years or months, or unknown, with ongoing separate from unknown. Certificates require name and organization, with optional issue month and HTTP(S) credential link.
3. Accept JPEG/PNG images up to 5 MiB with bounded decoding and normalized JPEG storage. Replace managed URLs atomically. Direct image access remains public for private profiles; deactivated/deleted accounts are unavailable. Include managed images in authorized exports and deletion replay.
4. Integrate HTTP and mock providers, immutable-name inline editing, searchable reference selectors, precision controls, certificates and shared rendering. Preserve forms on errors, prevent duplicate saves, confirm discard/deletion and maintain keyboard access. Reuse implemented announcements and messaging navigation.
5. Verify migrations, APIs, ownership/privacy, dates, concurrent saves, media boundaries, export/lifecycle, contracts and browser flows. Deliver small conventional local commits without pushing.

Technical defaults: headline 150 characters, biography 2,000; certificate name/organization 255, credential URL 2,048. Supported years are 1900–2200. Avatar output is 256×256; cover output fits 1,920×1,080. Input dimensions are at most 4,096 per side and 16 million pixels. Preserve Armenian UI and existing layout; work experience remains outside this change.
