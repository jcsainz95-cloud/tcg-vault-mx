/**
 * Lectura PURA de la URL del catálogo (sin `'use client'`): la usan la vista cliente (`CatalogView`) y la página de
 * servidor (`page.tsx`, C2: primera lectura en SSR con la MISMA clave de react-query). Un módulo `'use client'` no
 * puede exportar funciones a un componente de servidor (llegan como referencia de cliente), por eso vive aparte.
 */
import type { CatalogFilters, CatalogSort } from '@/lib/api';
import { SEALED_SUBTYPES, type Finish } from '@/types/contract';
import { FINISH_ORDER } from '@/lib/finish';

/**
 * Fricción 5 (DESIGN_SYSTEM §CHK-MOVIL.5): el selector SIEMPRE muestra un orden real. Sin `sort` en la URL se
 * pinta «Novedades» y se envía ese orden (es también el default del contrato, §2 `sort` default `newest`); con
 * `sort` explícito en la URL, manda la URL.
 */
export const DEFAULT_CATALOG_SORT: CatalogSort = 'newest';

/** Lo único que se lee de los parámetros: vale `URLSearchParams` (servidor) y `ReadonlyURLSearchParams` (cliente). */
export interface UrlParams {
  get(name: string): string | null;
}

/**
 * MK-D5 / R1 (techlead sobre `561ad425`) — **la URL es la única fuente de los filtros del catálogo.** Estos son los
 * parámetros que le pertenecen: al escribir la URL desde los filtros se reemplazan todos (también `type`, el alias de
 * la pestaña Gradeadas) y se conservan los demás (`utm_*`, `from`…).
 */
const FILTER_PARAMS = [
  'q',
  'setId',
  'productType',
  'type',
  'condition',
  'finish',
  'rarity',
  'minPriceCents',
  'maxPriceCents',
  'sort',
  'page',
] as const;

/**
 * Inversa exacta de `parseUrlFilters` (`parseUrlFilters(serializeCatalogFilters(f))` ≡ `f` para todo filtro del
 * panel; lo fija `catalog-url.test.ts`). Orden fijo de parámetros; la página 1 no se escribe.
 */
export function serializeCatalogFilters(f: CatalogFilters, base?: URLSearchParams): URLSearchParams {
  const qs = new URLSearchParams(base?.toString() ?? '');
  for (const k of FILTER_PARAMS) qs.delete(k);
  if (f.q) qs.set('q', f.q);
  if (f.setId) qs.set('setId', f.setId);
  if (f.productType) qs.set('productType', f.productType);
  if (f.condition) qs.set('condition', f.condition);
  if (f.finish) qs.set('finish', f.finish);
  if (f.rarity && f.rarity.length) qs.set('rarity', f.rarity.join(','));
  if (f.minPriceCents != null) qs.set('minPriceCents', String(f.minPriceCents));
  if (f.maxPriceCents != null) qs.set('maxPriceCents', String(f.maxPriceCents));
  if (f.sort) qs.set('sort', f.sort);
  if (f.page && f.page > 1) qs.set('page', String(f.page));
  return qs;
}

/**
 * Clave de consulta normalizada: dos filtros que piden LO MISMO al API dan la misma clave, sea cual sea el orden de
 * sus campos (sustituye a `JSON.stringify`, que dependía de él). Normaliza lo que el API trata igual: el orden por
 * defecto explícito ≡ sin orden (la vista manda `sort ?? DEFAULT_CATALOG_SORT`), página 1 ≡ sin página, y las rarezas
 * como conjunto.
 */
export function catalogFiltersKey(f: CatalogFilters): string {
  const qs = serializeCatalogFilters({
    ...f,
    sort: f.sort === DEFAULT_CATALOG_SORT ? undefined : f.sort,
    rarity: f.rarity ? [...f.rarity].sort() : undefined,
  });
  if (f.pageSize != null) qs.set('pageSize', String(f.pageSize));
  if (f.gradingHighlight) qs.set('gradingHighlight', 'true');
  return qs.toString();
}

/**
 * Ruta del catálogo para la página `page` (la 1 sin parámetro) CON los filtros vigentes. `sp`: la query actual, de la
 * que solo se conservan los parámetros que no son filtros.
 */
export function catalogPageHref(
  filters: CatalogFilters,
  page: number,
  sp?: (UrlParams & { toString(): string }) | null,
): string {
  const qs = serializeCatalogFilters(
    { ...filters, page: page <= 1 ? undefined : page },
    sp ? new URLSearchParams(sp.toString()) : undefined,
  );
  const s = qs.toString();
  return s ? `/catalog?${s}` : '/catalog';
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * D-EQ-3 · ¿ESTA URL PIDE SELLADO? (contrato v1.73 §2 + §2-S)
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * `GET /catalog/cards` es la rejilla de SINGLES y **excluye el sellado por construcción**
 * (guardarraíl `H9`). v1.73 retiró `?sealedSubtype=` y le quitó `sealed` a `?productType=`.
 *
 * MEDIDO POR HTTP (2026-09-13, stack nativo real, con UN sellado `box` publicado ⇒
 * `GET /catalog/sealed` ⇒ `total: 1`): `?productType=sealed` ⇒ `total: 0`, `?sealedSubtype=box`
 * ⇒ `total: 0`. Y MEDIDO EN EL NAVEGADOR, que es lo que importa aquí: `/es/compra?productType=sealed`
 * pintaba **«Ninguna carta coincide · Prueba con otros filtros»** con un chip crudo `sealed` y la
 * pestaña «Producto sellado» a diez centímetros, sin decir nada. Y `/es/compra?sealedSubtype=box`
 * (sin `productType`) **descartaba el parámetro EN SILENCIO** y devolvía el catálogo entero.
 *
 * **POR QUÉ REDIRIGIR Y NO SOLO DEJAR DE MANDAR EL PARÁMETRO** (decisión de frontend; `PROJECT.md`
 * §A exige que Compra filtre por tipo **incluyendo sellado** y NO dice por qué endpoint):
 *   · La intención de `?productType=sealed` es inequívoca — «enséñame sellado» — y **tenemos
 *     exactamente una superficie que lo sirve** (§2-S, `/sellado`). Tirar la intención y dejar al
 *     usuario en la rejilla de singles descarta información que sí sabemos honrar.
 *   · Es la única opción que convierte un enlace que hoy funciona A MEDIAS en uno que funciona.
 *     La pestaña «Producto sellado» ya existe (`StoreTabs`) y aun así el usuario no la usó: llegó
 *     por enlace. Una pestaña no rescata a quien entra por la puerta de al lado.
 *   · `sealedSubtype` mapea **1:1**: §2-S acepta el mismo parámetro con el mismo dominio (los siete
 *     de `SealedSubtype`). La redirección **conserva el filtro exacto**, no uno parecido.
 *
 * ⛔ **Lo que NO se arrastra, y por qué.** `q`, `rarity`, `finish`, `condition` y el rango de precio
 * NO viajan: o §2-S no los tiene, o la vitrina de sellado **no puede MOSTRARLOS** (no hay caja de
 * búsqueda, y su selector de set se puebla con los sets de la página cargada). Un filtro aplicado
 * que el usuario no ve en pantalla es exactamente la clase de mentira que este ticket corrige. Lo
 * que sí se arrastra se ve en su control. El salto de pantalla se explica con `?from=compra`.
 */
export function sealedIntentOf(sp: UrlParams | null): { sealedSubtype?: string } | null {
  if (!sp) return null;
  const sub = sp.get('sealedSubtype');
  const validSub =
    sub && (SEALED_SUBTYPES as readonly string[]).includes(sub) ? sub : undefined;
  // `?productType=sealed` (o el `?type=sealed` de la sub-navegación) es intención explícita.
  const asksSealed = sp.get('productType') === 'sealed' || sp.get('type') === 'sealed';
  // Un `?sealedSubtype=` VÁLIDO a secas también lo es: nombra una presentación de producto cerrado
  // y no significa nada más en todo el sistema. Uno inválido NO inventa intención (`?sealedSubtype=zzz`
  // es basura, no una petición de sellado): se ignora y la vista sigue siendo Compra.
  if (!asksSealed && !validSub) return null;
  return validSub ? { sealedSubtype: validSub } : {};
}

/** Destino de §2-S para una intención de sellado, con su marca de procedencia. */
export function sealedHref(intent: { sealedSubtype?: string }): string {
  const qs = new URLSearchParams();
  if (intent.sealedSubtype) qs.set('sealedSubtype', intent.sealedSubtype);
  qs.set('from', 'compra');
  return `/sellado?${qs.toString()}`;
}

/**
 * Filtros iniciales desde la URL (enlaces del Home: `?setId=<id>`,
 * `?productType=graded`; la pestaña Gradeadas usa `?type=graded`). Solo se
 * mapean los filtros del estado con equivalente trivial en query; los valores
 * de enum se validan contra sus listas — un parámetro inválido se ignora.
 */
export function parseUrlFilters(sp: UrlParams | null): CatalogFilters {
  if (!sp) return {};
  const f: CatalogFilters = {};
  const setId = sp.get('setId');
  if (setId) f.setId = setId;
  const q = sp.get('q');
  if (q) f.q = q;
  const pt = sp.get('productType') ?? (sp.get('type') === 'graded' ? 'graded' : null);
  // ⛔ D-EQ-3 / contrato v1.73 §2: `sealed` NO es un valor de este filtro — la rejilla de singles no
  // puede servirlo (`H9`). Esa URL ya no llega hasta aquí: `sealedIntentOf` la desvía a §2-S antes.
  // `sealedSubtype` tampoco se lee: se retiró del contrato y su lectura vive ahora en `/sellado`.
  if (pt === 'raw' || pt === 'graded') f.productType = pt;
  const finish = sp.get('finish');
  if (finish && (FINISH_ORDER as string[]).includes(finish)) f.finish = finish as Finish;
  const rarity = sp.get('rarity');
  if (rarity) {
    const list = rarity.split(',').map((r) => r.trim()).filter(Boolean);
    if (list.length) f.rarity = list;
  }
  // MK-D5: `condition` y el rango de precio también viajan en la URL (los pone el panel); enteros ≥ 0 en centavos.
  const condition = sp.get('condition');
  if (condition === 'NM') f.condition = condition;
  for (const k of ['minPriceCents', 'maxPriceCents'] as const) {
    const v = sp.get(k);
    if (v && /^[0-9]{1,9}$/.test(v)) f[k] = Number(v);
  }
  const sort = sp.get('sort');
  if (sort === 'newest' || sort === 'price_asc' || sort === 'price_desc') f.sort = sort;
  // C2 (BRIEF_MKT Ola 2): `?page=` rastreable. Solo un entero ≥ 2 (la 1 es la URL sin parámetro, una sola URL por
  // página); cualquier otra cosa se ignora — el contrato responde 400 a un `page` no numérico (§0 paginación) y la
  // vista no debe convertir un enlace con basura en un error.
  const page = sp.get('page');
  if (page && /^[0-9]{1,6}$/.test(page) && Number(page) >= 2) f.page = Number(page);
  return f;
}

