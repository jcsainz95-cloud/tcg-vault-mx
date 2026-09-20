/**
 * DECKS-META Fase 2 — PARSERS de HTML de Limitless (PUROS, sin I/O). Norma: spec §2.
 *
 * Tres parsers, tres niveles de confianza:
 *  - `parseHomeIndex`  — VERIFICADO contra `home-index.html` (§2.1). Da formatCode + bloques `.leader`.
 *  - `parseArchetypePage` — VERIFICADO contra `archetype-284.html` (§2.2). Metadata + `core-card`
 *    (~18); ⛔ NUNCA sirve para las 60 (se documenta para dejar por escrito por qué NO se usa).
 *  - `parseDeckListHtml` — DOCUMENTADO, sin fixture (§2.3, supuesto A1). Emite la MISMA `ParsedLine[]`
 *    que el parser de texto de Fase 1, así que alimenta el matcher intacto. Es la pieza que el
 *    DRY-RUN de prod valida/ajusta; por eso está AISLADA y a la DEFENSIVA (0 asunciones duras).
 *
 * Seguridad (§9): cheerio es tree-based — NO ejecuta scripts, NO hace red, NO `eval`. El HTML crudo
 * jamás se persiste; sólo salen campos tipados y acotados.
 */
import { Logger } from '@nestjs/common';
import { load, type CheerioAPI } from 'cheerio';
import type { AnyNode, Element } from 'domhandler';
import type { ParsedLine, ParseResult, ParsedGroup } from './deck-list.parser';
import { isValidLimitlessId, isValidFormatCode } from './limitless.config';

/** Sólo para avisos de procedencia (p. ej. discrepancia de formato h2/href, §2.1). Sin I/O de red. */
const logger = new Logger('LimitlessHtmlParser');

// ── Home index (§2.1) ─────────────────────────────────────────────────────────────────────────────

/** Un bloque `.leader` de la home. Campos `null` cuando el markup no los trae (el canary decide). */
export interface HomeLeader {
  archetypeId: string | null;
  name: string | null;
  rank: number | null;
  sharePct: number | null;
  listId: string | null;
  sourceTournament: string | null;
}

export interface HomeIndexResult {
  /** Código de formato del `<h2>Top Decks (CODE)</h2>` (respaldo: enlace de ranking). Validado. */
  formatCode: string | null;
  leaders: HomeLeader[];
  /** Total de bloques `.leader` vistos (para C5: home parseable). */
  totalBlocks: number;
}

const RANK_NAME = /^(\d+)\.\s*(.+)$/;
const SHARE = /([\d.]+)\s*%/;
const FORMAT_IN_H2 = /Top Decks\s*\(([A-Za-z-]+)\)/;
const FORMAT_IN_HREF = /[?&]format=([A-Za-z-]+)/;

export function parseHomeIndex(html: string): HomeIndexResult {
  const $ = load(html);

  // formatCode: la FUENTE DE VERDAD es el <h2>Top Decks (CODE)</h2> (§2.1); el enlace de ranking
  // («/decks?format=CODE») es sólo RESPALDO. Se derivan ambos por separado para poder avisar si
  // difieren (posible cambio de markup del tercero): gana el <h2>, pero la discrepancia se loguea.
  let h2Format: string | null = null;
  $('h2').each((_i, el) => {
    if (h2Format) return;
    const m = FORMAT_IN_H2.exec($(el).text());
    if (m && isValidFormatCode(m[1])) h2Format = m[1];
  });

  let hrefFormat: string | null = null;
  const rankingHref = $('a[href*="/decks?format="]').first().attr('href') ?? '';
  const hm = FORMAT_IN_HREF.exec(rankingHref);
  if (hm && isValidFormatCode(hm[1])) hrefFormat = hm[1];

  if (h2Format && hrefFormat && h2Format !== hrefFormat) {
    logger.warn(`formatCode discrepancia: <h2>=${h2Format} vs href=${hrefFormat}; gana el <h2> (§2.1).`);
  }
  const formatCode: string | null = h2Format ?? hrefFormat;

  // Bloques: `div.top-leaders > div.leader` (§2.1). Descendiente (superset tolerante); respaldo `.leader`.
  let blocks = $('.top-leaders .leader');
  if (blocks.length === 0) blocks = $('.leader');

  const leaders: HomeLeader[] = [];
  blocks.each((_i, el) => {
    leaders.push(parseLeaderBlock($, el));
  });

  return { formatCode, leaders, totalBlocks: blocks.length };
}

function parseLeaderBlock($: CheerioAPI, el: AnyNode): HomeLeader {
  const block = $(el);

  // archetypeId: a.leader-details (o a.leader-image) href → /decks/<id>
  const detailsHref = block.find('a.leader-details').first().attr('href') ?? '';
  const imageHref = block.find('a.leader-image').first().attr('href') ?? '';
  const archetypeId = matchId(detailsHref, /^\/decks\/(\d+)\/?$/) ?? matchId(imageHref, /^\/decks\/(\d+)\/?$/);

  // rank + nombre: a.leader-details div.text-lg.font-bold → "1. Dragapult"
  const nameRaw = block.find('a.leader-details div.text-lg.font-bold').first().text().trim();
  let rank: number | null = null;
  let name: string | null = null;
  const rn = RANK_NAME.exec(nameRaw);
  if (rn) {
    rank = Number(rn[1]);
    name = rn[2].trim();
  } else if (nameRaw) {
    name = nameRaw;
  }

  // share %: el div dentro de leader-details cuyo texto trae un porcentaje.
  let sharePct: number | null = null;
  block.find('a.leader-details div').each((_i, d) => {
    if (sharePct != null) return;
    const m = SHARE.exec($(d).text());
    if (m) {
      const v = Number(m[1]);
      if (Number.isFinite(v)) sharePct = v;
    }
  });

  // listId: a.leader-decklist href → /decks/list/<id>
  const decklistAnchor = block.find('a.leader-decklist').first();
  const listId = matchId(decklistAnchor.attr('href') ?? '', /^\/decks\/list\/(\d+)\/?$/);

  // Descripción de la lista: el div de leader-decklist SIN `.text-sm` (el `.text-sm` es "Featured Decklist").
  const tournamentDiv = decklistAnchor.find('div').not('.text-sm').last();
  const sourceTournament = tournamentDiv.length > 0 ? tournamentDiv.text().trim() || null : null;

  return { archetypeId, name, rank, sharePct, listId, sourceTournament };
}

function matchId(value: string, re: RegExp): string | null {
  const m = re.exec(value.trim());
  return m && isValidLimitlessId(m[1]) ? m[1] : null;
}

// ── Página de arquetipo (§2.2) — metadata + core-card (NUNCA las 60) ──────────────────────────────

export interface ArchetypePageResult {
  name: string | null;
  /** Cartas núcleo `div.deck-core > div.core-card img.card[data-set][data-number]` (~18; insuficiente). */
  coreCards: { setCode: string; number: string }[];
}

export function parseArchetypePage(html: string): ArchetypePageResult {
  const $ = load(html);
  const name = $('h1.name').first().text().trim() || null;
  const coreCards: { setCode: string; number: string }[] = [];
  $('div.deck-core div.core-card img.card[data-set][data-number]').each((_i, el) => {
    const setCode = ($(el).attr('data-set') ?? '').trim();
    const number = ($(el).attr('data-number') ?? '').trim();
    if (setCode && number) coreCards.push({ setCode, number });
  });
  return { name, coreCards };
}

// ── Página de lista completa (§2.3) — las 60. DOCUMENTADO, sin fixture (A1). ──────────────────────

const GROUP_HEADER = /^\s*(Pok[eé]mon|Trainer|Energy)\b/i;

function sectionToGroup(raw: string): ParsedGroup {
  const s = raw.toLowerCase();
  if (s.startsWith('trainer')) return 'trainer';
  if (s.startsWith('energy')) return 'energy';
  return 'pokemon';
}

/**
 * Parsea la lista completa a `ParsedLine[]`. DEFENSIVO por diseño (§2.3 es estructura DOCUMENTADA, no
 * verificada): recorre el árbol en orden de documento; una `.decklist-card` es una HOJA (no se
 * desciende a sus spans, para que un `card-name` como «Energy Search» no se confunda con un
 * encabezado de sección); el `group` lo fija el encabezado de columna «Pokémon (N) / Trainer (N) /
 * Energy (N)». El `group` es PROVISIONAL: el matcher de Fase 1 lo refina con el `supertype` de la
 * carta casada, así que un fallo de detección de columna sólo afecta el display de líneas NO casadas.
 * Una energía básica (`data-basic-energy`, o sin `data-set`/`data-number`) sale `isBasicEnergy=true`
 * y cuenta para las 60 por su `quantity` (nunca casa, y eso es correcto).
 */
export function parseDeckListHtml(html: string): ParseResult {
  const $ = load(html);
  const lines: ParsedLine[] = [];
  let activeGroup: ParsedGroup = 'pokemon';

  const walk = (node: AnyNode): void => {
    if (node.type !== 'tag') return;
    const el = $(node);

    if (el.is('.decklist-card')) {
      const line = cardToLine($, node);
      if (line) lines.push({ ...line, group: line.isBasicEnergy ? 'energy' : activeGroup });
      return; // HOJA: no descender a los spans internos de la carta.
    }

    // Encabezado de columna: SÓLO si su texto empieza por la sección Y NO contiene cartas dentro
    // (así el <div> contenedor de toda la columna no se toma por encabezado; sí su título).
    const text = el.text().trim();
    if (GROUP_HEADER.test(text) && el.find('.decklist-card').length === 0) {
      const m = GROUP_HEADER.exec(text);
      if (m) activeGroup = sectionToGroup(m[1]);
    }

    const children = (node as Element).children ?? [];
    for (const child of children) walk(child);
  };

  const root = $.root()[0] as AnyNode;
  const rootChildren = (root as Element).children ?? [];
  for (const child of rootChildren) walk(child);

  return { lines };
}

/** Una `.decklist-card` → `ParsedLine` (o `null` si no trae cantidad válida ⇒ ruido). */
function cardToLine($: CheerioAPI, node: AnyNode): ParsedLine | null {
  const el = $(node);
  const dataSet = (el.attr('data-set') ?? '').trim();
  const dataNumber = (el.attr('data-number') ?? '').trim();
  const basicEnergy = el.attr('data-basic-energy');

  const countText = el.find('span.card-count').first().text().trim();
  const quantity = Number(countText);
  if (!Number.isInteger(quantity) || quantity <= 0) return null;

  const name = el.find('span.card-name').first().text().trim();

  // Energía básica: sin set/número (o marcada `data-basic-energy`). Se marca, no se inventa.
  if (basicEnergy != null || !dataSet || !dataNumber) {
    return {
      quantity,
      name: name || 'Basic Energy',
      setCode: null,
      number: null,
      group: 'energy',
      isBasicEnergy: true,
    };
  }

  return { quantity, name, setCode: dataSet, number: dataNumber, group: 'pokemon', isBasicEnergy: false };
}
