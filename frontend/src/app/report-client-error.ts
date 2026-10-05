import { config } from '@/lib/config';

/**
 * LIVE-7 (API_CONTRACT §14.7) — avisa al backend de un error mostrado al usuario:
 * `POST {API}/telemetry/client-error` con `{ message ≤ 300, digest? ≤ 64, path ≤ 200, release? ≤ 40 }`.
 * Lo llaman `app/[locale]/error.tsx` y `app/global-error.tsx`, una vez por error mostrado.
 *
 * Público y anónimo a propósito: sin cookies (`credentials: 'omit'`), sin `Authorization`, sin
 * usuario. ⛔ Ni la query ni el fragmento de la ruta salen del navegador (`reset-password?token=…`
 * y `verify-email?token=…` llevan secretos); a las URL dentro del mensaje se les quita igual.
 * `fetch` directo y no `apiRequest`: este último adjunta el token y reintenta el refresh, y una
 * pantalla de error no debe tocar la sesión.
 */
export interface ClientErrorReport {
  message: string;
  digest?: string;
  path: string;
  release?: string;
}

const MAX = { message: 300, digest: 64, path: 200, release: 40 } as const;

function stripQuery(path: string): string {
  return path.replace(/[?#].*$/s, '');
}

function scrubMessage(message: string): string {
  return message.replace(/(https?:\/\/[^\s?#]+)[?#]\S*/g, '$1');
}

export function buildClientErrorReport(
  error: Error & { digest?: string },
  rawPath: string,
  release?: string,
): ClientErrorReport {
  const message = scrubMessage(error?.message || error?.name || 'Error').slice(0, MAX.message) || 'Error';
  const report: ClientErrorReport = {
    message,
    path: (stripQuery(rawPath) || '/').slice(0, MAX.path),
  };
  if (error?.digest) report.digest = String(error.digest).slice(0, MAX.digest);
  if (release) report.release = release.slice(0, MAX.release);
  return report;
}

export async function reportClientError(error: Error & { digest?: string }, rawPath: string): Promise<void> {
  // Modo mocks: no hay backend al que contárselo.
  if (config.useMocks) return;
  try {
    const body = buildClientErrorReport(error, rawPath, process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA);
    await fetch(`${config.apiBaseUrl}/telemetry/client-error`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      credentials: 'omit',
      keepalive: true,
    });
  } catch {
    // La telemetría nunca rompe la pantalla de error.
  }
}
