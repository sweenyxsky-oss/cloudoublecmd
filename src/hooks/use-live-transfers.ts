import { useEffect, useRef, useState } from 'react';
import { controlLiveJob, isSignedOut, listLiveJobs, startLiveJob, LIVE_PREFIX, type LiveJob } from '@/lib/live-filesystem';
import type { TransferJob } from '@/lib/mock-transfers';

// Real NAS transfers: the service owns the job; this hook only polls and relays pause/cancel.
export const LIVE_JOB_OFFSET = 100000;
const toTransfer = (job: LiveJob): TransferJob => ({
  id: LIVE_JOB_OFFSET + job.id, total: job.total, processed: job.processed, state: job.state, rate: job.rate ?? 0, conflict: job.conflict ?? null, ...(job.error ? { error: job.error } : {}),
  operation: { type: job.type, source: `${LIVE_PREFIX}${job.source.connection}${job.source.path === '/' ? '' : job.source.path}`, destination: `${LIVE_PREFIX}${job.destination.connection}${job.destination.path === '/' ? '' : job.destination.path}`, names: job.names },
});

export function useLiveTransfers(enabled: boolean, settled: (job: TransferJob) => void) {
  const [jobs, setJobs] = useState<TransferJob[]>([]);
  const [dismissed, setDismissed] = useState<number[]>([]);
  const [polling, setPolling] = useState(false);
  const known = useRef(new Map<number, string>());
  const settledRef = useRef(settled); settledRef.current = settled;

  function absorb(list: LiveJob[]) {
    const mapped = list.map(toTransfer);
    for (const job of mapped) {
      const before = known.current.get(job.id);
      if (before && (before === 'running' || before === 'paused') && !['running', 'paused'].includes(job.state)) settledRef.current(job);
      known.current.set(job.id, job.state);
    }
    setJobs(mapped);
    setPolling(mapped.some(job => job.state === 'running' || job.state === 'paused'));
  }
  useEffect(() => { if (enabled) listLiveJobs().then(list => { list.forEach(job => known.current.set(LIVE_JOB_OFFSET + job.id, job.state)); absorb(list); }).catch(() => undefined); }, [enabled]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!enabled || !polling) return;
    const timer = window.setInterval(() => { listLiveJobs().then(absorb).catch(error => { if (isSignedOut(error)) window.location.assign('/login'); }); }, 500);
    return () => window.clearInterval(timer);
  }, [enabled, polling]); // eslint-disable-line react-hooks/exhaustive-deps

  const relay = (id: number, action: 'pause' | 'resume' | 'cancel') => controlLiveJob(id - LIVE_JOB_OFFSET, action).catch(() => undefined).finally(() => { listLiveJobs().then(absorb).catch(() => undefined); });
  return {
    jobs: jobs.filter(job => !dismissed.includes(job.id)),
    async start(type: 'copy' | 'move', source: string, destination: string, names: string[]) {
      const job = await startLiveJob(type, source, destination, names);
      known.current.set(LIVE_JOB_OFFSET + job.id, job.state);
      absorb([...(await listLiveJobs().catch(() => [job]))]);
      return LIVE_JOB_OFFSET + job.id;
    },
    togglePause(id: number) { const job = jobs.find(item => item.id === id); if (job) void relay(id, job.state === 'paused' ? 'resume' : 'pause'); },
    cancel(id: number) { void relay(id, 'cancel'); },
    async resolve(id: number, choice: 'overwrite' | 'skip' | 'overwrite-all' | 'skip-all') { await controlLiveJob(id - LIVE_JOB_OFFSET, 'resolve', choice); absorb(await listLiveJobs()); },
    dismiss(id: number) { setDismissed(old => [...old, id]); },
  };
}
