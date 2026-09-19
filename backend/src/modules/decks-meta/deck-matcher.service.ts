import { Injectable } from '@nestjs/common';
import { Card, CardSet, MetaCardGroup, MetaMatchStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ParsedLine, ParsedGroup } from './deck-list.parser';

/**
 * DECKS-META §3.2 (Fase 1) — el MATCHER, el corazón (R3).
 *
 * Empareja cada línea cruda contra nuestra `Card` por el ÚNICO identificador fiable:
 * **`CardSet.ptcgoCode` + `Card.number`** — NUNCA por el nombre (dos impresiones comparten nombre; el
 * nombre del export puede venir mal escrito). Diseño: `docs/specs/DECKS_META_ARCH.md §3.2`.
 *
 * Regla dura del dueño: lo que NO casa se PERSISTE con su `matchStatus` y se muestra como «no
 * identificada»; **jamás se inventa** una carta ni un precio. Lee en LOTE (una query de sets + una de
 * cartas por lista), sin N+1.
 */

/** Una línea ya emparejada: el crudo para persistir + la `Card` casada (o `null`) para valorar. */
export interface MatchedLine {
  quantity: number;
  rawName: string;
  /** `ptcgoCode` crudo; `''` para energía básica sin identidad (la columna es NOT NULL). */
  rawSetCode: string;
  /** número crudo; `''` para energía básica sin identidad. */
  rawNumber: string;
  group: MetaCardGroup;
  matchStatus: MetaMatchStatus;
  /** La `Card` (con su set) cuando `matchStatus === 'matched'`; `null` en cualquier otro caso. */
  matchedCard: (Card & { set: CardSet }) | null;
}

const PARSED_TO_PRISMA_GROUP: Record<ParsedGroup, MetaCardGroup> = {
  pokemon: MetaCardGroup.pokemon,
  trainer: MetaCardGroup.trainer,
  energy: MetaCardGroup.energy,
};

/** Refina el grupo desde el `supertype` crudo del proveedor; si no se reconoce, respeta el del parser. */
function groupFromSupertype(supertype: string | null, fallback: MetaCardGroup): MetaCardGroup {
  const s = (supertype ?? '').toLowerCase();
  if (s.startsWith('pok')) return MetaCardGroup.pokemon; // "Pokémon"
  if (s.startsWith('trainer')) return MetaCardGroup.trainer;
  if (s.startsWith('energy')) return MetaCardGroup.energy;
  return fallback;
}

/**
 * Normaliza un número para el reintento tolerante (§3.2 paso 2): un número puramente numérico pierde
 * los ceros a la izquierda (`004` ↔ `4`); uno con prefijo/sufijo alfabético (`TG12`, `SV107`) se
 * compara en mayúsculas SIN tocar sus dígitos, para no colisionar prefijos distintos.
 */
function normalizeNumber(n: string): string {
  const t = n.trim();
  if (/^\d+$/.test(t)) return String(parseInt(t, 10)); // quita ceros a la izquierda
  return t.toUpperCase();
}

@Injectable()
export class DeckMatcherService {
  constructor(private readonly prisma: PrismaService) {}

  async matchLines(lines: ParsedLine[]): Promise<MatchedLine[]> {
    if (lines.length === 0) return [];

    // Las líneas con identidad (todo menos la energía básica) alimentan las lecturas en lote.
    const identityLines = lines.filter((l) => !l.isBasicEnergy && l.setCode && l.number);
    const wantedCodes = new Set(identityLines.map((l) => l.setCode!.trim().toUpperCase()));

    // 1) SETS por ptcgoCode (case-insensitive): traemos los que tienen ptcgoCode y mapeamos en memoria
    //    por MAYÚSCULAS. El universo de sets es pequeño; una sola query. Un ptcgoCode puede colisionar
    //    entre varios sets ⇒ el mapa guarda una LISTA.
    const setsByCode = new Map<string, CardSet[]>();
    if (wantedCodes.size > 0) {
      const allSets = await this.prisma.cardSet.findMany({ where: { ptcgoCode: { not: null } } });
      for (const s of allSets) {
        const code = (s.ptcgoCode ?? '').trim().toUpperCase();
        if (!code || !wantedCodes.has(code)) continue;
        const arr = setsByCode.get(code) ?? [];
        arr.push(s);
        setsByCode.set(code, arr);
      }
    }

    // 2) CARTAS candidatas en UNA query, POR setId (no por número): la BD guarda `130`/`004`/`TG12`
    //    tal cual, y el emparejado tolerante normaliza AMBOS lados en memoria (un `IN` sobre el número
    //    pedido no encontraría un `004` guardado cuando la lista pide `4`). El universo son las cartas
    //    de los pocos sets referenciados por la lista ⇒ una sola query acotada por setId.
    const candidateSetIds = new Set<string>();
    for (const arr of setsByCode.values()) for (const s of arr) candidateSetIds.add(s.id);
    let candidateCards: (Card & { set: CardSet })[] = [];
    if (candidateSetIds.size > 0) {
      candidateCards = (await this.prisma.card.findMany({
        where: { setId: { in: [...candidateSetIds] } },
        include: { set: true },
      })) as (Card & { set: CardSet })[];
    }
    // Índice (setId, númeroNormalizado) → Card[] para el emparejado tolerante.
    const cardsByKey = new Map<string, (Card & { set: CardSet })[]>();
    for (const c of candidateCards) {
      const key = `${c.setId}::${normalizeNumber(c.number)}`;
      const arr = cardsByKey.get(key) ?? [];
      arr.push(c);
      cardsByKey.set(key, arr);
    }

    return lines.map((line): MatchedLine => {
      const provisionalGroup = PARSED_TO_PRISMA_GROUP[line.group];

      // Energía básica sin identidad: se marca, no se empareja ni se inventa.
      if (line.isBasicEnergy || !line.setCode || !line.number) {
        return {
          quantity: line.quantity,
          rawName: line.name,
          rawSetCode: line.setCode ?? '',
          rawNumber: line.number ?? '',
          group: MetaCardGroup.energy,
          matchStatus: MetaMatchStatus.unmatched_basic_energy,
          matchedCard: null,
        };
      }

      const base: Omit<MatchedLine, 'matchStatus' | 'matchedCard' | 'group'> = {
        quantity: line.quantity,
        rawName: line.name,
        rawSetCode: line.setCode,
        rawNumber: line.number,
      };

      const code = line.setCode.trim().toUpperCase();
      const setsForCode = setsByCode.get(code);
      if (!setsForCode || setsForCode.length === 0) {
        return { ...base, group: provisionalGroup, matchStatus: MetaMatchStatus.unmatched_set, matchedCard: null };
      }

      // Buscar la carta en cualquiera de los setIds de ese ptcgoCode, por número normalizado.
      const numKey = normalizeNumber(line.number);
      const hits: (Card & { set: CardSet })[] = [];
      for (const s of setsForCode) {
        const found = cardsByKey.get(`${s.id}::${numKey}`);
        if (found) hits.push(...found);
      }

      if (hits.length === 0) {
        return { ...base, group: provisionalGroup, matchStatus: MetaMatchStatus.unmatched_number, matchedCard: null };
      }
      if (hits.length > 1) {
        // Varias candidatas (colisión de ptcgoCode o de número): NO se auto-resuelve, se marca.
        return { ...base, group: provisionalGroup, matchStatus: MetaMatchStatus.ambiguous, matchedCard: null };
      }

      const card = hits[0];
      return {
        ...base,
        group: groupFromSupertype(card.supertype, provisionalGroup),
        matchStatus: MetaMatchStatus.matched,
        matchedCard: card,
      };
    });
  }
}
