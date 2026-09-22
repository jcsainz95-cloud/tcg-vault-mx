import type { AppLocale } from '@/i18n/routing';

const localeTag: Record<AppLocale, string> = { es: 'es-MX', en: 'en-US' };

/**
 * Convierte centavos MXN a texto localizado: `MX$ 1,250.00` (DESIGN_SYSTEM §9.3).
 *
 * ⚠️⚠️ **P-98 — POR QUÉ LA NORMALIZACIÓN NO VA ANCLADA EN `^`, y es un defecto de DINERO.**
 * La versión anterior hacía `.replace(/^\$/, 'MX$')`. **Con un importe NEGATIVO el signo va
 * delante del símbolo y el ancla no dispara.** Medido con `Intl` y estos mismos parámetros
 * (Node 22, 2026-09-14):
 *
 * | locale | cents | `Intl` devuelve | con el ancla `^` | con esta versión |
 * |---|---|---|---|---|
 * | `es` | `-690` | `-$6.90` | **`-$6.90`** ⛔ | `-MX$6.90` ✅ |
 * | `es` | `690` | `$6.90` | `MX$6.90` ✅ | `MX$6.90` ✅ |
 * | `en` | `-690` | `-MX$6.90` | `-MX$6.90` ✅ | `-MX$6.90` ✅ |
 * | `en` | `690` | `MX$6.90` | `MX$6.90` ✅ | `MX$6.90` ✅ |
 *
 * ⛔ **El defecto era SOLO en español**, que es el idioma del dueño y el de su tienda, y ahí
 * **`$` a secas se lee como dólar**: un P&L en pérdida decía `-$16,855.20`. No es un detalle
 * tipográfico — es la moneda equivocada en la única cifra que duele.
 *
 * **Se arregla por PRESENCIA, no por posición:** si el texto ya trae `MX$` no se toca; si no,
 * se antepone `MX` al **primer** `$`, esté donde esté. `String.prototype.replace` con una
 * cadena sustituye solo la primera ocurrencia, y un texto sin `$` queda intacto (no-op seguro
 * si algún día `Intl` emite `MXN 6.90`).
 */
export function formatMoneyCents(cents: number, locale: AppLocale = 'es'): string {
  const value = cents / 100;
  const formatted = new Intl.NumberFormat(localeTag[locale], {
    style: 'currency',
    currency: 'MXN',
    currencyDisplay: 'symbol',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
  // Intl uses "$" for MXN in es-MX; normalise to "MX$" per DESIGN_SYSTEM.
  return formatted.includes('MX$') ? formatted : formatted.replace('$', 'MX$');
}

/**
 * Importe **con signo tipográfico**, para las cifras donde el signo ES el mensaje (el delta del
 * dial de traslación del IVA, criterio **188**).
 *
 * Vivía duplicado en `IvaTransferSection.tsx` como rodeo de **P-98**: allí se componía el signo
 * fuera del formateador **porque el formateador perdía el `MX`**. Arreglado el helper, el rodeo
 * sobraba y se unifica aquí — lo único que aporta de propio es el **menos tipográfico** `−`
 * (U+2212) en lugar del guion-menos (U+002D) que devuelve `Intl`: a tamaño de cifra el guion se
 * lee como un separador.
 *
 * ⛔ No antepone `+` a los positivos: el delta de ceder margen nunca es una ganancia que anunciar.
 */
export function formatSignedMoneyCents(cents: number, locale: AppLocale = 'es'): string {
  const abs = formatMoneyCents(Math.abs(cents), locale);
  return cents < 0 ? `−${abs}` : abs;
}

/** Fecha localizada corta: ES "13 ago 2026", EN "Aug 13, 2026". */
export function formatDate(iso: string | undefined, locale: AppLocale = 'es'): string {
  if (!iso) return '';
  const date = new Date(iso.length <= 10 ? `${iso}T00:00:00Z` : iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(localeTag[locale], {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

/**
 * **Antigüedad legible** de un instante pasado: «hace 3 días» / «3 days ago» (CA #9 de «Pedidos a
 * preparar» — el operador atiende lo más viejo primero y necesita leer la espera **de un vistazo**,
 * no restar fechas mentalmente).
 *
 * ⚠️ **Esto NO contradice el criterio 154** (que prohíbe «en 2 días» en los **plazos** del buylist).
 * Aquel prohíbe un **vencimiento futuro** relativo, porque el cliente tiene que poder confrontarlo
 * con la fecha exacta de su correo. Esto es una **antigüedad pasada** en una cola **interna**, y la
 * pantalla la pinta **junto a** la fecha absoluta (`formatDate`), nunca en su lugar.
 *
 * **Trunca, no redondea:** 3.9 días son «hace 3 días», jamás «hace 4». Una cola de trabajo que
 * exagera la espera empuja a saltarse el orden. Escalón: minutos < 1 h, horas < 1 día, luego días.
 * `numeric:'auto'` da «hoy»/«ayer»/«ahora» en vez de «hace 0 días».
 *
 * `now` es inyectable **solo para las pruebas** (la vista usa el reloj real). Entrada inválida o
 * ausente ⇒ `''` — nunca un `Invalid Date` ni una antigüedad inventada.
 */
export function formatAge(
  iso: string | null | undefined,
  locale: AppLocale = 'es',
  now: Date = new Date(),
): string {
  if (!iso) return '';
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return '';
  const rtf = new Intl.RelativeTimeFormat(localeTag[locale], { numeric: 'auto' });
  const seconds = Math.trunc((then.getTime() - now.getTime()) / 1_000);
  // Un pedido recién entrado dice «ahora», no «este minuto» (que es lo que da la unidad `minute`
  // con `numeric:'auto'` en el cero, y se lee como una etiqueta de calendario, no como una espera).
  if (Math.abs(seconds) < 60) return rtf.format(seconds, 'second');
  const minutes = Math.trunc(seconds / 60);
  if (Math.abs(minutes) < 60) return rtf.format(minutes, 'minute');
  const hours = Math.trunc(minutes / 60);
  if (Math.abs(hours) < 24) return rtf.format(hours, 'hour');
  return rtf.format(Math.trunc(hours / 24), 'day');
}

/**
 * **Fecha Y HORA explícitas, en `America/Mexico_City`** (DESIGN_SYSTEM §23.4.2 decisión 6,
 * criterio 154). Se usa en los plazos del ciclo de compra del buylist.
 *
 * ⚠️ **Tres decisiones, y las tres son de negocio, no de estilo:**
 *
 * 1. **La zona horaria es FIJA, no la del navegador.** El plazo llega del servidor **ya
 *    resuelto** en días hábiles de `America/Mexico_City`, y el correo lo imprime en esa zona.
 *    Si la pantalla lo pintara en la zona local, un vendedor de vacaciones en Madrid leería una
 *    hora distinta a la de su correo sobre **la misma fecha límite** — y §23.5a exige que la
 *    pantalla diga *exactamente* lo mismo que el correo.
 * 2. **`dateStyle:'full'` + `timeStyle:'short'`**, idénticos a `formatDateTime` de
 *    `backend/src/modules/buylist/buylist-mail.templates.ts`. Trae el día de la semana, que es
 *    lo que §23.4.2 pide y lo que evita el «en 2 días» que el criterio 154 prohíbe.
 * 3. **El front NO recalcula el plazo**, solo lo formatea: no hay aritmética de días hábiles
 *    aquí, ni cuenta atrás, ni «te quedan N horas».
 *
 * Entrada inválida ⇒ `''` (nunca una fecha inventada ni un `Invalid Date` en pantalla).
 */
export function formatDateTimeMx(iso: string | null | undefined, locale: AppLocale = 'es'): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(localeTag[locale], {
    dateStyle: 'full',
    timeStyle: 'short',
    timeZone: 'America/Mexico_City',
  }).format(date);
}
