import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import { ZodError } from 'zod';
import { env } from './config/env.js';
import { AppError } from './lib/errors.js';
import { attachRealtime } from './realtime.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { conversationRoutes } from './modules/conversations/conversations.routes.js';
import { userRoutes } from './modules/users/users.routes.js';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: env.NODE_ENV === 'production' ? 'info' : 'debug' },
    bodyLimit: 16 * 1024, // 16 KB is plenty for JSON text; blocks oversized payloads
  });

  // Security headers (X-Content-Type-Options, etc.).
  await app.register(helmet);
  // Browsers only call us from the listed origins. Native mobile apps ignore CORS.
  await app.register(cors, { origin: env.CORS_ORIGINS });
  // A baseline limit for every route; auth routes set a tighter one.
  await app.register(rateLimit, { max: 120, timeWindow: '1 minute' });
  await app.register(jwt, { secret: env.JWT_SECRET });

  // One place that turns any error into a consistent JSON shape: { error: { message } }.
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({
        error: {
          message: 'Invalid request',
          details: error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        },
      });
    }
    if (error instanceof AppError) {
      return reply.code(error.statusCode).send({ error: { message: error.message } });
    }
    // Errors raised by Fastify plugins (rate limit 429, malformed JSON 400, ...).
    const status = (error as { statusCode?: number }).statusCode;
    if (typeof status === 'number' && status >= 400 && status < 500) {
      return reply.code(status).send({ error: { message: (error as Error).message } });
    }
    // Anything else is our bug: log it, but never show internals to the client.
    request.log.error(error);
    return reply.code(500).send({ error: { message: 'Internal server error' } });
  });

  app.get('/health', async () => ({ status: 'ok' }));

  await app.register(
    async (api) => {
      await api.register(authRoutes);
      await api.register(userRoutes);
      await api.register(conversationRoutes);
    },
    { prefix: '/api/v1' },
  );

  attachRealtime(app);

  return app;
}
