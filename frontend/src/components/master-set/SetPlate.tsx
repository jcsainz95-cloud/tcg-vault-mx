'use client';

import { useState } from 'react';
import { cn } from '@/lib/cn';

// ===== DESIGN_SYSTEM §24.5 — el monograma (derivación de PRESENTACIÓN, no un dato) =====
// Palabras que no aportan inicial. Se comparan en minúsculas.
const MONOGRAM_STOP_WORDS = new Set(['and', 'of', 'the']);

/**
 * Iniciales de las palabras significativas del nombre del set, mayúsculas, máximo 3:
 * `Surging Sparks` → `SS`, `Journey Together` → `JT`, `Scarlet & Violet` → `SV` (el `&` cae al
 * quedarse sin letras). Si salen menos de 2 caracteres (nombres numéricos como `151`), se usan los
 * 3 PRIMEROS caracteres del nombre.
 *
 * §24.5 «Regla de propiedad»: esto es una derivación del front (mismo estatuto que el mapa
 * rareza→grupo de §7.16a). No es un dato, no lo manda el backend y **da igual que dos sets
 * compartan iniciales**: el nombre completo va justo debajo (R2).
 */
export function setMonogram(name: string): string {
  const words = name
    .split(/\s+/)
    // Se limpia la puntuación (`Celebrations:` → `Celebrations`, `&` → ``) y lo que quede vacío cae.
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter((w) => w.length > 0 && !MONOGRAM_STOP_WORDS.has(w.toLowerCase()));
  const initials = words.map((w) => w[0]).join('').toUpperCase();
  if (initials.length >= 2) return initials.slice(0, 3);
  return name.trim().slice(0, 3).toUpperCase();
}

/**
 * §24.2.d — el CONTORNO DE TINTA (v2.10). Hasta v2.8 este mismo dispositivo era de PAPEL sobre la
 * placa de tinta; v2.10 lo gira: mismo mecanismo, color invertido. Sigue siendo un dispositivo de
 * LEGIBILIDAD, no de elevación (§4.3): offset 0, radio 1px, color siempre `--color-ink`, y SOLO
 * sobre el `<img>` del logo dentro del pozo.
 *
 * TRES pasadas, no las dos de v2.8, y el número no es decorativo: cada pasada compone sobre el
 * resultado de la anterior, así que **sube el alfa del filete sin ensancharlo**. Un halo de papel
 * al ~50 % SOBRE TINTA ya saltaba a ~7:1 (dos pasadas sobraban); un filete de tinta al ~50 % SOBRE
 * PAPEL compone hacia `#878577` ⇒ ~3,0:1, que se lee como sombra, no como borde. Con tres, el
 * anillo interior sube a ≈`#3E3C36` ⇒ ~8:1 contra el papel (§24.2.d).
 *
 * Es OBLIGATORIO (§24.12 nº11), y desde v2.10 por una razón MÁS FUERTE que en v2.8: sobre el pozo
 * claro el contorno es **el mecanismo** que sostiene la silueta de los logos CLAROS —el caso
 * común—, no un seguro silencioso para el logo oscuro raro. Quitarlo devuelve la retícula al fallo
 * original (el filete blanco horneado del PNG se funde con el papel y el logo pierde su silueta).
 *
 * La ÚNICA palanca autorizada es el NÚMERO de pasadas, rango 2–4 (§24.2.d, §24.12 nº12/nº14): el
 * RADIO se queda en 1px pase lo que pase —un contorno desenfocado sobre papel se lee como
 * suciedad— y el color en `var(--color-ink)`. Y no es «recolorear el logo» (§24.12 nº1):
 * `drop-shadow` pinta DETRÁS, sobre el canal alfa, sin tocar un píxel del arte del tercero.
 *
 * ⚠️ Límite honesto (§24.2.c): `drop-shadow` traza el canal alfa. Con un borde de alfa BLANDO
 * (logos con brillo/glow horneado) no hay borde que trazar y el resultado es una mancha suave, no
 * un filete — a ese logo el contorno le ayuda poco y no hay arreglo dentro de estas reglas.
 */
const LOGO_OUTLINE_PASS = 'drop-shadow(0 0 1px var(--color-ink))';
/** §24.2.d: tres. Rango autorizado 2–4; fuera de ahí se escala a ux-ui. */
const LOGO_OUTLINE_PASSES = 3;
const LOGO_SAFETY_OUTLINE = Array.from({ length: LOGO_OUTLINE_PASSES }, () => LOGO_OUTLINE_PASS)
  .join(' ');

/**
 * §24.3 — MEDIDAS DEL POZO, por tamaño.
 *
 * `md` es la teja de la retícula (§24.3): `aspect-[3/2]`, ancho de la celda, con repisa.
 * `sm` es el pozo del ENCABEZADO DEL BINDER (§24.10): 112×64 fijos (`aspect-[7/4]` sobre `w-28`),
 * **sin repisa** —su trabajo es dar borde inferior a un hueco dentro de una retícula; en línea
 * junto a un título, una regla suelta se leería como el subrayado de nada— y **oculto por debajo
 * de `sm`**, donde el título manda y el ancho es oro.
 *
 * El AIRE INTERIOR baja un escalón en v2.10 (12/16/20; v2.8: 16/20/24): el logo se pinta ~8–10 %
 * más grande —legibilidad gratis justo para los logos claros que §24.2.e señala como frágiles— y
 * sin campo oscuro detrás ya no necesita despegarse de un canto duro. La regla dura se conserva:
 * el aire nunca baja del 10 % del lado corto (10,8 % a 390px · 13,2 % en `sm` · 13,9 % en `lg` ·
 * 10,7 % en `xl`). En el pozo `sm` el aire NO baja: 8/64 = 12,5 %, y por debajo se incumpliría.
 */
const PLATE_SIZE = {
  md: {
    // La REPISA vive aquí, en la MISMA caja del `aspect-[3/2]`: con `box-sizing: border-box` la
    // relación de aspecto se aplica a la caja de BORDE, así que la geometría de v2.8 no se mueve
    // ni un píxel (§24.14 nº10: «si algo se movió, es un defecto»).
    box: 'aspect-[3/2] w-full border-b border-border',
    pad: 'p-3 sm:p-4 lg:p-5',
  },
  sm: {
    box: 'hidden aspect-[7/4] w-28 shrink-0 sm:block',
    pad: 'p-2',
  },
} as const;

/**
 * §24.2.d/§24.3 — EL POZO DE PAPEL (v2.10; en v2.8 esta misma caja era una PLACA DE TINTA).
 * Componente y geometría intactos: solo cambia el ACABADO. Caja de tamaño fijo (`aspect-[3/2]`)
 * idéntica para todos los sets, radio 0, con aire interior; el logo va `object-contain` (R1: nunca
 * `cover`, nunca estirado, nunca recortado).
 *
 * EL FONDO es `--color-surface-2` `#EFEBE2`: el papel un punto por debajo, no un token nuevo —§2.2
 * lo define literalmente como «superficie elevada / hover row / **placeholder de imagen**» y §5 ya
 * lo usa como pozo del arte de carta, así que el hueco del logo y el hueco de la carta son el
 * mismo hueco. No puede leerse como la tarjeta blanca que §2.1 prohíbe porque es más OSCURO que el
 * papel, no más claro.
 *
 * LA REPISA (`border-b border-border`, §24.2.d nº2) es el ÚNICO borde: sin superior, sin
 * laterales, sin radio — con los cuatro sería una tarjeta. Existe porque el pozo contra el papel da
 * ~1,06:1 (casi invisible, **y así debe ser**: no porta información): la repisa es lo que le da al
 * hueco un borde inferior perceptible con brillo bajo o a la luz del sol. **No cuadra la
 * retícula** —eso lo hace la caja fija de R1, y no depende de que se vea nada—: es legibilidad de
 * la composición, no estructura.
 *
 * El MONOGRAMA se pinta desde el primer frame y **se retira cuando la imagen carga** (no se
 * limita a quedar debajo: los PNG del proveedor tienen transparencia y se transparentaría a
 * través del logo). El pozo nunca se ve vacío y **nunca pulsa** (R4). Un `animate-pulse` eterno
 * haría que un `logoUrl: null` —caso normal y permanente— pareciera una app colgada; es el
 * precedente literal de `CardImage`, que deja el pozo QUIETO cuando no hay `src`.
 *
 * ⚠️ La GEOMETRÍA de esta caja (que mida lo mismo con cualquier proporción de logo) **no la puede
 * verificar jsdom**: no hace layout ni carga imágenes. Su prueba vive en
 * `e2e/master-set-plate.spec.ts`, midiendo cajas reales en Chromium. Lo que sí se prueba en
 * vitest es la ESTRUCTURA que la hace posible (hijos absolutos, aire en la imagen).
 *
 * `onError` retira el `<img>` y deja el monograma: un 404 del CDN no deja a nadie esperando y
 * jamás se ve un icono de imagen rota (§24.5 nº3).
 *
 * A11y (§24.8): el logo es DECORATIVO (`alt=""` + `aria-hidden`) y el monograma también. El nombre
 * accesible de la teja lo dan el nombre visible + la meta, que ya están en el DOM dentro del
 * `<button>` — sin esto un lector anunciaría «logo de Surging Sparks, Surging Sparks».
 */
export function SetPlate({
  name,
  logoUrl,
  size = 'md',
}: {
  name: string;
  logoUrl: string | null;
  /** `md`: teja de la retícula (§24.3). `sm`: encabezado del binder (§24.10). */
  size?: keyof typeof PLATE_SIZE;
}) {
  // Tres estados, no un booleano: `pending` (aún no llegó) · `loaded` (la imagen tapa al
  // monograma) · `failed` (404/CDN caído ⇒ se retira el <img> y el monograma se queda).
  const [state, setState] = useState<'pending' | 'loaded' | 'failed'>('pending');
  const src = state === 'failed' ? null : logoUrl;
  // §24.5: el monograma se pinta desde el primer frame y la imagen lo TAPA cuando llega. No basta
  // con superponer: los logos del proveedor son PNG con transparencia y `object-contain` no pinta
  // fondo, así que un monograma que sigue en el DOM se ve A TRAVÉS del logo, para siempre
  // (bloqueante B-2 de QA). Se retira al `onLoad`, sin transición — un cross-fade mostraría las
  // dos cosas superpuestas, que es justo lo que se está corrigiendo.
  const showMonogram = !src || state !== 'loaded';
  const dims = PLATE_SIZE[size];
  return (
    // GEOMETRÍA (R1) — la caja es de tamaño FIJO y los dos hijos van ABSOLUTOS. Es la corrección
    // del bloqueante B-1: con la <img> en FLUJO, `h-full` (height:100%) contra un padre cuya
    // altura la fija `aspect-ratio` resuelve a `auto`, la imagen toma su proporción intrínseca y
    // su alto pasa a ser el min-content del padre ⇒ el `aspect-[3/2]` queda ANULADO y el pozo
    // crece con cada logo (un logo cuadrado lo hacía 180×180 en vez de 180×120), además de saltar
    // de alto al cargar (CLS). Un hijo absoluto no contribuye al alto del padre, así que el pozo
    // mide lo mismo con logo apaisado, cuadrado, vertical o sin logo. `container-type:inline-size`
    // refuerza esto (aísla el tamaño de la caja de su contenido) y, sobre todo, habilita las
    // unidades `cqw` del monograma. **v2.10 no toca ni un píxel de esta fila.**
    <div
      // El pozo del binder lleva testid propio: los specs del índice cuentan tejas por
      // `set-plate` y no deben capturar el del encabezado si algún día conviven en la pantalla.
      data-testid={size === 'sm' ? 'set-plate-sm' : 'set-plate'}
      className={cn('relative bg-surface-2 [container-type:inline-size]', dims.box)}
    >
      {showMonogram && (
        <span
          data-testid="set-monogram"
          aria-hidden="true"
          // §24.5 pide el monograma PROPORCIONAL al pozo (≈28px a 167px de ancho, ≈44px a
          // 280px ⇒ ≈16 % del ancho). Atarlo al breakpoint del VIEWPORT era el defecto I-2: en el
          // cotizador la retícula vive en una columna estrecha, así que en `lg` el pozo es MÁS
          // pequeño que en móvil y un monograma fijo de 44px lo desbordaba. `cqw` mide contra el
          // POZO, que es la caja de la que el tamaño depende de verdad.
          //
          // v2.10: color `--color-text-muted` (v2.8: `--color-on-ink`, que sobre un pozo claro
          // sería invisible). Muted y no tinta plena a propósito: con tinta competiría con el
          // nombre del set —justo debajo, también serif y también en tinta— y un suplente
          // parecería contenido. 4,6:1 sobre el pozo (§24.9), y a 28–44px sobra. **Sin contorno**:
          // el de §24.2 es para arte de terceros, no para texto propio (§24.12 nº15).
          className="absolute inset-0 flex items-center justify-center font-serif text-[16cqw] leading-none tracking-[0.06em] text-muted"
        >
          {setMonogram(name)}
        </span>
      )}
      {src && (
        // Nivel B (ARCHITECTURE §4.41.7): `<img>` crudo, sin next/image y sin `srcset` (no
        // conocemos las dimensiones intrínsecas y el CDN sirve un solo tamaño).
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          aria-hidden="true"
          // §24.7: `lazy` en TODAS, sin excepciones (`lazy` no retrasa lo que está en el viewport:
          // la primera fila entra sola). PROHIBIDO `fetchpriority="high"` aquí — 20 imágenes
          // compitiéndose el ancho de banda es lo contrario de lo que se busca.
          loading="lazy"
          decoding="async"
          onLoad={() => setState('loaded')}
          onError={() => setState('failed')}
          // El aire interior (12/16/20px en `md`, 8px en `sm`, §24.3/§24.10) vive AQUÍ y no en el
          // padre: para un hijo absoluto el bloque contenedor es la caja de relleno del padre, así
          // que un `p-3` arriba no lo tocaría. Con `box-sizing:border-box`, `object-contain` encaja
          // dentro de la caja de contenido ⇒ mismo aire, sin devolverle el alto a la imagen.
          className={cn('absolute inset-0 h-full w-full object-contain', dims.pad)}
          style={{ filter: LOGO_SAFETY_OUTLINE }}
        />
      )}
    </div>
  );
}
