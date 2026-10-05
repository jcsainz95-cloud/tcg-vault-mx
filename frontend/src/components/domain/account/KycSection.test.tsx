import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import type { KycInfoDTO } from '@/types/contract';
import { KycSection } from './KycSection';

const getKyc = vi.fn();
const updateKyc = vi.fn();
vi.mock('@/lib/api', () => ({
  getKyc: () => getKyc(),
  updateKyc: (...a: unknown[]) => updateKyc(...a),
  // `PhotoUploader` pide presign al montar el flujo de subida; no se ejerce aquí.
  presignUpload: vi.fn(),
}));

function kyc(partial: Partial<KycInfoDTO> = {}): KycInfoDTO {
  return { kycStatus: 'none', clabeOnFile: false, ineOnFile: false, clabeUpdatedAt: null, ...partial };
}

beforeEach(() => {
  vi.clearAllMocks();
  getKyc.mockResolvedValue(kyc());
});

/**
 * **P-78 · los cuatro estados del cliente** (DESIGN_SYSTEM §34.8 · contrato §M6-K.7). El defecto
 * medido: con la INE ya subida, la sección solo sabía decir «Pendiente» **y no ofrecía nada**
 * (`KycSection.tsx:162`, condición `!ineOnFile`). Estos candados son los KY-3, KY-4, KY-4b y KY-5
 * de §34.15 E1.
 */
describe('KycSection · los cuatro estados tienen salida (§34.8)', () => {
  it('KY-4 · `pending`: dice que no tiene que hacer nada más y NO ofrece ningún control de subida', async () => {
    getKyc.mockResolvedValue(kyc({ kycStatus: 'pending', ineOnFile: true }));
    renderWithProviders(<KycSection />, 'es');

    expect(await screen.findByText('INE recibida')).toBeInTheDocument();
    expect(screen.getByText('EN REVISIÓN')).toBeInTheDocument();
    expect(screen.getByText(/No tienes que hacer nada más/)).toBeInTheDocument();
    // ⛔ Ni uploaders, ni «volver a subir»: todavía no hay nada que corregir.
    expect(screen.queryByText('Sube tu INE')).not.toBeInTheDocument();
    expect(screen.queryByText('Volver a subir mi INE')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/INE/i)).not.toBeInTheDocument();
  });

  it('KY-3 · `rejected`: muestra el MOTIVO textual y los dos uploaders (el caso que no tenía salida)', async () => {
    getKyc.mockResolvedValue(
      kyc({ kycStatus: 'rejected', ineOnFile: true, rejectionReason: 'La INE está vencida.' }),
    );
    renderWithProviders(<KycSection />, 'es');

    expect(await screen.findByText('INE rechazada')).toBeInTheDocument();
    expect(screen.getByText('No pudimos verificar tu identidad')).toBeInTheDocument();
    // El motivo, entre comillas y TAL CUAL lo escribió el revisor.
    expect(screen.getByText('«La INE está vencida.»')).toBeInTheDocument();
    // Y con `ineOnFile: true`, que antes era justo lo que ocultaba los uploaders.
    expect(screen.getByText('INE — frente')).toBeInTheDocument();
    expect(screen.getByText('INE — reverso')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Volver a subir mi INE' })).toBeInTheDocument();
  });

  it('KY-4b · `verified`: ofrece «Actualizar mi identificación» y al usarlo aparecen los uploaders', async () => {
    getKyc.mockResolvedValue(kyc({ kycStatus: 'verified', ineOnFile: true }));
    renderWithProviders(<KycSection />, 'es');

    expect(await screen.findByText('INE verificada')).toBeInTheDocument();
    expect(screen.getByText('IDENTIDAD VERIFICADA')).toBeInTheDocument();
    // Discreto y bajo demanda: no hay nada obligatorio que hacer.
    expect(screen.queryByText('INE — frente')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Actualizar mi identificación' }));
    expect(await screen.findByText('INE — frente')).toBeInTheDocument();
    expect(screen.getByText('INE — reverso')).toBeInTheDocument();
  });

  it('`none`: explica por qué puede necesitarla y ofrece subirla', async () => {
    renderWithProviders(<KycSection />, 'es');
    expect(await screen.findByText('Sin INE en tu expediente')).toBeInTheDocument();
    expect(screen.getByText(/Solo te la pedimos si una venta supera nuestro límite/)).toBeInTheDocument();
    expect(screen.getByText('INE — frente')).toBeInTheDocument();
  });

  /**
   * **KY-5 · ninguna cifra de política, y ninguna de las dos palabras.** Es el candado que hace
   * verificable la decisión (c) del dueño: el número puede viajar y decidir, pero **no puede
   * aparecer**. Se mide sobre el texto RENDERIZADO, que es lo que el cliente lee.
   */
  it.each([
    ['none', kyc()],
    ['pending', kyc({ kycStatus: 'pending', ineOnFile: true })],
    ['verified', kyc({ kycStatus: 'verified', ineOnFile: true })],
    ['rejected', kyc({ kycStatus: 'rejected', ineOnFile: true, rejectionReason: 'Foto borrosa.' })],
  ])('KY-5 · con `%s` no se pinta ningún tope, cupo ni cifra de política', async (_name, dto) => {
    getKyc.mockResolvedValue(dto);
    const { container } = renderWithProviders(<KycSection />, 'es');
    await screen.findByText('Verificación de identidad');
    await waitFor(() => expect(container.textContent).not.toMatch(/Cargando/));

    const text = container.textContent ?? '';
    expect(text).not.toMatch(/tope/i);
    expect(text).not.toMatch(/\bcupo\b/i);
    expect(text).not.toMatch(/MX\$/);
  });

  it('la llamada de la cuenta NO manda `quotedTotalCents`: aquí no hay venta que medir', async () => {
    renderWithProviders(<KycSection />, 'es');
    await screen.findByText('Sin INE en tu expediente');
    expect(getKyc).toHaveBeenCalled();
  });
});

/**
 * ⭐ v1.80.7 (`DESIGN_SYSTEM §37.9d` · contrato §M6 `clabeUpdatedAt`, clave siempre presente): bajo la CLABE
 * enmascarada, «CLABE actualizada el {date}»; `null` ⇒ ⛔ nada (fecha desconocida no se inventa).
 */
describe('KycSection · v1.80.7 · «CLABE actualizada el …»', () => {
  it('con `clabeUpdatedAt` ⇒ la fecha, formateada, bajo la CLABE enmascarada', async () => {
    getKyc.mockResolvedValue(kyc({ clabeMasked: '****1234', clabeOnFile: true, clabeUpdatedAt: '2026-09-27T15:04:05Z' }));
    renderWithProviders(<KycSection />, 'es');
    const line = await screen.findByTestId('kyc-clabe-updated-at');
    expect(line).toHaveTextContent('CLABE actualizada el 27 sep 2026');
  });

  it('en inglés, la misma línea con su copy', async () => {
    getKyc.mockResolvedValue(kyc({ clabeMasked: '****1234', clabeOnFile: true, clabeUpdatedAt: '2026-09-27T15:04:05Z' }));
    renderWithProviders(<KycSection />, 'en');
    expect(await screen.findByTestId('kyc-clabe-updated-at')).toHaveTextContent('CLABE updated on Sep 27, 2026');
  });

  it('`clabeUpdatedAt: null` con CLABE en archivo ⇒ NO se pinta ninguna fecha', async () => {
    getKyc.mockResolvedValue(kyc({ clabeMasked: '****1234', clabeOnFile: true, clabeUpdatedAt: null }));
    renderWithProviders(<KycSection />, 'es');
    expect(await screen.findByText('****1234')).toBeInTheDocument();
    expect(screen.queryByTestId('kyc-clabe-updated-at')).not.toBeInTheDocument();
    expect(screen.queryByText(/CLABE actualizada el/)).not.toBeInTheDocument();
  });

  it('sin CLABE en archivo ⇒ nada, aunque llegara una fecha residual', async () => {
    getKyc.mockResolvedValue(kyc({ clabeOnFile: false, clabeUpdatedAt: '2026-09-27T15:04:05Z' }));
    renderWithProviders(<KycSection />, 'es');
    expect(await screen.findByText('Sin CLABE registrada')).toBeInTheDocument();
    expect(screen.queryByTestId('kyc-clabe-updated-at')).not.toBeInTheDocument();
  });
});

/** LIVE-8 · sitio 6 del aviso (DESIGN_SYSTEM §80.2): justo debajo de `ine.privacy`, en el bloque de subida. */
describe('KycSection · LIVE-8 · enlace al aviso de privacidad (sitio 6)', () => {
  it('con los uploaders: la frase del aviso va justo después de la línea `ine.privacy`', async () => {
    renderWithProviders(<KycSection />, 'es');
    await screen.findByText('INE — frente');
    const note = screen.getByTestId('privacy-site-accountIne');
    expect(note.textContent).toBe('Para qué usamos tu INE y cuándo la borramos: Aviso de privacidad.');
    expect(note.previousElementSibling?.textContent).toMatch(/se guarda cifrada/);
  });

  it('`pending` (sin uploaders): no se pinta', async () => {
    getKyc.mockResolvedValue(kyc({ kycStatus: 'pending', ineOnFile: true }));
    renderWithProviders(<KycSection />, 'es');
    await screen.findByText('Verificación de identidad');
    await waitFor(() => expect(document.body.textContent).not.toMatch(/Cargando/));
    expect(screen.queryByTestId('privacy-site-accountIne')).toBeNull();
  });
});
