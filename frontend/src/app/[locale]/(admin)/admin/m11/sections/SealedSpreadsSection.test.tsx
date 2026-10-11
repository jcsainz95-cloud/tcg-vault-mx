import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/render';
import { SealedSpreadsSection } from './SealedSpreadsSection';
import { SEALED_SUBTYPES } from '@/types/contract';
import * as api from '@/lib/api';

/**
 * T-1 (techlead) + corrección del arquitecto (contrato v2.1.9 §M2).
 *
 * Lo que se rompió y por qué importa: el dueño **vende UPC**, el backend acepta calibrarle spread
 * (`PUT …/sealed-spreads {upc:20}` → 200) y aun así **no había forma de ponerle precio con el
 * ratón**, porque esta pantalla pinta UNA FILA POR ELEMENTO de una lista que estaba escrita a mano
 * con cinco valores. Arreglar la lista no basta: el `GET` devuelve un mapa **PARCIAL** (omite lo no
 * configurado) y `upc`/`collection` **no tienen semilla**, así que derivar los renglones de la
 * respuesta reproduce el mismo hueco por otra puerta.
 *
 * Estos tests fijan las dos mitades:
 *   (a) los renglones salen del ENUM (siete), pase lo que pase en la respuesta;
 *   (b) una llave ausente se pinta «usa el global», no un vacío mudo ni un 0 (ausente ≠ 0%).
 */

// El GET del servidor: mapa PARCIAL, exactamente como lo describe el contrato (sin upc/collection).
const PARTIAL_SPREADS = {
  spreadPctBySubtype: { box: 18, etb: 22, bundle: 25, tin: 30, blister: 35 },
  fallbackPct: 25,
};

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api, 'getSealedSpreads').mockResolvedValue({ ...PARTIAL_SPREADS });
});

describe('SealedSpreadsSection · una fila por valor del enum (T-1)', () => {
  it('pinta las SIETE presentaciones aunque el GET solo traiga cinco llaves', async () => {
    renderWithProviders(<SealedSpreadsSection />, 'es');
    // Etiquetas legibles de i18n (`status.sealedSubtype.*`), una por valor del enum.
    const labels: Record<string, string> = {
      upc: 'UPC',
      etb: 'ETB',
      box: 'Booster Box',
      bundle: 'Bundle',
      tin: 'Tin',
      blister: 'Blister',
      collection: 'Collection',
    };
    for (const sub of SEALED_SUBTYPES) {
      expect(
        await screen.findByLabelText(`Spread de ${labels[sub]}`),
        `falta la fila editable de ${sub}`,
      ).toBeInTheDocument();
    }
  });

  it('la fila SIN regla propia (upc) queda vacía y DICE que cae al global', async () => {
    renderWithProviders(<SealedSpreadsSection />, 'es');
    const upc = await screen.findByLabelText('Spread de UPC');
    // Vacía: el global va de marca de agua, NO pintado como si fuera su valor.
    expect(upc).toHaveValue('');
    expect(upc).toHaveAttribute('placeholder', '25');
    // Y se enuncia: el dueño tiene que VER que está cayendo al fallback.
    expect(screen.getAllByText('Usa el global (25%)').length).toBeGreaterThan(0);
  });

  it('la fila CON regla propia muestra su valor y no dice «usa el global»', async () => {
    renderWithProviders(<SealedSpreadsSection />, 'es');
    expect(await screen.findByLabelText('Spread de Booster Box')).toHaveValue('18');
    // Solo upc y collection carecen de regla ⇒ exactamente dos etiquetas de fallback.
    expect(screen.getAllByText('Usa el global (25%)')).toHaveLength(2);
  });

  it('escribir en UPC manda SOLO esa llave (el dueño YA puede calibrar lo que vende)', async () => {
    const put = vi
      .spyOn(api, 'updateSealedSpreads')
      .mockResolvedValue({ spreadPctBySubtype: { ...PARTIAL_SPREADS.spreadPctBySubtype, upc: 20 }, fallbackPct: 25 });
    renderWithProviders(<SealedSpreadsSection />, 'es');
    const upc = await screen.findByLabelText('Spread de UPC');
    await userEvent.type(upc, '20');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    // PARCIAL: solo la llave tocada. Reenviar el mapa completo es la forma que el contrato
    // descartó — un cliente rancio borraría en silencio lo que no conoce.
    expect(put).toHaveBeenCalledWith({ spreadPctBySubtype: { upc: 20 } });
  });

  it('money-safe: VACIAR una fila manda `null` (retira la regla), JAMÁS 0', async () => {
    const put = vi.spyOn(api, 'updateSealedSpreads').mockResolvedValue({
      spreadPctBySubtype: { etb: 22, bundle: 25, tin: 30, blister: 35 },
      fallbackPct: 25,
    });
    renderWithProviders(<SealedSpreadsSection />, 'es');
    await userEvent.clear(await screen.findByLabelText('Spread de Booster Box'));
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(put).toHaveBeenCalledWith({ spreadPctBySubtype: { box: null } });
    // Y `null` no es 0: el 0 vendería al costo, el null devuelve la presentación al global.
    const [[payload]] = put.mock.calls;
    expect(payload.spreadPctBySubtype!.box).not.toBe(0);
  });

  it('un 0 EXPLÍCITO sí se guarda como 0: es un spread legítimo (vender al mercado)', async () => {
    const put = vi.spyOn(api, 'updateSealedSpreads').mockResolvedValue({ ...PARTIAL_SPREADS });
    renderWithProviders(<SealedSpreadsSection />, 'es');
    const box = await screen.findByLabelText('Spread de Booster Box');
    await userEvent.clear(box);
    await userEvent.type(box, '0');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(put).toHaveBeenCalledWith({ spreadPctBySubtype: { box: 0 } });
  });

  it('vaciar una fila que NUNCA tuvo regla propia no manda nada que retirar', async () => {
    const put = vi.spyOn(api, 'updateSealedSpreads').mockResolvedValue({ ...PARTIAL_SPREADS });
    renderWithProviders(<SealedSpreadsSection />, 'es');
    const upc = await screen.findByLabelText('Spread de UPC');
    await userEvent.type(upc, '5');
    await userEvent.clear(upc);
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(put).not.toHaveBeenCalled();
  });

  it('una fila VACIADA se previsualiza como «usa el global» (no como 0%)', async () => {
    renderWithProviders(<SealedSpreadsSection />, 'es');
    await userEvent.clear(await screen.findByLabelText('Spread de Booster Box'));
    // upc + collection (sin regla) + box (vaciada) = tres.
    expect(screen.getAllByText('Usa el global (25%)')).toHaveLength(3);
    expect(screen.queryByText('Sin margen')).toBeNull();
  });

  it('el GLOBAL no se puede vaciar: se impide el guardado y se explica', async () => {
    const put = vi.spyOn(api, 'updateSealedSpreads').mockResolvedValue({ ...PARTIAL_SPREADS });
    renderWithProviders(<SealedSpreadsSection />, 'es');
    await userEvent.clear(await screen.findByLabelText('Spread global'));
    expect(screen.getByText(/El spread global no se puede quitar/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeDisabled();
    expect(put).not.toHaveBeenCalled();
    // Y las filas sin regla siguen anunciando el global del SERVIDOR, no un vacío.
    expect(screen.getAllByText('Usa el global (25%)').length).toBeGreaterThan(0);
  });

  it('el hueco→global NO dispara la alarma de «spread 0%» (ausente ≠ 0)', async () => {
    renderWithProviders(<SealedSpreadsSection />, 'es');
    await screen.findByLabelText('Spread de UPC');
    expect(screen.queryByText(/vende al costo de mercado/)).toBeNull();
  });

  it('un 0% EXPLÍCITO sí advierte por fila y con el banner money-safe', async () => {
    vi.spyOn(api, 'getSealedSpreads').mockResolvedValue({
      spreadPctBySubtype: { ...PARTIAL_SPREADS.spreadPctBySubtype, blister: 0 },
      fallbackPct: 25,
    });
    renderWithProviders(<SealedSpreadsSection />, 'es');
    const blisterRow = (await screen.findByLabelText('Spread de Blister')).closest('li')!;
    expect(within(blisterRow).getByText('Sin margen')).toBeInTheDocument();
    expect(screen.getByText(/vende al costo de mercado/)).toBeInTheDocument();
  });
});
