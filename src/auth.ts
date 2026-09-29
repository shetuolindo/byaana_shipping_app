import NextAuth, { type DefaultSession } from "next-auth";
import type { UserRole } from "@prisma/client";
import Credentials from "next-auth/providers/credentials";
import { authorizeCredentials } from "@/modules/auth/authorize-credentials";

declare module "next-auth" {
  interface User {
    id: string;
    name: string;
    email: string;
    role: UserRole;
  }

  interface Session {
    user: {
      id: string;
      name: string;
      email: string;
      role: UserRole;
    } & DefaultSession["user"];
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    userId: string;
    userName: string;
    userEmail: string;
    userRole: UserRole;
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  pages: { signIn: "/login" },
  session: { strategy: "jwt" },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: authorizeCredentials,
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.userId = user.id;
        token.userName = user.name;
        token.userEmail = user.email;
        token.userRole = user.role;
      }
      return token;
    },
    session({ session, token }) {
      return {
        expires: session.expires,
        user: {
          id: token.userId,
          name: token.userName,
          email: token.userEmail,
          role: token.userRole,
        },
      };
    },
    authorized({ auth: session, request }) {
      const { pathname, search } = request.nextUrl;
      const authenticated = Boolean(session?.user);

      if (pathname === "/login") {
        return authenticated ? Response.redirect(new URL("/", request.nextUrl)) : true;
      }

      if (!authenticated) {
        const loginUrl = new URL("/login", request.nextUrl);
        loginUrl.searchParams.set("callbackUrl", `${pathname}${search}`);
        return Response.redirect(loginUrl);
      }

      if (pathname === "/settings" || pathname.startsWith("/settings/")) {
        return session?.user.role === "ADMIN"
          ? true
          : Response.redirect(new URL("/", request.nextUrl));
      }

      return true;
    },
  },
});
