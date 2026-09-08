import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { AdminBuylistDTO, SellRequestDTO, SellRequestStatus } from './contract';
import { getBadgeSpec } from '@/lib/status-map';
import es from '../../messages/es.json';
import en from '../../messages/en.json';

/**
 * Candado anti-desincronización de `SellRequestStatus` y del **set terminal** (M-46 · v1.51).
 *
 * ### Qué pasó
 * El enum del contrato creció en CUATRO valores (`ofertada`, `aceptada`, `en_transito`,
 * `expirada`) y los terminales pasaron de **tres a cuatro** (`PROJECT.md` §P.1, criterio 113).
 * ARCHITECTURE §4.39(c) contó **NUEVE** listas de literales que codifican a mano un subconjunto
 * de ese enum y que **ninguna falla en compilación** —todas viven dentro de un `in`/`notIn`/
 * `includes`—. La novena era del frontend: `M5View.tsx`, `REQUEST_TERMINAL`, la **quinta copia
 * del set terminal** y la única fuera del backend.
 *
 * Sus dos daños eran distintos y los dos silenciosos:
 *  1. **Ofrecía acciones imposibles.** `canRejectRequest` daba `true` sobre una solicitud
 *     `expirada` ⇒ un botón que el servidor contesta con **409**.
 *  2. **Desaparecía estados.** Un status que no esté en ninguna pestaña de M5 no sale en ninguna
 *     vista: no falla, no avisa, nadie lo ve nunca.
 *
 * ### Qué fija este archivo
 * El remedio del contrato NO fue mover la copia de archivo: fue **eliminar la necesidad de la
 * copia** — el servidor manda `isTerminal` derivado server-side en las dos proyecciones. Estos
 * tests fijan las cuatro propiedades que impiden que la copia vuelva:
 *  1. la unión del front cubre **exactamente** el enum del contrato (§Enums);
 *  2. `isTerminal` es **obligatorio** en los dos DTOs (si se volviera opcional, cada consumidor
 *     escribiría un `?? <adivinanza local>` y la copia regresaría disfrazada de default);
 *  3. los ONCE estados tienen rótulo en **ambos** catálogos y badge propio;
 *  4. **nadie declara una segunda lista literal de estados** fuera de `contract.ts`.
 */

/**
 * Valores del contrato `docs/API_CONTRACT.md` §Enums, línea `SellRequestStatus = …`, en el orden
 * del pipeline feliz. Se escriben a mano A PROPÓSITO: son el espejo del DOCUMENTO contra el que
 * se compara el código. Si el arquitecto agrega un estado, este test es el que obliga a
 * propagarlo.
 */
const CONTRACT_SELL_REQUEST_STATUSES = [
  'cotizada',
  'ofertada',
  'aceptada',
  'en_transito',
  'recibida',
  'verificacion',
  'aprobada',
  'pagada',
  'rechazada',
  'abandonada',
  'expirada',
] as const;

/**
 * Candado de TIPO (falla en `tsc`, no solo en runtime): estas dos asignaciones solo compilan si
 * la unión `SellRequestStatus` y la lista del contrato son el MISMO conjunto. Si alguien borra un
 * valor de la unión, la primera deja de compilar; si agrega uno que el contrato no tiene, falla
 * la segunda.
 */
const _unionCoversContract: SellRequestStatus =
  null as unknown as (typeof CONTRACT_SELL_REQUEST_STATUSES)[number];
const _contractCoversUnion: (typeof CONTRACT_SELL_REQUEST_STATUSES)[number] =
  null as unknown as SellRequestStatus;
void _unionCoversContract;
void _contractCoversUnion;

/**
 * Candado de TIPO sobre `isTerminal`: si dejara de ser obligatorio, su tipo pasaría a
 * `boolean | undefined` y estas dos asignaciones **no compilarían** bajo `strict`. Es la mitad
 * estática de la propiedad 2; la dinámica no existe (un campo opcional no se puede «probar»).
 */
const _adminFlagIsRequired: boolean = null as unknown as AdminBuylistDTO['isTerminal'];
const _clientFlagIsRequired: boolean = null as unknown as SellRequestDTO['isTerminal'];
void _adminFlagIsRequired;
void _clientFlagIsRequired;

/** Camina un objeto de mensajes y devuelve sus rutas de clave (`a.b.c`). */
function keyPaths(obj: unknown, prefix = ''): string[] {
  if (typeof obj !== 'object' || obj === null) return [prefix];
  return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) =>
    keyPaths(v, prefix ? `${prefix}.${k}` : k),
  );
}

/** Todos los `.ts`/`.tsx` bajo `src/`, sin `node_modules`. */
function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.next') continue;
      sourceFiles(full, acc);
    } else if (/\.tsx?$/.test(entry.name)) {
      acc.push(full);
    }
  }
  return acc;
}

describe('SellRequestStatus — un solo enum, y CERO copias del set terminal (M-46 §4.39c)', () => {
  it('la unión cubre EXACTAMENTE el enum del contrato §Enums, en el orden del pipeline', () => {
    expect(CONTRACT_SELL_REQUEST_STATUSES).toHaveLength(11);
    expect(new Set(CONTRACT_SELL_REQUEST_STATUSES).size).toBe(11);
  });

  it('incluye los CUATRO valores nuevos de v1.51 (los que se caían de todas las listas)', () => {
    for (const nuevo of ['ofertada', 'aceptada', 'en_transito', 'expirada'] as const) {
      expect(CONTRACT_SELL_REQUEST_STATUSES).toContain(nuevo);
    }
  });

  it('los ONCE resuelven a un badge PROPIO con rótulo en AMBOS catálogos (paridad es/en)', () => {
    const esKeys = new Set(keyPaths(es));
    const enKeys = new Set(keyPaths(en));
    for (const status of CONTRACT_SELL_REQUEST_STATUSES) {
      const spec = getBadgeSpec('sellRequest', status);
      // Ninguno cae al fallback genérico del mapa (que devolvería `status.sellRequest.<valor>`
      // sin fila detrás y pintaría la clave cruda en pantalla).
      expect(esKeys.has(spec.i18nKey), `ES sin etiqueta para ${spec.i18nKey}`).toBe(true);
      expect(enKeys.has(spec.i18nKey), `EN sin etiqueta para ${spec.i18nKey}`).toBe(true);
    }
  });

  it('DIEZ rotulan bajo `status.sellRequest.*`; `expirada` NO, y esa excepción es la regla', () => {
    // DESIGN_SYSTEM §23.12: el desenlace de una `expirada` vive en su propio espacio de claves
    // (`status.sellRequestExpiry.{not_shipped,no_offer,unknown}`) porque al vendedor no se le
    // comunica un ESTADO, se le comunica una CAUSA — y sus dos causas afirman cosas opuestas.
    for (const status of CONTRACT_SELL_REQUEST_STATUSES.filter((s) => s !== 'expirada')) {
      expect(getBadgeSpec('sellRequest', status).i18nKey).toBe(`status.sellRequest.${status}`);
    }
    for (const reason of [undefined, null, 'no_offer', 'not_shipped']) {
      expect(getBadgeSpec('sellRequest', 'expirada', reason).i18nKey).toMatch(
        /^status\.sellRequestExpiry\./,
      );
    }
  });

  it('NINGÚN módulo declara una lista LITERAL de estados fuera de contract.ts', () => {
    // El bug fue `const REQUEST_TERMINAL = new Set<SellRequestStatus>(['pagada','rechazada',
    // 'abandonada'])` escrito dentro de una VISTA. El patrón detecta exactamente eso: un
    // `Set`/array de `SellRequestStatus` construido con un literal `[...]`. Las listas DERIVADAS
    // (p. ej. `M5_CLOSED_STATUSES = statusesForTab('cerradas')`) NO matchean, y es la
    // distinción que importa: derivar es legítimo, transcribir a mano es la deuda.
    const root = join(__dirname, '..');
    const LITERAL_LIST =
      /new Set<SellRequestStatus>\(\s*\[|:\s*SellRequestStatus\[\]\s*=\s*\[|Array<SellRequestStatus>\s*=\s*\[/;
    // ⚠️ ÚNICA excepción, y se nombra en vez de esconderse: el SERVIDOR FALSO. En modo mock no
    // hay backend que derive `isTerminal`, así que la derivación vive ahí — nunca en una vista.
    const MOCK_SERVER = join(root, 'lib', 'mock');
    const offenders = sourceFiles(root)
      .filter((f) => !f.endsWith('sell-request-status.test.ts'))
      .filter((f) => !f.startsWith(MOCK_SERVER))
      .filter((f) => LITERAL_LIST.test(readFileSync(f, 'utf8')))
      .map((f) => f.replace(root, 'src'));
    expect(offenders, `listas literales de SellRequestStatus en: ${offenders.join(', ')}`).toEqual(
      [],
    );
  });

  it('la ÚNICA derivación del set terminal del front vive en el servidor falso y son CUATRO', async () => {
    // No se compara contra una lista local (sería la copia otra vez): se comprueba la CONDUCTA
    // de la proyección mock, que es el espejo de `backend/src/common/sell-request-states.ts`.
    const { mockSellRequestDTO } = await import('@/lib/mock/fixtures');
    const project = (status: SellRequestStatus) =>
      mockSellRequestDTO({
        sellRequestId: 'sr-x',
        status,
        quotedTotalCents: 0,
        ineRequired: false,
        items: [],
      }).isTerminal;

    const terminal = CONTRACT_SELL_REQUEST_STATUSES.filter(project);
    expect([...terminal].sort()).toEqual(['abandonada', 'expirada', 'pagada', 'rechazada']);
    // Y el complemento son las SIETE vivas: `LIVE ∪ TERMINAL == enum` y `LIVE ∩ TERMINAL == ∅`.
    expect(CONTRACT_SELL_REQUEST_STATUSES.filter((s) => !project(s))).toHaveLength(7);
  });
});
