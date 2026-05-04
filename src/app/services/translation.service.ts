import { Injectable, computed, signal } from '@angular/core';
import { TRANSLATIONS, Translations } from '../i18n/translations';

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

  /** Interpolate a translation key with named params, e.g. tp('days_ago_many', { n: 3 }) */
  tp(key: keyof Translations, params: Record<string, string | number>): string {
    let str = this.T()[key] as string;
    for (const [k, v] of Object.entries(params)) {
      str = str.replace(`{${k}}`, String(v));
    }
    return str;
  }
}
