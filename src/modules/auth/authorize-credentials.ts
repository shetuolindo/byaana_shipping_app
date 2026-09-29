import "server-only";

import { compare } from "bcryptjs";
import prisma from "@/lib/prisma";
import { validateCredentials } from "./auth-input";

export async function authorizeCredentials(input: unknown) {
  const credentials = validateCredentials(input);
  if (!credentials) return null;

  const user = await prisma.user.findUnique({
    where: { email: credentials.email },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      passwordHash: true,
    },
  });

  if (!user || !(await compare(credentials.password, user.passwordHash))) return null;

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
  };
}
