/**
 * enum-query-census-canary.spec.ts — **el canario de la mitad 2 de `C-EQ-1` (DESCUBRIMIENTO).**
 *
 * ### Por qué un candado nuevo necesita canario, y por qué DOS mitades
 * `C-EQ-1` descubre ejes de query **leyendo el código**. Esa clase de candado tiene dos formas de
 * fallar, y **solo una se nota**:
 *
 *  - **Falla ruidosa:** deja de morder algo que sí importa ⇒ sale rojo donde no toca. Molesta, se ve.
 *  - ⭐ **Falla SILENCIOSA:** el escáner deja de ver código —un `stripComments` demasiado agresivo, un
 *    `walk` que se salta un directorio, una resolución de ruta que colapsa— y el cruce pasa **siempre
 *    en verde**. *Un candado siempre verde es indistinguible de uno que funciona hasta el día que se
 *    le necesita*, y ese día es el día que alguien añade un eje de dinero sin clase.
 *
 * Por eso las dos mitades se prueban por separado: **m1** demuestra que MUERDE, **m2** demuestra que
 * NO ES CIEGO. Es el patrón que `enum-parity-lock-canary.spec.ts` ya usa en este repo, y la razón de
 * que exista es la misma: el arreglo de `H3-d` (mirar código y no texto) **podía desactivar el
 * candado sin que nada sonara**.
 *
 * ### ⛔ El canario NO toca el árbol vivo
 * Trabaja sobre **fuentes sintéticas** (cadenas), nunca sobre ficheros del repo. Un canario que muta
 * `src/` de verdad puede dejar el árbol sucio si se cae a mitad — y este proyecto ya pagó una corrida
 * de mutación sobre un árbol destruido (O-8).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { scanSource, QueryAxisSite } from './helpers/query-axis-census';

/**
 * **El cruce del candado, reducido a una función.** Es la misma operación que hace `C-EQ-1`: un eje
 * que no está en ninguna de las tres listas ⇒ huérfano ⇒ rojo.
 */
function huerfanos(
  sites: readonly QueryAxisSite[],
  listas: { noEnum: readonly string[]; registro: readonly string[]; sinClase: readonly string[] },
): string[] {
  return sites
    .filter(
      (s) =>
        !(s.param !== null && listas.noEnum.includes(s.param)) &&
        !listas.registro.includes(s.key) &&
        !listas.sinClase.includes(s.key),
    )
    .map((s) => s.key);
}

/** Un controller sintético, en el dialecto real del repo. */
const CONTROLLER_LIMPIO = `
@Controller('admin/pricing')
export class PricingController {
  @Get('pending')
  pending(@Query('context') context?: string, @Query('reason') reason?: string) {
    return this.pricing.pendingQueue(context, reason);
  }
}
`;

const LISTAS_LIMPIAS = {
  noEnum: ['q', 'page', 'pageSize'],
  registro: ['GET /admin/pricing/pending::context', 'GET /admin/pricing/pending::reason'],
  sinClase: [],
};

describe('canario · `C-EQ-1` mitad 2 — el descubrimiento de ejes de query', () => {
  it('línea base: un controller cuyos ejes SÍ están declarados no produce huérfanos', () => {
    // Sin esta línea base, un canario que siempre encuentra huérfanos parecería estar mordiendo
    // cuando en realidad solo está roto.
    expect(huerfanos(scanSource('src/x.controller.ts', CONTROLLER_LIMPIO), LISTAS_LIMPIAS)).toEqual([]);
  });

  describe('⭐ m1 — MUERDE: el eje que nadie registró sale como huérfano', () => {
    /**
     * El defecto REAL que `C-EQ-1` existe para cazar, y que ya ocurrió tres veces: alguien añade un
     * `@Query` y **nadie lo mete en el censo**. `?context=`, `?reason=` y `?axis=` se saltaron
     * exactamente así — no por descuido, sino porque *una lista escrita a mano no puede enterarse de
     * lo que nadie le contó*.
     */
    it('un `@Query` nuevo, sin clase en ninguna lista ⇒ huérfano', () => {
      const conEjeNuevo = CONTROLLER_LIMPIO.replace(
        "@Query('reason') reason?: string",
        "@Query('reason') reason?: string, @Query('eje_que_nadie_declaro') x?: string",
      );
      expect(huerfanos(scanSource('src/x.controller.ts', conEjeNuevo), LISTAS_LIMPIAS)).toEqual([
        'GET /admin/pricing/pending::eje_que_nadie_declaro',
      ]);
    });

    /**
     * ⭐⭐ **La mitad de m1 que justifica resolver la RUTA y no solo el nombre.**
     *
     * Un `?status=` no es un eje: son cinco, uno por endpoint, con cinco dominios posibles. Si el
     * cruce fuera **por nombre**, un endpoint NUEVO con `@Query('status')` heredaría la declaración
     * de otro y **pasaría en verde** — el hueco exacto que este candado viene a cerrar, con otro
     * disfraz. Aquí se demuestra que la ruta lo distingue.
     */
    it('un endpoint NUEVO que reusa un nombre ya registrado en OTRA ruta ⇒ huérfano igual', () => {
      const conRutaNueva = `${CONTROLLER_LIMPIO}
@Controller('admin/pricing')
export class OtroController {
  @Get('cola-nueva')
  colaNueva(@Query('reason') reason?: string) {
    return this.svc.lo_que_sea(reason);
  }
}
`;
      const salida = huerfanos(scanSource('src/y.controller.ts', conRutaNueva), LISTAS_LIMPIAS);
      expect(salida).toEqual(['GET /admin/pricing/cola-nueva::reason']);
      // Y el `?reason=` LEGÍTIMO de la otra ruta sigue sin ser huérfano: el candado no es un martillo.
      expect(salida).not.toContain('GET /admin/pricing/pending::reason');
    });

    /** El `@Query()` SIN NOMBRE es un endpoint entero fuera del inventario: tampoco pasa gratis. */
    it('un `@Query()` desnudo nuevo ⇒ huérfano (sus llaves no las puede ver el escáner)', () => {
      const desnudo = CONTROLLER_LIMPIO.replace(
        "@Query('context') context?: string, @Query('reason') reason?: string",
        '@Query() todo: Record<string, unknown>',
      );
      expect(huerfanos(scanSource('src/x.controller.ts', desnudo), LISTAS_LIMPIAS)).toEqual([
        'GET /admin/pricing/pending::<sin nombre>',
      ]);
    });
  });

  describe('⭐⭐ m2 — NO ES CIEGO: las formas de romperlo en VERDE', () => {
    /**
     * **El fallo silencioso número uno.** Si el escáner devolviera `[]` —un `walk` que se salta un
     * directorio, un `stripComments` que se come el código, un cambio de dialecto de decorador que
     * la regex no reconoce— el cruce saldría **verde con la app entera sin inventariar**.
     *
     * Se demuestra que el escáner **encuentra algo** sobre una fuente que sí tiene ejes, y el ancla
     * numérica contra la app real vive en `C-EQ-1` («el escáner ve la app REAL»: ≥170 ejes, ≥18
     * ficheros). Las dos mitades hacen falta: ésta prueba el mecanismo, aquélla prueba el volumen.
     */
    it('el escáner NO devuelve vacío sobre código que sí tiene ejes (si lo hiciera, todo saldría verde)', () => {
      const sites = scanSource('src/x.controller.ts', CONTROLLER_LIMPIO);
      expect(sites.map((s) => s.key)).toEqual([
        'GET /admin/pricing/pending::context',
        'GET /admin/pricing/pending::reason',
      ]);
    });

    /**
     * ⭐ **El fallo silencioso número dos: el escáner que mira TEXTO en vez de CÓDIGO.**
     *
     * Este proyecto ya cometió ese error una vez: `enum-values-parity.spec.ts` corría su regex sobre
     * el fichero entero, así que un **comentario** lo disparaba, y el síntoma era una **lista blanca
     * por nombre de fichero** — *«cada fichero que quiera explicar la regla tiene que pedirle permiso
     * al test»* (techlead). `H3-d` se lo quitó.
     *
     * ⚠️⚠️ **Y aquí la primera versión de este canario estaba MAL, medido: se puso VERDE 3/3 ante la
     * mutación que le quitaba el `stripComments` al escáner.** El canario ponía el comentario
     * **antes** del `@Get(...)`, y ahí el `stripComments` es **inerte**: el escáner solo mira dentro
     * del **segmento** de un handler (de un decorador de ruta al siguiente), así que la prosa de
     * fichero ya quedaba fuera por otra razón. *Estaba comprobando una propiedad que el escáner tiene,
     * pero no por el motivo que el test afirmaba* — un canario verde por accidente, que es peor que
     * no tenerlo porque afirma cobertura que no existe.
     *
     * **Dónde importa de verdad, medido el 2026-09-13 sobre el árbol copia:** un comentario **DENTRO
     * del segmento** — el caso realista es un `@Query` **comentado** que alguien dejó al depurar. Con
     * el escáner normal ⇒ 1 eje; con el escáner en modo texto ⇒ **2 ejes**, uno fantasma. Ese eje
     * fantasma no da un rojo honesto: da un rojo por un parámetro **que no existe**, y la salida que
     * enseña es apagar el candado.
     */
    it.each([
      ['línea, `@Query` comentado', "    // @Query('comentado_al_depurar') viejo?: string,"],
      ['bloque', "    /* @Query('comentado_al_depurar') viejo?: string, */"],
      [
        'JSDoc multilínea',
        "    /**\n     * Se retiró este parámetro:\n     *   @Query('comentado_al_depurar') viejo?: string,\n     */",
      ],
    ])('un `@Query` comentado DENTRO del handler (%s) NO cuenta como eje', (_forma, comentario) => {
      const conProsa = `
@Controller('admin/pricing')
export class PricingController {
  @Get('pending')
  pending(
    @Query('context') context?: string,
    @Query('reason') reason?: string,
${comentario}
  ) {}
}
`;
      const claves = scanSource('src/x.controller.ts', conProsa).map((s) => s.key);
      expect(claves).not.toContain('GET /admin/pricing/pending::comentado_al_depurar');
      // Y los ejes de CÓDIGO del mismo handler siguen viéndose: no se pasó de agresivo.
      expect(claves).toEqual([
        'GET /admin/pricing/pending::context',
        'GET /admin/pricing/pending::reason',
      ]);
    });

    /**
     * ⭐ **El fallo silencioso número tres: la resolución de ruta que colapsa.**
     *
     * Si el prefijo del `@Controller` se perdiera (p. ej. tomando siempre el primero del fichero en
     * vez del más cercano por encima), las llaves cambiarían y **todas** dejarían de cuadrar con el
     * registro… lo cual sería ruidoso. Pero hay una variante silenciosa: que **dos** controllers
     * distintos del mismo fichero colapsen en el mismo prefijo y un eje nuevo herede la declaración
     * del vecino. `admin.controller.ts` declara **cuatro** `@Controller` (medido), así que no es
     * hipotético.
     */
    it('dos `@Controller` en un fichero NO colapsan: cada handler lleva su propio prefijo', () => {
      const dosControllers = `
@Controller('admin/pricing')
export class A {
  @Get('pending')
  a(@Query('reason') r?: string) {}
}

@Controller('admin/reports')
export class B {
  @Get('pending')
  b(@Query('reason') r?: string) {}
}
`;
      expect(scanSource('src/z.controller.ts', dosControllers).map((s) => s.key)).toEqual([
        'GET /admin/pricing/pending::reason',
        'GET /admin/reports/pending::reason',
      ]);
    });
  });

  /**
   * `C-EQ-1` es una suite de **integración** (necesita HTTP para su mitad 1). Este canario es
   * **unitario**, así que corre en cada PR aunque no haya infra. La costura entre los dos es que
   * ambos usan **el mismo escáner**, y eso se comprueba aquí: si alguien copiara el escáner en el
   * spec de integración, el canario dejaría de cubrirlo sin que nada sonara.
   */
  it('`C-EQ-1` usa ESTE escáner, no una copia suya', () => {
    const ceq1 = readFileSync(
      join(__dirname, 'integration', 'enum-query-axes.e2e-spec.ts'),
      'utf8',
    );
    expect(ceq1).toContain("from '../helpers/query-axis-census'");
    // Y no se ha vuelto a escribir un buscador de `@Query` allí dentro.
    expect(ceq1).not.toMatch(/matchAll\(.*@Query/);
  });
});
