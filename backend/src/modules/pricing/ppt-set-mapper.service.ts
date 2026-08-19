import { Injectable, Logger } from '@nestjs/common';
import { CardSet } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PptApiClient, PptDailyLimitError } from './providers/ppt-api.client';
import { releaseYear } from './ppt-sync-scope';

/**
 * PptSetMapper — CAUSA RAÍZ #1 del bug de producción ("0 entradas crudas → 0 filas mapeadas en TODOS
 * los sets"). El adapter mandaba `GET /api/v2/cards?setId=<externalId>` con el id de pokemontcg.io
 * (`sv8`), que PokemonPriceTracker NO reconoce como set → 0 cartas. Este servicio resuelve el `setId`
 * REAL de PPT y lo cachea en `CardSet.pptSetId`.
 *
 * Fuente: `GET /api/v2/sets` → lista con `tcgPlayerNumericId` (GroupId de TCGplayer, p. ej. "1407"),
 * `tcgPlayerId` (slug, `sv-prismatic-evolutions`), `id` (mongo), `name`, `releaseDate`. Se prefiere el
 * **GroupId numérico** como `setId` a mandar (el más estable), con el slug como respaldo.
 *
 * MATCHING (money-safe: ante ambigüedad NO se adivina):
 *  1. Por NOMBRE normalizado (minúsculas, sin no-alfanuméricos) — match exacto.
 *  2. Si el nombre casa con >1 set de PPT, se desempata por AÑO de `releaseDate`.
 *  3. Sin match único → se deja `pptSetId = null` y se LOGUEA (el barrido de ese set no se intenta).
 *
 * CACHÉ: la lista de PPT se pide UNA sola vez por instancia (memoria) y el `pptSetId` resuelto se
 * PERSISTE en BD, así que corridas siguientes no re-piden `/sets` para sets ya mapeados. `refresh`
 * fuerza re-resolver (para sets nuevos o si PPT cambió sus ids).
 */

/** Forma mínima de un set de PPT (`GET /api/v2/sets`), tolerante a nombres de campo. */
export interface PptRemoteSet {
  /** GroupId numérico de TCGplayer (preferido como setId a mandar). */
  tcgPlayerNumericId?: string | number | null;
  /** Slug de TCGplayer (`sv-prismatic-evolutions`) — respaldo. */
  tcgPlayerId?: string | null;
  /** Id mongo de PPT — último respaldo. */
  id?: string | null;
  name?: string | null;
  releaseDate?: string | null;
}

@Injectable()
export class PptSetMapper {
  private readonly logger = new Logger(PptSetMapper.name);
  private readonly setsPath = '/api/v2/sets';
  /** Caché en memoria de la lista de PPT (una carga por instancia/corrida). */
  private remoteSets: PptRemoteSet[] | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly client: PptApiClient,
  ) {}

  /**
   * Resuelve `pptSetId` para los sets dados que aún no lo tengan. Devuelve un mapa
   * `localSetId → pptSetId | null`. Persiste los resueltos. Loguea los NO mapeados. NO relanza el
   * `PptDailyLimitError` (money-safe): si la cuota diaria está agotada al pedir `/sets`, se devuelve
   * el mapa con lo que ya había en BD y se avisa; el orquestador ya parará el barrido.
   */
  async resolveForSets(sets: CardSet[]): Promise<Map<string, string | null>> {
    const out = new Map<string, string | null>();
    const pending: CardSet[] = [];
    for (const s of sets) {
      if (s.pptSetId) out.set(s.id, s.pptSetId);
      else pending.push(s);
    }
    if (pending.length === 0) return out;

    let remote: PptRemoteSet[];
    try {
      remote = await this.loadRemoteSets();
    } catch (e) {
      if (e instanceof PptDailyLimitError) {
        this.logger.warn(
          `PptSetMapper: cuota diaria agotada al pedir ${this.setsPath} → no se mapean ${pending.length} ` +
            `sets nuevos esta corrida (se usa lo ya cacheado en BD). ${e.message}`,
        );
      } else {
        this.logger.warn(
          `PptSetMapper: falló ${this.setsPath} (${(e as Error).message}) → no se mapean ${pending.length} ` +
            `sets nuevos esta corrida (money-safe: no se toca lo ya cacheado).`,
        );
      }
      for (const s of pending) out.set(s.id, s.pptSetId ?? null);
      return out;
    }

    const unmapped: string[] = [];
    for (const local of pending) {
      const pptSetId = matchSet(local, remote);
      out.set(local.id, pptSetId);
      if (pptSetId) {
        await this.prisma.cardSet.update({ where: { id: local.id }, data: { pptSetId } });
      } else {
        unmapped.push(`${local.name} (${local.externalId})`);
      }
    }
    if (unmapped.length > 0) {
      this.logger.warn(
        `PptSetMapper: ${unmapped.length}/${pending.length} sets SIN mapeo a PokemonPriceTracker ` +
          `(no se pedirán precios de ellos): ${unmapped.slice(0, 30).join(', ')}` +
          `${unmapped.length > 30 ? ', …' : ''}.`,
      );
    }
    this.logger.log(
      `PptSetMapper: resueltos ${pending.length - unmapped.length}/${pending.length} sets nuevos ` +
        `(GroupId/slug de PPT persistido en CardSet.pptSetId).`,
    );
    return out;
  }

  /** Carga (y cachea en memoria) la lista de sets de PPT. */
  private async loadRemoteSets(): Promise<PptRemoteSet[]> {
    if (this.remoteSets) return this.remoteSets;
    const res = await this.client.getJson<unknown>(this.setsPath, {});
    this.remoteSets = extractRemoteSets(res.body);
    this.logger.log(
      `PptSetMapper: ${this.setsPath} devolvió ${this.remoteSets.length} sets ` +
        `(dailyRemaining=${res.dailyRemaining ?? 'n/d'}).`,
    );
    return this.remoteSets;
  }
}

/** Extrae el array de sets del envelope v2 (`{ data: [] }` o array pelón), defensivo. */
export function extractRemoteSets(body: unknown): PptRemoteSet[] {
  if (Array.isArray(body)) return body as PptRemoteSet[];
  if (body && typeof body === 'object') {
    const o = body as Record<string, unknown>;
    for (const key of ['data', 'sets', 'results']) {
      if (Array.isArray(o[key])) return o[key] as PptRemoteSet[];
    }
  }
  return [];
}

/** Normaliza un nombre de set: minúsculas, sin no-alfanuméricos (`"Sword & Shield"` → `swordshield`). */
export function normalizeSetName(name: string | null | undefined): string {
  return (name ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Nombres normalizados con los que un set de PPT puede empatar: el nombre COMPLETO y —si trae un
 * prefijo de código de colección tipo `"ME05:"` / `"ME:"` / `"SV08:"`— también el nombre SIN ese
 * prefijo. PokemonPriceTracker prefija (`"ME05: Pitch Black"`), pero el catálogo local
 * (pokemontcg.io) NO (`"Pitch Black"`); sin esto, el match exacto fallaba para TODO set prefijado.
 */
export function setNameCandidates(remoteName: string | null | undefined): string[] {
  const full = normalizeSetName(remoteName);
  const stripped = normalizeSetName((remoteName ?? '').replace(/^\s*[A-Za-z0-9]{1,6}\s*:\s*/, ''));
  return stripped !== '' && stripped !== full ? [full, stripped] : [full];
}

/** El `setId` a mandar a PPT: GroupId numérico (preferido) → slug → mongo id. Null si ninguno sirve. */
export function pptSetIdOf(remote: PptRemoteSet): string | null {
  const numeric = remote.tcgPlayerNumericId;
  if (typeof numeric === 'number' && Number.isFinite(numeric)) return String(numeric);
  if (typeof numeric === 'string' && numeric.trim() !== '') return numeric.trim();
  if (typeof remote.tcgPlayerId === 'string' && remote.tcgPlayerId.trim() !== '') return remote.tcgPlayerId.trim();
  if (typeof remote.id === 'string' && remote.id.trim() !== '') return remote.id.trim();
  return null;
}

/**
 * Empata un `CardSet` local con un set de PPT y devuelve su `setId` a mandar, o null si no hay match
 * ÚNICO. Money-safe: por nombre normalizado exacto; si empata con varios, desempata por AÑO de
 * releaseDate; si sigue ambiguo (o ninguno), null (no se adivina).
 */
export function matchSet(local: Pick<CardSet, 'name' | 'releaseDate'>, remote: PptRemoteSet[]): string | null {
  const targetName = normalizeSetName(local.name);
  if (targetName === '') return null;

  // Empata contra el nombre completo O contra el nombre sin el prefijo de código de colección
  // (PPT: "ME05: Pitch Black" ↔ local "Pitch Black"). Money-safe: sigue exigiendo match ÚNICO;
  // el desempate por año se mantiene.
  const byName = remote.filter((r) => setNameCandidates(r.name).includes(targetName));
  if (byName.length === 1) return pptSetIdOf(byName[0]);
  if (byName.length === 0) return null;

  // Empate por nombre → desempata por año de releaseDate.
  const localYear = releaseYear(local);
  if (localYear != null) {
    const byYear = byName.filter((r) => releaseYear({ releaseDate: r.releaseDate ?? null }) === localYear);
    if (byYear.length === 1) return pptSetIdOf(byYear[0]);
  }
  return null; // ambiguo → no se adivina (money-safe)
}
