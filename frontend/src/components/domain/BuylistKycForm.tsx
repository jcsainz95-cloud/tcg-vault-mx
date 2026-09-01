'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
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
import { BuylistShippingNote } from './BuylistShippingNote';
import { BuylistMinimumShortfall } from './BuylistMinimumShortfall';
import { BuylistPickupAddressField } from './BuylistPickupAddressField';

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
  // v1.30 (§4.29): productId de un PRODUCTO SEPARADO (deck_exclusive/promo). Ausente = set_base.
  productId?: number;
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
  /** CLABE ya registrada en KYC (enmascarada, `****1234`) para el label del atajo. */
  clabeMasked?: string;
  /**
   * v1.15: hay CLABE en archivo (booleano REAL de GET /users/me/kyc). Si es true se ofrece el atajo
   * "usar mi CLABE ****1234" y al enviar se OMITE `clabe` (fallback server-side). Si es false, se pide.
   */
  clabeOnFile?: boolean;
  /**
   * v1.15: el INE ya está en archivo (booleano de GET /users/me/kyc). Si es true se OCULTAN los
   * uploaders de INE y se OMITE `ineUploadKeys` (el backend usa el INE de archivo para el umbral AML).
   */
  ineOnFile?: boolean;
  /**
   * Mínimo de compra vigente (`GET /buylist/quote-policy`), heredado del cotizador: NO se vuelve a
   * pedir aquí. `undefined` = no se conoce (fail-open) ⇒ no se pinta faltante y el botón NO se
   * apaga por este eje; la puerta es el `422 BUYLIST_MINIMUM_NOT_MET` del servidor.
   */
  minimumRequestCents?: number;
  /** Total cotizado del carrito, para el faltante PREVENTIVO (el autoritativo lo da el 422). */
  totalEstimatedCents?: number;
  /**
   * Cuántas cartas del carrito están en `precio_pendiente`. **Solo cambia el CONSEJO del
   * faltante** (§23.3f-bis): con líneas sin precio, «Agrega otra carta» es una instrucción que
   * no puede funcionar. **No toca la cifra**, que sigue siendo la del servidor.
   */
  pendingCardCount?: number;
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
export function BuylistKycForm({
  items,
  pendingCardCount = 0,
  onCreated,
  ineExpected,
  clabeMasked,
  clabeOnFile,
  ineOnFile,
  minimumRequestCents,
  totalEstimatedCents = 0,
}: BuylistKycFormProps) {
  const t = useTranslations('buylist');
  const tine = useTranslations('ine');
  const locale = useLocale() as AppLocale;
  const getErrorMessage = useErrorMessage();
  const { user, ready } = useSession();
  const qc = useQueryClient();

  /**
   * "Usar mi CLABE en archivo" en un clic (no reteclear 18 dígitos): el cliente NUNCA tiene la CLABE
   * en claro (el contrato solo devuelve `clabeMasked`). v1.15: el atajo se gatea con el booleano REAL
   * `clabeOnFile` de GET /users/me/kyc (ya no por config.useMocks); al enviar en este modo se OMITE
   * `clabe` y el backend hace el fallback server-side a la CLABE del propio usuario (contrato §6).
   */
  const clabeShortcutAvailable = !!clabeOnFile;
  const [useStoredClabe, setUseStoredClabe] = useState(clabeShortcutAvailable);

  const [clabe, setClabe] = useState('');
  const [clabeError, setClabeError] = useState<string | null>(null);
  const [ineFrontKey, setIneFrontKey] = useState<string | null>(null);
  const [ineBackKey, setIneBackKey] = useState<string | null>(null);
  // Preset por el heads-up de topes (ineExpected); un 422 INE_REQUIRED también lo activa.
  const [ineRequired, setIneRequired] = useState(ineExpected ?? false);
  const [formError, setFormError] = useState<string | null>(null);
  // v1.51.3 (D36/D37): dirección de ORIGEN. Se preselecciona en pantalla y viaja EXPLÍCITA.
  const [addressId, setAddressId] = useState('');
  const [addressError, setAddressError] = useState<string | null>(null);
  // Faltante AUTORITATIVO del `422 BUYLIST_MINIMUM_NOT_MET` (criterio 132b). Manda sobre el
  // preventivo: si difieren (caché de 5 min o dial movido), la pantalla se repinta con este.
  const [serverMinimum, setServerMinimum] = useState<{ minimumCents: number; shortfallCents: number } | null>(
    null,
  );
  // v1.5: el backend bloquea vender con emailVerified=false (403 EMAIL_NOT_VERIFIED).
  const [emailNotVerified, setEmailNotVerified] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Gating proactivo: espeja el guard server-side (solo bloquea con `false` explícito;
  // sesiones viejas sin el campo dejan decidir al backend).
  const emailBlocked = ready && !!user && user.emailVerified === false;

  const ineComplete = !!ineFrontKey && !!ineBackKey;

  // Faltante a pintar: el del SERVIDOR si ya habló; si no, el preventivo (mínimo del cotizador −
  // total). `null` cuando no se conoce el mínimo: ahí no se pinta nada y el botón sigue vivo.
  const preventiveShortfall =
    minimumRequestCents != null && totalEstimatedCents < minimumRequestCents
      ? { minimumCents: minimumRequestCents, shortfallCents: minimumRequestCents - totalEstimatedCents }
      : null;
  const shortfall = serverMinimum ?? preventiveShortfall;
  const belowMinimum = shortfall != null;

  async function submit() {
    setFormError(null);
    setClabeError(null);
    setAddressError(null);
    setEmailNotVerified(false);

    const storedMode = useStoredClabe && clabeShortcutAvailable;
    if (!storedMode && !CLABE_RE.test(clabe)) {
      setClabeError(t('clabeInvalid'));
      return;
    }
    // Sin dirección NO se manda nada: el `addressId` es obligatorio en el contrato y aquí no hay
    // relleno de cortesía — mandar sin él solo produciría un 422 evitable.
    if (!addressId) {
      setAddressError(t('request.address.missing'));
      return;
    }

    setSubmitting(true);
    try {
      const res = await createSellRequest({
        // Todos los items del carrito, ya expandidos por cantidad. El DTO solo
        // lleva cardId/productType/rawCondition; el backend re-deriva el monto
        // y decide el requisito de INE/tope por el TOTAL (SEC-A1, server-side).
        items,
        // v1.51.3 (D36/D37): SIEMPRE explícito, aunque la UI lo haya preseleccionado. El backend
        // copia esa fila a `pickupAddressSnapshot` — no la referencia — y de ahí sale la etiqueta.
        addressId,
        // v1.15: modo "CLABE en archivo" → se OMITE `clabe` (el backend usa la CLABE del propio
        // usuario en archivo, fallback server-side). Si no, va la CLABE capturada.
        ...(storedMode ? {} : { clabe }),
        // v1.15: si el INE ya está en archivo se OMITE ineUploadKeys (el backend usa el de archivo).
        ineUploadKeys: !ineOnFile && ineComplete ? { front: ineFrontKey!, back: ineBackKey! } : undefined,
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
      } else if (code === 'CLABE_REQUIRED') {
        // v1.15: se envió sin `clabe` y no hay CLABE en archivo → forzar captura y salir del atajo.
        setUseStoredClabe(false);
        setClabeError(t('clabeRequired'));
      } else if (code === 'PICKUP_ADDRESS_REQUIRED') {
        // No debería ocurrir (el botón se apaga sin dirección), pero si ocurre se pide INLINE.
        setAddressError(getErrorMessage(e));
      } else if (code === 'PICKUP_ADDRESS_NOT_FOUND') {
        // El id no existe O no es del usuario — el contrato devuelve LO MISMO en los dos casos a
        // propósito (anti-IDOR). Remedio único: refrescar la libreta y volver a elegir.
        setAddressId('');
        void qc.invalidateQueries({ queryKey: ['addresses'] });
        setAddressError(getErrorMessage(e));
      } else if (code === 'BUYLIST_MINIMUM_NOT_MET') {
        // details: { minimumCents, totalCents, shortfallCents } — el faltante lo calcula el
        // SERVIDOR y es el que manda. El front lo RENDERIZA, no lo recalcula.
        const details = e instanceof ApiClientError ? e.details : undefined;
        const minimumCents = details?.minimumCents;
        const shortfallCents = details?.shortfallCents;
        if (typeof minimumCents === 'number' && typeof shortfallCents === 'number') {
          setServerMinimum({ minimumCents, shortfallCents });
        } else {
          setFormError(getErrorMessage(e));
        }
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
      {useStoredClabe && clabeShortcutAvailable ? (
        /* Un clic (de hecho cero): por defecto se reusa la CLABE ya registrada. */
        <div className="flex flex-col gap-2">
          <p className="eyebrow">{t('clabeSectionTitle')}</p>
          <p className="text-sm text-text">{t('clabeStoredSelected', { masked: clabeMasked ?? '' })}</p>
          <button
            type="button"
            onClick={() => setUseStoredClabe(false)}
            className="self-start border-b border-accent pb-1 text-xs font-medium text-accent hover:border-text hover:text-text"
          >
            {t('clabeUseAnother')}
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
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
          {clabeShortcutAvailable && (
            <button
              type="button"
              onClick={() => {
                setUseStoredClabe(true);
                setClabeError(null);
              }}
              className="self-start border-b border-accent pb-1 text-xs font-medium text-accent hover:border-text hover:text-text"
            >
              {t('clabeUseStored', { masked: clabeMasked ?? '' })}
            </button>
          )}
        </div>
      )}

      {/* Dirección de ORIGEN (D36/D37): se pide junto con la CLABE, no al aceptar la oferta. */}
      <BuylistPickupAddressField
        value={addressId}
        onChange={setAddressId}
        error={addressError}
        describedById="kyc-address-reason"
      />

      <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface-2/40 p-4">
        <div className="flex items-center gap-2">
          <ShieldCheck size={18} className="text-info" aria-hidden />
          <h3 className="text-h3 font-semibold">{t('ineSectionTitle')}</h3>
        </div>
        {ineOnFile ? (
          /* v1.15: INE ya en archivo → no se re-pide (el backend lo trata como provisto, umbral AML). */
          <p className="text-sm text-success">{t('ineOnFileNote')}</p>
        ) : (
          <>
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
          </>
        )}
      </section>

      {(emailBlocked || emailNotVerified) && <EmailNotVerifiedNotice />}
      {formError && <Banner variant="danger" role="alert">{formError}</Banner>}

      {/* Faltante del mínimo en el paso de crear. El del SERVIDOR (422) manda sobre el preventivo:
          la pantalla informa, la puerta decide. */}
      {shortfall && (
        <BuylistMinimumShortfall
          id="kyc-minimum-reason"
          shortfallCents={shortfall.shortfallCents}
          minimumCents={shortfall.minimumCents}
          hasPendingLines={pendingCardCount > 0}
        />
      )}

      {/* §23.3g (superficie 2): la MISMA frase del cotizador, carácter por carácter —no una
          versión resumida— y la condición NM, justo antes del botón que compromete las cartas. */}
      <div className="flex flex-col gap-2">
        <BuylistShippingNote surface="create-step" />
        <p className="text-sm leading-[1.7] text-muted">
          <span className="font-medium text-text">{t('nmOnlyTitle')}.</span> {t('nmOnlyBody')}
        </p>
      </div>

      <Button
        onClick={submit}
        loading={submitting}
        // Sin dirección el botón se apaga (§23.3j) — pero NUNCA mudo: el `aria-describedby`
        // apunta al motivo y a su remedio. El mínimo solo apaga cuando SE CONOCE (fail-open).
        disabled={submitting || emailBlocked || !addressId || belowMinimum}
        aria-describedby={
          [
            emailBlocked ? 'kyc-blocked-reason' : null,
            !addressId ? 'kyc-address-reason' : null,
            belowMinimum ? 'kyc-minimum-reason' : null,
          ]
            .filter(Boolean)
            .join(' ') || undefined
        }
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
