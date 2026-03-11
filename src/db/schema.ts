import {
    boolean,
    integer,
    pgTable,
    text,
    timestamp,
} from "drizzle-orm/pg-core";

// User table - Core user data + custom fields (name, avatar)
export const user = pgTable("user", {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    emailVerified: boolean("email_verified").notNull().default(false),
    image: text("image"), // This is the avatar field
    pushToken: text("push_token"), // Expo push token for native notifications
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Session table - For session management
export const session = pgTable("session", {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
        .notNull()
        .references(() => user.id, { onDelete: "cascade" }),
});

// Account table - For OAuth providers (Google, etc.)
export const account = pgTable("account", {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
        .notNull()
        .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"), // For email/password auth
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Verification table - For email verification, password reset, etc.
export const verification = pgTable("verification", {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Rate Limit table - For API rate limiting
export const rateLimit = pgTable("rate_limit", {
    id: text("id").primaryKey(),
    key: text("key").notNull(),
    count: integer("count").notNull().default(0),
    lastRequest: timestamp("last_request").notNull().defaultNow(),
});

// User Profile table - Extended profile data (1:1 with user)
export const userProfile = pgTable("user_profile", {
    userId: text("user_id")
        .primaryKey()
        .references(() => user.id, { onDelete: "cascade" }),
    foldScore: integer("fold_score").notNull().default(0),
    currentStreak: integer("current_streak").notNull().default(0),
    longestStreak: integer("longest_streak").notNull().default(0),
    lastActiveDate: text("last_active_date"), // stored as "YYYY-MM-DD"
    totalEntries: integer("total_entries").notNull().default(0),
    totalAudioMinutes: integer("total_audio_minutes").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// User Activity table - Daily activity log for heatmap grid
// Uniqueness on (userId, date) enforced at application level via upsert logic
export const userActivity = pgTable("user_activity", {
    id: text("id").primaryKey(),
    userId: text("user_id")
        .notNull()
        .references(() => user.id, { onDelete: "cascade" }),
    date: text("date").notNull(), // stored as "YYYY-MM-DD"
    entryCount: integer("entry_count").notNull().default(0),
    activityLevel: integer("activity_level").notNull().default(0), // 0-3
});

// User Badge table - Earned achievements/badges
// Uniqueness on (userId, badgeType) enforced at application level
export const userBadge = pgTable("user_badge", {
    id: text("id").primaryKey(),
    userId: text("user_id")
        .notNull()
        .references(() => user.id, { onDelete: "cascade" }),
    badgeType: text("badge_type").notNull(), // e.g. 'early-bird', 'the-voice', 'on-fire'
    earnedAt: timestamp("earned_at").notNull().defaultNow(),
});

// Timeline Entry table - All entry types in one table
export const timelineEntry = pgTable("timeline_entry", {
    id: text("id").primaryKey(),
    userId: text("user_id")
        .notNull()
        .references(() => user.id, { onDelete: "cascade" }),
    type: text("type").notNull(), // 'text' | 'audio' | 'photo' | 'video' | 'story'
    mood: text("mood"),
    location: text("location"),
    caption: text("caption"), // used by photo/video/audio entries

    // Text entry fields
    content: text("content"),

    // Story entry fields
    title: text("title"),
    storyContent: text("story_content"),
    pageCount: integer("page_count"),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Share table - Shareable links for timeline entries
export const share = pgTable("share", {
    id: text("id").primaryKey(),
    entryId: text("entry_id")
        .notNull()
        .references(() => timelineEntry.id, { onDelete: "cascade" }),
    userId: text("user_id")
        .notNull()
        .references(() => user.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(), // URL slug for public access
    status: text("status").notNull().default("active"), // 'active' | 'paused'
    viewCount: integer("view_count").notNull().default(0),
    expiresAt: timestamp("expires_at"), // optional expiration
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Entry Media table - ALL media associated with an entry (images, videos, audio)
export const entryMedia = pgTable("entry_media", {
    id: text("id").primaryKey(),
    entryId: text("entry_id")
        .notNull()
        .references(() => timelineEntry.id, { onDelete: "cascade" }),
    uri: text("uri").notNull(),
    type: text("type").notNull(), // 'image' | 'video' | 'audio'
    thumbnailUri: text("thumbnail_uri"), // for video thumbnails
    duration: integer("duration"), // for video/audio media, in seconds
    sortOrder: integer("sort_order").notNull().default(0),
});

// =============================================================================
// Fold Connect — One-to-one shared memory timeline
// =============================================================================

// Connection table - Exactly one active connection per user
export const connection = pgTable("connection", {
    id: text("id").primaryKey(),
    requesterId: text("requester_id")
        .notNull()
        .references(() => user.id, { onDelete: "cascade" }),
    receiverId: text("receiver_id")
        .notNull()
        .references(() => user.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("pending"), // 'pending' | 'active' | 'ended'
    inviteCode: text("invite_code").unique(), // 6-char code for connection requests
    acceptedAt: timestamp("accepted_at"),
    endedAt: timestamp("ended_at"),
    cooldownUntil: timestamp("cooldown_until"), // Earliest date user can make a new connection
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// User Settings table - Per-user preferences (1:1 with user)
export const userSettings = pgTable("user_settings", {
    userId: text("user_id")
        .primaryKey()
        .references(() => user.id, { onDelete: "cascade" }),
    autoLocation: boolean("auto_location").notNull().default(false),
    screenshotProtection: boolean("screenshot_protection").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Connect Memory table - Entries shared to the connection timeline
export const connectMemory = pgTable("connect_memory", {
    id: text("id").primaryKey(),
    connectionId: text("connection_id")
        .notNull()
        .references(() => connection.id, { onDelete: "cascade" }),
    userId: text("user_id")
        .notNull()
        .references(() => user.id, { onDelete: "cascade" }),
    entryId: text("entry_id")
        .notNull()
        .references(() => timelineEntry.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
});

// =============================================================================
// Admin Dashboard Tables
// =============================================================================

// Admin Activity Log — records every admin action for auditing
export const adminLog = pgTable("admin_log", {
    id: text("id").primaryKey(),
    action: text("action").notNull(),     // e.g. "user_banned", "notification_sent"
    entity: text("entity"),               // e.g. "user", "cms", "notification"
    entityId: text("entity_id"),
    detail: text("detail"),               // JSON string with extra context
    ipAddress: text("ip_address"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Notification Send Log — history of admin-sent push notifications
export const notificationLog = pgTable("notification_log", {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    audience: text("audience").notNull(),  // "all" | "active" | "ios" | etc.
    sentCount: integer("sent_count").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
});

// CMS Entries — in-app content updatable without redeploying
export const cmsEntry = pgTable("cms_entry", {
    id: text("id").primaryKey(),
    slug: text("slug").notNull().unique(),
    type: text("type").notNull(),            // "announcement" | "banner" | "faq" | "help" | "terms" | "privacy"
    title: text("title").notNull(),
    content: text("content").notNull(),      // HTML from rich text editor
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Feature Flags — enable/disable app features without redeploying
export const featureFlag = pgTable("feature_flag", {
    id: text("id").primaryKey(),
    key: text("key").notNull().unique(),     // e.g. "enable_stories", "enable_connect"
    enabled: boolean("enabled").notNull().default(false),
    description: text("description"),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// APK Releases
export const apkRelease = pgTable("apk_release", {
    id: text("id").primaryKey(),
    version: text("version").notNull(),     // e.g "1.0.4"
    url: text("url").notNull(),             // Direct download link (S3/R2)
    changeLog: text("change_log"),          // What's new in this version
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
});
