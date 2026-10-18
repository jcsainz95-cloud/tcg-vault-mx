/**
 * CORS (S-M2 + §MKT.E/§MKT.G.7): el front corre en otro origen y descarga archivos con
 * `requestBlob` (Excel del Panel de Marketing, inventario, guías, reportes, Card Show). El nombre
 * del archivo viaja en `Content-Disposition`, y el navegador SOLO deja leer a JS las cabeceras
 * CORS-safelisted salvo que el servidor las exponga con `Access-Control-Expose-Headers`.
 * Sin exponerla, el Excel bajaba como «tcghunt_semana.xlsx» (QA, afd12b82).
 *
 * Se prueba sobre una app Nest REAL con `app.enableCors(buildCorsOptions(...))`, la misma llamada
 * que hace `main.ts`. Mutación que la pone en rojo: quitar `exposedHeaders` de `cors.ts`.
 */
import * as http from 'http';
import { Controller, Get, Header, INestApplication, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { buildCorsOptions, resolveCorsOrigins } from '../src/cors';

@Controller()
class FileController {
  @Get('file')
  @Header('Content-Disposition', 'attachment; filename="tcghunt_semana_2026-W42.xlsx"')
  file(): string {
    return 'x';
  }
}

@Module({ controllers: [FileController] })
class CorsTestModule {}

function request(
  port: number,
  method: string,
  headers: Record<string, string>,
): Promise<{ status?: number; h: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: '/file', method, headers }, (res) => {
      res.resume();
      res.on('end', () => resolve({ status: res.statusCode, h: res.headers }));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('CORS — cors.ts (S-M2 + Content-Disposition expuesta)', () => {
  const ALLOWED = 'https://tienda.example';
  let app: INestApplication;
  let port: number;

  beforeAll(async () => {
    app = await NestFactory.create(CorsTestModule, { logger: false });
    app.enableCors(buildCorsOptions([ALLOWED]));
    await app.listen(0, '127.0.0.1');
    port = (app.getHttpServer().address() as { port: number }).port;
  });

  afterAll(async () => {
    await app.close();
  });

  it('con Origin permitido: expone Content-Disposition (el front puede leer el nombre del archivo)', async () => {
    const { status, h } = await request(port, 'GET', { origin: ALLOWED });
    expect(status).toBe(200);
    expect(h['access-control-allow-origin']).toBe(ALLOWED);
    expect(h['access-control-allow-credentials']).toBe('true');
    const exposed = String(h['access-control-expose-headers'] ?? '')
      .split(',')
      .map((s) => s.trim().toLowerCase());
    expect(exposed).toContain('content-disposition');
    expect(h['content-disposition']).toContain('tcghunt_semana_2026-W42.xlsx');
  });

  it('con Origin NO permitido: no refleja el origen (S-M2 intacto)', async () => {
    // El paquete `cors` emite Expose-Headers y Allow-Credentials aunque el origen no esté
    // permitido (medido aquí); es inocuo: sin `Access-Control-Allow-Origin` el navegador no
    // entrega la respuesta a JS. Lo que importa es que NO refleje el origen.
    const { h } = await request(port, 'GET', { origin: 'https://evil.example' });
    expect(h['access-control-allow-origin']).toBeUndefined();
  });

  it('resolveCorsOrigins: APP_BASE_URL en lista; sin ella, solo localhost (nunca comodín)', () => {
    const prev = process.env.APP_BASE_URL;
    try {
      process.env.APP_BASE_URL = ' https://a.example , https://b.example ';
      expect(resolveCorsOrigins()).toEqual(['https://a.example', 'https://b.example']);
      delete process.env.APP_BASE_URL;
      expect(resolveCorsOrigins()).toEqual(['http://localhost:3000', 'http://localhost:5173']);
      expect(buildCorsOptions(['https://a.example']).origin).not.toBe(true);
    } finally {
      if (prev === undefined) delete process.env.APP_BASE_URL;
      else process.env.APP_BASE_URL = prev;
    }
  });
});
