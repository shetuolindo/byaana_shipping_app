BEGIN;

-- Add the column as nullable so existing rows can be handled deliberately.
ALTER TABLE "User" ADD COLUMN "passwordHash" TEXT;

-- This migration only knows how to backfill the two development seed users.
-- Abort instead of assigning a known or shared password to any other account.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM "User"
        WHERE NOT (
            ("id" = 'dev-seed-user-admin'
                AND "email" = 'admin@shipping-portal.example.test'
                AND "role" = 'ADMIN')
            OR
            ("id" = 'dev-seed-user-staff'
                AND "email" = 'staff@shipping-portal.example.test'
                AND "role" = 'STAFF')
        )
    ) THEN
        RAISE EXCEPTION
            'Cannot require User.passwordHash while non-seed users need a credential enrollment strategy';
    END IF;
END $$;

-- Give existing seed rows unique, unusable bcrypt hashes generated from random,
-- discarded input. The development seed replaces these with hashes for the
-- documented local-only passwords; no plaintext credential appears in SQL.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

UPDATE "User"
SET "passwordHash" = crypt(
    encode(gen_random_bytes(32), 'hex'),
    gen_salt('bf', 12)
)
WHERE "id" IN ('dev-seed-user-admin', 'dev-seed-user-staff');

ALTER TABLE "User" ALTER COLUMN "passwordHash" SET NOT NULL;

COMMIT;
