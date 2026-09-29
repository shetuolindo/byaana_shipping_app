# Shipping Portal --- Requirements

## 1. Purpose

Build a private web portal that replaces the client's manual process of
copying Shopify orders into SGS/YunWMS.

V1 scope is **Shopify + SGS/YunWMS only**. Royal Mail is intentionally
out of scope for now, but the carrier architecture must allow another
carrier to be added later without rewriting the order system.

## 2. Primary Workflow

``` text
Shopify
  ↓
Portal receives order
  ↓
Staff reviews order
  ↓
Hold / Cancel locally / Process
  ↓
Choose SGS warehouse + shipping method
  ↓
Portal creates SGS order
  ↓
Store SGS order number + tracking
  ↓
Retrieve label
  ↓
Print label
  ↓
Synchronize SGS status/tracking/fees
```

## 3. Users

V1 roles:

-   `ADMIN` --- full access, configuration and staff access.
-   `STAFF` --- daily order processing.

Authentication is required. The portal is not public.

## 4. Orders

The portal must support three order sources:

-   `SHOPIFY`
-   `MANUAL`
-   `REPLACEMENT`

Each order must store its own normalized customer, address, item and
financial data. Shopify's raw data model must not become the
application's internal data model.

Staff must be able to:

-   view incoming orders;
-   open an order and inspect customer, address, products and totals;
-   put an unprocessed order on hold and release it;
-   cancel an order locally when it has not been submitted to SGS;
-   process an eligible order through SGS;
-   see the SGS shipment, tracking and status;
-   print/reprint returned shipping labels;
-   create a manual order;
-   create a replacement from an existing order.

A replacement is a new order linked to the original order. It receives
its own SGS order, tracking number, label, status and costs.

## 5. SGS Processing

Before SGS submission, the system must validate at least:

-   recipient name;
-   phone;
-   address;
-   country;
-   postcode when required by SGS;
-   order items;
-   valid SGS SKU mapping;
-   warehouse;
-   shipping method.

The system must prevent duplicate SGS orders caused by double-clicks,
retries, timeouts or lost responses.

A deterministic `reference_no` must be used for SGS reconciliation. If
`createOrder` has an uncertain result, query SGS by reference before
attempting another create.

The SGS integration must follow `docs/SGS_API.md`.

## 6. Shipment Lifecycle

Orders and shipments are separate records.

An order can exist before a shipment and may eventually have more than
one shipment. Carrier-specific status must be preserved separately from
the portal's internal status.

Initial internal order statuses:

-   `NEW`
-   `ON_HOLD`
-   `READY`
-   `PROCESSING`
-   `SHIPPED`
-   `CANCELLED`
-   `ERROR`

Do not infer that an SGS cancellation is complete merely because a
cancellation request was accepted. Store and synchronize SGS
cancellation state.

## 7. Search and Filters

Provide a single order search that can find orders by:

-   order number;
-   customer name;
-   tracking number;
-   phone;
-   email.

Useful filters:

-   date range;
-   internal status;
-   source;
-   warehouse;
-   shipping method.

## 8. Dashboard

The dashboard should eventually show:

-   total orders;
-   order revenue/sales;
-   shipping spend;
-   average shipping cost;
-   orders awaiting processing;
-   shipped orders;
-   orders needing attention.

Dashboard figures must come from reliable local order/shipment data, not
ad-hoc UI calculations.

## 9. Exports

Staff must be able to export the currently filtered order data to CSV
and Excel.

Useful columns:

-   order number;
-   date;
-   source;
-   customer;
-   email;
-   phone;
-   destination country;
-   order value;
-   SGS warehouse;
-   shipping method;
-   shipping cost;
-   tracking number;
-   internal status;
-   SGS status.

## 10. Auditability

Record important actions such as:

-   order created/imported;
-   order edited;
-   hold/release;
-   local cancellation;
-   SGS submission;
-   SGS cancellation request/result;
-   label retrieval;
-   replacement creation;
-   important synchronization failures.

## 11. Shopify Integration

Shopify orders must enter the portal automatically through
authenticated/verified webhook handling.

Webhook processing must be idempotent.

The Shopify integration must map external payloads into the portal's
normalized order model.

A reconciliation/sync mechanism should exist for recovering missed
webhook updates.

## 12. Reliability and Security

-   Secrets stay server-side.
-   Validate all external inputs and SGS/Shopify responses.
-   Verify Shopify webhooks.
-   Verify SGS callbacks.
-   Never log secrets.
-   Prevent duplicate processing.
-   Record actionable errors.
-   Use authorization checks for protected operations.
-   Use database transactions/locking where necessary.
-   Production traffic must use HTTPS.
-   Maintain audit information sufficient to investigate failures.

## 13. V1 Non-Goals

Do not build these unless requirements change:

-   Royal Mail integration;
-   microservices;
-   Kubernetes;
-   GraphQL;
-   a full warehouse/inventory-management system;
-   SGS inbound/FBA/claims/distribution/returns workflows;
-   customer-facing tracking pages;
-   native mobile apps;
-   advanced accounting.

## 14. V1 Acceptance Flow

V1 is functionally successful when staff can:

1.  sign in;
2.  see a Shopify order in the portal;
3.  review it;
4.  process it exactly once through SGS;
5.  obtain the SGS order number/tracking;
6.  retrieve and print its label(s);
7.  see later SGS status/tracking updates;
8.  request cancellation and see its real result;
9.  find the order later through search;
10. create and process a replacement order through the same workflow.
