import zlib from 'node:zlib';
import { IS_REAL, apiAs, apiAsOk, resolveApiBaseUrl, sessionFor } from './env';
import { readState, writeState, clearState, withFileLock } from './state';

/**
 * ─────────────────────────────────────────────────────────────────────────────────────
 * ESCENARIO DE §AC (accesorios, energías y paquete del deck), AGNÓSTICO AL ENTORNO.
 *
 * POR QUÉ EXISTE — la doctrina H-4 (`./grading.ts:14-21`): un salto «solo-mock» sobre algo que se puede
 * medir contra el stack es un defecto. Todo el E2E de §AC era solo-mock «el simulador sirve el
 * catálogo y la cotización», motivo que dejó de ser cierto cuando el backend de §AC quedó completo
 * en `claude/accesorios` (streams A, B, C y erratas hasta v1.86.4).
 *
 *   MOCK → ids de `src/lib/mock/accessories.ts` y el primer deck del simulador. Cero I/O.
 *   REAL → SIEMBRA por la API del contrato (§AC.11 y §13): alta, foto PNG generada aquí, precio,
 *          existencias y activación de accesorios; energías Fuego y Psíquica listas; un deck curado
 *          (`POST /admin/decks-meta`) con 8 «Basic Fire Energy» y 4 «Basic Psychic Energy».
 *
 * Lo ÚNICO que no se puede sembrar por API es la parte de CARTAS del deck: el emparejador casa por
 * `CardSet.ptcgoCode` + número (`deck-matcher.service.ts:10`) y el seed E2E no pone `ptcgoCode` a
 * ningún set (medido 2026-10-07 en el clúster propio: `select "ptcgoCode" from "CardSet"` ⇒ vacío) ni
 * hay endpoint que lo escriba. Esas filas se piden a backend (`DECK_SEED`, abajo; FRONTEND_NOTES
 * §107.real). Backend las siembra desde `f76fe398` (`BACKEND_NOTES §83.seed`), así que sin ellas
 * `deckScenario()` FALLA con la causa (FRONTEND_NOTES §107.gates): ya no es un dato pendiente, es una regresión.
 *
 * HUELLA QUE DEJA EN EL ENTORNO (declarada):
 *  - Accesorios creados por el arnés: se BORRAN al final del caso (`retireAccessory`); si ya tienen
 *    renglones de pedido (`409 ACCESSORY_HAS_SALES`, p. ej. con Stripe de prueba la sesión crea el
 *    pedido) se DESACTIVAN. Los que no llegaron a retirarse los recoge `restoreAccessoryScenario` en
 *    el `globalTeardown`.
 *  - Energías: si el arnés activó un tipo que estaba inactivo, el teardown lo vuelve a desactivar.
 *    Las existencias que recibió (`receive`) se quedan: son movimientos con rastro, no se «des-reciben».
 *  - Deck curado: el teardown lo despublica (`PUT /admin/decks-meta/:id {published:false}`). La fila
 *    queda (no hay `DELETE` en el contrato) y la siguiente corrida la vuelve a curar por `slug`.
 * ─────────────────────────────────────────────────────────────────────────────────────
 */

/** Forma mínima de `AdminAccessoryDTO` (§AC.11) que este arnés lee. */
export interface AdminAccessory {
  id: string;
  name: string;
  category: string;
  energyType: string | null;
  priceCents: number | null;
  stockQty: number;
  reservedQty: number;
  availableQty: number;
  active: boolean;
  suggested: boolean;
  photo: { url: string; thumbUrl: string } | null;
}

export interface AccessoryRef {
  id: string;
  name: string;
}

// ── PNG generado aquí (criterio 724: «con foto PNG»). Sin dependencias ni ficheros binarios en el repo. ──

function crc32(buf: Buffer): number {
  let crc = ~0;
  for (const byte of buf) {
    let c = (crc ^ byte) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return ~crc >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** PNG RGB real (firma, IHDR, IDAT, IEND) de `w×h` — rectangular a propósito: la foto la acomoda el servidor. */
export function makePng(w = 96, h = 64, rgb: [number, number, number] = [200, 40, 80]): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bits por canal
  ihdr[9] = 2; // RGB
  const stride = w * 3 + 1;
  const raw = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = y * stride + 1 + x * 3;
      raw[o] = rgb[0];
      raw[o + 1] = (x * 3) & 0xff;
      raw[o + 2] = rgb[2];
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── API del panel (§AC.11) ──

export async function getAdminAccessory(id: string): Promise<AdminAccessory> {
  return apiAsOk<AdminAccessory>('admin', 'GET', `/admin/accessories/${id}`);
}

/** `POST /admin/accessories/:id/photo` — `multipart/form-data`, campo `file` (§AC.11). */
export async function uploadAccessoryPhoto(id: string): Promise<AdminAccessory> {
  const apiBase = await resolveApiBaseUrl();
  const { accessToken } = await sessionFor('admin');
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(makePng())], { type: 'image/png' }), 'e2e-accesorio.png');
  const res = await fetch(`${apiBase}/admin/accessories/${id}/photo`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: form,
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`POST /admin/accessories/${id}/photo respondió ${res.status}: ${body.slice(0, 300)}`);
  return JSON.parse(body) as AdminAccessory;
}

/** Etiqueta única por corrida y caso: los nombres no chocan entre corridas ni entre workers. */
export function runTag(label: string): string {
  return `E2E AC ${label} ${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

const createdKey = async () => `accessories:created:${await resolveApiBaseUrl()}`;
const energyKey = async () => `accessories:energies-activated:${await resolveApiBaseUrl()}`;
const deckKey = async () => `accessories:deck:${await resolveApiBaseUrl()}`;

async function remember(key: string, value: string): Promise<void> {
  await withFileLock(`${key}:lock`, async () => {
    const prev = readState<string[]>(key)?.value ?? [];
    if (!prev.includes(value)) writeState<string[]>(key, [...prev, value]);
  });
}

async function forget(key: string, value: string): Promise<void> {
  await withFileLock(`${key}:lock`, async () => {
    const prev = readState<string[]>(key)?.value ?? [];
    writeState<string[]>(key, prev.filter((v) => v !== value));
  });
}

export interface ReadyAccessoryInput {
  name: string;
  category: 'sleeves' | 'toploaders' | 'binders' | 'deck_boxes' | 'playmats' | 'other';
  priceCents: number;
  stock: number;
  suggested?: boolean;
}

/**
 * Accesorio ACTIVO por la API del contrato (alta → foto → existencias → activar). Con `stock: 0` queda
 * activo y agotado (criterio 706). Lo registra para que el teardown lo retire si el caso no llega.
 */
export async function createReadyAccessory(input: ReadyAccessoryInput): Promise<AdminAccessory> {
  const created = await apiAsOk<AdminAccessory>('admin', 'POST', '/admin/accessories', {
    name: input.name,
    category: input.category,
    lengthMm: 95,
    widthMm: 70,
    heightMm: 20,
    weightG: 40,
    priceCents: input.priceCents,
    suggested: input.suggested ?? false,
  });
  await remember(await createdKey(), created.id);
  await uploadAccessoryPhoto(created.id);
  if (input.stock > 0) {
    await apiAsOk('admin', 'POST', `/admin/accessories/${created.id}/stock`, { kind: 'receive', quantity: input.stock });
  }
  return apiAsOk<AdminAccessory>('admin', 'POST', `/admin/accessories/${created.id}/activate`);
}

/** Lo que el alta por PANTALLA deja registrado, para que el teardown lo retire si el caso se cae. */
export async function rememberCreatedAccessory(id: string): Promise<void> {
  await remember(await createdKey(), id);
}

/**
 * Retira un accesorio del arnés: `DELETE` (`204`) si no tiene ventas; con ventas (`409
 * ACCESSORY_HAS_SALES`) solo se puede desactivar (criterio 722) y eso se hace.
 */
export async function retireAccessory(id: string): Promise<'deleted' | 'deactivated' | 'gone'> {
  const del = await apiAs('admin', 'DELETE', `/admin/accessories/${id}`);
  let out: 'deleted' | 'deactivated' | 'gone';
  if (del.status === 204 || del.status === 200) out = 'deleted';
  else if (del.status === 404) out = 'gone';
  else {
    await apiAsOk('admin', 'POST', `/admin/accessories/${id}/deactivate`);
    out = 'deactivated';
  }
  await forget(await createdKey(), id);
  return out;
}

// ── Escenario del smoke (agnóstico) ──

export interface ShopScenario {
  /** Disponible, se agrega desde su ficha. */
  available: AccessoryRef;
  /** Activo y AGOTADO: sin botón en el listado (AC-UX-2). */
  soldOut: AccessoryRef;
  /** `?q=` del listado: en real acota a lo de este caso (la tienda puede tener más accesorios). */
  listQuery: string | null;
  /** Ids a retirar al final (vacío en mock). */
  cleanup: string[];
}

const MOCK_SHOP: ShopScenario = {
  available: { id: 'acc-sleeves', name: 'Penny sleeves ×100' },
  soldOut: { id: 'acc-playmat', name: 'Playmat Dragapult' },
  listQuery: null,
  cleanup: [],
};

/**
 * Para el smoke «pestaña → listado → ficha → carrito con sugerencia». En real crea TRES activos con
 * la misma etiqueta: uno disponible, uno agotado y uno disponible y «Sugerido» para que «¿Te falta
 * algo?» tenga qué ofrecer aunque la tienda no tenga otros.
 */
export async function shopScenario(label: string): Promise<ShopScenario> {
  if (!IS_REAL) return MOCK_SHOP;
  const tag = runTag(label);
  const available = await createReadyAccessory({ name: `${tag} Fundas`, category: 'sleeves', priceCents: 8900, stock: 10 });
  const soldOut = await createReadyAccessory({ name: `${tag} Tapete`, category: 'playmats', priceCents: 45000, stock: 0 });
  const suggested = await createReadyAccessory({
    name: `${tag} Toploaders`,
    category: 'toploaders',
    priceCents: 6900,
    stock: 10,
    suggested: true,
  });
  return {
    available: { id: available.id, name: available.name },
    soldOut: { id: soldOut.id, name: soldOut.name },
    listQuery: tag,
    cleanup: [available.id, soldOut.id, suggested.id],
  };
}

// ── Energías (§AC.9) y deck (§AC.8) ──

export type EnergyType = 'grass' | 'fire' | 'water' | 'lightning' | 'psychic' | 'fighting' | 'darkness' | 'metal';

/**
 * Deja el producto «Energía <tipo>» ACTIVO, con foto y con al menos `need` disponibles. Idempotente.
 * Si lo activa él, lo anota para que el teardown lo desactive (estado previo del entorno).
 */
export async function ensureEnergy(type: EnergyType, need: number): Promise<AdminAccessory> {
  const list = await apiAsOk<{ items: AdminAccessory[] }>('admin', 'GET', '/admin/accessories?category=energy');
  let row = list.items.find((a) => a.energyType === type);
  if (!row) {
    throw new Error(
      `No existe el producto «Energía ${type}»: lo siembra la migración M-73 (` +
        '`20261026120000_m73_accessories/migration.sql`, paso 8). ¿La base está migrada?',
    );
  }
  if (!row.photo) row = await uploadAccessoryPhoto(row.id);
  if (row.availableQty < need) {
    row = await apiAsOk<AdminAccessory>('admin', 'POST', `/admin/accessories/${row.id}/stock`, {
      kind: 'receive',
      quantity: need - row.availableQty,
      note: 'E2E §AC (arnés frontend)',
    });
  }
  if (!row.active) {
    row = await apiAsOk<AdminAccessory>('admin', 'POST', `/admin/accessories/${row.id}/activate`);
    await remember(await energyKey(), row.id);
  }
  return row;
}

/**
 * ⚠️ **PETICIÓN DE DATO A BACKEND** (`backend/prisma/seed-e2e.ts`; FRONTEND_NOTES §107.real). Espejo de
 * las filas pedidas, como `m4-ship-spei-real.spec.ts` copia `E2E_SPEI_FIXTURE`: el frontend no importa
 * del árbol de backend.
 *  - `CardSet` «E2E Base Set» con `ptcgoCode = 'EEB'` (hoy `null`: el emparejador no puede casar nada).
 *  - Dos cartas raw nuevas en ese set: «E2E Deck Ember» #40 y «E2E Deck Spark» #41, con precio de
 *    referencia NM **bajo** (MX$50: por debajo de todas las raw del seed, para no mover el orden por
 *    precio del que depende `./grading.ts`), y **dos** piezas `listed` de plataforma cada una — una
 *    por idioma: con Stripe de prueba la sesión de ES deja la suya apartada y la de EN necesita otra.
 */
export const DECK_SEED = {
  setCode: 'EEB',
  cards: [
    { name: 'E2E Deck Ember', number: '40' },
    { name: 'E2E Deck Spark', number: '41' },
  ],
  copiesPerCard: 2,
} as const;

/** Necesidad de energías del deck de prueba (PROJECT.md, bloque previo al criterio 734: 8 Fuego + 4 Psíquica). */
export const DECK_ENERGIES: Record<'fire' | 'psychic', number> = { fire: 8, psychic: 4 };

export const DECK_SLUG = 'e2e-ac-energias';
const DECK_NAME = 'E2E Paquete de energías';

interface DeckLine {
  rawName: string;
  quantity: number;
  matchStatus: string;
  availableQty: number;
  basicEnergy?: { energyType: string; accessoryId: string } | null;
}
export interface DeckDetail {
  slug: string;
  name: string;
  groups: { pokemon: DeckLine[]; trainer: DeckLine[]; energy: DeckLine[] };
  energyBundle: { offered: boolean; reason: string | null; priceCents: number; looseTotalCents: number };
}

export interface DeckScenario {
  slug: string;
  name: string;
  detail: DeckDetail | null;
  energies: Record<string, AdminAccessory>;
}

/**
 * Deck con energías ligadas y paquete ofrecido. En mock: el primer deck del simulador (`slug` vacío ⇒
 * el spec entra por la primera tarjeta). En real: energías listas + deck curado + verificación con el
 * propio `GET /decks-meta/:slug` (quien dice si se ofrece es el servidor).
 */
export async function deckScenario(): Promise<DeckScenario> {
  if (!IS_REAL) return { slug: '', name: '', detail: null, energies: {} };
  // Disponible de sobra para las dos sesiones (ES y EN) aunque la primera deje sus energías apartadas.
  const fire = await ensureEnergy('fire', DECK_ENERGIES.fire * 2);
  const psychic = await ensureEnergy('psychic', DECK_ENERGIES.psychic * 2);

  const listText = [
    'Pokémon: 2',
    ...DECK_SEED.cards.map((c) => `1 ${c.name} ${DECK_SEED.setCode} ${c.number}`),
    '',
    'Energy: 12',
    `${DECK_ENERGIES.fire} Basic Fire Energy`,
    `${DECK_ENERGIES.psychic} Basic Psychic Energy`,
  ].join('\n');
  const curated = await apiAsOk<{ id: string; slug: string }>('admin', 'POST', '/admin/decks-meta', {
    slug: DECK_SLUG,
    name: DECK_NAME,
    listText,
    rank: 99,
    published: true,
  });
  writeState(await deckKey(), curated.id);

  const res = await apiAs<DeckDetail>('admin', 'GET', `/decks-meta/${DECK_SLUG}`);
  if (res.status !== 200) throw new Error(`GET /decks-meta/${DECK_SLUG} respondió ${res.status}`);
  const detail = res.body;
  const cardLines = [...detail.groups.pokemon, ...detail.groups.trainer];
  const unmatched = cardLines.filter((l) => l.matchStatus !== 'matched' || l.availableQty < 1);
  if (cardLines.length === 0 || unmatched.length > 0) {
    throw new Error(
      `Las cartas del deck no casan o no tienen pieza (${unmatched.map((l) => `${l.rawName}: ${l.matchStatus}, ` +
          `disp. ${l.availableQty}`).join('; ') || 'sin líneas de carta'}). Falta en backend/prisma/seed-e2e.ts: ` +
        `ptcgoCode '${DECK_SEED.setCode}' en «E2E Base Set» y las cartas ${DECK_SEED.cards.map((c) => `${c.name} #${c.number}`).join(', ')} ` +
        `con ${DECK_SEED.copiesPerCard} piezas listed cada una (BACKEND_NOTES §83.seed, desde f76fe398; FRONTEND_NOTES §107.gates)`,
    );
  }
  if (!detail.energyBundle.offered) {
    throw new Error(
      `El deck casa entero y aun así el servidor NO ofrece el paquete (reason=${detail.energyBundle.reason}). ` +
        `Energías: Fuego disp. ${fire.availableQty}, Psíquica disp. ${psychic.availableQty}. Esto ya no es dato: mírese §AC.8.`,
    );
  }
  return { slug: DECK_SLUG, name: detail.name, detail, energies: { fire, psychic } };
}

/**
 * Deshace la huella de §AC al final de la corrida (lo llama `e2e/global-teardown.ts`): retira los
 * accesorios del arnés que quedaron vivos, desactiva las energías que activó él y despublica el deck.
 * Avisa sin tumbar la corrida (mismo criterio que `restoreGradingDial`).
 */
export async function restoreAccessoryScenario(): Promise<void> {
  try {
    const cKey = await createdKey();
    for (const id of readState<string[]>(cKey)?.value ?? []) {
      try {
        await retireAccessory(id);
      } catch (error) {
        console.warn(`[e2e] §AC: no se pudo retirar el accesorio ${id}: ${String(error)}`);
      }
    }
    clearState(cKey);

    const eKey = await energyKey();
    for (const id of readState<string[]>(eKey)?.value ?? []) {
      const r = await apiAs('admin', 'POST', `/admin/accessories/${id}/deactivate`);
      if (r.status >= 300) console.warn(`[e2e] §AC: no se pudo desactivar la energía ${id}: ${r.status}`);
    }
    clearState(eKey);

    const dKey = await deckKey();
    const deckId = readState<string>(dKey)?.value;
    if (deckId) {
      const r = await apiAs('admin', 'PUT', `/admin/decks-meta/${deckId}`, { published: false });
      if (r.status >= 300) console.warn(`[e2e] §AC: no se pudo despublicar el deck ${deckId}: ${r.status}`);
      clearState(dKey);
    }
  } catch (error) {
    console.warn(`[e2e] §AC: no se pudo deshacer la huella del escenario: ${String(error)}`);
  }
}
