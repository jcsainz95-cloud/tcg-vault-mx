/**
 * §DECKS-TOP-FUENTE — «Publicar ahora» asíncrono (API_CONTRACT_DECKS_META §1-2).
 * POST ⇒ 202 `{jobId,status,deduped}`; se sondea el GET cada 3 s hasta `done|failed`.
 * 404 ⇒ `DecksMetaJobLostError` (el servidor reinició; la cola es en proceso).
 */
import { apiRequest, ApiClientError } from '../api-client';
import type { DecksMetaJobEnqueued, DecksMetaJobStatus, DecksMetaPreviewResponse } from '@/types/contract';

export const decksMetaPoll = { ms: 3000, maxMs: 5 * 60 * 1000 };

export class DecksMetaJobLostError extends Error {
  constructor() {
    super('DECKS_META_JOB_LOST');
    this.name = 'DecksMetaJobLostError';
  }
}

export class DecksMetaJobFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DecksMetaJobFailedError';
  }
}

/** 409 REFRESH_BUSY: hay un job en curso de OTRO tipo (`runningDryRun`). */
export class DecksMetaBusyError extends Error {
  runningDryRun: boolean;
  constructor(runningDryRun: boolean) {
    super('REFRESH_BUSY');
    this.name = 'DecksMetaBusyError';
    this.runningDryRun = runningDryRun;
  }
}

/** Tope de sondeo (5 min) agotado: «tarda más de lo normal; revisa el último reporte». */
export class DecksMetaJobTimeoutError extends Error {
  constructor() {
    super('DECKS_META_JOB_TIMEOUT');
    this.name = 'DecksMetaJobTimeoutError';
  }
}

export function enqueueDecksMetaRefresh(dryRun = false): Promise<DecksMetaJobEnqueued> {
  return apiRequest<DecksMetaJobEnqueued>('/admin/jobs/decks-meta-refresh', { method: 'POST', body: { dryRun } }).catch((e) => {
    if (e instanceof ApiClientError && e.status === 409 && e.code === 'REFRESH_BUSY') {
      throw new DecksMetaBusyError(e.details?.runningDryRun === true);
    }
    throw e;
  });
}

export function getDecksMetaJob(jobId: string): Promise<DecksMetaJobStatus> {
  return apiRequest<DecksMetaJobStatus>(`/admin/jobs/decks-meta-refresh/${jobId}`);
}

/** Espera `ms`; resuelve antes si se cancela. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const t = setTimeout(done, ms);
    function done() {
      clearTimeout(t);
      signal?.removeEventListener('abort', done);
      resolve();
    }
    signal?.addEventListener('abort', done);
  });
}

/**
 * Encola y espera el resultado. `onEnqueued` avisa si se reutilizó una corrida en curso.
 * Un fallo de red (o 5xx) en el sondeo se reintenta tras la espera; 404 ⇒ perdido; tope `maxMs`;
 * `signal` cancela (salida de la página) lanzando AbortError.
 */
export async function runDecksMetaRefreshJob(
  opts: { dryRun?: boolean; onEnqueued?: (e: DecksMetaJobEnqueued) => void; signal?: AbortSignal } = {},
): Promise<DecksMetaPreviewResponse> {
  const { signal } = opts;
  const abort = () => new DOMException('aborted', 'AbortError');
  const job = await enqueueDecksMetaRefresh(opts.dryRun ?? false);
  opts.onEnqueued?.(job);
  const started = Date.now();
  for (;;) {
    await sleep(decksMetaPoll.ms, signal);
    if (signal?.aborted) throw abort();
    let st: DecksMetaJobStatus;
    try {
      st = await getDecksMetaJob(job.jobId);
    } catch (e) {
      if (e instanceof ApiClientError) {
        if (e.status === 404) throw new DecksMetaJobLostError();
        if (e.status < 500) throw e;
      }
      if (Date.now() - started >= decksMetaPoll.maxMs) throw new DecksMetaJobTimeoutError();
      continue; // red caída o 5xx: reintenta tras la espera
    }
    if (st.status === 'failed') throw new DecksMetaJobFailedError(st.error ?? '');
    if (st.status === 'done') {
      if (!st.result) throw new DecksMetaJobFailedError('');
      return st.result;
    }
    if (Date.now() - started >= decksMetaPoll.maxMs) throw new DecksMetaJobTimeoutError();
  }
}
