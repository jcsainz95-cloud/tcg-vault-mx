'use client';

import { cn } from '@/lib/cn';
import { EditorialLink } from './EditorialLink';

/**
 * Encabezado de ESTANTE del storefront (R3): H2 serif 22/29px ⟷ link muted
 * «Ver todo…» (EditorialLink `muted`, §20.0), con variantes para kicker mono
 * (Gradeadas), apoyo muted (Gradeadas/Bounties) y acciones extra (flechas del
 * carrusel). Sustituye el encabezado repetido a mano en FeaturedCarousel,
 * SealedShelf, GradedShelf y BountyBoard; el contenido del estante va como
 * children (cada estante conserva su retícula propia).
 */
export interface ShelfProps {
  /** `id` de la <section>: destino de anclas (p. ej. el regreso de la nota al pie, §22.4a). Va en
   *  el MISMO elemento que el `scroll-mt` de `className` para que el aterrizaje respete el header. */
  id?: string;
  title: React.ReactNode;
  /** aria-label de la sección; obligatorio si `title` no es string plano. */
  ariaLabel?: string;
  /**
   * `aria-roledescription` de la <section> — **localizado**, nunca en inglés crudo (§23.9a). Hoy solo
   * lo usa el carrusel («carrusel» / «carousel»), que con su `aria-label` se anuncia «Piezas
   * destacadas del catálogo, carrusel».
   */
  ariaRoledescription?: string;
  /**
   * Ref a la <section>. La usa el carrusel para escuchar `pointerenter`/`pointerleave` y
   * `focusin`/`focusout` de TODO el estante (encabezado incluido, §23.5) con listeners nativos: un
   * `onMouseEnter` de React aquí obligaría a re-renderizar el estante entero en cada entrada del
   * puntero, y §23.2 pide que la rotación no re-renderice tejas.
   */
  sectionRef?: React.Ref<HTMLElement>;
  /**
   * Eyebrow mono junto al título (p. ej. «PSA · CGC», §20.5).
   * `ReactNode` desde v2.6 (§23.15 nº3): el tipo se amplía, pero el kicker sigue siendo **texto** en
   * todas las pantallas que lo usan y conserva su envoltorio `.eyebrow` (mono muted) y su `gap-4`.
   */
  kicker?: React.ReactNode;
  /** Apoyo muted bajo el encabezado (§20.5/§20.7). */
  subtitle?: string;
  subtitleClassName?: string;
  viewAllHref?: string;
  viewAllLabel?: string;
  viewAllClassName?: string;
  /** Controles extra a la derecha del link (flechas del carrusel §20.3). */
  actions?: React.ReactNode;
  /** Clases de la <section> (border-t, fondo de pozo…). */
  className?: string;
  /** Paddings/alineación del encabezado por estante. */
  headerClassName?: string;
  children: React.ReactNode;
}

export function Shelf({
  id,
  title,
  ariaLabel,
  ariaRoledescription,
  sectionRef,
  kicker,
  subtitle,
  subtitleClassName,
  viewAllHref,
  viewAllLabel,
  viewAllClassName,
  actions,
  className,
  headerClassName,
  children,
}: ShelfProps) {
  const heading = (
    <h2 className="font-serif text-[22px] leading-tight text-text lg:text-[29px]">{title}</h2>
  );
  return (
    <section
      id={id}
      ref={sectionRef}
      className={className}
      aria-label={ariaLabel ?? (typeof title === 'string' ? title : undefined)}
      aria-roledescription={ariaRoledescription}
    >
      <div
        className={cn(
          'gutter flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2',
          headerClassName,
        )}
      >
        {kicker ? (
          <div className="flex items-baseline gap-4">
            {heading}
            <span className="eyebrow">{kicker}</span>
          </div>
        ) : (
          heading
        )}
        {(viewAllHref || actions) && (
          <div className="flex items-center gap-4 lg:gap-[22px]">
            {viewAllHref && viewAllLabel && (
              <EditorialLink variant="muted" href={viewAllHref} className={viewAllClassName}>
                {viewAllLabel}
              </EditorialLink>
            )}
            {actions}
          </div>
        )}
      </div>
      {subtitle && (
        <p className={cn('gutter text-sm leading-[1.6] text-muted', subtitleClassName)}>{subtitle}</p>
      )}
      {children}
    </section>
  );
}
