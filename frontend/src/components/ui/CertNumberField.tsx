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

  // Artboard «Ficha de carta» (dirección 1a): etiqueta eyebrow arriba y un
  // renglón con borde de regla; el número en mono tabular y «Copiar» en rojo.
  return (
    <div>
      <span className="eyebrow">{t('certLabel')}</span>
      <div className="mt-2.5 flex items-center gap-3.5 border border-border-strong px-3.5 py-3">
        <span className="tabular font-mono text-[13px] tracking-[0.06em] text-text" data-testid="cert-number">
          #{certNumber}
        </span>
        <button
          type="button"
          onClick={copy}
          className="ml-auto inline-flex min-h-[32px] items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-accent hover:text-text"
          aria-label={t('certCopy')}
        >
          {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
          {copied ? t('certCopied') : t('certCopy')}
        </button>
      </div>
    </div>
  );
}
