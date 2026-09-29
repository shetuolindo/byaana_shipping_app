import type { UserRole } from "@prisma/client";
import Link from "next/link";
import { ClipboardList, FilePlus2, LayoutDashboard, Package, Settings, Truck } from "lucide-react";
import { canAccessSettings } from "@/modules/auth/authorization";
import { getCurrentPage, navigationItems } from "./navigation";

const icons = { dashboard: LayoutDashboard, orders: ClipboardList, manual: FilePlus2, shipments: Truck, settings: Settings };

export function Sidebar({ pathname, onNavigate, role }: { pathname: string; onNavigate: () => void; role: UserRole }) {
  const currentPage = getCurrentPage(pathname);

  function renderLink(item: (typeof navigationItems)[number]) {
    const Icon = icons[item.icon];
    const active = currentPage?.href === item.href;
    const parent = item.href === "/orders" && pathname.startsWith("/orders/") && !active;
    return (
      <li key={item.href}>
        <Link href={item.href} onClick={onNavigate} aria-current={active ? "page" : undefined}
          className={`flex min-h-11 items-center gap-3 rounded-md px-3 text-sm ${active ? "bg-slate-900 font-medium text-white" : parent ? "bg-slate-100 font-medium text-slate-900" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"}`}>
          <Icon size={18} strokeWidth={1.75} aria-hidden="true" />
          {item.label}
        </Link>
      </li>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <Link href="/" onClick={onNavigate} className="hidden h-20 items-center gap-3 border-b border-slate-200 px-6 lg:flex">
        <span className="rounded-lg bg-slate-900 p-2 text-white"><Package size={20} aria-hidden="true" /></span>
        <span className="text-sm font-semibold tracking-tight">Shipping Portal</span>
      </Link>
      <nav aria-label="Main navigation" className="flex-1 px-4 py-6">
        <p className="mb-3 px-3 text-xs font-semibold tracking-wider text-slate-500">WORKSPACE</p>
        <ul className="space-y-1">{navigationItems.filter(item => item.href !== "/settings").map(renderLink)}</ul>
        {canAccessSettings(role) && (
          <div className="mt-8 border-t border-slate-200 pt-6">
            <p className="mb-3 px-3 text-xs font-semibold tracking-wider text-slate-500">ADMINISTRATION</p>
            <ul>{navigationItems.filter(item => item.href === "/settings").map(renderLink)}</ul>
          </div>
        )}
      </nav>
    </div>
  );
}
