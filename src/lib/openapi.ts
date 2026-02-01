// OpenAPI 3.0 Specification for Fold Backend API

export const openApiSpec = {
    openapi: "3.0.0",
    info: {
        title: "Fold Backend API",
        version: "1.0.0",
        description: "Backend API for Fold application with authentication, user management, and file uploads.",
        contact: {
            name: "API Support",
        },
    },
    servers: [
        {
            url: "http://localhost:3000",
            description: "Development server",
        },
    ],
    tags: [
        { name: "Health", description: "Health check endpoints" },
        { name: "Auth", description: "Authentication endpoints (Better-Auth)" },
        { name: "User", description: "User management endpoints" },
        { name: "Upload", description: "File upload endpoints (Appwrite)" },
    ],
    paths: {
        // ==========================================================================
        // Health
        // ==========================================================================
        "/health": {
            get: {
                tags: ["Health"],
                summary: "Health check",
                description: "Check if the API is running",
                responses: {
                    200: {
                        description: "API is healthy",
                        content: {
                            "application/json": {
                                schema: {
                                    type: "object",
                                    properties: {
                                        success: { type: "boolean", example: true },
                                        status: { type: "string", example: "healthy" },
                                        uptime: { type: "number", example: 123.456 },
                                        timestamp: { type: "string", format: "date-time" },
                                    },
                                },
                            },
                        },
                    },
                },
            },
        },

        // ==========================================================================
        // Auth Endpoints
        // ==========================================================================
        "/api/auth/sign-up/email": {
            post: {
                tags: ["Auth"],
                summary: "Register with email",
                description: "Create a new account with email and password",
                requestBody: {
                    required: true,
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                required: ["email", "password", "name"],
                                properties: {
                                    email: { type: "string", format: "email", example: "user@example.com" },
                                    password: { type: "string", minLength: 8, example: "password123" },
                                    name: { type: "string", example: "John Doe" },
                                },
                            },
                        },
                    },
                },
                responses: {
                    200: {
                        description: "User created successfully",
                        content: {
                            "application/json": {
                                schema: { $ref: "#/components/schemas/AuthResponse" },
                            },
                        },
                    },
                    400: {
                        description: "Invalid input or email already exists",
                        content: {
                            "application/json": {
                                schema: { $ref: "#/components/schemas/Error" },
                            },
                        },
                    },
                },
            },
        },
        "/api/auth/sign-in/email": {
            post: {
                tags: ["Auth"],
                summary: "Sign in with email",
                description: "Authenticate with email and password",
                requestBody: {
                    required: true,
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                required: ["email", "password"],
                                properties: {
                                    email: { type: "string", format: "email", example: "user@example.com" },
                                    password: { type: "string", example: "password123" },
                                },
                            },
                        },
                    },
                },
                responses: {
                    200: {
                        description: "Login successful",
                        content: {
                            "application/json": {
                                schema: { $ref: "#/components/schemas/AuthResponse" },
                            },
                        },
                    },
                    401: {
                        description: "Invalid credentials",
                        content: {
                            "application/json": {
                                schema: { $ref: "#/components/schemas/Error" },
                            },
                        },
                    },
                },
            },
        },
        "/api/auth/sign-in/social": {
            post: {
                tags: ["Auth"],
                summary: "Sign in with OAuth provider",
                description: "Get OAuth redirect URL for social login",
                requestBody: {
                    required: true,
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                required: ["provider"],
                                properties: {
                                    provider: { type: "string", enum: ["google"], example: "google" },
                                    callbackURL: { type: "string", example: "http://localhost:3000" },
                                },
                            },
                        },
                    },
                },
                responses: {
                    200: {
                        description: "OAuth URL returned",
                        content: {
                            "application/json": {
                                schema: {
                                    type: "object",
                                    properties: {
                                        url: { type: "string", description: "Redirect URL for OAuth" },
                                        redirect: { type: "boolean", example: true },
                                    },
                                },
                            },
                        },
                    },
                },
            },
        },
        "/api/auth/sign-out": {
            post: {
                tags: ["Auth"],
                summary: "Sign out",
                description: "End the current session",
                security: [{ cookieAuth: [] }],
                responses: {
                    200: {
                        description: "Signed out successfully",
                        content: {
                            "application/json": {
                                schema: {
                                    type: "object",
                                    properties: {
                                        success: { type: "boolean", example: true },
                                    },
                                },
                            },
                        },
                    },
                },
            },
        },
        "/api/auth/session": {
            get: {
                tags: ["Auth"],
                summary: "Get current session",
                description: "Get the current user session if authenticated",
                security: [{ cookieAuth: [] }],
                responses: {
                    200: {
                        description: "Session data",
                        content: {
                            "application/json": {
                                schema: {
                                    type: "object",
                                    properties: {
                                        session: { $ref: "#/components/schemas/Session" },
                                        user: { $ref: "#/components/schemas/User" },
                                    },
                                },
                            },
                        },
                    },
                },
            },
        },
        "/api/auth/forgot-password": {
            post: {
                tags: ["Auth"],
                summary: "Request password reset",
                description: "Send password reset email",
                requestBody: {
                    required: true,
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                required: ["email"],
                                properties: {
                                    email: { type: "string", format: "email", example: "user@example.com" },
                                    redirectTo: { type: "string", example: "http://localhost:3000/reset" },
                                },
                            },
                        },
                    },
                },
                responses: {
                    200: {
                        description: "Reset email sent (if email exists)",
                    },
                },
            },
        },

        // ==========================================================================
        // User Endpoints
        // ==========================================================================
        "/api/user/me": {
            get: {
                tags: ["User"],
                summary: "Get current user profile",
                description: "Get the profile of the currently authenticated user",
                security: [{ cookieAuth: [] }],
                responses: {
                    200: {
                        description: "User profile",
                        content: {
                            "application/json": {
                                schema: {
                                    type: "object",
                                    properties: {
                                        success: { type: "boolean", example: true },
                                        data: { $ref: "#/components/schemas/User" },
                                    },
                                },
                            },
                        },
                    },
                    401: {
                        description: "Unauthorized",
                        content: {
                            "application/json": {
                                schema: { $ref: "#/components/schemas/Error" },
                            },
                        },
                    },
                },
            },
            patch: {
                tags: ["User"],
                summary: "Update user profile",
                description: "Update the current user's name and/or avatar",
                security: [{ cookieAuth: [] }],
                requestBody: {
                    required: true,
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                properties: {
                                    name: { type: "string", example: "New Name" },
                                    avatar: { type: "string", format: "uri", example: "https://example.com/avatar.jpg" },
                                },
                            },
                        },
                    },
                },
                responses: {
                    200: {
                        description: "Profile updated",
                        content: {
                            "application/json": {
                                schema: {
                                    type: "object",
                                    properties: {
                                        success: { type: "boolean", example: true },
                                        message: { type: "string", example: "Profile updated successfully" },
                                        data: { $ref: "#/components/schemas/User" },
                                    },
                                },
                            },
                        },
                    },
                    401: { description: "Unauthorized" },
                },
            },
            delete: {
                tags: ["User"],
                summary: "Delete account",
                description: "Permanently delete the current user's account",
                security: [{ cookieAuth: [] }],
                responses: {
                    200: {
                        description: "Account deleted",
                        content: {
                            "application/json": {
                                schema: {
                                    type: "object",
                                    properties: {
                                        success: { type: "boolean", example: true },
                                        message: { type: "string", example: "Account deleted successfully" },
                                    },
                                },
                            },
                        },
                    },
                    401: { description: "Unauthorized" },
                },
            },
        },
        "/api/user/change-password": {
            post: {
                tags: ["User"],
                summary: "Change password",
                description: "Change the current user's password",
                security: [{ cookieAuth: [] }],
                requestBody: {
                    required: true,
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                required: ["currentPassword", "newPassword"],
                                properties: {
                                    currentPassword: { type: "string", example: "oldpassword123" },
                                    newPassword: { type: "string", minLength: 8, example: "newpassword123" },
                                },
                            },
                        },
                    },
                },
                responses: {
                    200: {
                        description: "Password changed",
                        content: {
                            "application/json": {
                                schema: {
                                    type: "object",
                                    properties: {
                                        success: { type: "boolean", example: true },
                                        message: { type: "string", example: "Password changed successfully" },
                                    },
                                },
                            },
                        },
                    },
                    400: { description: "Invalid current password" },
                    401: { description: "Unauthorized" },
                },
            },
        },
        "/api/user/sessions": {
            get: {
                tags: ["User"],
                summary: "List active sessions",
                description: "Get all active sessions for the current user",
                security: [{ cookieAuth: [] }],
                responses: {
                    200: {
                        description: "List of sessions",
                        content: {
                            "application/json": {
                                schema: {
                                    type: "object",
                                    properties: {
                                        success: { type: "boolean", example: true },
                                        data: {
                                            type: "array",
                                            items: { $ref: "#/components/schemas/Session" },
                                        },
                                    },
                                },
                            },
                        },
                    },
                    401: { description: "Unauthorized" },
                },
            },
        },
        "/api/user/revoke-sessions": {
            post: {
                tags: ["User"],
                summary: "Revoke other sessions",
                description: "Revoke all sessions except the current one",
                security: [{ cookieAuth: [] }],
                responses: {
                    200: {
                        description: "Sessions revoked",
                        content: {
                            "application/json": {
                                schema: {
                                    type: "object",
                                    properties: {
                                        success: { type: "boolean", example: true },
                                        message: { type: "string", example: "Other sessions revoked" },
                                    },
                                },
                            },
                        },
                    },
                    401: { description: "Unauthorized" },
                },
            },
        },

        // ==========================================================================
        // Upload Endpoints
        // ==========================================================================
        "/api/upload": {
            post: {
                tags: ["Upload"],
                summary: "Upload single file",
                description: "Upload a single file to Appwrite storage",
                security: [{ cookieAuth: [] }],
                requestBody: {
                    required: true,
                    content: {
                        "multipart/form-data": {
                            schema: {
                                type: "object",
                                required: ["file"],
                                properties: {
                                    file: {
                                        type: "string",
                                        format: "binary",
                                        description: "File to upload",
                                    },
                                },
                            },
                        },
                    },
                },
                responses: {
                    200: {
                        description: "File uploaded",
                        content: {
                            "application/json": {
                                schema: {
                                    type: "object",
                                    properties: {
                                        success: { type: "boolean", example: true },
                                        message: { type: "string", example: "File uploaded successfully" },
                                        data: { $ref: "#/components/schemas/UploadedFile" },
                                    },
                                },
                            },
                        },
                    },
                    400: { description: "No file provided" },
                    401: { description: "Unauthorized" },
                },
            },
        },
        "/api/upload/multiple": {
            post: {
                tags: ["Upload"],
                summary: "Upload multiple files",
                description: "Upload up to 10 files at once",
                security: [{ cookieAuth: [] }],
                requestBody: {
                    required: true,
                    content: {
                        "multipart/form-data": {
                            schema: {
                                type: "object",
                                required: ["files"],
                                properties: {
                                    files: {
                                        type: "array",
                                        items: { type: "string", format: "binary" },
                                        description: "Files to upload (max 10)",
                                    },
                                },
                            },
                        },
                    },
                },
                responses: {
                    200: {
                        description: "Files uploaded",
                        content: {
                            "application/json": {
                                schema: {
                                    type: "object",
                                    properties: {
                                        success: { type: "boolean", example: true },
                                        message: { type: "string", example: "3 file(s) uploaded successfully" },
                                        data: {
                                            type: "array",
                                            items: { $ref: "#/components/schemas/UploadedFile" },
                                        },
                                    },
                                },
                            },
                        },
                    },
                    400: { description: "No files or too many files" },
                    401: { description: "Unauthorized" },
                },
            },
        },
        "/api/upload/avatar": {
            post: {
                tags: ["Upload"],
                summary: "Upload avatar image",
                description: "Upload an avatar image (max 5MB, images only). Returns URLs for different thumbnail sizes.",
                security: [{ cookieAuth: [] }],
                requestBody: {
                    required: true,
                    content: {
                        "multipart/form-data": {
                            schema: {
                                type: "object",
                                required: ["avatar"],
                                properties: {
                                    avatar: {
                                        type: "string",
                                        format: "binary",
                                        description: "Avatar image (max 5MB)",
                                    },
                                },
                            },
                        },
                    },
                },
                responses: {
                    200: {
                        description: "Avatar uploaded",
                        content: {
                            "application/json": {
                                schema: {
                                    type: "object",
                                    properties: {
                                        success: { type: "boolean", example: true },
                                        message: { type: "string", example: "Avatar uploaded successfully" },
                                        data: { $ref: "#/components/schemas/AvatarUpload" },
                                    },
                                },
                            },
                        },
                    },
                    400: { description: "Invalid file type or size" },
                    401: { description: "Unauthorized" },
                },
            },
        },
        "/api/upload/{fileId}": {
            get: {
                tags: ["Upload"],
                summary: "Get file details",
                description: "Get details of a specific file by ID",
                security: [{ cookieAuth: [] }],
                parameters: [
                    {
                        name: "fileId",
                        in: "path",
                        required: true,
                        schema: { type: "string" },
                        description: "File ID",
                    },
                ],
                responses: {
                    200: {
                        description: "File details",
                        content: {
                            "application/json": {
                                schema: {
                                    type: "object",
                                    properties: {
                                        success: { type: "boolean", example: true },
                                        data: { $ref: "#/components/schemas/UploadedFile" },
                                    },
                                },
                            },
                        },
                    },
                    404: { description: "File not found" },
                    401: { description: "Unauthorized" },
                },
            },
            delete: {
                tags: ["Upload"],
                summary: "Delete file",
                description: "Delete a file by ID",
                security: [{ cookieAuth: [] }],
                parameters: [
                    {
                        name: "fileId",
                        in: "path",
                        required: true,
                        schema: { type: "string" },
                        description: "File ID",
                    },
                ],
                responses: {
                    200: {
                        description: "File deleted",
                        content: {
                            "application/json": {
                                schema: {
                                    type: "object",
                                    properties: {
                                        success: { type: "boolean", example: true },
                                        message: { type: "string", example: "File deleted successfully" },
                                    },
                                },
                            },
                        },
                    },
                    404: { description: "File not found" },
                    401: { description: "Unauthorized" },
                },
            },
        },
        "/api/upload/list/all": {
            get: {
                tags: ["Upload"],
                summary: "List all files",
                description: "List all files in the storage bucket",
                security: [{ cookieAuth: [] }],
                parameters: [
                    {
                        name: "limit",
                        in: "query",
                        schema: { type: "integer", default: 25 },
                        description: "Number of files to return",
                    },
                    {
                        name: "offset",
                        in: "query",
                        schema: { type: "integer", default: 0 },
                        description: "Offset for pagination",
                    },
                ],
                responses: {
                    200: {
                        description: "List of files",
                        content: {
                            "application/json": {
                                schema: {
                                    type: "object",
                                    properties: {
                                        success: { type: "boolean", example: true },
                                        data: {
                                            type: "object",
                                            properties: {
                                                files: {
                                                    type: "array",
                                                    items: { $ref: "#/components/schemas/UploadedFile" },
                                                },
                                                total: { type: "integer", example: 42 },
                                                limit: { type: "integer", example: 25 },
                                                offset: { type: "integer", example: 0 },
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    },
                    401: { description: "Unauthorized" },
                },
            },
        },
    },
    components: {
        securitySchemes: {
            cookieAuth: {
                type: "apiKey",
                in: "cookie",
                name: "better-auth.session_token",
                description: "Session cookie from authentication",
            },
        },
        schemas: {
            User: {
                type: "object",
                properties: {
                    id: { type: "string", example: "abc123" },
                    name: { type: "string", example: "John Doe" },
                    email: { type: "string", format: "email", example: "john@example.com" },
                    avatar: { type: "string", nullable: true, example: "https://example.com/avatar.jpg" },
                    emailVerified: { type: "boolean", example: false },
                    createdAt: { type: "string", format: "date-time" },
                    updatedAt: { type: "string", format: "date-time" },
                },
            },
            Session: {
                type: "object",
                properties: {
                    id: { type: "string", example: "session123" },
                    userId: { type: "string", example: "user123" },
                    expiresAt: { type: "string", format: "date-time" },
                    createdAt: { type: "string", format: "date-time" },
                    ipAddress: { type: "string", nullable: true, example: "192.168.1.1" },
                    userAgent: { type: "string", nullable: true },
                },
            },
            AuthResponse: {
                type: "object",
                properties: {
                    token: { type: "string", example: "jwt-token-here" },
                    user: { $ref: "#/components/schemas/User" },
                },
            },
            UploadedFile: {
                type: "object",
                properties: {
                    id: { type: "string", example: "file123" },
                    name: { type: "string", example: "photo.jpg" },
                    mimeType: { type: "string", example: "image/jpeg" },
                    size: { type: "integer", example: 102400 },
                    url: { type: "string", format: "uri", example: "https://appwrite.io/storage/files/file123/view" },
                    previewUrl: { type: "string", format: "uri", nullable: true },
                    downloadUrl: { type: "string", format: "uri" },
                    createdAt: { type: "string", format: "date-time" },
                },
            },
            AvatarUpload: {
                type: "object",
                properties: {
                    id: { type: "string", example: "avatar123" },
                    name: { type: "string", example: "avatar.jpg" },
                    mimeType: { type: "string", example: "image/jpeg" },
                    size: { type: "integer", example: 51200 },
                    url: { type: "string", format: "uri" },
                    thumbnails: {
                        type: "object",
                        properties: {
                            small: { type: "string", format: "uri", description: "50x50 thumbnail" },
                            medium: { type: "string", format: "uri", description: "150x150 thumbnail" },
                            large: { type: "string", format: "uri", description: "400x400 thumbnail" },
                        },
                    },
                    createdAt: { type: "string", format: "date-time" },
                },
            },
            Error: {
                type: "object",
                properties: {
                    success: { type: "boolean", example: false },
                    error: { type: "string", example: "Error message" },
                    code: { type: "string", example: "ERROR_CODE" },
                },
            },
        },
    },
};
