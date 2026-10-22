// End-to-end smoke test against a RUNNING server (npm run dev in another terminal).
// Usage: npm run smoke            (defaults to http://localhost:3000)
//        BASE_URL=http://host:3000 npm run smoke
import { io } from 'socket.io-client';

const BASE_URL = process.env['BASE_URL'] ?? 'http://localhost:3000';
const API = `${BASE_URL}/api/v1`;

type Json = Record<string, any>;

async function call(method: string, path: string, token?: string, body?: unknown) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const json = (await response.json().catch(() => ({}))) as Json;
  return { status: response.status, json };
}

let failures = 0;
function check(label: string, ok: boolean, extra?: unknown) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) {
    failures++;
    if (extra !== undefined) console.log('      got:', JSON.stringify(extra));
  }
}

const run = Date.now().toString().slice(-8);
const users = ['alice', 'bob', 'eve'].map((name, i) => ({
  name,
  email: `${name}.${run}@example.com`,
  phone: `+1415${run.slice(-4)}${i}${i}${i}`.slice(0, 12),
  password: 'correct horse battery',
}));
const [alice, bob, eve] = users as [(typeof users)[0], (typeof users)[0], (typeof users)[0]];

// 1. Register + login
const tokens: Record<string, string> = {};
const ids: Record<string, string> = {};
for (const u of users) {
  const r = await call('POST', '/auth/register', undefined, u);
  check(`register ${u.name}`, r.status === 201 && !!r.json['token'], r);
  const l = await call('POST', '/auth/login', undefined, { identifier: u.phone, password: u.password });
  check(`login ${u.name} by phone`, l.status === 200, l);
  tokens[u.name] = l.json['token'];
  ids[u.name] = l.json['user'].id;
}
check('duplicate register is 409', (await call('POST', '/auth/register', undefined, alice)).status === 409);
check(
  'wrong password is 401',
  (await call('POST', '/auth/login', undefined, { identifier: alice.email, password: 'nope-nope-nope' })).status === 401,
);
check('login by email works', (await call('POST', '/auth/login', undefined, { identifier: alice.email, password: alice.password })).status === 200);
check('invalid body is 400', (await call('POST', '/auth/register', undefined, { name: '' })).status === 400);

// 2. Profile
check('me requires auth', (await call('GET', '/users/me')).status === 401);
const me = await call('GET', '/users/me', tokens['alice']);
check('get me', me.status === 200 && me.json['user'].email === alice.email && !('passwordHash' in me.json['user']), me);
const edited = await call('PATCH', '/users/me', tokens['alice'], { name: 'Alice Updated' });
check('edit profile', edited.status === 200 && edited.json['user'].name === 'Alice Updated', edited);

// 3. Search
const found = await call('GET', '/users?search=bob', tokens['alice']);
check('search finds bob, hides email/phone', found.status === 200 && found.json['users'].some((u: Json) => u.id === ids['bob'] && !('email' in u)), found);

// 4. Conversation + realtime
const socket = io(BASE_URL, { auth: { token: tokens['bob'] }, transports: ['websocket'] });
const received = new Promise<Json>((resolve, reject) => {
  socket.on('message:new', resolve);
  setTimeout(() => reject(new Error('timed out waiting for message:new')), 5000);
});
await new Promise<void>((resolve, reject) => {
  socket.on('connect', () => resolve());
  socket.on('connect_error', reject);
});
check('socket connects with valid token', socket.connected);

const created = await call('POST', '/conversations', tokens['alice'], { userId: ids['bob'] });
check('create conversation', created.status === 201, created);
const convoId: string = created.json['conversation'].id;
const again = await call('POST', '/conversations', tokens['bob'], { userId: ids['alice'] });
check('same chat reopened from other side (no duplicate)', again.status === 200 && again.json['conversation'].id === convoId, again);
check('cannot chat with yourself', (await call('POST', '/conversations', tokens['alice'], { userId: ids['alice'] })).status === 400);

const sent = await call('POST', `/conversations/${convoId}/messages`, tokens['alice'], { body: 'hello bob' });
check('send message', sent.status === 201 && sent.json['message'].body === 'hello bob', sent);
const pushed = await received.catch((e: Error) => ({ error: e.message }) as Json);
check('bob receives message:new live', pushed['body'] === 'hello bob', pushed);

for (let i = 2; i <= 5; i++) await call('POST', `/conversations/${convoId}/messages`, tokens['alice'], { body: `msg ${i}` });

// 5. History + pagination
const page1 = await call('GET', `/conversations/${convoId}/messages?limit=3`, tokens['bob']);
check('history page 1 has 3 + cursor', page1.status === 200 && page1.json['messages'].length === 3 && !!page1.json['nextCursor'], page1);
const page2 = await call('GET', `/conversations/${convoId}/messages?limit=3&before=${page1.json['nextCursor']}`, tokens['bob']);
check('history page 2 has remaining 2, no cursor', page2.json['messages'].length === 2 && page2.json['nextCursor'] === null, page2);

// 6. Chats list + detail
const list = await call('GET', '/conversations', tokens['bob']);
check('list shows chat with last message', list.json['conversations']?.[0]?.lastMessage?.body === 'msg 5', list);
check('chat detail', (await call('GET', `/conversations/${convoId}`, tokens['bob'])).status === 200);

// 7. Authorization: an outsider must not see or write
check('outsider cannot read chat (404)', (await call('GET', `/conversations/${convoId}`, tokens['eve'])).status === 404);
check('outsider cannot read history (404)', (await call('GET', `/conversations/${convoId}/messages`, tokens['eve'])).status === 404);
check('outsider cannot send (404)', (await call('POST', `/conversations/${convoId}/messages`, tokens['eve'], { body: 'hi' })).status === 404);
const badSocket = io(BASE_URL, { auth: { token: 'garbage' }, transports: ['websocket'], reconnection: false });
const rejected = await new Promise<boolean>((resolve) => {
  badSocket.on('connect_error', () => resolve(true));
  badSocket.on('connect', () => resolve(false));
});
check('socket rejects bad token', rejected);

socket.close();
badSocket.close();
console.log(failures === 0 ? '\nAll checks passed' : `\n${failures} check(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
