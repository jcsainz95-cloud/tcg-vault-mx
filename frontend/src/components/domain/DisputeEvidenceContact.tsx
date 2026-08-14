'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Mail, Copy, Check } from 'lucide-react';
import { Banner } from '@/components/ui/Banner';

export interface DisputeEvidenceContactProps {
  /**
   * Correo de soporte al que se envía la evidencia. Viene de `evidenceContact`
   * de la API (contrato §7/§M8) — NO se hardcodea. Si falta, no se muestra el chip.
   */
  email?: string;
  /** referencia visible (nº de orden/disputa) para citar en el correo */
  reference?: string;
}

/**
 * Disputa por correo (DESIGN_SYSTEM §7.11, v1.2) — reemplaza al comparador de fotos.
 * El cliente envía su evidencia por correo al buzón de soporte; aquí se muestra el
 * correo como enlace `mailto:` + botón "Copiar correo". Sin uploader.
 */
export function DisputeEvidenceContact({ email, reference }: DisputeEvidenceContactProps) {
  const t = useTranslations('dispute');
  const [copied, setCopied] = useState(false);

  if (!email) return null;

  async function copy() {
    try {
      await navigator.clipboard?.writeText(email!);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard no disponible: el correo sigue visible como enlace mailto */
    }
  }

  const subject = reference ? t('mailSubject', { reference }) : t('mailSubjectGeneric');
  const mailto = `mailto:${email}?subject=${encodeURIComponent(subject)}`;

  return (
    <Banner variant="info" title={t('evidenceTitle')}>
      <div className="flex flex-col gap-2">
        <p>{t('evidenceBody')}</p>
        <div className="flex flex-wrap items-center gap-2">
          <a
            href={mailto}
            className="inline-flex min-h-[36px] items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-fg hover:bg-primary-hover focus-visible:outline-none focus-visible:shadow-[0_0_0_3px_var(--color-focus-ring)]"
          >
            <Mail size={16} aria-hidden />
            <span className="tabular-nums" data-testid="evidence-email">
              {email}
            </span>
          </a>
          <button
            type="button"
            onClick={copy}
            className="inline-flex min-h-[36px] items-center gap-1.5 rounded-md border border-border-strong px-3 text-sm font-medium hover:bg-surface-2 focus-visible:outline-none focus-visible:shadow-[0_0_0_3px_var(--color-focus-ring)]"
            aria-label={t('copyEmail')}
          >
            {copied ? <Check size={16} aria-hidden /> : <Copy size={16} aria-hidden />}
            {copied ? t('copied') : t('copyEmail')}
          </button>
        </div>
      </div>
    </Banner>
  );
}
