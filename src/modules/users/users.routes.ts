import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../db.js';
import { AppError, isUniqueViolation } from '../../lib/errors.js';
import { nameSchema, phoneSchema } from '../../lib/schemas.js';
import { authenticate, currentUserId } from '../../plugins/auth.js';
import { toOwnUser, toPublicUser } from './user.mapper.js';

const updateProfileBody = z
  .object({ name: nameSchema, phone: phoneSchema })
  .partial()
  .strict()
  .refine((body) => Object.keys(body).length > 0, 'Provide at least one field to update');

const searchQuery = z.object({
  search: z.string().trim().min(2).max(80),
});

export async function userRoutes(app: FastifyInstance): Promise<void> {
  app.get('/users/me', { preHandler: authenticate }, async (request) => {
    const user = await prisma.user.findUnique({ where: { id: currentUserId(request) } });
    if (!user) throw new AppError(404, 'User not found');
    return { user: toOwnUser(user) };
  });

  app.patch('/users/me', { preHandler: authenticate }, async (request) => {
    const body = updateProfileBody.parse(request.body);
    try {
      const user = await prisma.user.update({
        where: { id: currentUserId(request) },
        data: body,
      });
      return { user: toOwnUser(user) };
    } catch (error) {
      if (isUniqueViolation(error)) throw new AppError(409, 'Phone is already in use');
      throw error;
    }
  });

  // Find people to start a chat with. Matches by name (partial) or exact email/phone.
  app.get('/users', { preHandler: authenticate }, async (request) => {
    const { search } = searchQuery.parse(request.query);
    const users = await prisma.user.findMany({
      where: {
        id: { not: currentUserId(request) },
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { email: search.toLowerCase() },
          { phone: search },
        ],
      },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
      take: 20,
    });
    return { users: users.map(toPublicUser) };
  });
}
