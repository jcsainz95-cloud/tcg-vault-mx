'use client';

import { useTranslations } from 'next-intl';
import { Check, AlertTriangle } from 'lucide-react';

export interface PerLine {
  ok: boolean;
  label: string;
  code?: string;
  message?: string;
}

/**
 * Render TOLERANTE por-línea (contrato §M1): en un lote de alta/publicación cada línea trae
 * su propio resultado. Una línea inválida muestra su error (código traducido, con fallback al
 * mensaje real del backend) y el resto entra igual — nunca se oculta el motivo al operador.
 */
export function PerLineErrors({ lines }: { lines: PerLine[] }) {
  const tRoot = useTranslations();
  if (lines.length === 0) return null;

  function codeMessage(code?: string, message?: string): string {
    if (code && tRoot.has(`error.${code}`)) return tRoot(`error.${code}`);
    return message ?? '';
  }

  return (
    <ul className="flex flex-col gap-1" aria-label="per-line-results">
      {lines.map((line, i) => (
        <li
          key={`${line.label}-${i}`}
          className={`flex items-center gap-2 font-mono text-xs ${line.ok ? 'text-success' : 'text-accent'}`}
        >
          {line.ok ? (
            <Check size={14} aria-hidden />
          ) : (
            <AlertTriangle size={14} aria-hidden />
          )}
          <span className="tabular-nums">{line.label}</span>
          {!line.ok && <span>— {codeMessage(line.code, line.message)}</span>}
        </li>
      ))}
    </ul>
  );
}
