import { Injectable, computed, signal } from '@angular/core';
import { TRANSLATIONS, Translations } from '../i18n/translations';
import { ExerciseUnit } from '../models/workout.model';
import { STORAGE_KEYS } from './storage-keys';

function readStoredLang(): 'es' | 'en' {
  const stored = localStorage.getItem(STORAGE_KEYS.lang);
  return stored === 'en' || stored === 'es' ? stored : 'es';
}

/**
 * Unidad almacenada → clave de traducción. Los valores guardados son neutros (`KG`,
 * `TIME`, …) desde el esquema v7: antes eran literales en español que hacían de clave de
 * dominio y de etiqueta a la vez, lo que impedía tener kg/lb como capa de presentación
 * (`audit.md` R-4).
 */
const UNIT_KEYS: Record<ExerciseUnit, keyof Translations> = {
  KG: 'unit_kg',
  KG_PER_HAND: 'unit_kg_per_hand',
  KG_PER_ARM: 'unit_kg_per_arm',
  TIME: 'unit_time',
  BODYWEIGHT: 'unit_bodyweight',
};

@Injectable({ providedIn: 'root' })
export class TranslationService {
  readonly lang = signal<'es' | 'en'>(readStoredLang());

  /** Reactive translation map — use T() in templates and computed signals */
  readonly T = computed((): Translations => TRANSLATIONS[this.lang()]);

  setLang(lang: 'es' | 'en'): void {
    this.lang.set(lang);
    localStorage.setItem(STORAGE_KEYS.lang, lang);
  }

  /** Localized display label for an ExerciseUnit — never persist the result */
  unitLabel(unit: ExerciseUnit): string {
    return this.T()[UNIT_KEYS[unit]];
  }

  /** Interpolate a translation key with named params, e.g. tp('days_ago_many', { n: 3 }) */
  tp(key: keyof Translations, params: Record<string, string | number>): string {
    let str = this.T()[key] as string;
    for (const [k, v] of Object.entries(params)) {
      str = str.split(`{${k}}`).join(String(v));
    }
    return str;
  }
}
