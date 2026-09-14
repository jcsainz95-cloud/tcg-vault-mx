import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/render';
import * as api from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import type { IvaTransferPreviewDTO } from '@/types/contract';
import { IvaTransferSection } from './IvaTransferSection';

/**
 * ⭐ **Las tres filas son LAS DEL CONTRATO** (§M10-IVA.2, criterio 188) con `ivaRatePct = 16`,
 * `samplePriceCents = 10000` y los diales de Stripe vigentes. Se fijan aquí a mano —⛔ no se
 * calculan— porque el punto de la pantalla es **repetir lo que dijo el servidor**: un fixture que
 * las derivara probaría la aritmética del test, no la conducta de la pantalla.
 */
const POSITIONS = {
  100: { ivaTransferPct: 100, displayPriceCents: 11600, taxBaseCents: 10000, ivaCents: 1600, netRevenueCents: 10000, totalChargedCents: 12469 },
  50: { ivaTransferPct: 50, displayPriceCents: 10800, taxBaseCents: 9310, ivaCents: 1490, netRevenueCents: 9310, totalChargedCents: 11634 },
  0: { ivaTransferPct: 0, displayPriceCents: 10000, taxBaseCents: 8621, ivaCents: 1379, netRevenueCents: 8621, totalChargedCents: 10799 },
} as const;

function preview(proposed: 100 | 50 | 0): IvaTransferPreviewDTO {
  return {
    ivaRatePct: 16,
    samplePriceCents: 10000,
    current: { ...POSITIONS[100] },
    proposed: { ...POSITIONS[proposed] },
    netDeltaPerUnitCents: POSITIONS[proposed].netRevenueCents - POSITIONS[100].netRevenueCents,
  };
}

function servePreview() {
  return vi
    .spyOn(api, 'getIvaTransferPreview')
    .mockImplementation(async ({ ivaTransferPct }) => preview(ivaTransferPct as 100 | 50 | 0));
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('IvaTransferSection · criterio 213 (la puerta) y 188 (el acuse)', () => {
  it('adopta el valor VIGENTE que dice el servidor — ⛔ no lo supone ni lo hereda del seed', async () => {
    servePreview();
    renderWithProviders(<IvaTransferSection />, 'es');
    const campo = (await screen.findByLabelText(/Fracción trasladada/)) as HTMLInputElement;
    await waitFor(() => expect(campo.value).toBe('100'));
    // Sin cambio no hay nada que guardar: el `PUT` con el valor vigente es idempotente.
    expect(screen.getByRole('button', { name: /Guardar la fracción/ })).toBeDisabled();
  });

  it('⭐ DICE EL COSTO EN PESOS ANTES DE GUARDAR: 100 → 50 son MX$6.90 por pieza', async () => {
    servePreview();
    renderWithProviders(<IvaTransferSection />, 'es');
    const campo = (await screen.findByLabelText(/Fracción trasladada/)) as HTMLInputElement;
    await waitFor(() => expect(campo.value).toBe('100'));

    await userEvent.clear(campo);
    await userEvent.type(campo, '50');

    // La cifra literal del criterio 188, con su signo, **antes** de tocar el botón.
    await screen.findByText('−MX$6.90');
    // Y las dos posiciones enteras, que es lo que el admin sí puede ver (PROJECT §Q.5).
    expect(screen.getByText('MX$116.00')).toBeInTheDocument();
    expect(screen.getByText('MX$108.00')).toBeInTheDocument();
    expect(screen.getByText('MX$124.69')).toBeInTheDocument();
    expect(screen.getByText('MX$116.34')).toBeInTheDocument();
  });

  it('⭐⭐ el ACUSE que se manda es EL DEL PREVIEW, al centavo (⛔ no recompuesto)', async () => {
    servePreview();
    const put = vi
      .spyOn(api, 'updateIvaTransfer')
      .mockResolvedValue({ ivaTransferPct: 50, preview: preview(50) });

    renderWithProviders(<IvaTransferSection />, 'es');
    const campo = (await screen.findByLabelText(/Fracción trasladada/)) as HTMLInputElement;
    await waitFor(() => expect(campo.value).toBe('100'));
    await userEvent.clear(campo);
    await userEvent.type(campo, '50');
    await screen.findByText('−MX$6.90');

    const guardar = screen.getByRole('button', { name: /Guardar la fracción/ });
    await waitFor(() => expect(guardar).toBeEnabled());
    await userEvent.click(guardar);

    // Se inspecciona el PRIMER argumento: TanStack v5 le pasa un contexto como segundo, y
    // `toHaveBeenCalledWith` lo exigiría también — el candado quedaría atado a la librería.
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(put.mock.calls[0][0]).toEqual({
      ivaTransferPct: 50,
      acknowledgement: { samplePriceCents: 10000, previewedNetDeltaCents: -690 },
    });
  });

  it('⛔ NO SE PUEDE GUARDAR una posición que no está cotizada en pantalla', async () => {
    // El preview se queda colgado: el dueño ve el campo cambiado pero NO el costo.
    vi.spyOn(api, 'getIvaTransferPreview').mockImplementation(async ({ ivaTransferPct }) => {
      if (ivaTransferPct === 100) return preview(100);
      return new Promise<IvaTransferPreviewDTO>(() => {});
    });
    const put = vi.spyOn(api, 'updateIvaTransfer');

    renderWithProviders(<IvaTransferSection />, 'es');
    const campo = (await screen.findByLabelText(/Fracción trasladada/)) as HTMLInputElement;
    await waitFor(() => expect(campo.value).toBe('100'));
    await userEvent.clear(campo);
    await userEvent.type(campo, '0');

    // *Falla si el dial se puede guardar sin que esa cifra se haya mostrado* (criterio 188).
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Guardar la fracción/ })).toBeDisabled(),
    );
    expect(put).not.toHaveBeenCalled();
    // Y se dice POR QUÉ está apagado, en vez de dejarlo a adivinar.
    expect(screen.getByText(/Calculando el costo/)).toBeInTheDocument();
  });

  it('⛔ un decimal (`37.5`) ni sale de la pantalla: el dial es ENTERO', async () => {
    servePreview();
    const put = vi.spyOn(api, 'updateIvaTransfer');
    renderWithProviders(<IvaTransferSection />, 'es');
    const campo = (await screen.findByLabelText(/Fracción trasladada/)) as HTMLInputElement;
    await waitFor(() => expect(campo.value).toBe('100'));
    await userEvent.clear(campo);
    await userEvent.type(campo, '37.5');

    expect(await screen.findByText('Escribe un entero entre 0 y 100.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Guardar la fracción/ })).toBeDisabled();
    expect(put).not.toHaveBeenCalled();
  });

  it('`409 IVA_TRANSFER_ACK_STALE` NO reintenta solo: vuelve a mostrar el costo y espera', async () => {
    servePreview();
    const put = vi.spyOn(api, 'updateIvaTransfer').mockRejectedValue(
      new ApiClientError(409, {
        code: 'IVA_TRANSFER_ACK_STALE',
        message: 'stale',
        details: { expectedNetDeltaCents: -720 },
      }),
    );

    renderWithProviders(<IvaTransferSection />, 'es');
    const campo = (await screen.findByLabelText(/Fracción trasladada/)) as HTMLInputElement;
    await waitFor(() => expect(campo.value).toBe('100'));
    await userEvent.clear(campo);
    await userEvent.type(campo, '50');
    await screen.findByText('−MX$6.90');
    await userEvent.click(screen.getByRole('button', { name: /Guardar la fracción/ }));

    // Se le enseña la cifra NUEVA y se le dice que no se guardó nada. ⛔ Un reintento automático
    // guardaría con un número que el dueño no vio, que es justo lo que el acuse impide.
    expect(await screen.findByText(/El costo cambió mientras decidías/)).toBeInTheDocument();
    expect(screen.getByText(/−MX\$7\.20/)).toBeInTheDocument();
    expect(put).toHaveBeenCalledTimes(1);
  });

  it('cuando el servidor no devuelve cifras, pinta un estado VACÍO — ⛔ nunca una pantalla en blanco', async () => {
    // La clase de defecto que este proyecto ya se comió cuatro veces (M8, m10, m1, m2).
    // `null`, no `undefined`: un `200` con cuerpo vacío. (`undefined` lo rechaza TanStack como
    // error de la query, así que la rama de abajo nunca se alcanzaría y el candado sería falso.)
    vi.spyOn(api, 'getIvaTransferPreview').mockResolvedValue(null as unknown as IvaTransferPreviewDTO);
    renderWithProviders(<IvaTransferSection />, 'es');
    expect(await screen.findByText('Sin cifras para esta posición')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Guardar la fracción/ })).not.toBeInTheDocument();
  });
});

/**
 * ⭐⭐ **CRITERIO 209, POR LO NEGATIVO Y SOBRE EL CÓDIGO FUENTE.**
 *
 * *«`ivaTransferPct` no viaja a ninguna superficie de cliente. ⛔ Falla si aparece en un DTO
 * público, en un correo o en el HTML de una página de cliente.»* Que el cliente pueda leer qué
 * fracción absorbemos es **fuga comercial** de la misma clase que v2.1.6 cerró.
 *
 * Un candado sobre una pantalla concreta no sirve: el riesgo es **la pantalla que alguien escriba
 * mañana**. Éste barre `src/` entera y sólo tolera el dial en las rutas de back-office, en el
 * contrato tipado y en el simulador. Se pone rojo **el día que aparezca**, no cuando QA lo vea.
 */
describe('criterio 209 · `ivaTransferPct` sólo existe en superficie de admin', () => {
  const ROOT = join(process.cwd(), 'src');
  const PERMITIDAS = [
    // El back-office: es donde se toma la decisión de margen.
    'src/app/[locale]/(admin)/',
    // El tipo del contrato, que además documenta la prohibición.
    'src/types/contract.ts',
    // La capa de API y el servidor falso: hablan con `/admin/*`, no pintan nada.
    'src/lib/api.ts',
    'src/lib/mock/fixtures.ts',
    /*
     * ⭐ **El candado del criterio 196**, que tiene que nombrar el dial para moverlo y comprobar que
     * los precios del simulador se mueven con él. ⛔ Se lista **este fichero**, no `*.test.ts`
     * entero: un fixture de test que metiera el dial en un DTO de cliente **sería** la fuga que este
     * candado busca, y excluir todos los tests la dejaría pasar.
     */
    'src/lib/mock/iva-inclusive-mock.test.ts',
  ];

  function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const abs = join(dir, name);
      return statSync(abs).isDirectory() ? walk(abs) : [abs];
    });
  }

  it('ningún fichero fuera de las rutas de admin lo nombra', () => {
    const ofensores = walk(ROOT)
      .filter((abs) => /\.(ts|tsx)$/.test(abs))
      .map((abs) => abs.slice(process.cwd().length + 1))
      .filter((rel) => !PERMITIDAS.some((ok) => rel.startsWith(ok)))
      .filter((rel) => /ivaTransferPct/.test(readFileSync(join(process.cwd(), rel), 'utf8')));
    expect(ofensores).toEqual([]);
  });

  it('y el catálogo de copy sólo lo menciona bajo `admin.*` (criterio 209 en el texto)', () => {
    for (const loc of ['es', 'en']) {
      const raw = JSON.parse(readFileSync(join(process.cwd(), `messages/${loc}.json`), 'utf8'));
      const paths: string[] = [];
      const walkJson = (node: unknown, prefix: string) => {
        if (typeof node === 'string') {
          // Vocabulario del dial: la fracción trasladada / la traslación. En superficie de cliente
          // no tiene ningún uso legítimo (y §29 ya prohíbe ahí el vocabulario del traslado).
          if (/fracción trasladada|traslación del iva|fraction carried|iva carried/i.test(node)) {
            paths.push(prefix);
          }
          return;
        }
        if (node && typeof node === 'object') {
          for (const [k, v] of Object.entries(node)) walkJson(v, prefix ? `${prefix}.${k}` : k);
        }
      };
      walkJson(raw, '');
      // Si nadie lo menciona, el candado no verifica nada: la pantalla tiene que existir.
      expect(paths.length, `${loc}: nadie nombra el dial`).toBeGreaterThan(0);
      expect(paths.filter((p) => !p.startsWith('admin.')), loc).toEqual([]);
    }
  });
});
