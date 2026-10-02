import { displaySetCode } from '@/lib/setCode';
import { cn } from '@/lib/cn';

/**
 * v1.80 (P-71, DESIGN_SYSTEM §37.3c) — la SIGLA sola del set («TWM»): cabecera del binder, separador
 * de parte en masters combinados e índice de sets. Es UN componente porque las tres superficies
 * pintan el mismo hecho con las mismas reglas:
 * - sin código (`null` o vacío) no pinta NADA — ⛔ nunca «—», «N/A» ni una sigla deducida (§37.3b);
 * - mono, `tracking-label`, `text-muted`, y **tal como llega**: sin `uppercase` (§37.3b);
 * - texto real, `lang="en"` (es la sigla impresa), ⛔ sin `aria-hidden` ni `title` (§37.3d).
 *
 * El TAMAÑO lo pone el llamador (13 px en cabecera · `text-xs` a la escala del separador · 11 px en
 * la teja del índice) y el `data-testid` también: las tres conviven en el DOM y cada una se nombra.
 * Para «código + número» («TWM 130») está `CardCode`, no este.
 */
export function SetCode({
  code,
  className,
  testId,
}: {
  code: string | null | undefined;
  className?: string;
  testId: 'binder-set-code' | 'part-set-code' | 'index-set-code';
}) {
  const text = displaySetCode(code);
  if (!text) return null;
  return (
    <span lang="en" data-testid={testId} className={cn('font-mono tracking-label text-muted', className)}>
      {text}
    </span>
  );
}
