import { Injectable, computed, signal } from '@angular/core';
import { TRANSLATIONS, Translations } from '../i18n/translations';
import { ExerciseUnit } from '../models/workout.model';

/** Presentation-only map: stored ExerciseUnit values stay in Spanish (schema compat) */
const UNIT_KEYS: Record<ExerciseUnit, keyof Translations> = {
  kg: 'unit_kg',
  'kg por mano': 'unit_kg_per_hand',
  'kg por brazo': 'unit_kg_per_arm',
  tiempo: 'unit_time',
  'peso corporal': 'unit_bodyweight',
};

@Injectable({ providedIn: 'root' })
export class TranslationService {
  readonly lang = signal<'es' | 'en'>(
    (localStorage.getItem('gym_lang') as 'es' | 'en' | null) ?? 'es',
  );

  /** Reactive translation map — use T() in templates and computed signals */
  readonly T = computed((): Translations => TRANSLATIONS[this.lang()]);

  setLang(lang: 'es' | 'en'): void {
    this.lang.set(lang);
    localStorage.setItem('gym_lang', lang);
  }

  /** Localized display label for an ExerciseUnit — never persist the result */
  unitLabel(unit: ExerciseUnit): string {
    return this.T()[UNIT_KEYS[unit]];
  }

  /** Interpolate a translation key with named params, e.g. tp('days_ago_many', { n: 3 }) */
  tp(key: keyof Translations, params: Record<string, string | number>): string {
    let str = this.T()[key] as string;
    for (const [k, v] of Object.entries(params)) {
      str = str.replace(`{${k}}`, String(v));
    }
    return str;
  }
}
