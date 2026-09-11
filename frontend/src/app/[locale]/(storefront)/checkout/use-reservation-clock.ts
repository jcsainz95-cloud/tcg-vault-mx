'use client';

import { useEffect, useState } from 'react';
import { remainingMs } from './reservation-clock';

/**
 * Lo que queda de la reserva, **vivo** (contrato v1.68, §4-R).
 *
 * ⚠️ Existe porque el tiempo restante se calculaba en DOS sitios con dos comportamientos
 * distintos: la cuenta atrás del checkout (`ReservationCountdown`) refrescaba cada segundo, y
 * «Reanudar pago» (`ResumePaymentAction`) lo calculaba **una vez, en el render** — así que una
 * lista de pedidos abierta un rato seguía diciendo «Reservado hasta las HH:MM» sobre una reserva
 * ya vencida, y solo cambiaba si algo más provocaba un re-render. Es dinero y es una promesa al
 * cliente: las dos superficies tienen que contar el mismo tiempo con el mismo reloj (SB-D7).
 *
 * Reglas que hereda de `reservation-clock` y que NO se tocan aquí: el instante lo manda el
 * servidor (`reservedUntil`), no se prorroga nada desde el cliente, y un instante no parseable
 * devuelve `null` (⇒ no se pinta cuenta atrás sobre un dato que no existe).
 *
 * El intervalo se PARA al llegar a cero: a partir de ahí el valor ya no cambia (`0`) y seguir
 * despertando al navegador cada segundo no informaría de nada.
 */
export function useRemainingMs(iso: string | null | undefined): number | null {
  const [left, setLeft] = useState<number | null>(() => remainingMs(iso));

  useEffect(() => {
    const first = remainingMs(iso);
    setLeft(first);
    if (first === null || first <= 0) return;
    const id = window.setInterval(() => {
      const next = remainingMs(iso);
      setLeft(next);
      if (next === null || next <= 0) window.clearInterval(id);
    }, 1000);
    return () => window.clearInterval(id);
  }, [iso]);

  return left;
}
