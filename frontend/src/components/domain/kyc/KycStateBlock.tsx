'use client';

import { useTranslations } from 'next-intl';
import { Banner } from '@/components/ui/Banner';
import type { KycStatus } from '@/types/contract';

export interface KycStateBlockProps {
  kycStatus: KycStatus;
  /** Texto LITERAL del revisor. Solo llega en `rejected` (contrato §M6-K.5). */
  rejectionReason?: string;
  /** `true` cuando el bloque tiene que poder recibir el foco al aterrizar con `#kyc` (P-4). */
  focusable?: boolean;
  blockRef?: React.Ref<HTMLDivElement>;
  /** Acciones que monta la pantalla (uploaders, enlaces): van DEBAJO del bloque. */
  children?: React.ReactNode;
}

/**
 * El bloque de estado del cliente (DESIGN_SYSTEM §34.8 · contrato §M6-K.7, tabla **normativa**).
 *
 * **El defecto que cierra:** hoy `pending` y `rejected` se pintan igual —«Pendiente», sin acción— y
 * `rejected` ni siquiera tiene motivo que pintar. El cliente que ya hizo todo **no sabe si falta
 * algo suyo o algo nuestro**. Este bloque siempre dice tres cosas: *qué pasó*, *qué le toca a él*
 * (aunque sea nada, y entonces **se dice con todas las letras**) y *cuándo lo sabrá*.
 *
 * ⛔ **Ninguna cifra de tope, umbral o cupo** (§34.9) y ⛔ **ninguna fecha**: el DTO del cliente no
 * trae ninguna y lo que no tenemos no se pinta (§34.8, regla 8).
 * ⛔ **Ningún estado bloquea comprar, vender, cobrar ni retirar** (invariante §M6-K.1.6): aquí no
 * se escribe «necesitas estar verificado para vender», porque ese control **no existe**.
 */
export function KycStateBlock({
  kycStatus,
  rejectionReason,
  focusable,
  blockRef,
  children,
}: KycStateBlockProps) {
  const t = useTranslations('account.kyc');

  if (kycStatus === 'rejected') {
    return (
      <div
        ref={blockRef}
        tabIndex={focusable ? -1 : undefined}
        className="flex flex-col gap-4 outline-none"
      >
        <Banner variant="warning" role="status" title={t('rejected.title')}>
          <span className="flex flex-col gap-1">
            <span>
              <span className="font-medium">{t('rejected.reasonLabel')}:</span>{' '}
              {/* El motivo va ENTRE COMILLAS y textual: es el texto del revisor, no nuestro. */}
              <span>«{rejectionReason}»</span>
            </span>
            <span>{t('rejected.body')}</span>
          </span>
        </Banner>
        {children}
      </div>
    );
  }

  const eyebrow =
    kycStatus === 'pending' ? t('pending.eyebrow') : kycStatus === 'verified' ? t('verified.eyebrow') : null;
  const body =
    kycStatus === 'pending' ? t('pending.body') : kycStatus === 'verified' ? t('verified.body') : t('noneBody');

  return (
    <div ref={blockRef} tabIndex={focusable ? -1 : undefined} className="flex flex-col gap-4 outline-none">
      <div className="flex flex-col gap-1">
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <p className="text-sm text-text">{body}</p>
      </div>
      {children}
    </div>
  );
}
