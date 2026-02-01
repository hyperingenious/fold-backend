# Fold Backend API

A modern, type-safe backend API built with Hono, Better-Auth, Drizzle ORM, and Appwrite Storage.

## 🚀 Features

- **Authentication** - Email/password & Google OAuth via Better-Auth
- **User Management** - Profile CRUD, session management
- **File Uploads** - Single/multiple file uploads via Appwrite
- **API Documentation** - Interactive Swagger UI

## 📦 Tech Stack

- **Framework**: [Hono](https://hono.dev/) - Ultrafast web framework
- **Database**: [Neon PostgreSQL](https://neon.tech/) + [Drizzle ORM](https://orm.drizzle.team/)
- **Auth**: [Better-Auth](https://www.better-auth.com/)
- **Storage**: [Appwrite](https://appwrite.io/)
- **Runtime**: Node.js with TypeScript

## 🛠 Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

Copy `.env.example` to `.env` and fill in your values:

```env
# Database (Neon PostgreSQL)
DATABASE_URL="postgresql://..."

# Better Auth
BETTER_AUTH_SECRET="your-32-char-secret"
BETTER_AUTH_URL="http://localhost:3000"

# Google OAuth
GOOGLE_CLIENT_ID="..."
GOOGLE_CLIENT_SECRET="..."

# Appwrite Storage
APPWRITE_ENDPOINT="https://cloud.appwrite.io/v1"
APPWRITE_PROJECT_ID="..."
APPWRITE_API_KEY="..."
APPWRITE_BUCKET_ID="..."
```

### 3. Push database schema

```bash
npm run db:push
```

### 4. Start development server

```bash
npm run dev
```

## 📚 API Documentation

Once the server is running:

- **Swagger UI**: [http://localhost:3000/docs](http://localhost:3000/docs)
- **OpenAPI JSON**: [http://localhost:3000/openapi.json](http://localhost:3000/openapi.json)

## 🔗 API Endpoints

### Health
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check |

### Authentication
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/sign-up/email` | Register with email |
| POST | `/api/auth/sign-in/email` | Sign in with email |
| POST | `/api/auth/sign-in/social` | OAuth (Google) |
| POST | `/api/auth/sign-out` | Sign out |
| GET | `/api/auth/session` | Get current session |
| POST | `/api/auth/forgot-password` | Request password reset |

### User Management
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/user/me` | Get profile |
| PATCH | `/api/user/me` | Update profile |
| DELETE | `/api/user/me` | Delete account |
| POST | `/api/user/change-password` | Change password |
| GET | `/api/user/sessions` | List sessions |
| POST | `/api/user/revoke-sessions` | Revoke other sessions |

### File Upload
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/upload` | Upload single file |
| POST | `/api/upload/multiple` | Upload multiple files |
| POST | `/api/upload/avatar` | Upload avatar image |
| GET | `/api/upload/:id` | Get file details |
| DELETE | `/api/upload/:id` | Delete file |
| GET | `/api/upload/list/all` | List all files |

## 📜 Scripts

```bash
npm run dev          # Start dev server with hot reload
npm run build        # Build for production
npm run db:push      # Push schema to database
npm run db:generate  # Generate migrations
npm run db:migrate   # Run migrations
npm run db:studio    # Open Drizzle Studio
```

## 📁 Project Structure

```
src/
├── db/
│   ├── index.ts        # Database connection
│   └── schema.ts       # Drizzle schema
├── lib/
│   ├── appwrite.ts     # Appwrite client
│   ├── auth.ts         # Better-Auth config
│   ├── middleware.ts   # Auth middleware
│   └── openapi.ts      # OpenAPI spec
├── routes/
│   ├── upload.routes.ts
│   └── user.routes.ts
└── index.ts            # Main app entry
```

## 📄 License

MIT
