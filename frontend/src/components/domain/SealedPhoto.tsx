'use client';

import { useState } from 'react';

/**
 * Foto de un producto sellado (ficha, opción A del dueño 2026-11-06): la imagen centrada sobre una «tarjeta» blanca
 * con marco fino y 32 px de aire. La tarjeta se ajusta a la foto (no hay caja 5:7: los sellados miden 1000×953,
 * 682×1000, 1000×525…), `object-contain`, sin recortes y sin agrandarla por encima de su tamaño natural
 * (`w-auto h-auto` + `max-w-full`; el alto se topa en 560 px para que una foto vertical no desborde la pantalla).
 * `<img>` cruda a propósito: no abre costo en el optimizador (`next.config.mjs` intacto).
 */
export function SealedPhoto({ src, alt }: { src?: string | null; alt: string }) {
  const [broken, setBroken] = useState<string | null>(null);
  const show = !!src && broken !== src;
  return (
    <figure
      data-testid="sealed-photo"
      className="m-0 flex min-h-[200px] w-fit max-w-full items-center justify-center border border-border bg-photo-mat p-8"
    >
      {show ? (
        // datos de catálogo en inglés → lang="en" (DESIGN_SYSTEM §9.2)
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={alt}
          lang="en"
          decoding="async"
          onError={() => setBroken(src)}
          className="block h-auto max-h-[560px] w-auto min-w-0 max-w-full object-contain"
        />
      ) : null}
    </figure>
  );
}
