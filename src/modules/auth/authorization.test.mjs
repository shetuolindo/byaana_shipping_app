import assert from "node:assert/strict";
import test from "node:test";
import {
  assertPortalAccess,
  canAccessSettings,
  UnauthenticatedError,
  UnauthorizedError,
} from "./authorization.ts";

const admin = { id: "admin", name: "Admin", email: "admin@example.test", role: "ADMIN" };
const staff = { id: "staff", name: "Staff", email: "staff@example.test", role: "STAFF" };

test("rejects unauthenticated authorization checks", () => {
  assert.throws(() => assertPortalAccess(null), UnauthenticatedError);
});

test("allows ADMIN operational and settings access", () => {
  assert.equal(assertPortalAccess(admin, "OPERATIONS"), admin);
  assert.equal(assertPortalAccess(admin, "SETTINGS"), admin);
  assert.equal(canAccessSettings("ADMIN"), true);
});

test("allows STAFF operations and rejects STAFF settings access", () => {
  assert.equal(assertPortalAccess(staff, "OPERATIONS"), staff);
  assert.throws(() => assertPortalAccess(staff, "SETTINGS"), UnauthorizedError);
  assert.equal(canAccessSettings("STAFF"), false);
});

test("only ADMIN can pass the authorization used to initiate a Shopify connection", () => {
  assert.equal(assertPortalAccess(admin, "SETTINGS").role, "ADMIN");
  assert.throws(() => assertPortalAccess(staff, "SETTINGS"), UnauthorizedError);
  assert.throws(() => assertPortalAccess(null, "SETTINGS"), UnauthenticatedError);
});
