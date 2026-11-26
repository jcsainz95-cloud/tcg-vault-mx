'use client';

import { useEffect } from 'react';
import { captureVisitOrigin } from '@/lib/visit-origin';

/** §ORIGEN-VISITA: guarda el origen de la pestaña al aterrizar. No pinta nada ni depende del banner. */
export function VisitOriginCapture() {
  useEffect(() => {
    captureVisitOrigin();
  }, []);
  return null;
}
