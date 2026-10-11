import { parseDeckList } from './deck-list.parser';

/**
 * DECKS-META §3.2/§4 (Fase 1) — parser del formato de exportación Limitless / TCG Live.
 * El parser NO empareja (eso es el matcher): sólo extrae {qty, name, setCode, number, group} del
 * texto crudo, deriva `group` de la sección activa, ignora encabezados/pie/blancos, y marca las
 * energías básicas SIN set/número. Casos que fijan el contrato del parser.
 */
describe('parseDeckList (DECKS-META §3.2) — parser Limitless / TCG Live', () => {
  it('línea de carta estándar "4 Dragapult ex TWM 130" ⇒ {qty,name,setCode,number}', () => {
    const { lines } = parseDeckList('4 Dragapult ex TWM 130');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      quantity: 4,
      name: 'Dragapult ex',
      setCode: 'TWM',
      number: '130',
      isBasicEnergy: false,
    });
  });

  it('nombre con varias palabras y ex "3 Iron Hands ex PAR 70"', () => {
    const { lines } = parseDeckList('3 Iron Hands ex PAR 70');
    expect(lines[0]).toMatchObject({ quantity: 3, name: 'Iron Hands ex', setCode: 'PAR', number: '70' });
  });

  it('número con prefijo alfabético "1 Radiant Greninja TG12" (subset TG)', () => {
    const { lines } = parseDeckList('1 Radiant Greninja ASR TG12');
    expect(lines[0]).toMatchObject({ setCode: 'ASR', number: 'TG12', name: 'Radiant Greninja' });
  });

  it('deriva group de la sección activa (Pokémon / Trainer / Energy)', () => {
    const text = [
      'Pokémon: 2',
      '4 Dragapult ex TWM 130',
      '2 Budew PRE 4',
      'Trainer: 1',
      "4 Professor's Research SVI 189",
      'Energy: 1',
      '3 Reversal Energy PAL 192',
    ].join('\n');
    const { lines } = parseDeckList(text);
    expect(lines.map((l) => l.group)).toEqual(['pokemon', 'pokemon', 'trainer', 'energy']);
    expect(lines).toHaveLength(4);
  });

  it('ignora encabezados de sección, líneas en blanco y el pie "Total Cards: 60"', () => {
    const text = ['Pokémon: 1', '', '4 Dragapult ex TWM 130', '', 'Total Cards: 60', ''].join('\n');
    const { lines } = parseDeckList(text);
    expect(lines).toHaveLength(1);
    expect(lines[0].name).toBe('Dragapult ex');
  });

  it('energía BÁSICA sin set/número "8 Basic Fire Energy" ⇒ group energy, isBasicEnergy=true, sin set/número', () => {
    const { lines } = parseDeckList('Energy: 1\n8 Basic Fire Energy');
    expect(lines[0]).toMatchObject({
      quantity: 8,
      group: 'energy',
      isBasicEnergy: true,
      setCode: null,
      number: null,
    });
    expect(lines[0].name).toContain('Fire Energy');
  });

  it('energía básica sin la palabra "Basic" "6 Fire Energy" también se detecta como básica', () => {
    const { lines } = parseDeckList('6 Fire Energy');
    expect(lines[0]).toMatchObject({ quantity: 6, isBasicEnergy: true, setCode: null, number: null });
  });

  it('energía ESPECIAL con set+número "3 Reversal Energy PAL 192" NO es básica (tiene identidad)', () => {
    const { lines } = parseDeckList('3 Reversal Energy PAL 192');
    expect(lines[0]).toMatchObject({ isBasicEnergy: false, setCode: 'PAL', number: '192' });
  });

  it('texto vacío ⇒ 0 líneas', () => {
    expect(parseDeckList('').lines).toHaveLength(0);
    expect(parseDeckList('   \n  \n').lines).toHaveLength(0);
  });

  it('texto sin ninguna línea de carta válida ⇒ 0 líneas (el caller decide 422)', () => {
    expect(parseDeckList('hello world\nlorem ipsum\nTotal Cards: 60').lines).toHaveLength(0);
  });

  it('tolera espacios extra e indentación', () => {
    const { lines } = parseDeckList('   4    Dragapult ex   TWM   130   ');
    expect(lines[0]).toMatchObject({ quantity: 4, name: 'Dragapult ex', setCode: 'TWM', number: '130' });
  });

  it('sin encabezados de sección: default group pokemon para cartas con set+número', () => {
    const { lines } = parseDeckList('4 Dragapult ex TWM 130');
    expect(lines[0].group).toBe('pokemon');
  });
});
