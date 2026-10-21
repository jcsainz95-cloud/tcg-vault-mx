'use client';

import { useEffect, useState } from 'react';
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { DownloadCloud } from 'lucide-react';
import { asApiError } from '@/lib/api-client';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { QueryState } from '@/components/ui/QueryState';
import { Select } from '@/components/ui/Select';
import { Skeleton } from '@/components/ui/Skeleton';
import { formatDateTimeMx } from '@/lib/format';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import type { AppLocale } from '@/i18n/routing';
import {
  exportCardShowLeadsCsv,
  exportCardShowPlayersCsv,
  listCardShowLeads,
  listCardShowPlayers,
  type CardShowLeadRow,
  type CardShowPlayerRow,
  type LeadListFilters,
  type PlayerListFilters,
} from '@/lib/card-show-admin-api';

/**
 * Panel «Card Show» (super_admin) — API_CONTRACT §CARDSHOW.15, v1.96 M-84. Dos listados:
 *  - **Leads** (captura «Avísame»): filtros tipo/estado + búsqueda; columnas M-84 (nombre, teléfono,
 *    juego de interés, rifa, ¿qué vende?). PII ⇒ sólo super_admin.
 *  - **Preinscritos** (torneo): filtros juego/día/estado + búsqueda; Player ID vacío en los juegos
 *    LIGERA (no-Pokémon).
 * Cada listado trae **«Descargar CSV»** (`export.csv`, mismos filtros). ⛔ PENDING no aparece: lo
 * excluye el backend (§CARDSHOW.15) y aquí ⛔ no se pide ni se reintroduce.
 *
 * El `h1` sale de `admin.modules.cardShow` (candado `AdminPageTitles` §37.2). El resto del copy es
 * es-MX literal: el Card Show es un microsite de un solo idioma.
 */

const GAME_LABEL: Record<string, string> = { pokemon: 'Pokémon', riftbound: 'Riftbound', lorcana: 'Lorcana', shardbugs: 'Shard Bugs', magic: 'Magic: The Gathering' };
const LEAD_TYPE_LABEL: Record<string, string> = { visitor: 'Asistente', merchant: 'Vendedor', sponsor: 'Patrocinador' };
const LEAD_STATUS_LABEL: Record<string, string> = {
  new: 'Nuevo',
  contacted: 'Contactado',
  closed: 'Cerrado',
  discarded: 'Descartado',
};
const SIGNUP_STATUS_LABEL: Record<string, string> = {
  confirmed: 'Confirmado',
  waitlist: 'Lista de espera',
  cancelled: 'Cancelado',
  checked_in: 'Registrado en sitio',
};
const DAY_LABEL: Record<string, string> = { sat: 'Sábado', sun: 'Domingo' };

function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

type Section = 'leads' | 'players';

export function CardShowAdminView({ initialSection = 'leads' }: { initialSection?: Section }) {
  const t = useTranslations('admin.modules');
  const [section, setSection] = useState<Section>(initialSection);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-serif text-3xl text-text">{t('cardShow')}</h1>
        <p className="text-sm text-muted">Captura pública del evento: leads y preinscritos al torneo. Solo confirmados (sin pendientes).</p>
      </header>

      <div role="tablist" aria-label="Listados del Card Show" className="flex flex-wrap gap-2">
        {([
          ['leads', 'Leads'],
          ['players', 'Preinscritos'],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={section === key}
            onClick={() => setSection(key)}
            className={
              section === key
                ? 'min-h-[44px] border border-text bg-text px-4 font-mono text-[11px] uppercase tracking-[0.06em] text-primary-fg'
                : 'min-h-[44px] border border-border-strong px-4 font-mono text-[11px] uppercase tracking-[0.06em] text-text hover:border-text'
            }
          >
            {label}
          </button>
        ))}
      </div>

      {section === 'leads' ? <LeadsPanel /> : <PlayersPanel />}
    </div>
  );
}

function CsvButton({ onClick, pending }: { onClick: () => void; pending: boolean }) {
  return (
    <Button variant="secondary" size="sm" loading={pending} onClick={onClick}>
      <DownloadCloud size={16} aria-hidden />
      Descargar CSV
    </Button>
  );
}

function StatusTag({ label }: { label: string }) {
  return <span className="font-mono text-[11px] uppercase tracking-[0.06em] text-muted">{label}</span>;
}

/** Tamaño de página por defecto del panel (§CARDSHOW.15: la envoltura trae `total` para paginar). */
const PAGE_SIZE = 50;

/**
 * Pie de la tabla: total de resultados + control de paginación (para pasar de 50). El backend devuelve
 * `{ data, page, pageSize, total }`; aquí se navega por `page`. Los botones se deshabilitan en los
 * bordes y mientras hay una consulta en vuelo.
 */
function Pagination({
  page,
  pageSize,
  total,
  pending,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  pending: boolean;
  onPage: (p: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
      <p className="font-mono text-xs text-muted" data-testid="cs-total">
        {total} resultado{total === 1 ? '' : 's'}
        {total > 0 && ` · ${from}–${to}`}
      </p>
      {totalPages > 1 && (
        <div className="flex items-center gap-3">
          <Button variant="secondary" size="sm" disabled={page <= 1 || pending} onClick={() => onPage(page - 1)}>
            Anterior
          </Button>
          <span className="font-mono text-xs text-muted">
            Página {page} de {totalPages}
          </span>
          <Button variant="secondary" size="sm" disabled={page >= totalPages || pending} onClick={() => onPage(page + 1)}>
            Siguiente
          </Button>
        </div>
      )}
    </div>
  );
}

/** Correo como `mailto:` (accionable desde la tabla, BLOQ-11). */
function EmailLink({ email }: { email: string }) {
  return (
    <a href={`mailto:${email}`} className="text-text underline underline-offset-2 hover:text-accent">
      {email}
    </a>
  );
}

/**
 * Teléfono accionable: `tel:` + enlace a WhatsApp (`wa.me`). El valor persistido son 10 dígitos
 * (§CARDSHOW.1b); para `tel:`/`wa.me` se antepone la lada MX (+52 / 52).
 */
function PhoneLinks({ phone }: { phone: string | null }) {
  if (!phone) return <>—</>;
  const digits = phone.replace(/\D/g, '');
  const intl = digits.length === 10 ? `52${digits}` : digits;
  return (
    <span className="flex flex-col gap-0.5">
      <a href={`tel:+${intl}`} className="tabular text-text underline underline-offset-2 hover:text-accent">
        {phone}
      </a>
      <a
        href={`https://wa.me/${intl}`}
        target="_blank"
        rel="noopener noreferrer"
        className="font-mono text-[11px] uppercase tracking-[0.06em] text-muted hover:text-accent"
      >
        WhatsApp
      </a>
    </span>
  );
}

function LeadsPanel() {
  const locale = useLocale() as AppLocale;
  const [type, setType] = useState<LeadListFilters['type']>(undefined);
  const [status, setStatus] = useState<LeadListFilters['status']>(undefined);
  const [qInput, setQInput] = useState('');
  const q = useDebouncedValue(qInput.trim(), 300); // BLOQ-11: no una consulta por pulsación
  const [page, setPage] = useState(1);
  // Cualquier cambio de filtro o de búsqueda vuelve a la página 1.
  useEffect(() => setPage(1), [type, status, q]);

  const baseFilters: LeadListFilters = { type, status, q: q || undefined };
  const filters: LeadListFilters = { ...baseFilters, page, pageSize: PAGE_SIZE };
  const query = useQuery({
    queryKey: ['cs-admin-leads', filters],
    queryFn: () => listCardShowLeads(filters),
    placeholderData: keepPreviousData,
    retry: false,
  });
  const rows = query.data?.data ?? [];
  const total = query.data?.total ?? 0;
  const forbidden = asApiError(query.error)?.status === 403;
  const csv = useMutation({
    mutationFn: () => exportCardShowLeadsCsv(baseFilters),
    onSuccess: ({ blob, filename }) => triggerBlobDownload(blob, filename ?? 'card-show-leads.csv'),
  });

  if (forbidden) {
    return (
      <Banner variant="warning" role="alert">
        Este panel es solo para súper-admin.
      </Banner>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-4">
        <div className="min-w-[11rem]">
          <Select
            label="Tipo"
            options={[
              { value: '', label: 'Todos' },
              { value: 'visitor', label: 'Asistente' },
              { value: 'merchant', label: 'Vendedor' },
              { value: 'sponsor', label: 'Patrocinador' },
            ]}
            value={type ?? ''}
            onChange={(e) => setType((e.target.value || undefined) as LeadListFilters['type'])}
          />
        </div>
        <div className="min-w-[11rem]">
          <Select
            label="Estado"
            options={[
              { value: '', label: 'Todos' },
              { value: 'new', label: 'Nuevo' },
              { value: 'contacted', label: 'Contactado' },
              { value: 'closed', label: 'Cerrado' },
              { value: 'discarded', label: 'Descartado' },
            ]}
            value={status ?? ''}
            onChange={(e) => setStatus((e.target.value || undefined) as LeadListFilters['status'])}
          />
        </div>
        <div className="min-w-[14rem] flex-1">
          <Input
            label="Buscar (nombre o correo)"
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
          />
        </div>
        <CsvButton onClick={() => csv.mutate()} pending={csv.isPending} />
      </div>

      <QueryState
        isLoading={query.isLoading}
        isError={query.isError}
        error={query.error}
        onRetry={() => query.refetch()}
        loading={
          <div className="flex flex-col gap-2" aria-busy="true">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        }
      >
        {query.data &&
          (rows.length === 0 ? (
            <EmptyState title="Sin leads" body="Ningún registro confirmado con estos filtros." />
          ) : (
            <div className="flex flex-col gap-3">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-sm" data-testid="cs-leads-table">
                <thead>
                  <tr className="border-b border-border font-mono text-[11px] uppercase tracking-[0.06em] text-muted">
                    <th className="py-2 pr-3">Nombre</th>
                    <th className="py-2 pr-3">Tipo</th>
                    <th className="py-2 pr-3">Correo</th>
                    <th className="py-2 pr-3">Teléfono</th>
                    <th className="py-2 pr-3">Juego</th>
                    <th className="py-2 pr-3">Rifa</th>
                    <th className="py-2 pr-3">¿Qué vende?</th>
                    <th className="py-2 pr-3">Estado</th>
                    <th className="py-2">Fecha</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r: CardShowLeadRow) => (
                    <tr key={r.id} className="border-b border-border align-top" data-testid={`cs-lead-${r.id}`}>
                      <td className="py-3 pr-3 text-text">{r.name}</td>
                      <td className="py-3 pr-3">{LEAD_TYPE_LABEL[r.type] ?? r.type}</td>
                      <td className="py-3 pr-3 tabular"><EmailLink email={r.email} /></td>
                      <td className="py-3 pr-3"><PhoneLinks phone={r.phone} /></td>
                      <td className="py-3 pr-3">{r.gameInterest ? GAME_LABEL[r.gameInterest] : '—'}</td>
                      <td className="py-3 pr-3">{r.raffleOptIn ? 'Sí' : 'No'}</td>
                      <td className="py-3 pr-3 text-muted">{r.sellsWhat ?? '—'}</td>
                      <td className="py-3 pr-3">
                        <StatusTag label={LEAD_STATUS_LABEL[r.status] ?? r.status} />
                      </td>
                      <td className="py-3 tabular text-muted">{formatDateTimeMx(r.createdAt, locale)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} pageSize={PAGE_SIZE} total={total} pending={query.isFetching} onPage={setPage} />
            </div>
          ))}
      </QueryState>
    </div>
  );
}

function PlayersPanel() {
  const locale = useLocale() as AppLocale;
  const [game, setGame] = useState<PlayerListFilters['game']>(undefined);
  const [day, setDay] = useState<PlayerListFilters['day']>(undefined);
  const [status, setStatus] = useState<PlayerListFilters['status']>(undefined);
  const [qInput, setQInput] = useState('');
  const q = useDebouncedValue(qInput.trim(), 300); // BLOQ-11
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [game, day, status, q]);

  const baseFilters: PlayerListFilters = { game, day, status, q: q || undefined };
  const filters: PlayerListFilters = { ...baseFilters, page, pageSize: PAGE_SIZE };
  const query = useQuery({
    queryKey: ['cs-admin-players', filters],
    queryFn: () => listCardShowPlayers(filters),
    placeholderData: keepPreviousData,
    retry: false,
  });
  const rows = query.data?.data ?? [];
  const total = query.data?.total ?? 0;
  const forbidden = asApiError(query.error)?.status === 403;
  const csv = useMutation({
    mutationFn: () => exportCardShowPlayersCsv(baseFilters),
    onSuccess: ({ blob, filename }) => triggerBlobDownload(blob, filename ?? 'card-show-players.csv'),
  });

  if (forbidden) {
    return (
      <Banner variant="warning" role="alert">
        Este panel es solo para súper-admin.
      </Banner>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-4">
        <div className="min-w-[11rem]">
          <Select
            label="Juego"
            options={[
              { value: '', label: 'Todos' },
              { value: 'pokemon', label: 'Pokémon' },
              { value: 'riftbound', label: 'Riftbound' },
              { value: 'lorcana', label: 'Lorcana' },
              { value: 'shardbugs', label: 'Shard Bugs' },
              { value: 'magic', label: 'Magic: The Gathering' },
            ]}
            value={game ?? ''}
            onChange={(e) => setGame((e.target.value || undefined) as PlayerListFilters['game'])}
          />
        </div>
        <div className="min-w-[10rem]">
          <Select
            label="Día"
            options={[
              { value: '', label: 'Todos' },
              { value: 'sat', label: 'Sábado' },
              { value: 'sun', label: 'Domingo' },
            ]}
            value={day ?? ''}
            onChange={(e) => setDay((e.target.value || undefined) as PlayerListFilters['day'])}
          />
        </div>
        <div className="min-w-[11rem]">
          <Select
            label="Estado"
            options={[
              { value: '', label: 'Todos' },
              { value: 'confirmed', label: 'Confirmado' },
              { value: 'waitlist', label: 'Lista de espera' },
              { value: 'cancelled', label: 'Cancelado' },
              { value: 'checked_in', label: 'Registrado en sitio' },
            ]}
            value={status ?? ''}
            onChange={(e) => setStatus((e.target.value || undefined) as PlayerListFilters['status'])}
          />
        </div>
        <div className="min-w-[14rem] flex-1">
          <Input
            label="Buscar (nombre, correo o Player ID)"
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
          />
        </div>
        <CsvButton onClick={() => csv.mutate()} pending={csv.isPending} />
      </div>

      <QueryState
        isLoading={query.isLoading}
        isError={query.isError}
        error={query.error}
        onRetry={() => query.refetch()}
        loading={
          <div className="flex flex-col gap-2" aria-busy="true">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        }
      >
        {query.data &&
          (rows.length === 0 ? (
            <EmptyState title="Sin preinscritos" body="Ninguna preinscripción confirmada con estos filtros." />
          ) : (
            <div className="flex flex-col gap-3">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-sm" data-testid="cs-players-table">
                <thead>
                  <tr className="border-b border-border font-mono text-[11px] uppercase tracking-[0.06em] text-muted">
                    <th className="py-2 pr-3">Jugador</th>
                    <th className="py-2 pr-3">Juego</th>
                    <th className="py-2 pr-3">Día</th>
                    <th className="py-2 pr-3">Player ID</th>
                    <th className="py-2 pr-3">Estado</th>
                    <th className="py-2">Fecha</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r: CardShowPlayerRow) => (
                    <tr key={r.id} className="border-b border-border align-top" data-testid={`cs-player-${r.id}`}>
                      <td className="py-3 pr-3 text-text">{r.playerName}</td>
                      <td className="py-3 pr-3">{GAME_LABEL[r.game] ?? r.game}</td>
                      <td className="py-3 pr-3">{DAY_LABEL[r.day] ?? r.day}</td>
                      {/* LIGERA (no-Pokémon) ⇒ sin Player ID (§CARDSHOW.15). */}
                      <td className="py-3 pr-3 tabular">{r.playerId || '—'}</td>
                      <td className="py-3 pr-3">
                        <StatusTag label={SIGNUP_STATUS_LABEL[r.status] ?? r.status} />
                      </td>
                      <td className="py-3 tabular text-muted">{formatDateTimeMx(r.createdAt, locale)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} pageSize={PAGE_SIZE} total={total} pending={query.isFetching} onPage={setPage} />
            </div>
          ))}
      </QueryState>
    </div>
  );
}
