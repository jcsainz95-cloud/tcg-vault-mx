'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { Save } from 'lucide-react';
import { getIvaTransferPreview, updateIvaTransfer } from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import { formatMoneyCents } from '@/lib/format';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import type { IvaTransferPositionDTO, IvaTransferPreviewDTO } from '@/types/contract';
import type { AppLocale } from '@/i18n/routing';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Banner } from '@/components/ui/Banner';
import { EmptyState } from '@/components/ui/EmptyState';
import { QueryState, useErrorMessage } from '@/components/ui/QueryState';

/**
 * El `L` de ejemplo sobre el que se cotiza el costo. **Es el del contrato** (§M10-IVA.2,
 * `samplePriceCents` por defecto `10000` = MX$100.00) y el de las tres filas publicadas del
 * criterio **188**. Se manda **siempre explícito** porque es **la mitad del acuse**: el servidor
 * recalcula el delta para *ese* `samplePriceCents`, y dejarlo al default ataría el acuse a un
 * valor que la pantalla nunca nombró.
 */
const SAMPLE_PRICE_CENTS = 10000;

const MIN_PCT = 0;
const MAX_PCT = 100;

/**
 * ⚠️ **`formatMoneyCents` pierde el «MX» en los NEGATIVOS, y aquí el número clave es negativo.**
 * Medido: `Intl` en `es-MX` devuelve `-$6.90`, y la normalización a `MX$` de `format.ts` ancla en
 * `^\$` — con el signo delante **no dispara**. En `en-US` sí (`-MX$6.90`), así que el defecto es
 * **solo en español**, que es el idioma del dueño.
 *
 * Se compone el signo **fuera** del formateador en vez de tocar el helper compartido de dinero:
 * es una superficie de DINERO usada por media app y este cambio no es el sitio para moverla. El
 * defecto va reportado al dueño del helper.
 *
 * El signo es el **menos tipográfico** `−` (U+2212), no un guion: a tamaño de cifra el guion se lee
 * como un separador.
 */
function signedMoneyCents(cents: number, locale: AppLocale): string {
  const abs = formatMoneyCents(Math.abs(cents), locale);
  return cents < 0 ? `\u2212${abs}` : abs;
}

/** El dial es **entero** (§M10-IVA.1): `Order.ivaTransferPct` es `Int` y `37.5` es `422`. */
function parsePct(text: string): number | null {
  if (!/^\d{1,3}$/.test(text.trim())) return null;
  const n = Number(text.trim());
  if (!Number.isInteger(n) || n < MIN_PCT || n > MAX_PCT) return null;
  return n;
}

/**
 * ⭐⭐ **LA PANTALLA DEL DIAL DE TRASLACIÓN DEL IVA** (criterio **213**, contrato §M10-IVA.2,
 * `ARCHITECTURE §4.55`). `super_admin`, y **es dinero**.
 *
 * **Lo que el criterio exige y dónde está en este archivo:**
 * - *«el súper administrador puede cambiar la fracción desde admin, sin redeploy, con auditoría»*
 *   ⇒ `updateIvaTransfer` contra `PUT /admin/settings/iva-transfer`, que audita en la **misma
 *   transacción** que escribe. ⛔ La puerta es **ésta y sólo ésta**: `PUT /admin/settings` con la
 *   clave es `422` (candado `IVA-8(b)`), y `EditableSettingsPatch` no la deja ni teclear.
 * - *«la pantalla dice en PESOS, ANTES de guardar, cuánto margen se cede»* ⇒ el bloque del delta,
 *   y el botón **no se habilita** mientras no exista un `preview` **para el valor que se va a
 *   guardar**. ⛔ *Falla si el dial se puede guardar sin que esa cifra se haya mostrado.*
 *
 * ⛔⛔ **EL FRONT NO MULTIPLICA NADA** (`ARCHITECTURE §4.44.i`). Las seis cifras de cada posición y
 * el delta vienen del servidor. Si el front computara el delta, el acuse probaría que el front sabe
 * multiplicar, **no que el dueño vio el costo real** — y el acuse dejaría de tener sentido.
 *
 * ⛔ **Cero afirmaciones jurídicas y cero insinuaciones** (criterio **195**, **D53**,
 * `DESIGN_SYSTEM §7.12a`): la pantalla **no dice** que absorber IVA reduzca el impuesto (no lo
 * reduce) y **no afirma nada** sobre el IVA, tampoco en negativo. Dice qué pasa con **nuestro
 * neto**, que es la decisión que se está tomando.
 *
 * ⛔ **Criterio 209**: todo este copy vive bajo `admin.*`. `ivaTransferPct` **no viaja a ninguna
 * superficie de cliente** — ni se muestra, ni se filtra, ni se deduce.
 */
export function IvaTransferSection() {
  const t = useTranslations('admin.m10.ivaTransfer');
  const tc = useTranslations('common');
  const locale = useLocale() as AppLocale;
  const getMessage = useErrorMessage('operator');
  const qc = useQueryClient();

  /**
   * `null` = «todavía no he tocado el dial» ⇒ se cotiza **la posición vigente contra sí misma** y
   * el delta es `0`. Se arranca en `MAX_PCT` sólo hasta la primera respuesta, y en cuanto llega se
   * adopta `current.ivaTransferPct`: ⛔ la pantalla **no supone** el valor vigente ni lo hereda del
   * seed. El valor vigente **lo dice el servidor**, en `preview.current`.
   */
  const [draftText, setDraftText] = useState<string | null>(null);
  const [ackStale, setAckStale] = useState<number | null>(null);

  const draft = draftText === null ? null : parsePct(draftText);
  const debouncedDraft = useDebouncedValue(draft, 300);
  // Mientras el texto sea inválido se sigue cotizando la ÚLTIMA posición válida en vez de dejar la
  // pantalla sin cifras: el error se dice en el campo, no borrando el costo de delante del dueño.
  const [lastValidPct, setLastValidPct] = useState<number>(MAX_PCT);
  useEffect(() => {
    if (debouncedDraft !== null) setLastValidPct(debouncedDraft);
  }, [debouncedDraft]);

  const queriedPct = debouncedDraft ?? lastValidPct;
  const preview = useQuery({
    queryKey: ['iva-transfer-preview', queriedPct, SAMPLE_PRICE_CENTS],
    queryFn: () => getIvaTransferPreview({ ivaTransferPct: queriedPct, samplePriceCents: SAMPLE_PRICE_CENTS }),
  });

  // Primera respuesta: el campo adopta el valor VIGENTE que dijo el servidor.
  const currentPct = preview.data?.current?.ivaTransferPct;
  useEffect(() => {
    if (draftText === null && currentPct !== undefined) setDraftText(String(currentPct));
  }, [draftText, currentPct]);

  const mutation = useMutation({
    mutationFn: updateIvaTransfer,
    onSuccess: (res) => {
      setAckStale(null);
      // El dial vive también en `GET /admin/settings` (READ-ONLY ahí), y la bitácora acaba de ganar
      // una fila `settings.update`: las dos superficies de esta misma pantalla se refrescan.
      qc.invalidateQueries({ queryKey: ['settings'] });
      qc.invalidateQueries({ queryKey: ['audit-log'] });
      qc.invalidateQueries({ queryKey: ['iva-transfer-preview'] });
      setDraftText(String(res.ivaTransferPct));
    },
    onError: (e) => {
      /*
       * `409 IVA_TRANSFER_ACK_STALE` — el delta que acusamos **ya no es el que el servidor
       * calcula** (p. ej. alguien movió `ivaPct` o un dial de Stripe entre el preview y el guardar).
       * ⛔ **No se reintenta solo con el número nuevo**: eso sería guardar con una cifra que el
       * dueño **no vio**, que es exactamente lo que el acuse existe para impedir. Se le vuelve a
       * mostrar el costo y vuelve a decidir.
       */
      if (e instanceof ApiClientError && e.code === 'IVA_TRANSFER_ACK_STALE') {
        const expected = e.details?.expectedNetDeltaCents;
        setAckStale(typeof expected === 'number' ? expected : null);
        preview.refetch();
      }
    },
  });

  // ⚠️ `?? null`, y no `preview.data` a secas: un `200` con cuerpo vacío llega aquí como `null` y
  // **tiene que caer en la rama de vacío**, no en un `.current` que reviente ni en un hueco en
  // blanco. Ésa es la clase de defecto que este panel ya se comió cuatro veces.
  const data = preview.data ?? null;
  const invalidDraft = draftText !== null && draft === null;
  // ⭐ El candado del criterio 188: sólo se puede guardar **la posición que está cotizada en
  // pantalla**. Si el preview va por detrás del campo (debounce, refetch), el botón espera.
  const quotedMatchesDraft = data !== null && draft !== null && data.proposed.ivaTransferPct === draft;
  const changes = data !== null && draft !== null && draft !== data.current.ivaTransferPct;
  const canSave = quotedMatchesDraft && changes && !preview.isFetching && !mutation.isPending;

  function save() {
    if (!canSave || !data || draft === null) return;
    setAckStale(null);
    mutation.mutate({
      ivaTransferPct: draft,
      // ⛔ El acuse se manda **tal cual lo devolvió el preview**, ⛔ no recompuesto: recomponerlo
      // sería reinventar el número que el acuse existe para fijar.
      acknowledgement: {
        samplePriceCents: data.samplePriceCents,
        previewedNetDeltaCents: data.netDeltaPerUnitCents,
      },
    });
  }

  return (
    <section className="flex flex-col gap-3" aria-labelledby="m10-iva-transfer">
      <h2 id="m10-iva-transfer" className="text-h2 font-semibold">
        {t('title')}
      </h2>
      <p className="text-sm text-muted">{t('subtitle')}</p>

      <QueryState
        isLoading={preview.isLoading}
        isError={preview.isError}
        error={preview.error}
        onRetry={() => preview.refetch()}
      >
        {data !== null ? (
          <div className="flex flex-col gap-5 rounded-lg border border-primary/40 bg-surface p-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                label={t('label')}
                inputMode="numeric"
                value={draftText ?? ''}
                onChange={(e) => {
                  setDraftText(e.target.value);
                  setAckStale(null);
                }}
                suffix="%"
                error={invalidDraft ? t('invalid', { min: MIN_PCT, max: MAX_PCT }) : undefined}
                hint={invalidDraft ? undefined : t('hint', { current: data.current.ivaTransferPct })}
              />
              <p className="self-end font-mono text-xs leading-relaxed text-muted">
                {t('sampleNote', { price: formatMoneyCents(data.samplePriceCents, locale) })}
              </p>
            </div>

            <PositionTable preview={data} locale={locale} />

            {/* ⭐⭐ EL ACUSE EN PESOS (criterios 213 y 188). Es lo único que el dueño tiene que leer
                para decidir, así que va en grande, con signo, y en pesos — ⛔ no en puntos ni en
                porcentaje, que es donde la decisión se vuelve abstracta. */}
            <div className="border-t border-border pt-4">
              <p className="eyebrow">{t('delta.eyebrow')}</p>
              <p
                className={
                  data.netDeltaPerUnitCents < 0
                    ? 'tabular mt-2 font-mono text-2xl text-accent'
                    : 'tabular mt-2 font-mono text-2xl text-text'
                }
              >
                {signedMoneyCents(data.netDeltaPerUnitCents, locale)}
              </p>
              <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted">
                {data.netDeltaPerUnitCents === 0
                  ? t('delta.none')
                  : t('delta.body', {
                      amount: formatMoneyCents(Math.abs(data.netDeltaPerUnitCents), locale),
                      price: formatMoneyCents(data.samplePriceCents, locale),
                    })}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button disabled={!canSave} loading={mutation.isPending} onClick={save}>
                <Save size={18} /> {t('save')}
              </Button>
              {changes && (
                <Button
                  variant="ghost"
                  onClick={() => {
                    setDraftText(String(data.current.ivaTransferPct));
                    setAckStale(null);
                  }}
                >
                  {tc('cancel')}
                </Button>
              )}
              {/* Por qué el botón está apagado, dicho en vez de dejado a adivinar (§8.2). */}
              {!canSave && !mutation.isPending && (
                <span className="text-xs text-muted">
                  {invalidDraft
                    ? t('blocked.invalid')
                    : !changes
                      ? t('blocked.unchanged')
                      : t('blocked.quoting')}
                </span>
              )}
            </div>

            {ackStale !== null && (
              <Banner variant="warning" role="alert" title={t('stale.title')}>
                {t('stale.body', { amount: signedMoneyCents(ackStale, locale) })}
              </Banner>
            )}
            {mutation.isSuccess && (
              <Banner variant="success" role="status">
                {t('saved', { pct: mutation.data.ivaTransferPct })}
              </Banner>
            )}
            {mutation.isError && ackStale === null && (
              <Banner variant="danger" role="alert">
                {getMessage(mutation.error)}
              </Banner>
            )}
          </div>
        ) : (
          /* ⛔ La rama que este proyecto ya se comió cuatro veces: sin ella, un `data` ausente deja
             un hueco en blanco y el operador lee «la pantalla está rota» cuando sólo está sin
             datos. Aquí además es informativo: el dial **no se puede mover a ciegas**. */
          <EmptyState title={t('empty.title')} body={t('empty.body')} />
        )}
      </QueryState>
    </section>
  );
}

/**
 * Las dos posiciones lado a lado. ⭐ **El admin SÍ ve el desglose completo** —base, IVA, neto,
 * exhibido y dial— porque *«es donde se toma la decisión de margen»* (`PROJECT §Q.5`); ⛔ el
 * cliente no ve ninguna de estas columnas (criterio **209**).
 */
function PositionTable({ preview, locale }: { preview: IvaTransferPreviewDTO; locale: AppLocale }) {
  const t = useTranslations('admin.m10.ivaTransfer.table');
  const rows: { key: string; pick: (p: IvaTransferPositionDTO) => number }[] = [
    { key: 'dial', pick: (p) => p.ivaTransferPct },
    { key: 'display', pick: (p) => p.displayPriceCents },
    { key: 'taxBase', pick: (p) => p.taxBaseCents },
    { key: 'iva', pick: (p) => p.ivaCents },
    { key: 'net', pick: (p) => p.netRevenueCents },
    { key: 'charged', pick: (p) => p.totalChargedCents },
  ];
  return (
    <table className="w-full text-sm">
      <caption className="mb-2 text-left text-xs text-muted">
        {t('caption', { rate: preview.ivaRatePct })}
      </caption>
      <thead>
        <tr className="border-b border-border">
          <th scope="col" className="py-2 text-left font-normal text-muted">
            {t('concept')}
          </th>
          <th scope="col" className="py-2 text-right font-normal text-muted">
            {t('current')}
          </th>
          <th scope="col" className="py-2 text-right font-normal text-muted">
            {t('proposed')}
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key} className="border-b border-border/60">
            <th scope="row" className="py-2 text-left font-normal text-text">
              {t(`rows.${row.key}`)}
            </th>
            <td className="tabular py-2 text-right font-mono text-muted">
              {row.key === 'dial'
                ? `${row.pick(preview.current)} %`
                : formatMoneyCents(row.pick(preview.current), locale)}
            </td>
            <td className="tabular py-2 text-right font-mono text-text">
              {row.key === 'dial'
                ? `${row.pick(preview.proposed)} %`
                : formatMoneyCents(row.pick(preview.proposed), locale)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
