'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Copy, Check } from 'lucide-react';

export interface CertNumberFieldProps {
  certNumber: string;
}

/**
 * Certificado de gradeada verificable (DESIGN_SYSTEM §7.2c). Muestra el nº con la
 * etiqueta "Certificado / Certificate" como TEXTO COPIABLE + botón "Copiar".
 * Mientras el humano no confirme una URL de verificación de la graduadora, NO se
 * inventa enlace (solicitud registrada al arquitecto/PO).
 */
export function CertNumberField({ certNumber }: CertNumberFieldProps) {
  const t = useTranslations('card');
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard?.writeText(certNumber);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard no disponible: el número sigue siendo legible/seleccionable */
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-muted">{t('certLabel')}:</span>
      <span className="tabular-nums font-medium text-text" data-testid="cert-number">
        #{certNumber}
      </span>
      <button
        type="button"
        onClick={copy}
        className="inline-flex min-h-[32px] items-center gap-1 rounded-md border border-border-strong px-2 text-xs font-medium hover:bg-surface-2 focus-visible:outline-none focus-visible:shadow-[0_0_0_3px_var(--color-focus-ring)]"
        aria-label={t('certCopy')}
      >
        {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
        {copied ? t('certCopied') : t('certCopy')}
      </button>
    </div>
  );
}
