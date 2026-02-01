import type { Context, Next } from "hono";
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
    const session = await auth.api.getSession({ headers: c.req.raw.headers });

    if (!session) {
        c.set("user", null);
        c.set("session", null);
        await next();
        return;
    }

    c.set("user", session.user);
    c.set("session", session.session);
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
