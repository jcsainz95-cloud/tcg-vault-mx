import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import * as api from '@/lib/api';
import type { AdminUserDetailDTO, AdminIneLinksDTO } from '@/types/contract';
import { KycReviewView } from './KycReviewView';

vi.mock('@/i18n/navigation', () => ({
  usePathname: () => '/admin/m6/kyc/u-780',
  useRouter: () => ({ push: vi.fn() }),
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const DETAIL: AdminUserDetailDTO = {
  id: 'u-780',
  email: 'jcsainz95@example.com',
  name: 'jcsainz95',
  role: 'customer',
  status: 'active',
  createdAt: '2026-09-02T11:05:00Z',
  nameSource: 'derived',
  kycProfile: { kycStatus: 'pending', ineOnFile: true },
  addresses: [],
  recentShipmentRecipients: [],
};

/** Par de enlaces YA CADUCADO: es el estado en el que la re-petición tiene sentido. */
function expiredLinks(tag: string): AdminIneLinksDTO {
  const expiresAt = new Date(Date.now() - 1000).toISOString();
  return {
    userId: 'u-780',
    front: { url: `https://bucket.example.com/kyc_ine/front-${tag}.jpg?X-Amz-Signature=${tag}`, expiresAt },
    back: { url: `https://bucket.example.com/kyc_ine/back-${tag}.jpg?X-Amz-Signature=${tag}`, expiresAt },
    expiresInSeconds: 120,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api, 'getAdminUser').mockResolvedValue(DETAIL);
});

afterEach(() => {
  vi.useRealTimers();
});

/**
 * **KY-8 (DESIGN_SYSTEM §34.15 E1 · §34.3c.4).** Los dos requisitos difíciles de la caducidad, y
 * los dos son medibles:
 *
 * 1. ⛔ **Ninguna re-petición automática.** Cada emisión es **una fila de bitácora** y una de las
 *    **10 por minuto**: un refresco automático convertiría el registro de «quién miró» en ruido y
 *    podría dejar al revisor en `429` **sin haber pulsado nada**. Se mide con el contador de
 *    llamadas: **exactamente 1** en tres minutos de pantalla abierta, con foco perdido y
 *    recuperado por medio.
 * 2. ⭐ **Volver a pedir conserva el estado de lectura.** Zoom, encuadre, rotación y cara: reabrir
 *    el visor al 100 % después de dos minutos leyendo una CURP es hacerle repetir el trabajo.
 */
describe('KycReviewView · la caducidad de los enlaces (KY-8)', () => {
  it('⛔ en 3 minutos de pantalla abierta (con foco perdido y recuperado) hay UNA sola emisión', async () => {
    const getLinks = vi.spyOn(api, 'getAdminUserIneLinks').mockResolvedValue(expiredLinks('a'));
    renderWithProviders(<KycReviewView userId="u-780" />, 'es');
    await screen.findByAltText('INE — frente de jcsainz95');
    expect(getLinks).toHaveBeenCalledTimes(1);

    vi.useFakeTimers();
    for (let minute = 0; minute < 3; minute += 1) {
      // La pestaña se va y vuelve: el caso donde un `refetchOnWindowFocus` mordería.
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('focus'));
      window.dispatchEvent(new Event('online'));
      await vi.advanceTimersByTimeAsync(60_000);
    }
    vi.useRealTimers();

    expect(getLinks).toHaveBeenCalledTimes(1);
  });

  it('⭐ «Volver a pedir el enlace» NO cierra el visor y conserva zoom, rotación y cara', async () => {
    const getLinks = vi
      .spyOn(api, 'getAdminUserIneLinks')
      .mockResolvedValueOnce(expiredLinks('a'))
      .mockResolvedValueOnce(expiredLinks('b'));
    renderWithProviders(<KycReviewView userId="u-780" />, 'es');
    await screen.findByAltText('INE — frente de jcsainz95');

    // El revisor abre el visor, se pone a leer el reverso al 200 % y lo endereza.
    fireEvent.click(screen.getAllByRole('button', { name: 'Ampliar' })[0]);
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reverso' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Acercar' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Acercar' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Girar a la derecha' }));
    expect(within(dialog).getByText('200 %')).toBeInTheDocument();

    const imgIn = () => dialog.querySelector('img') as HTMLImageElement;
    expect(imgIn().getAttribute('src')).toContain('back-a');
    expect(imgIn().style.transform).toContain('rotate(90deg)');

    // …y el enlace, que ya venció, se cae al recargar el bitmap.
    fireEvent.error(imgIn());
    const request = await within(dialog).findByRole('button', { name: 'Volver a pedir el enlace' });
    fireEvent.click(request);

    await waitFor(() => expect(getLinks).toHaveBeenCalledTimes(2));
    // El visor SIGUE abierto, en la misma cara, con el mismo zoom y la misma rotación.
    expect(screen.getByRole('dialog')).toBe(dialog);
    await waitFor(() => expect(imgIn().getAttribute('src')).toContain('back-b'));
    expect(within(dialog).getByText('200 %')).toBeInTheDocument();
    expect(imgIn().style.transform).toContain('scale(2)');
    expect(imgIn().style.transform).toContain('rotate(90deg)');
  });

  it('pide LAS DOS CARAS en una sola llamada (dos filas de bitácora para un acto sería mentir)', async () => {
    const getLinks = vi.spyOn(api, 'getAdminUserIneLinks').mockResolvedValue(expiredLinks('a'));
    renderWithProviders(<KycReviewView userId="u-780" />, 'es');
    await screen.findByAltText('INE — frente de jcsainz95');
    expect(screen.getByAltText('INE — reverso de jcsainz95')).toBeInTheDocument();
    expect(getLinks).toHaveBeenCalledTimes(1);
    expect(getLinks).toHaveBeenCalledWith('u-780');
  });
});
