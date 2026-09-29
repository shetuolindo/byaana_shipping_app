BEGIN;

ALTER TABLE "Order" ADD COLUMN "orderNumber" TEXT;

-- Keep the table stable while deterministic, unique identifiers are assigned.
LOCK TABLE "Order" IN ACCESS EXCLUSIVE MODE;

DO $$
DECLARE
    order_record RECORD;
    base_number TEXT;
    candidate_number TEXT;
    development_number INTEGER := 1001;
    duplicate_suffix INTEGER;
BEGIN
    FOR order_record IN
        SELECT "id", "source", "shopifyOrderNumber"
        FROM "Order"
        ORDER BY "createdAt", "id"
    LOOP
        IF order_record."source" = 'SHOPIFY'
           AND NULLIF(BTRIM(order_record."shopifyOrderNumber"), '') IS NOT NULL THEN
            base_number := BTRIM(order_record."shopifyOrderNumber");
        ELSE
            base_number := 'DEV-' || LPAD(development_number::TEXT, 4, '0');
            development_number := development_number + 1;
        END IF;

        candidate_number := base_number;
        duplicate_suffix := 2;

        WHILE EXISTS (
            SELECT 1
            FROM "Order"
            WHERE "orderNumber" = candidate_number
        ) LOOP
            candidate_number := base_number || '-' || duplicate_suffix::TEXT;
            duplicate_suffix := duplicate_suffix + 1;
        END LOOP;

        UPDATE "Order"
        SET "orderNumber" = candidate_number
        WHERE "id" = order_record."id";
    END LOOP;
END $$;

ALTER TABLE "Order" ALTER COLUMN "orderNumber" SET NOT NULL;

CREATE UNIQUE INDEX "Order_orderNumber_key" ON "Order"("orderNumber");

COMMIT;
