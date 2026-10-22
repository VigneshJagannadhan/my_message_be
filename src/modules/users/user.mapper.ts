import type { User } from '../../generated/prisma/client.js';

// We never send a database row straight to a client. Mapping explicitly means a new
// column (like passwordHash) can never leak by accident.

// What a user sees about themselves.
export function toOwnUser(user: User) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    createdAt: user.createdAt,
  };
}

// What a user sees about other people: the minimum needed to show a chat.
export function toPublicUser(user: Pick<User, 'id' | 'name'>) {
  return { id: user.id, name: user.name };
}
