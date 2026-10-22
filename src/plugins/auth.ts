import type { FastifyRequest } from 'fastify';
import { AppError } from '../lib/errors.js';

// Tell TypeScript what we put inside the JWT: just the user id (the "sub" claim).
declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string };
    user: { sub: string };
  }
}

// Use as a route `preHandler`. Rejects the request unless it has a valid Bearer token.
export async function authenticate(request: FastifyRequest): Promise<void> {
  try {
    await request.jwtVerify();
  } catch {
    throw new AppError(401, 'Unauthorized');
  }
}

export function currentUserId(request: FastifyRequest): string {
  return request.user.sub;
}
