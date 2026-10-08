/**
 * accessories.photo-isolation.spec.ts — **AC-B5** (I-AC-6, criterio 704) · API_CONTRACT §AC.0, ARCHITECTURE §4.AC (g).
 *
 * Las fotos de accesorios viven en Postgres y se sirven públicas. La INE vive en S3, privada. La separación es POR
 * CONSTRUCCIÓN: ningún fichero de `src/modules/accessories/` importa el cliente S3 ni el módulo/servicio de subidas.
 * Si alguien «reutiliza» `UploadsService` para las fotos, una política mal puesta podría servir una INE: este candado
 * se pone rojo antes.
 *
 * Canario: el candado se prueba contra un texto que SÍ importa S3 y contra uno que importa `UploadsService`; si el
 * patrón dejara de verlos, el canario falla (el candado no estaría mirando).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { codigoDeTexto, anclasEstructurales } from './helpers/codigo-de-fichero';

const DIR = join(__dirname, '..', 'src', 'modules', 'accessories');

const PROHIBIDO: { nombre: string; re: RegExp }[] = [
  { nombre: '@aws-sdk/*', re: /from\s+['"]@aws-sdk\/|require\(\s*['"]@aws-sdk\// },
  { nombre: 'módulo uploads', re: /from\s+['"][^'"]*\/uploads(\/[^'"]*)?['"]/ },
  { nombre: 'UploadsService', re: /\bUploadsService\b/ },
  { nombre: 'kyc_ine', re: /kyc_ine/ },
];

function ficheros(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? ficheros(p) : p.endsWith('.ts') ? [p] : [];
  });
}

function violaciones(texto: string): string[] {
  return PROHIBIDO.filter((x) => x.re.test(texto)).map((x) => x.nombre);
}

describe('AC-B5 — el módulo de accesorios no toca S3 ni las subidas de la INE', () => {
  const lista = ficheros(DIR);

  it('el módulo existe y tiene sus ficheros (no-vacuidad)', () => {
    const nombres = lista.map((p) => p.slice(DIR.length + 1));
    expect(nombres).toEqual(expect.arrayContaining(['accessory-photo.ts', 'admin-accessories.service.ts', 'accessories.controller.ts']));
  });

  it.each(lista.map((p) => [p.slice(DIR.length + 1), p]))('%s: sin S3, sin UploadsService, sin kyc_ine', (_n, p) => {
    const fuente = readFileSync(p, 'utf8');
    const codigo = codigoDeTexto(fuente, p, anclasEstructurales(fuente, p));
    expect(violaciones(codigo)).toEqual([]);
  });

  it('canario: el patrón SÍ ve las importaciones prohibidas', () => {
    expect(violaciones("import { S3Client } from '@aws-sdk/client-s3';")).toEqual(['@aws-sdk/*']);
    expect(violaciones("import { UploadsService } from '../uploads/uploads.service';")).toEqual(['módulo uploads', 'UploadsService']);
  });
});
