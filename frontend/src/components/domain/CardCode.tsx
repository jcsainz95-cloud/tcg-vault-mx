import { formatCardCode } from '@/lib/setCode';
import { cn } from '@/lib/cn';

/**
 * v1.80 (P-71, DESIGN_SYSTEM §37.3b) — «TWM 130» (código del set + espacio no separable + número) o,
 * sin código, `#130` como siempre. Texto real, leído en su orden (⛔ sin `aria-hidden`, sin
 * `title`): es información. `lang="en"` porque la sigla es la impresa en la carta; `tabular-nums`
 * para que los números se alineen en una retícula. El color y el tamaño los pone el llamador (es
 * el mismo que tenía el `#número` en cada superficie).
 */
export function CardCode({
  code,
  number,
  className,
}: {
  code: string | null | undefined;
  number: string;
  className?: string;
}) {
  const text = formatCardCode(code, number);
  if (!text) return null;
  return (
    <span lang="en" className={cn('tabular-nums', className)} data-testid="card-code">
      {text}
    </span>
  );
}
