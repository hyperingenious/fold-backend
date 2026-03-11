import { count, desc, eq, gte, sql } from "drizzle-orm";
import type { Context, Next } from "hono";
import { Hono } from "hono";
import { sign, verify } from "hono/jwt";
import { nanoid } from "nanoid";
import { db } from "../db";
import {
  adminLog,
  apkRelease,
  cmsEntry,
  connection,
  entryMedia,
  featureFlag,
  notificationLog,
  session as sessionTable,
  timelineEntry,
  user,
  userActivity,
  userProfile
} from "../db/schema";
import { publishNotification } from "../lib/ably";

// =============================================================================
// Admin auth helpers
// =============================================================================

const ADMIN_USERNAME = process.env.ADMIN_USERNAME ?? "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "changeme";
const JWT_SECRET = process.env.ADMIN_JWT_SECRET ?? "admin-secret-key-change-me";

async function requireAdmin(c: Context, next: Next) {
    const authHeader = c.req.header("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
        return c.json({ success: false, error: "Unauthorized" }, 401);
    }
    const token = authHeader.slice(7);
    try {
        const payload = await verify(token, JWT_SECRET, "HS256");
        if (!payload) throw new Error();
    } catch (e) {
        return c.json({ success: false, error: "Invalid or expired token" }, 401);
    }
    await next();
}

// Log all admin actions
async function logAction(
    c: Context,
    action: string,
    entity?: string,
    entityId?: string,
    detail?: Record<string, unknown>
) {
    const ip = c.req.header("x-forwarded-for")?.split(",")[0] ?? c.req.header("x-real-ip") ?? "unknown";
    await db.insert(adminLog).values({
        id: nanoid(),
        action,
        entity: entity ?? null,
        entityId: entityId ?? null,
        detail: detail ? JSON.stringify(detail) : null,
        ipAddress: ip,
    });
}

// Helper: date N days ago
function daysAgo(n: number): Date {
    const d = new Date();
    d.setDate(d.getDate() - n);
    d.setHours(0, 0, 0, 0);
    return d;
}

// =============================================================================
// Router
// =============================================================================

export const adminRoutes = new Hono();

// ── Auth ────────────────────────────────────────────────────────────────────

adminRoutes.post("/login", async (c) => {
    const { username, password } = await c.req.json();
    if (username !== ADMIN_USERNAME || password !== ADMIN_PASSWORD) {
        return c.json({ success: false, error: "Invalid credentials" }, 401);
    }
    const token = await sign({ sub: "admin", role: "admin", exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 }, JWT_SECRET, "HS256");
    return c.json({ success: true, data: { token } });
});

adminRoutes.get("/me", requireAdmin, (c) => {
    return c.json({ success: true, data: { role: "admin" } });
});

// ── Overview stats ───────────────────────────────────────────────────────────

adminRoutes.get("/stats/overview", requireAdmin, async (c) => {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOf7Days = daysAgo(7);
    const startOf30Days = daysAgo(30);

    const [totalUsers] = await db.select({ count: count() }).from(user);
    const [newToday] = await db.select({ count: count() }).from(user).where(gte(user.createdAt, startOfToday));
    const [newWeek] = await db.select({ count: count() }).from(user).where(gte(user.createdAt, startOf7Days));
    const [newMonth] = await db.select({ count: count() }).from(user).where(gte(user.createdAt, startOf30Days));

    // Active: users with activity today
    const [activeToday] = await db
        .select({ count: count() })
        .from(userActivity)
        .where(gte(userActivity.date, startOfToday.toISOString().slice(0, 10)));

    const [totalMedia] = await db.select({ count: count() }).from(entryMedia);
    const [totalEntries] = await db.select({ count: count() }).from(timelineEntry);
    const [totalConnections] = await db.select({ count: count() }).from(connection);
    const [activeConnections] = await db
        .select({ count: count() })
        .from(connection)
        .where(eq(connection.status, "active"));

    return c.json({
        success: true,
        data: {
            totalUsers: totalUsers.count,
            newUsersToday: newToday.count,
            newUsersWeek: newWeek.count,
            newUsersMonth: newMonth.count,
            activeUsersToday: activeToday.count,
            totalMediaUploaded: totalMedia.count,
            totalEntries: totalEntries.count,
            totalConnections: totalConnections.count,
            activeConnections: activeConnections.count,
        },
    });
});

// ── User growth (daily signups) ──────────────────────────────────────────────

adminRoutes.get("/analytics/signups", requireAdmin, async (c) => {
    const days = parseInt(c.req.query("days") ?? "30");
    const since = daysAgo(days);

    const rows = await db
        .select({
            date: sql<string>`DATE(${user.createdAt})`,
            count: count(),
        })
        .from(user)
        .where(gte(user.createdAt, since))
        .groupBy(sql`DATE(${user.createdAt})`)
        .orderBy(sql`DATE(${user.createdAt})`);

    return c.json({ success: true, data: rows });
});

// ── Active users per day ─────────────────────────────────────────────────────

adminRoutes.get("/analytics/active", requireAdmin, async (c) => {
    const days = parseInt(c.req.query("days") ?? "30");
    const since = daysAgo(days).toISOString().slice(0, 10);

    const rows = await db
        .select({ date: userActivity.date, count: count() })
        .from(userActivity)
        .where(gte(userActivity.date, since))
        .groupBy(userActivity.date)
        .orderBy(userActivity.date);

    return c.json({ success: true, data: rows });
});

// ── Media analytics ──────────────────────────────────────────────────────────

adminRoutes.get("/analytics/media", requireAdmin, async (c) => {
    const days = parseInt(c.req.query("days") ?? "30");
    const since = daysAgo(days);

    // Uploads by type
    const byType = await db
        .select({ type: entryMedia.type, count: count() })
        .from(entryMedia)
        .groupBy(entryMedia.type);

    // Uploads per day
    const perDay = await db
        .select({
            date: sql<string>`DATE(${timelineEntry.createdAt})`,
            count: count(),
        })
        .from(timelineEntry)
        .where(gte(timelineEntry.createdAt, since))
        .groupBy(sql`DATE(${timelineEntry.createdAt})`)
        .orderBy(sql`DATE(${timelineEntry.createdAt})`);

    // Entry type breakdown
    const entryTypes = await db
        .select({ type: timelineEntry.type, count: count() })
        .from(timelineEntry)
        .groupBy(timelineEntry.type);

    return c.json({ success: true, data: { byType, perDay, entryTypes } });
});

// ── Event analytics ──────────────────────────────────────────────────────────

adminRoutes.get("/analytics/events", requireAdmin, async (c) => {
    const days = parseInt(c.req.query("days") ?? "30");
    const since = daysAgo(days);

    const entriesPerDay = await db
        .select({
            date: sql<string>`DATE(${timelineEntry.createdAt})`,
            count: count(),
        })
        .from(timelineEntry)
        .where(gte(timelineEntry.createdAt, since))
        .groupBy(sql`DATE(${timelineEntry.createdAt})`)
        .orderBy(sql`DATE(${timelineEntry.createdAt})`);

    const connectionsPerDay = await db
        .select({
            date: sql<string>`DATE(${connection.createdAt})`,
            count: count(),
        })
        .from(connection)
        .where(gte(connection.createdAt, since))
        .groupBy(sql`DATE(${connection.createdAt})`)
        .orderBy(sql`DATE(${connection.createdAt})`);

    return c.json({ success: true, data: { entriesPerDay, connectionsPerDay } });
});

// ── Users list ───────────────────────────────────────────────────────────────

adminRoutes.get("/users", requireAdmin, async (c) => {
    const limit = Math.min(100, parseInt(c.req.query("limit") ?? "50"));
    const offset = parseInt(c.req.query("offset") ?? "0");
    const search = c.req.query("search") ?? "";

    const rows = await db
        .select({
            id: user.id,
            name: user.name,
            email: user.email,
            emailVerified: user.emailVerified,
            image: user.image,
            pushToken: user.pushToken,
            createdAt: user.createdAt,
            foldScore: userProfile.foldScore,
            currentStreak: userProfile.currentStreak,
            totalEntries: userProfile.totalEntries,
        })
        .from(user)
        .leftJoin(userProfile, eq(userProfile.userId, user.id))
        .where(
            search
                ? sql`${user.name} ILIKE ${"%" + search + "%"} OR ${user.email} ILIKE ${"%" + search + "%"}`
                : undefined
        )
        .orderBy(desc(user.createdAt))
        .limit(limit)
        .offset(offset);

    const [total] = await db.select({ count: count() }).from(user);
    return c.json({ success: true, data: { users: rows, total: total.count, limit, offset } });
});

// ── User detail ──────────────────────────────────────────────────────────────

adminRoutes.get("/users/:id", requireAdmin, async (c) => {
    const userId = c.req.param("id");

    const [targetUser] = await db.select().from(user).where(eq(user.id, userId)).limit(1);
    if (!targetUser) return c.json({ success: false, error: "User not found" }, 404);

    const [profile] = await db.select().from(userProfile).where(eq(userProfile.userId, userId)).limit(1);

    const recentEntries = await db
        .select()
        .from(timelineEntry)
        .where(eq(timelineEntry.userId, userId))
        .orderBy(desc(timelineEntry.createdAt))
        .limit(10);

    const [entryCount] = await db
        .select({ count: count() })
        .from(timelineEntry)
        .where(eq(timelineEntry.userId, userId));

    return c.json({
        success: true,
        data: { user: targetUser, profile: profile ?? null, recentEntries, entryCount: entryCount.count },
    });
});

// ── User moderation actions ──────────────────────────────────────────────────

adminRoutes.delete("/users/:id", requireAdmin, async (c) => {
    const userId = c.req.param("id");
    await db.delete(user).where(eq(user.id, userId));
    await logAction(c, "user_deleted", "user", userId);
    return c.json({ success: true, message: "User deleted" });
});

adminRoutes.post("/users/:id/force-logout", requireAdmin, async (c) => {
    const userId = c.req.param("id");
    await db.delete(sessionTable).where(eq(sessionTable.userId, userId));
    await logAction(c, "user_force_logout", "user", userId);
    return c.json({ success: true, message: "All sessions revoked" });
});

// ── Notifications ────────────────────────────────────────────────────────────

adminRoutes.post("/notifications/broadcast", requireAdmin, async (c) => {
    const { title, body, audience } = await c.req.json();
    if (!title || !body) return c.json({ success: false, error: "Title and body required" }, 400);

    // Get all users with push tokens
    let query = db.select({ id: user.id, pushToken: user.pushToken }).from(user);
    const users = await query;
    const targets = users.filter((u) => !!u.pushToken);

    // Fire notifications (import publishNotification per user)
    let sent = 0;
    for (const target of targets) {
        try {
            await publishNotification(target.id, { type: "broadcast", title, body, data: {} });
            sent++;
        } catch { /* skip failed */ }
    }

    // Log it
    const logId = nanoid();
    await db.insert(notificationLog).values({ id: logId, title, body, audience: audience ?? "all", sentCount: sent });
    await logAction(c, "notification_sent", "notification", logId, { title, audience, sent });

    return c.json({ success: true, data: { sent } });
});

adminRoutes.get("/notifications/history", requireAdmin, async (c) => {
    const limit = parseInt(c.req.query("limit") ?? "50");
    const rows = await db
        .select()
        .from(notificationLog)
        .orderBy(desc(notificationLog.createdAt))
        .limit(limit);
    return c.json({ success: true, data: rows });
});

// ── CMS ──────────────────────────────────────────────────────────────────────

adminRoutes.get("/cms", requireAdmin, async (c) => {
    const type = c.req.query("type");
    const rows = await db
        .select()
        .from(cmsEntry)
        .where(type ? eq(cmsEntry.type, type) : undefined)
        .orderBy(desc(cmsEntry.updatedAt));
    return c.json({ success: true, data: rows });
});

adminRoutes.get("/cms/:id", requireAdmin, async (c) => {
    const [entry] = await db.select().from(cmsEntry).where(eq(cmsEntry.id, c.req.param("id"))).limit(1);
    if (!entry) return c.json({ success: false, error: "Not found" }, 404);
    return c.json({ success: true, data: entry });
});

adminRoutes.post("/cms", requireAdmin, async (c) => {
    const { slug, type, title, content, isActive } = await c.req.json();
    if (!slug || !type || !title || !content) {
        return c.json({ success: false, error: "slug, type, title, content required" }, 400);
    }
    const id = nanoid();
    const [created] = await db
        .insert(cmsEntry)
        .values({ id, slug, type, title, content, isActive: isActive ?? true })
        .returning();
    await logAction(c, "cms_created", "cms", id, { slug, type });
    return c.json({ success: true, data: created }, 201);
});

adminRoutes.patch("/cms/:id", requireAdmin, async (c) => {
    const id = c.req.param("id");
    const updates = await c.req.json();
    const [updated] = await db
        .update(cmsEntry)
        .set({ ...updates, updatedAt: new Date() })
        .where(eq(cmsEntry.id, id))
        .returning();
    await logAction(c, "cms_updated", "cms", id);
    return c.json({ success: true, data: updated });
});

adminRoutes.delete("/cms/:id", requireAdmin, async (c) => {
    const id = c.req.param("id");
    await db.delete(cmsEntry).where(eq(cmsEntry.id, id));
    await logAction(c, "cms_deleted", "cms", id);
    return c.json({ success: true, message: "Deleted" });
});

// ── Feature Flags ────────────────────────────────────────────────────────────

adminRoutes.get("/flags", requireAdmin, async (c) => {
    const flags = await db.select().from(featureFlag).orderBy(featureFlag.key);
    return c.json({ success: true, data: flags });
});

adminRoutes.post("/flags", requireAdmin, async (c) => {
    const { key, enabled, description } = await c.req.json();
    if (!key) return c.json({ success: false, error: "key required" }, 400);
    const [flag] = await db
        .insert(featureFlag)
        .values({ id: nanoid(), key, enabled: enabled ?? false, description })
        .onConflictDoUpdate({ target: featureFlag.key, set: { enabled, updatedAt: new Date() } })
        .returning();
    await logAction(c, "flag_toggled", "feature_flag", flag.id, { key, enabled });
    return c.json({ success: true, data: flag });
});

// ── System health ────────────────────────────────────────────────────────────

adminRoutes.get("/system/health", requireAdmin, async (c) => {
    const start = Date.now();
    try {
        await db.select({ count: count() }).from(user).limit(1);
        const latency = Date.now() - start;
        return c.json({
            success: true,
            data: {
                status: "healthy",
                dbLatencyMs: latency,
                uptime: process.uptime(),
                nodeVersion: process.version,
                timestamp: new Date().toISOString(),
            },
        });
    } catch {
        return c.json({ success: true, data: { status: "unhealthy", dbLatencyMs: -1 } });
    }
});

// ── Admin logs ───────────────────────────────────────────────────────────────

adminRoutes.get("/logs", requireAdmin, async (c) => {
    const limit = parseInt(c.req.query("limit") ?? "100");
    const offset = parseInt(c.req.query("offset") ?? "0");
    const rows = await db
        .select()
        .from(adminLog)
        .orderBy(desc(adminLog.createdAt))
        .limit(limit)
        .offset(offset);
    const [total] = await db.select({ count: count() }).from(adminLog);
    return c.json({ success: true, data: { logs: rows, total: total.count } });
});

// ── Export ───────────────────────────────────────────────────────────────────

adminRoutes.get("/export/users", requireAdmin, async (c) => {
    const fmt = c.req.query("format") ?? "json";
    const rows = await db
        .select({ id: user.id, name: user.name, email: user.email, createdAt: user.createdAt })
        .from(user)
        .orderBy(desc(user.createdAt));

    if (fmt === "csv") {
        const header = "id,name,email,createdAt\n";
        const csv = rows.map((r) => `${r.id},${r.name},${r.email},${r.createdAt}`).join("\n");
        return new Response(header + csv, {
            headers: {
                "Content-Type": "text/csv",
                "Content-Disposition": "attachment; filename=users.csv",
            },
        });
    }
    return c.json({ success: true, data: rows });
});

adminRoutes.get("/export/logs", requireAdmin, async (c) => {
    const fmt = c.req.query("format") ?? "json";
    const rows = await db.select().from(adminLog).orderBy(desc(adminLog.createdAt)).limit(5000);

    if (fmt === "csv") {
        const header = "id,action,entity,entityId,ipAddress,createdAt\n";
        const csv = rows
            .map((r) => `${r.id},${r.action},${r.entity ?? ""},${r.entityId ?? ""},${r.ipAddress ?? ""},${r.createdAt}`)
            .join("\n");
        return new Response(header + csv, {
            headers: {
                "Content-Type": "text/csv",
                "Content-Disposition": "attachment; filename=logs.csv",
            },
        });
    }
    return c.json({ success: true, data: rows });
});

// =============================================================================
// APK Releases
// =============================================================================

adminRoutes.get("/apk", requireAdmin, async (c) => {
    const releases = await db.select().from(apkRelease).orderBy(desc(apkRelease.createdAt));
    return c.json({ success: true, data: releases });
});

adminRoutes.post("/apk", requireAdmin, async (c) => {
    const body = await c.req.json();
    const { version, url, changeLog, isActive } = body;

    const id = nanoid();
    const [release] = await db.insert(apkRelease).values({
        id,
        version,
        url,
        changeLog,
        isActive: isActive ?? true
    }).returning();

    await logAction(c, "apk_published", "apkRelease", release.id, { version });
    return c.json({ success: true, data: release });
});

adminRoutes.delete("/apk/:id", requireAdmin, async (c) => {
    const id = c.req.param("id");
    const [deleted] = await db.delete(apkRelease).where(eq(apkRelease.id, id)).returning();
    if (!deleted) return c.json({ success: false, error: "Not found" }, 404);

    await logAction(c, "apk_deleted", "apkRelease", id, { version: deleted.version });
    return c.json({ success: true });
});

