import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MeasurementContext, INACTIVE, type MeasurementContextValue } from '@/components/consent/measurement-context';
import { SITE_NOTICE, SITE_NOTICE_STORAGE_KEY, siteNoticeActive, siteNoticeExcluded } from '@/lib/site-notice';
import es from '../../../messages/es.json';

let pathname = '/';
vi.mock('@/i18n/navigation', () => ({ usePathname: () => pathname }));
import { SiteNotice } from './SiteNotice';

const t = es.siteNotice;
function mount(m: Partial<MeasurementContextValue> = {}) {
  return render(
    <MeasurementContext.Provider value={{ ...INACTIVE, ...m }}>
      <button>antes</button>
      <SiteNotice title={t.title} body={t.body} dismiss={t.dismiss} close={t.close} />
    </MeasurementContext.Provider>,
  );
}

beforeEach(() => {
  pathname = '/';
  window.localStorage.clear();
});
afterEach(() => vi.restoreAllMocks());

describe('SiteNotice (aviso emergente 2026-11-17)', () => {
  it('texto literal aprobado y diálogo accesible (nombre, descripción, aria-modal)', async () => {
    mount();
    const dlg = await screen.findByRole('dialog');
    expect(dlg).toHaveAttribute('aria-modal', 'true');
    expect(dlg).toHaveAccessibleName('¡Gracias por sus compras!');
    expect(dlg).toHaveAccessibleDescription(
      'Estamos muy emocionados por todos los pedidos que hemos recibido. Debido a la alta demanda, las entregas pueden tardar hasta 10 días hábiles más de lo normal. Gracias por tu paciencia.',
    );
    expect(dlg.textContent).not.toMatch(/IVA|MX\$/);
  });

  it('«Entendido» lo cierra y no vuelve a salir (localStorage)', async () => {
    const { unmount } = mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Entendido' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(window.localStorage.getItem(SITE_NOTICE_STORAGE_KEY)).toBe('1');
    unmount();
    mount();
    await act(async () => {});
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('la X y Esc también lo cierran', async () => {
    const { unmount } = mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Cerrar aviso' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    unmount();
    window.localStorage.clear();
    mount();
    await screen.findByRole('dialog');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('foco dentro: arranca en «Entendido» y Tab/Shift+Tab no salen del diálogo', async () => {
    mount();
    const dismiss = await screen.findByRole('button', { name: 'Entendido' });
    const close = screen.getByRole('button', { name: 'Cerrar aviso' });
    expect(dismiss).toHaveFocus();
    await userEvent.tab();
    expect(close).toHaveFocus();
    await userEvent.tab({ shift: true });
    expect(dismiss).toHaveFocus();
    await userEvent.tab({ shift: true });
    expect(close).toHaveFocus();
    expect(screen.getByRole('button', { name: 'antes' })).not.toHaveFocus();
  });

  it('si localStorage falla, sale y se puede cerrar igual', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Entendido' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('espera al banner de cookies: sin responder no sale; al responder, sale', async () => {
    const { rerender } = mount({ active: true, consent: null, bannerVisible: true });
    await act(async () => {});
    expect(screen.queryByRole('dialog')).toBeNull();
    rerender(
      <MeasurementContext.Provider value={{ ...INACTIVE, active: true, consent: { analytics: false, ads: false } as never, bannerVisible: false }}>
        <SiteNotice title={t.title} body={t.body} dismiss={t.dismiss} close={t.close} />
      </MeasurementContext.Provider>,
    );
    expect(await screen.findByRole('dialog')).toBeTruthy();
  });

  it.each(['/checkout', '/checkout/pago', '/compra'])('no sale en el pago (%s)', async (p) => {
    pathname = p;
    mount();
    await act(async () => {});
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('fecha de fin y bandera: se apaga sola y con enabled:false', () => {
    expect(siteNoticeActive(new Date('2026-11-17T18:00:00Z'))).toBe(true);
    expect(siteNoticeActive(new Date(`${SITE_NOTICE.endsOn}T23:00:00-06:00`))).toBe(true);
    expect(siteNoticeActive(new Date('2026-12-02T12:00:00Z'))).toBe(false);
    expect(siteNoticeActive(new Date('2026-11-17T18:00:00Z'), { ...SITE_NOTICE, enabled: false })).toBe(false);
    expect(siteNoticeExcluded('/catalog')).toBe(false);
    expect(siteNoticeExcluded('/checkout/x')).toBe(true);
  });
});
