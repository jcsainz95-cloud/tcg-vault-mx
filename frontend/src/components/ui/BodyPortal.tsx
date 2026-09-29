'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * Monta a sus hijos al FINAL de `<body>`, fuera del árbol del layout.
 *
 * Para qué sirve: un disparador `fixed` que visualmente flota (FAB, barra inferior) sigue estando
 * en el DOM donde se escribió, y el orden de tabulación es el del DOM. Escrito dentro de la vista,
 * queda ANTES del pie de página del layout; §37.1d / §18.8 lo quieren DESPUÉS del pie (cabecera →
 * contenido → pie → disparador fijo), sin `tabindex` positivos. El portal es la única forma de
 * ponerlo detrás de un pie que pertenece a otro componente.
 *
 * Coste, dicho: se monta tras hidratar (el servidor no tiene `document`), así que el HTML inicial
 * no lo trae y aparece en el primer efecto del cliente. El sitio que ocupa lo reserva el llamador
 * (p. ej. `pb-24` del `<main>`), así que no hay salto de layout. Mismo patrón que `Toaster`.
 */
export function BodyPortal({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return createPortal(children, document.body);
}
