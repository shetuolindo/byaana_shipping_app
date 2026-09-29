import { z } from "zod";

const credentialsSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(1024),
});

export type ValidatedCredentials = z.infer<typeof credentialsSchema>;

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function validateCredentials(input: unknown): ValidatedCredentials | null {
  const result = credentialsSchema.safeParse(input);

  if (!result.success) return null;

  return {
    email: normalizeEmail(result.data.email),
    password: result.data.password,
  };
}

export function safePortalRedirect(value: unknown) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return "/";

  try {
    const url = new URL(value, "https://shipping-portal.invalid");
    if (url.origin !== "https://shipping-portal.invalid" || url.username || url.password) return "/";

    const path = `${url.pathname}${url.search}${url.hash}`;
    const isPortalPath = path === "/"
      || path.startsWith("/orders")
      || path.startsWith("/shipments")
      || path.startsWith("/settings");

    return isPortalPath ? path : "/";
  } catch {
    return "/";
  }
}
