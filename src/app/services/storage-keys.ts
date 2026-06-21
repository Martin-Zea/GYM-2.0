/**
 * Claves de `localStorage` usadas por la app, centralizadas en un único lugar.
 * Evita literales de string duplicados que se desincronizan al renombrar una clave.
 */
export const STORAGE_KEYS = {
  appState: 'gym_app_state_v2',
  aiCache: 'gym_ai_cache_v2',
  lang: 'gym_lang',
  lastExport: 'gym_last_export',
  backupDismissed: 'gym_backup_dismissed',
  hiwDismissed: 'gym_hiw_dismissed',
  onboardingDone: 'gym_onboarding_done_v1',
  legalAccepted: 'gym_legal_accepted_v1',
} as const;
