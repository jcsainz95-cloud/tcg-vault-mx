import 'reflect-metadata';
import { HttpStatus } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { DisputesController } from '../src/modules/disputes/disputes.controller';
import { DisputesService } from '../src/modules/disputes/disputes.service';
import { BusinessException } from '../src/common/business.exception';
import { supportContact } from '../src/modules/mail/support-contact';

/**
 * v1.82 · **PNL-1** (`API_CONTRACT §PNL.1`, `HECHOS.md:44`) — `POST /disputes` responde SIEMPRE
 * `410 DISPUTES_DISCONTINUED { supportContact }` y no toca nada.
 *
 * Unitario del controlador; la prueba por HTTP (DSC-1…DSC-4) vive en
 * `test/integration/disputes-discontinued.e2e-spec.ts`. Aquí se fija lo que el HTTP no distingue bien:
 * - el handler **no recibe parámetros decorados** (sin `@Body()` el `ValidationPipe` no tiene qué
 *   validar ⇒ ningún `400` puede adelantarse al `410`; es la mitad «antes de validar» de DSC-2);
 * - **no llama al servicio** (un servicio sin métodos revienta si se le llama);
 * - `DisputesService` ya **no tiene `create`**: la vía de alta no existe, no solo no se enruta.
 */
describe('PNL-1 · POST /disputes ⇒ 410 DISPUTES_DISCONTINUED', () => {
  const ENV_KEYS = ['SUPPORT_EMAIL', 'DISPUTE_EVIDENCE_CONTACT'] as const;
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of ENV_KEYS) saved[k] = process.env[k];
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  function build() {
    // Servicio VACÍO: cualquier llamada (create, listMine…) sería `TypeError`, no un 410.
    const svc = {} as DisputesService;
    return new DisputesController(svc);
  }

  it('lanza 410 DISPUTES_DISCONTINUED con `details.supportContact` = el resolutor único', () => {
    process.env.SUPPORT_EMAIL = 'pnl-a@x.test';
    const ctrl = build();
    let thrown: unknown;
    try {
      (ctrl.create as () => never)();
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(BusinessException);
    const ex = thrown as BusinessException;
    expect(ex.getStatus()).toBe(HttpStatus.GONE);
    expect(ex.code).toBe('DISPUTES_DISCONTINUED');
    expect(ex.details).toEqual({ supportContact: 'pnl-a@x.test' });
    expect(ex.details.supportContact).toBe(supportContact());
  });

  it('el handler NO declara parámetros (ni `@Body`, ni usuario): nada que validar ni que leer antes del 410', () => {
    const args = Reflect.getMetadata(ROUTE_ARGS_METADATA, DisputesController, 'create') ?? {};
    expect(Object.keys(args)).toEqual([]);
    expect(DisputesController.prototype.create.length).toBe(0);
  });

  it('`DisputesService` ya no tiene `create` (la vía de alta no existe)', () => {
    expect((DisputesService.prototype as unknown as Record<string, unknown>).create).toBeUndefined();
    // Las lecturas en transición SIGUEN (§PNL.1).
    for (const m of ['listMine', 'getMine', 'adminList', 'adminGet', 'resolve']) {
      expect(typeof (DisputesService.prototype as unknown as Record<string, unknown>)[m]).toBe('function');
    }
  });
});
