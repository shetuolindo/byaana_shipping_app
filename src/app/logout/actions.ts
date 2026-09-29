"use server";

import { signOut } from "@/auth";

export async function submitLogout() {
  await signOut({ redirectTo: "/login" });
}
