# Shipping Portal --- Architecture

## 1. Architecture Style

Use a **modular monolith**.

V1 should be one deployable web application plus PostgreSQL. Do not
introduce microservices or queues until real usage proves they are
necessary.

Recommended stack:

-   Next.js
-   TypeScript with strict mode
-   PostgreSQL
-   Prisma
-   Tailwind CSS
-   shadcn/ui
-   Zod
-   Auth.js/session-based authentication
-   TanStack Table
-   React Hook Form
-   ExcelJS for `.xlsx`
-   server-side CSV generation
-   Playwright for critical end-to-end tests

Avoid unnecessary dependencies.

## 2. High-Level Flow

``` text
                   ┌──────────────┐
                   │   Shopify    │
                   └──────┬───────┘
                          │ webhook/API
                          ▼
┌─────────────────────────────────────────────────┐
│                Shipping Portal                  │
│                                                 │
│  Shopify Module → Order Service → Database      │
│                         │                       │
│                         ▼                       │
│                  Shipping Service               │
│                         │                       │
│                  Carrier Interface              │
│                         │                       │
│                     SGS Adapter                 │
└─────────────────────────┬───────────────────────┘
                          │
                          ▼
                   ┌──────────────┐
                   │ SGS/YunWMS   │
                   └──────────────┘
```

Royal Mail can later be another carrier adapter behind the same shipping
boundary.

## 3. Module Boundaries

Suggested structure:

``` text
src/
  app/
  components/
  lib/
  modules/
    auth/
    orders/
    shipments/
    shopify/
    carriers/
      types.ts
      sgs/
        client.ts
        config.ts
        schemas.ts
        types.ts
        errors.ts
        mapper.ts
        status.ts
        services/
    dashboard/
    exports/
    audit/
```

Business logic belongs in modules/services, not React components.

## 4. Order Boundary

The application owns a normalized `Order`.

Never pass raw Shopify objects through the rest of the application.

``` text
Shopify payload
      ↓
Shopify mapper
      ↓
Internal Order
```

Manual and replacement orders create the same internal model without
Shopify.

## 5. Carrier Boundary

The application should depend on carrier-neutral operations.

Conceptually:

``` ts
interface CarrierAdapter {
  getWarehouses(): Promise<Warehouse[]>;
  getShippingMethods(warehouseCode?: string): Promise<ShippingMethod[]>;
  createShipment(input: ShipmentInput): Promise<CarrierShipmentResult>;
  getShipment(carrierOrderId: string): Promise<CarrierShipment>;
  cancelShipment(carrierOrderId: string, reason?: string): Promise<CancelResult>;
  getLabels(carrierOrderIds: string[]): Promise<CarrierLabel[]>;
  getTracking(carrierOrderIds: string[]): Promise<TrackingResult[]>;
}
```

Exact implementation may evolve, but application/UI code must not know
SGS request field names.

All SGS communication goes through `src/modules/carriers/sgs`.

## 6. SGS Workflow

``` text
Order Service
   ↓
validate order
   ↓
Shipping Service
   ↓
acquire processing lock / transaction
   ↓
check existing Shipment
   ↓
if uncertain previous attempt:
    SGS getOrderByRefCode
   ↓
SGS createOrder
   ↓
persist carrier order code + tracking
   ↓
query/synchronize SGS
   ↓
retrieve labels
```

`docs/SGS_API.md` is the source of truth for SGS endpoint behavior.

## 7. Idempotency

Idempotency is mandatory at external boundaries.

### Shopify

Store the webhook/event identifier and reject already-processed events.

### SGS

Use a stable unique `reference_no`.

Before creating:

-   prevent concurrent processing for the same local order;
-   check local shipment state;
-   reconcile uncertain attempts with SGS by `reference_no`;
-   never blindly retry an uncertain `createOrder`.

### SGS Callbacks

Deduplicate by callback `msg_id`, verify its signature, then query SGS
for authoritative current state.

## 8. Status Model

Keep application status separate from carrier status.

``` text
Order.internalStatus
Shipment.internalStatus
Shipment.carrierStatus
```

The SGS adapter maps known SGS states to internal states but always
stores the raw carrier value.

Unknown SGS states must not crash processing. Preserve them and surface
them for investigation.

## 9. Label Handling

Labels are requested server-side.

SGS may return multiple labels for one order.

Prefer retrieving labels on demand instead of permanently storing
carrier label files unless production requirements prove storage is
needed.

Only authorized users can request labels.

## 10. Error Model

External failures should be normalized into application errors such as:

``` text
VALIDATION_ERROR
AUTH_ERROR
NETWORK_ERROR
TIMEOUT
CARRIER_REJECTED
CARRIER_UNKNOWN_RESULT
NOT_FOUND
CANCELLATION_PENDING
CANCELLATION_FAILED
```

Log enough metadata to diagnose failures, but never log credentials.

Unknown create results must enter reconciliation rather than automatic
retry.

## 11. Webhook Endpoints

Expected server endpoints include conceptually:

``` text
/api/webhooks/shopify/...
/api/webhooks/sgs
```

Webhook handlers should:

1.  authenticate/verify;
2.  deduplicate;
3.  validate payload;
4.  persist event receipt;
5.  invoke a service;
6.  return quickly.

Do not put large amounts of business logic directly inside route
handlers.

## 12. Data Access

Use Prisma as the normal database access layer.

Use transactions for workflows that must atomically update multiple
records.

Add unique constraints for external identifiers and idempotency keys
where appropriate.

Do not let UI components make arbitrary database queries.

## 13. Security

-   server-side environment variables for Shopify/SGS/database/auth
    secrets;
-   no carrier secrets in browser bundles;
-   authenticated portal;
-   role-based authorization;
-   Zod validation at boundaries;
-   verified Shopify webhooks;
-   verified SGS callbacks;
-   HTTPS in production;
-   safe error messages to users;
-   detailed server logs without secrets;
-   audit logs for sensitive operational actions.

## 14. Testing Strategy

### Unit

Test:

-   Shopify → internal mapping;
-   internal → SGS mapping;
-   SGS response validation;
-   SGS → internal status mapping;
-   replacement-order behavior.

### Integration

Test:

-   create/query/reconcile SGS shipment;
-   cancellation states;
-   label response;
-   tracking response;
-   webhook idempotency.

Use mocked SGS responses until test credentials are available.

### E2E

Critical path:

``` text
login
→ orders
→ open order
→ process
→ SGS shipment recorded
→ label available
```

Also test replacement creation and duplicate-click protection.

## 15. Deployment Shape

V1 production needs:

``` text
Next.js web process
Shopify webhook worker process
PostgreSQL
HTTPS domain
environment secrets
database backups
application/error logs
public webhook endpoints
```

The web and worker processes run from the same application artifact. The
webhook endpoint verifies and durably records Shopify events, then returns
quickly. A single separately supervised worker drains eligible events and
polls PostgreSQL every five seconds while idle. PostgreSQL remains the durable
queue; no external queue service is required.

The worker must finish its current event and disconnect from PostgreSQL on
graceful shutdown. Stale interrupted claims remain recoverable after a process
crash or restart.

Choose hosting later. Do not couple application architecture to a
specific host prematurely.
