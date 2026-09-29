"use client";

import type { Session } from "next-auth";
import { useState } from "react";
import { usePathname } from "next/navigation";
import { PortalHeader } from "./portal-header";
import { Sidebar } from "./sidebar";

export function PortalShell({ children, user }: { children: React.ReactNode; user: Session["user"] }) {
  const pathname = usePathname();
  const [openPath, setOpenPath] = useState<string | null>(null);
  const menuOpen = openPath === pathname;

  return (
    <div className="min-h-dvh bg-slate-50 text-slate-900 lg:pl-64">
      <a href="#main-content" className="sr-only fixed left-4 top-4 z-50 rounded-md bg-white px-4 py-3 shadow focus:not-sr-only">Skip to content</a>
      <PortalHeader pathname={pathname} menuOpen={menuOpen} onToggleMenu={() => setOpenPath(menuOpen ? null : pathname)} user={user} />
      <aside id="portal-navigation" className={`${menuOpen ? "block" : "hidden"} border-b border-slate-200 bg-white lg:fixed lg:inset-y-0 lg:left-0 lg:block lg:w-64 lg:overflow-y-auto lg:border-r lg:border-b-0`}>
        <Sidebar pathname={pathname} onNavigate={() => setOpenPath(null)} role={user.role} />
      </aside>
      <main id="main-content" tabIndex={-1} className="w-full px-4 py-8 sm:px-8 sm:py-10">{children}</main>
    </div>
  );
}
