import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/render';
import * as api from '@/lib/api';
import { setStoredUser } from '@/lib/session';
import type { UserDTO } from '@/types/contract';
import { PendingsBell } from './PendingsBell';
import { analizarFuente, codigoDe } from '@/test/strip-comments';

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: unknown; children: React.ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}));

const user: UserDTO = { id: 'u-1', email: 'ash@example.com', name: 'Ash', role: 'customer', locale: 'es' };

function servePendings(pendings: { code: 'identity_action_required'; since: string }[]) {
  return vi.spyOn(api, 'getMePendings').mockResolvedValue({ pendings });
}

beforeEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
  setStoredUser(user);
});

/**
 * Candados del **criterio 202** (`C-AV-6`) y del **204** (`C-AV-8`) sobre la superficie de portal.
 * Las cuatro mitades del 202 son el criterio: una campana que interrumpe incumple igual que una
 * que no aparece, así que cada mitad tiene aquí su prueba **y su dirección de fallo**.
 */
describe('PendingsBell · §R.2 / criterio 202', () => {
  it('202(b) NI ESCONDIDA: con un pendiente vivo, la campana se pinta y dice cuántos hay', async () => {
    servePendings([{ code: 'identity_action_required', since: '2026-09-12T17:20:00Z' }]);
    renderWithProviders(<PendingsBell />, 'es');
    const bell = await screen.findByRole('button', { name: /1 cosa por hacer/ });
    // Icono solo ⇒ el rótulo accesible es el ÚNICO canal textual, y lleva la cuenta: el punto
    // bermellón es color, y el color nunca es el único canal.
    expect(bell).toBeInTheDocument();
  });

  it('202(c) SIN PENDIENTES NO HAY CAMPANA: con `{pendings: []}` no queda NINGÚN indicador', async () => {
    servePendings([]);
    const { container } = renderWithProviders(<PendingsBell />, 'es');
    await waitFor(() => expect(api.getMePendings).toHaveBeenCalled());
    // ⛔ Ni campana apagada, ni contador en cero, ni hueco: el componente no pinta NADA.
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('202(c) tampoco pinta un indicador MIENTRAS CARGA ni cuando el endpoint falla', async () => {
    // Un invitado recibe `401` (§R.2.2) y eso es la respuesta CORRECTA, no una avería: contarle un
    // error a quien no tiene el pendiente sería inventarle un problema.
    vi.spyOn(api, 'getMePendings').mockRejectedValue(new Error('401'));
    const { container } = renderWithProviders(<PendingsBell />, 'es');
    await waitFor(() => expect(api.getMePendings).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('202(a) NI IMPUESTO: el panel NO se abre solo, y no es un diálogo modal', async () => {
    servePendings([{ code: 'identity_action_required', since: '2026-09-12T17:20:00Z' }]);
    renderWithProviders(<PendingsBell />, 'es');
    const bell = await screen.findByRole('button', { name: /cosa por hacer/ });
    // Cerrada de origen: nadie tiene que despachar nada para seguir navegando.
    expect(bell).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Falta tu identificación')).not.toBeInTheDocument();

    await userEvent.click(bell);
    expect(bell).toHaveAttribute('aria-expanded', 'true');
    const panel = screen.getByRole('group', { name: 'Tus pendientes' });
    // ⛔ Rojo si alguien lo convierte en `dialog`/`aria-modal`: eso es el interstitial que el dueño
    // descartó («disponible, no impuesto»).
    expect(panel).not.toHaveAttribute('aria-modal');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    // Y se cierra con Escape, sin coste.
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(bell).toHaveAttribute('aria-expanded', 'false'));
  });

  it('202(d) SOLO PENDIENTES VIVOS: el panel lleva la TAREA y su puerta, ⛔ no una bandeja', async () => {
    servePendings([{ code: 'identity_action_required', since: '2026-09-12T17:20:00Z' }]);
    renderWithProviders(<PendingsBell />, 'es');
    await userEvent.click(await screen.findByRole('button', { name: /cosa por hacer/ }));

    expect(screen.getByText('Falta tu identificación')).toBeInTheDocument();
    // La única acción es IR A RESOLVERLO, y aterriza en el motivo (`#kyc` enfoca el bloque).
    expect(screen.getByRole('link', { name: 'Ir a mi cuenta' })).toHaveAttribute('href', '/account#kyc');

    // ⛔ Las tres cosas que convertirían esto en la bandeja de fase 2 (pregunta 68).
    for (const prohibido of [/marcar como le/i, /historial/i, /archivar/i, /descartar/i]) {
      expect(screen.queryByText(prohibido)).not.toBeInTheDocument();
    }
  });

  it('⛔ el pendiente no lleva NINGUNA cifra de negocio (§R.2.3 prohibición 4)', async () => {
    servePendings([{ code: 'identity_action_required', since: '2026-09-12T17:20:00Z' }]);
    const { container } = renderWithProviders(<PendingsBell />, 'es');
    await userEvent.click(await screen.findByRole('button', { name: /cosa por hacer/ }));
    const texto = container.textContent ?? '';
    // *Un pendiente no es un resumen*: ni dinero, ni topes, ni umbrales (criterio 201 y C-AV-9).
    expect(texto).not.toMatch(/MX\$|\btope\b|\bumbral\b|\blímite\b/i);
  });
});

/**
 * ⭐⭐ **`C-AV-8` POR LO NEGATIVO, SOBRE EL CÓDIGO** (criterio **204**, el riesgo nº 1 de §R).
 *
 * `schema.prisma` es explícito: `pending_authorization` es admin-only y *«EL CLIENTE NO DEBE
 * ENTERARSE DE QUE EXISTE […] le filtraría el orden de magnitud de nuestro tope»*. La forma
 * ingenua de la campana —derivar de «cambió un estado»— **filtra eso sola y en silencio**.
 *
 * Este candado **no mide una respuesta: mide el código**, porque la negativa tiene que dejar de
 * depender de la disciplina de quien escriba el siguiente pendiente. Se pone rojo en cuanto la
 * palabra aparezca en la ruta de la campana, **antes** de que llegue a una pantalla.
 */
describe('C-AV-8 · la campana no conoce `SellOfferState`', () => {
  const rutaDeLaCampana = [
    'src/components/layout/PendingsBell.tsx',
    'src/hooks/usePendings.ts',
  ];

  /**
   * ⚠️ Se miden **las instrucciones, no los comentarios**: el propio componente CITA la prohibición
   * en su cabecera para que quien lo edite la lea, y un candado que mirara el fichero crudo
   * castigaría justo a quien documenta la regla. Lo que no puede existir es una **referencia
   * ejecutable**.
   *
   * ### ⭐⭐ Aquí estaba el limpiador v1, y el control que lo acompañaba miraba el sitio equivocado
   *
   * La línea de abajo decía —con su comentario al lado— *«si el stripper se rompiera y vaciara el
   * fichero, el candado quedaría mirando al vacío»*, y comprobaba `toMatch(/export (function|const)/)`.
   *
   * **El autor conocía el modo de fallo y blindó el caso TOTAL. El que ocurre de verdad es el
   * PARCIAL:** el v1 se comía la ventana que hubiera entre un `//` con la secuencia de apertura de
   * bloque y el siguiente cierre — doce líneas en `StorefrontHeader.tsx`— y dejaba las otras
   * doscientas. *Un candado puede estar ciego a trozos y pasar todos sus propios controles.*
   *
   * ⚠️ **Medido hoy (2026-09-14, `0e22415`): en estos dos ficheros el v1 NO estaba perdiendo ni una
   * línea** — la ceguera viva estaba en el candado del IVA, no aquí. Se migra igual, porque lo que
   * decide si este candado ve es **el próximo comentario que alguien escriba** en la ruta de la
   * campana, y eso no es una propiedad que se pueda comprobar una vez.
   *
   * ⇒ `codigoDe` limpia **y** comprueba, por contenido, que las N líneas de código siguen ahí.
   */
  it.each(rutaDeLaCampana)('%s no menciona `SellOfferState` ni `pending_authorization`', (rel) => {
    const src = codigoDe(join(process.cwd(), rel), rel);
    expect(src).not.toMatch(/SellOfferState|pending_authorization/);
    expect(src).toMatch(/export (function|const)/);
  });

  /**
   * ⭐ **El canario: se reintroduce el defecto REAL que `C-AV-8` vigila y se exige el rojo.**
   *
   * El defecto es *«la campana deriva de un cambio de estado»*: una referencia **ejecutable** a
   * `SellOfferState` / `pending_authorization` en la ruta de la campana. Se inyecta en el fichero
   * real, **después** de un comentario que lleva la secuencia de apertura de bloque — que es la
   * trampa exacta que cegaba al v1.
   */
  it('⭐ canario: una referencia EJECUTABLE detrás de un `//` con apertura de bloque se ve', () => {
    const rel = 'src/components/layout/PendingsBell.tsx';
    const original = readFileSync(join(process.cwd(), rel), 'utf8');
    const lineas = original.split('\n');
    /*
     * ⭐ **La inyección va DESPUÉS del `export`, y esa colocación es el hallazgo entero.** Si se
     * pone antes, el bloque que el v1 abre se traga también la línea del `export` y el viejo
     * control de no-vacuidad **sí** habría gritado. Puesto después, el `export` sobrevive: el
     * control de no-vacuidad pasa **en verde** y la fuga desaparece igual. *Ése es el caso
     * PARCIAL, y es el que ocurre de verdad.*
     */
    const iExport = lineas.findIndex((l) => /^export (function|const)/.test(l));
    expect(iExport, 'no se encontró el export del componente').toBeGreaterThan(-1);
    const mutado = [
      ...lineas.slice(0, iExport + 1),
      '  // el dial de la campana viaja solo en /admin/*, nunca al cliente',
      "  const FUGA: string = 'pending_authorization';",
      ...lineas.slice(iExport + 1),
    ].join('\n');

    // ROJO exigido con el limpiador de hoy.
    expect(analizarFuente(mutado, rel).limpio).toMatch(/SellOfferState|pending_authorization/);
    // Y la mitad que duele: con el v1, ese mismo defecto pasaba en VERDE — el `//` de arriba abre
    // un bloque que se come la fuga entera.
    const v1 = mutado.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(v1).not.toMatch(/pending_authorization/);
    // ⭐⭐ Y AQUÍ ESTÁ EL PUNTO: el control de no-vacuidad que había antes —«¿queda algo?»—
    //     pasaba **en verde** sobre esa misma salida ciega.
    expect(v1).toMatch(/export (function|const)/);
  });

  it('el dominio de códigos es la lista blanca del contrato, y HOY tiene exactamente uno', () => {
    const src = readFileSync(join(process.cwd(), 'src/types/contract.ts'), 'utf8');
    const decl = /export type PendingCode =([^;]+);/.exec(src);
    expect(decl, 'PendingCode desapareció del contrato del front').not.toBeNull();
    const codigos = (decl![1].match(/'[^']+'/g) ?? []).map((c) => c.slice(1, -1));
    // Rojo por EXCESO también: un código que el arquitecto no escribió en §R.2.3 no existe.
    expect(codigos).toEqual(['identity_action_required']);
  });
});
