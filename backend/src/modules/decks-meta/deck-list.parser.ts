/**
 * DECKS-META §3.2/§4 (Fase 1) — PARSER del formato de exportación Limitless / TCG Live.
 *
 * Diseño: `docs/specs/DECKS_META_ARCH.md §3.2`. Es PURO (sin I/O): come texto y devuelve líneas
 * crudas. NO empareja a `Card` (eso es `DeckMatcherService`, que usa `ptcgoCode`+`número`, NUNCA el
 * nombre). Un solo motor sirve las tres bocas: pegar-lista (H3), traído semanal (Fase 2) y curaduría
 * manual (Fase 1). Lo que no encaja se descarta como ruido; el caller decide `422` si NO hay líneas.
 *
 * Formato de una línea de carta (Limitless / TCG Live):
 *   `4 Dragapult ex TWM 130`  →  {qty:4, name:"Dragapult ex", setCode:"TWM", number:"130"}
 * El `número` admite prefijo/sufijo alfabético (`TG12`, `SV107`, `H31`), que `Card.numberPrefix` ya
 * modela (§4.22b). El `setCode` es el `ptcgoCode` del set (2–4 letras).
 *
 * Encabezados de sección (`Pokémon: 12`, `Trainer: 20`, `Energy: 8`) fijan la SECCIÓN ACTIVA de la que
 * se deriva `group`; el pie (`Total Cards: 60`) y las líneas en blanco se ignoran. Una energía BÁSICA
 * sin set/número (`8 Basic Fire Energy`) sale con `group='energy'`, `isBasicEnergy=true` y sin
 * set/número: se MARCA, no se inventa una pieza (el matcher la deja `unmatched_basic_energy`).
 */

export type ParsedGroup = 'pokemon' | 'trainer' | 'energy';

export interface ParsedLine {
  quantity: number;
  name: string;
  /** `ptcgoCode` crudo del set; `null` sólo en energía básica sin identidad. */
  setCode: string | null;
  /** número crudo dentro del set; `null` sólo en energía básica sin identidad. */
  number: string | null;
  /** Provisional, derivado de la sección activa; el matcher lo refina con `supertype` al casar. */
  group: ParsedGroup;
  /** `true` = energía básica sin set/número ⇒ siempre legal, pero se marca, no se vende como línea. */
  isBasicEnergy: boolean;
}

export interface ParseResult {
  lines: ParsedLine[];
}

// Línea de carta con identidad: `<qty> <name> <SETCODE 2-4 letras> <número alfanumérico>`.
// `name` es no-greedy y se ancla contra el setCode+número finales, así absorbe nombres con espacios,
// apóstrofes y sufijos como "ex"/"V"/"VMAX".
const CARD_LINE = /^\s*(\d+)\s+(.+?)\s+([A-Za-z]{2,4})\s+([A-Za-z]*\d+[A-Za-z]*)\s*$/;

// Energía (básica o cualquiera) sin set/número: `<qty> <...> Energy`. Sólo se prueba DESPUÉS de que
// `CARD_LINE` falla, así que una energía especial con set+número (`3 Reversal Energy PAL 192`) ya se
// llevó por la rama con identidad y NO cae aquí.
const BASIC_ENERGY_LINE = /^\s*(\d+)\s+(.*\bEnergy)\s*$/i;

// Encabezado de sección: empieza por el nombre de la sección (NO por un dígito) y fija `group`.
const SECTION_HEADER = /^\s*(Pok[eé]mon|Trainer|Energy)\b/i;

function sectionToGroup(raw: string): ParsedGroup {
  const s = raw.toLowerCase();
  if (s.startsWith('trainer')) return 'trainer';
  if (s.startsWith('energy')) return 'energy';
  return 'pokemon'; // "Pokémon" / "pokemon"
}

/**
 * Parsea el texto de una lista a líneas crudas. No lanza: un texto sin líneas válidas devuelve
 * `{ lines: [] }` y el caller (p. ej. `POST /decks-meta/paste`) responde `422 DECK_LIST_UNPARSEABLE`.
 */
export function parseDeckList(text: string): ParseResult {
  const lines: ParsedLine[] = [];
  if (!text) return { lines };

  // Sin encabezado visto aún, las cartas con identidad caen a 'pokemon' (default conservador).
  let activeGroup: ParsedGroup = 'pokemon';

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '') continue;

    // Una línea de carta SIEMPRE empieza por un dígito (la cantidad). Si no, sólo puede ser un
    // encabezado de sección (que fija `group`) o ruido/pie (que se ignora).
    if (!/^\d/.test(line)) {
      const header = SECTION_HEADER.exec(line);
      if (header) activeGroup = sectionToGroup(header[1]);
      continue; // "Total Cards: 60" y cualquier otra línea no numérica se ignoran.
    }

    const card = CARD_LINE.exec(line);
    if (card) {
      lines.push({
        quantity: Number(card[1]),
        name: card[2].trim(),
        setCode: card[3],
        number: card[4],
        group: activeGroup,
        isBasicEnergy: false,
      });
      continue;
    }

    // No casó como carta con identidad: ¿energía básica sin set/número?
    const energy = BASIC_ENERGY_LINE.exec(line);
    if (energy) {
      lines.push({
        quantity: Number(energy[1]),
        name: energy[2].trim(),
        setCode: null,
        number: null,
        group: 'energy', // una básica es energía aunque no haya encabezado de sección
        isBasicEnergy: true,
      });
      continue;
    }

    // Cualquier otra línea que empiece por dígito pero no encaje se descarta como ruido.
  }

  return { lines };
}
