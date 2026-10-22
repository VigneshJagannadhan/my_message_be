import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../db.js';
import { AppError, isUniqueViolation } from '../../lib/errors.js';
import { idSchema } from '../../lib/schemas.js';
import { authenticate, currentUserId } from '../../plugins/auth.js';
import { emitToUser } from '../../realtime.js';
import { toPublicUser } from '../users/user.mapper.js';

const idParams = z.object({ id: idSchema });
const createBody = z.object({ userId: idSchema });
const sendBody = z.object({ body: z.string().trim().min(1).max(4000) });
const historyQuery = z.object({
  // Id of the oldest message the client already has; we return messages older than it.
  before: idSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

const conversationInclude = {
  participants: { include: { user: { select: { id: true, name: true } } } },
  messages: { orderBy: { createdAt: 'desc' }, take: 1 },
} as const;

type ConversationWithRelations = NonNullable<
  Awaited<ReturnType<typeof findConversation>>
>;

function findConversation(id: string) {
  return prisma.conversation.findUnique({ where: { id }, include: conversationInclude });
}

function toConversation(conversation: ConversationWithRelations) {
  const last = conversation.messages[0];
  return {
    id: conversation.id,
    participants: conversation.participants.map((p) => toPublicUser(p.user)),
    lastMessage: last ? toMessage(last) : null,
    updatedAt: conversation.updatedAt,
  };
}

function toMessage(message: {
  id: string;
  conversationId: string;
  senderId: string;
  body: string;
  createdAt: Date;
}) {
  return {
    id: message.id,
    conversationId: message.conversationId,
    senderId: message.senderId,
    body: message.body,
    createdAt: message.createdAt,
  };
}

// The authorization rule for everything chat related: you must be a participant.
// We answer 404 (not 403) for non-participants so ids of other people's chats
// cannot be probed for existence.
async function requireParticipant(userId: string, conversationId: string) {
  const participant = await prisma.conversationParticipant.findUnique({
    where: { conversationId_userId: { conversationId, userId } },
  });
  if (!participant) throw new AppError(404, 'Conversation not found');
}

export async function conversationRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate);

  // Home screen: my chats, most recently active first.
  app.get('/conversations', async (request) => {
    const conversations = await prisma.conversation.findMany({
      where: { participants: { some: { userId: currentUserId(request) } } },
      include: conversationInclude,
      orderBy: { updatedAt: 'desc' },
    });
    return { conversations: conversations.map(toConversation) };
  });

  // Start (or reopen) a 1:1 chat with another user.
  app.post('/conversations', async (request, reply) => {
    const me = currentUserId(request);
    const { userId: otherId } = createBody.parse(request.body);
    if (otherId === me) throw new AppError(400, 'You cannot start a chat with yourself');

    const other = await prisma.user.findUnique({ where: { id: otherId }, select: { id: true } });
    if (!other) throw new AppError(404, 'User not found');

    const directKey = [me, otherId].sort().join(':');

    const existing = await prisma.conversation.findUnique({
      where: { directKey },
      include: conversationInclude,
    });
    if (existing) return { conversation: toConversation(existing) };

    try {
      const created = await prisma.conversation.create({
        data: {
          directKey,
          participants: { create: [{ userId: me }, { userId: otherId }] },
        },
        include: conversationInclude,
      });
      return reply.code(201).send({ conversation: toConversation(created) });
    } catch (error) {
      // Both users tapped "start chat" at the same moment: the other request won the
      // race and the unique directKey stopped us from creating a duplicate. Use theirs.
      if (!isUniqueViolation(error)) throw error;
      const winner = await prisma.conversation.findUniqueOrThrow({
        where: { directKey },
        include: conversationInclude,
      });
      return { conversation: toConversation(winner) };
    }
  });

  app.get('/conversations/:id', async (request) => {
    const { id } = idParams.parse(request.params);
    await requireParticipant(currentUserId(request), id);
    const conversation = await findConversation(id);
    if (!conversation) throw new AppError(404, 'Conversation not found');
    return { conversation: toConversation(conversation) };
  });

  // History, newest first, loaded in pages ("infinite scroll upwards").
  app.get('/conversations/:id/messages', async (request) => {
    const { id } = idParams.parse(request.params);
    const { before, limit } = historyQuery.parse(request.query);
    await requireParticipant(currentUserId(request), id);

    // Ask for one extra row: if we get it, there is another page.
    const rows = await prisma.message.findMany({
      where: { conversationId: id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(before ? { cursor: { id: before }, skip: 1 } : {}),
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    return {
      messages: page.map(toMessage),
      nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
    };
  });

  app.post('/conversations/:id/messages', async (request, reply) => {
    const me = currentUserId(request);
    const { id } = idParams.parse(request.params);
    const { body } = sendBody.parse(request.body);
    await requireParticipant(me, id);

    // Save the message and bump the conversation's activity time together or not at all.
    const message = await prisma.$transaction(async (tx) => {
      const created = await tx.message.create({
        data: { conversationId: id, senderId: me, body },
      });
      await tx.conversation.update({ where: { id }, data: { updatedAt: created.createdAt } });
      return created;
    });

    // Persist first, then push. If the push is missed (user offline) nothing is lost:
    // the message is in the database and shows up in history.
    const recipients = await prisma.conversationParticipant.findMany({
      where: { conversationId: id, userId: { not: me } },
      select: { userId: true },
    });
    const payload = toMessage(message);
    for (const { userId } of recipients) {
      emitToUser(userId, 'message:new', payload);
    }

    return reply.code(201).send({ message: payload });
  });
}
