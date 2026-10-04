/**
 * postal-code.ts — la fuente de colonias por CP y el ÚNICO cuerpo que la consulta (`resolvePostalCode`).
 * API_CONTRACT §M4-SHIP.19.5 (fase C, M-64 = `M-SDX-C`); ARCHITECTURE §4.60 (e). Propiedad: backend.
 *
 * `C-SDX-3`: el `GET /geo/postal-codes/:cp` (lo que pinta la pantalla) y TODA validación del servidor (libreta,
 * checkout de invitado, corrección de la dirección del envío) pasan por `PostalCodeService.resolvePostalCode` —
 * un cuerpo, así que pantalla y servidor no divergen.
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

/** Lo que una validación devuelve: la colonia, municipio y estado CANÓNICOS (los de la fuente, no lo tecleado). */
export interface CanonicalAddressPart {
  postalCode: string;
  neighborhood: string;
  city: string;
  state: string;
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
   * La validación de la dirección (§19.5, §19.20.1 paso 2): la colonia DEBE estar en la lista del CP (comparada con
   * `normalizeColonia`) y se devuelve el canónico, con `city` = municipio y `state` de ESA colonia.
   * CP desconocido ⇒ `422 POSTAL_CODE_UNKNOWN {postalCode}`; fuera de la lista ⇒ `422 NEIGHBORHOOD_NOT_IN_POSTAL_CODE
   * {postalCode, allowed}`.
   */
  async canonicalize(postalCode: string, neighborhood: string): Promise<CanonicalAddressPart> {
    const rec = await this.resolvePostalCode(postalCode);
    if (!rec) {
      throw BusinessException.validation('POSTAL_CODE_UNKNOWN', 'Unknown postal code', { postalCode });
    }
    const wanted = normalizeColonia(neighborhood);
    const hit = rec.entries.find((e) => normalizeColonia(e.neighborhood) === wanted);
    if (!hit) {
      throw BusinessException.validation('NEIGHBORHOOD_NOT_IN_POSTAL_CODE', 'Neighborhood is not in the postal code list', {
        postalCode,
        allowed: [...new Set(rec.entries.map((e) => e.neighborhood))],
      });
    }
    return { postalCode, neighborhood: hit.neighborhood, city: hit.municipality, state: hit.state };
  }
}
