'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ShieldCheck } from 'lucide-react';
import { createSellRequest } from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import type { ProductType, RawCondition } from '@/types/contract';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Banner } from '@/components/ui/Banner';
import { PhotoUploader } from '@/components/ui/PhotoUploader';
import { EmailNotVerifiedNotice } from './EmailNotVerifiedNotice';

/**
 * Ítem del payload de `POST /buylist/requests` (contrato §6). El modelo es
 * 1 item por carta física: una cantidad N ya viene EXPANDIDA a N entradas por
 * el carrito (BuylistView). El DTO solo lleva cardId/productType/rawCondition;
 * NO se envían precios ni categorías (SEC-A1: el backend re-deriva el monto).
 */
export interface BuylistRequestItem {
  cardId: string;
  productType: ProductType;
  rawCondition?: RawCondition;
}

export interface BuylistKycFormProps {
  /** items del carrito ya expandidos por cantidad (≥1). */
  items: BuylistRequestItem[];
  /** se invoca con el id de la solicitud creada (para refrescar la lista / cerrar). */
  onCreated: (sellRequestId: string) => void;
}

const CLABE_RE = /^\d{18}$/;

/**
 * Paso de pago/KYC del buylist (PROJECT §E, contrato §6 POST /buylist/requests):
 * captura CLABE (a nombre propio) + imagen del INE (anverso/reverso) cuando aplica,
 * subiendo el INE por presign `kyc_ine` (§8) y asociando las keys a la solicitud.
 * Maneja loading/error/éxito y los errores de negocio (INE_REQUIRED, CLABE_NOT_OWN_NAME,
 * BUYLIST_LIMIT_EXCEEDED).
 */
export function BuylistKycForm({ items, onCreated }: BuylistKycFormProps) {
  const t = useTranslations('buylist');
  const tine = useTranslations('ine');

  const [clabe, setClabe] = useState('');
  const [clabeError, setClabeError] = useState<string | null>(null);
  const [ineFrontKey, setIneFrontKey] = useState<string | null>(null);
  const [ineBackKey, setIneBackKey] = useState<string | null>(null);
  const [ineRequired, setIneRequired] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  // v1.5: el backend bloquea vender con emailVerified=false (403 EMAIL_NOT_VERIFIED).
  const [emailNotVerified, setEmailNotVerified] = useState(false);
  const [submitting, setSubmitting] = useState(false);

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
        setFormError(t('limitExceeded'));
      } else {
        setFormError(t('requestError'));
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <Input
        label={t('clabeLabel')}
        hint={t('clabeHint')}
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

      {emailNotVerified && <EmailNotVerifiedNotice />}
      {formError && <Banner variant="danger" role="alert">{formError}</Banner>}

      <Button onClick={submit} loading={submitting} disabled={submitting}>
        {submitting ? t('submitting') : t('submit')}
      </Button>
    </div>
  );
}
