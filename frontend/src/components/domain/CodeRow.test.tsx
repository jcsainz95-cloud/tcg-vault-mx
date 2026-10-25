import { describe, expect, it, vi } from 'vitest';
import { useEffect, useRef, useState } from 'react';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/render';
import { ApiClientError } from '@/lib/api-client';
import type { DiscountQuoteDTO } from '@/types/contract';
import { CodeRow } from './CodeRow';
import { useDiscountCode, type DiscountScreen, type UseDiscountCode } from './useDiscountCode';

/**
 * `CodeRow` + `useDiscountCode` (DESIGN_SYSTEM §DSC-UX.1/.4): los estados S1-S10 y los textos C1-C14, con un
 * «servidor» de prueba que responde `DiscountQuoteDTO`. ⛔ El renglón nunca calcula: «Ahorras» es el
 * `discountCents`/`shippingWaivedCents` que devolvió el servidor.
 */

const applied = (code: string, discountCents: number, kind: 'percent' | 'free_shipping' = 'percent'): DiscountQuoteDTO => ({
  outcome: 'applied',
  code,
  kind,
  merchandiseBeforeDiscountCents: 420000,
  discountCents: kind === 'free_shipping' ? 0 : discountCents,
  shippingWaivedCents: kind === 'free_shipping' ? discountCents : 0,
});
const notApplicable = (reason: string, details: Record<string, number | string[]> = {}): DiscountQuoteDTO =>
  ({ outcome: 'not_applicable', code: 'X', reason, details }) as DiscountQuoteDTO;

type Server = (code: string) => DiscountQuoteDTO | Promise<DiscountQuoteDTO>;

/** La pantalla mínima: el «quote vigente» sigue al código confirmado, como lo hace la query principal. */
function Harness({
  server,
  screenKind = 'direct_ship',
  variant,
  expose,
}: {
  server: Server;
  screenKind?: DiscountScreen;
  variant?: 'checkout' | 'withdrawal';
  expose?: (api: UseDiscountCode, setCurrent: (d: DiscountQuoteDTO | undefined) => void) => void;
}) {
  const cache = useRef(new Map<string, DiscountQuoteDTO>());
  const [current, setCurrent] = useState<DiscountQuoteDTO | undefined>();
  const api = useDiscountCode({
    screen: screenKind,
    evaluate: async (c) => {
      const r = await server(c);
      cache.current.set(c, r);
      return r;
    },
    current,
  });
  useEffect(() => {
    setCurrent(api.code ? cache.current.get(api.code) : undefined);
  }, [api.code]);
  expose?.(api, setCurrent);
  return <CodeRow variant={variant} {...api.rowProps} />;
}

async function openAndType(code: string) {
  const user = userEvent.setup();
  const toggle = screen.queryByRole('button', { name: /¿Tienes un código/ });
  if (toggle && toggle.getAttribute('aria-expanded') === 'false') await user.click(toggle);
  const input = screen.getByLabelText('Código de descuento');
  await user.clear(input);
  await user.type(input, code);
  return { user, input };
}

describe('CodeRow · S1/S2 — plegado y abierto', () => {
  it('S1: un botón de 48 px con C1, `aria-expanded=false`; S2: al abrir, el campo recibe el foco y «Aplicar» va apagado', async () => {
    renderWithProviders(<Harness server={() => applied('SEPT10', 42000)} />, 'es');
    const toggle = screen.getByRole('button', { name: '¿Tienes un código?' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByLabelText('Código de descuento')).toBeNull();
    await userEvent.setup().click(toggle);
    const input = screen.getByLabelText('Código de descuento');
    await waitFor(() => expect(input).toHaveFocus());
    expect(input).toHaveAttribute('autocomplete', 'off');
    expect(input).toHaveAttribute('autocapitalize', 'characters');
    expect(input).toHaveAttribute('spellcheck', 'false');
    expect(screen.getByRole('button', { name: 'Aplicar' })).toBeDisabled();
  });

  it('se normaliza a mayúsculas sin espacios al teclear; C1b en el retiro', async () => {
    renderWithProviders(<Harness variant="withdrawal" server={() => applied('ENVIO25', 20300, 'free_shipping')} />, 'es');
    const toggle = screen.getByRole('button', { name: '¿Tienes un código de envío gratis?' });
    await userEvent.setup().click(toggle);
    await userEvent.setup().type(screen.getByLabelText('Código de descuento'), ' envio 25');
    expect(screen.getByLabelText('Código de descuento')).toHaveValue('ENVIO25');
  });
});

describe('CodeRow · S3/S4 — aplicando y aplicado', () => {
  it('S3: «Aplicando…», campo y botón apagados; S4: «{CÓDIGO} aplicado · Ahorras {importe}» con el foco en la fila', async () => {
    let release: (d: DiscountQuoteDTO) => void = () => {};
    renderWithProviders(<Harness server={() => new Promise<DiscountQuoteDTO>((r) => (release = r))} />, 'es');
    const { user } = await openAndType('SEPT10');
    await user.click(screen.getByRole('button', { name: 'Aplicar' }));
    expect(screen.getByRole('button', { name: 'Aplicando…' })).toBeDisabled();
    expect(screen.getByLabelText('Código de descuento')).toBeDisabled();
    await act(async () => release(applied('SEPT10', 42000)));
    const row = await screen.findByTestId('code-row-applied');
    expect(row).toHaveTextContent('SEPT10 aplicado');
    expect(row).toHaveTextContent('Ahorras MX$420.00');
    expect(row).toHaveAttribute('role', 'status');
    await waitFor(() => expect(row).toHaveFocus());
    expect(screen.getByRole('button', { name: 'Usar otro código' })).toBeInTheDocument();
  });

  it('C3b: un código de envío gratis dice «Ahorras {importe} de envío»; Enter también aplica', async () => {
    renderWithProviders(<Harness server={() => applied('ENVIO25', 17500, 'free_shipping')} />, 'es');
    const { user } = await openAndType('ENVIO25');
    await user.keyboard('{Enter}');
    expect(await screen.findByTestId('code-row-applied')).toHaveTextContent('Ahorras MX$175.00 de envío');
  });

  it('«Quitar» vuelve al renglón plegado y le devuelve el foco', async () => {
    renderWithProviders(<Harness server={() => applied('SEPT10', 42000)} />, 'es');
    const { user } = await openAndType('SEPT10');
    await user.click(screen.getByRole('button', { name: 'Aplicar' }));
    await screen.findByTestId('code-row-applied');
    await user.click(screen.getByRole('button', { name: 'Quitar' }));
    const toggle = await screen.findByRole('button', { name: '¿Tienes un código?' });
    await waitFor(() => expect(toggle).toHaveFocus());
    expect(screen.queryByTestId('code-row-applied')).toBeNull();
  });
});

describe('CodeRow · S5/S6 — errores', () => {
  it('S5 / DL2: los genéricos (no existe, venció, pausado, agotado, ya usado) pintan EL MISMO texto y la MISMA estructura', async () => {
    renderWithProviders(<Harness server={() => ({ outcome: 'invalid' })} />, 'es');
    const shapes: string[] = [];
    for (const code of ['NOEXISTE', 'VERANO15', 'BOVEDA10', 'AGOTADO5', 'YAUSADO1']) {
      const { user, input } = await openAndType(code);
      await user.click(screen.getByRole('button', { name: 'Aplicar' }));
      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent('Este código no es válido o ya no está disponible.');
      expect(input).toHaveValue(code); // el campo conserva lo escrito
      expect(input).toHaveAttribute('aria-invalid', 'true');
      expect(input).toHaveAttribute('aria-describedby', alert.id);
      await waitFor(() => expect(input).toHaveFocus());
      shapes.push(screen.getByTestId('code-row-field').outerHTML.replace(/value="[^"]*"/, ''));
    }
    expect(new Set(shapes).size).toBe(1);
  });

  it.each([
    ['MIN_SUBTOTAL', { minSubtotalCents: 200000, missingCents: 45000 }, 'direct_ship', 'Te faltan MX$450.00 para usar este código.'],
    ['NO_ELIGIBLE_ITEMS', { productScopes: ['sealed'] }, 'direct_ship', 'Este código aplica solo a sellado.'],
    ['NO_ELIGIBLE_ITEMS', { productScopes: ['raw', 'graded'] }, 'direct_ship', 'Este código aplica solo a cartas sueltas o cartas gradeadas.'],
    ['DESTINATION', { destinations: ['vault'] }, 'direct_ship', 'Este código no aplica a envíos a domicilio.'],
    ['DESTINATION', { destinations: ['direct_ship'] }, 'vault', 'Este código no aplica a compras para tu bóveda.'],
    ['NO_SHIPPING', {}, 'vault', 'Este código cubre el envío y tu pedido a bóveda no lleva envío.'],
    ['WITHDRAWAL_ONLY_FREE_SHIPPING', {}, 'withdrawal', 'En el retiro de bóveda solo aplican los códigos de envío gratis.'],
    ['TOTAL_BELOW_MINIMUM', { minTotalCents: 1000 }, 'direct_ship', 'Con este código el total quedaría por debajo de MX$10.00, el mínimo para pagar.'],
  ] as const)('S6 %s ⇒ su texto (C6/C7/C13)', async (reason, details, screenKind, text) => {
    renderWithProviders(
      <Harness screenKind={screenKind} server={() => notApplicable(reason, details as Record<string, number | string[]>)} />,
      'es',
    );
    const { user } = await openAndType('VIGENTE1');
    await user.click(screen.getByRole('button', { name: 'Aplicar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(text);
  });
});

describe('CodeRow · S7 — reemplazo (C8) y segundo código que falla (C5+)', () => {
  it('con SEPT10 aplicado, NUEVO20 lo reemplaza con aviso de las dos cifras; un tercero inválido NO quita NUEVO20', async () => {
    const server: Server = (c) => (c === 'SEPT10' ? applied('SEPT10', 42000) : c === 'NUEVO20' ? applied('NUEVO20', 84000) : { outcome: 'invalid' });
    renderWithProviders(<Harness server={server} />, 'es');
    let { user } = await openAndType('SEPT10');
    await user.click(screen.getByRole('button', { name: 'Aplicar' }));
    await screen.findByText('SEPT10 aplicado');
    await user.click(screen.getByRole('button', { name: 'Usar otro código' }));
    ({ user } = await openAndType('NUEVO20'));
    await user.click(screen.getByRole('button', { name: 'Aplicar' }));
    await screen.findByText('NUEVO20 aplicado');
    expect(screen.getByTestId('code-row-notice')).toHaveTextContent(
      'Cambiamos SEPT10 (−MX$420.00) por NUEVO20 (−MX$840.00). Solo se aplica un código por pedido.',
    );
    await user.click(screen.getByRole('button', { name: 'Usar otro código' }));
    ({ user } = await openAndType('MALO1234'));
    await user.click(screen.getByRole('button', { name: 'Aplicar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Este código no es válido o ya no está disponible. Se mantiene NUEVO20.');
    expect(screen.getByTestId('code-row-applied')).toHaveTextContent('NUEVO20 aplicado');
  });

  it('C14: el mismo código dos veces ⇒ «Ya tienes este código aplicado.» sin llamar al servidor', async () => {
    const server = vi.fn<Server>(() => applied('SEPT10', 42000));
    renderWithProviders(<Harness server={server} />, 'es');
    let { user } = await openAndType('SEPT10');
    await user.click(screen.getByRole('button', { name: 'Aplicar' }));
    await screen.findByText('SEPT10 aplicado');
    await user.click(screen.getByRole('button', { name: 'Usar otro código' }));
    ({ user } = await openAndType('SEPT10'));
    await user.click(screen.getByRole('button', { name: 'Aplicar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Ya tienes este código aplicado.');
    expect(server).toHaveBeenCalledTimes(1);
  });
});

describe('CodeRow · S8/S9 — bloqueo y red', () => {
  it('S8: `rate_limited` ⇒ C9, campo y botón apagados, sin cuenta regresiva; al vencer, se reabre', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      renderWithProviders(<Harness server={() => ({ outcome: 'rate_limited', retryAfterSeconds: 900 })} />, 'es');
      const { user } = await openAndType('SEPT10');
      await user.click(screen.getByRole('button', { name: 'Aplicar' }));
      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent('Demasiados intentos; espera unos minutos.');
      expect(alert.textContent).not.toMatch(/\d/);
      expect(screen.getByLabelText('Código de descuento')).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Aplicar' })).toBeDisabled();
      await act(async () => {
        vi.advanceTimersByTime(900_000);
      });
      expect(screen.queryByRole('alert')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('S9: falla la red ⇒ C10 y el código escrito se conserva', async () => {
    renderWithProviders(<Harness server={() => Promise.reject(new Error('net'))} />, 'es');
    const { user, input } = await openAndType('SEPT10');
    await user.click(screen.getByRole('button', { name: 'Aplicar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No pudimos revisar el código. Inténtalo de nuevo.');
    expect(input).toHaveValue('SEPT10');
  });
});

describe('CodeRow · S10 — el código dejó de aplicar (C12)', () => {
  it('la cotización vigente ya no lo aplica ⇒ se quita solo con C12 antes de pagar', async () => {
    let setCurrent: (d: DiscountQuoteDTO | undefined) => void = () => {};
    renderWithProviders(<Harness server={() => applied('SEPT10', 42000)} expose={(_, s) => (setCurrent = s)} />, 'es');
    const { user } = await openAndType('SEPT10');
    await user.click(screen.getByRole('button', { name: 'Aplicar' }));
    await screen.findByText('SEPT10 aplicado');
    await act(async () => setCurrent(notApplicable('MIN_SUBTOTAL', { missingCents: 1 })));
    expect(await screen.findByTestId('code-row-notice')).toHaveTextContent(
      'SEPT10 ya no aplica a tu carrito y lo quitamos. Revisa el total antes de pagar.',
    );
    expect(screen.queryByTestId('code-row-applied')).toBeNull();
    expect(screen.getByRole('button', { name: '¿Tienes un código?' })).toBeInTheDocument();
  });

  it('la SESIÓN responde 422 del código ⇒ C12, se quita (no se cobró); un error que no es del código no se toca', async () => {
    let api!: UseDiscountCode;
    renderWithProviders(<Harness server={() => applied('SEPT10', 42000)} expose={(a) => (api = a)} />, 'es');
    const { user } = await openAndType('SEPT10');
    await user.click(screen.getByRole('button', { name: 'Aplicar' }));
    await screen.findByText('SEPT10 aplicado');
    expect(api.handleSessionError(new ApiClientError(409, { code: 'ITEM_UNAVAILABLE', message: '' }))).toBe(false);
    let handled = false;
    await act(async () => {
      handled = api.handleSessionError(new ApiClientError(422, { code: 'DISCOUNT_CODE_NOT_APPLICABLE', message: '', details: { reason: 'MIN_SUBTOTAL' } }));
    });
    expect(handled).toBe(true);
    expect(screen.getByTestId('code-row-notice')).toHaveTextContent('SEPT10 ya no aplica a tu carrito y lo quitamos.');
    expect(api.code).toBeNull();
  });
});
