/**
 * Claves de `localStorage` usadas por la app, centralizadas en un único lugar.
 * Evita literales de string duplicados que se desincronizan al renombrar una clave.
 */
export const STORAGE_KEYS = {
  appState: 'gym_app_state_v2',
  stateSavedAt: 'gym_state_saved_at',
  sessionView: 'gym_session_view',
  aiCache: 'gym_ai_cache_v2',
  lang: 'gym_lang',
  lastExport: 'gym_last_export',
  backupDismissed: 'gym_backup_dismissed',
  hiwDismissed: 'gym_hiw_dismissed',
  onboardingDone: 'gym_onboarding_done_v1',
  legalAccepted: 'gym_legal_accepted_v1',
  aiShadowLog: 'gym_ai_shadow_log_v1',
  /** Dueño actual de la escritura (fallback de `TabLockService` sin Web Locks). */
  tabOwner: 'gt_tab_owner',
  /** Descanso en curso: sobrevive a que el SO mate la PWA en segundo plano (RF-SES-04). */
  restTimer: 'gt_rest_timer',
  /** Sugerencias calculadas al cerrar una sesión, listas para la próxima (RF-IA-06b). */
  nextSuggestions: 'gt_next_suggestions',
  /** Consumo de tokens por mes de la capa IA (RF-IA-07). */
  aiUsage: 'gt_ai_usage',
  coachChat: 'gt_coach_chat',
} as const;
