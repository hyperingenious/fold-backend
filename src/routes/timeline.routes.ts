import { and, asc, desc, eq, ne, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "../db";
import {
    entryMedia,
    timelineEntry,
    userActivity,
    userBadge,
    userProfile,
} from "../db/schema";
import { requireAuth, type AuthVariables } from "../lib/middleware";

const timelineRoutes = new Hono<{ Variables: AuthVariables }>();

// =============================================================================
// Helpers
// =============================================================================

function generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

function todayDateString(): string {
    return new Date().toISOString().split("T")[0];
}

function yesterdayDateString(): string {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().split("T")[0];
}

function computeActivityLevel(entryCount: number): number {
    if (entryCount === 0) return 0;
    if (entryCount === 1) return 1;
    if (entryCount <= 3) return 2;
    return 3;
}

function computeFoldScore(
    currentStreak: number,
    totalEntries: number,
    longestStreak: number
): number {
    return Math.min(
        999,
        currentStreak * 15 + totalEntries * 5 + longestStreak * 10
    );
}

const BADGE_DEFINITIONS = [
    { type: "early-bird", check: (p: any) => p.totalEntries >= 1 },
    { type: "the-voice", check: (p: any) => p.totalAudioMinutes >= 10 },
    { type: "on-fire", check: (p: any) => p.currentStreak >= 7 || p.longestStreak >= 7 },
    { type: "streak-30", check: (p: any) => p.currentStreak >= 30 || p.longestStreak >= 30 },
    { type: "centurion", check: (p: any) => p.totalEntries >= 100 },
];

async function ensureProfile(userId: string) {
    const existing = await db
        .select()
        .from(userProfile)
        .where(eq(userProfile.userId, userId))
        .limit(1);
    if (existing.length > 0) return existing[0];
    const [created] = await db
        .insert(userProfile)
        .values({ userId })
        .returning();
    return created;
}

/** Internal: update profile stats after creating an entry */
async function updateProfileStats(
    userId: string,
    entryType: string,
    audioDuration?: number
) {
    const today = todayDateString();
    const yesterday = yesterdayDateString();
    const profile = await ensureProfile(userId);

    // Streak logic
    let newStreak = profile.currentStreak;
    if (profile.lastActiveDate === today) {
        // Already active today
    } else if (profile.lastActiveDate === yesterday) {
        newStreak = profile.currentStreak + 1;
    } else {
        newStreak = 1;
    }

    const newLongest = Math.max(profile.longestStreak, newStreak);
    const newTotalEntries = profile.totalEntries + 1;
    const audioMinutesToAdd =
        entryType === "audio" && audioDuration
            ? Math.ceil(audioDuration / 60)
            : 0;
    const newAudioMinutes = profile.totalAudioMinutes + audioMinutesToAdd;
    const newScore = computeFoldScore(newStreak, newTotalEntries, newLongest);

    // Update profile
    await db
        .update(userProfile)
        .set({
            currentStreak: newStreak,
            longestStreak: newLongest,
            lastActiveDate: today,
            totalEntries: newTotalEntries,
            totalAudioMinutes: newAudioMinutes,
            foldScore: newScore,
            updatedAt: new Date(),
        })
        .where(eq(userProfile.userId, userId));

    // Upsert today's activity
    const existingActivity = await db
        .select()
        .from(userActivity)
        .where(
            and(
                eq(userActivity.userId, userId),
                eq(userActivity.date, today)
            )
        )
        .limit(1);

    if (existingActivity.length > 0) {
        const newCount = existingActivity[0].entryCount + 1;
        await db
            .update(userActivity)
            .set({
                entryCount: newCount,
                activityLevel: computeActivityLevel(newCount),
            })
            .where(eq(userActivity.id, existingActivity[0].id));
    } else {
        await db.insert(userActivity).values({
            id: generateId(),
            userId,
            date: today,
            entryCount: 1,
            activityLevel: 1,
        });
    }

    // Award badges
    const profileForBadges = {
        totalEntries: newTotalEntries,
        totalAudioMinutes: newAudioMinutes,
        currentStreak: newStreak,
        longestStreak: newLongest,
    };
    const existingBadges = await db
        .select()
        .from(userBadge)
        .where(eq(userBadge.userId, userId));
    const existingTypes = new Set(existingBadges.map((b) => b.badgeType));

    for (const badge of BADGE_DEFINITIONS) {
        if (!existingTypes.has(badge.type) && badge.check(profileForBadges)) {
            await db.insert(userBadge).values({
                id: generateId(),
                userId,
                badgeType: badge.type,
            });
        }
    }
}

// =============================================================================
// Validation
// =============================================================================

const createEntrySchema = z.object({
    type: z.enum(["text", "audio", "photo", "video", "story"]),
    mood: z.string().optional().nullable(),
    location: z.string().optional().nullable(),
    caption: z.string().optional().nullable(),

    // Text
    content: z.string().optional().nullable(),

    // Story-specific
    title: z.string().optional().nullable(),
    storyContent: z.string().optional().nullable(),
    pageCount: z.number().optional().nullable(),

    // Unified media array — all media (photos, videos, audio) goes here
    media: z
        .array(
            z.object({
                uri: z.string(),
                type: z.enum(["image", "video", "audio"]),
                thumbnailUri: z.string().optional().nullable(),
                duration: z.number().optional().nullable(),
            })
        )
        .optional()
        .nullable(),
});

const updateEntrySchema = z.object({
    mood: z.string().optional(),
    location: z.string().optional().nullable(),
    caption: z.string().optional().nullable(),
    content: z.string().optional().nullable(),
});

// =============================================================================
// Routes
// =============================================================================

/**
 * POST /timeline
 * Create a new timeline entry
 */
timelineRoutes.post("/", requireAuth, async (c) => {
    const currentUser = c.get("user");
    if (!currentUser) {
        return c.json({ success: false, error: "User not found" }, 404);
    }

    try {
        const body = await c.req.json();
        const parsed = createEntrySchema.safeParse(body);

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

        const data = parsed.data;
        const entryId = generateId();

        // 1. Insert the entry (no media columns — all media goes to entry_media)
        const [entry] = await db
            .insert(timelineEntry)
            .values({
                id: entryId,
                userId: currentUser.id,
                type: data.type,
                mood: data.mood || null,
                location: data.location || null,
                caption: data.caption || null,
                content: data.content || null,
                title: data.title || null,
                storyContent: data.storyContent || null,
                pageCount: data.pageCount ? Math.round(data.pageCount) : null,
            })
            .returning();

        // 2. Insert all media items into entry_media
        const mediaItems: {
            id: string;
            entryId: string;
            uri: string;
            type: string;
            thumbnailUri: string | null;
            duration: number | null;
            sortOrder: number;
        }[] = [];

        if (data.media && data.media.length > 0) {
            data.media.forEach((m, i) => {
                mediaItems.push({
                    id: generateId(),
                    entryId,
                    uri: m.uri,
                    type: m.type,
                    thumbnailUri: m.thumbnailUri || null,
                    duration: m.duration
                        ? Math.round(m.duration)
                        : null,
                    sortOrder: i,
                });
            });
        }

        if (mediaItems.length > 0) {
            await db.insert(entryMedia).values(mediaItems);
        }

        // 3. Compute audioDuration for profile stats (from audio media)
        const audioDuration = data.media
            ?.find((m) => m.type === "audio")
            ?.duration || undefined;

        // 4. Update profile stats (streak, score, badges)
        await updateProfileStats(
            currentUser.id,
            data.type,
            audioDuration
        );

        // 5. Return the created entry with media
        return c.json(
            {
                success: true,
                data: {
                    ...entry,
                    media: mediaItems.map((m) => ({
                        id: m.id,
                        uri: m.uri,
                        type: m.type,
                        thumbnailUri: m.thumbnailUri,
                        duration: m.duration,
                        sortOrder: m.sortOrder,
                    })),
                },
            },
            201
        );
    } catch (error: unknown) {
        const msg =
            error instanceof Error ? error.message : "Failed to create entry";
        console.error("Create entry error:", error);
        return c.json({ success: false, error: msg }, 500);
    }
});

/**
 * GET /timeline
 * List entries for current user (paginated, newest first)
 * Query: ?limit=20&offset=0
 */
timelineRoutes.get("/", requireAuth, async (c) => {
    const currentUser = c.get("user");
    if (!currentUser) {
        return c.json({ success: false, error: "User not found" }, 404);
    }

    const limit = Math.min(
        50,
        Math.max(1, parseInt(c.req.query("limit") || "20", 10))
    );
    const offset = Math.max(
        0,
        parseInt(c.req.query("offset") || "0", 10)
    );

    try {
        // Get entries
        const entries = await db
            .select()
            .from(timelineEntry)
            .where(eq(timelineEntry.userId, currentUser.id))
            .orderBy(desc(timelineEntry.createdAt))
            .limit(limit)
            .offset(offset);

        // Get media for all entries in one query
        const entryIds = entries.map((e) => e.id);
        let mediaMap: Record<string, any[]> = {};

        if (entryIds.length > 0) {
            // Fetch media for each entry
            for (const eid of entryIds) {
                const media = await db
                    .select()
                    .from(entryMedia)
                    .where(eq(entryMedia.entryId, eid))
                    .orderBy(entryMedia.sortOrder);
                if (media.length > 0) {
                    mediaMap[eid] = media;
                }
            }
        }

        // Merge media into entries
        const result = entries.map((entry) => ({
            ...entry,
            media: (mediaMap[entry.id] || []).map((m: any) => ({
                id: m.id,
                uri: m.uri,
                type: m.type,
                thumbnailUri: m.thumbnailUri,
                duration: m.duration,
                sortOrder: m.sortOrder,
            })),
        }));

        return c.json({
            success: true,
            data: result,
            pagination: { limit, offset, count: entries.length },
        });
    } catch (error: unknown) {
        const msg =
            error instanceof Error ? error.message : "Failed to list entries";
        console.error("List entries error:", error);
        return c.json({ success: false, error: msg }, 500);
    }
});

/**
 * GET /timeline/on-this-day
 * Returns all entries for the current user whose month+day matches today,
 * from PREVIOUS years only (not today). Grouped by year descending.
 */
timelineRoutes.get("/on-this-day", requireAuth, async (c) => {
    const currentUser = c.get("user");
    if (!currentUser) {
        return c.json({ success: false, error: "User not found" }, 404);
    }

    try {
        const now = new Date();
        const currentYear = now.getFullYear();
        // Zero-pad month and day for comparison
        const currentMonth = String(now.getMonth() + 1).padStart(2, "0");
        const currentDay = String(now.getDate()).padStart(2, "0");
        const todayPrefix = `${currentYear}-${currentMonth}-${currentDay}`;

        // Query all entries for this user where the month-day portion of created_at
        // matches today's month-day, but the year is NOT the current year.
        // created_at is a timestamp; we cast to text and use LIKE for month-day match.
        const entries = await db
            .select()
            .from(timelineEntry)
            .where(
                and(
                    eq(timelineEntry.userId, currentUser.id),
                    // Match month-day: extract MM-DD from created_at ISO string
                    sql`TO_CHAR(${timelineEntry.createdAt}, 'MM-DD') = ${`${currentMonth}-${currentDay}`}`,
                    // Exclude current year
                    sql`EXTRACT(YEAR FROM ${timelineEntry.createdAt}) < ${currentYear}`
                )
            )
            .orderBy(
                desc(sql`EXTRACT(YEAR FROM ${timelineEntry.createdAt})`),
                asc(timelineEntry.createdAt)
            );

        if (entries.length === 0) {
            return c.json({ success: true, data: [] });
        }

        // Fetch media for all matched entries
        const entryIds = entries.map((e) => e.id);
        const mediaMap: Record<string, any[]> = {};
        for (const eid of entryIds) {
            const media = await db
                .select()
                .from(entryMedia)
                .where(eq(entryMedia.entryId, eid))
                .orderBy(entryMedia.sortOrder);
            if (media.length > 0) {
                mediaMap[eid] = media;
            }
        }

        // Group by year
        const yearMap = new Map<number, any[]>();
        for (const entry of entries) {
            const year = entry.createdAt.getFullYear();
            if (!yearMap.has(year)) yearMap.set(year, []);
            yearMap.get(year)!.push({
                ...entry,
                media: (mediaMap[entry.id] || []).map((m: any) => ({
                    id: m.id,
                    uri: m.uri,
                    type: m.type,
                    thumbnailUri: m.thumbnailUri,
                    duration: m.duration,
                    sortOrder: m.sortOrder,
                })),
            });
        }

        // Sort years descending and build response array
        const result = Array.from(yearMap.entries())
            .sort(([a], [b]) => b - a)
            .map(([year, yearEntries]) => ({ year, entries: yearEntries }));

        return c.json({ success: true, data: result });
    } catch (error: unknown) {
        const msg =
            error instanceof Error ? error.message : "Failed to fetch on-this-day entries";
        console.error("On-this-day error:", error);
        return c.json({ success: false, error: msg }, 500);
    }
});

/**
 * GET /timeline/by-date?date=YYYY-MM-DD
 * Returns all entries for the current user on a specific calendar date.
 */
timelineRoutes.get("/by-date", requireAuth, async (c) => {
    const currentUser = c.get("user");
    if (!currentUser) {
        return c.json({ success: false, error: "User not found" }, 404);
    }

    const dateParam = c.req.query("date");
    if (!dateParam || !/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
        return c.json(
            { success: false, error: "Missing or invalid 'date' query param (expected YYYY-MM-DD)" },
            400
        );
    }

    try {
        // Build start/end of the target day in UTC
        const dayStart = `${dateParam} 00:00:00`;
        const dayEnd = `${dateParam} 23:59:59.999`;

        const entries = await db
            .select()
            .from(timelineEntry)
            .where(
                and(
                    eq(timelineEntry.userId, currentUser.id),
                    sql`${timelineEntry.createdAt} >= ${dayStart}::timestamp`,
                    sql`${timelineEntry.createdAt} <= ${dayEnd}::timestamp`
                )
            )
            .orderBy(desc(timelineEntry.createdAt));

        if (entries.length === 0) {
            return c.json({ success: true, data: [] });
        }

        // Fetch media for all matched entries
        const entryIds = entries.map((e) => e.id);
        const mediaMap: Record<string, any[]> = {};
        for (const eid of entryIds) {
            const media = await db
                .select()
                .from(entryMedia)
                .where(eq(entryMedia.entryId, eid))
                .orderBy(entryMedia.sortOrder);
            if (media.length > 0) {
                mediaMap[eid] = media;
            }
        }

        const result = entries.map((entry) => ({
            ...entry,
            media: (mediaMap[entry.id] || []).map((m: any) => ({
                id: m.id,
                uri: m.uri,
                type: m.type,
                thumbnailUri: m.thumbnailUri,
                duration: m.duration,
                sortOrder: m.sortOrder,
            })),
        }));

        return c.json({ success: true, data: result });
    } catch (error: unknown) {
        const msg =
            error instanceof Error ? error.message : "Failed to fetch entries by date";
        console.error("By-date error:", error);
        return c.json({ success: false, error: msg }, 500);
    }
});

/**
 * GET /timeline/:id
 * Get a single entry with media
 */
timelineRoutes.get("/:id", requireAuth, async (c) => {
    const currentUser = c.get("user");
    if (!currentUser) {
        return c.json({ success: false, error: "User not found" }, 404);
    }

    const entryId = c.req.param("id");

    try {
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

        const entry = entries[0];

        // Fetch media
        const media = await db
            .select()
            .from(entryMedia)
            .where(eq(entryMedia.entryId, entryId))
            .orderBy(entryMedia.sortOrder);

        return c.json({
            success: true,
            data: {
                ...entry,
                media: media.map((m) => ({
                    id: m.id,
                    uri: m.uri,
                    type: m.type,
                    thumbnailUri: m.thumbnailUri,
                    duration: m.duration,
                    sortOrder: m.sortOrder,
                })),
            },
        });
    } catch (error: unknown) {
        const msg =
            error instanceof Error ? error.message : "Failed to get entry";
        console.error("Get entry error:", error);
        return c.json({ success: false, error: msg }, 500);
    }
});

/**
 * PATCH /timeline/:id
 * Update entry (mood, caption, location, content)
 */
timelineRoutes.patch("/:id", requireAuth, async (c) => {
    const currentUser = c.get("user");
    if (!currentUser) {
        return c.json({ success: false, error: "User not found" }, 404);
    }

    const entryId = c.req.param("id");

    try {
        // Verify ownership
        const existing = await db
            .select()
            .from(timelineEntry)
            .where(
                and(
                    eq(timelineEntry.id, entryId),
                    eq(timelineEntry.userId, currentUser.id)
                )
            )
            .limit(1);

        if (existing.length === 0) {
            return c.json(
                { success: false, error: "Entry not found" },
                404
            );
        }

        const body = await c.req.json();
        const parsed = updateEntrySchema.safeParse(body);

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

        const updateData: Record<string, any> = {
            updatedAt: new Date(),
        };

        if (parsed.data.mood !== undefined) updateData.mood = parsed.data.mood;
        if (parsed.data.location !== undefined)
            updateData.location = parsed.data.location;
        if (parsed.data.caption !== undefined)
            updateData.caption = parsed.data.caption;
        if (parsed.data.content !== undefined)
            updateData.content = parsed.data.content;

        const [updated] = await db
            .update(timelineEntry)
            .set(updateData)
            .where(eq(timelineEntry.id, entryId))
            .returning();

        return c.json({
            success: true,
            message: "Entry updated",
            data: updated,
        });
    } catch (error: unknown) {
        const msg =
            error instanceof Error
                ? error.message
                : "Failed to update entry";
        console.error("Update entry error:", error);
        return c.json({ success: false, error: msg }, 500);
    }
});

/**
 * DELETE /timeline/:id
 * Delete an entry (cascades to media)
 */
timelineRoutes.delete("/:id", requireAuth, async (c) => {
    const currentUser = c.get("user");
    if (!currentUser) {
        return c.json({ success: false, error: "User not found" }, 404);
    }

    const entryId = c.req.param("id");

    try {
        // Verify ownership
        const existing = await db
            .select()
            .from(timelineEntry)
            .where(
                and(
                    eq(timelineEntry.id, entryId),
                    eq(timelineEntry.userId, currentUser.id)
                )
            )
            .limit(1);

        if (existing.length === 0) {
            return c.json(
                { success: false, error: "Entry not found" },
                404
            );
        }

        // Delete (cascades to entry_media)
        await db
            .delete(timelineEntry)
            .where(eq(timelineEntry.id, entryId));

        return c.json({
            success: true,
            message: "Entry deleted",
        });
    } catch (error: unknown) {
        const msg =
            error instanceof Error
                ? error.message
                : "Failed to delete entry";
        console.error("Delete entry error:", error);
        return c.json({ success: false, error: msg }, 500);
    }
});

export { timelineRoutes };
