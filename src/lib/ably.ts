import { eq } from "drizzle-orm";
import { db } from "../db";
import { user } from "../db/schema";

// =============================================================================
// Expo Push Notification Helper
// =============================================================================

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

export interface NotificationPayload {
    type: string;
    title: string;
    body: string;
    data?: Record<string, any>;
}

/**
 * Send a push notification to a user via Expo Push API.
 * Looks up the user's push token from DB and sends if available.
 * Fire-and-forget — errors are logged but don't propagate.
 */
export async function publishNotification(
    userId: string,
    notification: NotificationPayload
): Promise<void> {
    try {
        const [targetUser] = await db
            .select({ pushToken: user.pushToken })
            .from(user)
            .where(eq(user.id, userId))
            .limit(1);

        if (!targetUser?.pushToken) {
            console.log(`[Push] No push token for user ${userId}, skipping`);
            return;
        }

        const pushToken = targetUser.pushToken;

        // Validate token format
        if (!pushToken.startsWith("ExponentPushToken[") && !pushToken.startsWith("ExpoPushToken[")) {
            console.warn("[Push] Invalid push token format:", pushToken.substring(0, 20));
            return;
        }

        const response = await fetch(EXPO_PUSH_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
            },
            body: JSON.stringify({
                to: pushToken,
                title: notification.title,
                body: notification.body,
                data: { type: notification.type, ...notification.data },
                sound: "default",
            }),
        });

        if (!response.ok) {
            const text = await response.text();
            console.error(`[Push] Expo API error (${response.status}):`, text);
            return;
        }

        console.log(`[Push] Notification sent to user ${userId}: ${notification.type}`);
    } catch (error) {
        console.error(`[Push] Failed to send push to ${userId}:`, error);
    }
}
