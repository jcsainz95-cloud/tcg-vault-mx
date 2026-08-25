'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { getSealedSpreads, updateSealedSpreads } from '@/lib/api';
import {
  SEALED_SUBTYPES,
  type SealedSubtype,
  type SealedSpreadsUpdateRequest,
} from '@/types/contract';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Banner } from '@/components/ui/Banner';
import { Badge } from '@/components/ui/Badge';
import { QueryState, useErrorMessage } from '@/components/ui/QueryState';
import { isSaveableRuleValue, sanitizeDecimalInput } from './shared';

/**
 * Sección 5b — spreads de VENTA del SELLADO por PRESENTACIÓN (v1.23-sealed-sales). El pct es MARKUP
 * arriba de mercado: salePriceCents = round(mercadoTCGCSV × (1 + spread/100)). Un spread 0% vende
 * sin margen → se advierte visualmente (por fila y con un banner global money-safe).
 *
 * T-1 (techlead) · contrato v2.1.9 §M2 — DOS reglas que esta pantalla tiene que cumplir a la vez:
 *
 *  1. **Los renglones salen del ENUM `SealedSubtype` (siete), NUNCA de las llaves de la respuesta.**
 *     El `GET` devuelve un mapa PARCIAL: omite las presentaciones sin regla propia, y `upc`/
 *     `collection` NO tienen semilla en §K. Derivar los renglones de lo que llega dejaría a UPC sin
 *     fila —el mismo hueco por otra puerta— y el dueño seguiría sin poder calibrar lo que vende.
 *  2. **Una llave ausente se pinta «usa el global», no un vacío ni un cero.** Ausente ≠ 0: la
 *     presentación cae al `fallbackPct`, y el dueño tiene que VER que le está pasando eso — es
 *     exactamente lo que no sabía de sus UPC. El campo queda vacío (con el global de marca de agua)
 *     y una etiqueta lo dice con todas sus letras.
 *  3. **TRES estados por llave, no dos** (v2.1.9, `SealedSpreadsUpdateRequest`): con valor ⇒ se
 *     manda el número · **VACIADO ⇒ se manda `null`** (retira la regla, vuelve al global) · no
 *     tocado ⇒ **la llave no viaja**. `null` ≠ `0`: el `0` es un spread LEGÍTIMO —«vender al
 *     mercado, sin markup»— así que vaciar un campo JAMÁS puede viajar como `0`; eso pondría esa
 *     presentación a precio de mercado sin margen sin que nadie lo pidiera. Y por eso el `PUT` es
 *     PARCIAL y no un reemplazo total: mandar «el mapa completo» desde un cliente rancio borraría
 *     `upc`/`collection` en silencio, que es el bug de la lista de cinco reabierto desde el otro lado.
 *
 * El **global (`fallbackPct`) no se puede vaciar**: es el respaldo del que dependen las
 * presentaciones sin regla, y retirarlo las mandaría a PRICE_PENDING, o sea FUERA de la vitrina,
 * por un gesto que parece de limpieza. El backend responde 422; aquí se impide y se explica.
 */
export function SealedSpreadsSection() {
  const t = useTranslations('admin.m2');
  const tc = useTranslations('common');
  const tSub = useTranslations('status.sealedSubtype');
  const qc = useQueryClient();
  const getError = useErrorMessage();

  const sealedSpreads = useQuery({ queryKey: ['sealed-spreads'], queryFn: getSealedSpreads });
  // Borrador por subtipo + fallback (texto para permitir edición parcial; se castea al guardar).
  const [spreadDraft, setSpreadDraft] = useState<Partial<Record<SealedSubtype, string>>>({});
  const [spreadFallbackDraft, setSpreadFallbackDraft] = useState<string | null>(null);
  const sealedSpreadsMutation = useMutation({
    mutationFn: (payload: SealedSpreadsUpdateRequest) => updateSealedSpreads(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sealed-spreads'] });
      setSpreadDraft({});
      setSpreadFallbackDraft(null);
    },
  });

  const serverSpreadFallback = sealedSpreads.data?.fallbackPct ?? 15;
  const effectiveSpreadFallback = spreadFallbackDraft ?? String(serverSpreadFallback);
  /**
   * El global NO admite `null` (⇒ 422): sin él, toda presentación sin regla propia se quedaría sin
   * de dónde derivar precio ⇒ PRICE_PENDING ⇒ fuera de la vitrina. «Sin markup global» se escribe
   * `0`, no vacío. Se detecta aquí para impedir el guardado y DECIRLO, en vez de revertir en
   * silencio al valor del servidor (que es lo que hacía antes: seguro, pero mudo).
   */
  const fallbackCleared = !isSaveableRuleValue(effectiveSpreadFallback);
  /** Marca de agua de las filas sin regla: si el global está vaciado, se usa el del servidor. */
  const fallbackForDisplay = fallbackCleared ? String(serverSpreadFallback) : effectiveSpreadFallback;
  /**
   * Regla EXPLÍCITA (texto) de un subtipo: borrador > valor del servidor > `null`.
   * `null` NO es 0: significa «esta presentación no tiene regla propia y cae al global».
   * La distinción es la que el dueño no tenía: un `0` vende al costo, el hueco vende con el global.
   */
  function explicitSpread(sub: SealedSubtype): string | null {
    if (spreadDraft[sub] != null) return spreadDraft[sub]!;
    const server = sealedSpreads.data?.spreadPctBySubtype[sub];
    return server != null ? String(server) : null;
  }
  const spreadsDirty =
    Object.keys(spreadDraft).length > 0 ||
    (spreadFallbackDraft != null && spreadFallbackDraft !== String(serverSpreadFallback));
  // Advertencia money-safe: el fallback en 0%, o cualquier regla EXPLÍCITA en 0%, vende sin margen.
  // El hueco→fallback no cuenta (no es un 0: es «usa el global»).
  const anyZeroSpread =
    Number(effectiveSpreadFallback) === 0 ||
    SEALED_SUBTYPES.some((s) => {
      const explicit = explicitSpread(s);
      return explicit != null && explicit.trim() !== '' && Number(explicit) === 0;
    });

  function saveSpreads() {
    if (!sealedSpreads.data || fallbackCleared) return;
    const server = sealedSpreads.data.spreadPctBySubtype;
    // PARCIAL: viajan SOLO las llaves que el dueño tocó (§M2 v2.1.9). Las que no tocó no viajan —
    // no se re-mandan «por si acaso», porque el mapa completo es justamente la forma que el
    // arquitecto descartó (un cliente rancio borraría upc/collection en silencio).
    const patch: Partial<Record<SealedSubtype, number | null>> = {};
    for (const [key, val] of Object.entries(spreadDraft)) {
      const sub = key as SealedSubtype;
      if (isSaveableRuleValue(val)) {
        // Con valor: se fija. Incluye el 0, que es un spread LEGÍTIMO (vender al mercado).
        patch[sub] = Number(val);
      } else if (val.trim() === '') {
        // VACIADO ⇒ `null` (retira la regla; vuelve al global). JAMÁS 0.
        // Si nunca tuvo regla propia no hay nada que retirar: la llave no viaja (evita ruido en
        // la bitácora; el backend igual sería idempotente).
        if (server[sub] != null) patch[sub] = null;
      }
      // Mal formado (".", "1.2.3"): no se manda NADA. Ni fija ni retira — el dueño está a medio
      // teclear y ninguna de las dos cosas es lo que pidió.
    }
    const fallbackChanged =
      spreadFallbackDraft != null && Number(effectiveSpreadFallback) !== serverSpreadFallback;
    const payload: SealedSpreadsUpdateRequest = {};
    if (Object.keys(patch).length > 0) payload.spreadPctBySubtype = patch;
    if (fallbackChanged) payload.fallbackPct = Number(effectiveSpreadFallback);
    if (Object.keys(payload).length === 0) return;
    sealedSpreadsMutation.mutate(payload);
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-h2 font-semibold">{t('sealedSpreads.title')}</h2>
      <p className="text-sm text-muted">{t('sealedSpreads.subtitle')}</p>
      <p className="text-xs text-muted">{t('sealedSpreads.example')}</p>
      <QueryState
        isLoading={sealedSpreads.isLoading}
        isError={sealedSpreads.isError}
        error={sealedSpreads.error}
        onRetry={() => sealedSpreads.refetch()}
      >
        {sealedSpreads.data && (
          <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
            {/* Fallback % (markup arriba de mercado) para presentaciones sin regla explícita */}
            <div className="flex flex-wrap items-end gap-3 border-b border-border pb-4">
              <Input
                label={t('sealedSpreads.fallbackLabel')}
                type="text"
                inputMode="decimal"
                suffix="%"
                className="w-32"
                value={effectiveSpreadFallback}
                aria-invalid={fallbackCleared || undefined}
                onChange={(e) => setSpreadFallbackDraft(sanitizeDecimalInput(e.target.value))}
              />
              {fallbackCleared ? (
                <p className="text-xs text-accent" role="alert">
                  {t('sealedSpreads.fallbackRequired')}
                </p>
              ) : (
                <p className="text-xs text-muted">{t('sealedSpreads.fallbackHint')}</p>
              )}
            </div>

            <ul className="flex flex-col divide-y divide-border">
              <li className="hidden gap-3 py-2 text-xs uppercase tracking-wide text-muted md:grid md:grid-cols-[1fr_auto_auto]">
                <span>{t('sealedSpreads.subtype')}</span>
                <span>{t('sealedSpreads.spread')}</span>
                <span />
              </li>
              {/* UNA FILA POR VALOR DEL ENUM (contrato v2.1.9 §M2): los siete, siempre — también
                  las que el `GET` omite por no tener regla. Sin esto, `upc` y `collection` (que no
                  tienen semilla) se quedaban sin fila y no había dónde ponerles precio. */}
              {SEALED_SUBTYPES.map((sub) => {
                const explicit = explicitSpread(sub);
                // «Usa el global» cubre DOS estados: no tiene regla propia (llave ausente) y el
                // dueño acaba de VACIARLA (que al guardar la retira). Los dos terminan en el
                // fallback, así que la pantalla cuenta lo mismo en los dos — y ninguno es un 0.
                const usesGlobal = explicit == null || explicit.trim() === '';
                const isZero = !usesGlobal && Number(explicit) === 0;
                return (
                  <li
                    key={sub}
                    className="grid grid-cols-2 items-end gap-3 py-3 md:grid-cols-[1fr_auto_auto]"
                  >
                    <span className="text-sm font-medium">{tSub(sub)}</span>
                    <Input
                      label={t('sealedSpreads.spread')}
                      aria-label={t('sealedSpreads.spreadFor', { subtype: tSub(sub) })}
                      type="text"
                      inputMode="decimal"
                      suffix="%"
                      className="w-32"
                      // Vacío = sin regla propia. El global va de marca de agua (no de valor): un
                      // número pintado como si fuera suyo es justo lo que ocultaba el fallback.
                      value={explicit ?? ''}
                      placeholder={fallbackForDisplay}
                      onChange={(e) =>
                        setSpreadDraft((prev) => ({ ...prev, [sub]: sanitizeDecimalInput(e.target.value) }))
                      }
                    />
                    {/* Fila sin regla propia: se DICE que cae al global (ausente ≠ 0%). */}
                    {usesGlobal ? (
                      <Badge tone="neutral" shape="outline">
                        {t('sealedSpreads.usesGlobal', { pct: fallbackForDisplay })}
                      </Badge>
                    ) : isZero ? (
                      /* Advertencia por-fila: spread 0% = vende sin margen. */
                      <Badge tone="warning" shape="outline">
                        {t('sealedSpreads.zeroWarning')}
                      </Badge>
                    ) : (
                      <span />
                    )}
                  </li>
                );
              })}
            </ul>

            <p className="text-xs text-muted">{t('sealedSpreads.prereqHint')}</p>

            {/* Aviso global money-safe si algún spread efectivo queda en 0%. */}
            {anyZeroSpread && (
              <Banner variant="warning" role="status">{t('sealedSpreads.zeroBanner')}</Banner>
            )}

            <div className="flex gap-2">
              <Button
                variant="secondary"
                disabled={!spreadsDirty || fallbackCleared}
                loading={sealedSpreadsMutation.isPending}
                onClick={saveSpreads}
              >
                {tc('save')}
              </Button>
              {spreadsDirty && (
                <Button
                  variant="ghost"
                  onClick={() => {
                    setSpreadDraft({});
                    setSpreadFallbackDraft(null);
                  }}
                >
                  {tc('cancel')}
                </Button>
              )}
            </div>
            {sealedSpreadsMutation.isSuccess && (
              <Banner variant="success" role="status">{t('sealedSpreads.saved')}</Banner>
            )}
            {sealedSpreadsMutation.isError && (
              <Banner variant="danger" role="alert" title={tc('errorTitle')}>{getError(sealedSpreadsMutation.error)}</Banner>
            )}
          </div>
        )}
      </QueryState>
    </section>
  );
}
