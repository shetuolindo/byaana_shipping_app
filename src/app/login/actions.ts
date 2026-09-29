"use server";

import { AuthError } from "next-auth";
import { signIn } from "@/auth";
import { safePortalRedirect } from "@/modules/auth/auth-input";
import type { LoginActionState } from "@/modules/auth/login-state";

export async function submitLogin(
  _previousState: LoginActionState,
  formData: FormData,
): Promise<LoginActionState> {
  const email = formData.get("email");
  const password = formData.get("password");

  try {
    await signIn("credentials", {
      email,
      password,
      redirectTo: safePortalRedirect(formData.get("callbackUrl")),
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return {
        status: "error",
        message: error.type === "CredentialsSignin"
          ? "The email or password is incorrect."
          : "Sign in is unavailable right now. Please try again.",
      };
    }
    throw error;
  }

  return { status: "idle" };
}
