'use client';

import { useCallback, useId, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Check } from 'lucide-react';
import type { AppLocale } from '@/i18n/routing';
import type { DeckEnergyBundleDTO, MetaCardGroup, MetaDeckGroupsDTO, MetaDeckLineDTO } from '@/types/contract';
import { formatMoneyCents } from '@/lib/format';
import { useCart } from '@/lib/cart';
import { useSession } from '@/lib/session';
import { energyBreakdown, totalQuantity } from '@/lib/accessories';
import { useRouter } from '@/i18n/navigation';
import { AccessoryPhoto } from '@/components/domain/accessories/AccessoryPhoto';
import { SignedInAccessoryNotice } from '@/components/domain/accessories/SignedInNotice';
import { cn } from '@/lib/cn';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { CardImage } from '@/components/ui/CardImage';
import { CardCode } from '@/components/domain/CardCode';
import { StockBadge, stockVariantForSingle } from '../_shared/StockBadge';
import { PendingPriceLabel } from '../_shared/PendingPriceLabel';
import { CartAddedToast } from '../catalog/CartAddedToast';

const GROUP_ORDER: MetaCardGroup[] = ['pokemon', 'trainer', 'energy'];

/** Todas las líneas del deck, en orden de sección. */
function flatLines(groups: MetaDeckGroupsDTO): MetaDeckLineDTO[] {
  return GROUP_ORDER.flatMap((g) => groups[g] ?? []);
}

/**
 * Unión de piezas del «de jalón»: los `unitInventoryItemIds` de las líneas DISPONIBLES. El contrato
 * solo pone piezas propias en líneas casadas con stock, así que esta unión ya es «lo que tenemos» —
 * no se agregan sustitutos (Fase 3, opt-in) ni no identificadas. Se deduplica por si una carta
 * aparece en dos secciones.
 */
export function pullableItemIds(groups: MetaDeckGroupsDTO): string[] {
  const seen = new Set<string>();
  for (const line of flatLines(groups)) {
    for (const id of line.unitInventoryItemIds) seen.add(id);
  }
  return [...seen];
}

/**
 * Vista de disponibilidad compartida por el detalle de un deck del top-10 y por «pegar lista»
 * (§13: `paste` devuelve la MISMA forma que `groups`). Deja CLARO qué tenemos disponible, qué está
 * agotado y qué no se identificó, y ofrece «agregar de jalón» lo disponible.
 */
export function DeckAvailability({
  groups,
  deck,
  energyBundle,
}: {
  groups: MetaDeckGroupsDTO;
  /** §AC.8: el deck del top-10 (ausente en «Pegar lista»). Lo nombra en el carrito y firma el `deckPull`. */
  deck?: { slug: string; name: string };
  /** §AC.8: recuadro del paquete. ⛔ `paste` no lo emite (P-EN-7) ⇒ sin recuadro. */
  energyBundle?: DeckEnergyBundleDTO;
}) {
  const t = useTranslations('decksMeta');
  const cart = useCart();
  const { isAuthenticated } = useSession();
  const [addedSignal, setAddedSignal] = useState(0);
  const dismissToast = useCallback(() => setAddedSignal(0), []);

  const pullable = useMemo(() => pullableItemIds(groups), [groups]);
  // Lo que aún NO está en el carrito (idempotente: re-agregar no cuenta).
  const remaining = pullable.filter((id) => !cart.ids.includes(id));
  const deckPull = deck ? cart.deckPulls.find((p) => p.slug === deck.slug) : undefined;
  const bundleInCart = deckPull?.withEnergyBundle === true;

  const onAdd = useCallback(
    (id: string) => {
      cart.add(id);
      setAddedSignal(Date.now());
    },
    [cart],
  );

  const onAddAll = useCallback(() => {
    if (remaining.length === 0) return;
    for (const id of remaining) cart.add(id);
    // §AC-UX.8: el jalón guarda el `deckPull` SIN paquete (para que el carrito pueda OFRECERLO). ⛔ Nunca
    // `withEnergyBundle: true` desde aquí (AC-UX-7, criterio 735); si ya estaba en el carrito, se conserva.
    if (deck && energyBundle) {
      cart.upsertDeckPull({
        token: energyBundle.pullToken,
        slug: deck.slug,
        withEnergyBundle: deckPull?.withEnergyBundle ?? false,
        deckName: deck.name,
      });
    }
    setAddedSignal(Date.now());
  }, [cart, remaining, deck, energyBundle, deckPull]);

  const onAddEnergy = useCallback(
    (accessoryId: string, qty: number) => {
      cart.addAccessory(accessoryId, qty);
      setAddedSignal(Date.now());
    },
    [cart],
  );

  return (
    <div>
      {/* «Agregar de jalón»: mete al carrito lo disponible. El re-quote existente revalida. */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-y border-border py-5">
        <p className="font-mono text-[11px] uppercase tracking-[0.06em] text-muted">
          {pullable.length > 0 ? t('addAll.hint', { count: pullable.length }) : t('addAll.none')}
        </p>
        <Button variant="primary" size="sm" disabled={remaining.length === 0} onClick={onAddAll}>
          {t('addAll.button')}
        </Button>
      </div>

      {deck && energyBundle && (
        <EnergyBundleBox
          bundle={energyBundle}
          deckReady={pullable.length > 0 && remaining.length === 0}
          inCart={bundleInCart}
          signedIn={isAuthenticated}
          onAdd={() => {
            cart.upsertDeckPull({ token: energyBundle.pullToken, slug: deck.slug, withEnergyBundle: true, deckName: deck.name });
            setAddedSignal(Date.now());
          }}
          onRemove={() => cart.setBundle(deck.slug, false)}
        />
      )}

      {GROUP_ORDER.map((groupKey) => {
        const lines = groups[groupKey] ?? [];
        if (lines.length === 0) return null;
        return (
          <section key={groupKey} className="mt-8">
            <h2 className="font-serif text-[22px] leading-tight text-text">
              {t(`detail.groups.${groupKey}`)}
            </h2>
            {/* §AC-UX.4: con sesión, el aviso UNA vez por bloque (no por línea). */}
            {isAuthenticated && lines.some((l) => l.basicEnergy) && <SignedInAccessoryNotice className="mt-3" />}
            <div className="mt-3 border-t border-border">
              {lines.map((line, i) =>
                line.basicEnergy ? (
                  <EnergyLineRow
                    key={`${groupKey}-${i}`}
                    line={line}
                    energy={line.basicEnergy}
                    inCartQty={cart.accessories.find((a) => a.id === line.basicEnergy!.accessoryId)?.qty ?? 0}
                    inBundle={bundleInCart}
                    signedIn={isAuthenticated}
                    onAdd={onAddEnergy}
                  />
                ) : (
                  <DeckLineRow key={`${groupKey}-${i}`} line={line} cartIds={cart.ids} onAdd={onAdd} />
                ),
              )}
            </div>
          </section>
        );
      })}

      <CartAddedToast signal={addedSignal} onDismiss={dismissToast} />
    </div>
  );
}

/** El estado de disponibilidad de una línea, resuelto una vez y usado para badge + comportamiento. */
type LineState = 'available' | 'soldout' | 'unidentified' | 'basic_energy';

function lineState(line: MetaDeckLineDTO): LineState {
  if (line.matchStatus === 'unmatched_basic_energy') return 'basic_energy';
  if (line.matchStatus !== 'matched') return 'unidentified';
  return line.availableQty > 0 ? 'available' : 'soldout';
}

function DeckLineRow({
  line,
  cartIds,
  onAdd,
}: {
  line: MetaDeckLineDTO;
  cartIds: string[];
  onAdd: (id: string) => void;
}) {
  const t = useTranslations('decksMeta');
  const locale = useLocale() as AppLocale;
  const state = lineState(line);
  const displayName = line.card?.name ?? line.rawName;

  return (
    <div className="flex flex-wrap items-center gap-4 border-b border-border py-4">
      {/* Miniatura solo si la carta casó (nunca se inventa arte). */}
      <div className="h-16 w-12 shrink-0">
        {line.card ? (
          <CardImage src={line.card.imageUrl} alt={displayName} className="h-full w-full bg-transparent p-0" />
        ) : (
          <div className="h-full w-full border border-dashed border-border" aria-hidden />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="font-mono text-[11px] tabular text-muted">{t('detail.quantity', { qty: line.quantity })}</span>
          <span className="truncate text-[15px] text-text" lang="en">
            {displayName}
          </span>
          {/* §37.3b (P-71): «TWM 130» con el MISMO formateador que el resto de la tienda (`CardCode`,
              código + espacio no separable + número; tal como llega, sin `uppercase`). Sin código
              (energía básica, línea sin set) no se pinta nada — aquí no hay «#número» que mostrar. */}
          {line.setCode && (
            <CardCode
              code={line.setCode}
              number={line.number}
              className="font-mono text-[10px] tracking-[0.08em] text-muted"
            />
          )}
        </div>

        {/* DISPONIBILIDAD: qué tenemos, qué está agotado y qué no se identificó. */}
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
          <AvailabilityBadge state={state} />
          {state === 'available' && (
            <>
              {line.unitPriceMxnCents != null ? (
                <span className="tabular text-[15px] font-medium leading-none text-text">
                  {formatMoneyCents(line.unitPriceMxnCents, locale)}
                </span>
              ) : (
                <PendingPriceLabel hint className="text-[11px] leading-normal tracking-[0.06em]" />
              )}
              <StockBadge
                variant={stockVariantForSingle(line.availableQty)}
                count={line.availableQty}
              />
              <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted">
                {t('line.availableOf', { available: line.availableQty, qty: line.quantity })}
              </span>
            </>
          )}
        </div>

        {/* Nota explicativa cuando la línea no se identificó. */}
        {state === 'unidentified' && (
          <p className="mt-1.5 text-[13px] leading-snug text-muted">{t('line.unidentifiedNote')}</p>
        )}

        {/* Sustituto (Fase 3): otra impresión de la misma carta en stock. */}
        {line.substitute && (
          <Substitute sub={line.substitute} cartIds={cartIds} onAdd={onAdd} />
        )}
      </div>

      {/* CTA de compra SOLO para líneas con stock (agotada / no identificada ⇒ sin CTA). */}
      {state === 'available' && (
        <LineCta line={line} cartIds={cartIds} onAdd={onAdd} />
      )}
    </div>
  );
}

function AvailabilityBadge({ state }: { state: LineState }) {
  const t = useTranslations('decksMeta');
  if (state === 'available') return <Badge tone="success">{t('line.available')}</Badge>;
  if (state === 'soldout') return <Badge tone="neutral">{t('line.soldOut')}</Badge>;
  if (state === 'basic_energy') return <Badge tone="success">{t('line.basicEnergy')}</Badge>;
  return <Badge tone="neutral">{t('line.unidentified')}</Badge>;
}

/** CTA por línea: agrega la pieza más barata aún no en el carrito; al completar → «En el carrito». */
function LineCta({
  line,
  cartIds,
  onAdd,
}: {
  line: MetaDeckLineDTO;
  cartIds: string[];
  onAdd: (id: string) => void;
}) {
  const t = useTranslations('decksMeta');
  const router = useRouter();
  const nextId = line.unitInventoryItemIds.find((id) => !cartIds.includes(id));
  const allInCart = line.unitInventoryItemIds.length > 0 && !nextId;

  if (allInCart) {
    return (
      <Button variant="secondary" size="sm" onClick={() => router.push('/checkout')}>
        <Check size={14} aria-hidden />
        {t('line.inCart')}
      </Button>
    );
  }
  return (
    <Button variant="primary" size="sm" onClick={() => onAdd(nextId!)}>
      {t('line.add')}
    </Button>
  );
}

function Substitute({
  sub,
  cartIds,
  onAdd,
}: {
  sub: NonNullable<MetaDeckLineDTO['substitute']>;
  cartIds: string[];
  onAdd: (id: string) => void;
}) {
  const t = useTranslations('decksMeta');
  const locale = useLocale() as AppLocale;
  const nextId = sub.unitInventoryItemIds.find((id) => !cartIds.includes(id));
  const label =
    sub.unitPriceMxnCents != null
      ? t('substitute.use', {
          name: sub.name,
          set: sub.setCode,
          number: sub.number,
          price: formatMoneyCents(sub.unitPriceMxnCents, locale),
        })
      : t('substitute.usePending', { name: sub.name, set: sub.setCode, number: sub.number });

  return (
    <div className="mt-2 flex flex-wrap items-center gap-3 border-l-2 border-border pl-3">
      <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted">
        {t('substitute.label')}
      </span>
      <Button
        variant="secondary"
        size="sm"
        disabled={!nextId}
        className={cn(!nextId && 'opacity-60')}
        onClick={() => nextId && onAdd(nextId)}
      >
        {label}
      </Button>
    </div>
  );
}

/**
 * §AC-UX.8 — energía básica ligada a su producto activo (`MetaDeckLineDTO.basicEnergy`). Precio del servidor
 * («{price} c/u»); «Agregar ×{qty}» suma `quantity` unidades (la cotización ajusta si hay menos).
 */
function EnergyLineRow({
  line,
  energy,
  inCartQty,
  inBundle,
  signedIn,
  onAdd,
}: {
  line: MetaDeckLineDTO;
  energy: NonNullable<MetaDeckLineDTO['basicEnergy']>;
  inCartQty: number;
  inBundle: boolean;
  signedIn: boolean;
  onAdd: (accessoryId: string, qty: number) => void;
}) {
  const t = useTranslations('decksMeta');
  const ta = useTranslations('accessories');
  const locale = useLocale() as AppLocale;
  const router = useRouter();
  const type = ta(`energyType.${energy.energyType}`);
  const name = t('energy.name', { type });

  let action: React.ReactNode = null;
  if (inBundle) action = <p className="text-sm text-muted">{t('energy.inBundle')}</p>;
  else if (signedIn || energy.soldOut) action = null;
  else if (inCartQty >= line.quantity)
    action = (
      <Button variant="secondary" size="sm" onClick={() => router.push('/checkout')}>
        <Check size={14} aria-hidden />
        {t('energy.inCart')}
      </Button>
    );
  else
    action = (
      <Button
        variant="primary"
        size="sm"
        aria-label={t('energy.addAria', { qty: line.quantity, type })}
        onClick={() => onAdd(energy.accessoryId, line.quantity)}
      >
        {t('energy.add', { qty: line.quantity })}
      </Button>
    );

  return (
    <div data-testid={`deck-energy-${energy.energyType}`} className="flex flex-wrap items-center gap-4 border-b border-border py-4">
      <AccessoryPhoto src={energy.photo.thumbUrl} alt={name} fallbackText={name} className="h-12 w-12 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="font-mono text-[11px] tabular text-muted">{t('detail.quantity', { qty: line.quantity })}</span>
          <span className="text-[15px] text-text">{name}</span>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
          {energy.soldOut ? (
            <Badge tone="neutral">{t('energy.soldOut')}</Badge>
          ) : (
            <Badge tone="success">{t('line.available')}</Badge>
          )}
          <span className="tabular text-[15px] font-medium leading-none text-text">
            {t('energy.unitPrice', { price: formatMoneyCents(energy.unitPriceCents, locale) })}
          </span>
        </div>
      </div>
      {action}
    </div>
  );
}

/**
 * §AC-UX.8 — el recuadro del paquete de energías. ⛔ Nada viene marcado y «Agregar de jalón» no lo agrega
 * (AC-UX-7, criterio 735). El botón propio se habilita solo con el deck completo en el carrito (P-EN-4).
 * Cifras del servidor: `priceCents` y `looseTotalCents` (referencia, ⛔ sin tachar ni «ahorras»).
 */
function EnergyBundleBox({
  bundle,
  deckReady,
  inCart,
  signedIn,
  onAdd,
  onRemove,
}: {
  bundle: DeckEnergyBundleDTO;
  deckReady: boolean;
  inCart: boolean;
  signedIn: boolean;
  onAdd: () => void;
  onRemove: () => void;
}) {
  const t = useTranslations('decksMeta.bundle');
  const ta = useTranslations('accessories');
  const locale = useLocale() as AppLocale;
  const router = useRouter();
  const reasonId = useId();

  if (!bundle.offered) {
    return bundle.reason === 'insufficient_stock' ? <p className="mt-4 text-sm text-muted">{t('noStock')}</p> : null;
  }
  return (
    <section data-testid="deck-energy-bundle" className="mt-4 flex flex-col gap-2 border-y border-border-strong bg-surface py-5">
      <p className="eyebrow">{t('eyebrow')}</p>
      <p className="text-[15px] text-text">
        {t('headline', { n: totalQuantity(bundle.energies), price: formatMoneyCents(bundle.priceCents, locale) })}
      </p>
      <p className="font-mono text-xs text-muted">{energyBreakdown(bundle.energies, ta)}</p>
      <p className="text-sm text-muted">{t('loose', { amount: formatMoneyCents(bundle.looseTotalCents, locale) })}</p>
      <p className="text-xs text-muted">{t('note')}</p>
      {signedIn ? (
        <SignedInAccessoryNotice className="mt-2" />
      ) : inCart ? (
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <Button variant="secondary" size="sm" onClick={() => router.push('/checkout')}>
            <Check size={14} aria-hidden />
            {t('inCart')}
          </Button>
          <Button variant="ghost" size="sm" onClick={onRemove}>
            {t('remove')}
          </Button>
        </div>
      ) : (
        <div className="mt-2 flex flex-col items-start gap-2">
          <Button variant="secondary" size="sm" disabled={!deckReady} aria-describedby={!deckReady ? reasonId : undefined} onClick={onAdd}>
            {t('add')}
          </Button>
          {!deckReady && (
            <p id={reasonId} className="text-xs text-muted">
              {t('needsDeck')}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
