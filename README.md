# my_message_be

REST and realtime backend for **my_message**, a one-to-one chat app. The mobile client lives in
[my_message_fe](https://github.com/VigneshJagannadhan/my_message_fe).

The project is built in levels: each level is small, runnable and secure at the basics, then
improved in the next. This repo is at **Level 1** (simple and secure). See [Roadmap](#roadmap).

## Tech stack

| Concern | Choice |
| --- | --- |
| Runtime / language | Node 22+, TypeScript (strict) |
| HTTP framework | Fastify 5 |
| Database | PostgreSQL 17 (Docker Compose) |
| ORM / migrations | Prisma 7 |
| Validation | Zod 4 (requests and environment) |
| Auth | JWT (`@fastify/jwt`), argon2 password hashing |
| Realtime | Socket.IO |
| Hardening | Helmet, CORS allow-list, rate limiting on auth routes |

## Getting started

Prerequisites: Node 22+, Docker.

```bash
git clone git@github.com:VigneshJagannadhan/my_message_be.git
cd my_message_be

git config core.hooksPath .githooks   # enable the commit message check (see Engineering standards)
cp .env.example .env                  # then set JWT_SECRET (see the comment inside)
docker compose up -d                  # starts Postgres on 127.0.0.1:5432
npm install
npm run db:migrate                    # creates the tables and generates the Prisma client
npm run dev                           # API on http://localhost:3000
npm run smoke                         # in another terminal: end-to-end check of every endpoint
```

`src/generated/` (the Prisma client) is git-ignored. `npm run db:migrate` creates it; if you only
want to build, run `npm run db:generate` first.

### Environment variables

Validated with Zod at boot. The server refuses to start with a clear message if anything is wrong.

| Variable | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | yes | Postgres connection string |
| `JWT_SECRET` | yes | At least 32 characters. Generate one with the command in `.env.example` |
| `PORT` | no | Default `3000` |
| `NODE_ENV` | no | `development` (default), `test` or `production` |
| `CORS_ORIGINS` | no | Comma-separated browser origins. Native mobile apps do not need CORS |

### Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Start with file watching |
| `npm run build` / `npm start` | Compile to `dist/` and run it |
| `npm run typecheck` | Type check without emitting |
| `npm run db:migrate` | Create and apply a migration (development) |
| `npm run db:deploy` | Apply existing migrations (production) |
| `npm run db:generate` | Regenerate the Prisma client |
| `npm run smoke` | End-to-end script covering every endpoint, including authorization failures |

## API

All routes are under `/api/v1`, speak JSON, and need `Authorization: Bearer <token>` except the auth routes.

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/auth/register` | `{name, email, phone, password}` returns `{token, user}` |
| POST | `/auth/login` | `{identifier (email or phone), password}` returns `{token, user}` |
| GET | `/users/me` | my profile |
| PATCH | `/users/me` | edit `name` and/or `phone` |
| GET | `/users?search=` | find people (name, or exact email/phone) |
| GET | `/conversations` | my chats, latest first, with last message |
| POST | `/conversations` | `{userId}` get or create a 1:1 chat |
| GET | `/conversations/:id` | chat detail (participants) |
| GET | `/conversations/:id/messages?before=&limit=` | history, newest first. Returns `nextCursor`; pass it as `before` for the next page |
| POST | `/conversations/:id/messages` | `{body}` send a message |
| GET | `/health` (no prefix) | liveness |

Errors always look like `{ "error": { "message": "...", "details"?: [...] } }`.

### Realtime (Socket.IO)

Connect to the server root with `auth: { token }`. The server emits `message:new` (the message
object) to the other participants whenever a message is sent. At Level 1 sockets are
receive-only; sending goes through the REST endpoint.

## Security

Simple does not mean insecure. In place from the first level:

- **Passwords:** argon2 hashes only, never plain text. Login returns the same error for an
  unknown user and a wrong password, and does comparable work for both, so response time does not
  reveal which emails are registered.
- **Input validation:** every request body, query and environment variable is parsed with Zod
  at the edge before any logic runs.
- **Authorization:** every conversation route checks the caller is a participant, so a logged-in
  user cannot read another user's chat by guessing ids (covered in the smoke script).
- **Hardening:** security headers (Helmet), CORS allow-list, rate limiting on register and login.
- **Secrets:** `.env` is git-ignored; only `.env.example` with placeholders is committed.

## Data model

`User`, `Conversation`, `ConversationParticipant` (join table) and `Message`. A 1:1 chat is a
conversation with two participants, so group chats later need no schema change. A unique
`directKey` lets the database itself prevent duplicate chats between the same pair, even under
concurrent requests. History is paginated with a cursor, not page numbers. Full schema:
[`prisma/schema.prisma`](prisma/schema.prisma).

## Project layout

```
src/config/env.ts          validated environment
src/db.ts                  Prisma client
src/app.ts                 builds the Fastify app (plugins, errors, routes)
src/server.ts              starts it
src/realtime.ts            Socket.IO
src/modules/<feature>/     routes per feature (auth, users, conversations)
src/plugins/auth.ts        JWT authentication
src/lib/                   shared errors and schemas
prisma/schema.prisma       the data model
prisma/migrations/         versioned migrations
scripts/smoke.ts           end-to-end smoke test
docs/LEARNING.md           design notes: why each part is built the way it is
.githooks/commit-msg       commit message check
```

## Engineering standards

- **Conventional Commits are enforced.** Every commit message must look like
  `type(optional-scope): description`, with types `feat fix docs style refactor perf test build ci
  chore revert`, a lowercase description with no trailing period, and a first line of at most 72
  characters. A `commit-msg` hook in [`.githooks/`](.githooks/commit-msg) rejects anything else
  before the commit is created. Enable it once per clone:

  ```bash
  git config core.hooksPath .githooks
  ```

  ```
  feat(auth): add login endpoint        accepted
  fix: duplicate chat on double tap     accepted
  updated stuff                         rejected
  ```

- **Strict TypeScript** with `npm run typecheck`.
- **Schema changes go through migrations**, never edited by hand in the database.
- **No secrets in git.** Configuration comes from the environment.
- **Small, reviewable commits**, one logical change each.

## Roadmap

| Level | Focus |
| --- | --- |
| 1 (current) | Simple and secure: auth, 1:1 chats, history, realtime receive |
| 2 | Short-lived access tokens with rotating refresh tokens, socket sending with acknowledgements and idempotent retries |
| 3 | Automated test suite. Phone verification (SMS OTP) comes much later |

Known simplifications at Level 1 (7-day token, no logout, unverified phone numbers, smoke script
instead of unit tests) are listed with their fixes in [`docs/LEARNING.md`](docs/LEARNING.md).
