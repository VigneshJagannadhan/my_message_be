# Level 1 learning notes

Read these with the code open. Each section is one idea, in the order a request travels.

## 1. Request lifecycle (src/app.ts)
A request passes through: helmet (security headers) -> CORS -> rate limit -> route
`preHandler` (auth) -> your handler -> reply. Any error thrown anywhere lands in the one
`setErrorHandler`, which decides what the client sees. Rule: clients get a clean message,
we get the details in the logs.

## 2. Validate everything at the edge (Zod)
Never trust input. Every handler starts with `schema.parse(request.body)`. Bad input throws
a `ZodError` which becomes a 400. After parsing, TypeScript knows the exact shape, so the
rest of the handler is type safe.

## 3. Passwords (argon2)
We never store passwords, only a slow, salted hash. Slow on purpose: it makes guessing
billions of passwords expensive. Login returns the same "Invalid credentials" for unknown user
and wrong password, and verifies against a dummy hash when the user is unknown, so response
time does not reveal which emails are registered.

## 4. Authentication vs authorization
- Authentication: who are you? A JWT (signed token holding your user id) proves it. The
  server signs with `JWT_SECRET`; nobody can forge a token without it.
- Authorization: may you do this? `requireParticipant` runs on every chat route. Without it,
  any logged-in user could read any chat by guessing ids. This is the most common real
  world API bug (IDOR), so it is checked everywhere and tested in the smoke script.

## 5. The data model (prisma/schema.prisma)
Users, Conversations, a join table (ConversationParticipant), Messages. A 1:1 chat is just a
conversation with two participants, so groups later need no schema change. `directKey` has a
unique constraint so the database itself prevents two chats between the same pair, even when
two requests arrive at the same instant (a race condition). Prefer making the database
enforce rules over checking in code only.

## 6. Pagination
History uses a cursor ("give me messages older than this id") instead of page numbers.
Page numbers break when new messages arrive between requests (items shift); cursors do not.
We fetch `limit + 1` rows to know whether another page exists without a second query.

## 7. Realtime (src/realtime.ts)
HTTP is request/response; the server cannot speak first. A socket is a long-lived connection
that lets it push. Order matters: save to the database first, then push. If the push is
missed (user offline), nothing is lost because history has it.
Each user has a private room `user:<id>`; emitting to the room reaches all their devices.

## 8. Deliberately simple (fixed in Level 2)
- One 7-day token: if stolen it works for 7 days and there is no logout. Level 2: short-lived
  access token + rotating refresh token.
- The socket accepts a valid token without checking the user still exists.
- Sending is REST only; sockets only receive. Level 2 adds socket sending with acknowledgements
  and idempotency (safe retries).
- Phone numbers are unverified (anyone can claim any number). Fixed with SMS OTP much later.
- No automated tests besides the smoke script. Level 3.
