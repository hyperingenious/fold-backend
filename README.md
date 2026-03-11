# Fold Backend API

A modern, type-safe backend API powering the Fold mobile app. Built with Hono, Better-Auth, Drizzle ORM, and Neon Serverless Postgres.

## 🚀 Features

- **Authentication** - Email/password & Google OAuth via Better-Auth
- **User Management** - Profile CRUD, connection requests (friends), activity tracking
- **Timeline & Media** - Timeline entries with text, audio, photos, videos (stored in AWS S3)
- **Shared Memories** - Granular sharing of timeline entries between connected users

## 📦 Tech Stack

- **Framework**: [Hono](https://hono.dev/) - Ultrafast, edge-ready web framework
- **Database**: [Neon PostgreSQL](https://neon.tech/) + [Drizzle ORM](https://orm.drizzle.team/)
- **Auth**: [Better-Auth](https://www.better-auth.com/)
- **Storage**: AWS S3 (via `@aws-sdk/client-s3`)
- **Push Notifications**: Expo Server SDK
- **Runtime**: Node.js with TypeScript

## 🛠 Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

Copy `.env.example` to `.env` and fill in your values (or create a new `.env` file):

```env
# Database (Neon PostgreSQL)
DATABASE_URL="postgresql://user:password@ep-cool...neon.tech/fold"

# Better Auth
BETTER_AUTH_SECRET="your-32-char-secret"
BETTER_AUTH_URL="http://localhost:3000"

# Google OAuth
GOOGLE_CLIENT_ID="..."
GOOGLE_CLIENT_SECRET="..."

# AWS S3 Storage (for media uploads)
S3_REGION="us-east-1"
S3_ACCESS_KEY="..."
S3_SECRET_KEY="..."
S3_BUCKET_NAME="fold-app-media"
```

### 3. Database Schema

Push the Drizzle schema directly to your Neon database:

```bash
npm run db:push
```

### 4. Start Development Server

```bash
npm run dev
```
The server will start on `http://localhost:3000`.

## 🔗 Core API Routes

The backend exposes several modular routers under `/api`:

- **`/api/auth/*`** - Better-Auth endpoints (login, register, session)
- **`/api/user/*`** - User profile management and settings (auto-location, screenshot protection)
- **`/api/timeline/*`** - Create and fetch memories (photos, videos, audio, text)
- **`/api/profile/*`** - Activity levels, streaks, badges, and Fold Score
- **`/api/connect/*`** - Social graph: friend requests, invite codes, and memory sharing
- **`/api/upload/*`** - Secure asset uploads to S3
- **`/api/config/*`** - Push token registration and app configuration

## 📜 Scripts

```bash
npm run dev          # Start dev server with hot reload
npm run build        # Build for production
npm run start        # Run production build
npm run db:push      # Push schema changes to database
npm run db:studio    # Open Drizzle local GUI
```

## 📄 License

MIT
