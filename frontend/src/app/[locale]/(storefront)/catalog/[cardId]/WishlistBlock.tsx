'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { Check } from 'lucide-react';
import {
  addWishlistItem,
  getWishlist,
  getWishlistPreview,
  removeWishlistItem,
  updateWishlistItem,
} from '@/lib/api';
import { asApiError } from '@/lib/api-client';
import { useSession } from '@/lib/session';
import { isStaffRole } from '@/lib/account-routes';
import { FINISH_ORDER } from '@/lib/finish';
import { formatMoneyCents } from '@/lib/format';
import { Link } from '@/i18n/navigation';
import type { AppLocale } from '@/i18n/routing';
import type { Finish, WishlistItemDTO, WishlistMaxPct, WishlistResponse } from '@/types/contract';
import { Button } from '@/components/ui/Button';
import { IvaLabel } from '@/components/ui/IvaLabel';
import { Skeleton } from '@/components/ui/Skeleton';
import { ChoiceChips, PctChoice } from './PctChoice';

export const WISHLIST_QUERY_KEY = ['wishlist'] as const;

/** Lo que el bloque sabe de un deseo de ESTA carta y acabado. `maxToday` falta tras un `409` (solo trae id y %). */
interface Entry {
  id: string;
  maxPct: WishlistMaxPct;
  maxToday?: WishlistItemDTO['maxToday'];
}

type Notice = { kind: 'status' | 'alert'; text: string } | null;

const isFeatureOff = (e: unknown) => {
  const err = asApiError(e);
  return err?.status === 404 && err.code === 'FEATURE_DISABLED';
};
const isUnauthenticated = (e: unknown) => asApiError(e)?.status === 401;

/**
 * Bloque «Lista de deseos» de la ficha (DESIGN_SYSTEM §WSH-UX.2 · API_CONTRACT §WSH.4 + errata v1.87.1).
 *
 * Se monta solo con `detail.wishlistEnabled === true` (lo decide `CardDetailView`). Aquí:
 * - **staff** ⇒ nada (Q-WSH-UX-6: el servidor no cambia por rol; la pantalla no ofrece la lista al equipo);
 * - **invitado** ⇒ la invitación (d), sin chips: elegir y perderlo al entrar es peor que elegir después;
 * - **cliente** ⇒ (a) agregar, (b) ya en tu lista, (c) lista llena.
 *
 * ⛔ **WSH-2 · una cifra, una fuente.** Los pesos bajo cada % son los `tiers` de `GET /wishlist/preview` y el máximo
 * guardado es `maxToday.maxDisplayCents`; el contrato garantiza que son la misma cifra (WSH-T31). Este fichero no
 * multiplica, no divide y no compara pesos — lo vigila `src/test/wishlist-wsh-locks.test.ts` (WSH-F7).
 */
export function WishlistBlock({
  cardId,
  availableFinishes,
  preferredFinish,
}: {
  cardId: string;
  availableFinishes: Finish[];
  preferredFinish?: Finish;
}) {
  const { user, ready } = useSession();
  if (!ready) return null;
  if (user && isStaffRole(user.role)) return null;
  if (!user) return <GuestInvite cardId={cardId} />;
  return (
    <CustomerBlock
      cardId={cardId}
      availableFinishes={availableFinishes}
      preferredFinish={preferredFinish}
      email={user.email ?? ''}
    />
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  const t = useTranslations('wishlist');
  return (
    <section data-testid="wishlist-block" aria-labelledby="wishlist-block-title" className="mt-10 border-t border-border pt-8">
      <p id="wishlist-block-title" className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
        {t('eyebrow')}
      </p>
      {children}
    </section>
  );
}

function GuestInvite({ cardId }: { cardId: string }) {
  const t = useTranslations('wishlist');
  const next = `/catalog/${cardId}`;
  return (
    <Shell>
      <h2 className="mt-3 font-serif text-[22px] leading-tight text-text">{t('guest.title')}</h2>
      <p className="mt-2 text-sm text-muted">{t('guest.body')}</p>
      <div className="mt-5 flex flex-wrap items-center gap-5">
        <Link
          href={{ pathname: '/login', query: { next } }}
          className="inline-flex min-h-[44px] items-center border border-text px-5 font-mono text-[11px] uppercase tracking-label text-text hover:bg-text hover:text-primary-fg focus-visible:shadow-focus"
        >
          {t('guest.login')}
        </Link>
        <Link
          href={{ pathname: '/register', query: { next } }}
          className="inline-flex min-h-[44px] items-center border-b border-accent font-mono text-[11px] uppercase tracking-label text-accent hover:border-text hover:text-text"
        >
          {t('guest.register')}
        </Link>
      </div>
    </Shell>
  );
}

function orderedFinishes(available: Finish[]): Finish[] {
  const known = FINISH_ORDER.filter((f) => available.includes(f));
  return [...known, ...available.filter((f) => !known.includes(f))];
}

function CustomerBlock({
  cardId,
  availableFinishes,
  preferredFinish,
  email,
}: {
  cardId: string;
  availableFinishes: Finish[];
  preferredFinish?: Finish;
  email: string;
}) {
  const t = useTranslations('wishlist');
  const tFinish = useTranslations('finish');
  const locale = useLocale() as AppLocale;
  const qc = useQueryClient();

  const finishes = useMemo(() => orderedFinishes(availableFinishes), [availableFinishes]);
  const [finish, setFinish] = useState<Finish>(
    preferredFinish && finishes.includes(preferredFinish) ? preferredFinish : finishes[0],
  );
  const [pct, setPct] = useState<WishlistMaxPct>(10);
  const [changePct, setChangePct] = useState<WishlistMaxPct | null>(null);
  const [overrides, setOverrides] = useState<Partial<Record<Finish, Entry | null>>>({});
  const [fullFromServer, setFullFromServer] = useState<{ count: number; limit: number } | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [savedPatch, setSavedPatch] = useState(false);
  const [guest, setGuest] = useState(false);

  const list = useQuery({ queryKey: WISHLIST_QUERY_KEY, queryFn: getWishlist, retry: false });
  const preview = useQuery({
    queryKey: ['wishlist-preview', cardId],
    queryFn: () => getWishlistPreview(cardId),
    retry: false,
  });

  const fromServer = list.data?.items.find((i) => i.card.id === cardId && i.finish === finish);
  const entry: Entry | null =
    finish in overrides
      ? (overrides[finish] ?? null)
      : fromServer
        ? { id: fromServer.id, maxPct: fromServer.maxPct, maxToday: fromServer.maxToday }
        : null;

  const previewFinish = preview.data?.finishes.find((f) => f.finish === finish);
  const tiers = previewFinish?.maxToday.status === 'priced' ? previewFinish.maxToday.tiers : null;
  const pesos = tiers
    ? Object.fromEntries(tiers.map((x) => [x.maxPct, t('block.pctPesos', { amount: formatMoneyCents(x.maxDisplayCents, locale) })]))
    : undefined;
  const ivaRatePct = preview.data?.ivaRatePct ?? list.data?.ivaRatePct;

  function patchCache(fn: (d: WishlistResponse) => WishlistResponse) {
    qc.setQueryData<WishlistResponse>(WISHLIST_QUERY_KEY, (d) => (d ? fn(d) : d));
  }
  function handleCommonError(e: unknown): boolean {
    if (isUnauthenticated(e)) {
      setGuest(true);
      return true;
    }
    return false;
  }

  const add = useMutation({
    mutationFn: () => addWishlistItem({ cardId, finish, maxPct: pct }),
    onMutate: () => setNotice(null),
    onSuccess: (dto) => {
      setOverrides((o) => ({ ...o, [dto.finish]: { id: dto.id, maxPct: dto.maxPct, maxToday: dto.maxToday } }));
      patchCache((d) => ({ ...d, items: [dto, ...d.items], count: d.count + 1 }));
    },
    onError: (e) => {
      if (handleCommonError(e)) return;
      const err = asApiError(e);
      const d = err?.details as Record<string, unknown> | undefined;
      if (err?.status === 409 && err.code === 'WISHLIST_DUPLICATE' && d) {
        const maxPct = Number(d.maxPct) as WishlistMaxPct;
        setOverrides((o) => ({ ...o, [finish]: { id: String(d.wishlistItemId), maxPct } }));
        setNotice({ kind: 'status', text: t('block.duplicate') });
        return;
      }
      if (err?.status === 422 && err.code === 'WISHLIST_LIMIT_REACHED' && d) {
        setFullFromServer({ count: Number(d.count), limit: Number(d.limit) });
        return;
      }
      if (err?.status === 422 && err.code === 'FINISH_NOT_AVAILABLE') {
        setNotice({ kind: 'alert', text: t('error.finish') });
        void qc.invalidateQueries({ queryKey: ['card', cardId] });
        return;
      }
      if (isFeatureOff(e)) return;
      setNotice({ kind: 'alert', text: t('error.generic') });
    },
  });

  const patch = useMutation({
    mutationFn: (v: { id: string; maxPct: WishlistMaxPct }) => updateWishlistItem(v.id, v.maxPct),
    onMutate: () => {
      setNotice(null);
      setSavedPatch(false);
    },
    onSuccess: (dto) => {
      setOverrides((o) => ({ ...o, [dto.finish]: { id: dto.id, maxPct: dto.maxPct, maxToday: dto.maxToday } }));
      patchCache((d) => ({ ...d, items: d.items.map((i) => (i.id === dto.id ? dto : i)) }));
      setChangePct(null);
      setSavedPatch(true);
    },
    onError: (e) => {
      if (handleCommonError(e)) return;
      if (asApiError(e)?.status === 404 && !isFeatureOff(e)) {
        setOverrides((o) => ({ ...o, [finish]: null }));
        setNotice({ kind: 'status', text: t('row.gone') });
        return;
      }
      setNotice({ kind: 'alert', text: t('error.generic') });
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => removeWishlistItem(id),
    onMutate: () => {
      setNotice(null);
      setSavedPatch(false);
    },
    onSuccess: (_, id) => {
      setOverrides((o) => ({ ...o, [finish]: null }));
      patchCache((d) => ({ ...d, items: d.items.filter((i) => i.id !== id), count: Math.max(0, d.count - 1) }));
      setChangePct(null);
      setNotice({ kind: 'status', text: t('block.removed') });
    },
    onError: (e) => {
      if (handleCommonError(e)) return;
      if (asApiError(e)?.status === 404 && !isFeatureOff(e)) {
        setOverrides((o) => ({ ...o, [finish]: null }));
        setNotice({ kind: 'status', text: t('block.removed') });
        return;
      }
      setNotice({ kind: 'alert', text: t('error.generic') });
    },
  });

  // WSH-5: el dial se apagó entre la ficha y la lista ⇒ el bloque no existe.
  if (
    isFeatureOff(list.error) ||
    isFeatureOff(preview.error) ||
    isFeatureOff(add.error) ||
    isFeatureOff(patch.error) ||
    isFeatureOff(remove.error)
  ) {
    return null;
  }
  if (guest || isUnauthenticated(list.error)) {
    return <GuestInvite cardId={cardId} />;
  }

  const finishLabel = tFinish(finish);
  const count = list.data?.count ?? 0;
  const limit = list.data?.limit ?? 0;
  const full = fullFromServer ?? (list.data && !entry && count >= limit ? { count, limit } : null);

  const finishPicker =
    finishes.length > 1 ? (
      <ChoiceChips
        legend={t('block.finishLegend')}
        name={`wishlist-finish-${cardId}`}
        options={finishes.map((f) => ({ value: f, label: tFinish(f) }))}
        value={finish}
        onChange={(f) => {
          setFinish(f);
          setNotice(null);
          setSavedPatch(false);
          setChangePct(null);
          setFullFromServer(null);
        }}
      />
    ) : (
      <p className="text-sm text-text">{t('block.finishSingle', { finish: finishLabel })}</p>
    );

  const noticeNode = notice && (
    <p
      role={notice.kind}
      className={notice.kind === 'alert' ? 'mt-4 text-sm text-accent' : 'mt-4 text-sm text-text'}
    >
      {notice.text}
    </p>
  );

  const ivaApprox = tiers && (
    <p className="mt-2 flex flex-wrap items-baseline gap-2">
      <IvaLabel ivaIncluded ivaRatePct={ivaRatePct} />
      <span className="font-mono text-[11px] text-muted">· {t('approx')}</span>
    </p>
  );

  return (
    <Shell>
      <h2 className="mt-3 font-serif text-[22px] leading-tight text-text">{t('block.title')}</h2>
      <p className="mt-2 text-sm text-muted">{t('block.nmNote')}</p>

      {list.isLoading ? (
        <div className="mt-6 flex flex-col gap-3" aria-busy="true">
          <Skeleton className="h-11 w-full max-w-sm" />
          <Skeleton className="h-11 w-full max-w-sm" />
        </div>
      ) : list.isError ? (
        <p role="alert" className="mt-6 text-sm text-accent">
          {t('error.generic')}
        </p>
      ) : (
        <div className="mt-6 flex flex-col gap-6">
          {finishPicker}

          {entry ? (
            <InList
              entry={entry}
              finishLabel={finishLabel}
              email={email}
              emailVerified={list.data?.emailVerified ?? true}
              alertsPaused={list.data?.alertsPaused ?? false}
              ivaRatePct={ivaRatePct}
              previewCents={tiers?.find((x) => x.maxPct === entry.maxPct)?.maxDisplayCents}
              previewNoMarket={previewFinish?.maxToday.status === 'no_market'}
              pesos={pesos}
              changePct={changePct ?? entry.maxPct}
              onChangePct={(v) => {
                setChangePct(v);
                setSavedPatch(false);
              }}
              saving={patch.isPending}
              saved={savedPatch}
              onSave={() => patch.mutate({ id: entry.id, maxPct: changePct ?? entry.maxPct })}
              removing={remove.isPending}
              onRemove={() => remove.mutate(entry.id)}
              cardName={cardId}
            />
          ) : full ? (
            <div className="flex flex-col gap-2">
              <p className="text-sm text-text">{t('full.title', { count: full.count, limit: full.limit })}</p>
              <p className="text-sm text-muted">{t('full.body')}</p>
              <div className="mt-2">
                <Link
                  href="/account/wishlist"
                  className="inline-flex min-h-[44px] items-center border border-text px-4 font-mono text-[10px] uppercase tracking-label text-text hover:bg-text hover:text-primary-fg focus-visible:shadow-focus"
                >
                  {t('seeList')}
                </Link>
              </div>
            </div>
          ) : (
            <>
              <div>
                <PctChoice
                  legend={t('block.pctLegend')}
                  name={`wishlist-pct-${cardId}`}
                  value={pct}
                  onChange={setPct}
                  optionLabel={(p) => t('block.pctOption', { pct: p })}
                  pesos={pesos}
                />
                {ivaApprox}
                {previewFinish?.maxToday.status === 'no_market' && (
                  <p className="mt-2 text-[13px] text-muted">{t('block.noMarketLong')}</p>
                )}
              </div>
              <p className="rule-note text-[13px] leading-[1.65] text-muted">{t('block.signalNote')}</p>
              <div className="flex flex-wrap items-center gap-4">
                <Button loading={add.isPending} onClick={() => add.mutate()}>
                  {t('block.add', { finish: finishLabel })}
                </Button>
                <span className="font-mono text-[11px] text-muted">{t('block.count', { count, limit })}</span>
              </div>
            </>
          )}
          {noticeNode}
        </div>
      )}
    </Shell>
  );
}

function InList({
  entry,
  finishLabel,
  email,
  emailVerified,
  alertsPaused,
  ivaRatePct,
  previewCents,
  previewNoMarket,
  pesos,
  changePct,
  onChangePct,
  saving,
  saved,
  onSave,
  removing,
  onRemove,
  cardName,
}: {
  entry: Entry;
  finishLabel: string;
  email: string;
  emailVerified: boolean;
  alertsPaused: boolean;
  ivaRatePct?: number;
  previewCents?: number;
  previewNoMarket: boolean;
  pesos?: Partial<Record<WishlistMaxPct, string>>;
  changePct: WishlistMaxPct;
  onChangePct: (v: WishlistMaxPct) => void;
  saving: boolean;
  saved: boolean;
  onSave: () => void;
  removing: boolean;
  onRemove: () => void;
  cardName: string;
}) {
  const t = useTranslations('wishlist');
  const locale = useLocale() as AppLocale;
  // La cifra de hoy: la del deseo guardado; tras un `409` (que no la trae) la del preview para ese mismo %, que por
  // contrato es idéntica (WSH-T31). Sin ninguna de las dos no se pinta cifra.
  const maxCents =
    entry.maxToday?.status === 'priced' ? entry.maxToday.maxDisplayCents : entry.maxToday ? undefined : previewCents;
  const noMarket = entry.maxToday ? entry.maxToday.status === 'no_market' : previewNoMarket;

  return (
    <div className="flex flex-col gap-4">
      <p role="status" className="flex items-center gap-2 text-sm text-success">
        <Check size={16} aria-hidden />
        {t('block.inList', { finish: finishLabel, pct: entry.maxPct })}
      </p>
      <div>
        {noMarket ? (
          <p className="text-[15px] text-text">{t('block.noMarketLong')}</p>
        ) : maxCents != null ? (
          <>
            <p className="flex flex-wrap items-baseline gap-2">
              <span className="tabular text-[17px] font-medium text-text">
                {t('maxToday', { amount: formatMoneyCents(maxCents, locale) })}
              </span>
              <IvaLabel ivaIncluded ivaRatePct={ivaRatePct} />
              <span className="font-mono text-[11px] text-muted">· {t('approx')}</span>
            </p>
            <p className="mt-1 text-xs text-muted">{t('recalcNote')}</p>
          </>
        ) : null}
        {email && <p className="mt-2 text-sm text-muted">{t('notifyTo', { email })}</p>}
        {!emailVerified && (
          <p className="rule-note mt-3 border-accent text-[13px] text-text">
            {t('unverified')}{' '}
            <Link href="/account#email" className="border-b border-accent text-accent hover:border-text hover:text-text">
              {t('unverifiedCta')}
            </Link>
          </p>
        )}
        {alertsPaused && (
          <p className="rule-note mt-3 border-accent text-[13px] text-text">
            {t('pausedNote')}{' '}
            <Link href="/account/wishlist" className="border-b border-accent text-accent hover:border-text hover:text-text">
              {t('pausedCta')}
            </Link>
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <PctChoice
          legend={t('block.changeLegend')}
          name={`wishlist-change-${cardName}`}
          value={changePct}
          onChange={onChangePct}
          optionLabel={(p) => t('block.pctOption', { pct: p })}
          pesos={pesos}
        />
        <Button variant="secondary" size="sm" disabled={changePct === entry.maxPct} loading={saving} onClick={onSave}>
          {t('block.saveChange')}
        </Button>
      </div>
      {saved && (
        <p role="status" className="font-mono text-[11px] uppercase tracking-label text-success">
          {t('saved')}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-5">
        <Button variant="link" size="sm" loading={removing} onClick={onRemove}>
          {t('remove')}
        </Button>
        <Link href="/account/wishlist" className="border-b border-text pb-0.5 text-sm text-text hover:border-accent hover:text-accent">
          {t('seeList')} →
        </Link>
      </div>
    </div>
  );
}
