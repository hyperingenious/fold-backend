import { desc, eq } from "drizzle-orm";
import type { Context } from "hono";
import { Hono } from "hono";
import { db } from "../db";
import { apkRelease } from "../db/schema";

export const apkRoutes = new Hono();

// GET /api/public/apk/latest
// Returns the newest active APK release
apkRoutes.get("/latest", async (c: Context) => {
    try {
        const releases = await db
            .select()
            .from(apkRelease)
            .where(eq(apkRelease.isActive, true))
            .orderBy(desc(apkRelease.createdAt))
            .limit(1);

        if (releases.length === 0) {
            return c.json({ success: false, error: "No active APK release found" }, 404);
        }

        return c.json({ success: true, data: releases[0] });
    } catch (error) {
        console.error("Fetch latest APK failed:", error);
        return c.json({ success: false, error: "Internal server error" }, 500);
    }
});
