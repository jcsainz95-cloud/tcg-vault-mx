import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import * as api from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import { mockSettings } from '@/lib/mock/fixtures';
import es from '../../../../../../../messages/es.json';
import en from '../../../../../../../messages/en.json';
import { DirectShipSection } from './DirectShipSection';
import type { SettingsDTO } from '@/types/contract';

/**
 * API_CONTRACT §4-G.12 punto 3 (v1.109) · grupo «Envío a domicilio» de M10 (ENV-5, lado de la pantalla).
 * Lo que vigila: (1) las tres claves con sus valores en pesos; (2) cada campo dice «IVA incluido» (decisión del
 * dueño 2026-10-24: los tres son el importe final que ve el cliente; el retiro de bóveda sigue neto); (3) `PUT` parcial en centavos con SOLO lo tocado; (4) `422` por campo; (5) servidor
 * anterior a v1.109 ⇒ no se pintan campos como si existieran.
 */

vi.mock('@/i18n/navigation', () => ({
  usePathname: () => '/admin/m10',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const D = es.admin.m10.directShip;

function settings(over: Partial<SettingsDTO> = {}): SettingsDTO {
  return {
    ...mockSettings,
    directShipCardsFeeCents: 10000,
    directShipSealedFeeCents: 17500,
    directShipFreeFromCents: 400000,
    ...over,
  };
}

beforeEach(() => vi.restoreAllMocks());

describe('§4-G.12 · diales del envío a domicilio en M10', () => {
  it('pinta los tres diales en pesos, y CADA UNO dice «IVA incluido»', async () => {
    vi.spyOn(api, 'getSettings').mockResolvedValue(settings());
    renderWithProviders(<DirectShipSection />, 'es');
    const section = await screen.findByTestId('m10-direct-ship');
    const cardsFee = (await within(section).findByLabelText(D.labels.directShipCardsFeeCents)) as HTMLInputElement;
    const sealedFee = within(section).getByLabelText(D.labels.directShipSealedFeeCents) as HTMLInputElement;
    const freeFrom = within(section).getByLabelText(D.labels.directShipFreeFromCents) as HTMLInputElement;
    expect([cardsFee.value, sealedFee.value, freeFrom.value]).toEqual(['100', '175', '4000']);
    // La convención va PEGADA al campo (sufijo junto al número), no solo en la ayuda.
    const suffix = (input: HTMLElement) => input.parentElement!.textContent;
    for (const input of [cardsFee, sealedFee, freeFrom]) expect(suffix(input)).toContain(D.convention.gross);
    expect([cardsFee, sealedFee, freeFrom].map((i) => i.dataset.convention)).toEqual(['gross', 'gross', 'gross']);
    // …y la ayuda lo abre en negrita (sin depender del sufijo); nada dice «antes de IVA» salvo la nota del retiro.
    expect(within(section).getAllByText('IVA incluido:')).toHaveLength(3);
    expect(D.convention).toEqual({ gross: 'IVA incluido' });
    expect(within(section).getByText(D.withdrawalNote)).toBeInTheDocument();
  });

  it('PUT parcial en CENTAVOS con solo la clave tocada', async () => {
    vi.spyOn(api, 'getSettings').mockResolvedValue(settings());
    const put = vi.spyOn(api, 'updateSettings').mockResolvedValue(settings({ directShipFreeFromCents: 350000 }));
    renderWithProviders(<DirectShipSection />, 'es');
    const freeFrom = await screen.findByLabelText(D.labels.directShipFreeFromCents);
    fireEvent.change(freeFrom, { target: { value: '3,500' } });
    fireEvent.click(screen.getByTestId('m10-direct-ship-save'));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(put.mock.calls[0][0]).toEqual({ directShipFreeFromCents: 350000 });
  });

  // 💰 TL-R1 (techlead, release sobre 230b9bd3): `Number('')` daba 0 ⇒ vaciar un campo mandaba `PUT {…: 0}` y el
  // backend lo aceptaba: envío en MX$0 sin aviso. Vacío o no numérico ⇒ campo inválido, Guardar bloqueado, sin PUT.
  it.each([
    ['vacío', ''],
    ['solo espacios', '   '],
    ['no numérico', 'abc'],
  ])('campo %s ⇒ no hay PUT, el campo sale inválido y Guardar queda bloqueado', async (_name, value) => {
    vi.spyOn(api, 'getSettings').mockResolvedValue(settings());
    const put = vi.spyOn(api, 'updateSettings').mockResolvedValue(settings());
    renderWithProviders(<DirectShipSection />, 'es');
    const cardsFee = await screen.findByLabelText(D.labels.directShipCardsFeeCents);
    fireEvent.change(cardsFee, { target: { value } });
    expect(cardsFee).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText(D.invalid)).toBeInTheDocument();
    const save = screen.getByTestId('m10-direct-ship-save');
    expect(save).toBeDisabled();
    fireEvent.click(save);
    await new Promise((r) => setTimeout(r, 20));
    expect(put).not.toHaveBeenCalled();
    // Corregirlo lo desbloquea y viaja en centavos.
    fireEvent.change(cardsFee, { target: { value: '90' } });
    expect(cardsFee).not.toHaveAttribute('aria-invalid');
    fireEvent.click(screen.getByTestId('m10-direct-ship-save'));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(put.mock.calls[0][0]).toEqual({ directShipCardsFeeCents: 9000 });
  });

  it('volver a escribir el valor guardado no cuenta como cambio (botón apagado)', async () => {
    vi.spyOn(api, 'getSettings').mockResolvedValue(settings());
    renderWithProviders(<DirectShipSection />, 'es');
    const cardsFee = await screen.findByLabelText(D.labels.directShipCardsFeeCents);
    fireEvent.change(cardsFee, { target: { value: '120' } });
    expect(screen.getByTestId('m10-direct-ship-save')).toBeEnabled();
    fireEvent.change(cardsFee, { target: { value: '100' } });
    expect(screen.getByTestId('m10-direct-ship-save')).toBeDisabled();
  });

  it('422 VALIDATION_ERROR por clave ⇒ el campo se marca y el aviso dice que no se guardó nada', async () => {
    vi.spyOn(api, 'getSettings').mockResolvedValue(settings());
    vi.spyOn(api, 'updateSettings').mockRejectedValue(
      new ApiClientError(422, {
        code: 'VALIDATION_ERROR',
        message: 'invalid',
        details: { errors: { directShipFreeFromCents: 'must be 1..MAX_CENTS' } },
      }),
    );
    renderWithProviders(<DirectShipSection />, 'es');
    const freeFrom = await screen.findByLabelText(D.labels.directShipFreeFromCents);
    fireEvent.change(freeFrom, { target: { value: '0' } });
    fireEvent.click(screen.getByTestId('m10-direct-ship-save'));
    expect(await screen.findByRole('alert')).toHaveTextContent(D.checkFields);
    expect(freeFrom).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText(D.labels.directShipCardsFeeCents)).not.toHaveAttribute('aria-invalid');
  });

  it('servidor anterior a v1.109 (sin las claves) ⇒ sin campos, con el aviso', async () => {
    const old = { ...settings() } as Partial<SettingsDTO>;
    delete old.directShipCardsFeeCents;
    delete old.directShipSealedFeeCents;
    delete old.directShipFreeFromCents;
    vi.spyOn(api, 'getSettings').mockResolvedValue(old as SettingsDTO);
    renderWithProviders(<DirectShipSection />, 'es');
    expect(await screen.findByText(D.unavailable)).toBeInTheDocument();
    expect(screen.queryByLabelText(D.labels.directShipCardsFeeCents)).not.toBeInTheDocument();
  });

  it('en inglés también «VAT included» en cada campo', async () => {
    vi.spyOn(api, 'getSettings').mockResolvedValue(settings());
    renderWithProviders(<DirectShipSection />, 'en');
    const E = en.admin.m10.directShip;
    const freeFrom = await screen.findByLabelText(E.labels.directShipFreeFromCents);
    expect(freeFrom.parentElement!.textContent).toContain(E.convention.gross);
    expect(screen.getByLabelText(E.labels.directShipCardsFeeCents).parentElement!.textContent).toContain(E.convention.gross);
  });
});
