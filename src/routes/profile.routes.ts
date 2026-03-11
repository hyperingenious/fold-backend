import { and, desc, eq, gte } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "../db";
import {
    timelineEntry,
    userActivity,
    userBadge,
    userProfile,
} from "../db/schema";
import { requireAuth, type AuthVariables } from "../lib/middleware";

const profileRoutes = new Hono<{ Variables: AuthVariables }>();

// =============================================================================
// Helpers
// =============================================================================

function generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

function todayDateString(): string {
    return new Date().toISOString().split("T")[0]; // "2026-02-10"
}

function yesterdayDateString(): string {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().split("T")[0];
}

/** Activity level from entry count: 0 entries=0, 1=1, 2-3=2, 4+=3 */
function computeActivityLevel(entryCount: number): number {
    if (entryCount === 0) return 0;
    if (entryCount === 1) return 1;
    if (entryCount <= 3) return 2;
    return 3;
}

/** Fold score formula: streak weight + entry count + consistency */
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

// Badge definitions with thresholds
const BADGE_DEFINITIONS: {
    type: string;
    check: (profile: {
        totalEntries: number;
        totalAudioMinutes: number;
        currentStreak: number;
        longestStreak: number;
    }) => boolean;
}[] = [
    {
        type: "early-bird",
        check: (p) => p.totalEntries >= 1,
    },
    {
        type: "the-voice",
        check: (p) => p.totalAudioMinutes >= 10,
    },
    {
        type: "on-fire",
        check: (p) => p.currentStreak >= 7 || p.longestStreak >= 7,
    },
    {
        type: "streak-30",
        check: (p) => p.currentStreak >= 30 || p.longestStreak >= 30,
    },
    {
        type: "centurion",
        check: (p) => p.totalEntries >= 100,
    },
];

/** Ensure a user_profile row exists, creating one if needed */
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

// =============================================================================
// Routes
// =============================================================================

/**
 * GET /profile/me
 * Full profile data: score, streak, audio, badges
 */
profileRoutes.get("/me", requireAuth, async (c) => {
    const currentUser = c.get("user");
    if (!currentUser) {
        return c.json({ success: false, error: "User not found" }, 404);
    }

    const profile = await ensureProfile(currentUser.id);

    // Fetch badges
    const badges = await db
        .select()
        .from(userBadge)
        .where(eq(userBadge.userId, currentUser.id));

    // Determine if streak is active (last active was today or yesterday)
    const today = todayDateString();
    const yesterday = yesterdayDateString();
    const isStreakActive =
        profile.lastActiveDate === today ||
        profile.lastActiveDate === yesterday;

    // Fetch user stories for insights
    const userStories = await db
        .select({
            content: timelineEntry.storyContent,
            mood: timelineEntry.mood,
        })
        .from(timelineEntry)
        .where(
            and(
                eq(timelineEntry.userId, currentUser.id),
                eq(timelineEntry.type, "story")
            )
        );

    let totalStoryWords = 0;
    let happyStoryCount = 0;

    for (const story of userStories) {
        if (story.content) {
            totalStoryWords += story.content.trim().split(/\s+/).length;
        }
        const mood = story.mood?.toLowerCase();
        if (mood && (mood.includes('happy') || mood === 'normal')) {
            happyStoryCount++;
        }
    }

    return c.json({
        success: true,
        data: {
            foldScore: profile.foldScore,
            currentStreak: profile.currentStreak,
            longestStreak: profile.longestStreak,
            isStreakActive:
                profile.currentStreak > 0 ? isStreakActive : false,
            totalAudioMinutes: profile.totalAudioMinutes,
            totalEntries: profile.totalEntries,
            storyStats: {
                totalStories: userStories.length,
                totalStoryWords,
                happyStoryCount,
            },
            badges: badges.map((b) => ({
                type: b.badgeType,
                earnedAt: b.earnedAt,
            })),
        },
    });
});

/**
 * GET /profile/activity?months=1
 * Activity heatmap data for the last N months (default 1, max 6)
 */
profileRoutes.get("/activity", requireAuth, async (c) => {
    const currentUser = c.get("user");
    if (!currentUser) {
        return c.json({ success: false, error: "User not found" }, 404);
    }

    const months = Math.min(
        6,
        Math.max(1, parseInt(c.req.query("months") || "1", 10))
    );

    const sinceDate = new Date();
    sinceDate.setMonth(sinceDate.getMonth() - months);
    const sinceDateStr = sinceDate.toISOString().split("T")[0];

    const activities = await db
        .select({
            date: userActivity.date,
            entryCount: userActivity.entryCount,
            activityLevel: userActivity.activityLevel,
        })
        .from(userActivity)
        .where(
            and(
                eq(userActivity.userId, currentUser.id),
                gte(userActivity.date, sinceDateStr)
            )
        )
        .orderBy(desc(userActivity.date));

    return c.json({
        success: true,
        data: {
            activity: activities.map((a) => ({
                date: a.date,
                entryCount: a.entryCount,
                level: a.activityLevel,
            })),
        },
    });
});

/**
 * POST /profile/log-activity
 * Called when user creates any entry. Updates all profile counters.
 *
 * Body: { type: "text"|"audio"|"photo"|"video"|"story", audioDuration?: number }
 */
const logActivitySchema = z.object({
    type: z.enum(["text", "audio", "photo", "video", "story"]),
    audioDuration: z.number().min(0).optional(), // seconds
});

profileRoutes.post("/log-activity", requireAuth, async (c) => {
    const currentUser = c.get("user");
    if (!currentUser) {
        return c.json({ success: false, error: "User not found" }, 404);
    }

    try {
        const body = await c.req.json();
        const parsed = logActivitySchema.safeParse(body);

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

        const { type, audioDuration } = parsed.data;
        const today = todayDateString();
        const yesterday = yesterdayDateString();

        // 1. Ensure profile exists
        const profile = await ensureProfile(currentUser.id);

        // 2. Calculate streak
        let newStreak = profile.currentStreak;
        if (profile.lastActiveDate === today) {
            // Already active today, streak stays the same
        } else if (profile.lastActiveDate === yesterday) {
            // Consecutive day — increment streak
            newStreak = profile.currentStreak + 1;
        } else {
            // Gap or first entry ever — start fresh streak
            newStreak = 1;
        }

        const newLongest = Math.max(profile.longestStreak, newStreak);
        const newTotalEntries = profile.totalEntries + 1;
        const audioMinutesToAdd =
            type === "audio" && audioDuration
                ? Math.ceil(audioDuration / 60)
                : 0;
        const newAudioMinutes =
            profile.totalAudioMinutes + audioMinutesToAdd;

        // 3. Compute new fold score
        const newScore = computeFoldScore(
            newStreak,
            newTotalEntries,
            newLongest
        );

        // 4. Update profile
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
            .where(eq(userProfile.userId, currentUser.id));

        // 5. Upsert today's activity
        const existingActivity = await db
            .select()
            .from(userActivity)
            .where(
                and(
                    eq(userActivity.userId, currentUser.id),
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
                userId: currentUser.id,
                date: today,
                entryCount: 1,
                activityLevel: 1,
            });
        }

        // 6. Check and award badges
        const profileForBadges = {
            totalEntries: newTotalEntries,
            totalAudioMinutes: newAudioMinutes,
            currentStreak: newStreak,
            longestStreak: newLongest,
        };

        const existingBadges = await db
            .select()
            .from(userBadge)
            .where(eq(userBadge.userId, currentUser.id));

        const existingBadgeTypes = new Set(
            existingBadges.map((b) => b.badgeType)
        );
        const newBadges: string[] = [];

        for (const badge of BADGE_DEFINITIONS) {
            if (
                !existingBadgeTypes.has(badge.type) &&
                badge.check(profileForBadges)
            ) {
                await db.insert(userBadge).values({
                    id: generateId(),
                    userId: currentUser.id,
                    badgeType: badge.type,
                });
                newBadges.push(badge.type);
            }
        }

        return c.json({
            success: true,
            data: {
                foldScore: newScore,
                currentStreak: newStreak,
                longestStreak: newLongest,
                totalEntries: newTotalEntries,
                totalAudioMinutes: newAudioMinutes,
                newBadges,
            },
        });
    } catch (error: unknown) {
        const errorMessage =
            error instanceof Error
                ? error.message
                : "Failed to log activity";
        return c.json(
            {
                success: false,
                error: "Activity log failed",
                message: errorMessage,
            },
            500
        );
    }
});

export { profileRoutes };
