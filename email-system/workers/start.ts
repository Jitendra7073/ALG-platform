/**
 * Worker Entry Point
 * Run with: tsx workers/start.ts
 * Environment variables are loaded via -r dotenv/config flag
 */

import { createEmailWorker } from './email-worker';
import { createRecoveryWorker } from './recovery-worker';

const WORKER_TYPE = process.env.WORKER_TYPE || 'email';

async function main() {
  console.log(`🚀 Starting ${WORKER_TYPE} worker...`);

  if (WORKER_TYPE === 'email') {
    const worker = createEmailWorker({
      concurrency: parseInt(process.env.BULLMQ_CONCURRENCY || '5'),
    });

    // Graceful shutdown
    process.on('SIGINT', async () => {
      console.log('\n🛑 Shutting down worker...');
      await worker.stop();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      console.log('\n🛑 Shutting down worker...');
      await worker.stop();
      process.exit(0);
    });

    console.log('✅ Email worker started. Press Ctrl+C to stop.');
    // Keep process alive
    process.stdin.resume();

  } else if (WORKER_TYPE === 'recovery') {
    const worker = await createRecoveryWorker();

    // Graceful shutdown
    process.on('SIGINT', async () => {
      console.log('\n🛑 Shutting down recovery worker...');
      await worker.stop();
      process.exit(0);
    });

    console.log('✅ Recovery worker started. Press Ctrl+C to stop.');
    process.stdin.resume();

  } else {
    console.error(`❌ Unknown worker type: ${WORKER_TYPE}`);
    console.log('Valid types: email, recovery');
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('❌ Worker failed to start:', error);
  process.exit(1);
});
