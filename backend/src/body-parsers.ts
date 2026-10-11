import { INestApplication } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { json, text } from 'express';

/** v1.84 (LIVE-7, API_CONTRACT §14.7): tope del cuerpo de `POST /telemetry/csp` (si no ⇒ `413`). */
export const CSP_REPORT_MAX_BYTES = 16 * 1024;
export const CSP_REPORT_PATH = '/api/v1/telemetry/csp';

/**
 * Parsers de cuerpo de la app. UNA fuente para `main.ts` y para el arnés de integración
 * (`test/integration/helpers/e2e-app.ts`), para que las pruebas midan el parser que corre en producción.
 *
 * Orden (el primero que lee el cuerpo marca `req._body` y los siguientes lo saltan):
 *  1. Webhook de Stripe: JSON + `rawBody` para verificar la firma.
 *  2. v1.84 · `POST /telemetry/csp`: TEXTO crudo de CUALQUIER tipo (`application/csp-report`,
 *     `application/reports+json`…), ≤ 16 KB. El controlador lo interpreta y responde `204` siempre; por eso
 *     aquí no se parsea JSON (un JSON roto daría `400` y el contrato pide `204`). Más de 16 KB ⇒ `413` sin
 *     cuerpo (el contrato no fija cuerpo y ⛔ no hay código de error nuevo) y sin log (TLM-2). Cualquier otro
 *     fallo de lectura (charset desconocido, conexión cortada) ⇒ sigue sin cuerpo ⇒ `204`.
 *  3. Resto: JSON normal.
 */
export function applyBodyParsers(app: INestApplication): void {
  app.use(
    '/api/v1/webhooks/stripe',
    json({
      verify: (req: Request & { rawBody?: Buffer }, _res, buf) => {
        req.rawBody = buf;
      },
    }),
  );

  const cspText = text({ type: () => true, limit: CSP_REPORT_MAX_BYTES });
  app.use(CSP_REPORT_PATH, (req: Request, res: Response, next: NextFunction) => {
    cspText(req, res, (err?: unknown) => {
      if (!err) return next();
      const e = err as { type?: string; status?: number };
      if (e.type === 'entity.too.large' || e.status === 413) {
        res.status(413).end();
        return;
      }
      req.body = undefined;
      next();
    });
  });

  app.use(json());
}
