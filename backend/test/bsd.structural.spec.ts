/**
 * bsd.structural.spec.ts — 💰 BSD-B25 (API_CONTRACT §BSD.11, rev BSD-1): los dos candados ESTRUCTURALES de la guía de
 * entrada.
 *
 * (a) **`kind` solo se compara en `shipments/label-subject.ts`.** Fuera de ese fichero ningún código escribe los literales
 *     `'outbound'` / `'buylist_inbound'`, usa `ShipmentKind.<valor>` ni importa `ShipmentKind` de `@prisma/client`. La
 *     política por clase vive en UN sitio (§BSD.3); el resto usa `labelSubjectOf`, `isBuylistInbound`, `OUTBOUND_ONLY`,
 *     `outboundOnlySql`, `BUYLIST_INBOUND_KIND`.
 *
 * (b) **I-BSD-1: toda escritura que puede sacar una solicitud de `aceptada` llama a `closeInboundShipment` en la misma
 *     función.** El censo (`sellRequestStatusWriteSites`) encuentra cada `sellRequest.update/updateMany/upsert` cuyo `data`
 *     pone `status` (o es opaco); `WRITERS` clasifica cada uno:
 *       - `leaves_aceptada` ⇒ la función DEBE contener `closeInboundShipment(`;
 *       - `not_from_aceptada` ⇒ su `where` no admite `aceptada` (con su porqué);
 *       - `no_status` ⇒ `data` opaco que, leído, no pone `status` (con su porqué).
 *     Un sitio nuevo sin clasificar ⇒ rojo.
 *
 * ### `PENDIENTE` — el rojo de B-1, escrito como TRINQUETE (y por qué así)
 * §BSD.12 reparte B-1 «escribe BSD-B25 en rojo» y B-3 la hace pasar (regla 2 del barrido y `adminConfirmShipment` son de
 * B-3). Además B-1 encontró dos escritores que el contrato NO lista (`rejectRequest` y `autoRejectIfAllRejectedTx`: su
 * `where` es `liveRequestWhere()`, que incluye `aceptada`) — decisión del arquitecto. En vez de dejar la suite roja, cada
 * sitio pendiente está en `PENDIENTE` con su dueño, y el test exige que **siga sin cumplir**: el día que alguien lo
 * cablee, el test se pone ROJO hasta que lo saque de la lista (y entonces lo vigila la regla normal). Ni se olvida en la
 * lista, ni se puede «cumplir» sin que nadie lo note.
 */
import { join } from 'node:path';
import { sellRequestStatusWriteSites, sourcesWithoutComments, StatusWriteSite } from './helpers/bsd-census';

const BACKEND = join(__dirname, '..');
const SUBJECT_FILE = 'src/modules/shipments/label-subject.ts';

type Clase = 'leaves_aceptada' | 'not_from_aceptada' | 'no_status';
const L = 'leaves_aceptada' as const;
const N = 'not_from_aceptada' as const;
/** `data` OPACO (una variable) que, leído a mano, NO pone `status`. */
const S = 'no_status' as const;

const WRITERS: Record<string, readonly [Clase, string]> = {
  'src/jobs/buylist-sweep.service.ts expireUnansweredAdjustments#updateMany#1': [N, 'where = ajuste vivo (verificacion|aprobada)'],
  'src/jobs/buylist-sweep.service.ts abandonUnreturned#updateMany#1': [N, 'where = recibida|verificacion|aprobada'],
  'src/jobs/buylist-sweep.service.ts expireUnofferedRequests#updateMany#1': [N, "where status='cotizada'"],
  'src/jobs/buylist-sweep.service.ts closeWithGuideTask#updateMany#1': [L, 'reglas 1 (ofertada) y 2 (aceptada ⇒ expirada/not_shipped)'],
  'src/modules/buylist/buylist.service.ts adminOffer#updateMany#1': [N, "where status='cotizada'"],
  'src/modules/buylist/buylist.service.ts adminOfferAuthorize#updateMany#1': [N, "where status='cotizada'"],
  'src/modules/buylist/buylist.service.ts adminOfferCancel#updateMany#1': [N, 'where status ∈ cotizada|ofertada'],
  'src/modules/buylist/buylist.service.ts offerResponse#updateMany#1': [N, "where status='ofertada' (ENTRA a aceptada, no sale)"],
  'src/modules/buylist/buylist.service.ts adminConfirmShipment#updateMany#1': [L, "aceptada ⇒ en_transito (closeInboundShipment 'shipped')"],
  'src/modules/buylist/buylist.service.ts adminDecline#updateMany#1': [N, "where status='cotizada'"],
  'src/modules/buylist/buylist.service.ts receive#updateMany#1': [N, 'stepWhere(receive) = en_transito|recibida'],
  'src/modules/buylist/buylist.service.ts verify#updateMany#1': [N, 'stepWhere(verify) = recibida|verificacion'],
  'src/modules/buylist/buylist.service.ts autoRejectIfAllRejectedTx#updateMany#1': [L, 'liveRequestWhere() ⊇ aceptada ⇒ rechazada'],
  'src/modules/buylist/buylist.service.ts rejectRequest#updateMany#1': [L, 'liveRequestWhere() ⊇ aceptada ⇒ rechazada'],
  'src/modules/buylist/buylist.service.ts paySpei#updateMany#1': [N, "where status='aprobada'"],
  'src/modules/buylist/buylist.service.ts respond#updateMany#1': [N, 'data opaco (rechazada|aprobada); where = ajuste vivo (verificacion|aprobada)'],
  'src/modules/buylist/sell-request-guide.ts writeSellRequestGuide#updateMany#1': [S, 'data = par/guideSentAt/plazo (+ sello): sin status'],
  'src/modules/buylist/sell-request-guide.ts writeSellRequestGuide#updateMany#2': [S, 'data = par/guideSentAt/plazo: sin status'],
};

/** El trinquete (ver cabecera). Dueño y razón. Vaciarla es el objetivo de B-3 y del arquitecto. */
const PENDIENTE: Record<string, string> = {
  'src/jobs/buylist-sweep.service.ts closeWithGuideTask#updateMany#1': 'B-3 — §BSD.7.3 regla 2 (y la tarea solo con guía manual o `live`)',
  'src/modules/buylist/buylist.service.ts adminConfirmShipment#updateMany#1': "B-3 — §BSD.4.5 `closeInboundShipment(tx, id, 'shipped')`",
  'src/modules/buylist/buylist.service.ts autoRejectIfAllRejectedTx#updateMany#1':
    'ARQUITECTO — escritor NO listado en I-BSD-1: rechazar por carta TODAS las líneas de una `aceptada` (la decisión `reject` no exige recepción) la cierra `rechazada`',
  'src/modules/buylist/buylist.service.ts rejectRequest#updateMany#1': 'ARQUITECTO — escritor NO listado en I-BSD-1: `POST …/reject` sobre una `aceptada` con todas sus líneas rechazadas',
};

const CALLS_CLOSE = /\bcloseInboundShipment\(/;

let WRITES: StatusWriteSite[];
beforeAll(() => {
  WRITES = sellRequestStatusWriteSites(BACKEND);
});

describe('💰 BSD-B25 (a) — `kind` solo se compara en `label-subject.ts`', () => {
  const PATTERNS: readonly [string, RegExp][] = [
    ["literal 'outbound'", /['"`]outbound['"`]/],
    ["literal 'buylist_inbound'", /['"`]buylist_inbound['"`]/],
    ['ShipmentKind.<valor>', /\bShipmentKind\.(outbound|buylist_inbound)\b/],
    ['import de ShipmentKind de Prisma', /import\s*(type\s*)?\{[^}]*\bShipmentKind\b[^}]*\}\s*from\s*['"]@prisma\/client['"]/],
  ];

  it('CONTROL: el candado SÍ ve la comparación donde vive (label-subject.ts la tiene)', () => {
    const subject = sourcesWithoutComments(BACKEND).find((s) => s.file === SUBJECT_FILE);
    expect(subject).toBeDefined();
    expect(PATTERNS.filter(([, re]) => re.test(subject!.code)).length).toBeGreaterThanOrEqual(2);
  });

  it('ningún otro fichero de `src/` compara o escribe `kind` a mano', () => {
    const offenders = sourcesWithoutComments(BACKEND)
      .filter((s) => s.file !== SUBJECT_FILE)
      .flatMap((s) => PATTERNS.filter(([, re]) => re.test(s.code)).map(([what]) => `${s.file}: ${what}`));
    expect(offenders).toEqual([]);
  });
});

describe('💰 BSD-B25 (b) — I-BSD-1: salir de `aceptada` llama a `closeInboundShipment` en la misma función', () => {
  it('CONTROL: el censo ve las escrituras de `status` de la solicitud (≥ 12) y la de `adminConfirmShipment`', () => {
    expect(WRITES.length).toBeGreaterThanOrEqual(12);
    expect(WRITES.map((w) => w.key)).toContain('src/modules/buylist/buylist.service.ts adminConfirmShipment#updateMany#1');
  });

  it('toda escritura de `status` de `SellRequest` está clasificada (una nueva ⇒ rojo: clasifícala en WRITERS)', () => {
    expect(WRITES.filter((w) => !(w.key in WRITERS)).map((w) => `${w.key} (línea ${w.line}, ${w.writes})`)).toEqual([]);
  });

  it('WRITERS no tiene filas muertas', () => {
    const vivos = new Set(WRITES.map((w) => w.key));
    expect(Object.keys(WRITERS).filter((k) => !vivos.has(k))).toEqual([]);
  });

  it('todo `leaves_aceptada` (fuera de PENDIENTE) llama a `closeInboundShipment` en la misma función', () => {
    const faltan = WRITES.filter((w) => WRITERS[w.key]?.[0] === L && !(w.key in PENDIENTE) && !CALLS_CLOSE.test(w.fnText)).map((w) => w.key);
    expect(faltan).toEqual([]);
  });

  it('TRINQUETE: lo que está en PENDIENTE sigue sin cablear (si ya lo cableaste, sácalo de PENDIENTE)', () => {
    const yaCumplen = WRITES.filter((w) => w.key in PENDIENTE && CALLS_CLOSE.test(w.fnText)).map((w) => w.key);
    expect(yaCumplen).toEqual([]);
  });

  it('PENDIENTE solo contiene sitios vivos y `leaves_aceptada`, con su dueño', () => {
    const vivos = new Set(WRITES.map((w) => w.key));
    expect(Object.keys(PENDIENTE).filter((k) => !vivos.has(k) || WRITERS[k]?.[0] !== L)).toEqual([]);
    expect(Object.values(PENDIENTE).filter((v) => !/^(B-2|B-3|ARQUITECTO) — /.test(v))).toEqual([]);
  });
});
