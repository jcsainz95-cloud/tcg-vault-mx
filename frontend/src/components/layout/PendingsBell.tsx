'use client';

import { useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Bell } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { usePendings } from '@/hooks/usePendings';
import { formatDate } from '@/lib/format';
import type { PendingCode, PendingDTO } from '@/types/contract';
import type { AppLocale } from '@/i18n/routing';

/**
 * ⭐⭐ **A DÓNDE LLEVA CADA PENDIENTE.** `Record<PendingCode, …>` y no un `switch` con `default`:
 * el día que el arquitecto añada una fila a la lista blanca (§R.2.3), **esto no compila** hasta que
 * alguien decida dónde se resuelve. *Un pendiente sin destino es una tarea sin puerta* — y el
 * criterio **201** exige que «vuelva a subir la identidad desde el portal» sea alcanzable.
 *
 * `#kyc` no es decorativo: `KycSection` enfoca y centra el bloque al aterrizar con ese hash, así
 * que el cliente cae **en el motivo del rechazo**, no en la cabecera de la página.
 */
const PENDING_HREF: Record<PendingCode, string> = {
  identity_action_required: '/account#kyc',
};

/**
 * ⭐⭐ LA CAMPANA DEL PORTAL (`PROJECT §R.0.a`, criterio **202**, contrato §R.2).
 *
 * El dueño la fijó él mismo: **arriba a la derecha, siempre visible cuando haya algo pendiente**,
 * y su criterio literal es **«disponible, no impuesto»**. El criterio 202 tiene **cuatro mitades**
 * y **las cuatro son el criterio**: una campana que interrumpe incumple igual que una que no
 * aparece. Lo que este componente hace por cada una:
 *
 * - **(a) NI IMPUESTO.** Es un botón del header y nada más. ⛔ No hay pantalla de aterrizaje, ⛔ no
 *   hay interstitial, ⛔ no se abre sola, ⛔ no bloquea ninguna ruta y ⛔ no lleva `aria-modal` (el
 *   panel **no** es un diálogo: no atrapa el foco ni cubre la página). Con un pendiente vivo se
 *   navega catálogo → carrito → checkout sin despachar nada.
 * - **(b) NI ESCONDIDA.** Vive en `StorefrontHeader`, que es **el único** header de la tienda ⇒
 *   está en las tres situaciones que él nombró (carrito listo, flujo de venta, y cuenta/bóveda sin
 *   carrito) **por construcción**, no por una lista de pantallas que alguien olvidará ampliar.
 * - **(c) SIN PENDIENTES, NO HAY CAMPANA.** Con `{"pendings":[]}` este componente devuelve `null`:
 *   ⛔ **no queda un indicador vacío**, que es el ruido que §R.2 existe para evitar. Y como el
 *   pendiente se **deriva**, se apaga el mismo instante en que deja de ser verdad — no hay nada que
 *   acordarse de apagar.
 * - **(d) SOLO PENDIENTES VIVOS.** ⛔⛔ **Esto NO es una bandeja.** No hay historial, no hay
 *   «marcar como leído», no hay eventos (pedido enviado, pago recibido, guía capturada…) y no hay
 *   nada que descartar: cada fila es **una tarea que sigue siendo verdad** y su única acción es
 *   **ir a resolverla**. El historial está en **fase 2** (pregunta 68) y construirlo hoy sería
 *   fallar el criterio 202(d) **por exceso**.
 *
 * ⚠️ **Y lo que NO se pinta, que es igual de normativo:** ⛔ ninguna cifra, ningún tope, ningún
 * umbral y ningún dinero (§R.2.3 prohibición 4 — *un pendiente no es un resumen*), y ⛔ nada
 * derivado de `SellOfferState` (criterio **204**): el dominio es la lista blanca del contrato y
 * **solo** esa lista.
 */
export function PendingsBell() {
  const t = useTranslations('nav.pendings');
  const locale = useLocale() as AppLocale;
  const query = usePendings();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const pendings: PendingDTO[] = query.data?.pendings ?? [];
  const visible = pendings.length > 0;

  // El panel abierto no puede sobrevivir a que el pendiente se resuelva: si la lista se vacía
  // mientras está abierto (refetch al volver a la pestaña), el panel se cierra con ella. Criterio
  // 202(c) también aplica a lo que ya estaba en pantalla.
  useEffect(() => {
    if (!visible) setOpen(false);
  }, [visible]);

  // Cerrar con Escape y con clic fuera. ⛔ Sin trampa de foco y sin `inert` en el resto de la
  // página: cerrarla es barato **a propósito** (criterio 202a, «ni impuesto»).
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      setOpen(false);
      buttonRef.current?.focus();
    }
    function onPointer(e: MouseEvent) {
      if (rootRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    }
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onPointer);
    };
  }, [open]);

  /*
   * ⛔ **Cargando y error NO pintan campana.** Ni esqueleto, ni campana apagada, ni banner de
   * fallo. Dos razones, y ninguna es pereza:
   *   1. Una campana que parpadea en cada navegación es ruido permanente para el 99 % de las
   *      sesiones, que **no tienen ningún pendiente** (§R.0.a: *sin pendientes no hay campana que
   *      mirar; no es un estado vacío que diseñar con gracia*).
   *   2. Un `401` de invitado es la **respuesta correcta** del contrato (§R.2.2), no una avería:
   *      contarle un error a quien no tiene el pendiente sería inventarle un problema.
   * El equivalente del EmptyState de §8.1 aquí es **la ausencia del control**, que es lo que el
   * criterio 202(c) pide literalmente.
   */
  if (!visible) return null;

  const panelId = 'pendings-panel';

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        /* Icono solo ⇒ `aria-label` obligatorio (§5). Y el rótulo **lleva la cuenta**: el punto
           bermellón es color, y el color nunca es el único canal (§2.4/§10). */
        aria-label={t('aria', { count: pendings.length })}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((v) => !v)}
        className="relative inline-flex h-11 w-11 items-center justify-center text-text focus-visible:outline-none focus-visible:shadow-focus"
      >
        <Bell size={20} aria-hidden strokeWidth={1.5} />
        <span
          aria-hidden
          className="absolute right-[9px] top-[9px] h-[7px] w-[7px] rounded-full bg-accent ring-2 ring-bg"
        />
      </button>

      {open && (
        <div
          id={panelId}
          /* ⛔ `role="group"`, **no** `dialog` y **no** `aria-modal`: esto no interrumpe nada. */
          role="group"
          aria-label={t('title')}
          className="absolute right-0 top-[calc(100%+8px)] z-50 w-[min(20rem,calc(100vw-2.5rem))] border border-border bg-bg p-4 shadow-lg"
        >
          <p className="eyebrow mb-3">{t('title')}</p>
          <ul className="flex flex-col gap-4">
            {pendings.map((p) => (
              <li key={p.code} className="flex flex-col gap-1">
                <span className="font-serif text-base text-text">{t(`codes.${p.code}.title`)}</span>
                <span className="text-sm leading-relaxed text-muted">{t(`codes.${p.code}.body`)}</span>
                {/* `since` es el único dato que el DTO trae además del código, y es información
                    útil («desde cuándo me toca»), ⛔ no una cifra de negocio. */}
                <span className="tabular text-[11px] text-muted">
                  {t('since', { date: formatDate(p.since, locale) })}
                </span>
                <Link
                  href={PENDING_HREF[p.code]}
                  onClick={() => setOpen(false)}
                  className="mt-1 self-start border-b border-accent pb-0.5 text-[11px] font-medium uppercase tracking-label text-text"
                >
                  {t(`codes.${p.code}.action`)}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
