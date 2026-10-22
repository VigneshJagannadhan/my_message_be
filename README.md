# my_message_be

Backend for the my_message chat app. **Level 1: simple and secure.**

Stack: Node 22+, TypeScript (strict), Fastify, PostgreSQL, Prisma, Zod, Socket.IO.

## Run it

```bash
cp .env.example .env          # then set JWT_SECRET (see the comment inside)
docker compose up -d          # starts Postgres
npm install
npm run db:migrate            # creates the tables
npm run dev                   # API on http://localhost:3000
npm run smoke                 # in another terminal: end-to-end check of every endpoint
```

## API (all under `/api/v1`, JSON, `Authorization: Bearer <token>` except auth routes)

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
Connect to the server root with `auth: { token }`. The server emits `message:new`
(the message object) to the other participants whenever a message is sent.
Level 1 sockets are receive-only; sending goes through the REST endpoint.

## Layout
```
src/config/env.ts          validated environment
src/db.ts                  Prisma client
src/app.ts                 builds the Fastify app (plugins, errors, routes)
src/server.ts              starts it
src/realtime.ts            Socket.IO
src/modules/<feature>/     routes per feature
prisma/schema.prisma       the data model
scripts/smoke.ts           end-to-end smoke test
docs/LEARNING.md           what each part teaches
```
