/**
 * set-search-key.service.ts — §BUSCADOR-CARTAS §3: clave impresa de set (`CardSet.ptcgoCode`) para los sets de TCGCSV.
 * Rellena con `abbreviation` del grupo SOLO si la clave está vacía y ninguna otra la usa (nunca pisa la de
 * pokemontcg.io; sin repetidas ⇒ `deck-matcher` no puede pasar a `ambiguous`). Idempotente; el sync diario lo reintenta.
 * Mide cobertura «sets con cartas sin clave: k de N» (log + `GET /admin/catalog/sync-status.searchKeys`).
 */
import { Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { clearCardSearchKeysCache } from '../../common/card-search';
import { TcgcsvCatalogClient } from '../pricing/providers/tcgcsv-singles.provider';

export const SET_SEARCH_KEY_RE = /^[A-Z0-9]{2,5}$/;

/** PURO: `abbreviation` del proveedor → clave candidata o null. */
export function candidateSetKey(abbreviation: string | null | undefined): string | null {
  const k = (abbreviation ?? '').trim().toUpperCase();
  return SET_SEARCH_KEY_RE.test(k) ? k : null;
}

export interface SetKeyCoverage {
  withoutKey: number;
  total: number;
}

@Injectable()
export class SetSearchKeyService {
  private readonly logger = new Logger(SetSearchKeyService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly tcgcsv?: TcgcsvCatalogClient,
  ) {}

  /** Sets CON cartas y sin clave (nula o vacía) frente a sets con cartas. */
  async coverage(): Promise<SetKeyCoverage> {
    const [total, withKey] = await Promise.all([
      this.prisma.cardSet.count({ where: { cards: { some: {} } } }),
      this.prisma.cardSet.count({ where: { cards: { some: {} }, ptcgoCode: { not: null }, NOT: { ptcgoCode: '' } } }),
    ]);
    return { withoutKey: total - withKey, total };
  }

  /** Rellena claves de sets TCGCSV con la abreviatura del grupo. Nunca lanza (el sync no depende de esto). */
  async fillMissing(): Promise<{ filled: number; coverage: SetKeyCoverage }> {
    let filled = 0;
    try {
      if (this.tcgcsv) {
        const empty = await this.prisma.cardSet.findMany({
          where: { tcgcsvGroupId: { not: null }, OR: [{ ptcgoCode: null }, { ptcgoCode: '' }] },
          select: { id: true, tcgcsvGroupId: true },
          orderBy: { id: 'asc' },
        });
        if (empty.length > 0) {
          const groups = await this.tcgcsv.listGroups();
          const abbr = new Map(groups.map((g) => [g.groupId, candidateSetKey(g.abbreviation)]));
          const used = new Set(
            (await this.prisma.cardSet.findMany({ where: { ptcgoCode: { not: null } }, select: { ptcgoCode: true } }))
              .map((s) => (s.ptcgoCode ?? '').trim().toUpperCase())
              .filter(Boolean),
          );
          for (const s of empty) {
            const key = abbr.get(s.tcgcsvGroupId as number);
            if (!key || used.has(key)) continue;
            // CAS: solo si sigue vacía (nunca pisa la de pokemontcg.io).
            const r = await this.prisma.cardSet.updateMany({ where: { id: s.id, OR: [{ ptcgoCode: null }, { ptcgoCode: '' }] }, data: { ptcgoCode: key } });
            if (r.count === 1) {
              used.add(key);
              filled += 1;
            }
          }
        }
      }
    } catch (e) {
      this.logger.warn(`set-search-key: no se pudo rellenar claves (${(e as Error).message}); se reintenta mañana.`);
    }
    if (filled > 0) clearCardSearchKeysCache();
    const coverage = await this.coverage();
    this.logger.log(`set-search-key: ${filled} claves rellenadas; sets con cartas sin clave: ${coverage.withoutKey} de ${coverage.total}.`);
    return { filled, coverage };
  }
}
