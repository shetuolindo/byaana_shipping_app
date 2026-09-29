export { auth as proxy } from "@/auth";

export const config = {
  matcher: ["/", "/login", "/orders/:path*", "/shipments/:path*", "/settings/:path*"],
};
