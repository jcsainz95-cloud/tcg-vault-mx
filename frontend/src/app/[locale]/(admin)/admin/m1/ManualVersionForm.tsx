'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useMutation } from '@tanstack/react-query';
import { attachStampedCandidate } from '@/lib/api';
import { asApiError } from '@/lib/api-client';
import { createManualVersion, type ManualVersionResponse } from '@/lib/api/manual-version';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { STAMP_TYPES, type CardDTO, type CardVersionsResponse, type Finish, type StampType } from '@/types/contract';

/**
 * §ALTA-LIGA-2 (UX-ALTA-LIGA-2, opción A): «+ Versión de liga» DENTRO del alta rápida. Tipo de sello (lo que ofrece el
 * servidor), etiqueta opcional y acabado; al crear, el padre vuelve a pedir `GET …/versions` y deja elegida la nueva.
 * 409 `USE_EXISTING`: el servidor ya tiene una candidata o un producto real de ese tipo ⇒ se ofrece ligarla (`attach`,
 * el flujo de siempre) o usarla ahí mismo, sin crear un duplicado.
 */
export function ManualVersionForm({
  card,
  stampTypes,
  defaultFinish,
  onCreated,
  onAttached,
  onStamp,
}: {
  card: Pick<CardDTO, 'id' | 'availableFinishes'>;
  stampTypes?: StampType[];
  defaultFinish: Finish;
  onCreated: (res: ManualVersionResponse, finish: Finish) => Promise<void>;
  onAttached: (res: CardVersionsResponse) => void;
  onStamp: (productId: number | null) => void;
}) {
  const t = useTranslations('admin.m1.ids.manual');
  const ts = useTranslations('admin.m1.ids.stampButton');
  const tFinish = useTranslations('finish');
  const [open, setOpen] = useState(false);
  const types = stampTypes?.length ? stampTypes : [...STAMP_TYPES];
  const finishes = card.availableFinishes.length ? card.availableFinishes : (['normal'] as Finish[]);
  const [type, setType] = useState<StampType>(types[0]);
  const [label, setLabel] = useState('');
  const [finish, setFinish] = useState<Finish>(finishes.includes(defaultFinish) ? defaultFinish : finishes[0]);

  const create = useMutation({
    mutationFn: () => createManualVersion(card.id, { stampType: type, stampLabel: label, finish }),
    onSuccess: async (res) => {
      await onCreated(res, finish);
      setOpen(false);
      setLabel('');
    },
  });
  const attach = useMutation({
    mutationFn: (productId: number) => attachStampedCandidate(productId, card),
    onSuccess: (res, productId) => {
      onAttached(res);
      onStamp(productId);
      create.reset();
      setOpen(false);
    },
  });

  const err = asApiError(create.error);
  const existing = err?.code === 'USE_EXISTING' ? existingOf(err.details) : null;
  const errText = !err || existing ? null : t(`errors.${errorKey(err.code, err.status)}`);
  const labelTooLong = label.trim().length > 40;

  if (!open) {
    return (
      <Button type="button" variant="secondary" size="sm" className="self-start" onClick={() => setOpen(true)} data-testid="manual-version-open">
        {t('add')}
      </Button>
    );
  }

  return (
    <form
      className="flex flex-col gap-3 border-l-2 border-accent pl-3"
      data-testid="manual-version-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!labelTooLong) create.mutate();
      }}
    >
      <p className="text-sm text-text">{t('title')}</p>
      <Select label={t('type')} value={type} onChange={(e) => setType(e.target.value as StampType)} options={types.map((s) => ({ value: s, label: ts(s) }))} />
      <Input label={t('label')} hint={t('labelHint')} maxLength={60} value={label} onChange={(e) => setLabel(e.target.value)} error={labelTooLong ? t('labelTooLong') : undefined} />
      <Select label={t('finish')} value={finish} onChange={(e) => setFinish(e.target.value as Finish)} options={finishes.map((f) => ({ value: f, label: tFinish(f) }))} />
      {errText && <Banner variant="danger" role="alert">{errText}</Banner>}
      {existing && (
        <Banner variant="warning" role="alert" title={t('existing.title')}>
          <div className="flex flex-col gap-2">
            {existing.candidates.map((c) => (
              <Button key={`c${c.id}`} type="button" size="sm" variant="secondary" loading={attach.isPending && attach.variables === c.id} onClick={() => attach.mutate(c.id)}>
                {t('existing.attach', { name: c.name })}
              </Button>
            ))}
            {existing.stamps.map((s) => (
              <Button
                key={`s${s.id}`}
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => {
                  onStamp(s.id);
                  create.reset();
                  setOpen(false);
                }}
              >
                {t('existing.use', { name: s.name })}
              </Button>
            ))}
            {attach.isError && <p className="text-sm text-text">{t('existing.attachFailed')}</p>}
          </div>
        </Banner>
      )}
      <div className="flex gap-3">
        <Button type="submit" size="sm" loading={create.isPending} disabled={labelTooLong}>{t('submit')}</Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => { create.reset(); setOpen(false); }}>{t('cancel')}</Button>
      </div>
    </form>
  );
}

function errorKey(code: string, status: number): 'CARD_NOT_FOUND' | 'VALIDATION_ERROR' | 'FINISH_NOT_AVAILABLE' | 'RATE_LIMITED' | 'FORBIDDEN' | 'generic' {
  if (code === 'CARD_NOT_FOUND' || code === 'VALIDATION_ERROR' || code === 'FINISH_NOT_AVAILABLE' || code === 'RATE_LIMITED') return code;
  if (status === 429) return 'RATE_LIMITED';
  if (status === 403) return 'FORBIDDEN';
  return 'generic';
}

interface Existing {
  candidates: { id: number; name: string }[];
  stamps: { id: number; name: string }[];
}
/** `details.candidates|stamps` del 409 (el anexo no fija la forma exacta): se leen con tolerancia, sin inventar nada. */
function existingOf(details: Record<string, unknown> | undefined): Existing {
  const list = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? (v.filter((x) => x && typeof x === 'object') as Record<string, unknown>[]) : []);
  const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
  const candidates: Existing['candidates'] = [];
  for (const c of list(details?.candidates)) {
    const id = num(c.tcgplayerProductId) ?? num(c.productId) ?? num(c.id);
    if (id != null) candidates.push({ id, name: String(c.name ?? c.label ?? `#${id}`) });
  }
  const stamps: Existing['stamps'] = [];
  for (const s of list(details?.stamps)) {
    const id = num(s.productId) ?? num(s.id);
    if (id != null) stamps.push({ id, name: String(s.label ?? s.name ?? s.type ?? `#${id}`) });
  }
  return { candidates, stamps };
}
