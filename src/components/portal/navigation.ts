export const navigationItems = [
  { href: "/", label: "Dashboard", icon: "dashboard" },
  { href: "/orders", label: "Orders", icon: "orders" },
  { href: "/orders/new", label: "Manual Order", icon: "manual" },
  { href: "/shipments", label: "Shipments", icon: "shipments" },
  { href: "/settings", label: "Settings", icon: "settings" },
] as const;

export function getCurrentPage(pathname: string) {
  return [...navigationItems].reverse().find(({ href }) =>
    pathname === href || (href !== "/" && pathname.startsWith(`${href}/`)),
  );
}
