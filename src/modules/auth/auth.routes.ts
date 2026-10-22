import type { FastifyInstance } from 'fastify';
import argon2 from 'argon2';
import { z } from 'zod';
import { prisma } from '../../db.js';
import { AppError, isUniqueViolation } from '../../lib/errors.js';
import { emailSchema, nameSchema, passwordSchema, phoneSchema } from '../../lib/schemas.js';
import { toOwnUser } from '../users/user.mapper.js';

const registerBody = z.object({
  name: nameSchema,
  email: emailSchema,
  phone: phoneSchema,
  password: passwordSchema,
});

const loginBody = z.object({
  // Either an email or a phone number.
  identifier: z.string().trim().min(1).max(254),
  password: z.string().min(1).max(128),
});

// Stricter than the global limit: these endpoints are what attackers hammer.
const authRateLimit = { rateLimit: { max: 10, timeWindow: '1 minute' } };

// A real hash of a throwaway password. When the user does not exist we still verify
// against this, so "unknown user" and "wrong password" take the same time and an
// attacker cannot tell the two cases apart by measuring responses.
const dummyHash = await argon2.hash('not-a-real-password');

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post('/auth/register', { config: authRateLimit }, async (request, reply) => {
    const body = registerBody.parse(request.body);
    const passwordHash = await argon2.hash(body.password);

    try {
      const user = await prisma.user.create({
        data: { name: body.name, email: body.email, phone: body.phone, passwordHash },
      });
      const token = app.jwt.sign({ sub: user.id }, { expiresIn: '7d' });
      return reply.code(201).send({ token, user: toOwnUser(user) });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AppError(409, 'Email or phone is already in use');
      }
      throw error;
    }
  });

  app.post('/auth/login', { config: authRateLimit }, async (request) => {
    const body = loginBody.parse(request.body);
    const isEmail = body.identifier.includes('@');

    const user = await prisma.user.findUnique({
      where: isEmail
        ? { email: body.identifier.toLowerCase() }
        : { phone: body.identifier.replace(/\s/g, '') },
    });

    const passwordOk = await argon2.verify(user?.passwordHash ?? dummyHash, body.password);

    // Same message for "no such user" and "wrong password" (no user enumeration).
    if (!user || !passwordOk) {
      throw new AppError(401, 'Invalid credentials');
    }

    const token = app.jwt.sign({ sub: user.id }, { expiresIn: '7d' });
    return { token, user: toOwnUser(user) };
  });
}
