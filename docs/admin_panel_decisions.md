# Admin panel decisions

These are agreed requirements for a future admin panel, not a description of implemented features. Implementation details and operational commands remain to be designed.

## Admin access

- Provide one admin role; there is no super-admin role.
- A local command generates an invitation link for a specified email address. Each invitation is valid for 24 hours and can be used once. The owner sends the link manually. The first version has no invitation cancellation feature.
- Provide a separate admin registration page. It collects first name, last name, password and password confirmation, and verifies control of the invited email address. Admin registration has no university-domain restriction and does not require an education or registry check.
- Two-factor authentication is mandatory for admins.
- A local command disables an admin's access.

These admin enrollment rules do not change ordinary member registration, which remains restricted to eligible Polytechnic users.

## Admin pages

Provide three pages:

1. **Academic reference data:** manage universities, institutes/faculties, departments, specializations, professions and degrees.
2. **Publication and forum reference data:** manage post types, post spheres and forum categories.
3. **Registry records:** manually search, add, edit and delete lecturer and alumni records, subject to the protections below.

Languages and roles are excluded from admin reference management. The first version has no separate admin action audit log.

## Data protections and eligibility

- Enforce unique lecturer email addresses and unique alumni diploma numbers.
- Registry records linked to registered users cannot be modified or deleted.
- Reference values in use cannot be changed or deleted. Protect system values additionally.
- The main Polytechnic university cannot be changed or deleted. Other universities are available only for additional education in user profiles and never grant registration eligibility; ordinary registration remains Polytechnic-only.
- The current frontend makes fixed assumptions about post types. Arbitrary additions or deletions require frontend adaptation and must not be assumed safe.

## Future registry import

Excel import is outside the first version. A later import may skip exact matches and prompt the operator to replace or skip a record when a lecturer email or alumni diploma number matches an existing record. The protection against modifying or deleting records linked to registered users must also apply to imports.
