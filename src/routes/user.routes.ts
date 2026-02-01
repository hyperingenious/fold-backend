import { Hono } from "hono";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { user } from "../db/schema";
import { requireAuth, type AuthVariables } from "../lib/middleware";
import { auth } from "../lib/auth";

const userRoutes = new Hono<{ Variables: AuthVariables }>();

// Validation schemas
const updateUserSchema = z.object({
    name: z.string().min(1).max(100).optional(),
    avatar: z.string().url().optional().nullable(),
});

const updatePasswordSchema = z.object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(8).max(128),
});

/**
 * GET /user/me
 * Get current user profile
 */
userRoutes.get("/me", requireAuth, async (c) => {
    const currentUser = c.get("user");

    if (!currentUser) {
        return c.json({ success: false, error: "User not found" }, 404);
    }

    return c.json({
        success: true,
        data: {
            id: currentUser.id,
            name: currentUser.name,
            email: currentUser.email,
            avatar: currentUser.image,
            emailVerified: currentUser.emailVerified,
            createdAt: currentUser.createdAt,
            updatedAt: currentUser.updatedAt,
        },
    });
});

/**
 * PATCH /user/me
 * Update current user profile (name, avatar)
 */
userRoutes.patch("/me", requireAuth, async (c) => {
    const currentUser = c.get("user");

    if (!currentUser) {
        return c.json({ success: false, error: "User not found" }, 404);
    }

    try {
        const body = await c.req.json();
        const parsed = updateUserSchema.safeParse(body);

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

        const { name, avatar } = parsed.data;

        // Build update object
        const updateData: { name?: string; image?: string | null; updatedAt: Date } =
        {
            updatedAt: new Date(),
        };

        if (name !== undefined) {
            updateData.name = name;
        }
        if (avatar !== undefined) {
            updateData.image = avatar;
        }

        // Update user in database
        const [updatedUser] = await db
            .update(user)
            .set(updateData)
            .where(eq(user.id, currentUser.id))
            .returning();

        return c.json({
            success: true,
            message: "Profile updated successfully",
            data: {
                id: updatedUser.id,
                name: updatedUser.name,
                email: updatedUser.email,
                avatar: updatedUser.image,
                emailVerified: updatedUser.emailVerified,
                createdAt: updatedUser.createdAt,
                updatedAt: updatedUser.updatedAt,
            },
        });
    } catch (error: unknown) {
        const errorMessage =
            error instanceof Error ? error.message : "Invalid request body";
        return c.json(
            {
                success: false,
                error: "Bad request",
                message: errorMessage,
            },
            400
        );
    }
});

/**
 * POST /user/change-password
 * Change user password (for email/password users)
 */
userRoutes.post("/change-password", requireAuth, async (c) => {
    try {
        const body = await c.req.json();
        const parsed = updatePasswordSchema.safeParse(body);

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

        const { currentPassword, newPassword } = parsed.data;

        await auth.api.changePassword({
            headers: c.req.raw.headers,
            body: {
                currentPassword,
                newPassword,
                revokeOtherSessions: true,
            },
        });

        return c.json({
            success: true,
            message: "Password changed successfully. Other sessions have been revoked.",
        });
    } catch (error: unknown) {
        const errorMessage =
            error instanceof Error
                ? error.message
                : "Invalid current password or operation failed";
        return c.json(
            {
                success: false,
                error: "Password change failed",
                message: errorMessage,
            },
            400
        );
    }
});

/**
 * DELETE /user/me
 * Delete current user account
 */
userRoutes.delete("/me", requireAuth, async (c) => {
    const currentUser = c.get("user");

    if (!currentUser) {
        return c.json({ success: false, error: "User not found" }, 404);
    }

    try {
        // Delete user from database (cascades to sessions and accounts)
        await db.delete(user).where(eq(user.id, currentUser.id));

        return c.json({
            success: true,
            message: "Account deleted successfully",
        });
    } catch (error: unknown) {
        const errorMessage =
            error instanceof Error ? error.message : "Failed to delete account";
        return c.json(
            {
                success: false,
                error: "Account deletion failed",
                message: errorMessage,
            },
            500
        );
    }
});

/**
 * GET /user/sessions
 * List all active sessions for current user
 */
userRoutes.get("/sessions", requireAuth, async (c) => {
    try {
        const sessions = await auth.api.listSessions({
            headers: c.req.raw.headers,
        });

        return c.json({
            success: true,
            data: sessions,
        });
    } catch (error: unknown) {
        const errorMessage =
            error instanceof Error ? error.message : "Failed to list sessions";
        return c.json(
            {
                success: false,
                error: "Failed to list sessions",
                message: errorMessage,
            },
            500
        );
    }
});

/**
 * POST /user/revoke-sessions
 * Revoke all other sessions (logout from other devices)
 */
userRoutes.post("/revoke-sessions", requireAuth, async (c) => {
    try {
        await auth.api.revokeOtherSessions({
            headers: c.req.raw.headers,
        });

        return c.json({
            success: true,
            message: "All other sessions have been revoked",
        });
    } catch (error: unknown) {
        const errorMessage =
            error instanceof Error ? error.message : "Failed to revoke sessions";
        return c.json(
            {
                success: false,
                error: "Failed to revoke sessions",
                message: errorMessage,
            },
            500
        );
    }
});

export { userRoutes };
