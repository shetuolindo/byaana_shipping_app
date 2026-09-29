// This standalone script runs directly under Node without adding a TypeScript runner.
const {
  Carrier,
  OrderSource,
  OrderStatus,
  Prisma,
  PrismaClient,
  ShipmentStatus,
  UserRole,
  // eslint-disable-next-line @typescript-eslint/no-require-imports
} = require("@prisma/client") as typeof import("@prisma/client");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const bcrypt = require("bcryptjs") as typeof import("bcryptjs");

const prisma = new PrismaClient();

const SEED_PREFIX = "dev-seed-";
const ADMIN_ID = `${SEED_PREFIX}user-admin`;
const STAFF_ID = `${SEED_PREFIX}user-staff`;
const SHOP_ID = `${SEED_PREFIX}shop`;
const BASE_DATE = new Date("2026-01-05T09:00:00.000Z");
const BCRYPT_COST = 12;

// Development-only credentials. Never reuse these passwords outside local development.
const ADMIN_PASSWORD = "Admin123!";
const STAFF_PASSWORD = "Staff123!";

const statuses = [
  OrderStatus.NEW,
  OrderStatus.ON_HOLD,
  OrderStatus.READY,
  OrderStatus.PROCESSING,
  OrderStatus.SHIPPED,
  OrderStatus.CANCELLED,
  OrderStatus.ERROR,
] as const;

const warehouses = [
  {
    id: `${SEED_PREFIX}warehouse-uk`,
    code: "DEV-UK-01",
    name: "Development UK Warehouse",
    countryCode: "GB",
  },
  {
    id: `${SEED_PREFIX}warehouse-de`,
    code: "DEV-DE-01",
    name: "Development Germany Warehouse",
    countryCode: "DE",
  },
  {
    id: `${SEED_PREFIX}warehouse-us`,
    code: "DEV-US-01",
    name: "Development US Warehouse",
    countryCode: "US",
  },
] as const;

const shippingMethods = [
  {
    id: `${SEED_PREFIX}method-uk-standard`,
    warehouseCode: "DEV-UK-01",
    code: "DEV-UK-STANDARD",
    name: "Development UK Standard",
  },
  {
    id: `${SEED_PREFIX}method-uk-express`,
    warehouseCode: "DEV-UK-01",
    code: "DEV-UK-EXPRESS",
    name: "Development UK Express",
  },
  {
    id: `${SEED_PREFIX}method-de-standard`,
    warehouseCode: "DEV-DE-01",
    code: "DEV-DE-STANDARD",
    name: "Development DE Standard",
  },
  {
    id: `${SEED_PREFIX}method-us-standard`,
    warehouseCode: "DEV-US-01",
    code: "DEV-US-STANDARD",
    name: "Development US Standard",
  },
  {
    id: `${SEED_PREFIX}method-us-express`,
    warehouseCode: "DEV-US-01",
    code: "DEV-US-EXPRESS",
    name: "Development US Express",
  },
] as const;

const shippingMethodByWarehouse = {
  "DEV-UK-01": ["DEV-UK-STANDARD", "DEV-UK-EXPRESS"],
  "DEV-DE-01": ["DEV-DE-STANDARD"],
  "DEV-US-01": ["DEV-US-STANDARD", "DEV-US-EXPRESS"],
} as const;

function seedId(type: string, index: number, suffix?: string) {
  const base = `${SEED_PREFIX}${type}-${index.toString().padStart(3, "0")}`;
  return suffix ? `${base}-${suffix}` : base;
}

function dateFor(index: number, hours = 0) {
  return new Date(BASE_DATE.getTime() + (index - 1) * 86_400_000 + hours * 3_600_000);
}

function money(value: number) {
  return new Prisma.Decimal(value.toFixed(2));
}

function sourceFor(index: number) {
  if (index <= 18) return OrderSource.SHOPIFY;
  if (index <= 24) return OrderSource.MANUAL;
  return OrderSource.REPLACEMENT;
}

function itemCountFor(index: number) {
  if (index % 5 === 0) return 3;
  if (index % 2 === 0) return 2;
  return 1;
}

function parentOrderIdFor(index: number) {
  const parentIndexes: Record<number, number> = {
    25: 5,
    26: 9,
    27: 13,
    28: 17,
  };
  const parentIndex = parentIndexes[index];
  return parentIndex ? seedId("order", parentIndex) : null;
}

function addressFor(index: number) {
  const location = index % 3;

  if (location === 1) {
    return {
      countryCode: "GB",
      city: "Testford",
      province: "Developmentshire",
      postalCode: `DV${index.toString().padStart(2, "0")} 1AA`,
    };
  }

  if (location === 2) {
    return {
      countryCode: "DE",
      city: "Beispielstadt",
      province: "Testland",
      postalCode: `10${index.toString().padStart(3, "0")}`,
    };
  }

  return {
    countryCode: "US",
    city: "Example City",
    province: "CA",
    postalCode: `90${index.toString().padStart(3, "0")}`,
  };
}

function historyReason(status: (typeof statuses)[number]) {
  switch (status) {
    case OrderStatus.ON_HOLD:
      return "Development example: address review required";
    case OrderStatus.READY:
      return "Development example: order reviewed and ready";
    case OrderStatus.PROCESSING:
      return "Development example: submitted to fake SGS workflow";
    case OrderStatus.SHIPPED:
      return "Development example: fake shipment dispatched";
    case OrderStatus.CANCELLED:
      return "Development example: customer requested cancellation";
    case OrderStatus.ERROR:
      return "Development example: fake carrier validation failure";
    default:
      return "Development example: order created";
  }
}

async function clearExistingSeedData() {
  const seeded = { id: { startsWith: SEED_PREFIX } };
  const seededOrder = { orderId: { startsWith: SEED_PREFIX } };

  await prisma.$transaction(async (tx) => {
    await tx.trackingEvent.deleteMany({
      where: {
        OR: [seeded, { shipment: { orderId: { startsWith: SEED_PREFIX } } }],
      },
    });
    await tx.orderStatusHistory.deleteMany({ where: { OR: [seeded, seededOrder] } });
    await tx.auditLog.deleteMany({ where: seeded });
    await tx.webhookEvent.deleteMany({ where: seeded });
    await tx.shipment.deleteMany({ where: { OR: [seeded, seededOrder] } });
    await tx.address.deleteMany({ where: { OR: [seeded, seededOrder] } });
    await tx.orderItem.deleteMany({ where: { OR: [seeded, seededOrder] } });
    await tx.order.deleteMany({ where: seeded });
    await tx.shippingMethod.deleteMany({ where: seeded });
    await tx.warehouse.deleteMany({ where: seeded });
    await tx.shop.deleteMany({ where: seeded });
    await tx.user.deleteMany({ where: seeded });
  });
}

async function createSeedData() {
  const [adminPasswordHash, staffPasswordHash] = await Promise.all([
    bcrypt.hash(ADMIN_PASSWORD, BCRYPT_COST),
    bcrypt.hash(STAFF_PASSWORD, BCRYPT_COST),
  ]);

  await prisma.$transaction(
    async (tx) => {
      await tx.user.createMany({
        data: [
          {
            id: ADMIN_ID,
            name: "Development Admin",
            email: "admin@shipping-portal.example.test",
            passwordHash: adminPasswordHash,
            role: UserRole.ADMIN,
            createdAt: BASE_DATE,
            updatedAt: BASE_DATE,
          },
          {
            id: STAFF_ID,
            name: "Development Staff",
            email: "staff@shipping-portal.example.test",
            passwordHash: staffPasswordHash,
            role: UserRole.STAFF,
            createdAt: BASE_DATE,
            updatedAt: BASE_DATE,
          },
        ],
      });

      await tx.shop.create({
        data: {
          id: SHOP_ID,
          name: "Development Shopify Store",
          shopifyShopDomain: "development-shipping-store.example.test",
          isActive: true,
          createdAt: BASE_DATE,
          updatedAt: BASE_DATE,
        },
      });

      await tx.warehouse.createMany({
        data: warehouses.map((warehouse) => ({
          ...warehouse,
          carrier: Carrier.SGS,
          carrierStatus: "DEV_ACTIVE",
          isActive: true,
          lastSyncedAt: BASE_DATE,
        })),
      });

      await tx.shippingMethod.createMany({
        data: shippingMethods.map((method) => ({
          ...method,
          carrier: Carrier.SGS,
          nameEn: method.name,
          isActive: true,
          lastSyncedAt: BASE_DATE,
        })),
      });

      for (let index = 1; index <= 28; index += 1) {
        const source = sourceFor(index);
        const status = statuses[(index - 1) % statuses.length];
        const itemCount = itemCountFor(index);
        const itemValues = Array.from({ length: itemCount }, (_, itemOffset) => {
          const itemNumber = itemOffset + 1;
          const unitPrice = 11 + index * 1.35 + itemNumber * 2.25;
          const quantity = itemNumber % 2 === 0 ? 2 : 1;
          return { itemNumber, quantity, unitPrice };
        });
        const subtotal = itemValues.reduce(
          (sum, item) => sum + item.unitPrice * item.quantity,
          0,
        );
        const shippingAmount = 4.95 + (index % 3) * 1.5;
        const taxAmount = subtotal * 0.2;
        const totalAmount = subtotal + shippingAmount + taxAmount;
        const createdAt = dateFor(index);
        const customerNumber = index.toString().padStart(2, "0");
        const address = addressFor(index);

        await tx.order.create({
          data: {
            id: seedId("order", index),
            orderNumber: `DEV-${1000 + index}`,
            shopId: source === OrderSource.MANUAL ? null : SHOP_ID,
            parentOrderId: parentOrderIdFor(index),
            source,
            internalStatus: status,
            shopifyOrderId:
              source === OrderSource.SHOPIFY ? `gid://shopify/Order/DEV${1000 + index}` : null,
            shopifyOrderNumber:
              source === OrderSource.SHOPIFY ? `DEV-SHOP-${1000 + index}` : null,
            externalCreatedAt: source === OrderSource.SHOPIFY ? createdAt : null,
            customerName: `Dev Customer ${customerNumber}`,
            customerEmail: `dev.customer${customerNumber}@example.test`,
            customerPhone: `+44 7700 90${index.toString().padStart(4, "0")}`,
            currency: "GBP",
            subtotal: money(subtotal),
            shippingAmount: money(shippingAmount),
            taxAmount: money(taxAmount),
            totalAmount: money(totalAmount),
            notes: "Development seed data only",
            holdReason:
              status === OrderStatus.ON_HOLD ? "Development example: verify fake address" : null,
            errorMessage:
              status === OrderStatus.ERROR
                ? "Development example: fake carrier validation failed"
                : null,
            createdAt,
            updatedAt: createdAt,
            address: {
              create: {
                id: seedId("address", index),
                name: `Dev Customer ${customerNumber}`,
                company: index % 4 === 0 ? `Example Company ${customerNumber}` : null,
                phone: `+44 7700 90${index.toString().padStart(4, "0")}`,
                email: `dev.customer${customerNumber}@example.test`,
                ...address,
                district: "Development District",
                address1: `${index} Example Test Street`,
                address2: index % 3 === 0 ? "Development Suite 2" : null,
                createdAt,
                updatedAt: createdAt,
              },
            },
            items: {
              create: itemValues.map((item) => ({
                id: seedId("item", index, item.itemNumber.toString()),
                shopifyLineItemId:
                  source === OrderSource.SHOPIFY
                    ? `gid://shopify/LineItem/DEV${index}${item.itemNumber}`
                    : null,
                sku: `DEV-SKU-${item.itemNumber.toString().padStart(3, "0")}`,
                sgsSku: `DEV-SGS-SKU-${item.itemNumber.toString().padStart(3, "0")}`,
                name: `Development Product ${item.itemNumber}`,
                quantity: item.quantity,
                unitPrice: money(item.unitPrice),
                declaredValue: money(item.unitPrice),
                createdAt,
                updatedAt: createdAt,
              })),
            },
          },
        });

        await tx.orderStatusHistory.create({
          data: {
            id: seedId("history", index, "created"),
            orderId: seedId("order", index),
            fromStatus: null,
            toStatus: OrderStatus.NEW,
            reason: "Development example: order created",
            actorUserId: source === OrderSource.SHOPIFY ? null : STAFF_ID,
            createdAt,
          },
        });

        if (status !== OrderStatus.NEW) {
          await tx.orderStatusHistory.create({
            data: {
              id: seedId("history", index, "current"),
              orderId: seedId("order", index),
              fromStatus: OrderStatus.NEW,
              toStatus: status,
              reason: historyReason(status),
              actorUserId: STAFF_ID,
              createdAt: dateFor(index, 1),
            },
          });
        }
      }

      const shipmentOrderIndexes = [3, 4, 5, 7, 10, 11, 12, 14, 17, 18, 19, 21, 24, 25, 26, 27, 28];

      for (const index of shipmentOrderIndexes) {
        const orderStatus = statuses[(index - 1) % statuses.length];
        const warehouse = warehouses[(index - 1) % warehouses.length];
        const availableMethods = shippingMethodByWarehouse[warehouse.code];
        const shippingMethodCode = availableMethods[index % availableMethods.length];
        const shipmentId = seedId("shipment", index);
        const isReady = orderStatus === OrderStatus.READY;
        const isShipped = orderStatus === OrderStatus.SHIPPED;
        const isCancelled = orderStatus === OrderStatus.CANCELLED;
        const isError = orderStatus === OrderStatus.ERROR;
        const shipmentStatus = isReady
          ? ShipmentStatus.PENDING
          : isShipped
            ? ShipmentStatus.SHIPPED
            : isCancelled
              ? ShipmentStatus.CANCELLED
              : isError
                ? ShipmentStatus.ERROR
                : ShipmentStatus.PROCESSING;
        const carrierStatus = isReady
          ? null
          : isShipped
            ? "D"
            : isCancelled
              ? "X"
              : isError
                ? "N"
                : "W";
        const createdAt = dateFor(index, 2);

        await tx.shipment.create({
          data: {
            id: shipmentId,
            orderId: seedId("order", index),
            carrier: Carrier.SGS,
            internalStatus: shipmentStatus,
            carrierOrderCode: isReady ? null : `DEV-SGS-ORDER-${index.toString().padStart(5, "0")}`,
            carrierReferenceNo: `DEV-REF-${index.toString().padStart(5, "0")}`,
            carrierStatus,
            carrierSubStatus: isError ? "DEV_VALIDATION_ERROR" : null,
            allocationStatus: isError ? "3" : isReady ? null : "2",
            warehouseCode: warehouse.code,
            shippingMethodCode,
            trackingNumber: isShipped ? `DEV-TRACK-${index.toString().padStart(8, "0")}` : null,
            shippingCost: isShipped || isCancelled ? money(7.5 + index * 0.3) : null,
            totalCarrierCost: isShipped || isCancelled ? money(8.75 + index * 0.35) : null,
            carrierCurrency: isShipped || isCancelled ? "GBP" : null,
            cancelStatus: isCancelled ? "2" : null,
            cancellationReason: isCancelled ? "Development example cancellation" : null,
            cancellationRequestedAt: isCancelled ? dateFor(index, 3) : null,
            cancellationResolvedAt: isCancelled ? dateFor(index, 4) : null,
            labelLastFetchedAt: isShipped ? dateFor(index, 5) : null,
            lastCarrierSyncAt: isReady ? null : dateFor(index, 6),
            carrierCreatedAt: isReady ? null : createdAt,
            carrierShippedAt: isShipped ? dateFor(index, 8) : null,
            lastErrorCode: isError ? "DEV_CARRIER_REJECTED" : null,
            lastErrorMessage: isError ? "Development example: fake SGS order rejected" : null,
            createdAt,
            updatedAt: dateFor(index, 6),
            trackingEvents: isShipped
              ? {
                  create: [
                    {
                      id: seedId("tracking", index, "accepted"),
                      carrierEventCode: "DEV_ACCEPTED",
                      status: "ACCEPTED",
                      description: "Development parcel accepted by fake carrier",
                      location: warehouse.name,
                      eventAt: dateFor(index, 3),
                      rawFingerprint: `dev-${index}-accepted`,
                      createdAt: dateFor(index, 3),
                    },
                    {
                      id: seedId("tracking", index, "transit"),
                      carrierEventCode: "DEV_IN_TRANSIT",
                      status: "IN_TRANSIT",
                      description: "Development parcel in transit",
                      location: "Development Sorting Centre",
                      eventAt: dateFor(index, 6),
                      rawFingerprint: `dev-${index}-transit`,
                      createdAt: dateFor(index, 6),
                    },
                    {
                      id: seedId("tracking", index, "delivered"),
                      carrierEventCode: "DEV_DELIVERED",
                      status: "DELIVERED",
                      description: "Development parcel delivered",
                      location: "Example Destination",
                      eventAt: dateFor(index, 10),
                      rawFingerprint: `dev-${index}-delivered`,
                      createdAt: dateFor(index, 10),
                    },
                  ],
                }
              : undefined,
          },
        });
      }

      await tx.webhookEvent.createMany({
        data: Array.from({ length: 18 }, (_, offset) => {
          const index = offset + 1;
          return {
            id: seedId("webhook", index),
            provider: "SHOPIFY",
            externalEventId: `dev-shopify-webhook-${index.toString().padStart(3, "0")}`,
            eventType: "orders/create",
            status: "PROCESSED",
            receivedAt: dateFor(index),
            processedAt: dateFor(index, 1),
            payload: {
              developmentSeed: true,
              fakeShopifyOrderId: `DEV${1000 + index}`,
            },
          };
        }),
      });

      await tx.auditLog.createMany({
        data: [
          ...Array.from({ length: 28 }, (_, offset) => {
            const index = offset + 1;
            const source = sourceFor(index);
            return {
              id: seedId("audit-order", index),
              actorUserId: source === OrderSource.SHOPIFY ? null : STAFF_ID,
              action:
                source === OrderSource.REPLACEMENT ? "REPLACEMENT_CREATED" : "ORDER_CREATED",
              entityType: "Order",
              entityId: seedId("order", index),
              metadata: { developmentSeed: true, source },
              createdAt: dateFor(index),
            };
          }),
          ...shipmentOrderIndexes.map((index) => ({
            id: seedId("audit-shipment", index),
            actorUserId: STAFF_ID,
            action:
              statuses[(index - 1) % statuses.length] === OrderStatus.ERROR
                ? "SHIPMENT_SYNC_FAILED"
                : "SHIPMENT_CREATED",
            entityType: "Shipment",
            entityId: seedId("shipment", index),
            metadata: { developmentSeed: true, carrier: "SGS" },
            createdAt: dateFor(index, 2),
          })),
        ],
      });
    },
    { timeout: 30_000 },
  );
}

async function main() {
  await clearExistingSeedData();
  await createSeedData();

  const [users, shops, warehousesCount, methods, orders, addresses, items, shipments, trackingEvents, history, webhooks, audits] =
    await Promise.all([
      prisma.user.count({ where: { id: { startsWith: SEED_PREFIX } } }),
      prisma.shop.count({ where: { id: { startsWith: SEED_PREFIX } } }),
      prisma.warehouse.count({ where: { id: { startsWith: SEED_PREFIX } } }),
      prisma.shippingMethod.count({ where: { id: { startsWith: SEED_PREFIX } } }),
      prisma.order.count({ where: { id: { startsWith: SEED_PREFIX } } }),
      prisma.address.count({ where: { id: { startsWith: SEED_PREFIX } } }),
      prisma.orderItem.count({ where: { id: { startsWith: SEED_PREFIX } } }),
      prisma.shipment.count({ where: { id: { startsWith: SEED_PREFIX } } }),
      prisma.trackingEvent.count({ where: { id: { startsWith: SEED_PREFIX } } }),
      prisma.orderStatusHistory.count({ where: { id: { startsWith: SEED_PREFIX } } }),
      prisma.webhookEvent.count({ where: { id: { startsWith: SEED_PREFIX } } }),
      prisma.auditLog.count({ where: { id: { startsWith: SEED_PREFIX } } }),
    ]);

  console.log("Development seed completed.");
  console.table({
    users,
    shops,
    warehouses: warehousesCount,
    shippingMethods: methods,
    orders,
    addresses,
    orderItems: items,
    shipments,
    trackingEvents,
    orderStatusHistory: history,
    webhookEvents: webhooks,
    auditLogs: audits,
  });
}

main()
  .catch((error: unknown) => {
    console.error("Development seed failed.", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
