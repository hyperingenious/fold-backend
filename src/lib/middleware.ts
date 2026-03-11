import { and, eq, gt } from "drizzle-orm";
import type { Context, Next } from "hono";
import { db } from "../db";
import { session as sessionTable, user as userTable } from "../db/schema";
import { auth } from "./auth";

// Session/User types inferred from Better-Auth
type Session = typeof auth.$Infer.Session.session;
type User = typeof auth.$Infer.Session.user;

// Extended context variables
export type AuthVariables = {
    user: User | null;
    session: Session | null;
};

/**
 * Middleware to attach user and session to the Hono context
 * This makes user/session available in all routes via c.get("user") and c.get("session")
 */
export async function authMiddleware(c: Context, next: Next) {
    const authHeader = c.req.header("Authorization");

    // 1. Try standard Better Auth getSession
    const sessionResult = await auth.api.getSession({
        headers: c.req.raw.headers,
    });

    if (sessionResult) {
        c.set("user", sessionResult.user);
        c.set("session", sessionResult.session);
        await next();
        return;
    }

    // 2. Fallback: Manual DB lookup for Bearer token
    if (authHeader && authHeader.startsWith("Bearer ")) {
        const token = authHeader.split(" ")[1];

        // Find valid session
        const [validSession] = await db
            .select()
            .from(sessionTable)
            .where(
                and(
                    eq(sessionTable.token, token),
                    gt(sessionTable.expiresAt, new Date())
                )
            )
            .limit(1);

        if (validSession) {
            // Find user
            const [user] = await db
                .select()
                .from(userTable)
                .where(eq(userTable.id, validSession.userId))
                .limit(1);

            if (user) {
                // Determine if we need to mock "twoFactorEnabled" if schema differs in types (usually boolean)
                // Better-auth types might be strict, so we cast if needed or just pass the user object
                c.set("user", user as any);
                c.set("session", validSession as any);
                await next();
                return;
            }
        }
    }

    // 3. No session found
    c.set("user", null);
    c.set("session", null);
    await next();
}

/**
 * Middleware that requires authentication
 * Returns 401 if user is not authenticated
 */
export async function requireAuth(c: Context, next: Next) {
    const user = c.get("user");

    if (!user) {
        return c.json(
            {
                success: false,
                error: "Unauthorized",
                message: "Authentication required",
            },
            401
        );
    }

    await next();
}
