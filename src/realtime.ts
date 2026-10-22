import type { FastifyInstance } from 'fastify';
import { Server } from 'socket.io';
import { env } from './config/env.js';

let io: Server | undefined;

const userRoom = (userId: string) => `user:${userId}`;

// Level 1 realtime is push-only: clients connect and listen, the server emits
// when something happens (a message was saved). Sending still goes through REST.
export function attachRealtime(app: FastifyInstance): void {
  io = new Server(app.server, {
    cors: { origin: env.CORS_ORIGINS },
  });

  // Runs once per connection: only a valid JWT gets in.
  io.use((socket, next) => {
    const token: unknown = socket.handshake.auth['token'];
    if (typeof token !== 'string') {
      next(new Error('unauthorized'));
      return;
    }
    try {
      const payload = app.jwt.verify<{ sub: string }>(token);
      socket.data['userId'] = payload.sub;
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    // Every user has a private "room" named after their id. To reach a user we
    // emit to their room, so the server never needs to track individual sockets
    // (one user can have several devices connected).
    void socket.join(userRoom(socket.data['userId'] as string));
  });

  app.addHook('onClose', async () => {
    await io?.close();
  });
}

export function emitToUser(userId: string, event: string, payload: unknown): void {
  io?.to(userRoom(userId)).emit(event, payload);
}
