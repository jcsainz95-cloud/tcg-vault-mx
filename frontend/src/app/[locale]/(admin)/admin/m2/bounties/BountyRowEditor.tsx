'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ApiClientError } from '@/lib/api-client';
import { formatMoneyCents } from '@/lib/format';
import { useErrorMessage } from '@/components/ui/QueryState';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import type { AdminBountyRowDTO, VariantControlsRequest } from '@/types/contract';
import type { AppLocale } from '@/i18n/routing';
import {
  bountyPremium,
  buildBountyControlsRequest,
  isBountyDraftDirty,
  raisesSpend,
  type BountyDraft,
} from './bounty-view-model';

/**
 * Bloque de EDICIÓN de una fila (§28.6). Vive **en el sitio de la fila** (`<tr>` con `<td colspan>`),
 * no en un modal: el contexto —las dos cifras y el avance— tiene que seguir a la vista mientras se
 * teclea. Tres controles y ningún adorno.
 *
 * ⛔ **Nada de esto es masivo**: se abre por un acto explícito del humano **sobre UNA fila**, y el
 * `PUT` que emite muta **una** variante (§M2-B.2).
 */

/** `'' ⇒ null` (vacío), texto no numérico ⇒ `undefined` (inválido). */
function parsePesos(v: string): number | null | undefined {
  const s = v.trim();
  if (s === '') return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return undefined;
  return Math.round(n * 100);
}

function parseQty(v: string): number | null | undefined {
  const s = v.trim();
  if (s === '') return null;
  const n = Number(s);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) return undefined;
  return n;
}

export interface BountyRowEditorProps {
  row: AdminBountyRowDTO;
  /** Se abrió con `Encender`: el interruptor entra puesto y se avisa de revisar el precio. */
  turnOnIntent?: boolean;
  saving: boolean;
  /** Error del servidor de ESTA fila (se ancla aquí, nunca en un toast efímero — §28.6e). */
  error?: unknown;
  onCancel: () => void;
  onSubmit: (req: VariantControlsRequest) => void;
}

export function BountyRowEditor({
  row,
  turnOnIntent = false,
  saving,
  error,
  onCancel,
  onSubmit,
}: BountyRowEditorProps) {
  const t = useTranslations('admin.m2.bounties');
  const tAdmin = useTranslations('admin');
  const tBounty = useTranslations('admin.bounty');
  const tRoot = useTranslations();
  const locale = useLocale() as AppLocale;
  const getError = useErrorMessage('operator');
  const priceRef = useRef<HTMLInputElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);

  const bounty = row.pricing.bounty ?? null;
  const curveQuoteCents = bounty?.curveQuoteCents ?? null;
  const money = (cents: number) => formatMoneyCents(cents, locale);

  /** Lo PERSISTIDO, tal como lo devolvió el servidor. Es la referencia contra la que se compara. */
  const stored: BountyDraft = useMemo(
    () => ({
      enabled: bounty?.enabled ?? false,
      priceCents: bounty?.priceCents ?? null,
      targetQty: row.progress.targetQty,
    }),
    [bounty?.enabled, bounty?.priceCents, row.progress.targetQty],
  );

  const [enabled, setEnabled] = useState(turnOnIntent ? true : stored.enabled);
  // ⛔ El campo de precio **NO se prellena con la tarifa vigente** (ni con `tarifa + algo`), tampoco
  // al poner precio a un `invalida`: el precio de un bounty es SIEMPRE explícito, jamás calculado, y
  // prellenarlo desde la curva lo vuelve calculado por defecto (§M2-B.3, §28.6g, §28.13 nº13).
  // Enseñar la tarifa al lado del campo es correcto y es el punto; escribirla en el campo no.
  const [priceInput, setPriceInput] = useState(
    stored.priceCents != null ? String(stored.priceCents / 100) : '',
  );
  // El objetivo llega **prellenado con 2** para un bounty encendido sin objetivo previo (D32/D35) y
  // ⛔ **nunca se envía `targetQty: null`**.
  const [targetInput, setTargetInput] = useState(
    stored.targetQty != null
      ? String(stored.targetQty)
      : stored.enabled || turnOnIntent
        ? '2'
        : '',
  );
  const [confirmOpen, setConfirmOpen] = useState(false);

  // El foco entra en `Pagamos`: es el campo que la fila pide arreglar, tanto en `Editar` como en
  // `Poner precio` y en `Encender`.
  useEffect(() => {
    priceRef.current?.focus();
  }, []);

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  const priceCents = parsePesos(priceInput);
  const targetQty = parseQty(targetInput);
  const priceMalformed = priceCents === undefined || (priceCents != null && priceCents <= 0);
  const targetMalformed = targetQty === undefined;

  const draft: BountyDraft = {
    enabled,
    priceCents: priceMalformed ? stored.priceCents : (priceCents ?? null),
    targetQty: targetMalformed ? stored.targetQty : (targetQty ?? null),
  };

  // Espejo de las guardas del servidor (mismo copy). No sustituyen a la guarda: la evitan de balde.
  // `BOUNTY_TARGET_REQUIRED` se ataja aquí porque mandar `targetQty: null` está prohibido y omitirlo
  // dejaría que el default de D35 guardara un objetivo que el humano acababa de borrar (criterio
  // 164(d): *«guardar con el objetivo borrado tampoco guarda, y con el mismo error»*).
  const priceMissing = enabled && (priceCents == null || priceCents <= 0);
  const targetMissing = enabled && (targetQty == null || targetQty < 1);
  const clientInvalid = priceMalformed || targetMalformed || priceMissing || targetMissing;

  const dirty = isBountyDraftDirty(stored, draft);
  const raising = raisesSpend(stored, draft);
  const canSave = dirty && !clientInvalid && !saving;

  const premium = bountyPremium(
    row.state,
    draft.priceCents,
    curveQuoteCents,
  );

  function submit() {
    // ⛔ `sellOverrideCents` / `buyOverrideCents` NO viajan aquí. Ver `buildBountyControlsRequest`.
    onSubmit(buildBountyControlsRequest(stored, draft));
  }

  function attemptSave() {
    if (!canSave) return;
    if (raising) {
      setConfirmOpen(true);
      return;
    }
    submit();
  }

  const serverMessage = (() => {
    if (!error) return null;
    if (error instanceof ApiClientError && error.code === 'BOUNTY_BELOW_RULE') {
      const fromServer = error.details?.curveQuoteCents;
      const rate = typeof fromServer === 'number' ? fromServer : curveQuoteCents;
      // ⚠️ `422 BOUNTY_BELOW_RULE` desde esta pantalla **NO es un fallo de la pantalla: es la guarda
      // funcionando** sobre una curva que se movió entre el render y el guardado. Se pinta con la
      // tarifa que venga en el error y ⛔ no se reintenta solo ni se recalcula el precio por cuenta
      // propia (§M2-B.3, §28.6e).
      return tRoot('error.BOUNTY_BELOW_RULE', { suggested: rate != null ? money(rate) : '—' });
    }
    return getError(error);
  })();

  return (
    <td colSpan={7} className="border-l-2 border-accent bg-surface-2/40 px-4 py-5">
      <p className="eyebrow mb-4">
        {t('edit.title')} · <span lang="en">{row.name}</span> · {row.setName} #{row.number}
      </p>

      {/* Aviso de REBASADO: el mismo banner de §21.9c, con sus dos cifras. Se pinta por el `state`
          que trajo la fila, ⛔ NO por comparar los dos números en pantalla. */}
      {row.state === 'rebasada' && curveQuoteCents != null && (
        <Banner variant="warning" role="status" title={tBounty('outbidTitle')} className="mb-4">
          <span className="font-mono tabular-nums">
            {tBounty('outbidYours', { amount: money(stored.priceCents ?? 0) })} ·{' '}
            {tBounty('outbidCurrent', { amount: money(curveQuoteCents) })}
          </span>
          <p>{tBounty('outbidBody', { amount: money(curveQuoteCents) })}</p>
        </Banner>
      )}

      {/* La fila `invalida`: encendida, sin precio y con DOS puertas. ⛔ Sin `role="alert"`, sin
          icono de aspa y sin la palabra «error»: es una decisión pendiente, no una alarma. */}
      {row.state === 'invalida' && (
        <Banner variant="warning" role="status" title={t('noPrice.bannerTitle')} className="mb-4">
          {t('noPrice.bannerBody', { rate: curveQuoteCents != null ? money(curveQuoteCents) : '—' })}
        </Banner>
      )}

      {turnOnIntent && (
        <Banner variant="warning" role="status" className="mb-4">
          {t('row.turnOnHint')}
        </Banner>
      )}

      <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
        <div>
          <Input
            ref={priceRef}
            label={t('edit.price')}
            prefix="MX$"
            inputMode="decimal"
            className="font-mono tabular-nums text-base"
            value={priceInput}
            onChange={(e) => setPriceInput(e.target.value)}
            error={priceMissing || priceMalformed ? tRoot('error.BOUNTY_PRICE_REQUIRED') : undefined}
            hint={
              curveQuoteCents != null
                ? tBounty('mustBeHigherHint', { amount: money(curveQuoteCents) })
                : t('premium.noRateAria')
            }
          />
          {/* «Premium sobre la curva», el copy de §21.9d. Es una RESTA de las dos cifras que ya
              vinieron: ⛔ no clasifica la fila (el estado lo dijo el servidor). */}
          {(premium.kind === 'above' || premium.kind === 'below') && (
            <p className="mt-2 font-mono text-xs tabular-nums text-muted">
              {t(premium.kind === 'above' ? 'premium.above' : 'premium.below', {
                amount: money(premium.amountCents),
                pct: premium.pct.toFixed(1),
              })}
            </p>
          )}
        </div>

        <div>
          <Input
            label={t('edit.target')}
            inputMode="numeric"
            className="font-mono tabular-nums text-base"
            value={targetInput}
            onChange={(e) => setTargetInput(e.target.value)}
            error={
              targetMissing || targetMalformed ? tRoot('error.BOUNTY_TARGET_REQUIRED') : undefined
            }
            hint={t('edit.targetHint', { n: targetQty ?? stored.targetQty ?? 2 })}
          />
        </div>

        <label className="flex items-center gap-3 self-start pt-6 text-sm">
          <input
            type="checkbox"
            role="switch"
            checked={enabled}
            aria-checked={enabled}
            onChange={(e) => {
              const next = e.target.checked;
              setEnabled(next);
              // Al encender un bounty sin objetivo previo, el formulario propone el default de D35.
              if (next && targetInput.trim() === '' && stored.targetQty == null) setTargetInput('2');
            }}
          />
          {t('edit.enabled')}
        </label>
      </div>

      {serverMessage && (
        <div ref={errorRef} tabIndex={-1} className="mt-4 outline-none">
          <Banner variant="danger" role="status">
            {serverMessage}
          </Banner>
        </div>
      )}

      <div className="mt-5 flex flex-wrap items-center justify-end gap-3">
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={saving}>
          {tRoot('common.cancel')}
        </Button>
        <Button
          size="sm"
          onClick={attemptSave}
          disabled={!canSave}
          loading={saving}
          title={!dirty ? t('edit.noChanges') : undefined}
          aria-describedby={!dirty ? `${row.cardId}-${row.finish}-nochanges` : undefined}
        >
          {saving
            ? t('edit.saving')
            : raising && draft.priceCents != null
              ? t('edit.saveRaising', { amount: money(draft.priceCents) })
              : t('edit.save')}
        </Button>
        {!dirty && (
          <span id={`${row.cardId}-${row.finish}-nochanges`} className="sr-only">
            {t('edit.noChanges')}
          </span>
        )}
      </div>

      {/* La fricción va en la dirección del dinero: solo lo que SUBE lo que pagamos abre ventana. */}
      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title={stored.enabled ? t('confirm.title') : t('confirm.titleOn')}
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setConfirmOpen(false)}>
              {tRoot('common.cancel')}
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setConfirmOpen(false);
                submit();
              }}
            >
              {t('confirm.cta', { amount: draft.priceCents != null ? money(draft.priceCents) : '—' })}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-2">
          {draft.priceCents != null && (
            <p className="font-mono text-xs tabular-nums">
              {t('confirm.price', {
                before: stored.priceCents != null ? money(stored.priceCents) : '—',
                after: money(draft.priceCents),
                delta: money(Math.max(0, draft.priceCents - (stored.priceCents ?? 0))),
              })}
            </p>
          )}
          {draft.targetQty != null && draft.targetQty !== stored.targetQty && (
            <p className="font-mono text-xs tabular-nums">
              {t('confirm.target', { before: stored.targetQty ?? '—', after: draft.targetQty })}
            </p>
          )}
          <p className="text-xs text-muted">{tAdmin('moneyOutNote')}</p>
        </div>
      </Modal>
    </td>
  );
}
