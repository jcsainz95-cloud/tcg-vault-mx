/**
 * postal-code.ts — la fuente de colonias por CP y el ÚNICO cuerpo que la consulta (`resolvePostalCode`).
 * API_CONTRACT §M4-SHIP.19.5 (fase C, M-64 = `M-SDX-C`); ARCHITECTURE §4.60 (e). Propiedad: backend.
 *
 * `C-SDX-3`: el `GET /geo/postal-codes/:cp` (lo que pinta la pantalla) y TODA resolución del servidor (libreta,
 * checkout de invitado, corrección de la dirección del envío, `neighborhoodCheck`) pasan por
 * `PostalCodeService.resolvePostalCode` — un cuerpo, así que pantalla y servidor no divergen.
 *
 * ⭐ v1.80.12.5 (§M4-SHIP.19.25, `HECHOS.md:57`, «colonia como Mercado Libre»): el catálogo AYUDA, no bloquea.
 * `resolveAddressGeo` nunca rechaza por geografía; `POSTAL_CODE_UNKNOWN` queda solo como el `404` del `GET`.
 *
 * Fuente intercambiable (`PostalCodePort`), con precedencia: (1) catálogo LOCAL (`PostalCode`, SEPOMEX, lo carga
 * devops); (2) Skydropx — ⛔ NO construido: que su API dé colonias por CP es NO MEDIDO (PS-SBX-9) y la red está
 * vetada; entra como segunda fuente de `PostalCodeService` sin tocar a los lectores; (3) `null` ⇒ desconocido.
 */
import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { BusinessException } from '../../../common/business.exception';

export const POSTAL_CODE_RE = /^\d{5}$/;

/** Lo que una fuente sabe de un CP. `municipality` por colonia: un CP de SEPOMEX puede cruzar municipios. */
export interface PostalCodeRecord {
  postalCode: string;
  source: 'local' | 'skydropx';
  entries: { neighborhood: string; municipality: string; state: string }[];
}

export interface PostalCodePort {
  /** `null` ⇔ la fuente no conoce el CP (cero colonias). */
  lookup(postalCode: string): Promise<PostalCodeRecord | null>;
}
export const POSTAL_CODE_SOURCES = 'POSTAL_CODE_SOURCES';

/** La respuesta de `GET /geo/postal-codes/:cp` (§19.5). */
export interface PostalCodeDTO {
  postalCode: string;
  state: string;
  municipality: string;
  neighborhoods: string[];
  source: 'local' | 'skydropx';
}

/**
 * ⭐ v1.80.12.5 (§M4-SHIP.19.25.1, `HECHOS.md:57`): qué se comprobó de la colonia contra el catálogo. Sale en
 * `AdminShipmentDTO.address.neighborhoodCheck` (calculado AL LEER, ⛔ nunca persistido, §19.25.3).
 */
export type NeighborhoodCheck = 'in_catalog' | 'not_in_postal_code_list' | 'postal_code_not_in_catalog';

/** Lo que `resolveAddressGeo` manda guardar. `check` es para la prueba y el registro: ⛔ NO se persiste. */
export interface ResolvedAddressGeo {
  postalCode: string;
  neighborhood: string;
  city: string;
  state: string;
  check: NeighborhoodCheck;
}

/**
 * `normalizeColonia` (§19.5): trim + colapso de espacios + MAYÚSCULAS sin acentos. Solo sirve para COMPARAR; lo que
 * se guarda es el valor canónico de la lista. (La «Ñ» se compara como «N»: los dos lados pasan por aquí.)
 */
export function normalizeColonia(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // marcas diacríticas combinantes (tras NFD)
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

/** Fuente (1): el catálogo local. */
@Injectable()
export class LocalPostalCodeSource implements PostalCodePort {
  constructor(private readonly prisma: PrismaService) {}

  async lookup(postalCode: string): Promise<PostalCodeRecord | null> {
    const rows = await this.prisma.postalCode.findMany({
      where: { postalCode },
      select: { neighborhood: true, municipality: true, state: true },
      orderBy: { neighborhood: 'asc' },
    });
    if (rows.length === 0) return null;
    return { postalCode, source: 'local', entries: rows };
  }
}

/** El más frecuente (empate ⇒ el primero en orden alfabético): el municipio/estado «del CP» para el `GET`. */
function mostCommon(values: string[]): string {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
}

/** La comparación del caso 3 (§19.25.1): la entrada del CP cuya colonia casa por `normalizeColonia`, o `undefined`. */
function matchColonia(rec: PostalCodeRecord, neighborhood: string): PostalCodeRecord['entries'][number] | undefined {
  const wanted = normalizeColonia(neighborhood);
  return rec.entries.find((e) => normalizeColonia(e.neighborhood) === wanted);
}

@Injectable()
export class PostalCodeService {
  constructor(@Inject(POSTAL_CODE_SOURCES) private readonly sources: PostalCodePort[]) {}

  /** EL cuerpo (`C-SDX-3`). `null` ⇔ ninguna fuente conoce el CP. Un CP mal formado ⇒ `null` (nunca consulta). */
  async resolvePostalCode(postalCode: string): Promise<PostalCodeRecord | null> {
    if (!POSTAL_CODE_RE.test(postalCode)) return null;
    for (const source of this.sources) {
      const rec = await source.lookup(postalCode);
      if (rec && rec.entries.length > 0) return rec;
    }
    return null;
  }

  /** `GET /geo/postal-codes/:cp`: `400` si no es `^\d{5}$`, `404 POSTAL_CODE_UNKNOWN` si nadie lo conoce. */
  async describe(postalCode: string): Promise<PostalCodeDTO> {
    if (!POSTAL_CODE_RE.test(postalCode)) {
      throw BusinessException.badRequest('VALIDATION_ERROR', 'postalCode must be 5 digits', { field: 'postalCode' });
    }
    const rec = await this.resolvePostalCode(postalCode);
    if (!rec) {
      throw new BusinessException('POSTAL_CODE_UNKNOWN', 404, 'Unknown postal code', { postalCode });
    }
    return {
      postalCode,
      state: mostCommon(rec.entries.map((e) => e.state)),
      municipality: mostCommon(rec.entries.map((e) => e.municipality)),
      neighborhoods: [...new Set(rec.entries.map((e) => e.neighborhood))],
      source: rec.source,
    };
  }

  /**
   * ⭐ v1.80.12.5 (§M4-SHIP.19.25.1) — LA regla de la dirección (libreta, invitado, `PUT …/address`); sustituye a
   * `canonicalize`. ⛔ **Nunca lanza por geografía**: solo decide qué guardar (la forma ya la validó quien llama).
   *  2. CP fuera del catálogo (o catálogo vacío) ⇒ colonia, `city` y `state` tal como vinieron (trim).
   *  3. CP en el catálogo y la colonia casa por `normalizeColonia` ⇒ la grafía canónica + municipio/estado de ESA
   *     colonia (una colonia escrita a mano que sí está en la lista cae aquí: lo decide el servidor, no el cuerpo).
   *  4. CP en el catálogo y la colonia no casa ⇒ la colonia escrita (trim) + municipio/estado DEL CP (`mostCommon`,
   *     los mismos que mostró el `GET`): el cliente no contradice al catálogo en lo que el catálogo sí sabe.
   */
  async resolveAddressGeo(postalCode: string, neighborhood: string, city: string, state: string): Promise<ResolvedAddressGeo> {
    const cp = postalCode.trim();
    const typed = neighborhood.trim();
    const rec = await this.resolvePostalCode(cp);
    if (!rec) {
      return { postalCode: cp, neighborhood: typed, city: city.trim(), state: state.trim(), check: 'postal_code_not_in_catalog' };
    }
    const hit = matchColonia(rec, typed);
    if (hit) {
      return { postalCode: cp, neighborhood: hit.neighborhood, city: hit.municipality, state: hit.state, check: 'in_catalog' };
    }
    return {
      postalCode: cp,
      neighborhood: typed,
      city: mostCommon(rec.entries.map((e) => e.municipality)),
      state: mostCommon(rec.entries.map((e) => e.state)),
      check: 'not_in_postal_code_list',
    };
  }

  /**
   * ⭐ v1.80.12.5 (§M4-SHIP.19.25.3) — `neighborhoodCheck` de un snapshot, AL LEER: la misma consulta
   * (`resolvePostalCode`) y la misma comparación (`matchColonia`) que `resolveAddressGeo`. Sin colonia o con CP mal
   * formado ⇒ `'postal_code_not_in_catalog'` (y `missing` ya lo dice). Una sola fuente: el catálogo de hoy.
   */
  async neighborhoodCheckOf(postalCode: unknown, neighborhood: unknown): Promise<NeighborhoodCheck> {
    if (typeof postalCode !== 'string' || typeof neighborhood !== 'string' || neighborhood.trim().length === 0) {
      return 'postal_code_not_in_catalog';
    }
    const rec = await this.resolvePostalCode(postalCode.trim());
    if (!rec) return 'postal_code_not_in_catalog';
    return matchColonia(rec, neighborhood) ? 'in_catalog' : 'not_in_postal_code_list';
  }
}
