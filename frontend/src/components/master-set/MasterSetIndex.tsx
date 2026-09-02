'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  getMasterSets,
  getAdminVaultMasterSets,
  getVaultMasterSets,
  listBuylistSets,
  type MasterSetIndexFilters,
} from '@/lib/api';
import type { MasterSetIndexResponse, MasterSetSort, MasterSetSummaryDTO } from '@/types/contract';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { QueryState } from '@/components/ui/QueryState';
import { cn } from '@/lib/cn';
import type { MasterSetViewMode } from './mode';

const SORTS: MasterSetSort[] = ['release_desc', 'completion_asc', 'pieces_desc'];
const PAGE_SIZE = 20;

interface Props {
  mode: MasterSetViewMode;
  /** Requerido en `user_vault_admin` (bóveda de ESE cliente). */
  userId?: string;
  onOpenSet: (set: MasterSetSummaryDTO) => void;
  /**
   * §24.6 «Seleccionado / actual»: set-id que el ANFITRIÓN sabe que es el actual (p. ej. se vuelve
   * del binder con el set en la URL). Su teja gana `aria-current="true"` + subrayado 2px de acento.
   * Se deja opcional a propósito: el índice **no inventa** una selección que no existe — mientras
   * ningún anfitrión lo pase, ninguna teja está «actual», que es justo lo que dice §24.6.
   */
  currentSetId?: string;
}

// ===== DESIGN_SYSTEM §24.5 — el monograma (derivación de PRESENTACIÓN, no un dato) =====
// Palabras que no aportan inicial. Se comparan en minúsculas.
const MONOGRAM_STOP_WORDS = new Set(['and', 'of', 'the']);

/**
 * Iniciales de las palabras significativas del nombre del set, mayúsculas, máximo 3:
 * `Surging Sparks` → `SS`, `Journey Together` → `JT`, `Scarlet & Violet` → `SV` (el `&` cae al
 * quedarse sin letras). Si salen menos de 2 caracteres (nombres numéricos como `151`), se usan los
 * 3 PRIMEROS caracteres del nombre.
 *
 * §24.5 «Regla de propiedad»: esto es una derivación del front (mismo estatuto que el mapa
 * rareza→grupo de §7.16a). No es un dato, no lo manda el backend y **da igual que dos sets
 * compartan iniciales**: el nombre completo va justo debajo (R2).
 */
export function setMonogram(name: string): string {
  const words = name
    .split(/\s+/)
    // Se limpia la puntuación (`Celebrations:` → `Celebrations`, `&` → ``) y lo que quede vacío cae.
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter((w) => w.length > 0 && !MONOGRAM_STOP_WORDS.has(w.toLowerCase()));
  const initials = words.map((w) => w[0]).join('').toUpperCase();
  if (initials.length >= 2) return initials.slice(0, 3);
  return name.trim().slice(0, 3).toUpperCase();
}

/**
 * §24.2 — el CONTORNO DE SEGURIDAD. Dispositivo de LEGIBILIDAD, no de elevación (§4.3): offset 0,
 * radio 1px, color siempre `--color-on-ink`, y SOLO dentro de la placa. En un logo claro (el caso
 * común) es invisible; en un logo oscuro sin filete es lo único que lo salva sobre la tinta. Es
 * OBLIGATORIO (§24.12 nº11): funciona sin saber cuál es cuál, que es todo el punto.
 */
const LOGO_SAFETY_OUTLINE =
  'drop-shadow(0 0 1px var(--color-on-ink)) drop-shadow(0 0 1px var(--color-on-ink))';

/**
 * §24.2/§24.3 — LA PLACA DE TINTA. Caja de tamaño fijo (`aspect-[3/2]`) idéntica para todos los
 * sets, radio 0, sin borde, con aire interior; el logo va `object-contain` (R1: nunca `cover`,
 * nunca estirado, nunca recortado) sobre `--color-ink`, también en tema claro (R3).
 *
 * El MONOGRAMA se pinta desde el primer frame, debajo del `<img>`, y la imagen lo tapa sin
 * transición: la placa nunca se ve vacía y **nunca pulsa** (R4). Un `animate-pulse` eterno haría
 * que un `logoUrl: null` —caso normal y permanente— pareciera una app colgada; es el precedente
 * literal de `CardImage`, que deja el pozo QUIETO cuando no hay `src`.
 *
 * `onError` retira el `<img>` y deja el monograma: un 404 del CDN no deja a nadie esperando y
 * jamás se ve un icono de imagen rota (§24.5 nº3).
 *
 * A11y (§24.8): el logo es DECORATIVO (`alt=""` + `aria-hidden`) y el monograma también. El nombre
 * accesible de la teja lo dan el nombre visible + la meta, que ya están en el DOM dentro del
 * `<button>` — sin esto un lector anunciaría «logo de Surging Sparks, Surging Sparks».
 */
function SetPlate({ name, logoUrl }: { name: string; logoUrl: string | null }) {
  const [failed, setFailed] = useState(false);
  // Cada teja va keyada por `setId` en la lista, así que un fallo NO se hereda entre sets al
  // paginar o filtrar: el estado muere con la teja.
  const src = failed ? null : logoUrl;
  return (
    <div className="relative aspect-[3/2] w-full bg-ink p-4 sm:p-5 lg:p-6">
      <span
        aria-hidden="true"
        className="absolute inset-0 flex items-center justify-center font-serif text-[28px] leading-none tracking-[0.06em] text-on-ink lg:text-[44px]"
      >
        {setMonogram(name)}
      </span>
      {src && (
        // Nivel B (ARCHITECTURE §4.39.7): `<img>` crudo, sin next/image y sin `srcset` (no
        // conocemos las dimensiones intrínsecas y el CDN sirve un solo tamaño).
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          aria-hidden="true"
          // §24.7: `lazy` en TODAS, sin excepciones (`lazy` no retrasa lo que está en el viewport:
          // la primera fila entra sola). PROHIBIDO `fetchpriority="high"` aquí — 20 imágenes
          // compitiéndose el ancho de banda es lo contrario de lo que se busca.
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          className="relative h-full w-full object-contain"
          style={{ filter: LOGO_SAFETY_OUTLINE }}
        />
      )}
    </div>
  );
}

/**
 * mode="quoter" (cotizador): SIN endpoint de índice propio — se compone client-side con
 * `GET /buylist/sets` (público, ya usado por el cotizador) filtrando/ordenando/paginando en
 * el cliente. Sin inventario/bóveda: no hay completitud/piezas que agregar (van en 0/null y
 * la UI las oculta para este modo — ver `MasterSetIndex`).
 */
async function fetchQuoterIndex(filters: MasterSetIndexFilters): Promise<MasterSetIndexResponse> {
  const sets = await listBuylistSets();
  const q = (filters.q ?? '').trim().toLowerCase();
  const matched = q ? sets.filter((s) => s.name.toLowerCase().includes(q)) : sets;
  // N-1: ordenar por `releaseDate` COMPLETA descendente (no solo por año), igual que el
  // backend en `listSetsWithImportedCards`. Con año-solo, los sets del mismo año caían en
  // orden alfabético y Pitch Black (2026) quedaba tras Ascended/Chaos/Perfect. Sets sin
  // fecha van al final (por año y nombre) en vez de mezclarse como si fueran los más nuevos.
  const sorted = [...matched].sort((a, b) => {
    if (a.releaseDate && b.releaseDate) {
      if (a.releaseDate !== b.releaseDate) return a.releaseDate < b.releaseDate ? 1 : -1;
      return a.name.localeCompare(b.name);
    }
    if (a.releaseDate) return -1; // b sin fecha → al final
    if (b.releaseDate) return 1; // a sin fecha → al final
    return (b.year ?? 0) - (a.year ?? 0) || a.name.localeCompare(b.name);
  });
  const pageSize = filters.pageSize ?? PAGE_SIZE;
  const page = filters.page ?? 1;
  const start = (page - 1) * pageSize;
  const data: MasterSetSummaryDTO[] = sorted.slice(start, start + pageSize).map((s) => ({
    setId: s.id,
    name: s.name,
    series: s.series,
    releaseDate: s.releaseDate,
    year: s.year,
    // v1.52 (M-47): `GET /buylist/sets` trae el logo (contrato §GET /buylist/sets: «obligatorio, no
    // opcional» — es la ÚNICA fuente de la teja del cotizador). Si no se mapeara aquí, ésta sería
    // la única de las cuatro retículas sin logo, y nada fallaría hasta verlo con los ojos.
    logoUrl: s.logoUrl ?? null,
    catalogCardCount: 0,
    distinctCardsOwned: 0,
    completionPct: null,
    totalPieces: 0,
    catalogVariantCount: 0,
    distinctVariantsOwned: 0,
    variantCompletionPct: null,
  }));
  return { data, page, pageSize, total: sorted.length, scope: 'platform' };
}

/** Un solo lugar decide el endpoint por modo (contrato v1.20: mismo shape, distinto scope). */
function fetchIndex(
  mode: MasterSetViewMode,
  userId: string | undefined,
  filters: MasterSetIndexFilters,
): Promise<MasterSetIndexResponse> {
  if (mode === 'quoter') return fetchQuoterIndex(filters);
  if (mode === 'user_vault_self') return getVaultMasterSets(filters);
  if (mode === 'user_vault_admin') return getAdminVaultMasterSets(userId ?? '', filters);
  return getMasterSets(filters);
}

/**
 * Índice Master Set COMPARTIDO (§4.20f): grid de sets con completitud POR VARIANTE
 * (v1.20: distinctVariantsOwned / catalogVariantCount · variantCompletionPct — los
 * contadores «X/Y» cuentan variantes, no cartas) y conteo de piezas. Click → binder.
 */
export function MasterSetIndex({ mode, userId, onOpenSet, currentSetId }: Props) {
  const t = useTranslations('masterSet');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<MasterSetSort>('release_desc');
  const [page, setPage] = useState(1);

  const filters: MasterSetIndexFilters = {
    q: q.trim() || undefined,
    sort,
    page,
    pageSize: PAGE_SIZE,
  };
  const index = useQuery({
    queryKey: ['master-sets', mode, userId ?? null, filters],
    queryFn: () => fetchIndex(mode, userId, filters),
  });

  const totalPages = index.data ? Math.max(1, Math.ceil(index.data.total / PAGE_SIZE)) : 1;
  const owner = index.data?.owner;

  return (
    <div className="flex flex-col gap-4">
      {/* Dueño de la bóveda (solo scope user_vault; email solo en la vista admin). */}
      {mode === 'user_vault_admin' && owner && (
        <p className="font-mono text-xs text-muted">
          {t('ownerVault', { name: owner.name })}
          {owner.email ? ` · ${owner.email}` : ''}
        </p>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <Input
          label={t('searchSet')}
          className="w-64"
          placeholder={t('searchSetPlaceholder')}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
        />
        {/* Ordenar por completitud/piezas no aplica en quoter (sin inventario/bóveda que agregar):
            el índice del cotizador siempre ordena por lanzamiento (server-side no hay qué elegir). */}
        {mode !== 'quoter' && (
          <Select
            label={t('sortLabel')}
            className="w-56"
            options={SORTS.map((s) => ({ value: s, label: t(`sort.${s}`) }))}
            value={sort}
            onChange={(e) => {
              setSort(e.target.value as MasterSetSort);
              setPage(1);
            }}
          />
        )}
      </div>

      <QueryState
        isLoading={index.isLoading}
        isError={index.isError}
        error={index.error}
        onRetry={() => index.refetch()}
      >
        {index.data &&
          (index.data.data.length === 0 ? (
            <EmptyState title={t('emptyIndexTitle')} body={t('emptyIndexBody')} />
          ) : (
            <>
              {/* §24.4 — 2 / 3 / 4 columnas (se TOPA en 4: con 5 la placa se encoge justo donde
                  sobra sitio). Gap 24/32 → 32/40 en `lg`. */}
              <ul className="grid grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-3 lg:grid-cols-4 lg:gap-x-8 lg:gap-y-10">
                {index.data.data.map((s) => {
                  const isCurrent = currentSetId != null && s.setId === currentSetId;
                  return (
                    <li key={s.setId}>
                      {/* §24.3 — la teja ya NO es una tarjeta: sin fondo, sin borde, sin sombra.
                          Con la placa dentro, la tarjeta sería una caja alrededor de otra caja.
                          El foco usa el anillo ESTÁNDAR del sistema (`:focus-visible` global:
                          outline 2px + offset 2px), que cae POR FUERA, sobre papel — dibujarlo
                          dentro de la placa sería rojo sobre tinta, 2,5:1 (§24.6, §24.9). */}
                      <button
                        type="button"
                        onClick={() => onOpenSet(s)}
                        aria-current={isCurrent ? 'true' : undefined}
                        className="group flex w-full flex-col text-left"
                      >
                        <SetPlate name={s.name} logoUrl={s.logoUrl} />
                        <div className="mt-3 flex flex-col gap-0.5">
                          <span className="flex flex-wrap items-baseline gap-x-2">
                            {/* §24.6 — hover: subrayado 1px en tinta. Seleccionado: 2px de acento
                                (se distingue por GROSOR y color, no solo por color). La placa no
                                cambia en hover: ni se aclara, ni escala, ni el logo crece. */}
                            <span
                              lang="en"
                              className={cn(
                                // Reserva 2 LÍNEAS de alto (40/45/50px = 2 × 1,25 de línea) para
                                // que las filas no bailen; puede crecer a 3 y NUNCA se trunca: el
                                // nombre es el portador del dato (R2).
                                'min-h-[40px] font-serif text-base leading-[1.25] [text-wrap:balance] underline-offset-4 sm:min-h-[45px] sm:text-[18px] lg:min-h-[50px] lg:text-h3',
                                isCurrent
                                  ? // Actual: 2px de ACENTO. No se combina con el hover — si no,
                                    // pasar el ratón lo adelgazaría a 1px y perdería su canal.
                                    'underline decoration-accent decoration-2'
                                  : 'group-hover:underline group-hover:decoration-1',
                              )}
                            >
                              {s.name}
                            </span>
                            {/* v1.33 (P-27): master COMBINADO (principal + subset(s) plegados en UNA fila). */}
                            {s.partSetIds && s.partSetIds.length > 1 && (
                              <span className="border border-border-strong px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-muted">
                                {t('combinedBadge')}
                              </span>
                            )}
                          </span>
                          {/* §24.3 — la META es donde aterriza la voz mono en versalitas: es la
                              etiqueta técnica (§3.1), no el nombre propio. */}
                          <span
                            lang="en"
                            className="font-mono text-[11px] uppercase tracking-label text-muted"
                          >
                            {[s.series, s.year].filter(Boolean).join(' · ')}
                          </span>
                        </div>
                        {/* Completitud/piezas: conceptos de INVENTARIO/bóveda — no aplican en quoter
                            (el cotizador no posee las cartas, solo las cotiza). */}
                        {mode !== 'quoter' && (
                          <div className="mt-3 flex w-full flex-col gap-2">
                            {/* v1.20: completitud POR VARIANTE (carta+acabado), no por carta. */}
                            <div className="flex items-baseline justify-between gap-2">
                              <span className="font-mono text-xs uppercase tracking-wide text-muted">
                                {t('completionLabel')}
                              </span>
                              <span className="font-mono tabular-nums text-sm">
                                {t('completionValue', {
                                  owned: s.distinctVariantsOwned,
                                  total: s.catalogVariantCount,
                                  pct: s.variantCompletionPct ?? 0,
                                })}
                              </span>
                            </div>
                            <ProgressBar pct={s.variantCompletionPct ?? 0} />
                            <div className="flex items-baseline justify-between gap-2">
                              <span className="font-mono text-xs uppercase tracking-wide text-muted">
                                {t('piecesLabel')}
                              </span>
                              <span className="font-mono tabular-nums text-sm">
                                {t('piecesValue', { count: s.totalPieces })}
                              </span>
                            </div>
                          </div>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>

              <div className="flex items-center justify-between">
                <span className="text-xs text-muted">
                  {t('pageInfo', { page: index.data.page, totalPages, total: index.data.total })}
                </span>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => p - 1)}
                  >
                    <ChevronLeft size={16} /> {t('prev')}
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    {t('next')} <ChevronRight size={16} />
                  </Button>
                </div>
              </div>
            </>
          ))}
      </QueryState>
    </div>
  );
}

function ProgressBar({ pct }: { pct: number }) {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div
      className="h-1.5 w-full bg-surface-2"
      role="progressbar"
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className="h-full bg-accent" style={{ width: `${clamped}%` }} />
    </div>
  );
}
