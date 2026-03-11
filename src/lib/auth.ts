import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { expo } from "@better-auth/expo";
import { db } from "../db";
import * as schema from "../db/schema";

export const auth = betterAuth({
    // Base URL for OAuth callbacks - MUST be set for production
    baseURL: process.env.BETTER_AUTH_URL || "https://backend.fold.taohq.org",
    
    database: drizzleAdapter(db, {
        provider: "pg",
        schema: {
            user: schema.user,
            session: schema.session,
            account: schema.account,
            verification: schema.verification,
        },
    }),

    // Plugins
    plugins: [
        expo(), // Expo plugin adds /expo-authorization-proxy endpoint for OAuth
    ],

    // Email and Password authentication
    emailAndPassword: {
        enabled: true,
        requireEmailVerification: false,
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

    // Advanced options
    advanced: {
        crossSubDomainCookies: {
            enabled: false,
        },
        defaultCookieAttributes: {
            sameSite: "lax",
            secure: process.env.NODE_ENV === "production", // true for HTTPS in production
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

    // Trusted origins for CORS and mobile apps
    trustedOrigins: [
        // Production
        "https://backend.fold.taohq.org",
        process.env.FRONTEND_URL || "http://localhost:3001",
        // Development
        "http://localhost:3000",
        "http://localhost:8081",
        // Mobile app deep links
        "fold://",
        "fold://*",
        // Expo development
        "exp://",
        "exp://**",
        "exp://192.168.*.*:*/**",
    ],
});
