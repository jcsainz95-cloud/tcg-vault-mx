'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { Link, useRouter } from '@/i18n/navigation';
import type { AppLocale } from '@/i18n/routing';
import {
  activateAdminAccessory,
  createAdminAccessory,
  deactivateAdminAccessory,
  deleteAdminAccessory,
  getAdminAccessory,
  listAccessoryStockMovements,
  postAccessoryStock,
  updateAdminAccessory,
  uploadAccessoryPhoto,
} from '@/lib/api';
import { asApiError } from '@/lib/api-client';
import { useErrorMessage } from '@/components/ui/QueryState';
import { useRole } from '@/lib/role';
import { formatDateTimeMx, formatMoneyCents } from '@/lib/format';
import { cn } from '@/lib/cn';
import {
  ACCESSORY_CATEGORIES,
  ENERGY_TYPES,
  type AccessoryActivationMissing,
  type AccessoryCategory,
  type AccessoryPhotoInvalidReason,
  type AdminAccessoryDTO,
  type AdminAccessoryWriteFields,
  type EnergyType,
} from '@/types/contract';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { Skeleton } from '@/components/ui/Skeleton';
import { Textarea } from '@/components/ui/Textarea';
import { AccessoryPhoto } from '@/components/domain/accessories/AccessoryPhoto';
import { centsToPesosInput, pesosInputToCents } from './money-input';

const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const PHOTO_REASONS: AccessoryPhotoInvalidReason[] = ['too_large', 'unsupported_type', 'too_many_pixels', 'not_image'];
const SECTION = 'flex flex-col gap-4 border-t border-border pt-6';
const H2 = 'text-h3 font-semibold text-text';

/** Lo que falta para publicar, calculado del DTO (§AC-UX.9b bloque 5; energías sin medidas, v1.86.1). */
export function activationMissing(a: AdminAccessoryDTO): AccessoryActivationMissing[] {
  const m: AccessoryActivationMissing[] = [];
  if (a.priceCents === null) m.push('price');
  if (a.photo === null) m.push('photo');
  if (a.category === 'energy') {
    if (!a.energyType) m.push('energy_type');
  } else {
    if (a.lengthMm === null || a.widthMm === null || a.heightMm === null) m.push('dimensions');
    if (a.weightG === null) m.push('weight');
  }
  return m;
}

/**
 * Alta y edición de un accesorio (`API_CONTRACT §AC.11`, `DESIGN_SYSTEM §AC-UX.9b/.9c`). Una página por accesorio,
 * en bloques con su propio guardar (un error de foto no tira lo escrito en los datos). ★ (solo súper-admin): precio
 * y costo editables, publicación, «Sugerido» y borrar; al operador ⛔ ni el costo aparece (el DTO no lo trae).
 * v1.86.3 (§AC.19.2): PATCH, activar, desactivar, existencias y foto responden `200 AdminAccessoryDTO`; la ficha
 * se pinta con esa fila (⛔ sin volver a pedirla). La lista y el historial sí se invalidan: son otros recursos.
 */
export function AccessoryEditView({ id }: { id?: string }) {
  const t = useTranslations('admin.accessories');
  const searchParams = useSearchParams();
  const created = searchParams?.get('created') === '1';
  const query = useQuery({
    queryKey: ['admin-accessory', id],
    queryFn: () => getAdminAccessory(id!),
    enabled: !!id,
    retry: false,
  });

  return (
    <div className="flex max-w-3xl flex-col gap-8">
      <Link href="/admin/accessories" className="font-mono text-xs text-muted hover:text-text">
        ← {t('back')}
      </Link>
      {!id ? (
        <>
          <h1 className="text-h1 font-semibold text-text">{t('new')}</h1>
          <DataBlock />
        </>
      ) : query.isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : query.isError ? (
        <Banner
          variant="danger"
          role="alert"
          action={
            <Button variant="secondary" size="sm" onClick={() => query.refetch()}>
              {t('retry')}
            </Button>
          }
        >
          {asApiError(query.error)?.status === 404 ? t('notFound') : t('loadError')}
        </Banner>
      ) : (
        <Loaded a={query.data!} created={created} />
      )}
    </div>
  );
}

function Loaded({ a, created }: { a: AdminAccessoryDTO; created: boolean }) {
  const { isSuperAdmin } = useRole();
  const t = useTranslations('admin.accessories');
  const photoRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (created) photoRef.current?.focus();
  }, [created]);
  return (
    <>
      <h1 className="text-h1 font-semibold text-text">{a.name}</h1>
      {created && (
        <Banner variant="success" role="status">
          {t('created')}
        </Banner>
      )}
      <DataBlock a={a} />
      <PhotoBlock a={a} headingRef={photoRef} />
      <PriceBlock a={a} canEdit={isSuperAdmin} />
      <StockBlock a={a} />
      {isSuperAdmin && <PublishBlock a={a} />}
      {isSuperAdmin && <DeleteBlock a={a} />}
    </>
  );
}

function useInvalidate(id?: string) {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['admin-accessory', id] });
    void qc.invalidateQueries({ queryKey: ['admin-accessories'] });
    void qc.invalidateQueries({ queryKey: ['accessory-stock-movements', id] });
  };
}

/** v1.86.3 (§AC.19.2): la fila devuelta ES la ficha; solo la lista y el historial se re-leen. */
function useApplyAccessory(id: string) {
  const qc = useQueryClient();
  return (dto: AdminAccessoryDTO) => {
    qc.setQueryData(['admin-accessory', id], dto);
    void qc.invalidateQueries({ queryKey: ['admin-accessories'] });
    void qc.invalidateQueries({ queryKey: ['accessory-stock-movements', id] });
  };
}

/** Texto de `403 FORBIDDEN_FIELD {fields}` (defensa: la pantalla no ofrece esos campos al operador). */
function useForbiddenText() {
  const t = useTranslations('admin.accessories');
  return (fields: unknown) => {
    const list = Array.isArray(fields) ? fields.map((f) => (t.has(`fieldNames.${f}`) ? t(`fieldNames.${f}`) : String(f))) : [];
    return t('forbiddenField', { fields: list.join(', ') });
  };
}

const intOrNull = (v: string): number | null | typeof Number.NaN => {
  const s = v.trim();
  if (s === '') return null;
  return /^\d+$/.test(s) ? Number(s) : Number.NaN;
};

// ---------- 1 · Datos ----------
function DataBlock({ a }: { a?: AdminAccessoryDTO }) {
  const t = useTranslations('admin.accessories');
  const ta = useTranslations('accessories');
  const router = useRouter();
  const getError = useErrorMessage('operator');
  const forbidden = useForbiddenText();
  const invalidate = useInvalidate(a?.id);
  const apply = useApplyAccessory(a?.id ?? '');
  const [name, setName] = useState(a?.name ?? '');
  const [category, setCategory] = useState<AccessoryCategory | ''>(a?.category ?? '');
  const [energyType, setEnergyType] = useState<EnergyType | ''>(a?.energyType ?? '');
  const [description, setDescription] = useState(a?.description ?? '');
  const [dims, setDims] = useState({
    lengthMm: a?.lengthMm?.toString() ?? '',
    widthMm: a?.widthMm?.toString() ?? '',
    heightMm: a?.heightMm?.toString() ?? '',
    weightG: a?.weightG?.toString() ?? '',
  });
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const isEnergy = category === 'energy';
  const numbers = Object.fromEntries(Object.entries(dims).map(([k, v]) => [k, intOrNull(v)])) as Record<keyof typeof dims, number | null>;
  const badNumber = !isEnergy && Object.values(numbers).some((n) => n !== null && Number.isNaN(n));
  const nameOk = name.trim().length >= 1 && name.trim().length <= 120;
  // Un publicado no cambia a/desde Energías: primero se quita de la tienda (`409 ACCESSORY_ACTIVE`).
  const lockEnergySwitch = !!a?.active;

  const save = useMutation({
    mutationFn: async () => {
      const fields: AdminAccessoryWriteFields = {
        name: name.trim(),
        category: category as AccessoryCategory,
        description: description.trim() ? description : a ? null : undefined,
        energyType: isEnergy ? (energyType || null) : a ? null : undefined,
      };
      if (!isEnergy) {
        for (const [k, n] of Object.entries(numbers)) {
          if (n !== null) (fields as Record<string, number | null>)[k] = n;
          else if (a) (fields as Record<string, number | null>)[k] = null;
        }
      }
      // ⛔ Sin campos ★ en el alta: nace inactiva y sin precio para el operador (§AC.11).
      const body = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)) as AdminAccessoryWriteFields;
      if (!a) return { created: await createAdminAccessory(body as AdminAccessoryWriteFields & { name: string; category: AccessoryCategory }) };
      return { created: null, updated: await updateAdminAccessory(a.id, body) };
    },
    onMutate: () => {
      setError(null);
      setSaved(false);
    },
    onSuccess: ({ created, updated }) => {
      if (created) {
        router.push(`/admin/accessories/${created.id}?created=1`);
        return;
      }
      setSaved(true);
      if (updated) apply(updated);
      else invalidate();
    },
    onError: (e) => {
      const err = asApiError(e);
      if (err?.code === 'ACCESSORY_ACTIVE') return setError(t('categoryLocked'));
      if (err?.code === 'FORBIDDEN_FIELD') return setError(forbidden(err.details?.fields));
      setError(getError(e));
    },
  });

  const categoryOptions = ACCESSORY_CATEGORIES.filter(
    (c) => !lockEnergySwitch || (c === 'energy') === (a?.category === 'energy'),
  ).map((c) => ({ value: c, label: ta(`category.${c}`) }));

  return (
    <section className={SECTION} aria-labelledby="acc-data-title">
      <h2 id="acc-data-title" className={H2}>
        {t('form.dataTitle')}
      </h2>
      <Input
        label={t('form.name')}
        value={name}
        maxLength={120}
        hint={t('form.nameCount', { n: name.length })}
        error={name && !nameOk ? t('form.nameRequired') : undefined}
        onChange={(e) => setName(e.target.value)}
      />
      <Select
        label={t('form.category')}
        value={category}
        placeholder={a ? undefined : t('form.categoryPlaceholder')}
        options={categoryOptions}
        onChange={(e) => setCategory(e.target.value as AccessoryCategory)}
      />
      {lockEnergySwitch && <p className="text-xs text-muted">{t('categoryLocked')}</p>}
      {isEnergy && (
        <Select
          label={t('form.energyType')}
          value={energyType}
          placeholder="—"
          options={ENERGY_TYPES.map((x) => ({ value: x, label: ta(`energyType.${x}`) }))}
          onChange={(e) => setEnergyType(e.target.value as EnergyType)}
        />
      )}
      <Textarea
        label={t('form.description')}
        value={description}
        maxLength={500}
        counter={{ max: 500 }}
        onChange={(e) => setDescription(e.target.value)}
      />
      {isEnergy ? (
        <p className="text-sm text-muted">{t('form.energyNoDims')}</p>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted">{t('form.dimsHelp')}</p>
          <div className="grid gap-4 sm:grid-cols-4">
            {(
              [
                ['lengthMm', 'length'],
                ['widthMm', 'width'],
                ['heightMm', 'height'],
                ['weightG', 'weight'],
              ] as const
            ).map(([k, label]) => (
              <Input
                key={k}
                label={t(`form.${label}`)}
                inputMode="numeric"
                value={dims[k]}
                error={Number.isNaN(numbers[k] as number) ? t('form.invalidNumber') : undefined}
                onChange={(e) => setDims((d) => ({ ...d, [k]: e.target.value }))}
              />
            ))}
          </div>
        </div>
      )}
      <Button className="self-start" disabled={!nameOk || !category || badNumber} loading={save.isPending} onClick={() => save.mutate()}>
        {t('form.saveData')}
      </Button>
      {saved && (
        <Banner variant="success" role="status">
          {t('form.saved')}
        </Banner>
      )}
      {error && (
        <Banner variant="danger" role="alert">
          {error}
        </Banner>
      )}
    </section>
  );
}

// ---------- 2 · Foto ----------
function PhotoBlock({ a, headingRef }: { a: AdminAccessoryDTO; headingRef: React.Ref<HTMLElement> }) {
  const t = useTranslations('admin.accessories.photo');
  const getError = useErrorMessage('operator');
  const apply = useApplyAccessory(a.id);
  const inputId = useId();
  const [error, setError] = useState<string | null>(null);
  const upload = useMutation({
    mutationFn: (file: File) => uploadAccessoryPhoto(a.id, file),
    onMutate: () => setError(null),
    onSuccess: (dto) => apply(dto),
    onError: (e) => {
      const err = asApiError(e);
      const reason = String(err?.details?.reason ?? '');
      if (err?.code === 'PHOTO_INVALID' && (PHOTO_REASONS as string[]).includes(reason)) setError(t(`errors.${reason}`));
      else setError(getError(e));
    },
  });
  return (
    <section ref={headingRef as React.Ref<HTMLElement>} tabIndex={-1} className={cn(SECTION, 'outline-none')} aria-labelledby="acc-photo-title">
      <h2 id="acc-photo-title" className={H2}>
        {t('title')}
      </h2>
      {a.photo ? (
        <AccessoryPhoto src={a.photo.url} alt={a.name} fallbackText={a.name} className="w-[240px]" />
      ) : (
        <p className="text-sm text-muted">{t('none')}</p>
      )}
      <p className="text-sm text-muted">{t('help')}</p>
      <label
        htmlFor={inputId}
        className="inline-flex min-h-[44px] cursor-pointer items-center self-start border border-text px-5 text-[11px] font-medium uppercase tracking-label text-text hover:bg-text hover:text-primary-fg"
      >
        {upload.isPending ? t('uploading') : a.photo ? t('change') : t('choose')}
      </label>
      <input
        id={inputId}
        data-testid="accessory-photo-input"
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="sr-only"
        disabled={upload.isPending}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          // Antes de subir: > 10 MiB ⇒ el mismo texto de `too_large`, SIN petición (AC-UX-11).
          if (file.size > MAX_PHOTO_BYTES) {
            setError(t('errors.too_large'));
            return;
          }
          upload.mutate(file);
        }}
      />
      {error && (
        <p role="alert" className="text-sm text-accent">
          {error}
        </p>
      )}
    </section>
  );
}

// ---------- 3 · Precio y costo (★) ----------
function PriceBlock({ a, canEdit }: { a: AdminAccessoryDTO; canEdit: boolean }) {
  const t = useTranslations('admin.accessories.price');
  const locale = useLocale() as AppLocale;
  const getError = useErrorMessage('operator');
  const forbidden = useForbiddenText();
  const apply = useApplyAccessory(a.id);
  const [price, setPrice] = useState(centsToPesosInput(a.priceCents));
  const [cost, setCost] = useState(centsToPesosInput(a.unitCostCents ?? null));
  const [error, setError] = useState<string | null>(null);
  const priceCents = pesosInputToCents(price);
  const costCents = pesosInputToCents(cost);
  const bad = Number.isNaN(priceCents as number) || Number.isNaN(costCents as number);
  const save = useMutation({
    mutationFn: () => updateAdminAccessory(a.id, { priceCents, unitCostCents: costCents }),
    onMutate: () => setError(null),
    onSuccess: (dto) => apply(dto),
    onError: (e) => {
      const err = asApiError(e);
      setError(err?.code === 'FORBIDDEN_FIELD' ? forbidden(err.details?.fields) : getError(e));
    },
  });
  if (!canEdit) {
    // Operador: solo lectura y ⛔ sin costo en ninguna forma.
    return (
      <section className={SECTION}>
        <h2 className={H2}>{t('title')}</h2>
        <p className="text-sm text-text">
          {a.priceCents === null ? t('readOnlyNone') : t('readOnly', { price: formatMoneyCents(a.priceCents, locale) })}
        </p>
      </section>
    );
  }
  return (
    <section className={SECTION}>
      <h2 className={H2}>{t('title')}</h2>
      <Input
        label={t('price')}
        prefix="$"
        inputMode="decimal"
        value={price}
        hint={t('priceHelp')}
        error={Number.isNaN(priceCents as number) ? t('invalid') : undefined}
        onChange={(e) => setPrice(e.target.value)}
      />
      <Input
        label={t('cost')}
        prefix="$"
        inputMode="decimal"
        value={cost}
        hint={t('costHelp')}
        error={Number.isNaN(costCents as number) ? t('invalid') : undefined}
        onChange={(e) => setCost(e.target.value)}
      />
      <Button className="self-start" disabled={bad} loading={save.isPending} onClick={() => save.mutate()}>
        {t('save')}
      </Button>
      {save.isSuccess && (
        <Banner variant="success" role="status">
          {t('saved')}
        </Banner>
      )}
      {error && (
        <Banner variant="danger" role="alert">
          {error}
        </Banner>
      )}
    </section>
  );
}

// ---------- 4 · Existencias ----------
function StockBlock({ a }: { a: AdminAccessoryDTO }) {
  const t = useTranslations('admin.accessories.stock');
  const locale = useLocale() as AppLocale;
  const getError = useErrorMessage('operator');
  const invalidate = useInvalidate(a.id);
  const apply = useApplyAccessory(a.id);
  const [open, setOpen] = useState<'receive' | 'adjust' | null>(null);
  const [qty, setQty] = useState('');
  const [note, setNote] = useState('');
  const [real, setReal] = useState('');
  const [reason, setReason] = useState('');
  const [expected, setExpected] = useState(a.stockQty);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const history = useQuery({
    queryKey: ['accessory-stock-movements', a.id],
    queryFn: () => listAccessoryStockMovements(a.id, 1),
  });

  const receiveN = intOrNull(qty);
  const receiveOk = typeof receiveN === 'number' && !Number.isNaN(receiveN) && receiveN >= 1 && receiveN <= 10_000;
  const realN = intOrNull(real);
  const realOk = typeof realN === 'number' && !Number.isNaN(realN) && realN >= 0;

  const submit = useMutation({
    mutationFn: () =>
      open === 'receive'
        ? postAccessoryStock(a.id, { kind: 'receive', quantity: receiveN as number, ...(note.trim() ? { note: note.trim() } : {}) })
        : postAccessoryStock(a.id, { kind: 'adjust', newStockQty: realN as number, expectedStockQty: expected, reason: reason.trim() }),
    onMutate: () => setDialogError(null),
    onSuccess: (dto) => {
      // «Ahora hay N» = lo que respondió el servidor (⛔ no `stockQty + n`: pudo entrar otra cosa a la vez).
      setDone(open === 'receive' ? t('receiveDone', { n: receiveN as number, stock: dto.stockQty }) : t('adjustDone', { n: realN as number }));
      setOpen(null);
      apply(dto);
    },
    onError: (e) => {
      const err = asApiError(e);
      if (err?.code === 'STOCK_CONFLICT') {
        const n = Number(err.details?.stockQty);
        // El diálogo se queda abierto con el número nuevo como el «esperado» del siguiente intento.
        if (Number.isFinite(n)) setExpected(n);
        invalidate();
        return setDialogError(t('conflict', { n: Number.isFinite(n) ? n : '—' }));
      }
      if (err?.code === 'STOCK_BELOW_RESERVED') return setDialogError(t('belowReserved', { n: Number(err.details?.reservedQty ?? a.reservedQty) }));
      if (err?.status === 400 && open === 'adjust') return setDialogError(t('reasonShort'));
      setDialogError(getError(e));
    },
  });

  function openDialog(kind: 'receive' | 'adjust') {
    setDialogError(null);
    setDone(null);
    setQty('');
    setNote('');
    setReal(String(a.stockQty));
    setReason('');
    setExpected(a.stockQty);
    setOpen(kind);
  }
  const reasonShort = reason.trim().length > 0 && reason.trim().length < 3;
  const same = realOk && realN === expected;

  return (
    <section className={SECTION} aria-labelledby="acc-stock-title">
      <h2 id="acc-stock-title" className="tabular font-mono text-2xl text-text">
        {t('title', { n: a.stockQty })}
      </h2>
      <p className="text-sm text-text">{t('sub', { reserved: a.reservedQty, available: a.availableQty })}</p>
      <p className="text-sm text-muted">{t('systemNote')}</p>
      <div className="flex flex-wrap gap-3">
        <Button variant="secondary" onClick={() => openDialog('receive')}>
          {t('receive')}
        </Button>
        <Button variant="secondary" onClick={() => openDialog('adjust')}>
          {t('adjust')}
        </Button>
      </div>
      {done && (
        <Banner variant="success" role="status">
          {done}
        </Banner>
      )}

      <Modal
        open={open !== null}
        onClose={() => setOpen(null)}
        title={open === 'receive' ? t('receive') : t('adjust')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(null)}>
              {t('cancel')}
            </Button>
            {open === 'receive' ? (
              <Button disabled={!receiveOk} loading={submit.isPending} onClick={() => submit.mutate()}>
                {t('receiveConfirm', { n: receiveOk ? (receiveN as number) : 0 })}
              </Button>
            ) : (
              <Button
                disabled={!realOk || same || reason.trim().length < 3}
                loading={submit.isPending}
                aria-describedby={same ? 'acc-adjust-same' : undefined}
                onClick={() => submit.mutate()}
              >
                {t('adjustConfirm', { n: realOk ? (realN as number) : expected })}
              </Button>
            )}
          </>
        }
      >
        <div className="flex flex-col gap-4">
          {open === 'receive' ? (
            <>
              <Input label={t('receiveQty')} inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} />
              <Input label={t('receiveNote')} value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} />
            </>
          ) : (
            <>
              <Input label={t('adjustReal')} inputMode="numeric" value={real} onChange={(e) => setReal(e.target.value)} />
              {same && (
                <p id="acc-adjust-same" className="text-xs text-muted">
                  {t('adjustSame')}
                </p>
              )}
              <Input
                label={t('adjustReason')}
                value={reason}
                maxLength={200}
                hint={t('adjustReasonHint')}
                error={reasonShort ? t('reasonShort') : undefined}
                onChange={(e) => setReason(e.target.value)}
              />
            </>
          )}
          {dialogError && (
            <p role="alert" className="text-sm text-accent">
              {dialogError}
            </p>
          )}
        </div>
      </Modal>

      <div data-testid="accessory-stock-history" className="overflow-x-auto">
        <h3 className="eyebrow">{t('history.title')}</h3>
        {(history.data?.items.length ?? 0) === 0 ? (
          <p className="mt-2 text-sm text-muted">{history.isLoading ? '…' : t('history.empty')}</p>
        ) : (
          <table className="mt-2 w-full border-collapse text-sm">
            <thead>
              <tr className="border-y border-border text-left">
                {(['date', 'movement', 'change', 'beforeAfter', 'who', 'reasonOrder'] as const).map((c) => (
                  <th key={c} scope="col" className="eyebrow py-2 pr-4 font-medium">
                    {t(`history.${c}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {history.data!.items.map((m, i) => (
                <tr key={`${m.createdAt}-${i}`} className="border-b border-border">
                  <td className="py-2 pr-4">{formatDateTimeMx(m.createdAt, locale)}</td>
                  <td className="py-2 pr-4">{t(`kind.${m.kind}`)}</td>
                  <td className="tabular py-2 pr-4 font-mono">{m.delta > 0 ? `+${m.delta}` : `−${Math.abs(m.delta)}`}</td>
                  <td className="tabular py-2 pr-4 font-mono">
                    {m.stockBefore} → {m.stockAfter}
                  </td>
                  <td className="py-2 pr-4">{m.actor ? m.actor.name ?? '—' : t('history.system')}</td>
                  <td className="py-2 pr-4">{m.reason ?? (m.orderNumber ? t('history.order', { orderNumber: m.orderNumber }) : '—')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

// ---------- 5 · Publicación (★) ----------
function PublishBlock({ a }: { a: AdminAccessoryDTO }) {
  const t = useTranslations('admin.accessories.publish');
  const ta = useTranslations('accessories');
  const getError = useErrorMessage('operator');
  const apply = useApplyAccessory(a.id);
  const reasonId = useId();
  const suggestedId = useId();
  const [serverMissing, setServerMissing] = useState<string[] | null>(null);
  const [taken, setTaken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const missing = activationMissing(a);
  const shown = serverMissing ?? missing;
  const listText = shown.map((m) => (t.has(`missingItem.${m}`) ? t(`missingItem.${m}`) : m)).join(', ');
  const isEnergy = a.category === 'energy';

  const toggle = useMutation({
    mutationFn: () => (a.active ? deactivateAdminAccessory(a.id) : activateAdminAccessory(a.id)),
    onMutate: () => {
      setServerMissing(null);
      setTaken(null);
      setError(null);
    },
    onSuccess: (dto) => apply(dto),
    onError: (e) => {
      const err = asApiError(e);
      if (err?.code === 'ACCESSORY_NOT_ACTIVATABLE' && Array.isArray(err.details?.missing)) {
        return setServerMissing(err.details!.missing as string[]);
      }
      if (err?.code === 'ENERGY_TYPE_TAKEN') return setTaken(String(err.details?.accessoryId ?? ''));
      setError(getError(e));
    },
  });
  const suggest = useMutation({
    mutationFn: (next: boolean) => updateAdminAccessory(a.id, { suggested: next }),
    onSuccess: (dto) => apply(dto),
    onError: (e) => setError(getError(e)),
  });

  return (
    <section className={SECTION}>
      <h2 className={H2}>{t('title')}</h2>
      {!a.active &&
        (shown.length > 0 ? (
          <p id={reasonId} className="text-sm text-accent">
            {t('missing', { list: listText })}
          </p>
        ) : (
          <p className="text-sm text-text">{t('ready')}</p>
        ))}
      {serverMissing && <p className="text-sm text-text">{t('notPublished')}</p>}
      {a.active ? (
        <div className="flex flex-col gap-2">
          <Button variant="secondary" className="self-start" loading={toggle.isPending} onClick={() => toggle.mutate()}>
            {t('deactivate')}
          </Button>
          <p className="text-xs text-muted">{t('deactivateNote')}</p>
        </div>
      ) : (
        <Button
          variant="primary"
          className="self-start"
          disabled={missing.length > 0}
          aria-describedby={missing.length > 0 ? reasonId : undefined}
          loading={toggle.isPending}
          onClick={() => toggle.mutate()}
        >
          {t('activate')}
        </Button>
      )}
      {taken !== null && (
        <p role="alert" className="text-sm text-text">
          {t('energyTaken', { type: a.energyType ? ta(`energyType.${a.energyType}`) : '—' })}{' '}
          {taken && (
            <Link href={`/admin/accessories/${taken}`} className="text-accent underline underline-offset-4 hover:text-text">
              {t('seeOther')}
            </Link>
          )}
        </p>
      )}
      <div className="flex flex-col gap-1">
        <label className="flex min-h-[44px] items-center gap-3 text-sm text-text">
          <button
            type="button"
            role="switch"
            aria-checked={a.suggested}
            aria-label={t('suggested')}
            aria-describedby={suggestedId}
            disabled={isEnergy || suggest.isPending}
            onClick={() => suggest.mutate(!a.suggested)}
            className={cn(
              'relative h-6 w-11 border border-text transition-colors disabled:cursor-not-allowed disabled:border-border-strong',
              a.suggested ? 'bg-text' : 'bg-transparent',
            )}
          >
            <span className={cn('absolute top-0.5 h-4 w-4 transition-all', a.suggested ? 'left-6 bg-primary-fg' : 'left-0.5 bg-text')} />
          </button>
          {t('suggested')}
        </label>
        <p id={suggestedId} className="text-xs text-muted">
          {isEnergy ? t('suggestedEnergy') : t('suggestedHelp')}
        </p>
      </div>
      {error && (
        <Banner variant="danger" role="alert">
          {error}
        </Banner>
      )}
    </section>
  );
}

// ---------- 6 · Borrar (★) ----------
function DeleteBlock({ a }: { a: AdminAccessoryDTO }) {
  const t = useTranslations('admin.accessories.delete');
  const router = useRouter();
  const getError = useErrorMessage('operator');
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [hasSales, setHasSales] = useState(a.hasSales);
  const [error, setError] = useState<string | null>(null);
  const del = useMutation({
    mutationFn: () => deleteAdminAccessory(a.id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin-accessories'] });
      router.push('/admin/accessories');
    },
    onError: (e) => {
      setOpen(false);
      if (asApiError(e)?.code === 'ACCESSORY_HAS_SALES') return setHasSales(true);
      setError(getError(e));
    },
  });
  return (
    <section className={SECTION}>
      {hasSales ? (
        <p className="text-sm text-muted">{t('hasSales')}</p>
      ) : (
        <Button variant="destructive" className="self-start" onClick={() => setOpen(true)}>
          {t('button')}
        </Button>
      )}
      {error && (
        <Banner variant="danger" role="alert">
          {error}
        </Banner>
      )}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={t('title', { name: a.name })}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              {t('cancel')}
            </Button>
            <Button variant="destructive" loading={del.isPending} onClick={() => del.mutate()}>
              {t('confirm')}
            </Button>
          </>
        }
      >
        <p>{t('body')}</p>
      </Modal>
    </section>
  );
}
