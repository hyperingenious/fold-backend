import { and, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "../db";
import { entryMedia, share, timelineEntry } from "../db/schema";
import { requireAuth, type AuthVariables } from "../lib/middleware";

const sharesRoutes = new Hono<{ Variables: AuthVariables }>();

// =============================================================================
// Helpers
// =============================================================================

function generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/** Generate a short URL-safe token for public share links */
function generateShareToken(): string {
    const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
    let token = "";
    for (let i = 0; i < 10; i++) {
        token += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return token;
}

// =============================================================================
// Validation
// =============================================================================

const createShareSchema = z.object({
    entryId: z.string().min(1),
    expiresAt: z.string().datetime().optional().nullable(),
});

const updateShareSchema = z.object({
    status: z.enum(["active", "paused"]),
});

// =============================================================================
// Routes
// =============================================================================

/**
 * POST /
 * Create a share link for an entry
 */
sharesRoutes.post("/", requireAuth, async (c) => {
    const currentUser = c.get("user");
    if (!currentUser) {
        return c.json({ success: false, error: "User not found" }, 404);
    }

    try {
        const body = await c.req.json();
        const parsed = createShareSchema.safeParse(body);

        if (!parsed.success) {
            return c.json(
                {
                    success: false,
                    error: "Validation failed",
                    details: parsed.error.flatten(),
                },
                400
            );
        }

        const { entryId, expiresAt } = parsed.data;

        // Verify the entry belongs to the current user
        const entries = await db
            .select()
            .from(timelineEntry)
            .where(
                and(
                    eq(timelineEntry.id, entryId),
                    eq(timelineEntry.userId, currentUser.id)
                )
            )
            .limit(1);

        if (entries.length === 0) {
            return c.json(
                { success: false, error: "Entry not found" },
                404
            );
        }

        // Check if a share already exists for this entry
        const existingShares = await db
            .select()
            .from(share)
            .where(
                and(
                    eq(share.entryId, entryId),
                    eq(share.userId, currentUser.id)
                )
            )
            .limit(1);

        if (existingShares.length > 0) {
            // Return existing share instead of creating duplicate
            return c.json({
                success: true,
                data: existingShares[0],
            });
        }

        // Generate unique token (retry if collision)
        let token = generateShareToken();
        let attempts = 0;
        while (attempts < 5) {
            const existing = await db
                .select()
                .from(share)
                .where(eq(share.token, token))
                .limit(1);
            if (existing.length === 0) break;
            token = generateShareToken();
            attempts++;
        }

        const shareId = generateId();
        const [created] = await db
            .insert(share)
            .values({
                id: shareId,
                entryId,
                userId: currentUser.id,
                token,
                status: "active",
                viewCount: 0,
                expiresAt: expiresAt ? new Date(expiresAt) : null,
            })
            .returning();

        return c.json({ success: true, data: created }, 201);
    } catch (error: unknown) {
        const msg =
            error instanceof Error ? error.message : "Failed to create share";
        console.error("Create share error:", error);
        return c.json({ success: false, error: msg }, 500);
    }
});

/**
 * GET /
 * List all shares for the current user (with entry preview data)
 */
sharesRoutes.get("/", requireAuth, async (c) => {
    const currentUser = c.get("user");
    if (!currentUser) {
        return c.json({ success: false, error: "User not found" }, 404);
    }

    try {
        const shares = await db
            .select({
                id: share.id,
                entryId: share.entryId,
                userId: share.userId,
                token: share.token,
                status: share.status,
                viewCount: share.viewCount,
                expiresAt: share.expiresAt,
                createdAt: share.createdAt,
                updatedAt: share.updatedAt,
                // Entry preview fields
                entryType: timelineEntry.type,
                entryMood: timelineEntry.mood,
                entryCaption: timelineEntry.caption,
                entryContent: timelineEntry.content,
                entryTitle: timelineEntry.title,
                entryCreatedAt: timelineEntry.createdAt,
            })
            .from(share)
            .innerJoin(timelineEntry, eq(share.entryId, timelineEntry.id))
            .where(eq(share.userId, currentUser.id))
            .orderBy(sql`${share.createdAt} DESC`);

        return c.json({ success: true, data: shares });
    } catch (error: unknown) {
        const msg =
            error instanceof Error ? error.message : "Failed to list shares";
        console.error("List shares error:", error);
        return c.json({ success: false, error: msg }, 500);
    }
});

/**
 * PATCH /:id
 * Update share status (active/paused)
 */
sharesRoutes.patch("/:id", requireAuth, async (c) => {
    const currentUser = c.get("user");
    if (!currentUser) {
        return c.json({ success: false, error: "User not found" }, 404);
    }

    const shareId = c.req.param("id");

    try {
        // Verify ownership
        const existing = await db
            .select()
            .from(share)
            .where(
                and(
                    eq(share.id, shareId),
                    eq(share.userId, currentUser.id)
                )
            )
            .limit(1);

        if (existing.length === 0) {
            return c.json(
                { success: false, error: "Share not found" },
                404
            );
        }

        const body = await c.req.json();
        const parsed = updateShareSchema.safeParse(body);

        if (!parsed.success) {
            return c.json(
                {
                    success: false,
                    error: "Validation failed",
                    details: parsed.error.flatten(),
                },
                400
            );
        }

        const [updated] = await db
            .update(share)
            .set({
                status: parsed.data.status,
                updatedAt: new Date(),
            })
            .where(eq(share.id, shareId))
            .returning();

        return c.json({
            success: true,
            message: "Share updated",
            data: updated,
        });
    } catch (error: unknown) {
        const msg =
            error instanceof Error ? error.message : "Failed to update share";
        console.error("Update share error:", error);
        return c.json({ success: false, error: msg }, 500);
    }
});

/**
 * DELETE /:id
 * Delete a share permanently
 */
sharesRoutes.delete("/:id", requireAuth, async (c) => {
    const currentUser = c.get("user");
    if (!currentUser) {
        return c.json({ success: false, error: "User not found" }, 404);
    }

    const shareId = c.req.param("id");

    try {
        // Verify ownership
        const existing = await db
            .select()
            .from(share)
            .where(
                and(
                    eq(share.id, shareId),
                    eq(share.userId, currentUser.id)
                )
            )
            .limit(1);

        if (existing.length === 0) {
            return c.json(
                { success: false, error: "Share not found" },
                404
            );
        }

        await db.delete(share).where(eq(share.id, shareId));

        return c.json({ success: true, message: "Share deleted" });
    } catch (error: unknown) {
        const msg =
            error instanceof Error ? error.message : "Failed to delete share";
        console.error("Delete share error:", error);
        return c.json({ success: false, error: msg }, 500);
    }
});

/**
 * GET /public/:token
 * Public endpoint — no auth required
 * Returns the shared entry data and increments view count
 */
sharesRoutes.get("/public/:token", async (c) => {
    const token = c.req.param("token");

    try {
        // Find the share by token
        const shares = await db
            .select()
            .from(share)
            .where(eq(share.token, token))
            .limit(1);

        if (shares.length === 0) {
            return c.json(
                { success: false, error: "Share not found" },
                404
            );
        }

        const shareRecord = shares[0];

        // Check if paused
        if (shareRecord.status === "paused") {
            return c.json(
                { success: false, error: "This share is currently unavailable" },
                404
            );
        }

        // Check if expired
        if (shareRecord.expiresAt && new Date(shareRecord.expiresAt) < new Date()) {
            return c.json(
                { success: false, error: "This share has expired" },
                410
            );
        }

        // Increment view count
        await db
            .update(share)
            .set({
                viewCount: sql`${share.viewCount} + 1`,
            })
            .where(eq(share.id, shareRecord.id));

        // Fetch entry data
        const entries = await db
            .select()
            .from(timelineEntry)
            .where(eq(timelineEntry.id, shareRecord.entryId))
            .limit(1);

        if (entries.length === 0) {
            return c.json(
                { success: false, error: "Entry not found" },
                404
            );
        }

        const entry = entries[0];

        // Fetch media for the entry
        const media = await db
            .select()
            .from(entryMedia)
            .where(eq(entryMedia.entryId, entry.id))
            .orderBy(entryMedia.sortOrder);

        return c.json({
            success: true,
            data: {
                entry: {
                    type: entry.type,
                    mood: entry.mood,
                    caption: entry.caption,
                    content: entry.content,
                    title: entry.title,
                    storyContent: entry.storyContent,
                    pageCount: entry.pageCount,
                    createdAt: entry.createdAt,
                    media: media.map((m) => ({
                        id: m.id,
                        uri: m.uri,
                        type: m.type,
                        thumbnailUri: m.thumbnailUri,
                        duration: m.duration,
                        sortOrder: m.sortOrder,
                    })),
                },
                sharedAt: shareRecord.createdAt,
                viewCount: shareRecord.viewCount + 1,
            },
        });
    } catch (error: unknown) {
        const msg =
            error instanceof Error ? error.message : "Failed to fetch shared entry";
        console.error("Public share error:", error);
        return c.json({ success: false, error: msg }, 500);
    }
});

export { sharesRoutes };
