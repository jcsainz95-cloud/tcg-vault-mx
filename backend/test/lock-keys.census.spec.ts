/**
 * lock-keys.census.spec.ts — censo de las claves de candado consultivo (`*_LOCK_KEY`) de `src/`: cada una es PROPIA.
 *
 * Dos candados con la misma clave se serializan entre sí sin que nadie lo haya decidido (o, peor, uno cree tener su turno
 * porque el otro tiene «el mismo» candado). API_CONTRACT §DYN.4.3 exige para `GRADED_TURNS_LOCK_KEY` una clave «distinta de las
 * demás `*_LOCK_KEY` del código»; PEN-DYN-2 añade `SETTINGS_CROSS_RULES_LOCK_KEY`. Lee el código, no la prosa.
 */
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { GRADED_TURNS_LOCK_KEY } from '../src/modules/pricing/price-ingest.service';
import { SETTINGS_CROSS_RULES_LOCK_KEY } from '../src/modules/settings/settings.constants';
import { ACCOUNT_AUTH_GATE_NAMESPACE } from '../src/modules/auth/account-gate';
import { ADDRESS_BOOK_GATE_NAMESPACE } from '../src/modules/users/users.service';
import { RESERVATION_GATE_NAMESPACE } from '../src/modules/orders/reservation';
import { VAULT_GATE_NAMESPACE } from '../src/modules/vault/vault-placement.rules';
import { IDS_ATTACH_NAMESPACE } from '../src/modules/inventory/inventory-versions.service';
import { OPERATOR_REFUND_GATE_NAMESPACE } from '../src/modules/payments/refunds/refund-ledger.service';
import { BANNER_COUNTER_LOCK_NAMESPACE } from '../src/modules/measurement/banner-response.service';
import { META_TEST_EVENT_LOCK_NAMESPACE } from '../src/modules/measurement/meta-test-event.service';
import { SEARCH_MISS_DAY_NAMESPACE } from '../src/modules/marketing/marketing-search-miss.service';

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts') && !p.endsWith('.spec.ts')) out.push(p);
  }
  return out;
}

/** `export const X_LOCK_KEY = 12_345;` ⇒ [nombre, valor, fichero]. */
export function lockKeysIn(
  sources: { file: string; text: string }[],
  suffix: 'LOCK_KEY' | 'NAMESPACE' = 'LOCK_KEY',
): { name: string; value: number; file: string }[] {
  const out: { name: string; value: number; file: string }[] = [];
  const re = new RegExp(`export const (\\w+_${suffix})\\s*=\\s*([\\d_]+)\\s*;`, 'g');
  for (const { file, text } of sources) {
    for (const m of text.matchAll(re)) {
      out.push({ name: m[1], value: Number(m[2].replace(/_/g, '')), file });
    }
  }
  return out;
}

function duplicates(keys: { name: string; value: number }[]): string[] {
  const byValue = new Map<number, string[]>();
  for (const k of keys) byValue.set(k.value, [...(byValue.get(k.value) ?? []), k.name]);
  return [...byValue.entries()].filter(([, names]) => names.length > 1).map(([v, names]) => `${v}: ${names.join(', ')}`);
}

describe('censo de claves de candado consultivo', () => {
  const src = join(__dirname, '..', 'src');
  const keys = lockKeysIn(walk(src).map((file) => ({ file, text: readFileSync(file, 'utf8') })));

  it('lee las claves del código (si el patrón dejara de casar, el censo no mediría nada)', () => {
    expect(keys.length).toBeGreaterThanOrEqual(10);
    expect(keys.map((k) => k.name)).toEqual(expect.arrayContaining(['GRADED_TURNS_LOCK_KEY', 'SETTINGS_CROSS_RULES_LOCK_KEY']));
    expect(keys.find((k) => k.name === 'GRADED_TURNS_LOCK_KEY')?.value).toBe(GRADED_TURNS_LOCK_KEY);
    expect(keys.find((k) => k.name === 'SETTINGS_CROSS_RULES_LOCK_KEY')?.value).toBe(SETTINGS_CROSS_RULES_LOCK_KEY);
  });

  it('ninguna clave se repite', () => {
    expect(duplicates(keys)).toEqual([]);
  });

  /**
   * v1.114.5 (API_CONTRACT §DYN.1 «Limpieza PDB», G-11): la limpieza solo se protege de un cálculo a medias si TODA escritura de
   * `ListingPrice` y `FeaturedSelection*` va bajo su llave. Hoy viven en dos ficheros, leídos a mano (cada escritura dentro
   * de una transacción que tomó la llave); un fichero NUEVO que escriba en ellas pone esto rojo hasta que alguien lo lea.
   */
  it('G-11: solo `listing-price.service.ts` y `featured.service.ts` escriben `ListingPrice` / `FeaturedSelection*`', () => {
    const W = /(listingPrice|featuredSelection|featuredSelectionItem)\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\b|(INSERT INTO|UPDATE|DELETE FROM) "(ListingPrice|FeaturedSelection|FeaturedSelectionItem)"/;
    const writers = walk(src)
      .filter((f) => W.test(readFileSync(f, 'utf8')))
      .map((f) => f.slice(src.length + 1))
      .sort();
    expect(writers).toEqual(['modules/catalog/featured.service.ts', 'modules/pricing/listing-price.service.ts']);
    // canario del patrón
    expect(W.test('await tx.listingPrice.deleteMany({})')).toBe(true);
    expect(W.test('await tx.listingPriceRun.update({})')).toBe(false);
  });

  it('canario: una clave repetida se detecta', () => {
    const fake = lockKeysIn([
      { file: 'a.ts', text: 'export const A_LOCK_KEY = 91_130_103;' },
      { file: 'b.ts', text: 'export const B_LOCK_KEY = 91130103;' },
    ]);
    expect(duplicates(fake)).toEqual(['91130103: A_LOCK_KEY, B_LOCK_KEY']);
  });
});

/**
 * TL-CTA-15 — censo de los NAMESPACES de los candados de dos claves (`pg_advisory_xact_lock(<namespace>::int, hashtext(<id>))`).
 * El de la cuenta (§CTA.13) debe ser «distinto de los seis de hoy»; hasta aquí eso vivía en prosa (`account-gate.ts` y el
 * contrato). Espacio aparte del de `*_LOCK_KEY` (la forma de una clave `bigint` y la de dos `int` no se solapan en Postgres).
 * Lee el código y, además, importa cada constante: si el patrón dejara de casar con una, el valor importado lo delata.
 */
describe('censo de namespaces de candado consultivo de dos claves', () => {
  const src = join(__dirname, '..', 'src');
  const namespaces = lockKeysIn(
    walk(src).map((file) => ({ file, text: readFileSync(file, 'utf8') })),
    'NAMESPACE',
  );
  const IMPORTED: Record<string, number> = {
    ACCOUNT_AUTH_GATE_NAMESPACE,
    ADDRESS_BOOK_GATE_NAMESPACE,
    RESERVATION_GATE_NAMESPACE,
    VAULT_GATE_NAMESPACE,
    IDS_ATTACH_NAMESPACE,
    OPERATOR_REFUND_GATE_NAMESPACE,
    BANNER_COUNTER_LOCK_NAMESPACE,
    META_TEST_EVENT_LOCK_NAMESPACE,
    SEARCH_MISS_DAY_NAMESPACE, // c6: serializa por día los topes 200/300 (MKT-V2)
  };

  it('el censo leído del código es exactamente el importado (un namespace nuevo se añade aquí a mano, y se mira)', () => {
    expect(Object.fromEntries(namespaces.map((n) => [n.name, n.value]))).toEqual(IMPORTED);
  });

  it('ningún namespace se repite', () => {
    expect(duplicates(Object.entries(IMPORTED).map(([name, value]) => ({ name, value })))).toEqual([]);
    expect(duplicates(namespaces)).toEqual([]);
  });

  it('canario: un namespace repetido se detecta', () => {
    const fake = lockKeysIn(
      [
        { file: 'a.ts', text: 'export const A_GATE_NAMESPACE = 88_120_116;' },
        { file: 'b.ts', text: 'export const B_GATE_NAMESPACE = 88120116;' },
      ],
      'NAMESPACE',
    );
    expect(duplicates(fake)).toEqual(['88120116: A_GATE_NAMESPACE, B_GATE_NAMESPACE']);
  });
});
