/**
 * dyn.routes.spec.ts — v1.113⟨portada⟩ (API_CONTRACT §DYN.2.1, §DYN.2.4, §DYN.2.5, §DYN.4.6): las RUTAS y su borde HTTP.
 *  - `GET /catalog/featured`: `@Public`, SIN parámetros (I-2: nada del visitante entra), `Cache-Control` del contrato.
 *  - `POST /admin/jobs/featured-rotation`: `super_admin` (clase), auditado; `force:true` ⇒ `featured.selection.forced`.
 *  - `GET /admin/pricing/graded-estimates/budget`: `super_admin` (clase del controlador M2).
 *  - el job `featured-rotation` cada 15 min (`repeatEvery`, sufijo `-cron`) y despachado por el scheduler.
 */
import { Role } from '@prisma/client';
import { HEADERS_METADATA, METHOD_METADATA, PATH_METADATA, ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { CatalogController } from '../src/modules/catalog/catalog.controller';
import { AdminJobsController } from '../src/jobs/admin-jobs.controller';
import { GradedEstimatesController } from '../src/modules/catalog/graded-estimates.controller';
import { IS_PUBLIC_KEY } from '../src/common/decorators/public.decorator';
import { ROLES_KEY } from '../src/common/decorators/roles.decorator';
import { SchedulerService } from '../src/jobs/scheduler.service';

describe('GET /catalog/featured (§DYN.2.1)', () => {
  const h = CatalogController.prototype.featured;
  it('ruta `featured`, GET, @Public', () => {
    expect(Reflect.getMetadata(PATH_METADATA, h)).toBe('featured');
    expect(Reflect.getMetadata(METHOD_METADATA, h)).toBe(RequestMethod.GET);
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, h)).toBe(true);
  });
  it('Cache-Control: public, max-age=30, stale-while-revalidate=30', () => {
    expect(Reflect.getMetadata(HEADERS_METADATA, h)).toEqual([
      { name: 'Cache-Control', value: 'public, max-age=30, stale-while-revalidate=30' },
    ]);
  });
  it('I-2 — el handler no recibe NADA de la petición (ni query, ni sesión, ni cabeceras)', () => {
    expect(Reflect.getMetadata(ROUTE_ARGS_METADATA, CatalogController, 'featured')).toBeUndefined();
    expect(h.length).toBe(0);
  });
  it('delega en `FeaturedService.read()`', async () => {
    const featured = { read: jest.fn(async () => ({ businessDate: null, data: [] })) };
    const ctrl = new CatalogController({} as never, {} as never, {} as never, undefined, featured as never);
    expect(await ctrl.featured()).toEqual({ businessDate: null, data: [] });
    expect(featured.read).toHaveBeenCalledWith();
  });
});

describe('POST /admin/jobs/featured-rotation (§DYN.2.4)', () => {
  const h = AdminJobsController.prototype.runFeaturedRotation;
  it('ruta y verbo; la clase es `super_admin`', () => {
    expect(Reflect.getMetadata(PATH_METADATA, h)).toBe('featured-rotation');
    expect(Reflect.getMetadata(METHOD_METADATA, h)).toBe(RequestMethod.POST);
    expect(Reflect.getMetadata(ROLES_KEY, AdminJobsController)).toEqual([Role.super_admin]);
  });

  function ctrlWith(featured: unknown, audit: { log: jest.Mock }) {
    const args = Array.from({ length: 13 }, () => ({}) as never);
    args[12] = audit as never;
    const C = AdminJobsController as unknown as new (...a: unknown[]) => AdminJobsController;
    const ctrl = new C(...args, undefined, undefined, undefined, undefined, undefined, undefined, featured);
    return ctrl;
  }

  it('sin `force` ⇒ el tic, auditado como `jobs.featured_rotation.run`', async () => {
    const featured = { tick: jest.fn(async () => ({ status: 'exists', businessDate: '2026-12-01' })), force: jest.fn() };
    const audit = { log: jest.fn(async () => undefined) };
    const r = await ctrlWith(featured, audit).runFeaturedRotation({}, { id: 'u1', role: Role.super_admin });
    expect(r).toEqual({ status: 'exists', businessDate: '2026-12-01' });
    expect(featured.force).not.toHaveBeenCalled();
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'jobs.featured_rotation.run', actorUserId: 'u1' }));
  });

  it('`force: true` ⇒ rehace y audita `featured.selection.forced` con antes → después', async () => {
    const before = { seed: 'a', items: [{ position: 1 }] };
    const after = { seed: 'b', items: [{ position: 1 }, { position: 2 }] };
    const featured = { tick: jest.fn(), force: jest.fn(async () => ({ businessDate: '2026-12-01', before, after })) };
    const audit = { log: jest.fn(async () => undefined) };
    const r = await ctrlWith(featured, audit).runFeaturedRotation({ force: true }, { id: 'u1', role: Role.super_admin });
    expect(featured.force).toHaveBeenCalledWith('u1');
    expect(r).toEqual({ status: 'forced', businessDate: '2026-12-01' });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'featured.selection.forced', entityType: 'FeaturedSelection', entityId: '2026-12-01', before, after }),
    );
  });
});

describe('GET /admin/pricing/graded-estimates/budget (§DYN.4.6)', () => {
  it('ruta `budget`, GET, bajo la clase `super_admin` del controlador M2', () => {
    const h = GradedEstimatesController.prototype.budget;
    expect(Reflect.getMetadata(PATH_METADATA, h)).toBe('budget');
    expect(Reflect.getMetadata(METHOD_METADATA, h)).toBe(RequestMethod.GET);
    expect(Reflect.getMetadata(ROLES_KEY, GradedEstimatesController)).toEqual([Role.super_admin]);
  });
});

describe('job `featured-rotation` (§DYN.2.3)', () => {
  it('el scheduler lo despacha al tic', async () => {
    const featured = { tick: jest.fn(async () => ({ status: 'waiting', businessDate: 'x' })) };
    const s = Object.create(SchedulerService.prototype) as SchedulerService;
    (s as unknown as { featuredRotation: unknown }).featuredRotation = featured;
    await s.process({ name: 'featured-rotation' });
    expect(featured.tick).toHaveBeenCalled();
  });
});
