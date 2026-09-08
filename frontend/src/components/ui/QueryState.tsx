'use client';

import { useLocale, useTranslations } from 'next-intl';
import { Banner } from './Banner';
import { Button } from './Button';
import { ApiClientError } from '@/lib/api-client';
import { gradeLabelFromKey } from '@/lib/gradeKey';
import { getBadgeSpec } from '@/lib/status-map';
import { formatMoneyCents } from '@/lib/format';
import { errorMessageKeys, resolveErrorAudience, type ErrorAudience } from '@/lib/error-audience';
import type { AppLocale } from '@/i18n/routing';

export interface QueryStateProps {
  isLoading: boolean;
  isError: boolean;
  error?: unknown;
  onRetry?: () => void;
  loading?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * Algunos errores del contrato traen `details` **accionables** y su copy tiene por eso una variante
 * enriquecida `error.<CODE>_WITH_DETAILS`. La tabla mapea el `details` crudo a los valores ICU de
 * esa variante, y devuelve `null` cuando el backend no mandó lo necesario: entonces se usa el copy
 * base. Nunca se pinta un placeholder crudo (`{count}`) ni se inventa un número.
 *
 * `GRADED_ESTIMATE_SLAB_PUBLISHED` (409, §O.8) es el caso que motivó esto: sin la cifra, el
 * operador lee «hay slabs publicados» y no sabe **cuántos** ni de **qué grado**; con ella, el
 * mensaje es el que §O.8 exige — «esta carta ya tiene N PSA 10 publicadas, eso es dinero real».
 */
const DETAILED_ERRORS: Record<
  string,
  (
    details: Record<string, unknown>,
    t: ReturnType<typeof useTranslations>,
    locale: AppLocale,
  ) => Record<string, string | number> | null
> = {
  GRADED_ESTIMATE_SLAB_PUBLISHED: (d) => {
    const count = d.publishedSlabCount;
    const grade = typeof d.gradeKey === 'string' ? gradeLabelFromKey(d.gradeKey) : null;
    if (typeof count !== 'number' || !Number.isFinite(count) || !grade) return null;
    return { count, grade };
  },

  /**
   * `409 CONFLICT` de los verbos que transicionan una solicitud de buylist (contrato **§M5-T**):
   * el servidor rechaza escribir sobre una fila **terminal o cerrada** y manda
   * `details: { status, closedAt }` — los **dos** términos, porque pueden discrepar (una fila con
   * `closedAt` sellado y `status` NO terminal es justo el caso que motivó la invariante).
   *
   * Sin esto el operador leía solo *«Hubo un conflicto con el estado actual»*: en una cola de
   * back-office un genérico se lee como *«la app falló»* y se reintenta. El copy enriquecido dice
   * **en qué estado quedó** la solicitud y, cuando el servidor manda `closedAt`, que **ya cerró**.
   *
   * ⚠️ El rótulo del estado sale del MISMO mapa que pinta el badge (`status-map`), no de una tabla
   * nueva ni de un literal: DESIGN_SYSTEM §9.2 prohíbe pintar el enum crudo, y una segunda tabla
   * sería otra copia del vocabulario de estado que §M5-T/criterio 129 vinieron a borrar. Si el
   * valor no tiene rótulo —enum desconocido, o un `409` de otra superficie cuyo `details.status` no
   * es un estado de solicitud— se devuelve `null` y se usa el copy base: **no se inventa nada**.
   * ⚠️ Solo el ESTADO. Ni la marca de tiempo, ni montos, ni identidades: el mensaje explica qué
   * pasó, no vuelca la fila (regla de PII/cifras internas de `PROJECT.md`, toda superficie).
   */
  CONFLICT: (d, t) => {
    if (typeof d.status !== 'string' || d.status === '') return null;
    const labelKey = getBadgeSpec('sellRequest', d.status).i18nKey;
    if (!t.has(labelKey)) return null;
    return {
      status: t(labelKey),
      // `closedAt` es OPCIONAL en la práctica (§4.18f lo declara aditivo ahí): su ausencia no
      // degrada el mensaje, solo le quita la frase de «ya cerró».
      closed: typeof d.closedAt === 'string' && d.closedAt !== '' ? 'yes' : 'no',
    };
  },

  /**
   * `422 BUYLIST_LIMIT_EXCEEDED` del **tope mensual** (contrato §M5-A · `details: { scope,
   * capCents, wouldBeCents }`). DESIGN_SYSTEM **§26.5**: las cifras se le dan **al operador** y
   * **solo sobre los topes de COMPRA** — le dicen cuánto sobra, que es la cota de la decisión que
   * está tomando.
   *
   * ⛔ **Jamás el umbral de INE** (`thresholdCents`): ése es un dato de cumplimiento **sobre un
   * tercero** que no mueve ninguna de sus dos palancas (§26.6, prohibición 2). Por eso esta entrada
   * lee `capCents`/`wouldBeCents` **y nada más**; y por eso la variante con cifras existe solo del
   * lado del operador — la clave `error.BUYLIST_LIMIT_EXCEEDED_WITH_DETAILS` **no está en el
   * catálogo**, así que el vendedor cae a su base aunque su `details` traiga los montos.
   *
   * Si falta cualquiera de los dos montos se devuelve `null` y se pinta la base: nunca un
   * `MX$ undefined` (§26.5).
   */
  /**
   * `422 ITEMS_NOT_DECIDED` del pago SPEI (contrato §M5-V · `details: { sellRequestId,
   * pendingDecisionItemIds }`). DESIGN_SYSTEM **§27.1.2**, que es normativa y delicada:
   * ```
   * count = details.pendingDecisionItemIds.length   ← la lista QUE MANDÓ EL SERVIDOR, en ESTE error
   * ```
   * - Se pinta la variante con cifra **⇔ el array existe y NO está vacío**; en cualquier otro caso
   *   (ausente, no-array, vacío) se devuelve `null` y se pinta la base — jamás `{count}` crudo.
   * - ⛔ **No se cuentan filas de la tabla para obtener el número** (§M5-V.5). *Contar la longitud
   *   de una lista que mandó el servidor no es derivar la regla: es leer su respuesta.*
   * - ⛔ **Y no se usa `pendingDecisionItemCount` del DTO**, aunque la pantalla lo tenga a mano:
   *   ese número es de **otro instante** y puede estar rancio respecto del `422` recién recibido
   *   (§27.1.2). **El error trae su propia cuenta; el DTO alimenta el aviso preventivo.**
   */
  ITEMS_NOT_DECIDED: (d) => {
    const ids = d.pendingDecisionItemIds;
    if (!Array.isArray(ids) || ids.length === 0) return null;
    return { count: ids.length };
  },

  BUYLIST_LIMIT_EXCEEDED: (d, _t, locale) => {
    const cap = d.capCents;
    const wouldBe = d.wouldBeCents;
    if (typeof cap !== 'number' || !Number.isFinite(cap)) return null;
    if (typeof wouldBe !== 'number' || !Number.isFinite(wouldBe)) return null;
    return {
      capAmount: formatMoneyCents(cap, locale),
      wouldBeAmount: formatMoneyCents(wouldBe, locale),
    };
  },
};

/**
 * Traduce errorCode del contrato a copy localizado (DESIGN_SYSTEM §8.1 · §26).
 *
 * ⚠️ **Llavea por `code` + DESTINATARIO, no por `code` a secas** — y ése es el arreglo de §26: un
 * mismo código puede llegarle al **vendedor** y al **operador**, que no son la misma persona ni
 * tienen las mismas palancas. El orden de resolución es normativo (§26.5): **primero a quién le
 * hablas, después con cuánto detalle**.
 *
 * @param surfaceAudience Quién LEE esta pantalla. Las superficies de back-office declaran
 * `'operator'`; sin él, un `422` de `POST …/offer` le diría al operador que suba **su** INE. No es
 * opcional por gusto: hay un candado (`error-audience.test.ts`) que exige que **toda** pantalla de
 * `(admin)` lo declare, porque hoy nada falla si se omite — que es justo por lo que se omitió.
 */
export function useErrorMessage(surfaceAudience?: ErrorAudience) {
  const t = useTranslations();
  const locale = useLocale() as AppLocale;
  return (error: unknown): string => {
    const apiError = error instanceof ApiClientError ? error : null;
    const code = apiError?.code ?? 'INTERNAL';
    const audience = resolveErrorAudience(code, apiError?.details, surfaceAudience);
    const detailed = apiError?.details
      ? DETAILED_ERRORS[code]?.(apiError.details, t, locale)
      : null;
    // `error.<CODE>_OPERATOR[_WITH_DETAILS]` antes que `error.<CODE>[_WITH_DETAILS]`: la variante
    // del destinatario gana, y dentro de cada destinatario gana la que lleva las cifras.
    for (const key of errorMessageKeys(code, audience)) {
      const detailedKey = `${key}_WITH_DETAILS`;
      if (detailed && t.has(detailedKey)) return t(detailedKey, detailed);
      if (t.has(key)) return t(key);
    }
    // ⚠️ Último recurso, y para los códigos de §26 es **inalcanzable por construcción** (todos
    // tienen base en los dos catálogos, y el candado lo verifica): el inglés del servidor está
    // escrito para un desarrollador, no para quien decide una compra.
    if (apiError?.message) return apiError.message;
    return t('common.errorGeneric');
  };
}

export function QueryState({ isLoading, isError, error, onRetry, loading, children }: QueryStateProps) {
  const t = useTranslations('common');
  const getMessage = useErrorMessage();

  if (isLoading) return <>{loading ?? <p className="text-sm text-muted">{t('loading')}</p>}</>;
  if (isError) {
    return (
      <Banner
        variant="danger"
        role="alert"
        title={t('errorTitle')}
        action={
          onRetry && (
            <Button size="sm" variant="secondary" onClick={onRetry}>
              {t('retry')}
            </Button>
          )
        }
      >
        {getMessage(error)}
      </Banner>
    );
  }
  return <>{children}</>;
}
