import type { Metadata } from "next";
import "./globals.css";
import { auth } from "@/auth";
import { PortalShell } from "@/components/portal/portal-shell";

export const metadata: Metadata = {
  title: "Shipping Portal",
  description: "Shipping Portal application",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await auth();

  return (
    <html lang="en">
      <body>
        {session?.user ? <PortalShell user={session.user}>{children}</PortalShell> : children}
      </body>
    </html>
  );
}
