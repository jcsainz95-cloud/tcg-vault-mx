'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ShieldCheck } from 'lucide-react';
import { createSellRequest } from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import type { ProductType, RawCondition, Finish } from '@/types/contract';
import type { AppLocale } from '@/i18n/routing';
import { formatMoneyCents } from '@/lib/format';
import { useSession } from '@/lib/session';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Banner } from '@/components/ui/Banner';
import { PhotoUploader } from '@/components/ui/PhotoUploader';
import { useErrorMessage } from '@/components/ui/QueryState';
import { EmailNotVerifiedNotice } from './EmailNotVerifiedNotice';

/**
 * Ítem del payload de `POST /buylist/requests` (contrato §6). El modelo es
 * 1 item por carta física: una cantidad N ya viene EXPANDIDA a N entradas por
 * el carrito (BuylistView). El DTO lleva cardId/productType/rawCondition/finish;
 * NO se envían precios ni categorías (SEC-A1: el backend re-deriva el monto).
 * v1.6-finish: `finish` es el acabado snapshoteado de la cotización (default normal).
 */
export interface BuylistRequestItem {
  cardId: string;
  productType: ProductType;
  rawCondition?: RawCondition;
  finish?: Finish;
}

export interface BuylistKycFormProps {
  /** items del carrito ya expandidos por cantidad (≥1). */
  items: BuylistRequestItem[];
  /** se invoca con el id de la solicitud creada (para refrescar la lista / cerrar). */
  onCreated: (sellRequestId: string) => void;
  /**
   * Heads-up de cliente (useSellRequirements): el estimado supera el tope y no hay INE
   * en archivo → se muestra la petición de INE DE ENTRADA, no tras un 422 INE_REQUIRED.
   * El backend sigue decidiendo el requisito real (SEC-A1).
   */
  ineExpected?: boolean;
  /** CLABE ya registrada en KYC (enmascarada, `****1234`) para orientar la captura. */
  clabeMasked?: string;
}

const CLABE_RE = /^\d{18}$/;

/**
 * Paso de pago/KYC del buylist (PROJECT §E, contrato §6 POST /buylist/requests):
 * captura CLABE (a nombre propio) + imagen del INE (anverso/reverso) cuando aplica,
 * subiendo el INE por presign `kyc_ine` (§8) y asociando las keys a la solicitud.
 * Maneja loading/error/éxito y los errores de negocio (INE_REQUIRED, CLABE_NOT_OWN_NAME,
 * BUYLIST_LIMIT_EXCEEDED). Gating proactivo: si la sesión trae `emailVerified=false`
 * muestra el aviso con CTA de reenvío y deshabilita el envío ANTES del 403.
 */
export function BuylistKycForm({ items, onCreated, ineExpected, clabeMasked }: BuylistKycFormProps) {
  const t = useTranslations('buylist');
  const tine = useTranslations('ine');
  const locale = useLocale() as AppLocale;
  const getErrorMessage = useErrorMessage();
  const { user, ready } = useSession();

  const [clabe, setClabe] = useState('');
  const [clabeError, setClabeError] = useState<string | null>(null);
  const [ineFrontKey, setIneFrontKey] = useState<string | null>(null);
  const [ineBackKey, setIneBackKey] = useState<string | null>(null);
  // Preset por el heads-up de topes (ineExpected); un 422 INE_REQUIRED también lo activa.
  const [ineRequired, setIneRequired] = useState(ineExpected ?? false);
  const [formError, setFormError] = useState<string | null>(null);
  // v1.5: el backend bloquea vender con emailVerified=false (403 EMAIL_NOT_VERIFIED).
  const [emailNotVerified, setEmailNotVerified] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Gating proactivo: espeja el guard server-side (solo bloquea con `false` explícito;
  // sesiones viejas sin el campo dejan decidir al backend).
  const emailBlocked = ready && !!user && user.emailVerified === false;

  const ineComplete = !!ineFrontKey && !!ineBackKey;

  async function submit() {
    setFormError(null);
    setClabeError(null);
    setEmailNotVerified(false);

    if (!CLABE_RE.test(clabe)) {
      setClabeError(t('clabeInvalid'));
      return;
    }

    setSubmitting(true);
    try {
      const res = await createSellRequest({
        // Todos los items del carrito, ya expandidos por cantidad. El DTO solo
        // lleva cardId/productType/rawCondition; el backend re-deriva el monto
        // y decide el requisito de INE/tope por el TOTAL (SEC-A1, server-side).
        items,
        clabe,
        ineUploadKeys: ineComplete ? { front: ineFrontKey!, back: ineBackKey! } : undefined,
      });
      onCreated(res.sellRequestId);
    } catch (e) {
      const code = e instanceof ApiClientError ? e.code : undefined;
      if (code === 'EMAIL_NOT_VERIFIED') {
        // v1.5: vender es acción sensible; se muestra el aviso claro con CTA de reenvío
        // en vez de un error genérico (contrato §0/§6).
        setEmailNotVerified(true);
      } else if (code === 'INE_REQUIRED') {
        setIneRequired(true);
        setFormError(t('ineRequiredError'));
      } else if (code === 'CLABE_NOT_OWN_NAME') {
        setClabeError(t('clabeNotOwnName'));
      } else if (code === 'CLABE_INVALID') {
        setClabeError(t('clabeInvalid'));
      } else if (code === 'BUYLIST_LIMIT_EXCEEDED') {
        // details: { scope, capCents, wouldBeCents } (contrato §6) → mensaje con el tope real.
        const capCents =
          e instanceof ApiClientError ? (e.details?.capCents as number | undefined) : undefined;
        setFormError(
          capCents != null
            ? t('limitExceededCap', { cap: formatMoneyCents(capCents, locale) })
            : t('limitExceeded'),
        );
      } else {
        // Mapea el código REAL del contrato (p. ej. FINISH_NOT_AVAILABLE) al catálogo
        // i18n `error.*`; solo cae al genérico si no hay ni código ni mensaje.
        setFormError(getErrorMessage(e));
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <Input
        label={t('clabeLabel')}
        hint={clabeMasked ? t('clabeOnFileHint', { masked: clabeMasked }) : t('clabeHint')}
        error={clabeError ?? undefined}
        inputMode="numeric"
        maxLength={18}
        value={clabe}
        onChange={(e) => setClabe(e.target.value.replace(/\D/g, ''))}
        autoComplete="off"
      />

      <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface-2/40 p-4">
        <div className="flex items-center gap-2">
          <ShieldCheck size={18} className="text-info" aria-hidden />
          <h3 className="text-h3 font-semibold">{t('ineSectionTitle')}</h3>
        </div>
        <p className="text-sm text-muted">{t('ineSectionNote')}</p>
        {ineRequired && <Banner variant="warning" role="alert">{t('ineRequiredError')}</Banner>}
        <div className="flex flex-wrap gap-4">
          <PhotoUploader
            label={tine('front')}
            purpose="kyc_ine"
            onUploaded={setIneFrontKey}
            onCleared={() => setIneFrontKey(null)}
          />
          <PhotoUploader
            label={tine('back')}
            purpose="kyc_ine"
            onUploaded={setIneBackKey}
            onCleared={() => setIneBackKey(null)}
          />
        </div>
        {/* Aviso de privacidad obligatorio (DESIGN_SYSTEM §7.10). */}
        <p className="text-xs text-muted">{tine('privacy')}</p>
      </section>

      {(emailBlocked || emailNotVerified) && <EmailNotVerifiedNotice />}
      {formError && <Banner variant="danger" role="alert">{formError}</Banner>}

      <Button
        onClick={submit}
        loading={submitting}
        disabled={submitting || emailBlocked}
        aria-describedby={emailBlocked ? 'kyc-blocked-reason' : undefined}
      >
        {submitting ? t('submitting') : t('submit')}
      </Button>
      {emailBlocked && (
        <p id="kyc-blocked-reason" className="font-mono text-[11px] leading-[1.6] text-accent">
          {t('submitBlockedEmail')}
        </p>
      )}
    </div>
  );
}
