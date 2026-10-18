import { StrictBodyPipe } from '../src/modules/wishlist/dto/wishlist.dto';
import { CreateLeadDto, CreatePlayerDto } from '../src/modules/card-show/dto/card-show.dto';
import type { ArgumentMetadata } from '@nestjs/common';

const META = { type: 'body' } as ArgumentMetadata;
const leadPipe = new StrictBodyPipe(CreateLeadDto);
const playerPipe = new StrictBodyPipe(CreatePlayerDto);

const validLead = {
  type: 'visitor',
  name: 'Ana',
  email: 'alguien@dominio.mx',
  source: 'cta_hero',
  consent: true,
  formToken: 'tok.sig',
};
const validPlayer = {
  game: 'pokemon',
  day: 'sat',
  playerName: 'Ash Ketchum',
  playerId: '1234567',
  email: 'alguien@dominio.mx',
  isMinor: false,
  consent: true,
  formToken: 'tok.sig',
};

async function code(pipe: StrictBodyPipe<object>, body: unknown): Promise<string> {
  try {
    await pipe.transform(body, META);
    return 'OK';
  } catch (e) {
    return (e as { code?: string }).code ?? 'ERR';
  }
}

/** §CARDSHOW.11.v — validación de FORMA ⇒ 400 (⛔ no silenciosa). */
describe('CARDSHOW · validación de leads', () => {
  it('válido ⇒ pasa', async () => expect(await code(leadPipe, validLead)).toBe('OK'));
  it('type=ADMIN (mayúscula / fuera de dominio) ⇒ 400', async () =>
    expect(await code(leadPipe, { ...validLead, type: 'ADMIN' })).toBe('VALIDATION_ERROR'));
  it('type=MERCHANT (mayúscula) ⇒ 400', async () =>
    expect(await code(leadPipe, { ...validLead, type: 'MERCHANT' })).toBe('VALIDATION_ERROR'));
  it('email de 300 chars ⇒ 400', async () =>
    expect(await code(leadPipe, { ...validLead, email: `${'a'.repeat(290)}@x.mx` })).toBe('VALIDATION_ERROR'));
  it('consent=false ⇒ 400', async () =>
    expect(await code(leadPipe, { ...validLead, consent: false })).toBe('VALIDATION_ERROR'));
  it('consent ausente ⇒ 400', async () => {
    const { consent, ...noConsent } = validLead;
    void consent;
    expect(await code(leadPipe, noConsent)).toBe('VALIDATION_ERROR');
  });
  it('utmSource con <script> ⇒ 400', async () =>
    expect(await code(leadPipe, { ...validLead, utmSource: '<script>x</script>' })).toBe('VALIDATION_ERROR'));
  it('campo desconocido ⇒ 400 (cuerpo estricto)', async () =>
    expect(await code(leadPipe, { ...validLead, sorpresa: 1 })).toBe('VALIDATION_ERROR'));
  it('Email@Dominio.MX normaliza en el servicio pero pasa la validación', async () =>
    expect(await code(leadPipe, { ...validLead, email: 'Email@Dominio.MX' })).toBe('OK'));

  // ⭐M-84 — forma (independiente del tipo) de los campos nuevos. La regla CONDICIONAL por tipo la mide
  // el servicio (card-show.leads-fields.spec.ts); aquí solo la forma del DTO estricto.
  it('name ausente ⇒ 400 (obligatorio en todos los tipos)', async () => {
    const { name, ...noName } = validLead;
    void name;
    expect(await code(leadPipe, noName)).toBe('VALIDATION_ERROR');
  });
  it('name con @ ⇒ 400', async () =>
    expect(await code(leadPipe, { ...validLead, name: 'a@b' })).toBe('VALIDATION_ERROR'));
  it('name con < ⇒ 400', async () =>
    expect(await code(leadPipe, { ...validLead, name: 'Tienda <x>' })).toBe('VALIDATION_ERROR'));
  it('name con http ⇒ 400', async () =>
    expect(await code(leadPipe, { ...validLead, name: 'visita http x' })).toBe('VALIDATION_ERROR'));
  it('name con dígitos y & (marca) ⇒ OK (más laxa a propósito)', async () =>
    expect(await code(leadPipe, { ...validLead, name: 'Tienda 3D & Cartas' })).toBe('OK'));
  it('gameInterest fuera de dominio ⇒ 400', async () =>
    expect(await code(leadPipe, { ...validLead, gameInterest: 'magic' })).toBe('VALIDATION_ERROR'));
  it('gameInterest=POKEMON (mayúscula) ⇒ 400', async () =>
    expect(await code(leadPipe, { ...validLead, gameInterest: 'POKEMON' })).toBe('VALIDATION_ERROR'));
  it('gameInterest=pokemon ⇒ OK', async () =>
    expect(await code(leadPipe, { ...validLead, gameInterest: 'pokemon' })).toBe('OK'));
  it('mesaInteres en el cuerpo ⇒ 400 (campo retirado del DTO, §CARDSHOW.1a-bis)', async () =>
    expect(await code(leadPipe, { ...validLead, mesaInteres: 3 })).toBe('VALIDATION_ERROR'));
});

describe('CARDSHOW · validación de preinscripción', () => {
  it('válido ⇒ pasa', async () => expect(await code(playerPipe, validPlayer)).toBe('OK'));
  it('playerName con dígitos ⇒ 400', async () =>
    expect(await code(playerPipe, { ...validPlayer, playerName: 'Ash 123' })).toBe('VALIDATION_ERROR'));
  it('playerName con @ ⇒ 400', async () =>
    expect(await code(playerPipe, { ...validPlayer, playerName: 'a@b' })).toBe('VALIDATION_ERROR'));
  it('playerName con < ⇒ 400', async () =>
    expect(await code(playerPipe, { ...validPlayer, playerName: 'a<b' })).toBe('VALIDATION_ERROR'));
  it('playerName con http:// ⇒ 400', async () =>
    expect(await code(playerPipe, { ...validPlayer, playerName: 'http://x' })).toBe('VALIDATION_ERROR'));
  it('playerId con letras ⇒ 400', async () =>
    expect(await code(playerPipe, { ...validPlayer, playerId: '12a45' })).toBe('VALIDATION_ERROR'));
  it('playerId de 13 dígitos ⇒ 400', async () =>
    expect(await code(playerPipe, { ...validPlayer, playerId: '1234567890123' })).toBe('VALIDATION_ERROR'));
  it('day=both ⇒ pasa (el servicio crea 2 filas)', async () =>
    expect(await code(playerPipe, { ...validPlayer, day: 'both' })).toBe('OK'));
  it('consent=false ⇒ 400', async () =>
    expect(await code(playerPipe, { ...validPlayer, consent: false })).toBe('VALIDATION_ERROR'));

  // ⭐M-84 — `game` obligatorio y en minúscula; `playerId` opcional a nivel DTO (regla formal/ligera en servicio).
  it('game ausente ⇒ 400', async () => {
    const { game, ...noGame } = validPlayer;
    void game;
    expect(await code(playerPipe, noGame)).toBe('VALIDATION_ERROR');
  });
  it('game=POKEMON (mayúscula) ⇒ 400', async () =>
    expect(await code(playerPipe, { ...validPlayer, game: 'POKEMON' })).toBe('VALIDATION_ERROR'));
  it('game=riftbound sin playerId ⇒ OK a nivel DTO (servicio decide formal/ligera)', async () => {
    const { playerId, ...noId } = validPlayer;
    void playerId;
    expect(await code(playerPipe, { ...noId, game: 'riftbound' })).toBe('OK');
  });
});
