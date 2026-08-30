import { Injectable } from '@angular/core';
import {
  CATALOG_BY_REF,
  CatalogExercise,
  EXERCISE_CATALOG,
  Equipment,
  MuscleGroup,
} from '../data/exercise-catalog';
import { Exercise, TrainingLevel } from '../models/workout.model';
import { ROUTINE_TEMPLATES, RoutineTemplate } from '../data/routine-templates';
import { normalizeExerciseName } from './storage.service';

export interface CatalogFilters {
  text?: string;
  group?: MuscleGroup | null;
  equipment?: Equipment | null;
}

/**
 * Índice de nombres → `ref`, construido una vez.
 *
 * Incluye el nombre en español, en inglés y todos los sinónimos, todos normalizados con la
 * MISMA función que usa el catálogo de ejercicios del usuario. Así "Press de Banca",
 * "press banca" y "bench press" caen en el mismo sitio.
 */
let refByName: Map<string, string> | null = null;

function nameIndex(): Map<string, string> {
  // Perezoso a propósito: construirlo al cargar el módulo lo ataría al orden de importación
  // con `storage.service`, de donde viene el normalizador.
  if (refByName) return refByName;
  const index = new Map<string, string>();
  for (const item of EXERCISE_CATALOG) {
    for (const name of [item.es, item.en, ...item.synonyms]) {
      const key = normalizeExerciseName(name);
      if (key && !index.has(key)) index.set(key, item.ref);
    }
  }
  refByName = index;
  return index;
}

/**
 * Enlace nombre → `ref` del catálogo, disponible sin inyección.
 *
 * La migración que puebla `catalogRef` corre dentro de `StorageService`, que no puede
 * inyectar servicios, así que necesita esta puerta sin DI.
 */
export function catalogRefForName(name: string): string | null {
  return nameIndex().get(normalizeExerciseName(name)) ?? null;
}

@Injectable({ providedIn: 'root' })
export class CatalogService {
  readonly all = EXERCISE_CATALOG;

  byRef(ref: string | null | undefined): CatalogExercise | null {
    return ref ? (CATALOG_BY_REF.get(ref) ?? null) : null;
  }

  /**
   * Enlaza un ejercicio del usuario con el catálogo por nombre normalizado (R-3).
   *
   * Devuelve `null` cuando no hay coincidencia, y eso NO es un problema: el ejercicio sigue
   * siendo suyo, con su historial intacto, solo que sin metadatos. Adivinar el enlace por
   * parecido sería peor que no enlazar — mezclaría el historial de dos ejercicios distintos.
   */
  refFor(exerciseName: string): string | null {
    return catalogRefForName(exerciseName);
  }

  /** Nombre del catálogo en el idioma activo. */
  nameOf(item: CatalogExercise, lang: 'es' | 'en'): string {
    return lang === 'en' ? item.en : item.es;
  }

  /** El idioma no filtra: la búsqueda mira ES, EN y sinónimos a la vez, siempre. */
  search(filters: CatalogFilters): CatalogExercise[] {
    const text = normalizeExerciseName(filters.text ?? '');
    return this.all.filter((item) => {
      if (filters.group && item.group !== filters.group) return false;
      if (filters.equipment && item.equipment !== filters.equipment) return false;
      if (!text) return true;
      const haystack = [item.es, item.en, ...item.synonyms].map(normalizeExerciseName);
      return haystack.some((h) => h.includes(text));
    });
  }

  /**
   * Alternativas para sustituir un ejercicio (RF-EJ-04).
   *
   * Mismo patrón de movimiento primero —es lo que hace equivalente a un ejercicio, no el
   * músculo— y luego mismo grupo. Se filtra por el equipo disponible cuando se conoce, para
   * no proponer una máquina a quien entrena en casa.
   */
  alternativesFor(
    exerciseName: string,
    opts: { equipment?: Equipment[] | null; limit?: number } = {},
  ): CatalogExercise[] {
    const ref = this.refFor(exerciseName);
    const source = this.byRef(ref);
    if (!source) return [];
    const allowed = opts.equipment?.length ? new Set(opts.equipment) : null;

    const score = (c: CatalogExercise): number => {
      if (c.ref === source.ref) return -1;
      if (allowed && !allowed.has(c.equipment)) return -1;
      let points = 0;
      if (c.pattern === source.pattern) points += 3;
      if (c.group === source.group) points += 2;
      if (c.compound === source.compound) points += 1;
      return points;
    };

    return this.all
      .map((c) => ({ c, points: score(c) }))
      .filter((x) => x.points > 0)
      .sort((a, b) => b.points - a.points)
      .slice(0, opts.limit ?? 6)
      .map((x) => x.c);
  }

  /** Ejercicio nuevo del usuario a partir de una entrada del catálogo (RF-EJ-01). */
  toExercise(item: CatalogExercise, lang: 'es' | 'en', id: string): Exercise {
    return {
      id,
      name: this.nameOf(item, lang),
      brick: item.unit === 'TIME' ? 5 : item.compound ? 2.5 : 1.25,
      defaultSets: item.compound ? 4 : 3,
      defaultRepTarget: item.unit === 'TIME' ? 30 : item.compound ? 8 : 12,
      restSeconds: item.compound ? 120 : 60,
      unit: item.unit,
      notes: '',
      catalogRef: item.ref,
    };
  }
}

/**
 * Plantillas compatibles con el perfil (RF-RUT-03).
 *
 * El filtro es una guía, no una barrera: sin nivel ni equipo declarados se muestran todas, y
 * el usuario siempre puede ver la lista completa. Esconder opciones a quien no rellenó su
 * perfil sería castigarlo por haber saltado el onboarding.
 */
export function templatesForProfile(
  level: TrainingLevel | null | undefined,
  equipment: Equipment[] | null | undefined,
): RoutineTemplate[] {
  const available = equipment?.length ? new Set(equipment) : null;
  return ROUTINE_TEMPLATES.filter((t) => {
    if (level && !t.levels.includes(level)) return false;
    if (available && !t.equipment.some((e) => available.has(e))) return false;
    return true;
  });
}
