export type OfflineJob = { id: string; type: string; payload: unknown; createdAt: string };

const KEY = 'tcds.offline.queue.v1';

export function enqueueOfflineJob(job: OfflineJob): void {
  const jobs = getOfflineJobs();
  localStorage.setItem(KEY, JSON.stringify([...jobs, job]));
}

export function getOfflineJobs(): OfflineJob[] {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '[]') as OfflineJob[]; }
  catch { return []; }
}

export function clearOfflineJobs(): void { localStorage.removeItem(KEY); }
