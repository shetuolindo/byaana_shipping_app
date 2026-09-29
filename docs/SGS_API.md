# SGS / YunWMS API Integration Guide

> Project-focused reference for the Shopify → Shipping Portal →
> SGS/YunWMS integration.
>
> Source: `ALL_YUNWMS_API_DOCS.md`.
>
> Scope: only the API capabilities needed for the first version of the
> shipping portal. This intentionally excludes unrelated YunWMS modules
> such as inbound receiving, FBA, claims, distribution, and ownership
> transfer.

## 1. Integration Goal

The portal should use SGS/YunWMS to:

1.  Load available warehouses.
2.  Load available shipping methods.
3.  Optionally estimate shipping costs.
4.  Create an SGS order from a reviewed Shopify/manual/replacement
    order.
5.  Store the SGS-generated order number and tracking number.
6.  Retrieve the latest SGS order state.
7.  Retrieve shipping labels for printing.
8.  Retrieve tracking events.
9.  Cancel/intercept an SGS order when permitted.
10. Receive SGS order-change callbacks so the portal does not have to
    rely entirely on polling.

The application should keep its own internal `Order` and `Shipment`
records. SGS data should be mapped into those records rather than
exposing SGS request/response objects throughout the application.

------------------------------------------------------------------------

## 2. API Connection

### Service URL

The documentation describes the production service URL in this form:

`http://<domain>/default/svc/web-service`

The actual SGS/YunWMS domain for the client's account must be confirmed
before implementation.

### Common Request Parameters

Every normal API request uses these common fields:

  Field          Type       Required Purpose
  -------------- -------- ---------- -----------------------------
  `appToken`     String          Yes API secret/key
  `appKey`       String          Yes API identifier
  `service`      String          Yes API method name
  `language`     Enum             No `zh_CN` or `en_US`
  `paramsJson`   String           No JSON-encoded method payload

The documentation does **not** describe a request-signature algorithm
for normal service calls. It shows `appToken` and `appKey` being
supplied directly with the service request.

Keep `appToken` and `appKey` server-side only.

### Common Error Shape

``` json
{
  "errMessage": "Error description",
  "errCode": "Error code"
}
```

Many endpoints additionally return:

``` json
{
  "ask": "Success",
  "message": "..."
}
```

Do not determine success from HTTP status alone. Parse and validate the
API response.

------------------------------------------------------------------------

## 3. SGS Module Boundary

Recommended structure:

``` text
src/modules/carriers/sgs/
  client.ts
  config.ts
  types.ts
  schemas.ts
  errors.ts
  mapper.ts
  status.ts
  services/
    warehouses.ts
    shipping-methods.ts
    orders.ts
    labels.ts
    tracking.ts
    fees.ts
    subscriptions.ts
```

Only this module should know the SGS field names and transport format.

The UI should never call SGS directly.

A higher-level shipping service should expose application-oriented
operations such as:

``` text
getWarehouses()
getShippingMethods(warehouseCode?)
estimateShippingCost(input)
createShipment(order)
getShipment(sgsOrderCode)
getShipmentByReference(referenceNo)
cancelShipment(sgsOrderCode, reason?)
getShipmentStatus(sgsOrderCode)
getLabel(sgsOrderCodes)
getTracking(sgsOrderCodes)
```

------------------------------------------------------------------------

## 4. Required API Endpoints

### 4.1 Get Warehouses

**Service:** `getWarehouse`

Purpose: populate/configure the warehouse used to fulfill an order.

Optional request fields:

-   `pageSize`
-   `page`

Important response fields:

-   `warehouse_id`
-   `warehouse_code`
-   `warehouse_name`
-   `country_code`
-   `warehouse_status`
-   address/contact information

`warehouse_status` values documented:

-   `0` --- unavailable
-   `1` --- available
-   `2` --- disabled

For the portal, store at least `warehouse_code`, `warehouse_name`,
country, and active status.

------------------------------------------------------------------------

### 4.2 Get Shipping Methods

**Service:** `getShippingMethod`

Request:

``` json
{
  "warehouseCode": "DEW"
}
```

`warehouseCode` is optional according to the documentation.

Important response fields:

-   `code`
-   `name`
-   `name_en`
-   `warehouse_code`
-   `sm_reply_special_order`
-   `self_lifting`
-   `sm_is_y2_mark`

The shipping method selected in the portal must ultimately be sent to
`createOrder` as `shipping_method`.

Do not hard-code shipping methods. Load them from SGS and
cache/synchronize them locally.

------------------------------------------------------------------------

### 4.3 Shipping Cost Estimate

**Service:** `getCalculateFee`

Core request fields:

  Field                 Required
  ------------------- ----------
  `warehouse_code`           Yes
  `country_code`             Yes
  `shipping_method`          Yes
  `weight`                   Yes
  `postcode`                  No
  `length`                    No
  `width`                     No
  `height`                    No
  `city`                      No
  `state`                     No
  `address1`                  No
  `name`                      No
  `phone`                     No
  `self_lifting`              No
  `items`                     No

Example response includes fee categories such as:

-   `SHIPPING`
-   `OPF`
-   `FSC`
-   `DT`
-   `RSF`
-   `WHF`
-   `OTF`
-   `totalFee`
-   `currency_code`

Use this endpoint only when a pre-shipment estimate is useful. The final
recorded cost should be synchronized from actual SGS order data when
available rather than assuming the estimate is the final charge.

------------------------------------------------------------------------

## 5. Create SGS Order

### Service

`createOrder`

This is the central endpoint for the project.

### Minimum Core Fields

According to the documentation, these are the important required fields
for a normal order:

  ------------------------------------------------------------------------
  SGS field                                 Required Portal source
  --------------------- ---------------------------- ---------------------
  `reference_no`                                 Yes Shopify order
                                                     identifier/number or
                                                     internal replacement
                                                     reference

  `shipping_method`                              Yes Selected SGS shipping
                                                     method

  `warehouse_code`                               Yes Selected/configured
                                                     SGS warehouse

  `country_code`                                 Yes Shipping address
                                                     country

  `address1`                                     Yes Shipping address

  `zipcode`                                    Yes\* Shipping address
                                                     postcode

  `name`                                         Yes Recipient

  `phone`                                        Yes Recipient phone

  `items`                                        Yes Order line items
  ------------------------------------------------------------------------

\*The documentation states postcode is not required when the recipient
country is the Philippines.

Useful optional fields include:

-   `platform`
-   `platform_shop`
-   `province`
-   `city`
-   `district`
-   `address2`
-   `address3`
-   `doorplate`
-   `company`
-   `cell_phone`
-   `email`
-   `order_desc`
-   `remark`
-   `buyers_message`
-   `order_sale_amount`
-   `order_sale_currency`
-   `tracking_no`
-   `async`

For this application, use `platform: "OTHER"` unless testing shows that
another documented platform value is appropriate for the client's
workflow. Do not assume SGS has a Shopify-specific platform value; the
supplied documentation does not list `SHOPIFY`.

### Items

Each order item requires:

  Field             Required
  --------------- ----------
  `product_sku`          Yes
  `quantity`             Yes

Optional item fields include:

-   `reference_no`
-   `product_name`
-   `product_name_en`
-   `product_declared_value`
-   marketplace-specific identifiers
-   batch information

This means the Shopify SKU → SGS SKU relationship is critical. Before an
order is sent to SGS, every required product must have a valid SGS
`product_sku`.

### Review / Verification

`verify` controls whether the order is created as an unreviewed draft or
created and reviewed:

-   `0` --- create without review; default
-   `1` --- create and review

The documentation states that after an order passes review, it cannot be
edited.

`forceVerify` applies when `verify == 1`:

-   `0` --- do not force
-   `1` --- force review even in conditions such as insufficient
    balance/stock, according to the documentation

For V1, do **not** default to `forceVerify: 1`. Treat it as an explicit
business decision.

### Synchronous vs Asynchronous

`async`:

-   `1` --- asynchronous
-   otherwise the documentation says synchronous is the default

The documentation explicitly says asynchronous creation should be paired
with the order callback integration.

Start with synchronous creation unless there is a demonstrated reason to
use asynchronous mode.

### Create Response

Important response fields:

-   `ask`
-   `message`
-   `order_code`
-   `tracking_no`
-   `f_ask`
-   `Error`

`order_code` is the SGS-generated order number.

`tracking_no` may be returned immediately depending on the shipping
method.

`f_ask` relates to label/attachment upload success in the create-order
operation.

### Data to Persist Immediately

After successful creation, persist at least:

``` text
sgsOrderCode
referenceNo
warehouseCode
shippingMethod
trackingNumber
rawCarrierStatus
createdAt
lastSyncedAt
```

Also persist the relevant raw response or structured diagnostic metadata
so failures can be investigated without exposing secrets.

------------------------------------------------------------------------

## 6. Duplicate Prevention

`reference_no` should be treated as the application's stable external
reference.

Before calling `createOrder`:

1.  Lock the local shipment/order operation.
2.  Check whether a successful SGS shipment already exists locally.
3.  If the previous attempt has an uncertain result, query SGS using
    `getOrderByRefCode`.
4.  Only create a new SGS order if reconciliation confirms one does not
    already exist.

This is essential for retries, browser double-clicks, server timeouts,
and situations where SGS creates an order but the portal fails before
storing the response.

For Shopify orders, use a deterministic reference. For replacements,
generate a unique replacement reference and link the new local order to
the original order.

------------------------------------------------------------------------

## 7. Query an Order

Two endpoints are especially useful.

### By SGS Order Number

**Service:** `getOrderByCode`

Request:

``` json
{
  "order_code": "100057-141014-0001"
}
```

### By Application Reference

**Service:** `getOrderByRefCode`

Request:

``` json
{
  "reference_no": "EB0000000001"
}
```

The documentation says this reference lookup returns valid orders.

Important response fields include:

-   `order_code`
-   `reference_no`
-   `order_status`
-   `shipping_method`
-   `tracking_no`
-   `carrier_name`
-   `warehouse_code`
-   `order_weight`
-   creation/release/shipping/packing/modification timestamps
-   consignee information
-   `items`
-   `fee_details`
-   `fee_items`
-   `currency`
-   `order_sale_amount`
-   `order_sale_currency`

These endpoints should be the primary reconciliation source after SGS
callbacks and uncertain create-order attempts.

------------------------------------------------------------------------

## 8. Order Status

### Service

`getOrderStatusByCode`

Request:

``` json
{
  "order_code": "100057-141014-0001"
}
```

Documented SGS order statuses:

  SGS   Meaning in documentation      Suggested internal interpretation
  ----- ----------------------------- -----------------------------------
  `C`   Waiting for shipping review   PROCESSING / REVIEW
  `W`   Waiting to ship               PROCESSING
  `D`   Shipped                       SHIPPED
  `H`   Temporarily held              ON_HOLD
  `N`   Abnormal order                ERROR
  `P`   Problem shipment              ERROR / ATTENTION
  `X`   Voided                        CANCELLED

Keep both:

``` text
internalStatus
sgsRawStatus
```

Do not discard the raw SGS status.

The endpoint can also return:

-   tracking number
-   shipping method
-   warehouse
-   weight
-   timestamps
-   abnormal reason
-   fees
-   transfer order number
-   allocation status

Documented allocation status:

-   `1` --- waiting for warehouse allocation
-   `2` --- allocation successful
-   `3` --- allocation failed

------------------------------------------------------------------------

## 9. Update Order

### Service

`modifyOrder`

The request includes `order_code` plus the order data.

The documentation states that once an order has passed review it cannot
be edited.

Therefore the portal should not present "Edit shipment" as universally
available. Editing must depend on the SGS lifecycle/state.

A safe V1 flow is:

``` text
NEW / local-only
    ↓
editable freely in portal

SGS draft / not reviewed
    ↓
potentially editable through modifyOrder

SGS reviewed / processing
    ↓
treat as locked unless verified otherwise
```

Do not assume every field can be changed after SGS creation.

------------------------------------------------------------------------

## 10. Cancel / Intercept Order

### Service

`cancelOrder`

Request:

``` json
{
  "order_code": "SGS_ORDER_CODE",
  "reason": "Customer requested cancellation"
}
```

`reason` is optional.

The API returns a `cancel_status`.

Documented values:

    Value Meaning
  ------- ----------------------------------------------
      `0` None
      `1` Interception in progress
      `2` Interception successful
      `3` Interception failed
      `4` Interception successful but fee not refunded

This means **a successful API call is not equivalent to an immediately
cancelled shipment**.

The portal should store cancellation state separately and continue
synchronizing until the outcome is known.

Suggested local fields:

``` text
cancellationRequestedAt
cancellationReason
sgsCancelStatus
cancellationResolvedAt
```

Never mark the shipment `CANCELLED` merely because the user clicked
Cancel.

------------------------------------------------------------------------

## 11. Shipping Label

### Service

`getPrintLabelOnlyLogistics`

Request:

``` json
{
  "order_code_arr": [
    "LXJ-220720-0001"
  ]
}
```

The endpoint supports multiple order numbers.

Response shape:

``` json
{
  "ask": "Success",
  "message": "",
  "data": [
    {
      "order_code": "LXJ-220720-0001",
      "order_label": [
        "<label URL>"
      ]
    }
  ]
}
```

`order_label` is an array because an order may have multiple labels.

### Portal Behavior

The label workflow should be:

``` text
User clicks Print Label
        ↓
Backend requests label from SGS
        ↓
Validate SGS response
        ↓
Return label reference(s) to authorized portal user
        ↓
Open/render printable label
```

Do not assume one label per order.

Do not permanently store the label binary unless there is a clear
business requirement. Prefer storing/retrieving the SGS order identifier
and requesting current label data when needed.

The URLs in SGS responses should be treated as external data and should
not be exposed without normal authorization checks.

------------------------------------------------------------------------

## 12. Tracking

### Standard Tracking Endpoint

**Service:** `getOrderTracking`

Request:

``` json
{
  "order_numbers": "ORDER1,ORDER2"
}
```

The documentation says the request supports a maximum of **20 orders**,
separated by comma, spaces, or line breaks.

Tracking fields include:

-   `trackNumber`
-   `orderCode`
-   `deliveryDate`
-   `locationCode`
-   `status`
-   `shipStatus`
-   `track_description`
-   `trackCode`
-   `transfer_order_no`

Documented `shipStatus`:

-   `0` --- none
-   `1` --- in delivery
-   `2` --- delivered
-   `3` --- service provider not delivered

The response contains `list` and `detail` structures.

### YD Tracking

The documentation also contains `getOrderTrackingYd`, which accepts
arrays of order codes or tracking numbers and supports up to 50. This
appears to be a more specialized tracking API.

Do not make it the default until the client's SGS account/workflow
confirms it is the intended endpoint.

------------------------------------------------------------------------

## 13. Order Change Subscription / Callback

This is useful and should be included after the core order flow is
working.

### Subscribe

**Service:** `messageSubscript`

For order changes:

``` json
{
  "subscript_type": "order",
  "callback": "https://YOUR_DOMAIN/api/webhooks/sgs",
  "erp_platform": "erp",
  "expire_date": "YYYY-MM-DD"
}
```

The documentation defines:

-   `order`
-   `receiving`
-   `stock`
-   `ec_new_fba`

For this project, subscribe to `order`.

The subscription has an expiry date and must be renewed after expiry.

### Callback URL Verification

If a callback URL is supplied during subscription, SGS validates it with
an HTTP GET request containing a `random` query parameter.

The endpoint must return the same value, e.g.:

``` json
{
  "random": "1679297714"
}
```

The callback must be publicly reachable without interactive login.

### Callback Delivery

SGS sends HTTP POST notifications.

The documentation says:

-   callbacks may be retried up to 5 times;
-   retry interval is one minute;
-   the callback should return HTTP 200 to be considered successful;
-   after receiving the notification, the integration should query the
    relevant API for the current authoritative data.

This is important: **the callback is a notification, not the final
source of truth.**

For an order callback, call `getOrderByCode` or `getOrderByRefCode` and
synchronize the local record.

### Order Callback Body

Important fields:

-   `order_code`
-   `reference_no`
-   `warehouse_code`
-   `customer_code`
-   `order_status`
-   `type`

Callback `type` values documented:

    Type Meaning
  ------ ----------------------------------
     `1` General order information change
     `2` Fee change
     `3` Tracking number change
     `4` Order shipped/outbound
     `5` Asynchronous order creation

The callback documentation specifically mentions notifications when:

-   a tracking number is obtained;
-   an order ships/leaves the warehouse;
-   fees change/recalculation occurs.

### Callback Authentication

Callback requests contain:

-   `app_key`
-   `sign`
-   `timestamp`
-   `msg_id`
-   `subscript_type`
-   `body`

The documentation defines an MD5 signature based on the serialized
message/body data combined with the user's `AppToken`, timestamp, and
message ID.

Implement callback verification from the exact documented algorithm and
test it against real SGS callback samples before production.

Also deduplicate callbacks by `msg_id`.

------------------------------------------------------------------------

## 14. Recommended Application Workflow

``` text
Shopify webhook
      ↓
Create/update LOCAL order
      ↓
Staff reviews order
      ↓
Validate:
  - address
  - SKU mapping
  - warehouse
  - shipping method
      ↓
Optional cost estimate
      ↓
User clicks Process
      ↓
Acquire server-side shipment lock
      ↓
Check/reconcile by reference_no
      ↓
createOrder
      ↓
Store SGS order_code + tracking_no
      ↓
Synchronize SGS order
      ↓
Retrieve label
      ↓
Print
      ↓
SGS callback / scheduled reconciliation
      ↓
getOrderByCode
      ↓
Update tracking, status and actual fees
```

------------------------------------------------------------------------

## 15. Manual and Replacement Orders

A replacement should be a **new local order**, not a mutation of the
original shipment.

Suggested relationship:

``` text
Original Order
  id: order_123

Replacement Order
  id: order_456
  source: REPLACEMENT
  parentOrderId: order_123
```

The replacement receives its own unique `reference_no`, SGS
`order_code`, shipment, tracking number, label, fees, and status.

Manual orders follow the same SGS processing path. Only their source
differs.

This keeps all carrier logic in one workflow.

------------------------------------------------------------------------

## 16. Recommended Database Fields for SGS Shipment

``` text
Shipment
- id
- orderId
- carrier                  // SGS
- carrierOrderCode         // SGS order_code
- carrierReferenceNo       // SGS reference_no
- warehouseCode
- shippingMethodCode
- trackingNumber
- internalStatus
- carrierStatus
- carrierSubStatus
- allocationStatus
- shippingCost
- totalCarrierCost
- carrierCurrency
- cancelStatus
- cancellationReason
- labelLastFetchedAt
- lastCarrierSyncAt
- carrierCreatedAt
- carrierShippedAt
- createdAt
- updatedAt
```

Tracking events should be stored separately if the portal needs a
historical tracking timeline.

------------------------------------------------------------------------

## 17. Fields the Shopify Mapper Must Produce

The carrier mapper should receive normalized application data rather
than a raw Shopify object.

At minimum:

``` ts
type ShipmentInput = {
  referenceNo: string;
  warehouseCode: string;
  shippingMethod: string;

  recipient: {
    name: string;
    company?: string;
    phone: string;
    email?: string;
  };

  address: {
    countryCode: string;
    province?: string;
    city?: string;
    district?: string;
    address1: string;
    address2?: string;
    postalCode: string;
  };

  items: Array<{
    sku: string;
    quantity: number;
    name?: string;
    declaredValue?: number;
  }>;

  orderValue?: number;
  currency?: string;
  notes?: string;
};
```

Then:

``` text
Shopify → Internal Order → ShipmentInput → SGS mapper → createOrder payload
```

Never implement:

``` text
Shopify payload → SGS directly
```

That would make manual orders, replacement orders, tests, and future
carriers much harder.

------------------------------------------------------------------------

## 18. Error Handling Rules

Every SGS operation should classify errors into at least:

``` text
VALIDATION_ERROR
AUTH_ERROR
NETWORK_ERROR
TIMEOUT
SGS_REJECTED
SGS_UNKNOWN_RESULT
NOT_FOUND
CANCELLATION_PENDING
CANCELLATION_FAILED
```

### Most Important Case: Unknown Create Result

Example:

``` text
Portal sends createOrder
        ↓
SGS creates order
        ↓
Network connection dies before response arrives
```

Do **not** blindly retry `createOrder`.

Instead:

``` text
Query getOrderByRefCode(reference_no)
        ↓
Found → repair local shipment record
Not found → creation may be retried under controlled rules
```

This is the most important duplicate-shipment protection in the
integration.

------------------------------------------------------------------------

## 19. What We Do Not Need for V1

The supplied YunWMS documentation contains many APIs that are not
required for the current shipping portal.

Do not implement these unless requirements change:

-   inbound/receiving orders
-   FBA workflows
-   ownership transfer
-   warehouse transfer orders
-   claims
-   distribution
-   return-management module
-   defective-item processing
-   OMS SSO/user APIs
-   Southeast Asia marketplace logistics configuration
-   recharge/remittance functions
-   warehouse storage billing

The Product module also does not need to become a full
inventory-management feature in V1.

We only need enough product/SKU knowledge to ensure Shopify order lines
can be mapped to valid SGS SKUs.

------------------------------------------------------------------------

## 20. Implementation Order for Cline

Keep each task deliberately small.

### SGS-01 --- Client foundation

Implement only:

-   environment variables
-   SGS client
-   common request envelope
-   response/error parser
-   typed SGS error class
-   mocked tests

No order endpoints.

### SGS-02 --- Warehouses

Implement only `getWarehouse`.

### SGS-03 --- Shipping methods

Implement only `getShippingMethod`.

### SGS-04 --- Order mapper

Implement only internal `ShipmentInput` → SGS `createOrder` payload
mapping.

No network call.

### SGS-05 --- Create order

Implement `createOrder` using the existing client and mapper.

Add response validation and tests.

### SGS-06 --- Reconciliation

Implement:

-   `getOrderByCode`
-   `getOrderByRefCode`

Use reference lookup to recover uncertain create attempts.

### SGS-07 --- Status

Implement `getOrderStatusByCode` and the internal status mapper.

### SGS-08 --- Labels

Implement `getPrintLabelOnlyLogistics`.

Support multiple returned labels.

### SGS-09 --- Cancellation

Implement `cancelOrder`.

Persist and expose the SGS cancellation state rather than assuming
immediate cancellation.

### SGS-10 --- Tracking

Implement `getOrderTracking`.

Respect the documented maximum of 20 order numbers per request.

### SGS-11 --- Fees

Implement `getCalculateFee` only if the UI needs pre-shipment estimates.

### SGS-12 --- Callbacks

Implement:

-   subscription setup
-   callback GET verification
-   callback POST endpoint
-   signature verification
-   `msg_id` deduplication
-   order reconciliation after notification

Do this after the basic create/query/label workflow is stable.

------------------------------------------------------------------------

## 21. Environment Variables

Use placeholders only:

``` env
SGS_BASE_URL=
SGS_APP_KEY=
SGS_APP_TOKEN=
```

Never commit real credentials.

The base URL should be configurable because the documentation describes
the service path generically and the client's actual SGS
domain/environment must be confirmed.

------------------------------------------------------------------------

## 22. Cline Guardrails

Put these rules in `AGENTS.md`:

``` text
- Read docs/REQUIREMENTS.md, docs/ARCHITECTURE.md and docs/SGS_API.md before SGS work.
- Never call SGS from browser/client-side code.
- All SGS API traffic must go through src/modules/carriers/sgs.
- Never log appToken or other secrets.
- Do not invent SGS fields or endpoints.
- Validate external SGS responses.
- Keep raw SGS status separate from internal status.
- Use reference_no for reconciliation and duplicate protection.
- Do not blindly retry createOrder after an uncertain response.
- Query SGS by reference_no first.
- Do not assume cancelOrder means immediate cancellation.
- Do not assume one label per order.
- Do not hard-code warehouse or shipping-method codes.
- Avoid unrelated refactors.
- Add tests for every mapper and SGS service method.
```

------------------------------------------------------------------------

## 23. Open Questions Before Real SGS Testing

The supplied API documentation does not answer every account-specific
question. Confirm these with the client's SGS/YunWMS account before
production:

1.  What is the exact production API base domain for this account?
2.  Does SGS provide a sandbox/test environment and separate
    credentials?
3.  Which warehouse code(s) should this client use?
4.  Which shipping methods are enabled for the client's account?
5.  Should portal processing use `verify: 0` or `verify: 1`?
6.  Is synchronous `createOrder` suitable for the client's normal
    volume?
7.  Are Shopify SKUs already identical to SGS product SKUs?
8.  Which label formats do the client's enabled shipping methods return?
9.  Which shipping methods return tracking numbers immediately?
10. What callback URL/domain will be used in production?
11. How long should the order message subscription remain active before
    automatic renewal?
12. Are there account-specific restrictions on editing or cancelling
    reviewed orders?

These should be answered through actual account configuration/testing
rather than guessed from the generic API reference.

------------------------------------------------------------------------

## 24. V1 SGS Definition of Done

The SGS integration is ready for the first production workflow when the
portal can reliably:

-   fetch configured warehouses;
-   fetch shipping methods;
-   map a normalized local order to SGS;
-   create exactly one SGS order;
-   recover safely from uncertain create responses;
-   store the SGS order number;
-   synchronize status and tracking number;
-   retrieve and print all returned labels;
-   request cancellation and track its real result;
-   retrieve tracking events;
-   synchronize actual SGS fees;
-   receive and authenticate order callbacks;
-   handle duplicate callbacks;
-   surface understandable errors to staff;
-   keep credentials server-side;
-   record enough diagnostic/audit information to investigate failures.

At that point, Shopify ingestion and the portal UI can rely on a stable
SGS carrier boundary rather than embedding SGS behavior throughout the
application.
