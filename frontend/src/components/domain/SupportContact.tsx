'use client';

import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Mail } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { cn } from '@/lib/cn';
import { useSupportContact } from '@/hooks/useSupportContact';

export interface SupportContactProps {
  /**
   * Buzón de soporte. Sale de `GET /support/contact` (`useSupportContact`) o, en el seguimiento del
   * invitado, de `support.evidenceContact` (contrato v1.82 §PNL.1). `null` ⇒ aún cargando: línea
   * en `Skeleton` y «Copiar correo» deshabilitado. ⛔ Nunca un valor escrito en la pantalla.
   */
  email: string | null;
  /** Número de pedido (`TCG-000123`) o id del retiro: va en el asunto del `mailto:`. */
  reference: string;
  kind: 'order' | 'withdrawal';
  className?: string;
}

/**
 * «¿Problema con tu pedido? Escríbenos» (DESIGN_SYSTEM §60.1 a · contrato v1.82 §PNL.1) — sustituye a
 * «Abrir disputa». Es una **puerta**, no un aviso: sección editorial (regla superior, eyebrow `h2`,
 * prosa), ⛔ no `Banner`. La prosa no promete reembolso ni plazo (HECHOS 2026-10-05: sin plazo escrito).
 */
export function SupportContact({ email, reference, kind, className }: SupportContactProps) {
  const t = useTranslations('support');
  const [copied, setCopied] = useState(false);
  const headingId = useId();

  async function copy() {
    if (!email) return;
    try {
      await navigator.clipboard?.writeText(email);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* portapapeles no disponible: el correo sigue visible como enlace mailto */
    }
  }

  const subject = kind === 'order' ? t('mailSubjectOrder', { reference }) : t('mailSubjectWithdrawal', { reference });

  return (
    <section
      aria-labelledby={headingId}
      data-testid="support-contact"
      className={cn('border-t border-border pt-6', className)}
    >
      <h2 id={headingId} className="eyebrow">
        {kind === 'order' ? t('orderTitle') : t('withdrawalTitle')}
      </h2>
      <p className="mt-3 text-sm text-text">{kind === 'order' ? t('orderBody') : t('withdrawalBody')}</p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        {email ? (
          <a
            href={`mailto:${email}?subject=${encodeURIComponent(subject)}`}
            className="inline-flex min-h-[44px] items-center gap-1.5 font-mono text-[13px] text-text underline underline-offset-4 hover:text-accent focus-visible:outline-none focus-visible:shadow-focus"
          >
            <Mail size={16} aria-hidden />
            <span data-testid="support-email">{email}</span>
          </a>
        ) : (
          <Skeleton className="h-4 w-[18ch]" />
        )}
        <Button variant="ghost" size="sm" onClick={copy} disabled={!email}>
          {copied ? t('copied') : t('copyEmail')}
        </Button>
        <span aria-live="polite" className="sr-only">
          {copied ? t('copied') : ''}
        </span>
      </div>
    </section>
  );
}

/**
 * El correo de soporte como enlace suelto (pie de `/pedido`, §60.1 b «contacto neutro»): sale de
 * `GET /support/contact`; mientras carga no pinta nada (⛔ nunca el valor fijo antes de tiempo).
 */
export function SupportEmailLink({ className }: { className?: string }) {
  const { contact } = useSupportContact();
  if (!contact) return <Skeleton className="h-3 w-[18ch]" />;
  return (
    <a href={`mailto:${contact}`} className={className} data-testid="support-email-link">
      {contact}
    </a>
  );
}
