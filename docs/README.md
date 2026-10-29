# Documentation index

Start with the [project quickstart](../README.md). This index separates current behavior, approved policy and historical implementation evidence.

## Current implementation and operations

| Document | Use |
| --- | --- |
| [Backend setup](../backend/README.md) | Configuration, feature flags, migration and test commands. |
| [Local tooling](../tools/local/README.md) | Generated private configuration, TLS and test runners. |
| [OpenBao runbook](../infra/openbao/README.md) | Operator custody, unseal and Transit operations. |
| [Live testing](../LIVE_TESTING.md) | Manual account, messaging and recovery checks. |
| [Backend architecture](backend_design_context.md) | Implemented capabilities and schema evolution. |
| [Frontend architecture](frontend_context.md) | Page ownership, provider boundaries and HTTP limitations. |
| [Profile modules](../js/profile/README.md) | Profile controller responsibilities. |
| [Registry enrollment](registry_enrollment.md) | Admission, academic verification, avatars and maintenance. |
| [Settings API](settings_backend.md) | Preferences, notification delivery and full export. |
| [People search](search_implementation.md) | Search API, education matching, privacy, pagination and verification. |
| [Forum API and operations](forum_implementation.md) | Discussion contracts, historical backfill and takedowns. |
| [Schema workflow](messenger/schema-and-migrations.md) | Guarded explicit migrations and transaction rules. |
| [Remaining decisions](specification_gaps.md) | Unimplemented feature contracts and release gates. |

## Product and protocol authority

- [Authorization decisions](authorization_plan.md), [settings decisions](settings_decisions.md) and [forum decisions](forum_decisions.md) preserve approved policy.
- [Posts decisions](posts_decisions.md) define the approved announcement/comment behavior; the [posts implementation plan](posts_implementation_plan.md) covers the pending server, UI, migration and notification work.
- [Messenger specification](messenger_spec.md) defines the agreed security and messaging behavior.
- [PLK1 format](messenger/crypto-format.md), [OpenAPI](messenger/contracts/openapi.yaml) and [payload schemas](messenger/contracts/client-payloads.schema.json) define versioned formats. Later controllers and implementation handoffs cover additions to the original API snapshot.

## Historical implementation evidence

The [messenger plan](messenger_implementation_plan.md) and milestone records [M0](messenger/README.md), [M1](messenger/m1.md), [M2](messenger/m2.md), [M3](messenger/m3.md), [M4](messenger/m4.md), [M5](messenger/m5.md) and [M6](messenger/m6.md) retain dated acceptance evidence. Their original scope, feature defaults and invitation instructions are historical; use current setup and enrollment docs for execution. M7 platform/release and joint restore checks remain outstanding.

The obsolete backend foundation plan, frontend refactoring diary and JavaScript documentation redirect were removed after consolidating their useful guidance into current architecture and testing docs. Their history remains in Git. Machine-specific database notes under `db/` are local reference material, not shared provisioning instructions.
