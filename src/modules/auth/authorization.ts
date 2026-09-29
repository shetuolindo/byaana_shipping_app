import type { UserRole } from "@prisma/client";

export type PortalUser = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
};

export type PortalPermission = "OPERATIONS" | "SETTINGS";

export class UnauthenticatedError extends Error {
  constructor() {
    super("Authentication is required.");
    this.name = "UnauthenticatedError";
  }
}

export class UnauthorizedError extends Error {
  constructor() {
    super("You do not have permission to perform this action.");
    this.name = "UnauthorizedError";
  }
}

export function assertPortalAccess(
  user: PortalUser | null | undefined,
  permission: PortalPermission = "OPERATIONS",
): PortalUser {
  if (!user) throw new UnauthenticatedError();
  if (permission === "SETTINGS" && user.role !== "ADMIN") throw new UnauthorizedError();
  return user;
}

export function canAccessSettings(role: UserRole) {
  return role === "ADMIN";
}
