import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import * as api from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
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

const FRONT_URL = 'https://bucket.example.com/kyc_ine/front.jpg?X-Amz-Signature=aaa';
const BACK_URL = 'https://bucket.example.com/kyc_ine/back.jpg?X-Amz-Signature=bbb';

function links(overrides: Partial<AdminIneLinksDTO> = {}): AdminIneLinksDTO {
  const expiresAt = new Date(Date.now() + 120_000).toISOString();
  return {
    userId: 'u-780',
    front: { url: FRONT_URL, expiresAt },
    back: { url: BACK_URL, expiresAt },
    expiresInSeconds: 120,
    ...overrides,
  };
}

function detail(overrides: Partial<AdminUserDetailDTO> = {}): AdminUserDetailDTO {
  return {
    id: 'u-780',
    email: 'jcsainz95@example.com',
    name: 'jcsainz95',
    role: 'customer',
    status: 'active',
    createdAt: '2026-09-02T11:05:00Z',
    nameSource: 'derived',
    phone: '3312345678',
    kycProfile: { kycStatus: 'pending', ineOnFile: true, clabeMasked: '****9087' },
    addresses: [
      {
        id: 'a1',
        recipientName: 'Juan Carlos Sainz',
        line1: 'Av. Vallarta 1500',
        city: 'Guadalajara',
        state: 'JAL',
        postalCode: '44160',
        country: 'MX',
        phone: '3312345678',
        isDefault: true,
      },
      {
        id: 'a2',
        recipientName: null,
        line1: 'Calle Morelos 22',
        city: 'Zapopan',
        state: 'JAL',
        postalCode: '45010',
        country: 'MX',
        phone: '3398765432',
        isDefault: false,
      },
    ],
    recentShipmentRecipients: [
      { shipmentId: 's1', recipientName: 'Marta Sainz', city: 'Guadalajara', state: 'JAL', createdAt: '2026-08-21T16:40:00Z' },
      { shipmentId: 's2', recipientName: null, city: 'CDMX', state: 'CDMX', createdAt: '2026-07-02T12:10:00Z' },
    ],
    ...overrides,
  };
}

let getDetail: ReturnType<typeof vi.spyOn>;
let getLinks: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
  window.sessionStorage.clear();
  getDetail = vi.spyOn(api, 'getAdminUser').mockResolvedValue(detail());
  getLinks = vi.spyOn(api, 'getAdminUserIneLinks').mockResolvedValue(links());
});

afterEach(() => {
  vi.useRealTimers();
});

/**
 * **P-78 · la pantalla de revisión** (DESIGN_SYSTEM §34 · contrato §M6-K). Los candados de
 * interfaz de §34.15 E1 que se pueden medir en unidad; los de servidor (K-1…K-10) son de backend.
 */
describe('KycReviewView · el documento, el cotejo y la decisión', () => {
  it('pinta las DOS caras con un `<img>` directo sobre el enlace firmado (⛔ sin proxy)', async () => {
    renderWithProviders(<KycReviewView userId="u-780" />, 'es');

    const front = (await screen.findByAltText('INE — frente de jcsainz95')) as HTMLImageElement;
    const back = screen.getByAltText('INE — reverso de jcsainz95') as HTMLImageElement;
    expect(front.getAttribute('src')).toBe(FRONT_URL);
    expect(back.getAttribute('src')).toBe(BACK_URL);
    // `object-contain`, jamás `cover`: recortar un documento esconde lo que se va a cotejar.
    expect(front.className).toMatch(/object-contain/);
    expect(front.className).not.toMatch(/object-cover/);
  });

  it('⛔ §34.14 · no se ofrece descargar, imprimir ni abrir en otra pestaña', async () => {
    const { container } = renderWithProviders(<KycReviewView userId="u-780" />, 'es');
    await screen.findByAltText('INE — frente de jcsainz95');

    expect(container.querySelector('[download]')).toBeNull();
    expect(container.querySelector('[target="_blank"]')).toBeNull();
    for (const a of Array.from(container.querySelectorAll('a'))) {
      expect(a.getAttribute('href')).not.toContain('X-Amz-Signature');
    }
    expect(container.textContent).not.toMatch(/descargar|imprimir/i);
  });

  it('el aviso de que el acceso queda registrado va ENCIMA del documento', async () => {
    const { container } = renderWithProviders(<KycReviewView userId="u-780" />, 'es');
    const privacy = await screen.findByText('Tu acceso a este documento queda registrado.');
    const img = await screen.findByAltText('INE — frente de jcsainz95');
    const order = privacy.compareDocumentPosition(img);
    // DOCUMENT_POSITION_FOLLOWING: la imagen viene DESPUÉS del aviso.
    expect(order & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.textContent).toContain('Tu acceso a este documento queda registrado.');
  });

  it('⛔ los enlaces firmados NO sobreviven a la pestaña: ni localStorage ni sessionStorage', async () => {
    renderWithProviders(<KycReviewView userId="u-780" />, 'es');
    await screen.findByAltText('INE — frente de jcsainz95');

    const dump = JSON.stringify({ ...window.localStorage, ...window.sessionStorage });
    expect(dump).not.toContain('X-Amz-Signature');
    expect(dump).not.toContain('kyc_ine');
  });

  it('el cotejo pone el nombre, las direcciones y los destinatarios — y NO dictamina', async () => {
    const { container } = renderWithProviders(<KycReviewView userId="u-780" />, 'es');
    await screen.findByAltText('INE — frente de jcsainz95');

    // Nombre FABRICADO del correo ⇒ aviso duro: cotejar contra él no cotejaría nada (P-73).
    expect(
      screen.getByText(/Este nombre lo fabricamos con su correo/),
    ).toBeInTheDocument();
    expect(screen.getByText('Recibe: Juan Carlos Sainz')).toBeInTheDocument();
    // Sin destinatario se dice; ⛔ jamás el `User.name` ni el `userId` en su lugar.
    expect(screen.getAllByText('Recibe: — Sin destinatario').length).toBeGreaterThan(0);
    expect(screen.getByText('Marta Sainz')).toBeInTheDocument();
    expect(container.textContent).not.toContain('u-780');
    // ⛔ Ningún veredicto automático de coincidencia (regla 7, H13).
    expect(container.textContent).not.toMatch(/coincide|no corresponde con el de la cuenta/i);
    // ⛔ Ningún dinero en esta pantalla (§34.2b).
    expect(container.textContent).not.toMatch(/MX\$/);
  });

  it('KY-6 · rechazar con un motivo de 2 caracteres: botón apagado y CERO peticiones', async () => {
    const patch = vi.spyOn(api, 'updateUserKyc');
    renderWithProviders(<KycReviewView userId="u-780" />, 'es');
    await screen.findByAltText('INE — frente de jcsainz95');

    fireEvent.click(screen.getByRole('button', { name: 'Rechazar' }));
    const dialog = await screen.findByRole('dialog', { name: 'Rechazar la identidad' });
    fireEvent.change(within(dialog).getByLabelText('Motivo que verá el cliente'), {
      target: { value: 'no' },
    });
    const confirm = within(dialog).getByRole('button', { name: 'Rechazar y avisar' });
    expect(confirm).toBeDisabled();
    fireEvent.click(confirm);
    expect(patch).not.toHaveBeenCalled();
  });

  it('un motivo sugerido escribe una FRASE COMPLETA y editable, y el rechazo la manda tal cual', async () => {
    const patch = vi.spyOn(api, 'updateUserKyc').mockResolvedValue(
      detail({ kycProfile: { kycStatus: 'rejected', ineOnFile: true, rejectionReason: 'La INE está vencida.', reviewedAt: '2026-09-11T18:00:00Z' } }),
    );
    renderWithProviders(<KycReviewView userId="u-780" />, 'es');
    await screen.findByAltText('INE — frente de jcsainz95');

    fireEvent.click(screen.getByRole('button', { name: 'Rechazar' }));
    const dialog = await screen.findByRole('dialog', { name: 'Rechazar la identidad' });
    // El formulario dice, EN SÍ MISMO, que el cliente lee el texto tal cual.
    expect(within(dialog).getByText(/El cliente lee este texto tal cual/)).toBeInTheDocument();

    fireEvent.click(within(dialog).getByLabelText('La INE está vencida.'));
    const field = within(dialog).getByLabelText('Motivo que verá el cliente') as HTMLTextAreaElement;
    expect(field.value).toBe('La INE está vencida.');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Rechazar y avisar' }));
    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith('u-780', {
        kycStatus: 'rejected',
        rejectionReason: 'La INE está vencida.',
      }),
    );

    // Tras decidir: NO se navega, el motivo queda a la vista y las imágenes SIGUEN en pantalla.
    expect(await screen.findByText(/Identidad rechazada el/)).toBeInTheDocument();
    expect(screen.getByText('«La INE está vencida.»')).toBeInTheDocument();
    expect(screen.getByAltText('INE — frente de jcsainz95')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Deshacer la decisión' })).toBeInTheDocument();
  });

  it('verificar pide confirmación y deja el resultado en la propia pantalla', async () => {
    const patch = vi.spyOn(api, 'updateUserKyc').mockResolvedValue(
      detail({ kycProfile: { kycStatus: 'verified', ineOnFile: true, verifiedAt: '2026-09-11T18:00:00Z' } }),
    );
    renderWithProviders(<KycReviewView userId="u-780" />, 'es');
    await screen.findByAltText('INE — frente de jcsainz95');

    fireEvent.click(screen.getByRole('button', { name: 'Verificar identidad' }));
    const dialog = await screen.findByRole('dialog', { name: '¿Verificar esta identidad?' });
    expect(within(dialog).getByText('Tu nombre y la hora quedan en la bitácora.')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Verificar' }));

    await waitFor(() => expect(patch).toHaveBeenCalledWith('u-780', { kycStatus: 'verified' }));
    expect(await screen.findByText(/Identidad verificada el/)).toBeInTheDocument();
    expect(screen.getByAltText('INE — frente de jcsainz95')).toBeInTheDocument();
  });

  it('`422 INE_NOT_ON_FILE` con una sola cara: lo dice, y NO pinta la barra de acciones', async () => {
    getLinks.mockRejectedValue(
      new ApiClientError(422, {
        code: 'INE_NOT_ON_FILE',
        message: 'no ine',
        details: { frontOnFile: true, backOnFile: false },
      }),
    );
    renderWithProviders(<KycReviewView userId="u-780" />, 'es');

    expect(await screen.findByText('Este usuario no tiene INE en el expediente')).toBeInTheDocument();
    expect(screen.getByText('Solo subió el frente.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Verificar identidad' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Rechazar' })).not.toBeInTheDocument();
  });

  it('`500 AUDIT_WRITE_FAILED` se rotula por lo que pasó (fallo cerrado), no como error genérico', async () => {
    getLinks.mockRejectedValue(
      new ApiClientError(500, { code: 'AUDIT_WRITE_FAILED', message: 'audit', details: {} }),
    );
    renderWithProviders(<KycReviewView userId="u-780" />, 'es');
    expect(
      await screen.findByText('No pudimos registrar tu acceso, así que no mostramos el documento. Reintenta.'),
    ).toBeInTheDocument();
  });

  it('`429`: lo dice contando por REVISOR y apaga el botón de volver a pedir', async () => {
    getLinks.mockRejectedValue(
      new ApiClientError(429, { code: 'TOO_MANY_REQUESTS', message: 'slow down', details: {} }),
    );
    renderWithProviders(<KycReviewView userId="u-780" />, 'es');
    // Aparece en el banner de la página y dentro de cada marco caído: los dos sitios donde el
    // revisor está mirando cuando el tope salta.
    expect((await screen.findAllByText(/El límite cuenta por revisor/)).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Volver a pedir el enlace' })[0]).toBeDisabled();
  });

  it('la ficha y los enlaces son DOS consultas: que falle el cotejo no tapa la INE', async () => {
    // Aquí al revés: la ficha responde y los enlaces fallan ⇒ el nombre sigue en pantalla.
    getLinks.mockRejectedValue(
      new ApiClientError(500, { code: 'INTERNAL', message: 'boom', details: {} }),
    );
    renderWithProviders(<KycReviewView userId="u-780" />, 'es');
    expect(await screen.findByRole('heading', { level: 1, name: 'jcsainz95' })).toBeInTheDocument();
    expect(screen.getAllByText('No se pudo cargar la imagen.').length).toBe(2);
  });

  it('`retry: false`: un fallo de enlaces NO se reintenta solo (un reintento = otra fila de bitácora)', async () => {
    getLinks.mockRejectedValue(
      new ApiClientError(500, { code: 'INTERNAL', message: 'boom', details: {} }),
    );
    renderWithProviders(<KycReviewView userId="u-780" />, 'es');
    await screen.findAllByText('No se pudo cargar la imagen.');
    await new Promise((r) => setTimeout(r, 300));
    expect(getLinks).toHaveBeenCalledTimes(1);
    expect(getDetail).toHaveBeenCalled();
  });
});
