export interface EmptyStateProps {
  title: string;
  body?: string;
  action?: React.ReactNode;
  icon?: React.ReactNode;
  tone?: 'neutral' | 'positive';
}

/**
 * Estado vacío (DESIGN_SYSTEM §8.1).
 * Dirección 5a: sin caja punteada ni icono decorativo — dos reglas, mucho aire y
 * el mensaje en mincho. `icon` se sigue aceptando por compatibilidad de API pero
 * ya no se pinta: en esta dirección el vacío se comunica con espacio, no con dibujo.
 */
export function EmptyState({ title, body, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 border-y border-border px-6 py-20 text-center">
      <h3 className="font-serif text-2xl text-text">{title}</h3>
      {body && <p className="max-w-md text-sm leading-relaxed text-muted">{body}</p>}
      {action}
    </div>
  );
}
