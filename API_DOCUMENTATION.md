# Fold Backend API Documentation

## Overview

Backend API for Fold application with authentication, user management, and file uploads.

- **Base URL:** `http://localhost:3000`
- **Version:** 1.0.0
- **Authentication:** Cookie-based session (`better-auth.session_token`)

---

## Table of Contents

- [Health Endpoints](#health-endpoints)
- [Authentication Endpoints](#authentication-endpoints)
- [User Endpoints](#user-endpoints)
- [Upload Endpoints](#upload-endpoints)
- [Schemas](#schemas)
- [Error Handling](#error-handling)

---

## Health Endpoints

### GET `/`

Root endpoint - Check if API is running.

**Response:**
```json
{
  "success": true,
  "message": "Fold Backend API is running",
  "version": "1.0.0",
  "timestamp": "2026-02-02T10:00:00.000Z"
}
```

---

### GET `/health`

Health check endpoint.

**Response:**
```json
{
  "success": true,
  "status": "healthy",
  "uptime": 123.456,
  "timestamp": "2026-02-02T10:00:00.000Z"
}
```

---

## Authentication Endpoints

All auth endpoints are powered by **Better-Auth** and handle sessions via cookies.

---

### POST `/api/auth/sign-up/email`

Register a new user with email and password.

**Request Body:**
```json
{
  "email": "user@example.com",    // Required - Valid email format
  "password": "password123",       // Required - Minimum 8 characters
  "name": "John Doe"               // Required - User's display name
}
```

**Success Response (200):**
```json
{
  "token": "jwt-token-here",
  "user": {
    "id": "abc123",
    "name": "John Doe",
    "email": "user@example.com",
    "avatar": null,
    "emailVerified": false,
    "createdAt": "2026-02-02T10:00:00.000Z",
    "updatedAt": "2026-02-02T10:00:00.000Z"
  }
}
```

**Error Response (400):**
```json
{
  "success": false,
  "error": "Email already exists"
}
```

---

### POST `/api/auth/sign-in/email`

Authenticate with email and password.

**Request Body:**
```json
{
  "email": "user@example.com",    // Required
  "password": "password123"        // Required
}
```

**Success Response (200):**
```json
{
  "token": "jwt-token-here",
  "user": {
    "id": "abc123",
    "name": "John Doe",
    "email": "user@example.com",
    "avatar": "https://example.com/avatar.jpg",
    "emailVerified": true,
    "createdAt": "2026-02-02T10:00:00.000Z",
    "updatedAt": "2026-02-02T10:00:00.000Z"
  }
}
```

**Error Response (401):**
```json
{
  "success": false,
  "error": "Invalid credentials"
}
```

---

### POST `/api/auth/sign-in/social`

Get OAuth redirect URL for social login (Google).

**Request Body:**
```json
{
  "provider": "google",                              // Required - OAuth provider
  "callbackURL": "http://localhost:3000/callback"    // Optional - Redirect after auth
}
```

**Success Response (200):**
```json
{
  "url": "https://accounts.google.com/o/oauth2/v2/auth?...",
  "redirect": true
}
```

---

### GET `/api/auth/session`

Get the current authenticated session.

**Headers:**
- Cookie: `better-auth.session_token=<token>`

**Success Response (200):**
```json
{
  "session": {
    "id": "session123",
    "userId": "user123",
    "expiresAt": "2026-02-09T10:00:00.000Z",
    "createdAt": "2026-02-02T10:00:00.000Z",
    "ipAddress": "192.168.1.1",
    "userAgent": "Mozilla/5.0..."
  },
  "user": {
    "id": "abc123",
    "name": "John Doe",
    "email": "user@example.com",
    "avatar": null,
    "emailVerified": false,
    "createdAt": "2026-02-02T10:00:00.000Z",
    "updatedAt": "2026-02-02T10:00:00.000Z"
  }
}
```

---

### POST `/api/auth/sign-out`

End the current session (logout).

**Headers:**
- Cookie: `better-auth.session_token=<token>`

**Success Response (200):**
```json
{
  "success": true
}
```

---

### POST `/api/auth/forgot-password`

Request a password reset email.

**Request Body:**
```json
{
  "email": "user@example.com",                        // Required
  "redirectTo": "http://localhost:3000/reset"         // Optional - Reset page URL
}
```

**Success Response (200):**
```json
{
  "success": true
}
```

> Note: Always returns success even if email doesn't exist (for security).

---

## User Endpoints

All user endpoints require authentication via session cookie.

---

### GET `/api/user/me`

Get the current authenticated user's profile.

**Headers:**
- Cookie: `better-auth.session_token=<token>`

**Success Response (200):**
```json
{
  "success": true,
  "data": {
    "id": "abc123",
    "name": "John Doe",
    "email": "user@example.com",
    "avatar": "https://example.com/avatar.jpg",
    "emailVerified": true,
    "createdAt": "2026-02-02T10:00:00.000Z",
    "updatedAt": "2026-02-02T10:00:00.000Z"
  }
}
```

**Error Response (401):**
```json
{
  "success": false,
  "error": "Unauthorized"
}
```

**Error Response (404):**
```json
{
  "success": false,
  "error": "User not found"
}
```

---

### PATCH `/api/user/me`

Update the current user's profile.

**Headers:**
- Cookie: `better-auth.session_token=<token>`
- Content-Type: `application/json`

**Request Body:**
```json
{
  "name": "New Name",                                 // Optional - 1-100 characters
  "avatar": "https://example.com/new-avatar.jpg"     // Optional - Valid URL or null
}
```

**Validation Schema (Zod):**
```typescript
{
  name: z.string().min(1).max(100).optional(),
  avatar: z.string().url().optional().nullable()
}
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Profile updated successfully",
  "data": {
    "id": "abc123",
    "name": "New Name",
    "email": "user@example.com",
    "avatar": "https://example.com/new-avatar.jpg",
    "emailVerified": true,
    "createdAt": "2026-02-02T10:00:00.000Z",
    "updatedAt": "2026-02-02T10:30:00.000Z"
  }
}
```

**Error Response (400):**
```json
{
  "success": false,
  "error": "Validation failed",
  "details": {
    "fieldErrors": {
      "name": ["String must contain at least 1 character(s)"]
    },
    "formErrors": []
  }
}
```

---

### DELETE `/api/user/me`

Permanently delete the current user's account.

**Headers:**
- Cookie: `better-auth.session_token=<token>`

**Success Response (200):**
```json
{
  "success": true,
  "message": "Account deleted successfully"
}
```

**Error Response (500):**
```json
{
  "success": false,
  "error": "Account deletion failed",
  "message": "Failed to delete account"
}
```

---

### POST `/api/user/change-password`

Change the current user's password.

**Headers:**
- Cookie: `better-auth.session_token=<token>`
- Content-Type: `application/json`

**Request Body:**
```json
{
  "currentPassword": "oldpassword123",   // Required - Current password
  "newPassword": "newpassword123"         // Required - 8-128 characters
}
```

**Validation Schema (Zod):**
```typescript
{
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(128)
}
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Password changed successfully. Other sessions have been revoked."
}
```

**Error Response (400):**
```json
{
  "success": false,
  "error": "Password change failed",
  "message": "Invalid current password or operation failed"
}
```

---

### GET `/api/user/sessions`

List all active sessions for the current user.

**Headers:**
- Cookie: `better-auth.session_token=<token>`

**Success Response (200):**
```json
{
  "success": true,
  "data": [
    {
      "id": "session123",
      "userId": "user123",
      "expiresAt": "2026-02-09T10:00:00.000Z",
      "createdAt": "2026-02-02T10:00:00.000Z",
      "ipAddress": "192.168.1.1",
      "userAgent": "Mozilla/5.0..."
    },
    {
      "id": "session456",
      "userId": "user123",
      "expiresAt": "2026-02-08T15:00:00.000Z",
      "createdAt": "2026-02-01T15:00:00.000Z",
      "ipAddress": "10.0.0.1",
      "userAgent": "Safari/537.36..."
    }
  ]
}
```

---

### POST `/api/user/revoke-sessions`

Revoke all sessions except the current one (logout from other devices).

**Headers:**
- Cookie: `better-auth.session_token=<token>`

**Success Response (200):**
```json
{
  "success": true,
  "message": "All other sessions have been revoked"
}
```

**Error Response (500):**
```json
{
  "success": false,
  "error": "Failed to revoke sessions",
  "message": "Error message"
}
```

---

## Upload Endpoints

File uploads are handled via **Appwrite Storage**. All endpoints require authentication.

---

### POST `/api/upload`

Upload a single file.

**Headers:**
- Cookie: `better-auth.session_token=<token>`
- Content-Type: `multipart/form-data`

**Request Body:**
| Field  | Type   | Required | Description     |
|--------|--------|----------|-----------------|
| `file` | File   | Yes      | File to upload  |

**Success Response (200):**
```json
{
  "success": true,
  "message": "File uploaded successfully",
  "data": {
    "id": "file123",
    "name": "document.pdf",
    "mimeType": "application/pdf",
    "size": 102400,
    "url": "https://cloud.appwrite.io/v1/storage/buckets/.../files/file123/view",
    "previewUrl": null,
    "downloadUrl": "https://cloud.appwrite.io/v1/storage/buckets/.../files/file123/download",
    "createdAt": "2026-02-02T10:00:00.000Z"
  }
}
```

> Note: `previewUrl` is only available for image files.

**Error Response (400):**
```json
{
  "success": false,
  "error": "No file provided. Please upload a file with key 'file'"
}
```

---

### POST `/api/upload/multiple`

Upload multiple files (up to 10).

**Headers:**
- Cookie: `better-auth.session_token=<token>`
- Content-Type: `multipart/form-data`

**Request Body:**
| Field   | Type     | Required | Description              |
|---------|----------|----------|--------------------------|
| `files` | File[]   | Yes      | Files to upload (max 10) |

**Success Response (200):**
```json
{
  "success": true,
  "message": "3 file(s) uploaded successfully",
  "data": [
    {
      "id": "file123",
      "name": "image1.jpg",
      "mimeType": "image/jpeg",
      "size": 51200,
      "url": "https://cloud.appwrite.io/v1/storage/.../file123/view",
      "previewUrl": "https://cloud.appwrite.io/v1/storage/.../file123/preview?width=400&height=400&quality=80",
      "downloadUrl": "https://cloud.appwrite.io/v1/storage/.../file123/download",
      "createdAt": "2026-02-02T10:00:00.000Z"
    },
    {
      "id": "file124",
      "name": "document.pdf",
      "mimeType": "application/pdf",
      "size": 204800,
      "url": "https://cloud.appwrite.io/v1/storage/.../file124/view",
      "previewUrl": null,
      "downloadUrl": "https://cloud.appwrite.io/v1/storage/.../file124/download",
      "createdAt": "2026-02-02T10:00:00.000Z"
    }
  ]
}
```

**Error Response (400):**
```json
{
  "success": false,
  "error": "Maximum 10 files allowed per upload"
}
```

---

### POST `/api/upload/avatar`

Upload a user avatar image with automatic thumbnail generation.

**Headers:**
- Cookie: `better-auth.session_token=<token>`
- Content-Type: `multipart/form-data`

**Request Body:**
| Field    | Type   | Required | Description                    |
|----------|--------|----------|--------------------------------|
| `avatar` | File   | Yes      | Image file (max 5MB, images only) |

**Constraints:**
- File type: Images only (`image/*`)
- Max size: 5MB

**Success Response (200):**
```json
{
  "success": true,
  "message": "Avatar uploaded successfully",
  "data": {
    "id": "avatar123",
    "name": "profile.jpg",
    "mimeType": "image/jpeg",
    "size": 51200,
    "url": "https://cloud.appwrite.io/v1/storage/.../avatar123/view",
    "thumbnails": {
      "small": "https://cloud.appwrite.io/v1/storage/.../avatar123/preview?width=50&height=50&quality=80",
      "medium": "https://cloud.appwrite.io/v1/storage/.../avatar123/preview?width=150&height=150&quality=80",
      "large": "https://cloud.appwrite.io/v1/storage/.../avatar123/preview?width=400&height=400&quality=80"
    },
    "createdAt": "2026-02-02T10:00:00.000Z"
  }
}
```

**Error Response (400) - Invalid file type:**
```json
{
  "success": false,
  "error": "Only image files are allowed for avatars"
}
```

**Error Response (400) - File too large:**
```json
{
  "success": false,
  "error": "Avatar must be less than 5MB"
}
```

---

### GET `/api/upload/:fileId`

Get details of a specific file by ID.

**Headers:**
- Cookie: `better-auth.session_token=<token>`

**URL Parameters:**
| Parameter | Type   | Required | Description |
|-----------|--------|----------|-------------|
| `fileId`  | string | Yes      | File ID     |

**Success Response (200):**
```json
{
  "success": true,
  "data": {
    "id": "file123",
    "name": "document.pdf",
    "mimeType": "application/pdf",
    "size": 102400,
    "url": "https://cloud.appwrite.io/v1/storage/.../file123/view",
    "previewUrl": null,
    "downloadUrl": "https://cloud.appwrite.io/v1/storage/.../file123/download",
    "createdAt": "2026-02-02T10:00:00.000Z"
  }
}
```

**Error Response (404):**
```json
{
  "success": false,
  "error": "File not found"
}
```

---

### DELETE `/api/upload/:fileId`

Delete a file by ID.

**Headers:**
- Cookie: `better-auth.session_token=<token>`

**URL Parameters:**
| Parameter | Type   | Required | Description |
|-----------|--------|----------|-------------|
| `fileId`  | string | Yes      | File ID     |

**Success Response (200):**
```json
{
  "success": true,
  "message": "File deleted successfully"
}
```

**Error Response (404):**
```json
{
  "success": false,
  "error": "File not found"
}
```

---

### GET `/api/upload/list/all`

List all files in the storage bucket (paginated).

**Headers:**
- Cookie: `better-auth.session_token=<token>`

**Query Parameters:**
| Parameter | Type    | Default | Description                |
|-----------|---------|---------|----------------------------|
| `limit`   | integer | 25      | Number of files to return  |
| `offset`  | integer | 0       | Offset for pagination      |

**Success Response (200):**
```json
{
  "success": true,
  "data": {
    "files": [
      {
        "id": "file123",
        "name": "document.pdf",
        "mimeType": "application/pdf",
        "size": 102400,
        "url": "https://cloud.appwrite.io/v1/storage/.../file123/view",
        "previewUrl": null,
        "downloadUrl": "https://cloud.appwrite.io/v1/storage/.../file123/download",
        "createdAt": "2026-02-02T10:00:00.000Z"
      }
    ],
    "total": 42,
    "limit": 25,
    "offset": 0
  }
}
```

---

## Schemas

### User

```typescript
interface User {
  id: string;              // Unique user ID
  name: string;            // Display name
  email: string;           // Email address
  avatar: string | null;   // Avatar URL
  emailVerified: boolean;  // Email verification status
  createdAt: string;       // ISO 8601 timestamp
  updatedAt: string;       // ISO 8601 timestamp
}
```

### Session

```typescript
interface Session {
  id: string;               // Session ID
  userId: string;           // User ID
  expiresAt: string;        // Expiration timestamp (ISO 8601)
  createdAt: string;        // Creation timestamp (ISO 8601)
  ipAddress: string | null; // Client IP address
  userAgent: string | null; // Client user agent
}
```

### UploadedFile

```typescript
interface UploadedFile {
  id: string;               // File ID
  name: string;             // Original filename
  mimeType: string;         // MIME type
  size: number;             // File size in bytes
  url: string;              // Direct view URL
  previewUrl: string | null; // Preview URL (images only)
  downloadUrl: string;       // Download URL
  createdAt: string;         // ISO 8601 timestamp
}
```

### AvatarUpload

```typescript
interface AvatarUpload {
  id: string;               // File ID
  name: string;             // Original filename
  mimeType: string;         // MIME type
  size: number;             // File size in bytes
  url: string;              // Direct view URL
  thumbnails: {
    small: string;          // 50x50 thumbnail URL
    medium: string;         // 150x150 thumbnail URL
    large: string;          // 400x400 thumbnail URL
  };
  createdAt: string;        // ISO 8601 timestamp
}
```

---

## Error Handling

### Standard Error Response

All error responses follow this format:

```json
{
  "success": false,
  "error": "Error type",
  "message": "Detailed error message"
}
```

### Validation Error Response

Validation errors include detailed field information:

```json
{
  "success": false,
  "error": "Validation failed",
  "details": {
    "fieldErrors": {
      "fieldName": ["Error message 1", "Error message 2"]
    },
    "formErrors": []
  }
}
```

### HTTP Status Codes

| Status | Description                                      |
|--------|--------------------------------------------------|
| 200    | Success                                          |
| 400    | Bad Request - Invalid input or validation error  |
| 401    | Unauthorized - Authentication required           |
| 404    | Not Found - Resource doesn't exist               |
| 500    | Internal Server Error - Server-side error        |

### 404 Not Found (Route)

```json
{
  "success": false,
  "error": "Not Found",
  "message": "Route GET /invalid-path not found"
}
```

---

## Documentation

- **Swagger UI:** `GET /docs`
- **OpenAPI JSON:** `GET /openapi.json`
- **Test Login Page:** `GET /test-login` (development only)

---

## Database Schema

### User Table
| Column         | Type      | Constraints              |
|----------------|-----------|--------------------------|
| id             | text      | PRIMARY KEY              |
| name           | text      | NOT NULL                 |
| email          | text      | NOT NULL, UNIQUE         |
| email_verified | boolean   | NOT NULL, DEFAULT false  |
| image          | text      | NULLABLE                 |
| created_at     | timestamp | NOT NULL, DEFAULT NOW()  |
| updated_at     | timestamp | NOT NULL, DEFAULT NOW()  |

### Session Table
| Column     | Type      | Constraints                         |
|------------|-----------|-------------------------------------|
| id         | text      | PRIMARY KEY                         |
| expires_at | timestamp | NOT NULL                            |
| token      | text      | NOT NULL, UNIQUE                    |
| created_at | timestamp | NOT NULL, DEFAULT NOW()             |
| updated_at | timestamp | NOT NULL, DEFAULT NOW()             |
| ip_address | text      | NULLABLE                            |
| user_agent | text      | NULLABLE                            |
| user_id    | text      | NOT NULL, REFERENCES user(id) CASCADE |

### Account Table
| Column                   | Type      | Constraints                         |
|--------------------------|-----------|-------------------------------------|
| id                       | text      | PRIMARY KEY                         |
| account_id               | text      | NOT NULL                            |
| provider_id              | text      | NOT NULL                            |
| user_id                  | text      | NOT NULL, REFERENCES user(id) CASCADE |
| access_token             | text      | NULLABLE                            |
| refresh_token            | text      | NULLABLE                            |
| id_token                 | text      | NULLABLE                            |
| access_token_expires_at  | timestamp | NULLABLE                            |
| refresh_token_expires_at | timestamp | NULLABLE                            |
| scope                    | text      | NULLABLE                            |
| password                 | text      | NULLABLE                            |
| created_at               | timestamp | NOT NULL, DEFAULT NOW()             |
| updated_at               | timestamp | NOT NULL, DEFAULT NOW()             |

### Verification Table
| Column     | Type      | Constraints             |
|------------|-----------|-------------------------|
| id         | text      | PRIMARY KEY             |
| identifier | text      | NOT NULL                |
| value      | text      | NOT NULL                |
| expires_at | timestamp | NOT NULL                |
| created_at | timestamp | NOT NULL, DEFAULT NOW() |
| updated_at | timestamp | NOT NULL, DEFAULT NOW() |
