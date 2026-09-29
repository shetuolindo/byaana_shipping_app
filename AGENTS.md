# AGENTS.md

## Project

Private Shopify → Shipping Portal → SGS/YunWMS application.

V1 integrates SGS only. Royal Mail is not part of current
implementation.

## Required Reading

Before changing code, read the relevant project documentation:

1.  `docs/REQUIREMENTS.md`
2.  `docs/ARCHITECTURE.md`
3.  `docs/DATABASE.md`
4.  `docs/SGS_API.md`

Treat those files as the source of truth.

If documentation and code conflict, report the conflict before making a
broad architectural change.

## Working Style

For every task:

1.  inspect only the files relevant to the task;
2.  briefly state the implementation plan;
3.  make the smallest changes needed;
4.  do not refactor unrelated code;
5.  run the relevant tests/typecheck/lint;
6.  report what changed and any unresolved issue.

Do not redesign the application unless explicitly asked.

## Tech Rules

-   TypeScript strict mode.
-   Prefer server-side code for secrets and integrations.
-   Validate external data with Zod or the project's established
    validation layer.
-   Keep business logic out of React components.
-   Avoid `any` unless there is a documented unavoidable reason.
-   Avoid new dependencies unless the task clearly needs one.
-   Do not add microservices, Redis, queues, GraphQL or infrastructure
    without an explicit task requiring them.

## SGS Rules

-   Never call SGS from browser/client-side code.
-   All SGS API traffic goes through `src/modules/carriers/sgs`.
-   Follow `docs/SGS_API.md`.
-   Do not invent SGS endpoints, fields, status codes or behavior.
-   Never log `SGS_APP_TOKEN`, `SGS_APP_KEY` or other secrets.
-   Validate SGS responses.
-   Keep raw SGS status separate from internal status.
-   Do not hard-code warehouse or shipping-method codes.
-   Do not assume one label per order.
-   Do not assume `cancelOrder` means immediate cancellation.
-   Use a stable `reference_no`.
-   Never blindly retry `createOrder` after a timeout or unknown result.
-   Reconcile uncertain creation using `getOrderByRefCode` before
    another create attempt.
-   SGS callbacks must be authenticated/verified and deduplicated by
    `msg_id`.
-   A callback is a notification; query SGS afterward for authoritative
    state.

## Shopify Rules

-   Verify Shopify webhooks.
-   Webhook handling must be idempotent.
-   Do not spread raw Shopify payload shapes throughout the application.
-   Map Shopify data into the internal Order model first.
-   Shopify and SGS integration code must remain separate.

## Domain Rules

-   `Order` and `Shipment` are separate concepts.
-   Manual, Shopify and replacement orders use the same normalized order
    model.
-   A replacement is a new order linked to its original order.
-   Carrier identifiers are not database primary keys.
-   Preserve audit/history information.
-   Do not hard-delete operational records through normal workflows.

## Database Rules

-   Do not modify the Prisma schema unless the current task requires it.
-   When schema changes are required, keep them narrowly scoped and
    explain the migration.
-   Add unique constraints/indexes needed for external IDs and
    idempotency.
-   Use transactions/locking for workflows where duplicate carrier
    creation is possible.
-   Never store credentials in audit logs or normal application records.

## UI Rules

-   UI components do not construct SGS payloads.
-   UI components do not call SGS directly.
-   UI should show useful operational states and errors without exposing
    secrets/raw stack traces.
-   Destructive or carrier-changing actions require clear confirmation.
-   Disable/restrict actions that are not valid for the current
    order/shipment state.

## Testing Rules

Add or update tests for behavior changed by the task.

Prioritize tests for:

-   external payload mapping;
-   SGS response validation;
-   status normalization;
-   idempotency;
-   reconciliation after uncertain SGS creation;
-   cancellation states;
-   multiple labels;
-   webhook deduplication.

Do not make live SGS calls in automated tests unless explicitly
instructed and test credentials/environment are provided.

## Scope Discipline

When given a task such as "implement SGS authentication/client
foundation":

-   implement only that task;
-   do not also implement orders, labels, tracking or UI;
-   leave clear extension points for later tasks;
-   do not consume context investigating unrelated modules.

If information required for correct implementation is missing from the
docs, stop and identify exactly what is missing instead of guessing.
