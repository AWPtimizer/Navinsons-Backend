import { createApp } from './app.js';
import { connectDb } from './config/db.js';
import { assertRuntimeEnv, env } from './config/env.js';

const start = async () => {
  assertRuntimeEnv();
  await connectDb();

  const app = createApp();
  app.listen(env.port, () => {
    console.log(`[server] listening on http://localhost:${env.port}`);
  });
};

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
