/**
 * sepomex-parse.ts — lee el catálogo nacional de códigos postales de SEPOMEX (Correos de México) en su formato
 * TXT («CPdescarga.txt»: una línea de aviso, una cabecera `d_codigo|d_asenta|…` y una fila por asentamiento,
 * separada por `|`) y lo convierte en las filas de `PostalCode` (M-64). Puro: no toca red ni base.     · devops
 *
 * Reglas (DEVOPS_NOTES §79):
 *  - Codificación: si el fichero es UTF-8 válido se lee como UTF-8; si no, como Latin-1/Windows-1252 (lo que
 *    publica SEPOMEX). Se informa cuál se usó.
 *  - Las columnas se buscan por NOMBRE en la cabecera (`d_codigo`, `d_asenta`, `d_mnpio`, `d_estado`), no por
 *    posición: si SEPOMEX reordena, sigue funcionando; si quita una, falla.
 *  - ESTRUCTURA estricta: una fila con otro número de campos que la cabecera (línea cortada, fichero corrupto) ⇒
 *    ERROR con su número de línea. Un fichero roto a mitad no se carga «hasta donde se pudo»: no se carga.
 *  - FILAS inválidas (API_CONTRACT §M4-SHIP.19.23.6, C-GEO-1 (1)): CP que no es `^\d{5}$`, campo vacío tras trim o
 *    carácter ilegible, TAB/CR/LF dentro de un valor (§19.24.3) ⇒ la fila se DESCARTA y se cuenta por motivo
 *    (`discarded`); el importador imprime los motivos.
 *  - `neighborhood` se guarda tal cual la fuente (solo `trim`): es el canónico (§19.5). La unicidad de la tabla es
 *    `(postalCode, neighborhood)`; SEPOMEX repite nombre dentro de un CP cuando cambia el tipo de asentamiento
 *    (p. ej. «Centro» colonia y «Centro» barrio). Se queda la PRIMERA y se cuentan las descartadas.
 */

export interface PostalCodeRow {
  postalCode: string;
  state: string;
  municipality: string;
  neighborhood: string;
}

export interface ParseResult {
  rows: PostalCodeRow[];
  encoding: 'utf-8' | 'latin1';
  sourceLines: number; // filas de datos leídas (sin aviso ni cabecera ni vacías)
  duplicatesDropped: number; // (CP, colonia) repetidas exactas
  duplicatesWithOtherMunicipality: number; // de ésas, las que traían otro municipio/estado (se avisa)
  discarded: Record<DiscardReason, number>; // filas inválidas descartadas, por motivo
  stats: CatalogStats;
}

export type DiscardReason = 'cp_no_5_digitos' | 'campo_vacio' | 'caracter_ilegible' | 'separador_en_campo';

export interface CatalogStats {
  postalCodes: number;
  neighborhoods: number;
  municipalities: number;
  states: number;
}

export class SepomexParseError extends Error {
  constructor(message: string, readonly line?: number) {
    super(line ? `línea ${line}: ${message}` : message);
    this.name = 'SepomexParseError';
  }
}

const REQUIRED = { postalCode: 'd_codigo', neighborhood: 'd_asenta', municipality: 'd_mnpio', state: 'd_estado' } as const;
const CP_RE = /^\d{5}$/;

export function decode(buf: Buffer): { text: string; encoding: 'utf-8' | 'latin1' } {
  if (buf.length >= 2 && buf[0] === 0x50 && buf[1] === 0x4b) {
    throw new SepomexParseError('esto es un ZIP: descomprímelo primero (unzip CPdescarga.zip ⇒ CPdescarga.txt)');
  }
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
    return { text: text.replace(/^﻿/, ''), encoding: 'utf-8' };
  } catch {
    // WHATWG «latin1» = windows-1252: superconjunto de ISO-8859-1 en lo que SEPOMEX usa (á é í ó ú ü ñ).
    return { text: new TextDecoder('latin1').decode(buf), encoding: 'latin1' };
  }
}

export function computeStats(rows: PostalCodeRow[]): CatalogStats {
  return {
    postalCodes: new Set(rows.map((r) => r.postalCode)).size,
    neighborhoods: rows.length,
    municipalities: new Set(rows.map((r) => `${r.state}|${r.municipality}`)).size,
    states: new Set(rows.map((r) => r.state)).size,
  };
}

export function parseSepomex(buf: Buffer): ParseResult {
  const { text, encoding } = decode(buf);
  if (/^\s*</.test(text)) {
    throw new SepomexParseError('parece XML/HTML: descarga el formato «TXT» de SEPOMEX, no XML ni Excel');
  }
  const lines = text.split(/\r?\n/);
  const headerIdx = lines.findIndex((l) => l.split('|').map((c) => c.trim().toLowerCase()).includes(REQUIRED.postalCode));
  if (headerIdx < 0) {
    throw new SepomexParseError(`no encuentro la cabecera con «${REQUIRED.postalCode}» (¿es el TXT de SEPOMEX?)`);
  }
  const header = lines[headerIdx].split('|').map((c) => c.trim().toLowerCase());
  const col = {} as Record<keyof typeof REQUIRED, number>;
  for (const [k, name] of Object.entries(REQUIRED) as [keyof typeof REQUIRED, string][]) {
    const i = header.indexOf(name.toLowerCase());
    if (i < 0) throw new SepomexParseError(`falta la columna «${name}» en la cabecera`, headerIdx + 1);
    col[k] = i;
  }

  const seen = new Map<string, PostalCodeRow>();
  const rows: PostalCodeRow[] = [];
  let sourceLines = 0;
  let duplicatesDropped = 0;
  let duplicatesWithOtherMunicipality = 0;
  const discarded: Record<DiscardReason, number> = { cp_no_5_digitos: 0, campo_vacio: 0, caracter_ilegible: 0, separador_en_campo: 0 };
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const raw = lines[i];
    if (raw.trim() === '') continue;
    const lineNo = i + 1;
    const f = raw.split('|');
    // Un `|` final (campo vacío de más) se tolera; menos campos = línea cortada ⇒ error.
    if (f.length === header.length + 1 && f[f.length - 1].trim() === '') f.pop();
    if (f.length !== header.length) {
      throw new SepomexParseError(`${f.length} campos, la cabecera tiene ${header.length} (¿fichero cortado o corrupto?)`, lineNo);
    }
    const row: PostalCodeRow = {
      postalCode: f[col.postalCode].trim(),
      neighborhood: f[col.neighborhood].trim(),
      municipality: f[col.municipality].trim(),
      state: f[col.state].trim(),
    };
    sourceLines++;
    const fields = [row.neighborhood, row.municipality, row.state];
    if (!CP_RE.test(row.postalCode)) {
      discarded.cp_no_5_digitos++;
      continue;
    }
    if (fields.some((v) => v === '')) {
      discarded.campo_vacio++;
      continue;
    }
    if (fields.some((v) => v.includes('\uFFFD'))) {
      discarded.caracter_ilegible++;
      continue;
    }
    // TAB/CR/LF dentro de un valor romperían la serialización canónica de `setDigest` (API_CONTRACT §M4-SHIP.19.24.3).
    if (fields.some((v) => /[\t\r\n]/.test(v))) {
      discarded.separador_en_campo++;
      continue;
    }
    const key = `${row.postalCode}|${row.neighborhood}`;
    const prev = seen.get(key);
    if (prev) {
      duplicatesDropped++;
      if (prev.municipality !== row.municipality || prev.state !== row.state) duplicatesWithOtherMunicipality++;
      continue;
    }
    seen.set(key, row);
    rows.push(row);
  }
  if (rows.length === 0) throw new SepomexParseError('el fichero no trae ninguna fila de datos');
  return { rows, encoding, sourceLines, duplicatesDropped, duplicatesWithOtherMunicipality, discarded, stats: computeStats(rows) };
}
