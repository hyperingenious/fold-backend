# Fold Backend — Rules & Conventions

This file documents the patterns, architectural decisions, and conventions to follow when contributing to the Fold Hono API backend.

---

## 1. Architecture Overview

```
src/
  index.ts             → App entry point: middleware, CORS, route mounting
  db/
    index.ts           → Drizzle + Neon connection instance
    schema.ts          → The ONLY source of truth for the database schema
  lib/
    auth.ts            → Better-Auth configuration
    ably.ts            → publishNotification() — push notification sender
    middleware.ts      → authMiddleware + requireAuth
    openapi.ts         → OpenAPI spec helpers
  routes/
    user.routes.ts     → /api/user/*
    timeline.routes.ts → /api/timeline/*
    profile.routes.ts  → /api/profile/*
    connect.routes.ts  → /api/connect/*
    shares.routes.ts   → /api/shares/*
    upload.routes.ts   → /api/upload/*
    config.routes.ts   → /api/config/* (push token, notifications)
```

---

## 2. Route Conventions

- Every router is created as `new Hono<{ Variables: AuthVariables }>()`.
- Every protected route must end with `requireAuth` as the second argument before the handler.
- Route files are named `<resource>.routes.ts` and export a named `<resource>Routes` constant.
- Mount all routers in `index.ts` under `/api/<resource>`.
- Example:
  ```ts
  connectRoutes.post("/request/user", requireAuth, async (c) => { ... });
  ```

---

## 3. Response Shape

**All API responses must follow this shape:**

```ts
// Success
{ success: true, data: <payload> }

// Error
{ success: false, error: "Short error", message?: "Longer detail" }
```

- **Never** return raw objects without the `success` wrapper.
- Use appropriate HTTP status codes: `200`, `201`, `400`, `401`, `404`, `500`.
- On validation failure, return `400` with `{ success: false, error: "..." }`.

---

## 4. Authentication

- Use `authMiddleware` (global, attaches `user`/`session` to context) and `requireAuth` (per-route guard).
- Access the authenticated user with `const currentUser = c.get("user")`.
- Always null-check: `if (!currentUser) return c.json({ success: false, error: "User not found" }, 404)`.
- Auth supports two strategies: Better-Auth session cookie and fallback Bearer token (manual DB lookup in `middleware.ts`).
- Do NOT implement custom auth logic outside of `lib/auth.ts` and `lib/middleware.ts`.

---

## 5. Database Conventions

- **All schema lives in `src/db/schema.ts`** — one file, always exported.
- Column naming: `snake_case` in the database (string argument), `camelCase` in TypeScript (property name).
  ```ts
  pushToken: text("push_token"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  ```
- All IDs are `text` (UUID strings generated at the application level with `nanoid` or `crypto.randomUUID()`).
- All tables include `createdAt` and `updatedAt` timestamp columns.
- Foreign keys must specify `onDelete: "cascade"` unless there's a specific reason not to.
- After schema changes, run `npm run db:push` (development) — do not write manual SQL migrations.

---

## 6. ID Generation

- Generate IDs at the application level, not in the database.
- Use `nanoid(21)` or `crypto.randomUUID()`.
- Wrap in a local helper in the route file:
  ```ts
  function generateId(): string {
    return nanoid();
  }
  ```

---

## 7. Push Notifications

- All push notifications are sent via `publishNotification(userId, payload)` from `src/lib/ably.ts`.
- The function looks up the user's `pushToken` from the DB, then calls the **Expo Push API**.
- Fire notifications **after** the DB write succeeds, never before.
- Fire and forget — do not `await` the notification if it could delay the HTTP response:
  ```ts
  publishNotification(partnerId, { type, title, body, data }); // no await
  ```
- Notification types follow the pattern:
  ```
  connection_request | connection_accepted | connection_ended | memory_shared
  ```

---

## 8. Validation

- Use **Zod** for all request body validation.
- Define schemas at the top of each route file (before the route handlers).
- Always use `.safeParse()` and return `400` on failure:
  ```ts
  const parsed = schema.safeParse(body);
  if (!parsed.success) return c.json({ success: false, error: "Invalid request" }, 400);
  const { field } = parsed.data;
  ```

---

## 9. Error Handling

- Wrap all route bodies in `try/catch`.
- In the catch block:
  ```ts
  const msg = error instanceof Error ? error.message : "Failed to ...";
  console.error("[Route] error:", error);
  return c.json({ success: false, error: msg }, 500);
  ```
- Use descriptive `console.error` tags (e.g., `[Connect]`, `[Upload]`, `[Push]`) to aid log filtering.

---

## 10. File Uploads & Storage

- All user media (photos, videos, audio) is uploaded to **AWS S3**.
- The S3 client is configured in `src/lib/s3.ts` (or equivalent).
- Upload logic lives in `src/routes/upload.routes.ts`.
- Always generate a unique S3 key using the user's ID and a timestamp/nanoid to prevent collisions.
- Return a public or pre-signed URL in the response for the frontend to use.

---

## 11. Things to Never Do

- **Never** expose raw database errors to the client — always map to a generic message.
- **Never** bypass `requireAuth` on a user-specific endpoint.
- **Never** store plain-text passwords outside of Better-Auth's managed flow.
- **Never** add secrets (API keys, DATABASE_URL) to the codebase — use `.env` only.
- **Never** add Ably, Socket.io, or WebSocket code — the backend is push-only.
- **Never** add a new route without hooking it up in `src/index.ts`.
