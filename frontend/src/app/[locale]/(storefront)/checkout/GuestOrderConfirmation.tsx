'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { claimGuestOrders } from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import { Button } from '@/components/ui/Button';
import { InlineAuthPanel } from './InlineAuthPanel';
import { SUPPORT_CONTACT_FALLBACK } from './support-contact';

export interface GuestOrderConfirmationProps {
  orderNumber: string;
  /** uuid interno; se usa SOLO para `POST /orders/claim`, nunca se pinta (§4-G.3). */
  orderId: string;
  /** correo capturado: aquí SÍ se muestra completo (§15.5, asimetría deliberada). */
  email: string;
}

type ClaimState =
  | { kind: 'idle' }
  | { kind: 'claiming' }
  | { kind: 'claimed' }
  | { kind: 'needsVerification' }
  | { kind: 'neutral' };

/**
 * Confirmación de compra de invitado + reclamo post-compra (DESIGN_SYSTEM §15.5,
 * criterios 49, 54, 55).
 *
 * Seguridad de esta pantalla: se pinta desde el ESTADO de la transacción recién completada
 * (la respuesta de `POST /checkout/guest/session`), nunca desde una URL adivinable con un
 * id de pedido. El `orderId` no se muestra ni se pone en la ruta.
 *
 * Asimetría deliberada con la vista pública (§15.6): aquí se muestra el correo COMPLETO
 * —la ve solo quien acaba de pagar, en su propio dispositivo, y es la última oportunidad de
 * detectar una errata—; en la página de seguimiento no se muestra en absoluto.
 */
export function GuestOrderConfirmation({ orderNumber, orderId, email }: GuestOrderConfirmationProps) {
  const t = useTranslations('checkout.confirmation');
  const tn = useTranslations('nav');
  const [copied, setCopied] = useState(false);
  const [claim, setClaim] = useState<ClaimState>({ kind: 'idle' });

  async function copyOrderNumber() {
    try {
      await navigator.clipboard?.writeText(orderNumber);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* sin clipboard: el número sigue visible y seleccionable */
    }
  }

  /**
   * Reclamo (contrato §4-G.9): tras crear la cuenta se intenta vincular el pedido. El
   * backend exige `emailVerified` (403 EMAIL_NOT_VERIFIED) porque el reclamo otorga acceso
   * PERSISTENTE — una cuenta recién registrada aún no lo está, así que ese caso NO es un
   * error: se le dice que verifique y lo vincule desde su historial.
   * `POST /orders/claim` es parcial-tolerante (HTTP 200 con `failed[]`): un pedido ya
   * vinculado devuelve `ORDER_ALREADY_CLAIMED` y se responde con copy NEUTRO, sin decir a
   * quién pertenece (criterio 55).
   */
  async function claimOrder() {
    setClaim({ kind: 'claiming' });
    try {
      const res = await claimGuestOrders([orderId]);
      setClaim(res.claimed.includes(orderId) ? { kind: 'claimed' } : { kind: 'neutral' });
    } catch (e) {
      if (e instanceof ApiClientError && e.code === 'EMAIL_NOT_VERIFIED') {
        setClaim({ kind: 'needsVerification' });
      } else {
        setClaim({ kind: 'neutral' });
      }
    }
  }

  return (
    <div className="gutter max-w-2xl py-14">
      {/* ---- Bloque 1 · el pedido ------------------------------------------------- */}
      <p className="eyebrow">{t('eyebrow')}</p>
      <h1 className="mt-4 font-serif text-[30px] leading-[1.1] text-text lg:text-[40px]">{t('title')}</h1>

      <div className="mt-8 flex flex-wrap items-baseline gap-4">
        <span className="eyebrow">{t('orderNumber')}</span>
        <span data-testid="guest-order-number" className="font-mono text-[26px] leading-none text-text">
          {orderNumber}
        </span>
        <Button variant="ghost" size="sm" onClick={copyOrderNumber}>
          {copied ? t('copied') : t('copyOrderNumber')}
        </Button>
        <span aria-live="polite" className="sr-only">
          {copied ? t('copied') : ''}
        </span>
      </div>

      <p className="rule-note mt-8 text-[15px] leading-[1.7] text-muted">
        {t('emailSentTo', { email })}
      </p>
      <p className="mt-3 text-xs leading-relaxed text-muted">
        {t('wrongEmail', { contact: SUPPORT_CONTACT_FALLBACK })}
      </p>

      {/* ---- Bloque 2 · reclamo post-compra (AccountClaimOffer) -------------------- */}
      <section aria-labelledby="claim-title" className="mt-12 border-t-2 border-border-strong pt-8">
        <p className="eyebrow">{t('claim.eyebrow')}</p>
        <h2 id="claim-title" className="mt-3 font-serif text-[24px] leading-tight text-text">
          {t('claim.title')}
        </h2>

        {claim.kind === 'claimed' ? (
          <div className="mt-6">
            <p className="font-mono text-[11px] uppercase tracking-label text-success">{t('claim.success')}</p>
            <Link href="/orders" className="mt-3 inline-block text-sm text-accent hover:text-text">
              {t('claim.successLink')}
            </Link>
          </div>
        ) : claim.kind === 'needsVerification' || claim.kind === 'neutral' ? (
          <p role="status" className="mt-6 max-w-[560px] text-sm leading-relaxed text-muted">
            {claim.kind === 'needsVerification' ? t('claim.needsVerification') : t('claim.alreadyClaimedNeutral')}
          </p>
        ) : (
          <>
            <p className="mt-4 max-w-[560px] text-[15px] leading-[1.7] text-muted">
              {t('claim.body', { email })}
            </p>
            <div className="mt-7 max-w-[420px]" aria-busy={claim.kind === 'claiming'}>
              <InlineAuthPanel
                variant="register"
                defaultEmail={email}
                submitLabel={t('claim.cta')}
                neutralEmailTaken={t('claim.emailTakenNeutral')}
                onSuccess={claimOrder}
              />
            </div>
          </>
        )}
      </section>

      {/* ---- Bloque 3 · salidas ---------------------------------------------------- */}
      <div className="mt-12 border-t border-border pt-8">
        <Link
          href="/catalog"
          className="inline-flex min-h-[44px] items-center border border-text px-6 text-[11px] font-medium uppercase tracking-label text-text hover:bg-text hover:text-primary-fg"
        >
          {t('keepShopping')}
        </Link>
        <p className="mt-6 text-xs leading-relaxed text-muted">
          {t('cfdiReminder', { orderNumber })}{' '}
          <Link href="/terminos" className="text-accent hover:text-text">
            {tn('terms')}
          </Link>
        </p>
      </div>
    </div>
  );
}
