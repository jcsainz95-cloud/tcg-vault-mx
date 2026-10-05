'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { matchNeighborhood } from '@/lib/address-rules';
import type { PostalCodeDTO } from '@/types/contract';
import { usePostalCodeLookup, type PostalCodeLookup } from './usePostalCodeLookup';

/**
 * Los modos de la colonia (`DESIGN_SYSTEM §43.18m.1`; conducta `API_CONTRACT §M4-SHIP.19.25.2`):
 *  - `pending`: CP incompleto, consultando o la consulta falló (y nadie eligió escribir) ⇒ `Select` apagado
 *    con su motivo; con 5 dígitos, la salida «Escribir la colonia a mano».
 *  - `list`: hay lista ⇒ `Select` + «Mi colonia no está».
 *  - `manualNeighborhood`: hay lista y la colonia se escribe ⇒ `Input`; municipio y estado siguen del CP.
 *  - `manualAll`: `404`, `200` sin colonias, o lo eligió el cliente mientras consultaba/fallaba ⇒ colonia,
 *    municipio y estado son campos.
 */
export type NeighborhoodMode = 'pending' | 'list' | 'manualNeighborhood' | 'manualAll';
type Choice = 'auto' | 'manualNeighborhood' | 'manualAll';

/**
 * §43.18e: orden alfabético de PRESENTACIÓN (en el celular no hay búsqueda por letra). ⛔ El valor de cada
 * opción no cambia: es el del catálogo (UX-ADR-13).
 */
export function sortNeighborhoods(list: readonly string[]): string[] {
  return [...list].sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
}

/**
 * §43.18e: si el CP tiene UNA sola colonia y no hay ninguna elegida, el CP la determina ⇒ se preselecciona.
 * ⛔ Con 2 o más, `match` tal cual (placeholder si no había). ⛔ Nunca pisa una colonia escrita (CA-9):
 * quien llama no la usa en ese caso.
 */
export function resolveNeighborhoodMatch(match: string, list: readonly string[]): string {
  return match === '' && list.length === 1 ? list[0] : match;
}

export interface NeighborhoodModeOptions {
  postalCode: string;
  neighborhood: string;
  onNeighborhood: (neighborhood: string) => void;
  /** Municipio y estado al formulario: los del CP (con lista) o el prellenado de un `200` sin colonias. */
  onCityState: (city: string, state: string) => void;
  /** El modo vigente, para que quien monta valide con el texto de ese modo (§43.18m.7). */
  onModeChange?: (mode: NeighborhoodMode) => void;
}

export interface NeighborhoodModeState {
  lookup: PostalCodeLookup;
  mode: NeighborhoodMode;
  /** `manualAll` sin lista que lo explique (404 / 0 colonias) ⇒ `geo.cpNotInCatalog`; si lo eligió el cliente, `geo.manualAllIntro`. */
  manualAllChosen: boolean;
  /** La lista ordenada (§43.18e). */
  neighborhoods: string[];
  /** En modo a mano con una lista a la que volver ⇒ «Elegir de la lista del CP {cp}». */
  canBackToList: boolean;
  toManualNeighborhood: () => void;
  toManualAll: () => void;
  toList: () => void;
  /** Teclear la colonia en modo a mano (se conserva en memoria al ir y volver de la lista, CA-9). */
  typeNeighborhood: (value: string) => void;
  /** Ref del control de colonia vigente (`select` o `input`): el foco va ahí al cambiar de modo por botón. */
  controlRef: (el: HTMLInputElement | HTMLSelectElement | null) => void;
  control: () => HTMLInputElement | HTMLSelectElement | null;
}

/**
 * **La colonia como Mercado Libre** (`HECHOS.md:57`): la lista del CP AYUDA, no bloquea. UN cuerpo para las
 * tres pantallas del cliente (libreta, alta inline del buylist, invitado) y el paso 1 de «Capturar guía».
 *
 * Reglas que no se relajan:
 *  - ⛔ El modo no cambia solo al llegar una respuesta (WCAG 3.2.2, UX-ADR-10): solo lo reinicia **cambiar
 *    el CP** (acto del usuario). La única excepción es abrir el formulario (CA-9, abajo).
 *  - **CA-9 / FC-22 / FC-25:** al abrir con una colonia guardada que NO está en la lista del CP guardado, el
 *    formulario abre en `manualNeighborhood` con ese valor; ⛔ nunca la cambia por `''` ni por la colonia
 *    única del CP. Antes de esto, `AddressStep.tsx` la vaciaba al llegar la lista y un «Guardar» sin tocar
 *    la borraba.
 *  - Municipio y estado de un CP anterior no sobreviven a un CP nuevo: cambiar el CP los vacía; los pone la
 *    respuesta de ESTE CP (o los escribe el usuario en `manualAll`).
 */
export function useNeighborhoodMode(options: NeighborhoodModeOptions): NeighborhoodModeState {
  const { postalCode: cp, neighborhood, onNeighborhood, onCityState, onModeChange } = options;
  const [choice, setChoice] = useState<Choice>('auto');
  const choiceRef = useRef<Choice>(choice);
  choiceRef.current = choice;
  // Lo tecleado a mano, en memoria al ir y volver de la lista (CA-9).
  const manualText = useRef('');
  // CA-9 solo aplica al CP con el que se ABRIÓ el formulario, mientras el usuario no lo cambie.
  const prevCp = useRef(cp);
  const cpChanged = useRef(false);

  const latest = useRef({ neighborhood, onNeighborhood, onCityState });
  latest.current = { neighborhood, onNeighborhood, onCityState };

  useEffect(() => {
    if (prevCp.current === cp) return;
    prevCp.current = cp;
    cpChanged.current = true;
    // El ref también: si la respuesta de este CP ya está en caché, `onResolved` corre en este mismo pase
    // de efectos, antes de que React aplique el `setChoice`.
    choiceRef.current = 'auto';
    setChoice('auto');
    // Municipio y estado eran del CP anterior (o tecleados para él): fuera.
    latest.current.onCityState('', '');
  }, [cp]);

  const lookup = usePostalCodeLookup(cp, {
    selected: neighborhood,
    onResolved: (data: PostalCodeDTO, match: string) => {
      const { neighborhood: current, onNeighborhood: setN, onCityState: setCS } = latest.current;
      // Eligió «todo a mano» mientras consultaba/fallaba ⇒ ⛔ no se le toca nada (UX-ADR-10).
      if (choiceRef.current === 'manualAll') return;
      const list = data.neighborhoods;
      if (list.length === 0) {
        // `200` sin colonias = «todo a mano» automático; se prellena lo que la respuesta sí trae (FC-21).
        if (data.municipality || data.state) setCS(data.municipality ?? '', data.state ?? '');
        return;
      }
      setCS(data.municipality, data.state);
      if (choiceRef.current === 'manualNeighborhood') return;
      if (match === '' && current.trim() !== '' && !cpChanged.current) {
        // CA-9: la colonia guardada no está en la lista ⇒ abre a mano CON su valor.
        manualText.current = current;
        setChoice('manualNeighborhood');
        return;
      }
      const next = resolveNeighborhoodMatch(match, list);
      if (next !== current) setN(next);
    },
  });

  const data = lookup.data;
  const hasList = !!data && data.neighborhoods.length > 0;
  const noList = lookup.cpComplete && (lookup.unknown || (!!data && data.neighborhoods.length === 0));
  let mode: NeighborhoodMode;
  if (!lookup.cpComplete) mode = 'pending';
  else if (choice === 'manualAll') mode = 'manualAll';
  else if (noList) mode = 'manualAll';
  else if (hasList && choice === 'manualNeighborhood') mode = 'manualNeighborhood';
  else if (hasList) mode = 'list';
  else mode = 'pending';
  const manualAllChosen = mode === 'manualAll' && choice === 'manualAll';

  const neighborhoods = useMemo(() => sortNeighborhoods(lookup.neighborhoods), [lookup.neighborhoods]);

  // El foco sigue al control nuevo SOLO cuando el cambio de modo lo pidió el usuario con un botón.
  const el = useRef<HTMLInputElement | HTMLSelectElement | null>(null);
  const focusPending = useRef(false);
  const controlRef = useCallback((node: HTMLInputElement | HTMLSelectElement | null) => {
    el.current = node;
  }, []);
  useEffect(() => {
    if (!focusPending.current) return;
    focusPending.current = false;
    el.current?.focus();
  }, [mode]);

  const onModeChangeRef = useRef(onModeChange);
  onModeChangeRef.current = onModeChange;
  useEffect(() => {
    onModeChangeRef.current?.(mode);
  }, [mode]);

  return {
    lookup,
    mode,
    manualAllChosen,
    neighborhoods,
    canBackToList: (mode === 'manualNeighborhood' || manualAllChosen) && hasList,
    toManualNeighborhood: () => {
      focusPending.current = true;
      onNeighborhood(manualText.current);
      setChoice('manualNeighborhood');
    },
    toManualAll: () => {
      focusPending.current = true;
      const v = manualText.current || neighborhood;
      manualText.current = v;
      if (v !== neighborhood) onNeighborhood(v);
      setChoice('manualAll');
    },
    toList: () => {
      if (!data) return;
      focusPending.current = true;
      manualText.current = neighborhood;
      onNeighborhood(matchNeighborhood(neighborhood, data.neighborhoods));
      onCityState(data.municipality, data.state);
      setChoice('auto');
    },
    typeNeighborhood: (value: string) => {
      manualText.current = value;
      onNeighborhood(value);
    },
    controlRef,
    control: () => el.current,
  };
}
