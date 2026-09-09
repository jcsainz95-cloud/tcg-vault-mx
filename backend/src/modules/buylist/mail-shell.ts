/**
 * # §31 — EL ESQUELETO COMPARTIDO DE LOS OCHO CORREOS (v3.8 del DESIGN_SYSTEM)
 *
 * Este fichero es **la retícula, la escala y los siete patrones nombrados** de `DESIGN_SYSTEM §31`,
 * y nada más: **no conoce ni una cadena de negocio**. Quien lo usa le pasa texto PLANO y recibe
 * `<tr>`s; el escape de HTML lo hace este módulo (S15-B1), no el llamador — es la única forma de que
 * ML-10 no dependa de la disciplina de ocho plantillas.
 *
 * ## ⭐ La regla que gobierna todo el fichero (§31.2)
 * **El correo tiene que ser CORRECTO si el cliente borra el `<style>` entero.** ⇒ tablas anidadas
 * `role="presentation"`, **todo estilo en línea**, filas espaciadoras en vez de `margin`, ningún
 * `flex`/`grid`/`gap`, ningún `border-radius`, ninguna clase portadora de información. El `<style>`
 * lleva **solo** dos mejoras (el `color-scheme` y el padding de 20px por debajo de 480px) y el correo
 * es correcto sin ellas.
 *
 * ## Lo que §31 resolvió y aquí se ejecuta al pie de la letra
 * - **§31.5 — la marca es HÍBRIDA:** la mira va como `<img>` con **`alt=""`**; **`TCG HUNT` y `.mx`
 *   son TEXTO VIVO**. ⛔ La marca **jamás** viaja dentro de una imagen ni dentro de un `alt`: en
 *   Outlook de escritorio el `alt` estilizado pinta un recuadro con una cruz roja y la marca
 *   dependería del cliente. Lo vigila **ML-1, por ablación**.
 * - **§31.4 — ningún importe en la serif, NUNCA.** Georgia tiene cifras de estilo antiguo (3, 4, 5,
 *   7 y 9 bajan de la línea base). Todo el dinero sale por {@link MONEY_STYLE}, que es mono.
 * - **§31.2 — `tabular-nums` no existe en correo** ⇒ la alineación del dinero la hace **la tabla**:
 *   `<td align="right" width="130">`.
 * - **§31.2 — `text-transform` no existe en Outlook** ⇒ las versalitas llegan **YA EN MAYÚSCULAS en
 *   la cadena fuente**. ⛔ Aquí no se llama a `toUpperCase()`: el que escribe la cadena la escribe en
 *   mayúsculas, para que el barrido de homoglifos de §28.10 la vea tal cual viaja.
 * - **§31.2 — la regla punteada de §25.4.2 no sobrevive** ⇒ {@link ruleRow} es SÓLIDA.
 * - **§31.2 — `border-left` es irregular en Outlook** ⇒ la regla bermellón de la caja de términos es
 *   una **`<td width="3" bgcolor="#B31217">` dedicada** ({@link termsBoxRows}).
 * - **§31.8 — modo oscuro:** `bgcolor` (atributo) **Y** `background-color` (en línea) en **CADA**
 *   `<td>` con texto. Sin eso, la inversión parcial de Outlook.com oscurece el fondo y deja el color
 *   de texto en línea: **tinta sobre tinta, correo invisible**. Lo vigila **ML-4**.
 * - **§31.8 regla 4 — el bermellón sobre tinta es el par PROHIBIDO de §17.2 (2.5:1)** y la inversión
 *   forzada cae justo ahí ⇒ {@link ctaRows} emite **siempre** la URL en texto debajo del botón, que
 *   es la única ruta a la acción que sobrevive a cualquier inversión (ML-5).
 * - **§31.6h — en la banda de tinta del pie NO vive nada que el lector necesite.** Es marca y
 *   cortesía: sin folio, sin importe, sin plazo y sin enlace de acción.
 *
 * ## Dónde vive esto y por qué
 * El esqueleto es **de los ocho**, pero los correos 7 y 8 están en `mail/mail.templates.ts`, que es
 * de **otro work stream** («Cuentas y acceso») y **no se toca en este pase**. Por eso el fichero vive
 * en `buylist/` y no en `common/`: mover el esqueleto —y absorber el `layout()` duplicado, deuda
 * **BE-43**— es exactamente el **pase 2** de §31.15, y su disparador es que esa zona quede libre.
 * *No se adelanta aquí: un helper compartido colocado en la zona compartida por un stream que no la
 * tiene asignada es la forma educada de pisar a otro.*
 */

import { envOr } from '../mail/mail-env.util';

// =================================================================================================
// TOKENS — §31.11 no crea NI UNO: son los mismos hex de §2.2/§17.2, aplanados (sin alfa, porque
// `rgba()` en bordes no es fiable en Outlook).
// =================================================================================================
export const PAPER = '#F4F1EA';
export const WELL = '#EFEBE2';
export const INK = '#1A1A18';
export const MUTED = '#6E695E';
export const ACCENT = '#B31217';
/** `--color-border` aplanado sobre papel: reglas entre bloques. */
export const RULE = '#D1CFC8';
/** `--color-border-strong` aplanado: la regla bajo la marca y las dos rayas del lockup. */
export const RULE_STRONG = '#AEACA7';
/** Las tres líneas menores del pie sobre tinta (4.75:1, §31.11). */
export const FOOT_MUTED = '#8A857A';

// Las tres pilas de §31.4. Ninguna de nuestras familias existe en un cliente de correo: el correo se
// diseña con **Georgia / Arial / Consolas** y la webfont, si llega, mejora sin cambiar el diseño.
export const SERIF = "Georgia,'Times New Roman',serif";
export const SANS = 'Archivo,Arial,Helvetica,sans-serif';
export const MONO = "'JetBrains Mono',Consolas,Menlo,monospace";

/** `mso-line-height-rule:exactly` o Word redondea el interlineado a su gusto (§31.4). */
const LH = 'mso-line-height-rule:exactly';

/** ⭐ §31.4 — el estilo del DINERO. Mono siempre; la alineación la pone la tabla, no la fuente. */
export const MONEY_STYLE = `font-family:${MONO};font-size:15px;line-height:1.4;${LH};color:${INK}`;

/** Padding lateral de §31.3 (32px; 20px por debajo de 480px como MEJORA del `<style>`). */
const PAD_X = 32;

/**
 * §31.5b — la mira, **imagen** de 180×180 servida desde el mismo dominio del remitente (ayuda con el
 * filtro de spam) y mostrada a 72px. El fichero lo deja frontend en `public/branding/`; el origen es
 * sobreescribible por entorno para poder mirarlo en local sin tocar código.
 */
export const MAIL_MIRA_URL = `${envOr(process.env.MAIL_ASSET_ORIGIN, 'https://tcghunt.mx').replace(/\/+$/, '')}/branding/mail-mira-180.png`;

/** §17.4 — la marca visible. Va como TEXTO VIVO, nunca dentro de una imagen (§31.5a). */
export const BRAND_TEXT = 'TCG HUNT';
export const BRAND_TLD = '.mx';
export const BRAND_SITE = 'tcghunt.mx';

// =================================================================================================
// PRIMITIVAS
// =================================================================================================

/**
 * S15-B1 — escapa metacaracteres HTML de **todo** valor que entre a una plantilla (el `&` primero).
 * Vive aquí, y no en el llamador, a propósito: los builders de abajo reciben **texto plano** y no
 * aceptan HTML, así que ML-10 (un nombre `"><script>…`) no depende de que ocho plantillas se acuerden
 * de escapar. *La copia de `buylist-mail.templates.ts` importa ésta; la de `mail/` es BE-43 y es del
 * pase 2.*
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * ⭐ §31.8 regla 2 — **ninguna celda de texto sin fondo.** Toda `<td>` que este fichero emita pasa por
 * aquí, que pone `bgcolor` (atributo, para Outlook) **y** `background-color` (en línea, para el
 * resto). Es lo que impide el «correo invisible» de la inversión parcial, y lo mide ML-4.
 */
function td(bg: string, style: string, content: string, attrs = ''): string {
  return `<td${attrs ? ` ${attrs}` : ''} bgcolor="${bg}" style="background-color:${bg};${style}">${content}</td>`;
}

/** Tabla de maqueta: `role="presentation"` o el lector la anuncia como tabla de datos (§31.12). */
function table(inner: string, attrs = 'width="100%"'): string {
  return `<table role="presentation" ${attrs} cellpadding="0" cellspacing="0" border="0">${inner}</table>`;
}

/** Una fila del cuerpo, con el padding lateral de §31.3. La clase `px` es SOLO la mejora de <480px. */
function padded(content: string, padY = '0'): string {
  return `<tr>${td(PAPER, `padding:${padY} ${PAD_X}px`, content, 'class="px"')}</tr>`;
}

/** §31.3 — ritmo vertical con **filas espaciadoras**, nunca con `margin` (poco fiable en correo). */
export function spacerRow(height: 8 | 16 | 24 | 32 | 40): string {
  return `<tr>${td(PAPER, `height:${height}px;line-height:${height}px;font-size:0`, '&nbsp;', `height="${height}"`)}</tr>`;
}

/**
 * §31.2 — **regla SÓLIDA de 1px**, hecha con una celda de 1px de alto. *Corrección explícita a
 * §25.4.2: la separación entre líneas de carta no es punteada — Outlook la rellena o la ignora.*
 */
export function ruleRow(color: string = RULE): string {
  return `<tr>${td(PAPER, `padding:0 ${PAD_X}px`, table(`<tr>${td(color, 'height:1px;line-height:1px;font-size:0', '&nbsp;', 'height="1"')}</tr>`), 'class="px"')}</tr>`;
}

// =================================================================================================
// LOS PATRONES NOMBRADOS (§31.6). Se nombran una vez y se usan en los ocho.
// =================================================================================================

/**
 * **§31.5 — el bloque de marca: raya · mira · raya.**
 *
 * ⭐⭐ **La mira es imagen y el wordmark es TEXTO.** Con imágenes bloqueadas —el estado por defecto de
 * Gmail y Outlook— lo que queda es exactamente el boceto del dueño menos la mira: las dos rayas, el
 * wordmark y el `.mx`. **La marca se ve siempre, en los ocho, con imágenes o sin ellas.**
 * ⛔ `alt=""` deliberado: la mira es decorativa porque el wordmark de al lado ya porta la marca.
 * Meter `TCG HUNT` en el `alt` **es la mutación que ML-1 caza**, no un arreglo.
 */
export function brandRows(): string {
  const raya = td(RULE_STRONG, 'height:1px;line-height:1px;font-size:0', '&nbsp;', 'width="42%" height="1"');
  const mira = td(
    PAPER,
    'padding:0 16px',
    `<img src="${MAIL_MIRA_URL}" width="72" height="72" alt="" style="display:block;border:0;outline:none;text-decoration:none;width:72px;height:72px" />`,
    'align="center" width="72"',
  );
  return (
    padded(table(`<tr>${raya}${mira}${raya}</tr>`), '32px') +
    padded(
      table(
        `<tr>${td(PAPER, `font-family:${SERIF};font-size:30px;line-height:1.1;${LH};color:${INK};padding:16px 0 0`, escapeHtml(BRAND_TEXT), 'align="center"')}</tr>` +
          `<tr>${td(PAPER, `font-family:${MONO};font-size:12px;line-height:1.4;${LH};color:${MUTED};padding:4px 0 0`, escapeHtml(BRAND_TLD), 'align="center"')}</tr>`,
      ),
    ) +
    spacerRow(24) +
    ruleRow(RULE_STRONG) +
    spacerRow(24)
  );
}

/**
 * **§31.6b — eyebrow + folio**, mono 10px en versalitas, con el folio SIEMPRE visible: es la llave con
 * la que el vendedor escribirá a soporte.
 * ⚠️ `label` llega **ya en mayúsculas** (§31.2: `text-transform` no existe en Outlook). Sin folio
 * —correos 7 y 8— el eyebrow va solo: ⛔ ni se inventa un identificador ni se deja un `·` huérfano.
 */
export function eyebrowRow(label: string, folio?: string | null): string {
  const texto = folio ? `${label} · ${folio}` : label;
  return padded(
    table(
      `<tr>${td(PAPER, `font-family:${MONO};font-size:10px;line-height:1.2;${LH};font-weight:bold;letter-spacing:.18em;color:${MUTED}`, escapeHtml(texto))}</tr>`,
    ),
  );
}

/** Titular en serif: 26px en los correos 1 y 2, 22px en los otros seis (§31.4/§31.9). */
export function headingRow(text: string, size: 26 | 22 = 26): string {
  return padded(
    table(
      `<tr>${td(PAPER, `font-family:${SERIF};font-size:${size}px;line-height:1.15;${LH};font-weight:normal;color:${INK};padding:8px 0 0`, escapeHtml(text))}</tr>`,
    ),
  );
}

/** Prosa: sans 15/1.55 en tinta. Recibe texto PLANO (se escapa aquí). */
export function proseRow(text: string): string {
  return padded(
    table(
      `<tr>${td(PAPER, `font-family:${SANS};font-size:15px;line-height:1.55;${LH};color:${INK}`, escapeHtml(text))}</tr>`,
    ),
  );
}

/** Rótulo de sección (`COMPRAMOS (2)`), mono 10px versalitas. Llega en MAYÚSCULAS desde la cadena. */
export function sectionLabelRow(text: string): string {
  return padded(
    table(
      `<tr>${td(PAPER, `font-family:${MONO};font-size:10px;line-height:1.2;${LH};font-weight:bold;letter-spacing:.18em;color:${MUTED}`, escapeHtml(text))}</tr>`,
    ),
  );
}

/**
 * **§31.6c — línea de carta.** Dos columnas: a la izquierda nombre + metadatos + **la condición**; a
 * la derecha el importe, en su propia celda de ancho fijo con `align="right"` — porque
 * `tabular-nums` no existe en correo y **la alineación del dinero la hace la tabla**.
 *
 * ⛔ En `NO COMPRAMOS` la celda derecha **existe y va vacía**: jamás `MX$ 0.00` (§31.0 regla 3,
 * criterio 118). Por eso `amount` es `null`-able y **no** tiene default `'0'`.
 */
export function cardLineRows(line: {
  title: string;
  meta: string;
  /** La condición VINCULANTE. Sale de `offerTermsCopy`, no de un literal local (§31.0 regla 1). */
  note?: string | null;
  /** Importe ya formateado, o `null` si no compramos esta carta. */
  amount?: string | null;
  /** Nota sin dinero para la línea que no compramos («No entra en esta oferta»). */
  aside?: string | null;
}): string {
  const izquierda =
    `<tr>${td(PAPER, `font-family:${SANS};font-size:15px;line-height:1.4;${LH};font-weight:bold;color:${INK}`, escapeHtml(line.title))}</tr>` +
    `<tr>${td(PAPER, `font-family:${MONO};font-size:12px;line-height:1.4;${LH};color:${MUTED};padding:4px 0 0`, escapeHtml(line.meta))}</tr>` +
    (line.note
      ? `<tr>${td(PAPER, `font-family:${SANS};font-size:13px;line-height:1.5;${LH};color:${INK};padding:4px 0 0`, escapeHtml(line.note))}</tr>`
      : '') +
    (line.aside
      ? `<tr>${td(PAPER, `font-family:${SANS};font-size:13px;line-height:1.5;${LH};color:${MUTED};padding:4px 0 0`, escapeHtml(line.aside))}</tr>`
      : '');
  const derecha = td(
    PAPER,
    `${MONEY_STYLE};padding:0 0 0 12px`,
    line.amount ? escapeHtml(line.amount) : '&nbsp;',
    'align="right" valign="top" width="130"',
  );
  return padded(table(`<tr>${td(PAPER, 'padding:0', table(izquierda), 'valign="top"')}${derecha}</tr>`));
}

/**
 * **§31.6d — caja de términos.** Fondo pozo `#EFEBE2` + **`<td width="3" bgcolor="#B31217">`** a la
 * izquierda (el device `▌`, hecho a prueba de Outlook) + padding 20px. Es el **único** bloque con tono
 * de fondo del correo.
 * ⚠️ §31.8 regla 4b: la regla bermellón es **decorativa** — **el rótulo en versalitas es el portador**,
 * porque bajo inversión forzada el bermellón puede caer en el par prohibido de §17.2.
 */
export function termsBoxRows(label: string, body: string): string {
  const interior =
    `<tr>${td(WELL, `font-family:${MONO};font-size:10px;line-height:1.2;${LH};font-weight:bold;letter-spacing:.18em;color:${MUTED}`, escapeHtml(label))}</tr>` +
    `<tr>${td(WELL, `font-family:${SANS};font-size:14px;line-height:1.55;${LH};color:${INK};padding:8px 0 0`, escapeHtml(body))}</tr>`;
  return padded(
    table(
      `<tr>${td(ACCENT, 'width:3px;line-height:1px;font-size:0', '&nbsp;', 'width="3"')}${td(WELL, 'padding:20px', table(interior))}</tr>`,
    ),
  );
}

/**
 * **§31.6e — la resta.** Dos columnas, importes a la derecha en columna de ancho fijo, y **la regla
 * de TINTA de 1px encima del neto, que es la única regla de tinta del correo**. El signo `−` es
 * **texto (U+2212)**, no un borde: un borde no se lee en voz alta y no sobrevive a Outlook.
 */
export function totalsRows(
  rows: { label: string; amount: string; minus?: boolean }[],
  net: { label: string; amount: string },
): string {
  const linea = (r: { label: string; amount: string; minus?: boolean }) =>
    `<tr>` +
    td(PAPER, `font-family:${SANS};font-size:15px;line-height:1.6;${LH};color:${INK};padding:2px 0`, escapeHtml(r.label)) +
    td(
      PAPER,
      `${MONEY_STYLE};line-height:1.6;padding:2px 0 2px 12px`,
      `${r.minus ? '− ' : ''}${escapeHtml(r.amount)}`,
      'align="right" width="150"',
    ) +
    `</tr>`;
  const reglaTinta =
    `<tr>${td(PAPER, 'padding:8px 0 0', '', 'colspan="2"')}</tr>` +
    `<tr>${td(INK, 'height:1px;line-height:1px;font-size:0', '&nbsp;', 'colspan="2" height="1"')}</tr>`;
  const neto =
    `<tr>` +
    td(
      PAPER,
      `font-family:${MONO};font-size:15px;line-height:1.2;${LH};font-weight:bold;letter-spacing:.06em;color:${INK};padding:14px 0 0`,
      escapeHtml(net.label),
      'valign="bottom"',
    ) +
    td(
      PAPER,
      `font-family:${MONO};font-size:22px;line-height:1.2;${LH};font-weight:bold;color:${INK};padding:14px 0 0 12px`,
      escapeHtml(net.amount),
      'align="right" valign="bottom" width="150"',
    ) +
    `</tr>`;
  return padded(table(rows.map(linea).join('') + reglaTinta + neto));
}

/**
 * **§31.6f — la fecha límite.** La frase va en tinta y **solo el token de fecha y hora** va en mono
 * 500 y en bermellón: un fragmento en acento dentro de una frase normal, nunca el párrafo entero.
 * ⚠️ §31.8 regla 4a: **el rojo ACOMPAÑA a una frase que ya lo dice con palabras** («Tienes hasta
 * el…»), jamás la sustituye — bajo inversión forzada el rojo puede quedar ilegible.
 *
 * Recibe la frase **partida en tres** para poder pintar el token sin reescribir ni una cadena:
 * `before + token + after` es **carácter por carácter** la misma frase que va a la parte de texto.
 */
export function deadlineRow(before: string, token: string, after: string): string {
  return padded(
    table(
      `<tr>${td(
        PAPER,
        `font-family:${SANS};font-size:15px;line-height:1.55;${LH};color:${INK}`,
        `${escapeHtml(before)}<span style="font-family:${MONO};font-size:15px;font-weight:bold;color:${ACCENT}">${escapeHtml(token)}</span>${escapeHtml(after)}`,
      )}</tr>`,
    ),
  );
}

/**
 * **§31.7 + §31.6g — el CTA y su respaldo.**
 *
 * ⭐ **Bermellón si y solo si no responder cuesta dinero** (correos 1 y 2); en los otros seis, tinta.
 * Construcción a prueba de Outlook: `<td bgcolor>` con un `<a>` dentro con `color` explícito y
 * `text-decoration:none`, **radio 0**, `border:1px solid` del mismo color (le da cuerpo si el
 * `bgcolor` se pierde) y 14+16+14 = **44px de alto útil**.
 *
 * ⭐⭐ **La URL en texto debajo NO es un adorno para clientes viejos: es el respaldo del botón**
 * (§31.8 regla 4c). El par `#B31217` sobre tinta es el **prohibido** de §17.2 (2.5:1) y la inversión
 * forzada lo compone por nosotros; **la URL en texto es la única ruta a la acción que sobrevive**.
 * Lo mide ML-5, y por eso este builder **no tiene forma de emitir el botón sin la URL**.
 */
export function ctaRows(url: string, label: string, tone: 'accent' | 'ink' = 'ink'): string {
  const bg = tone === 'accent' ? ACCENT : INK;
  const boton = table(
    `<tr>${td(
      bg,
      `border:1px solid ${bg};padding:14px 28px`,
      `<a href="${escapeHtml(url)}" style="font-family:${SANS};font-size:15px;line-height:16px;${LH};font-weight:bold;letter-spacing:.06em;color:${PAPER};text-decoration:none;display:inline-block">${escapeHtml(label)}</a>`,
      'align="center"',
    )}</tr>`,
    'align="center" width="auto"',
  );
  return (
    padded(table(`<tr>${td(PAPER, 'padding:0', boton, 'align="center"')}</tr>`)) +
    padded(
      table(
        `<tr>${td(
          PAPER,
          `font-family:${MONO};font-size:12px;line-height:1.5;${LH};color:${MUTED};word-break:break-all;padding:12px 0 0`,
          escapeHtml(url),
          'align="center"',
        )}</tr>`,
      ),
    )
  );
}

/** Letra chica: sans **13px** (§31.4: «letra chica» es una jerarquía, no un tamaño ilegible). */
export function smallPrintRow(text: string): string {
  return padded(
    table(
      `<tr>${td(PAPER, `font-family:${SANS};font-size:13px;line-height:1.5;${LH};color:${MUTED}`, escapeHtml(text))}</tr>`,
    ),
  );
}

/**
 * **§31.6a — preheader.** Lo que el cliente enseña junto al asunto en la bandeja. 40–90 caracteres +
 * relleno, para que **no se cuele el principio del cuerpo**.
 * ⚠️ Manda R1 de §25.4: **en el correo 1 lleva el NETO, jamás el bruto.**
 */
function preheaderDiv(text: string): string {
  const relleno = '&zwnj;&nbsp;'.repeat(60);
  return `<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all">${escapeHtml(text)}${relleno}</div>`;
}

/**
 * **§31.6h — el pie en tinta.** Cuatro líneas: marca · descriptor · contacto · el porqué.
 * ⭐ **REGLA DURA: aquí no vive NADA que el lector necesite.** Es la superficie con más riesgo en
 * modo oscuro (es la única ya invertida) y por eso se diseña para que, si degrada, no se pierda
 * información: ⛔ ni folio, ni importe, ni plazo, ni enlace de acción.
 * ⛔ **Sin enlace de baja:** los ocho son transaccionales — no se puede «dar de baja» de la oferta que
 * uno pidió (§31.6h; correo comercial sería otra familia de plantillas y otro pase).
 */
function footerRows(descriptor: string, contacto: string, why: string): string {
  const interior =
    `<tr>${td(INK, `font-family:${SERIF};font-size:16px;line-height:1.2;${LH};color:${PAPER}`, escapeHtml(BRAND_TEXT))}</tr>` +
    `<tr>${td(INK, `font-family:${SANS};font-size:12px;line-height:1.5;${LH};color:${FOOT_MUTED};padding:8px 0 0`, escapeHtml(descriptor))}</tr>` +
    `<tr>${td(INK, `font-family:${MONO};font-size:12px;line-height:1.5;${LH};color:${FOOT_MUTED};padding:8px 0 0`, escapeHtml(contacto))}</tr>` +
    `<tr>${td(INK, `font-family:${SANS};font-size:11px;line-height:1.5;${LH};color:${FOOT_MUTED};padding:12px 0 0`, escapeHtml(why))}</tr>`;
  return `<tr>${td(INK, `padding:28px ${PAD_X}px`, table(interior), 'class="px"')}</tr>`;
}

// =================================================================================================
// EL DOCUMENTO
// =================================================================================================

export interface MailShellOptions {
  locale: 'es' | 'en';
  /** Va al `<title>`; el asunto real lo pone la plantilla. */
  title: string;
  /** §31.6a — 40–90 caracteres. En el correo 1, el NETO (R1). */
  preheader: string;
  /** Los `<tr>` del cuerpo, en el orden de §31.3 — que es **el mismo en los ocho**. */
  blocks: string[];
  /** §31.6h — **la única línea variable del pie**; el resto es idéntico en los ocho. */
  footerWhy: string;
}

/**
 * §31.6h — el descriptor de marca del pie. Es **constante en los ocho** y por eso vive aquí y no en
 * cada plantilla: si un correo describiera el negocio distinto que otro, «que todos se hablen» dejaría
 * de ser cierto en la única línea que no cambia nunca.
 */
export function footerDescriptor(locale: 'es' | 'en'): string {
  return locale === 'en'
    ? 'Buying, selling and vaulting Pokémon cards in Mexico'
    : 'Compra, venta y bóveda de cartas Pokémon en México';
}

/**
 * **§31.3 — la retícula: 600px, una columna, papel de borde a borde.**
 *
 * El fondo **fuera** de la tabla también es papel (`<body bgcolor>` + tabla exterior al 100 %): un
 * correo que flota sobre el gris del cliente pierde el papel, que es la marca (§2.1).
 *
 * ⚠️ El `<style>` lleva **exclusivamente mejoras** y el correo es correcto sin él (§31.2): el
 * `color-scheme` (que solo obedece el grupo 1 de §31.8) y el padding de 20px por debajo de 480px. ⛔
 * Ninguna clase porta información, ⛔ ninguna media query es «el plan» para el modo oscuro.
 */
export function mailShell(opts: MailShellOptions): string {
  const contacto = `${BRAND_SITE} · ${supportEmail()}`;
  const cuerpo = table(
    opts.blocks.join('') + spacerRow(32) + footerRows(footerDescriptor(opts.locale), contacto, opts.footerWhy),
    `width="600" style="width:100%;max-width:600px"`,
  );
  return (
    `<!DOCTYPE html>` +
    `<html lang="${opts.locale}" dir="ltr">` +
    `<head>` +
    `<meta charset="utf-8" />` +
    `<meta name="viewport" content="width=device-width,initial-scale=1" />` +
    `<meta name="color-scheme" content="light" />` +
    `<meta name="supported-color-schemes" content="light" />` +
    `<title>${escapeHtml(opts.title)}</title>` +
    `<style>:root{color-scheme:light;supported-color-schemes:light}` +
    `@media only screen and (max-width:480px){.px{padding-left:20px!important;padding-right:20px!important}}</style>` +
    `</head>` +
    `<body bgcolor="${PAPER}" style="margin:0;padding:0;background-color:${PAPER}">` +
    preheaderDiv(opts.preheader) +
    table(`<tr>${td(PAPER, 'padding:0', cuerpo, 'align="center"')}</tr>`) +
    `</body></html>`
  );
}

/** El buzón vivo de soporte (misma cascada que las plantillas: env → contacto de disputas → default). */
function supportEmail(): string {
  return envOr(process.env.SUPPORT_EMAIL, envOr(process.env.DISPUTE_EVIDENCE_CONTACT, 'soporte@tcghunt.mx'));
}
