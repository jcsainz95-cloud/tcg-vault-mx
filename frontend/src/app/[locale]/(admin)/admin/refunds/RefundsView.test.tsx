import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactNode } from 'react';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { screen, fireEvent, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import type { PickingListSummaryDTO } from '@/types/contract';
import es from '../../../../../../messages/es.json';
import en from '../../../../../../messages/en.json';

/**
 * # §37.20 — la página «Reembolsos»: dos cubetas como pestañas de página (RF-5, RF-7 y el gate S6)
 *
 * - **RF-5** sin `tab` y con `?tab=basura` ⇒ «Transferencias SPEI» seleccionada; `?tab=operadores` ⇒ «Reembolsos
 *   de operadores». El `h1` es «Reembolsos» / “Refunds” y es el ÚNICO `h1` de la página (es y en), ya con la
 *   cubeta cargada (las cubetas pintaban su propio `h1` antes de §37.20).
 * - **RF-7** con `manualRefundsPending: 3`, el nombre accesible de la pestaña SPEI es «Transferencias SPEI, 3
 *   pendientes»; la de operadores no lleva dígitos.
 * - Cambiar de cubeta REEMPLAZA la URL (⛔ no apila); la por defecto BORRA `tab`. Solo se monta la activa.
 * - Al operador no se le pinta ni el `tablist` (S6).
 * - **RF-8** ningún enlace ni navegación del código de producción apunta a la lista vieja `/admin/manual-refunds`
 *   (los del detalle llevan `/${id}` y no casan; `lib/api.ts` llama al ENDPOINT con `apiRequest`, no casa).
 */

const roleState = vi.hoisted(() => ({ role: 'super_admin' }));
const summaryState = vi.hoisted(() => ({ data: undefined as PickingListSummaryDTO | undefined }));

vi.mock('@/lib/role', () => ({
  useRole: () => ({
    role: roleState.role,
    setRole: () => {},
    isSuperAdmin: roleState.role === 'super_admin',
    canSwitchRole: false,
  }),
}));

vi.mock('@/i18n/navigation', () => ({
  usePathname: () => '/admin/refunds',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  Link: ({ href, children, ...rest }: { href: unknown; children: ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock('@/hooks/usePickingSummary', () => ({
  PICKING_SUMMARY_KEY: ['admin-picking-summary'],
  usePickingSummary: () => ({ data: summaryState.data }),
}));

// eslint-disable-next-line import/first
import { RefundsView } from './RefundsView';
// eslint-disable-next-line import/first
import { parseRefundsTab } from './tabs';

function summary(manualRefundsPending: number | null): PickingListSummaryDTO {
  return {
    ship: 2,
    vault: 1,
    oldestRequestedAt: null,
    stuckRefunds: 5,
    toReplace: 4,
    oldestOpenCaseAt: null,
    toReplaceOverdue: 1,
    manualRefundsPending,
  };
}

const SPEI_ES = es.admin.refundsPage.tabs.spei;
const OPS_ES = es.admin.refundsPage.tabs.operators;

beforeEach(() => {
  roleState.role = 'super_admin';
  summaryState.data = undefined;
  window.history.replaceState(null, '', '/es/admin/refunds');
});

describe('§37.20 · RF-5 — la cubeta por defecto es SPEI; el `h1` es uno y es «Reembolsos»', () => {
  it.each([
    ['sin `tab`', undefined],
    ['`?tab=basura`', 'basura'],
    ['`?tab=spei`', 'spei'],
  ])('%s ⇒ «Transferencias SPEI» seleccionada y montada', async (_label, raw) => {
    renderWithProviders(<RefundsView initialTab={parseRefundsTab(raw)} />, 'es');
    expect(screen.getByRole('tab', { name: SPEI_ES }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: OPS_ES }).getAttribute('aria-selected')).toBe('false');
    // la lista SPEI está montada (fila del fixture) y la de operadores NO (solo se monta la activa)
    expect(await screen.findByTestId('mr-row-mr-1001')).toBeInTheDocument();
    expect(screen.queryByTestId('operator-summary')).toBeNull();
  });

  it('`?tab=operadores` ⇒ «Reembolsos de operadores» seleccionada y montada', async () => {
    renderWithProviders(<RefundsView initialTab={parseRefundsTab('operadores')} />, 'es');
    expect(screen.getByRole('tab', { name: OPS_ES }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: SPEI_ES }).getAttribute('aria-selected')).toBe('false');
    expect(await screen.findByTestId('operator-summary')).toBeInTheDocument();
  });

  it.each([
    ['es', undefined, es.admin.modules.refunds, 'mr-row-mr-1001'],
    ['es', 'operadores', es.admin.modules.refunds, 'operator-summary'],
    ['en', undefined, en.admin.modules.refunds, 'mr-row-mr-1001'],
    ['en', 'operadores', en.admin.modules.refunds, 'operator-summary'],
  ] as const)('%s, tab=%s: un solo `h1`, «%s», con la cubeta ya cargada', async (locale, raw, title, loaded) => {
    renderWithProviders(<RefundsView initialTab={parseRefundsTab(raw)} />, locale);
    await screen.findByTestId(loaded);
    const h1s = screen.getAllByRole('heading', { level: 1 });
    expect(h1s.map((h) => h.textContent)).toEqual([title]);
    expect(title).toBe(locale === 'es' ? 'Reembolsos' : 'Refunds');
    expect(screen.getByRole('tablist').getAttribute('aria-label')).toBe(title);
  });
});

describe('§37.20 · RF-7 — el contador de la pestaña SPEI sale del `summary` y va dentro del nombre accesible', () => {
  it('`manualRefundsPending: 3` ⇒ «Transferencias SPEI, 3 pendientes»; operadores sin dígitos', () => {
    summaryState.data = summary(3);
    renderWithProviders(<RefundsView initialTab="spei" />, 'es');
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.getAttribute('aria-label'))).toEqual(['Transferencias SPEI, 3 pendientes', OPS_ES]);
    expect(screen.getByTestId('refunds-tab-badge-spei').textContent).toBe('3');
    expect(tabs[1].textContent).not.toMatch(/\d/);
    expect(tabs[1].getAttribute('aria-label')).not.toMatch(/\d/);
  });

  it('en inglés: “SPEI transfers, 1 pending”', () => {
    summaryState.data = summary(1);
    renderWithProviders(<RefundsView initialTab="spei" />, 'en');
    expect(screen.getAllByRole('tab')[0].getAttribute('aria-label')).toBe('SPEI transfers, 1 pending');
  });

  it.each([0, null])('`manualRefundsPending: %s` ⇒ sin número', (n) => {
    summaryState.data = summary(n);
    renderWithProviders(<RefundsView initialTab="spei" />, 'es');
    expect(screen.getAllByRole('tab')[0].getAttribute('aria-label')).toBe(SPEI_ES);
    expect(screen.queryByTestId('refunds-tab-badge-spei')).toBeNull();
  });
});

describe('§37.20 b — cambiar de cubeta reemplaza la URL, ⛔ no apila; flechas como en «Pedidos por preparar»', () => {
  it('clic en operadores ⇒ `?tab=operadores`; volver a SPEI borra `tab`; el historial no crece', async () => {
    renderWithProviders(<RefundsView initialTab="spei" />, 'es');
    const before = window.history.length;
    fireEvent.click(screen.getByRole('tab', { name: OPS_ES }));
    expect(window.location.pathname + window.location.search).toBe('/es/admin/refunds?tab=operadores');
    expect(await screen.findByTestId('operator-summary')).toBeInTheDocument();
    expect(screen.queryByTestId('mr-row-mr-1001')).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: SPEI_ES }));
    expect(window.location.pathname + window.location.search).toBe('/es/admin/refunds');
    expect(window.history.length).toBe(before);
  });

  it('flecha derecha desde SPEI ⇒ operadores con el foco; el panel apunta a su pestaña', () => {
    renderWithProviders(<RefundsView initialTab="spei" />, 'es');
    fireEvent.keyDown(screen.getByRole('tab', { name: SPEI_ES }), { key: 'ArrowRight' });
    const ops = screen.getByRole('tab', { name: OPS_ES });
    expect(ops.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(ops);
    expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe(ops.id);
  });
});

describe('§37.20 b — gate: al operador no se le pinta ni el `tablist` (S6)', () => {
  it('como `vault_operator`: sin pestañas, sin cubetas, con el aviso de acceso restringido', () => {
    roleState.role = 'vault_operator';
    summaryState.data = summary(3);
    renderWithProviders(<RefundsView initialTab="spei" />, 'es');
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.queryByRole('tab')).toBeNull();
    expect(screen.getByText(es.admin.superAdminGateTitle)).toBeInTheDocument();
    const body = within(document.body);
    expect(body.queryByText(/Reembolsos/)).toBeNull();
  });
});

describe('§37.20 · RF-8 — nada navega a la lista vieja `/admin/manual-refunds`', () => {
  // Barrido de `src/` (código de producción; las pruebas quedan fuera). Barras escapadas para que esta línea
  // no se case a sí misma si un día el barrido incluye pruebas.
  const NAV_TO_OLD_LIST = /(href=|push\(|replace\(|redirect\().*\/admin\/manual-refunds([^/]|$)/;
  const SRC = resolve(__dirname, '../../../../..');

  function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) return walk(full);
      return /\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) ? [full] : [];
    });
  }

  it('`grep -nE "(href=|push\\(|replace\\(|redirect\\().*/admin/manual-refunds([^/]|$)" src` = 0', () => {
    const files = walk(SRC);
    expect(files.length).toBeGreaterThan(100); // el barrido mira de verdad `src/`
    const hits = files.flatMap((f) =>
      readFileSync(f, 'utf8')
        .split('\n')
        .map((line, i) => ({ line, i }))
        .filter(({ line }) => NAV_TO_OLD_LIST.test(line))
        .map(({ line, i }) => `${relative(SRC, f)}:${i + 1}: ${line.trim()}`),
    );
    expect(hits).toEqual([]);
  });
});

describe('§40.6 — «por revisar» NO es una tercera cubeta: un enlace a «Ventas», sin número', () => {
  it('dos pestañas y el enlace a `/admin/m3?refundReview=pending`', async () => {
    renderWithProviders(<RefundsView initialTab={parseRefundsTab(undefined)} />, 'es');
    expect(screen.getAllByRole('tab')).toHaveLength(2);
    const link = screen.getByTestId('refunds-review-link');
    expect(link).toHaveAttribute('href', '/admin/m3?refundReview=pending');
    expect(link.textContent).toBe('Pedidos enviados reembolsados desde Stripe que esperan motivo: verlos en Ventas →');
    expect(link.textContent).not.toMatch(/\d/);
  });
});
