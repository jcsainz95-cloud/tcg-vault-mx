/**
 * sdx-d2b.quote.spec.ts — 💰 D2b de Skydropx, las piezas PURAS de cotizar (API_CONTRACT §M4-SHIP.19.19.4/.5, §19.20.4,
 * §19.6 paso 4) y las del folio que D2b/D2c comparten (§19.29.1.2, §19.30.5). Propiedad: backend. La conducta contra
 * Postgres real y la app por HTTP está en `test/integration/sdx-d2b-quote.e2e-spec.ts`.
 *
 * PS cubiertas aquí (lado puro): PS-70 (normalización con el fixture MEDIDO, recomendada, margen, IVA), PS-96 (escalones),
 * PS-111 (`isPromoPlan`), PS-135 (d) (`folioTokenOf`) y C-23 (neutralización con NFKC, todas las llaves).
 */
import { completedQuotationFixture } from '../src/modules/shipping-provider/fixtures/skydropx-quotation.fixture';
import { normalizeRates } from '../src/modules/shipping-provider/rate-normalization';
import { isPromoPlan } from '../src/modules/shipping-provider/promo-plan';
import { folioTokenOf, providerReferenceOf, referenceTextOf } from '../src/modules/shipping-provider/folio-token';
import { ProviderRate } from '../src/modules/shipping-provider/shipping-provider.port';
import { insuranceCoverageFor, maxCoverageCentsOf } from '../src/modules/shipments/insurance';
import { neutralizeFolioPattern, neutralizeOutboundAddress } from '../src/modules/shipments/folio-neutralize';
import { excludedFromRaw, packageCodeByRule, parseQuoteBody, toRateDtos } from '../src/modules/shipments/label-quote.service';
import { skydropxComputedIvaCents } from '../src/common/money';
import { DEFAULT_SHIPPING_INSURANCE_TIERS } from '../src/modules/settings/shipping-dials';
import { redactProviderPayload } from '../src/modules/shipping-provider/redact';

const measured = () => normalizeRates(completedQuotationFixture().rates, { insuranceEchoOk: true });
const ctx = (over: Partial<Parameters<typeof toRateDtos>[1]> = {}) => ({
  chargedNetCents: 17500,
  tierCostCents: 2500,
  insuranceEchoOk: true,
  preferredCarriers: ['ninetynineminutes'],
  dropoffPoints: { ninetynineminutes: { name: 'Punto99', address: 'Periférico Sur 4249' } },
  ...over,
});

describe('PS-111 — `isPromoPlan` (§19.20.4)', () => {
  it.each([
    ['50PESOS_30042026', true],
    ['50PESOS_20052026', true],
    ['PROMO_1_PESO_19082026', true],
    ['1PESO_X', true],
    ['ACQ_2026', false],
    [null, false],
    ['FOO', false],
    ['', false],
    ['promo_1', false],
  ])('%s ⇒ %s', (plan, expected) => {
    expect(isPromoPlan(plan as string | null)).toBe(expected);
  });
});

describe('PS-96 — `insuranceCoverageFor`: el escalón que CUBRA, con `≥` (§19.19.5, HECHOS.md:48)', () => {
  const tiers = DEFAULT_SHIPPING_INSURANCE_TIERS;
  it.each([
    [0, 250000, 2500],
    [30000, 250000, 2500],
    [250000, 250000, 2500], // exactamente $2,500 ⇒ el escalón de $2,500 (no el de $10,000)
    [250001, 1000000, 17000],
    [1000000, 1000000, 17000],
  ])('valor %i ⇒ cobertura %i (costo %i)', (value, coverage, cost) => {
    expect(insuranceCoverageFor(value, tiers)).toEqual({ coverageCents: coverage, costCents: cost });
  });

  it('por encima del último escalón ⇒ `null` (⛔ nunca se recorta al mayor); `maxCoverageCents` = el mayor', () => {
    expect(insuranceCoverageFor(1000001, tiers)).toBeNull();
    expect(maxCoverageCentsOf(tiers)).toBe(1000000);
    expect(insuranceCoverageFor(1, [])).toBeNull();
  });

  it('elige el MENOR que cubre aunque la tabla venga en otro orden', () => {
    const shuffled = [{ coverageCents: 1000000, costCents: 17000, measuredAt: 'x' }, { coverageCents: 250000, costCents: 2500, measuredAt: 'x' }];
    expect(insuranceCoverageFor(1000, shuffled)).toEqual({ coverageCents: 250000, costCents: 2500 });
  });
});

describe('§19.6 paso 4 — la regla de empaque (PS-70 «empaque»)', () => {
  const cards = (n: number, sealed = 0) => [
    ...Array.from({ length: n }, (_, i) => ({ inventoryItemId: `c${i}`, sealed: false, paidCents: 100 })),
    ...Array.from({ length: sealed }, (_, i) => ({ inventoryItemId: `s${i}`, sealed: true, paidCents: 100 })),
  ];
  it('61 cartas ⇒ box; 60 ⇒ envelope (estrictamente «más de N»); 3 cartas + 1 sellado ⇒ box; 10 ⇒ envelope', () => {
    expect(packageCodeByRule(cards(61), 60)).toBe('box');
    expect(packageCodeByRule(cards(60), 60)).toBe('envelope');
    expect(packageCodeByRule(cards(3, 1), 60)).toBe('box');
    expect(packageCodeByRule(cards(10), 60)).toBe('envelope');
  });
});

describe('PS-70 — normalización a `ShipmentRateDTO` con el fixture MEDIDO (§19.19.4)', () => {
  it('ordenadas por precio; `hidden` solo en sucursal; 99minutos recomendada AUNQUE no sea la más barata', () => {
    const { rates, recommendedRateId } = toRateDtos(measured().rates, ctx());
    const prices = rates.map((r) => r.priceCents);
    expect(prices).toEqual([...prices].sort((a, b) => a - b));
    expect(rates.filter((r) => r.hidden).map((r) => r.carrierName)).toEqual(['punto_post']);
    const nn = rates.find((r) => r.carrierName === 'ninetynineminutes')!;
    expect(recommendedRateId).toBe(nn.rateId);
    expect(rates.filter((r) => r.recommended)).toEqual([nn]);
    const cheapestHome = rates.find((r) => !r.hidden)!;
    expect(cheapestHome.priceCents).toBeLessThan(nn.priceCents);
    expect(nn.dropoff).toEqual({ name: 'Punto99', address: 'Periférico Sur 4249' });
    expect(rates.find((r) => r.carrierName === 'ampm')!.dropoff).toBeNull();
  });

  it('precio = total + seguro (⛔ el seguro no se esconde); IVA del proveedor; neto = precio − IVA; margen = cobrado neto − costo neto', () => {
    const { rates } = toRateDtos(measured().rates, ctx());
    const p = rates.find((r) => r.carrierName === 'paquetexpress')!;
    // El ejemplo normativo de §19.19.11: total 5125, vat_fee 689 (redondeo del fixture), seguro 2500.
    expect(p.breakdown).toEqual({ amountCents: expect.any(Number), extraFeesCents: expect.any(Number), ivaCents: 689, serviceFeeCents: 127, totalCents: 5125, insuranceCents: 2500 });
    expect(p.priceCents).toBe(7625);
    expect(p.ivaSource).toBe('provider');
    expect(p.netCostCents).toBe(7625 - 689);
    expect(p.marginCents).toBe(17500 - (7625 - 689));
    expect(p.isPromo).toBe(true);
    expect(rates.find((r) => r.carrierName === 'ninetynineminutes')!.isPromo).toBe(false);
  });

  it('tarifa con `vat_fee: null` ⇒ IVA `computed` = round((total − service_fee) × 16/116), ⛔ no el dial', () => {
    const base = measured().rates.find((r) => r.carrierName === 'fedex')!;
    const r: ProviderRate = { ...base, vatCents: null };
    const [dto] = toRateDtos([r], ctx()).rates;
    expect(dto.ivaSource).toBe('computed');
    expect(dto.breakdown.ivaCents).toBe(Math.round(((base.totalCents - base.serviceFeeCents) * 16) / 116));
    expect(skydropxComputedIvaCents(5125 - 127)).toBe(689); // 4998 × 16/116 = 689.37
  });

  it('eco del seguro que NO coincide ⇒ el costo de la TABLA (`tier_table`); que coincide ⇒ el de la cotización (`quote`)', () => {
    const noEcho = normalizeRates(completedQuotationFixture().rates, { insuranceEchoOk: false }).rates;
    const a = toRateDtos(noEcho, ctx({ insuranceEchoOk: false, tierCostCents: 17000 })).rates;
    expect(a.every((r) => r.insuranceSource === 'tier_table' && r.breakdown.insuranceCents === 17000)).toBe(true);
    const drift: string[] = [];
    const withProtection = measured().rates.map((r) => ({ ...r, insuranceCents: 2600 }));
    const b = toRateDtos(withProtection, ctx({ onInsuranceTierDrift: (id) => drift.push(id) })).rates;
    expect(b.every((r) => r.insuranceSource === 'quote' && r.breakdown.insuranceCents === 2600)).toBe(true);
    expect(drift.length).toBe(b.length); // manda la cotización y se avisa la deriva (log `insurance_tier_drift`)
  });

  it('sin preferidas ⇒ la más barata a domicilio; sin ninguna a domicilio ⇒ `null`', () => {
    const { rates, recommendedRateId } = toRateDtos(measured().rates, ctx({ preferredCarriers: [] }));
    const cheapestHome = rates.filter((r) => r.deliveryKind !== 'branch').sort((x, y) => x.priceCents - y.priceCents)[0];
    expect(recommendedRateId).toBe(cheapestHome.rateId);
    const branchOnly = measured().rates.filter((r) => r.deliveryKind === 'branch');
    expect(toRateDtos(branchOnly, ctx()).recommendedRateId).toBeNull();
  });

  it('el margen sale de lo COBRADO que se le pasa (columnas), no de un dial', () => {
    const a = toRateDtos(measured().rates, ctx({ chargedNetCents: 17500 })).rates[0];
    const b = toRateDtos(measured().rates, ctx({ chargedNetCents: 12931 })).rates[0];
    expect(a.marginCents - b.marginCents).toBe(17500 - 12931);
  });

  it('`excluded` de una cotización reutilizada sale de la respuesta guardada (redactada) con el MISMO filtro', () => {
    const raw = redactProviderPayload(completedQuotationFixture()) as never;
    expect(excludedFromRaw(raw)).toEqual(measured().excluded);
    expect(excludedFromRaw(null)).toEqual({ unavailable: 0, noCoverage: 0, notApplicable: 0, multipackage: 0, breakdownMismatch: 0 });
  });
});

describe('`POST …/quote` — el cuerpo (§19.19.4)', () => {
  it('`declaredValueCents` NO existe: se ignora; `packageCode` y `force` opcionales', () => {
    expect(parseQuoteBody({ declaredValueCents: 1, force: true, packageCode: ' box ' })).toEqual({ packageCode: 'box', force: true });
    expect(parseQuoteBody(undefined)).toEqual({ packageCode: null, force: false });
  });
  it('tipos inválidos ⇒ 400 con `field`', () => {
    expect(() => parseQuoteBody({ force: 'yes' })).toThrow(expect.objectContaining({ response: expect.objectContaining({ details: { field: 'force' } }) }));
    expect(() => parseQuoteBody({ packageCode: '' })).toThrow();
    expect(() => parseQuoteBody({ packageCode: 3 })).toThrow();
  });
});

describe('PS-135 (d) / C-18 — `folioTokenOf` anclado al texto entero, intento de DOS dígitos (§19.29.1.2)', () => {
  it.each([
    ['Pedido ENV-000045-01', 'ENV-000045-01'],
    ['  pedido env-000045-01 ', 'ENV-000045-01'],
    ['Pedido ENV-1000000-01', 'ENV-1000000-01'],
    ['Pedido ENV-000045-1', null],
    ['Pedido ENV-000045-123', null],
    ['x ENV-000045-01', null],
    ['Pedido ENV-000045-01 casa azul', null],
    ['Pedido ENV-000045-01 Pedido ENV-000046-01', null],
    ['Pedido ENV-00045-01', null],
    [null, null],
  ])('%s ⇒ %s', (text, token) => {
    expect(folioTokenOf(text as string | null)).toBe(token);
  });

  it('`providerReferenceOf` arma `<folio>-<NN>`; intento 100 o 0 ⇒ lanza; el texto que viaja es «Pedido <token>»', () => {
    expect(providerReferenceOf('ENV-000045', 1)).toBe('ENV-000045-01');
    expect(providerReferenceOf('ENV-1000000', 12)).toBe('ENV-1000000-12');
    expect(() => providerReferenceOf('ENV-000045', 100)).toThrow();
    expect(() => providerReferenceOf('ENV-000045', 0)).toThrow();
    expect(referenceTextOf('ENV-000045-02')).toBe('Pedido ENV-000045-02');
    expect(folioTokenOf(referenceTextOf(providerReferenceOf('ENV-000045', 2)))).toBe('ENV-000045-02');
  });
});

describe('C-23 — la neutralización recorre TODAS las llaves con NFKC y guiones tipográficos (§19.30.5)', () => {
  const FORGED = /ENV\s*[-‐–—]\s*\d/i;
  it.each([
    'Pedido ENV-000046-01',
    'Pedido ＥＮＶ－000046－01',
    'Pedido ENV‐000046‐01',
    'Pedido ENV–000046–01',
    'Pedido ENV—000046—01',
    'Pedido E N V - 000046-01',
    'pedido env-000046-01',
  ])('«%s» ⇒ tras NFKC no queda nada con forma de folio', (text) => {
    const out = neutralizeFolioPattern(text);
    expect(out.normalize('NFKC')).not.toMatch(FORGED);
    expect(folioTokenOf(out)).toBeNull();
  });

  it('el destino entero (llaves nuevas incluidas, recursivo) sale neutralizado; `reference` se respeta; el original NO cambia', () => {
    const to = {
      name: 'Pedido ENV-000046-01',
      street1: 'Calle ENV–000046–01',
      neighborhood: 'ＥＮＶ－000046－01',
      furtherInformation: 'ENV-000046-01',
      somethingNew: 'ENV-000046-01',
      nested: { deep: ['ENV-000046-01'] },
      reference: 'Pedido ENV-000045-01',
    };
    const copy = JSON.parse(JSON.stringify(to));
    const out = neutralizeOutboundAddress(to, ['reference']);
    expect(to).toEqual(copy);
    const { reference, ...rest } = out;
    expect(reference).toBe('Pedido ENV-000045-01');
    expect(JSON.stringify(rest).normalize('NFKC')).not.toMatch(FORGED);
  });

  it('texto sin el patrón: solo NFKC (lo demás intacto)', () => {
    expect(neutralizeFolioPattern('Av. Revolución 1500, Int. 4')).toBe('Av. Revolución 1500, Int. 4');
    expect(neutralizeFolioPattern('ENVIOS 24')).toBe('ENVIOS 24');
  });
});
