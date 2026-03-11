import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db";
import { user } from "../db/schema";
import { publishNotification } from "../lib/ably";
import { requireAuth, type AuthVariables } from "../lib/middleware";

export const configRoutes = new Hono<{ Variables: AuthVariables }>();

/**
 * GET /api/config/storage
 * Returns Appwrite storage configuration for direct client uploads.
 * Requires authentication.
 */
configRoutes.get("/storage", requireAuth, async (c) => {
    return c.json({
        success: true,
        data: {
            endpoint: process.env.APPWRITE_ENDPOINT || "https://cloud.appwrite.io/v1",
            projectId: process.env.APPWRITE_PROJECT_ID || "",
            bucketId: process.env.APPWRITE_BUCKET_ID || "",
        },
    });
});

/**
 * GET /api/config/app
 * Returns app-level configuration values (cooldown period, etc.)
 * Public — no auth required, values are not sensitive.
 */
configRoutes.get("/app", async (c) => {
    const cooldownDays = parseInt(process.env.CONNECT_COOLDOWN_DAYS || "30", 10);
    return c.json({
        success: true,
        data: {
            cooldownDays,
        },
    });
});

/**
 * POST /api/config/test-notification
 * Send a test push notification to yourself. For development/testing only.
 */
configRoutes.post("/test-notification", requireAuth, async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ success: false, error: "User not found" }, 404);

    const types = [
        { type: "connection_request", title: "New Connection Request", body: "Someone wants to connect with you" },
        { type: "connection_accepted", title: "Connection Accepted!", body: "Your connection request was accepted" },
        { type: "memory_shared", title: "New Shared Memory", body: "Someone shared a memory with you" },
        { type: "connection_ended", title: "Connection Ended", body: "A connection was ended" },
    ];

    const n = types[Math.floor(Math.random() * types.length)];

    await publishNotification(user.id, {
        type: n.type,
        title: n.title,
        body: n.body,
        data: { test: true },
    });

    return c.json({ success: true, message: `Test notification sent: ${n.type}` });
});

/**
 * POST /api/config/push-token
 * Register or update the user's Expo push token for native notifications.
 * Body: { pushToken: "ExponentPushToken[...]" }
 */
configRoutes.post("/push-token", requireAuth, async (c) => {
    const currentUser = c.get("user");
    if (!currentUser) return c.json({ success: false, error: "User not found" }, 404);

    try {
        const body = await c.req.json();
        const { pushToken } = body;

        if (!pushToken || typeof pushToken !== "string") {
            return c.json({ success: false, error: "pushToken is required" }, 400);
        }

        if (!pushToken.startsWith("ExponentPushToken[") && !pushToken.startsWith("ExpoPushToken[")) {
            return c.json({ success: false, error: "Invalid push token format" }, 400);
        }

        await db
            .update(user)
            .set({ pushToken, updatedAt: new Date() })
            .where(eq(user.id, currentUser.id));

        console.log(`[Push] Token registered for user ${currentUser.id}`);
        return c.json({ success: true, message: "Push token registered" });
    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : "Failed to register token";
        console.error("[Push] Token registration error:", error);
        return c.json({ success: false, error: msg }, 500);
    }
});
