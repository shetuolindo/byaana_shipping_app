import type { Session } from "next-auth";
import Link from "next/link";
import { ChevronRight, LogOut, Menu, X } from "lucide-react";
import { submitLogout } from "@/app/logout/actions";
import { getCurrentPage } from "./navigation";

export function PortalHeader({ pathname, menuOpen, onToggleMenu, user }: {
  pathname: string;
  menuOpen: boolean;
  onToggleMenu: () => void;
  user: Session["user"];
}) {
  const currentPage = getCurrentPage(pathname);
  const initials = user.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "U";

  return (
    <header className="flex min-h-20 items-center justify-between gap-4 border-b border-slate-200 bg-white px-4 sm:px-8">
      <div className="flex min-w-0 items-center gap-3">
        <button type="button" onClick={onToggleMenu} aria-expanded={menuOpen} aria-controls="portal-navigation" aria-label={menuOpen ? "Close navigation" : "Open navigation"} className="flex size-11 shrink-0 items-center justify-center rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50 lg:hidden">
          {menuOpen ? <X size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}
        </button>
        <div className="min-w-0">
          <p className="mb-1 text-xs font-medium text-slate-500 lg:hidden">Shipping Portal</p>
          <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-2 text-sm font-medium">
            {currentPage?.href === "/orders/new" && <><Link href="/orders" className="text-slate-500 hover:text-slate-900">Orders</Link><ChevronRight size={14} aria-hidden="true" /></>}
            <span aria-current="page">{currentPage?.label ?? "Shipping Portal"}</span>
          </nav>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <span aria-hidden="true" className="hidden size-9 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600 sm:flex">{initials}</span>
        <div className="hidden sm:block"><p className="text-sm font-medium">{user.name}</p><p className="mt-0.5 text-xs text-slate-500">{user.role}</p></div>
        <form action={submitLogout}>
          <button type="submit" className="inline-flex min-h-10 items-center gap-2 rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900">
            <LogOut aria-hidden="true" size={16} />
            <span className="hidden sm:inline">Logout</span>
          </button>
        </form>
      </div>
    </header>
  );
}
