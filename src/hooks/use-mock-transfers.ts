import { useEffect, useRef, useState } from 'react';
import type { TransferJob, TransferOperation } from '@/lib/mock-transfers';

// Sample-file progress only. A real provider must report durable server job progress.
export function useMockTransfers(commit: (operation: TransferOperation) => void) {
  const [jobs, setJobs] = useState<TransferJob[]>([]);
  const jobsRef = useRef<TransferJob[]>([]);
  const commitRef = useRef(commit);
  const nextId = useRef(1);
  commitRef.current = commit;
  function update(next: TransferJob[]) { jobsRef.current = next; setJobs(next); }
  useEffect(() => {
    const timer = window.setInterval(() => {
      // Run one job at a time so completed snapshots cannot overwrite each other.
      const current = jobsRef.current.find(job => job.state === 'running');
      if (!current) return;
      let next = { ...current, rate: Math.max(1, Math.ceil(current.total / 32)) * 4, processed: Math.min(current.total, current.processed + Math.max(1, Math.ceil(current.total / 32))) };
      if (next.processed === next.total) {
        try { commitRef.current(next.operation); next.state = 'completed'; }
        catch (error) { next.state = 'failed'; next.error = error instanceof Error ? error.message : 'Transfer failed.'; }
      }
      const updated = jobsRef.current.map(job => job.id === next.id ? next : job);
      jobsRef.current = updated; setJobs(updated);
    }, 250);
    return () => window.clearInterval(timer);
  }, []);
  return {
    jobs,
    start(operation: TransferOperation, total: number) {
      const job: TransferJob = { id: nextId.current++, operation, total, processed: 0, state: 'running' };
      update([...jobsRef.current, job]); return job.id;
    },
    togglePause(id: number) { update(jobsRef.current.map(job => job.id === id && (job.state === 'paused' || job.state === 'running') ? { ...job, state: job.state === 'paused' ? 'running' : 'paused' } : job)); },
    cancel(id: number) { update(jobsRef.current.map(job => job.id === id && (job.state === 'paused' || job.state === 'running') ? { ...job, state: 'cancelled' } : job)); },
    dismiss(id: number) { update(jobsRef.current.filter(job => job.id !== id || job.state === 'running' || job.state === 'paused')); },
  };
}