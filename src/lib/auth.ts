import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "../db";
import * as schema from "../db/schema";

export const auth = betterAuth({
    database: drizzleAdapter(db, {
        provider: "pg",
        schema: {
            user: schema.user,
            session: schema.session,
            account: schema.account,
            verification: schema.verification,
        },
    }),

    // Email and Password authentication
    emailAndPassword: {
        enabled: true,
        requireEmailVerification: false, // Disabled as per your request
    },

    // Google OAuth
    socialProviders: {
        google: {
            clientId: process.env.GOOGLE_CLIENT_ID as string,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
        },
    },

    // Session configuration with JWT (stateless-like with cookie cache)
    session: {
        expiresIn: 60 * 60 * 24 * 7, // 7 days
        updateAge: 60 * 60 * 24, // Update session every 24 hours
        cookieCache: {
            enabled: true,
            maxAge: 60 * 60 * 24 * 7, // 7 days
            strategy: "jwt",
        },
    },

    // User configuration - additional fields
    user: {
        additionalFields: {
            avatar: {
                type: "string",
                required: false,
                fieldName: "image", // Maps to 'image' column in DB
            },
        },
    },

    // Rate limiting
    rateLimit: {
        enabled: true,
        window: 60, // 60 seconds
        max: 100, // 100 requests per window
    },

    // Advanced options - Fix for OAuth state mismatch in development
    advanced: {
        crossSubDomainCookies: {
            enabled: false, // Disable for localhost development
        },
        defaultCookieAttributes: {
            sameSite: "lax",
            secure: false, // Set to true in production with HTTPS
            httpOnly: true,
        },
    },

    // Account configuration for OAuth state handling
    account: {
        accountLinking: {
            enabled: true,
            trustedProviders: ["google"],
        },
    },

    // Trusted origins for CORS
    trustedOrigins: [
        process.env.FRONTEND_URL || "http://localhost:3001",
        "http://localhost:3000",
        "http://localhost:8081",
    ],
});
