import { Worker, Job } from 'bullmq';
import { connection } from './djQueue';
import { scriptGenerator } from '../services/scriptGenerator';

export function startWorker() {
  const worker = new Worker('dj-generation', async (job: Job) => {
    console.log(`Processing job ${job.id} - ${job.name}`);
    
    if (job.name === 'generate-script') {
      const { scriptId } = job.data;
      await scriptGenerator.generateForPlaylist(scriptId);
    }
  }, { connection });

  worker.on('completed', (job) => {
    console.log(`Job ${job.id} completed!`);
  });

  worker.on('failed', (job, err) => {
    console.error(`Job ${job?.id} failed with ${err.message}`);
  });

  console.log('DJ Worker started');
}
