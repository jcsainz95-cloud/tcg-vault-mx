'use client';

import { createContext, useContext, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/cn';

/**
 * Llamada + nota al pie del «gancho de grading» (DESIGN_SYSTEM §21.4).
 *
 * **R3 — acoplamiento llamada ↔ nota, a nivel de PÁGINA.** El diseño exige que (1) toda cifra
 * estimada lleve su llamada visible, (2) toda página que pinte una cifra renderice su nota al pie
 * completa, sin interacción, y (3) **llamada y nota se rendericen bajo la MISMA condición** — «si la
 * página no puede hospedar la nota, tampoco puede mostrar la cifra».
 *
 * Cómo se hace imposible que un refactor deje cifras huérfanas:
 *  - `GradingFootnoteBoundary` recibe UN solo booleano y con él hace DOS cosas a la vez: publica el
 *    contexto con los anclas y renderiza la nota. No hay dos condiciones que puedan divergir.
 *  - Todos los componentes que pintan cifra (`GradingEstimateBlock`, `GradingEstimateBadge`) y la
 *    propia `GradingNoteCall` **exigen el contexto**: fuera de una boundary activa devuelven `null`.
 *    Mover un badge a una página que no hospeda la nota no produce una cifra sin aviso: produce
 *    NADA (fail-closed, que es la dirección correcta del error en una superficie de dinero).
 *
 * La nota NO vive tras `<details>`, acordeón, modal ni tooltip, no se manda a otra página como único
 * acceso y no se mete en el footer de marca (§21.4d). Es contenido real, imprimible y encontrable
 * con Ctrl+F.
 */

export interface GradingFootnoteAnchors {
  /** `id` de la nota al pie (destino del salto). */
  noteId: string;
  /** `id` del encabezado de la nota (`tabindex="-1"`, recibe el foco al saltar). */
  headingId: string;
  /** `id` al que apunta el enlace de regreso de la nota (viaje de ida **y vuelta**). */
  returnToId: string;
}

const GradingFootnoteContext = createContext<GradingFootnoteAnchors | null>(null);

/** `null` ⇒ la página NO hospeda la nota ⇒ NINGUNA cifra puede pintarse (R3.3). */
export function useGradingFootnote(): GradingFootnoteAnchors | null {
  return useContext(GradingFootnoteContext);
}

const NOTE_ID = 'nota-estimado';
const HEADING_ID = 'nota-estimado-titulo';
/** Ancla por defecto del regreso: la llamada de la ficha (la única que es enlace, §21.4a). */
export const GRADING_CALL_ID = 'llamada-estimado';

export interface GradingFootnoteBoundaryProps {
  /**
   * ¿La página muestra al menos una cifra estimada? Derívalo SIEMPRE de los helpers de
   * `./estimates` (`blockEstimatesOf` / `pageHasGradingFigures`), nunca de una regla copiada.
   */
  active: boolean;
  /** `id` al que vuelve el lector desde la nota. Default: la llamada de la ficha. */
  returnToId?: string;
  children: React.ReactNode;
}

export function GradingFootnoteBoundary({
  active,
  returnToId = GRADING_CALL_ID,
  children,
}: GradingFootnoteBoundaryProps) {
  const anchors = useMemo<GradingFootnoteAnchors>(
    () => ({ noteId: NOTE_ID, headingId: HEADING_ID, returnToId }),
    [returnToId],
  );
  // El Provider se renderiza SIEMPRE (cambiar el tipo de nodo desmontaría el árbol al paginar);
  // lo que conmuta es el VALOR: `null` apaga toda cifra. Un único booleano gobierna ambos lados.
  return (
    <GradingFootnoteContext.Provider value={active ? anchors : null}>
      {children}
      {active && <GradingEstimateNote />}
    </GradingFootnoteContext.Provider>
  );
}

/**
 * La llamada (`*`) — §21.4a. Una por superficie, anclada a la ETIQUETA del gancho (no repetida por
 * cifra) y nunca pegada a un precio real. Glifo mono 13px en `--color-accent` (único empleo del
 * acento en §21), `vertical-align: super` con `line-height: 0` para no alterar la caja de línea.
 *
 * Accesibilidad: el glifo va `aria-hidden` y el texto accesible (`callSr`, con las dos ideas
 * obligatorias de §N.5) lo sustituye — quien navega por audio NO oye «asterisco».
 *
 * `variant="link"` solo en la FICHA: en la teja y en la vitrina la teja entera ya es un enlace y no
 * se anidan anclas (§21.4a), así que ahí es un `<sup>` sin interacción.
 */
export function GradingNoteCall({
  variant = 'plain',
  className,
}: {
  variant?: 'link' | 'plain';
  className?: string;
}) {
  const anchors = useGradingFootnote();
  const t = useTranslations('catalog.gradingNote');
  if (!anchors) return null;

  const glyph = 'text-[13px] font-mono leading-[0] align-super text-accent';

  if (variant === 'link') {
    return (
      <sup id={anchors.returnToId} className={cn('leading-[0]', className)}>
        <a
          href={`#${anchors.noteId}`}
          aria-label={t('callSr')}
          className={cn(glyph, 'px-1 hover:text-text')}
        >
          <span aria-hidden>*</span>
        </a>
      </sup>
    );
  }

  return (
    <sup className={cn(glyph, className)}>
      <span aria-hidden>*</span>
      <span className="sr-only">{t('callSr')}</span>
    </sup>
  );
}

/**
 * La nota al pie — §21.4b. Banda a ancho completo delimitada SOLO por su regla superior (sin caja,
 * sin fondo): marcador de acento que repite la llamada + eyebrow, titular mono en versalitas y los
 * párrafos del disclaimer de PROJECT §N.5, **una clave i18n por párrafo con rich text** (jamás
 * concatenando ni partiendo frases). Pisos tipográficos propios: cuerpo 13px, etiquetas 10px.
 *
 * Salto y regreso: `tabindex="-1"` en el encabezado para que el foco aterrice de verdad,
 * `scroll-margin-top` derivado de `--app-header-h` (§4.5, nada de `top` hardcodeado) y enlace de
 * regreso al punto de partida.
 */
function GradingEstimateNote() {
  const anchors = useGradingFootnote();
  const t = useTranslations('catalog.gradingNote');
  if (!anchors) return null;

  // Entradilla en tinta 500 al abrir cada párrafo (§21.4b): rich text de next-intl, NUNCA dos claves.
  const rich = { b: (chunks: React.ReactNode) => <strong className="font-medium text-text">{chunks}</strong> };

  return (
    <section
      id={anchors.noteId}
      aria-labelledby={anchors.headingId}
      className="gutter scroll-mt-[calc(var(--app-header-h,0px)+16px)] border-t border-border pb-7 pt-6 sm:pb-9 sm:pt-7"
    >
      <h2
        id={anchors.headingId}
        tabIndex={-1}
        className="eyebrow flex items-baseline gap-1.5 outline-none"
      >
        <span aria-hidden className="font-mono text-[13px] leading-[0] text-accent">
          *
        </span>
        {t('label')}
      </h2>

      <p className="mt-5 max-w-[720px] font-mono text-[12px] font-medium uppercase leading-[1.5] tracking-[0.08em] text-text">
        {t('headline')}
      </p>

      <div className="mt-4 flex max-w-[720px] flex-col gap-2.5 text-[13px] leading-[1.7] text-muted">
        {NOTE_PARAGRAPHS.map((key) => (
          <p key={key}>{t.rich(key, rich)}</p>
        ))}
      </div>

      <a
        href={`#${anchors.returnToId}`}
        className="mt-6 inline-block font-mono text-[11px] leading-none text-muted hover:text-text"
      >
        <span aria-hidden>↩ </span>
        {t('back')}
      </a>
    </section>
  );
}

/**
 * Una clave por párrafo (§21.11). Son SEIS porque el texto aprobado en PROJECT §N.5 tiene seis
 * párrafos y el humano lo quiso íntegro («el texto completo NO se poda»); el esquema de §21.11
 * enumera `p1…p5` porque su diagrama omite el primer párrafo. Añadir o quitar un párrafo es tocar
 * esta lista y las dos traducciones, nada más.
 */
const NOTE_PARAGRAPHS = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'] as const;
