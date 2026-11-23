import { describe, it, expect, vi, beforeEach } from 'vitest';

const redirect = vi.hoisted(() => vi.fn()); // en Next lanza; aquí basta con registrar la llamada
vi.mock('@/i18n/navigation', () => ({ redirect }));

import M9Page from './page';

/** §REPORTES-CEO F1: las rutas guardadas de las pestañas retiradas no dan 404; redirigen conservando el idioma. */
beforeEach(() => redirect.mockClear());

describe('/admin/m9 · enlaces guardados de las pestañas que ya no existen', () => {
  it('?tab=actividad → Finanzas', async () => {
    await M9Page({ params: Promise.resolve({ locale: 'en' }), searchParams: Promise.resolve({ tab: 'actividad' }) });
    expect(redirect).toHaveBeenCalledWith({ href: '/admin/m7', locale: 'en' });
  });

  it('?tab=compra → Inventario › Qué reponer, conservando el orden elegido', async () => {
    await M9Page({ params: Promise.resolve({ locale: 'es' }), searchParams: Promise.resolve({ tab: 'compra', sort: 'margin', dir: 'asc' }) });
    expect(redirect).toHaveBeenCalledWith({ href: '/admin/reportes/inventario?sort=margin&dir=asc#reponer', locale: 'es' });
  });

  it('sin tab (o ?tab=ventas) no redirige: es la pantalla de Ventas', async () => {
    await M9Page({ params: Promise.resolve({ locale: 'es' }), searchParams: Promise.resolve({ tab: 'ventas' }) });
    expect(redirect).not.toHaveBeenCalled();
  });
});
