# Shipping Portal --- Database Design

## 1. Principles

-   PostgreSQL is the source of truth for portal state.
-   Shopify and SGS identifiers are external identifiers, not primary
    keys.
-   Orders and shipments are separate.
-   Preserve raw carrier status alongside normalized status.
-   Support manual and replacement orders using the same core tables.
-   Add unique constraints that protect idempotency.

This is the logical design. Exact Prisma field types/names may change
during implementation.

## 2. Enums

``` text
UserRole
- ADMIN
- STAFF

OrderSource
- SHOPIFY
- MANUAL
- REPLACEMENT

OrderStatus
- NEW
- ON_HOLD
- READY
- PROCESSING
- SHIPPED
- CANCELLED
- ERROR

Carrier
- SGS

ShipmentStatus
- PENDING
- PROCESSING
- SHIPPED
- CANCELLED
- ERROR
```

Do not encode every SGS state into an application enum. Store the raw
SGS status separately.

## 3. User

``` text
User
- id
- name
- email                 UNIQUE
- role
- createdAt
- updatedAt
```

Authentication-specific fields depend on the selected Auth.js strategy.

## 4. Shop

``` text
Shop
- id
- name
- shopifyShopDomain     UNIQUE
- isActive
- createdAt
- updatedAt
```

Do not store Shopify secrets in ordinary database fields unless there is
a specific encrypted-secret design. Prefer environment/secret storage
for a single-client V1.

## 5. Order

``` text
Order
- id
- shopId?               FK → Shop
- parentOrderId?        FK → Order
- source
- internalStatus

- shopifyOrderId?       UNIQUE where appropriate
- shopifyOrderNumber?
- externalCreatedAt?
- shopifyUpdatedAt?
- shopifyFinancialStatus?
- shopifyFulfillmentStatus?
- shopifyCancelledAt?
- shopifyCancelReason?

- customerName?
- customerEmail?
- customerPhone?

- currency?
- subtotal?
- shippingAmount?
- taxAmount?
- totalAmount?

- notes?
- holdReason?
- errorMessage?

- createdAt
- updatedAt
```

`parentOrderId` links a replacement to the original order.

For manually created replacements, `source = REPLACEMENT`.

## 6. Address

Prefer an order snapshot rather than a mutable customer address.

``` text
Address
- id
- orderId               UNIQUE FK → Order
- name?
- company?
- phone?
- email?
- countryCode?
- province?
- city?
- district?
- address1?
- address2?
- postalCode?
- createdAt
- updatedAt
```

The address represents what was used for that order at that time.

## 7. OrderItem

``` text
OrderItem
- id
- orderId               FK → Order
- shopifyLineItemId?
- sku?
- sgsSku?
- name
- quantity
- unitPrice?
- declaredValue?
- createdAt
- updatedAt
```

For SGS processing, each required line must resolve to a valid SGS SKU.

Shopify can supply incomplete recipient data and line items without a
SKU. Preserve those missing values as `null`; manual-order validation
and carrier-processing validation remain stricter.

For Shopify line-item synchronization, enforce uniqueness on
`(orderId, shopifyLineItemId)`. PostgreSQL permits multiple rows with a
null `shopifyLineItemId`, while rejecting duplicate non-null Shopify
line-item IDs within the same order.

If SKU mapping becomes more complex, introduce a dedicated
mapping/product table later instead of overloading `OrderItem`.

## 8. Shipment

``` text
Shipment
- id
- orderId               FK → Order
- carrier
- internalStatus

- carrierOrderCode?     // SGS order_code
- carrierReferenceNo    // SGS reference_no
- carrierStatus?
- carrierSubStatus?
- allocationStatus?

- warehouseCode
- shippingMethodCode

- trackingNumber?
- shippingCost?
- totalCarrierCost?
- carrierCurrency?

- cancelStatus?
- cancellationReason?
- cancellationRequestedAt?
- cancellationResolvedAt?

- labelLastFetchedAt?
- lastCarrierSyncAt?
- carrierCreatedAt?
- carrierShippedAt?

- lastErrorCode?
- lastErrorMessage?

- createdAt
- updatedAt
```

Recommended constraints:

-   `carrierReferenceNo` unique per carrier.
-   `carrierOrderCode` unique per carrier when non-null.
-   index `trackingNumber`.
-   index `orderId`.
-   index `(carrier, carrierStatus)`.

A shipment row may exist in a pending state before SGS creation so the
application can safely coordinate processing.

## 9. TrackingEvent

``` text
TrackingEvent
- id
- shipmentId            FK → Shipment
- carrierEventCode?
- status?
- description?
- location?
- eventAt?
- rawFingerprint?       UNIQUE per shipment when useful
- createdAt
```

Only add/store detailed tracking history if the UI needs it. The current
tracking number and carrier status belong on `Shipment`.

## 10. OrderStatusHistory

``` text
OrderStatusHistory
- id
- orderId               FK → Order
- fromStatus?
- toStatus
- reason?
- actorUserId?          FK → User
- createdAt
```

This provides a human-readable operational history.

## 11. WebhookEvent

``` text
WebhookEvent
- id
- provider              // SHOPIFY or SGS
- externalEventId
- eventType?
- status
- receivedAt
- processedAt?
- errorMessage?
- payload?              // optional JSON, with retention policy
```

Recommended unique constraint:

``` text
(provider, externalEventId)
```

For SGS callbacks, `externalEventId` can use `msg_id`.

For Shopify, use the webhook identifier supplied by Shopify.

## 12. AuditLog

``` text
AuditLog
- id
- actorUserId?          FK → User
- action
- entityType
- entityId
- metadata?             JSON
- createdAt
```

Examples:

``` text
ORDER_HOLD
ORDER_RELEASE
ORDER_CANCEL_LOCAL
SHIPMENT_CREATE_REQUESTED
SHIPMENT_CREATED
SHIPMENT_CANCEL_REQUESTED
LABEL_FETCHED
REPLACEMENT_CREATED
```

Never store credentials in audit metadata.

## 13. ShippingMethod Cache

Optional but useful:

``` text
ShippingMethod
- id
- carrier
- warehouseCode?
- code
- name
- nameEn?
- isActive
- lastSyncedAt
```

Recommended unique constraint:

``` text
(carrier, warehouseCode, code)
```

The portal can synchronize this from SGS `getShippingMethod`.

## 14. Warehouse Cache

Optional:

``` text
Warehouse
- id
- carrier
- code
- name?
- countryCode?
- carrierStatus?
- isActive
- lastSyncedAt
```

Recommended unique constraint:

``` text
(carrier, code)
```

## 15. Important Indexes

At minimum consider indexes for:

``` text
Order.shopifyOrderNumber
Order.customerName
Order.customerEmail
Order.customerPhone
Order.internalStatus
Order.createdAt

Shipment.trackingNumber
Shipment.carrierOrderCode
Shipment.carrierReferenceNo
Shipment.internalStatus
Shipment.carrierStatus
```

Search requirements may later justify PostgreSQL trigram/full-text
indexes. Do not optimize prematurely.

## 16. Processing / Concurrency Rule

The database must help prevent two requests from creating two SGS
shipments.

Conceptually:

``` text
begin transaction
  lock/check order
  check existing successful shipment
  create/update pending shipment
commit

perform/reconcile SGS operation using stable reference

persist result safely
```

Exact locking strategy should be chosen during implementation for the
deployment/database environment.

The invariant is:

> One processing attempt must not create a second SGS order when an SGS
> order already exists for the same carrier reference.

## 17. Deletion Policy

Operational orders, shipments, webhook receipts and audit records should
generally not be hard-deleted through the normal UI.

Use statuses/voiding where appropriate so history remains investigable.
