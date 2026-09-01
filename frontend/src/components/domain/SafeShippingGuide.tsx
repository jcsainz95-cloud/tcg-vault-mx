'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';

/**
 * Guía de EMPAQUE (DESIGN_SYSTEM §7.13 reescrita v2.3.2, PROJECT AC 34): sleeve + top loader.
 *
 * ⚠ El componente cambió de TEMA, no solo de texto. Nació cuando el vendedor compraba su
 * propio envío; bajo D16/D31 la etiqueta la ponemos nosotros y su costo se descuenta del
 * pago. El `step4Body` viejo —«asegura por el valor cotizado»— hacía que quien lo obedecía
 * PAGARA DOS VECES. Lo que queda aquí es lo único que sigue siendo del vendedor: cómo empaca.
 * El copy normativo está en §23.14.1; este archivo solo lo pinta.
 *
 * Invariantes que NO se pueden «mejorar» sin romper algo:
 * - `step1*` y `step2*` dicen funda/sleeve y top loader porque AC 34 EXIGE esas palabras.
 *   Reescribirlos «por consistencia» rompe un criterio de aceptación (§23.14.5).
 * - El `intro` lleva la política NM-only para que AC 34 se cumpla en TODA instancia, incluido
 *   el modal, que tapa el bloque NM-only de la página.
 * - El paso 4 es una regla de dinero: quién pone la etiqueta + que se descuenta + qué NO hacer.
 *   Los tres viajan juntos (§23.14.3): este componente se pinta sin ningún bloque de dinero al
 *   lado (modal) y §P lo repite dentro de dos correos, así que la resta no se puede delegar.
 * - Sin cifras (D43): ningún paso lleva monto, rango ni porcentaje de envío.
 * - El alto de fila NO se fija y el paso 4 NO se trunca: es el cuerpo más largo de los cuatro.
 *   Prohibidos `line-clamp`, «ver más» y altura fija; si no cupiera, se corrige el contenedor.
 *
 * Makeover 1a (artboard «2b Vender»): los pasos son una retícula editorial de
 * cuatro columnas — regla superior, numeral mono en rojo (01–04), título y cuerpo —
 * sin cajas, iconos ni rellenos de color. El mismo bloque sirve en el modal
 * (columns=2, con CTA «entendido») y como sección inline al pie de /buylist
 * (columns=4, sin CTA). El título/enlace de ambos montajes sale de
 * `buylist.shippingGuideLink`, que dice lo mismo que `safeShipping.title`.
 */
export function SafeShippingGuide({
  onUnderstood,
  columns = 2,
  className,
}: {
  onUnderstood?: () => void;
  /** 2 = modal (angosto) · 4 = sección inline de página completa. */
  columns?: 2 | 4;
  className?: string;
}) {
  const t = useTranslations('safeShipping');
  const steps = [
    { title: t('step1Title'), body: t('step1Body') },
    { title: t('step2Title'), body: t('step2Body') },
    { title: t('step3Title'), body: t('step3Body') },
    { title: t('step4Title'), body: t('step4Body') },
  ];
  return (
    <div className={cn('flex flex-col gap-4', className)}>
      <p className="max-w-[560px] text-sm leading-relaxed text-muted">{t('intro')}</p>
      <ol
        className={cn(
          'grid gap-6',
          columns === 4 ? 'sm:grid-cols-2 lg:grid-cols-4' : 'sm:grid-cols-2',
        )}
      >
        {steps.map((s, i) => (
          <li key={i} className="border-t border-border pt-3.5">
            <span aria-hidden className="tabular font-mono text-[11px] text-accent">
              {String(i + 1).padStart(2, '0')}
            </span>
            <p className="mt-2 text-sm font-medium text-text">{s.title}</p>
            <p className="mt-1.5 text-[13px] leading-[1.6] text-muted">{s.body}</p>
          </li>
        ))}
      </ol>
      {onUnderstood && (
        <Button variant="secondary" onClick={onUnderstood} className="mt-2 self-start">
          {t('understood')}
        </Button>
      )}
    </div>
  );
}
