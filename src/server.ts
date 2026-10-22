import { buildApp } from './app.js';
import { env } from './config/env.js';
import { prisma } from './db.js';

const app = await buildApp();

// Shut down cleanly on Ctrl+C or when the host stops the process.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  });
}

try {
  await app.listen({ port: env.PORT, host: '0.0.0.0' });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
