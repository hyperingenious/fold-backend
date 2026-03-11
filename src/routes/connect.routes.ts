import { and, desc, eq, ilike, ne, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "../db";
import {
    connectMemory,
    connection,
    entryMedia,
    timelineEntry,
    user,
} from "../db/schema";
import { publishNotification } from "../lib/ably";
import { requireAuth, type AuthVariables } from "../lib/middleware";

const connectRoutes = new Hono<{ Variables: AuthVariables }>();

// =============================================================================
// Helpers
// =============================================================================

function generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/** Generate a 6-char uppercase alphanumeric invite code */
function generateInviteCode(): string {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I/1/O/0 for readability
    let code = "";
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

const COOLDOWN_DAYS = parseInt(process.env.CONNECT_COOLDOWN_DAYS || "30", 10);

// =============================================================================
// Validation
// =============================================================================

const requestByCodeSchema = z.object({
    inviteCode: z.string().length(6),
});

const requestByUserSchema = z.object({
    userId: z.string().min(1),
});

const shareMemorySchema = z.object({
    entryId: z.string().min(1),
});

// =============================================================================
// Helper: get active connection for a user (as requester or receiver)
// =============================================================================

async function getActiveConnection(userId: string) {
    const rows = await db
        .select()
        .from(connection)
        .where(
            and(
                eq(connection.status, "active"),
                or(
                    eq(connection.requesterId, userId),
                    eq(connection.receiverId, userId)
                )
            )
        )
        .limit(1);
    return rows[0] ?? null;
}

/** Delete any stale invite-code placeholder rows for the given user IDs */
async function cleanupInvitePlaceholders(...userIds: string[]): Promise<void> {
    for (const userId of userIds) {
        await db.delete(connection).where(
            and(
                eq(connection.requesterId, userId),
                eq(connection.receiverId, userId),
                eq(connection.status, "pending"),
                sql`${connection.inviteCode} IS NOT NULL`
            )
        );
    }
}

/** Check if user is in cooldown (recently ended a connection) */
async function isInCooldown(userId: string): Promise<{ inCooldown: boolean; until: Date | null }> {
    const ended = await db
        .select()
        .from(connection)
        .where(
            and(
                eq(connection.status, "ended"),
                or(
                    eq(connection.requesterId, userId),
                    eq(connection.receiverId, userId)
                )
            )
        )
        .orderBy(desc(connection.endedAt))
        .limit(1);

    if (ended.length === 0) return { inCooldown: false, until: null };

    const cooldownUntil = ended[0].cooldownUntil;
    if (!cooldownUntil) return { inCooldown: false, until: null };

    if (new Date() < new Date(cooldownUntil)) {
        return { inCooldown: true, until: new Date(cooldownUntil) };
    }

    return { inCooldown: false, until: null };
}

// =============================================================================
// CONNECTION MANAGEMENT ROUTES
// =============================================================================

/**
 * GET /status
 * Get current connection status — active connection, pending requests, cooldown info
 */
connectRoutes.get("/status", requireAuth, async (c) => {
    const currentUser = c.get("user");
    if (!currentUser) return c.json({ success: false, error: "User not found" }, 404);

    try {
        // Active connection
        const active = await getActiveConnection(currentUser.id);

        // Pending requests (sent or received)
        // Exclude self-referencing rows used as invite-code placeholders
        // (those have requesterId === receiverId and an inviteCode set)
        const pending = await db
            .select({
                id: connection.id,
                requesterId: connection.requesterId,
                receiverId: connection.receiverId,
                requesterName: user.name,
                requesterImage: user.image,
                createdAt: connection.createdAt,
            })
            .from(connection)
            .innerJoin(user, eq(connection.requesterId, user.id))
            .where(
                and(
                    eq(connection.status, "pending"),
                    or(
                        eq(connection.requesterId, currentUser.id),
                        eq(connection.receiverId, currentUser.id)
                    ),
                    // Exclude invite-code placeholder rows (self-referencing)
                    sql`${connection.requesterId} != ${connection.receiverId}`
                )
            );

        // Cooldown check
        const cooldown = await isInCooldown(currentUser.id);

        // Get partner info if active
        let partner = null;
        if (active) {
            const partnerId =
                active.requesterId === currentUser.id
                    ? active.receiverId
                    : active.requesterId;
            const [partnerUser] = await db
                .select({ id: user.id, name: user.name, image: user.image })
                .from(user)
                .where(eq(user.id, partnerId))
                .limit(1);
            partner = partnerUser ?? null;
        }

        return c.json({
            success: true,
            data: {
                active: active
                    ? { id: active.id, status: active.status, acceptedAt: active.acceptedAt, partner }
                    : null,
                pending: pending.map((p) => ({
                    id: p.id,
                    direction: p.requesterId === currentUser.id ? "sent" : "received",
                    requesterId: p.requesterId,
                    receiverId: p.receiverId,
                    requesterName: p.requesterName,
                    requesterImage: p.requesterImage,
                    createdAt: p.createdAt,
                })),
                cooldown: cooldown.inCooldown ? { until: cooldown.until } : null,
            },
        });
    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : "Failed to get status";
        console.error("Connect status error:", error);
        return c.json({ success: false, error: msg }, 500);
    }
});

/**
 * GET /code
 * Get or generate the current user's invite code
 * Creates a pending self-referencing connection with the code
 */
connectRoutes.get("/code", requireAuth, async (c) => {
    const currentUser = c.get("user");
    if (!currentUser) return c.json({ success: false, error: "User not found" }, 404);

    try {
        // Check for existing active connection
        const active = await getActiveConnection(currentUser.id);
        if (active) {
            return c.json({ success: false, error: "You already have an active connection" }, 400);
        }

        // Check cooldown
        const cooldown = await isInCooldown(currentUser.id);
        if (cooldown.inCooldown) {
            return c.json({
                success: false,
                error: `You're in a cooldown period. You can connect again after ${cooldown.until?.toLocaleDateString()}.`,
            }, 400);
        }

        // Check for existing pending connection with an invite code
        const existing = await db
            .select()
            .from(connection)
            .where(
                and(
                    eq(connection.requesterId, currentUser.id),
                    eq(connection.status, "pending"),
                    sql`${connection.inviteCode} IS NOT NULL`
                )
            )
            .limit(1);

        if (existing.length > 0) {
            return c.json({ success: true, data: { inviteCode: existing[0].inviteCode } });
        }

        // Check if user already has a pending direct request — if so, they can't
        // also generate an invite code (one pending connection at a time)
        const existingDirectRequest = await db
            .select()
            .from(connection)
            .where(
                and(
                    eq(connection.requesterId, currentUser.id),
                    eq(connection.status, "pending"),
                    sql`${connection.inviteCode} IS NULL`
                )
            )
            .limit(1);

        if (existingDirectRequest.length > 0) {
            return c.json({
                success: false,
                error: "You already have a pending connection request. Cancel it first to use an invite code.",
            }, 400);
        }

        // Generate a unique invite code
        let code = generateInviteCode();
        let attempts = 0;
        while (attempts < 10) {
            const dup = await db
                .select()
                .from(connection)
                .where(eq(connection.inviteCode, code))
                .limit(1);
            if (dup.length === 0) break;
            code = generateInviteCode();
            attempts++;
        }

        // Create a pending connection with just the requester (receiver set when code is used)
        const id = generateId();
        await db.insert(connection).values({
            id,
            requesterId: currentUser.id,
            receiverId: currentUser.id, // placeholder — updated when someone joins with the code
            status: "pending",
            inviteCode: code,
        });

        return c.json({ success: true, data: { inviteCode: code } });
    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : "Failed to generate code";
        console.error("Connect code error:", error);
        return c.json({ success: false, error: msg }, 500);
    }
});

/**
 * POST /request/code
 * Send a connection request using an invite code
 */
connectRoutes.post("/request/code", requireAuth, async (c) => {
    const currentUser = c.get("user");
    if (!currentUser) return c.json({ success: false, error: "User not found" }, 404);

    try {
        const body = await c.req.json();
        const parsed = requestByCodeSchema.safeParse(body);
        if (!parsed.success) {
            return c.json({ success: false, error: "Invalid invite code format" }, 400);
        }

        const code = parsed.data.inviteCode.toUpperCase();

        // Check for existing active connection
        const active = await getActiveConnection(currentUser.id);
        if (active) {
            return c.json({ success: false, error: "You already have an active connection" }, 400);
        }

        // Check cooldown
        const cooldown = await isInCooldown(currentUser.id);
        if (cooldown.inCooldown) {
            return c.json({
                success: false,
                error: `Cooldown active until ${cooldown.until?.toLocaleDateString()}`,
            }, 400);
        }

        // Find the pending connection with this invite code
        const [pending] = await db
            .select()
            .from(connection)
            .where(
                and(
                    eq(connection.inviteCode, code),
                    eq(connection.status, "pending")
                )
            )
            .limit(1);

        if (!pending) {
            return c.json({ success: false, error: "Invalid or expired invite code" }, 404);
        }

        // Can't connect to yourself
        if (pending.requesterId === currentUser.id) {
            return c.json({ success: false, error: "You can't use your own invite code" }, 400);
        }

        // Check if the requester already has an active connection
        const requesterActive = await getActiveConnection(pending.requesterId);
        if (requesterActive) {
            return c.json({ success: false, error: "That user already has an active connection" }, 400);
        }

        // Accept immediately — invite code is mutual consent
        const [updated] = await db
            .update(connection)
            .set({
                receiverId: currentUser.id,
                status: "active",
                acceptedAt: new Date(),
                updatedAt: new Date(),
            })
            .where(eq(connection.id, pending.id))
            .returning();

        // Clean up any stale invite-code placeholder for the joiner
        // (the requester's placeholder was the one we just activated — receiverId was updated)
        await cleanupInvitePlaceholders(currentUser.id);

        // Notify the original requester that their invite code was used and connection is now active
        publishNotification(pending.requesterId, {
            type: "connection_accepted",
            title: "Connection Active!",
            body: `${currentUser.name} joined using your invite code`,
            data: { connectionId: updated.id },
        });

        return c.json({ success: true, data: updated });
    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : "Failed to connect";
        console.error("Connect by code error:", error);
        return c.json({ success: false, error: msg }, 500);
    }
});

/**
 * POST /request/user
 * Send a connection request directly to a user (requires acceptance)
 */
connectRoutes.post("/request/user", requireAuth, async (c) => {
    const currentUser = c.get("user");
    if (!currentUser) return c.json({ success: false, error: "User not found" }, 404);

    try {
        const body = await c.req.json();
        const parsed = requestByUserSchema.safeParse(body);
        if (!parsed.success) {
            return c.json({ success: false, error: "User ID required" }, 400);
        }

        const { userId: targetUserId } = parsed.data;

        if (targetUserId === currentUser.id) {
            return c.json({ success: false, error: "You can't connect to yourself" }, 400);
        }

        // Verify target user exists
        const [target] = await db
            .select({ id: user.id })
            .from(user)
            .where(eq(user.id, targetUserId))
            .limit(1);
        if (!target) {
            return c.json({ success: false, error: "User not found" }, 404);
        }

        // Check for existing active connection (either user)
        const myActive = await getActiveConnection(currentUser.id);
        if (myActive) {
            return c.json({ success: false, error: "You already have an active connection" }, 400);
        }

        const theirActive = await getActiveConnection(targetUserId);
        if (theirActive) {
            return c.json({ success: false, error: "That user already has an active connection" }, 400);
        }

        // Check cooldown (either user)
        const myCooldown = await isInCooldown(currentUser.id);
        if (myCooldown.inCooldown) {
            return c.json({
                success: false,
                error: `Cooldown active until ${myCooldown.until?.toLocaleDateString()}`,
            }, 400);
        }

        // Check for existing pending request between these two users
        const existingPending = await db
            .select()
            .from(connection)
            .where(
                and(
                    eq(connection.status, "pending"),
                    or(
                        and(
                            eq(connection.requesterId, currentUser.id),
                            eq(connection.receiverId, targetUserId)
                        ),
                        and(
                            eq(connection.requesterId, targetUserId),
                            eq(connection.receiverId, currentUser.id)
                        )
                    )
                )
            )
            .limit(1);

        if (existingPending.length > 0) {
            return c.json({ success: false, error: "A request already exists between you two" }, 400);
        }

        // Delete any invite-code placeholder rows for this user before creating a
        // direct request — a user can only pursue one pending connection at a time.
        // Placeholder rows are self-referencing (requesterId === receiverId) with an inviteCode.
        await db.delete(connection).where(
            and(
                eq(connection.requesterId, currentUser.id),
                eq(connection.receiverId, currentUser.id),
                eq(connection.status, "pending"),
                sql`${connection.inviteCode} IS NOT NULL`
            )
        );

        const id = generateId();
        const [created] = await db
            .insert(connection)
            .values({
                id,
                requesterId: currentUser.id,
                receiverId: targetUserId,
                status: "pending",
            })
            .returning();

        // Notify the target user they received a connection request
        publishNotification(targetUserId, {
            type: "connection_request",
            title: "New Connection Request",
            body: `${currentUser.name} wants to connect with you`,
            data: { requestId: id, requesterId: currentUser.id },
        });

        return c.json({ success: true, data: created }, 201);
    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : "Failed to send request";
        console.error("Connect request error:", error);
        return c.json({ success: false, error: msg }, 500);
    }
});

/**
 * POST /accept/:id
 * Accept a pending connection request
 */
connectRoutes.post("/accept/:id", requireAuth, async (c) => {
    const currentUser = c.get("user");
    if (!currentUser) return c.json({ success: false, error: "User not found" }, 404);

    const requestId = c.req.param("id");

    try {
        const [pending] = await db
            .select()
            .from(connection)
            .where(
                and(
                    eq(connection.id, requestId),
                    eq(connection.receiverId, currentUser.id),
                    eq(connection.status, "pending")
                )
            )
            .limit(1);

        if (!pending) {
            return c.json({ success: false, error: "Request not found" }, 404);
        }

        // Ensure neither user has an active connection now
        const myActive = await getActiveConnection(currentUser.id);
        if (myActive) {
            return c.json({ success: false, error: "You already have an active connection" }, 400);
        }

        const [updated] = await db
            .update(connection)
            .set({
                status: "active",
                acceptedAt: new Date(),
                updatedAt: new Date(),
            })
            .where(eq(connection.id, requestId))
            .returning();

        // Clean up any stale invite-code placeholders for both parties
        await cleanupInvitePlaceholders(currentUser.id, pending.requesterId);

        // Notify the requester that their connection request was accepted
        publishNotification(pending.requesterId, {
            type: "connection_accepted",
            title: "Connection Accepted!",
            body: `${currentUser.name} accepted your connection request`,
            data: { connectionId: updated.id },
        });

        return c.json({ success: true, data: updated });
    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : "Failed to accept";
        console.error("Connect accept error:", error);
        return c.json({ success: false, error: msg }, 500);
    }
});

/**
 * POST /decline/:id
 * Decline a pending connection request
 */
connectRoutes.post("/decline/:id", requireAuth, async (c) => {
    const currentUser = c.get("user");
    if (!currentUser) return c.json({ success: false, error: "User not found" }, 404);

    const requestId = c.req.param("id");

    try {
        const [pending] = await db
            .select()
            .from(connection)
            .where(
                and(
                    eq(connection.id, requestId),
                    eq(connection.receiverId, currentUser.id),
                    eq(connection.status, "pending")
                )
            )
            .limit(1);

        if (!pending) {
            return c.json({ success: false, error: "Request not found" }, 404);
        }

        await db.delete(connection).where(eq(connection.id, requestId));

        return c.json({ success: true, message: "Request declined" });
    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : "Failed to decline";
        console.error("Connect decline error:", error);
        return c.json({ success: false, error: msg }, 500);
    }
});

/**
 * DELETE /cancel/:id
 * Cancel a pending connection request that the current user sent
 */
connectRoutes.delete("/cancel/:id", requireAuth, async (c) => {
    const currentUser = c.get("user");
    if (!currentUser) return c.json({ success: false, error: "User not found" }, 404);

    const requestId = c.req.param("id");

    try {
        // Only the requester can cancel their own sent request
        const [pending] = await db
            .select()
            .from(connection)
            .where(
                and(
                    eq(connection.id, requestId),
                    eq(connection.requesterId, currentUser.id),
                    eq(connection.status, "pending")
                )
            )
            .limit(1);

        if (!pending) {
            return c.json({ success: false, error: "Request not found or already handled" }, 404);
        }

        await db.delete(connection).where(eq(connection.id, requestId));

        return c.json({ success: true, message: "Request cancelled" });
    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : "Failed to cancel";
        console.error("Connect cancel error:", error);
        return c.json({ success: false, error: msg }, 500);
    }
});

/**
 * POST /end
 * End the current active connection (triggers 30-day cooldown)
 */
connectRoutes.post("/end", requireAuth, async (c) => {
    const currentUser = c.get("user");
    if (!currentUser) return c.json({ success: false, error: "User not found" }, 404);

    try {
        const active = await getActiveConnection(currentUser.id);
        if (!active) {
            return c.json({ success: false, error: "No active connection to end" }, 400);
        }

        const now = new Date();
        const cooldownDate = new Date(now);
        cooldownDate.setDate(cooldownDate.getDate() + COOLDOWN_DAYS);

        await db
            .update(connection)
            .set({
                status: "ended",
                endedAt: now,
                cooldownUntil: cooldownDate,
                updatedAt: now,
            })
            .where(eq(connection.id, active.id));

        // Notify the partner that the connection was ended
        const partnerId =
            active.requesterId === currentUser.id
                ? active.receiverId
                : active.requesterId;
        publishNotification(partnerId, {
            type: "connection_ended",
            title: "Connection Ended",
            body: `${currentUser.name} ended the connection`,
            data: { connectionId: active.id },
        });

        return c.json({
            success: true,
            message: "Connection ended",
            data: { cooldownUntil: cooldownDate },
        });
    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : "Failed to end connection";
        console.error("Connect end error:", error);
        return c.json({ success: false, error: msg }, 500);
    }
});

/**
 * GET /search?q=...
 * Search for users by email (for direct requests)
 */
connectRoutes.get("/search", requireAuth, async (c) => {
    const currentUser = c.get("user");
    if (!currentUser) return c.json({ success: false, error: "User not found" }, 404);

    const query = c.req.query("q");
    if (!query || query.length < 2) {
        return c.json({ success: false, error: "Search query must be at least 2 characters" }, 400);
    }

    try {
        const results = await db
            .select({
                id: user.id,
                name: user.name,
                image: user.image,
            })
            .from(user)
            .where(
                and(
                    ne(user.id, currentUser.id),
                    ilike(user.email, `%${query}%`)
                )
            )
            .limit(20);

        return c.json({ success: true, data: results });
    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : "Search failed";
        console.error("Connect search error:", error);
        return c.json({ success: false, error: msg }, 500);
    }
});

// =============================================================================
// SHARED MEMORY ROUTES
// =============================================================================

/**
 * POST /memories
 * Share a timeline entry to the active connection
 */
connectRoutes.post("/memories", requireAuth, async (c) => {
    const currentUser = c.get("user");
    if (!currentUser) return c.json({ success: false, error: "User not found" }, 404);

    try {
        const body = await c.req.json();
        const parsed = shareMemorySchema.safeParse(body);
        if (!parsed.success) {
            return c.json({ success: false, error: "Entry ID required" }, 400);
        }

        const { entryId } = parsed.data;

        // Must have an active connection
        const active = await getActiveConnection(currentUser.id);
        if (!active) {
            return c.json({ success: false, error: "No active connection" }, 400);
        }

        // Verify entry belongs to current user
        const [entry] = await db
            .select()
            .from(timelineEntry)
            .where(
                and(
                    eq(timelineEntry.id, entryId),
                    eq(timelineEntry.userId, currentUser.id)
                )
            )
            .limit(1);

        if (!entry) {
            return c.json({ success: false, error: "Entry not found" }, 404);
        }

        // Check if already shared
        const existing = await db
            .select()
            .from(connectMemory)
            .where(
                and(
                    eq(connectMemory.connectionId, active.id),
                    eq(connectMemory.entryId, entryId),
                    eq(connectMemory.userId, currentUser.id)
                )
            )
            .limit(1);

        if (existing.length > 0) {
            return c.json({ success: false, error: "Already shared to Connect" }, 400);
        }

        const id = generateId();
        const [created] = await db
            .insert(connectMemory)
            .values({
                id,
                connectionId: active.id,
                userId: currentUser.id,
                entryId,
            })
            .returning();

        // Notify the partner that a memory was shared
        const partnerId =
            active.requesterId === currentUser.id
                ? active.receiverId
                : active.requesterId;
        publishNotification(partnerId, {
            type: "memory_shared",
            title: "New Shared Memory",
            body: `${currentUser.name} shared a memory with you`,
            data: { memoryId: id, entryId },
        });

        return c.json({ success: true, data: created }, 201);
    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : "Failed to share memory";
        console.error("Connect share memory error:", error);
        return c.json({ success: false, error: msg }, 500);
    }
});

/**
 * DELETE /memories/:entryId
 * Remove an entry from the shared connection timeline
 */
connectRoutes.delete("/memories/:entryId", requireAuth, async (c) => {
    const currentUser = c.get("user");
    if (!currentUser) return c.json({ success: false, error: "User not found" }, 404);

    const entryId = c.req.param("entryId");

    try {
        const active = await getActiveConnection(currentUser.id);
        if (!active) {
            return c.json({ success: false, error: "No active connection" }, 400);
        }

        const [existing] = await db
            .select()
            .from(connectMemory)
            .where(
                and(
                    eq(connectMemory.connectionId, active.id),
                    eq(connectMemory.entryId, entryId),
                    eq(connectMemory.userId, currentUser.id)
                )
            )
            .limit(1);

        if (!existing) {
            return c.json({ success: false, error: "Shared memory not found" }, 404);
        }

        await db.delete(connectMemory).where(eq(connectMemory.id, existing.id));

        return c.json({ success: true, message: "Memory removed from Connect" });
    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : "Failed to remove memory";
        console.error("Connect remove memory error:", error);
        return c.json({ success: false, error: msg }, 500);
    }
});

/**
 * GET /memories
 * Get the shared timeline — both users' entries, merged by date
 * Supports cursor-based pagination: ?cursor=<timestamp>&limit=20
 */
connectRoutes.get("/memories", requireAuth, async (c) => {
    const currentUser = c.get("user");
    if (!currentUser) return c.json({ success: false, error: "User not found" }, 404);

    try {
        const active = await getActiveConnection(currentUser.id);
        if (!active) {
            return c.json({ success: false, error: "No active connection" }, 400);
        }

        const cursor = c.req.query("cursor"); // ISO timestamp
        const limit = Math.min(parseInt(c.req.query("limit") || "20"), 50);

        const partnerId =
            active.requesterId === currentUser.id
                ? active.receiverId
                : active.requesterId;

        // Build query — entries shared by both users in this connection
        let whereClause = eq(connectMemory.connectionId, active.id);

        const cursorCondition = cursor
            ? sql`${connectMemory.createdAt} < ${new Date(cursor)}`
            : undefined;

        const finalWhere = cursorCondition
            ? and(whereClause, cursorCondition)
            : whereClause;

        const memories = await db
            .select({
                // Connect memory fields
                memoryId: connectMemory.id,
                sharedBy: connectMemory.userId,
                sharedAt: connectMemory.createdAt,
                // Entry fields
                entryId: timelineEntry.id,
                entryType: timelineEntry.type,
                entryMood: timelineEntry.mood,
                entryCaption: timelineEntry.caption,
                entryContent: timelineEntry.content,
                entryTitle: timelineEntry.title,
                entryStoryContent: timelineEntry.storyContent,
                entryPageCount: timelineEntry.pageCount,
                entryCreatedAt: timelineEntry.createdAt,
                // User info
                userName: user.name,
                userImage: user.image,
            })
            .from(connectMemory)
            .innerJoin(timelineEntry, eq(connectMemory.entryId, timelineEntry.id))
            .innerJoin(user, eq(connectMemory.userId, user.id))
            .where(finalWhere)
            .orderBy(desc(connectMemory.createdAt))
            .limit(limit + 1); // +1 to check if there's more

        const hasMore = memories.length > limit;
        const items = hasMore ? memories.slice(0, limit) : memories;

        // Fetch media for all entries in one query
        const entryIds = items.map((m) => m.entryId);
        const allMedia =
            entryIds.length > 0
                ? await db
                      .select()
                      .from(entryMedia)
                      .where(sql`${entryMedia.entryId} IN (${sql.join(entryIds.map(id => sql`${id}`), sql`, `)})`)
                      .orderBy(entryMedia.sortOrder)
                : [];

        // Group media by entryId
        const mediaMap = new Map<string, typeof allMedia>();
        for (const m of allMedia) {
            const arr = mediaMap.get(m.entryId) || [];
            arr.push(m);
            mediaMap.set(m.entryId, arr);
        }

        const result = items.map((m) => ({
            id: m.memoryId,
            side: m.sharedBy === currentUser.id ? "mine" : "theirs",
            sharedBy: m.sharedBy,
            sharedAt: m.sharedAt,
            user: { name: m.userName, image: m.userImage },
            entry: {
                id: m.entryId,
                type: m.entryType,
                mood: m.entryMood,
                caption: m.entryCaption,
                content: m.entryContent,
                title: m.entryTitle,
                storyContent: m.entryStoryContent,
                pageCount: m.entryPageCount,
                createdAt: m.entryCreatedAt,
                media: (mediaMap.get(m.entryId) || []).map((med) => ({
                    id: med.id,
                    uri: med.uri,
                    type: med.type,
                    thumbnailUri: med.thumbnailUri,
                    duration: med.duration,
                })),
            },
        }));

        const nextCursor = hasMore
            ? items[items.length - 1].sharedAt?.toISOString()
            : null;

        return c.json({
            success: true,
            data: {
                memories: result,
                nextCursor,
                partner: { id: partnerId },
            },
        });
    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : "Failed to fetch memories";
        console.error("Connect memories error:", error);
        return c.json({ success: false, error: msg }, 500);
    }
});

export { connectRoutes };
