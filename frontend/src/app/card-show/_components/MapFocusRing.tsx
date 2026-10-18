'use client';

import { useEffect } from 'react';

/**
 * Foco visible del mapa embebido (§CS-UX.3 / RONDA 4 IMPORTANTE-1). Isla de cliente que NO pinta nada.
 *
 * Por qué no basta CSS: un `<iframe>` enfocado por teclado NO casa `:focus`/`:focus-visible` en
 * Chromium (el foco se va al documento ANIDADO), y `:focus-within` del padre tampoco lo refleja ⇒
 * `.cs-map-frame:focus-visible` era CSS muerto. El patrón que SÍ funciona: cuando el foco entra al
 * iframe, la VENTANA pierde el foco (`blur`) y `document.activeElement` pasa a ser el iframe; con eso
 * marcamos el `<figure>` contenedor con una clase que dibuja el anillo, y al volver el foco al
 * documento (`focus`) la quitamos.
 *
 * Además, el `<figure>` lleva `cs-reveal`: si el visitante tabula hasta el mapa ANTES de que el motor
 * de reveals lo haya mostrado, estaría en `opacity:0` (foco en algo invisible). Al enfocarlo le
 * añadimos también `cs-in` para garantizar que esté pintado y en pantalla.
 *
 * Progressive enhancement: sin JS no hay anillo JS, pero tampoco hay `data-cs-motion` ⇒ el mapa está
 * visible y el enlace externo de `<figcaption>` sigue siendo la alternativa accesible.
 */
export function MapFocusRing() {
  useEffect(() => {
    const iframe = document.querySelector<HTMLIFrameElement>('.cs-map-frame');
    if (!iframe) return;
    const figure = iframe.closest('figure');
    if (!figure) return;

    const onWindowBlur = () => {
      // El `blur` de la ventana precede al cambio de `activeElement`; esperamos un tick para leerlo.
      window.setTimeout(() => {
        if (document.activeElement === iframe) {
          figure.classList.add('cs-map-focus', 'cs-in');
        }
      }, 0);
    };
    const onWindowFocus = () => figure.classList.remove('cs-map-focus');

    window.addEventListener('blur', onWindowBlur);
    window.addEventListener('focus', onWindowFocus);
    return () => {
      window.removeEventListener('blur', onWindowBlur);
      window.removeEventListener('focus', onWindowFocus);
    };
  }, []);

  return null;
}
