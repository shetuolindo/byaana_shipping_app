import "server-only";

import { auth } from "@/auth";
import { assertPortalAccess, type PortalPermission } from "./authorization";

export async function requirePortalUser(permission: PortalPermission = "OPERATIONS") {
  const session = await auth();
  return assertPortalAccess(session?.user, permission);
}
