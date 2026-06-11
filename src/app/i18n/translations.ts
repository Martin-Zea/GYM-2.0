export interface Translations {
  // App shell
  app_name: string;
  theme_toggle_dark: string;
  theme_toggle_light: string;
  settings_btn: string;

  // Empty state
  empty_title: string;
  empty_desc: string;
  new_day_btn: string;

  // AI Hero
  ai_hero_title: string;
  ai_hero_subtitle: string;

  // Today card
  today_eyebrow: string;
  last_session_today: string;
  last_session_first: string;
  last_session_days_one: string;
  last_session_days_many: string; // {n}
  start_training: string;
  continue_training: string;
  sets_progress: string; // {done}/{total}
  view_last_session: string;
  edit_routine: string;
  skip_day: string;
  skip_confirm_q: string;
  skip_yes: string;
  cancel: string;

  // Training mode
  day_n: string; // {n}
  finish_btn: string;
  history_title: string;
  finish_title: string;
  sets_done_label: string;
  total_sets_label: string;
  finish_incomplete: string; // {n}
  finish_all_done: string;
  keep_training: string;
  save_finish: string;

  // Week stats
  days_streak_one: string;
  days_streak_many: string; // {n}
  this_week: string;
  first_week_prompt: string;

  // Routine section
  routine_section_title: string;
  today_label: string;
  first_time_label: string;
  days_ago_one: string;
  days_ago_many: string; // {n}
  today_ago: string;

  // AI labels
  ai_source_badge: string;
  ai_local_badge: string;
  ai_analyzing: string;

  // HowItWorks onboarding
  hiw_eyebrow: string;
  hiw_dismiss: string;
  how_title: string;
  how_step1_title: string;
  how_step1_desc: string;
  how_step2_title: string;
  how_step2_desc: string;
  how_step3_title: string;
  how_step3_desc: string;

  // Exercise card
  exercise_yt_title: string;
  set_mark: string;
  set_unmark: string;

  // Rest timer next-set labels
  rest_timer_next_set: string; // {n}
  rest_timer_next_exercise: string;
  rest_done_notification: string;

  // Day history sheet — edit/delete sessions
  history_edit: string;
  history_delete: string;
  history_delete_confirm: string;
  history_skipped: string;
  save: string;
  confirm: string;

  // Save error toast
  save_error_title: string;
  save_error_dismiss: string;

  // Global error toast (GlobalErrorHandler)
  app_error_generic: string;

  // App update toast
  update_available: string;
  update_reload: string;

  // Backup reminder toast
  backup_reminder: string;
  backup_export_now: string;

  // PR celebration toast
  pr_celebration: string;

  // Nav guard
  nav_guard_confirm: string;

  // Bottom nav / topbar navigation
  nav_main: string;
  nav_home: string;
  nav_charts: string;
  nav_calendar: string;

  // Exercise units (presentation only — stored values stay in Spanish)
  unit_kg: string;
  unit_kg_per_hand: string;
  unit_kg_per_arm: string;
  unit_time: string;
  unit_bodyweight: string;

  // Settings
  settings_title: string;
  settings_appearance: string;
  settings_dark_theme: string;
  settings_session: string;
  settings_default_rest: string;
  settings_rest_desc: string;
  settings_sounds: string;
  settings_profile: string;
  settings_profile_ai_note: string;
  settings_weight: string;
  settings_weight_prev: string;
  settings_weight_delta: string;
  bodyweight_chart_title: string;
  charts_metric_top: string;
  charts_metric_1rm: string;
  charts_range_3m: string;
  charts_range_6m: string;
  charts_range_all: string;
  charts_empty_exercise: string;
  settings_height: string;
  settings_age: string;
  settings_age_unit: string;
  settings_sex: string;
  settings_sex_none: string;
  settings_sex_male: string;
  settings_sex_female: string;
  settings_sex_other: string;
  settings_ai_section: string;
  settings_api_key_label: string;
  settings_api_key_desc: string;
  settings_api_key_free: string;
  settings_api_no_key: string;
  settings_cohere_key_label: string;
  settings_cohere_key_desc: string;
  settings_cohere_key_free: string;
  settings_show: string;
  settings_hide: string;
  settings_data: string;
  settings_export: string;
  settings_import: string;
  settings_reset: string;
  settings_reset_word: string;
  settings_reset_warning: string;
  settings_reset_type: string; // {word}
  settings_reset_do: string;
  settings_language: string;
  settings_language_desc: string;
}

export const es: Translations = {
  app_name: 'Gym',
  theme_toggle_dark: 'Modo claro',
  theme_toggle_light: 'Modo oscuro',
  settings_btn: 'Ajustes',

  empty_title: 'Sin rutinas',
  empty_desc: 'Creá tu primer día de entrenamiento para comenzar.',
  new_day_btn: 'Nuevo día',

  ai_hero_title: 'Entrena con Inteligencia',
  ai_hero_subtitle: 'Sugerencias de carga personalizadas basadas en tu historial',

  today_eyebrow: 'HOY TE TOCA',
  last_session_today: 'Entrenado hoy',
  last_session_first: 'Primera sesión — definí tus pesos iniciales',
  last_session_days_one: 'Última sesión: hace 1 día',
  last_session_days_many: 'Última sesión: hace {n} días',
  start_training: 'Empezar entrenamiento',
  continue_training: 'Continuar entrenamiento',
  sets_progress: '{done}/{total} series completadas',
  view_last_session: 'Ver última sesión',
  edit_routine: 'Editar rutina',
  skip_day: 'Saltar este día',
  skip_confirm_q: '¿Registrar como saltado?',
  skip_yes: 'Sí, saltar',
  cancel: 'Cancelar',

  day_n: 'Día {n}',
  finish_btn: 'Terminar',
  history_title: 'Historial',
  finish_title: '¿Terminar sesión?',
  sets_done_label: 'series hechas',
  total_sets_label: 'series totales',
  finish_incomplete: 'Quedan {n} series sin completar.',
  finish_all_done: '¡Completaste todas las series. ¡Excelente!',
  keep_training: 'Seguir entrenando',
  save_finish: 'Guardar y terminar',

  days_streak_one: 'día seguido',
  days_streak_many: '{n} días seguidos',
  this_week: 'esta semana',
  first_week_prompt: '¡Primera semana! A entrenar',

  routine_section_title: 'Tu rutina',
  today_label: 'HOY',
  first_time_label: 'Primera vez',
  days_ago_one: 'Hace 1 día',
  days_ago_many: 'Hace {n} días',
  today_ago: 'Hoy',

  ai_source_badge: 'IA',
  ai_local_badge: 'Local',
  ai_analyzing: 'Analizando...',

  hiw_eyebrow: 'Primeros pasos',
  hiw_dismiss: 'Entendido',
  how_title: 'Cómo funciona',
  how_step1_title: 'Registro Rápido',
  how_step1_desc: 'Anotá series y pesos en segundos. Tus datos se guardan automáticamente sin cuenta ni login.',
  how_step2_title: 'Inteligencia Adaptativa',
  how_step2_desc: 'Lógica local con reglas de progresión probadas. Con tu API key de Groq (gratis), la IA analiza tu historial completo.',
  how_step3_title: 'Progresión Real',
  how_step3_desc: 'Cada sesión la app sugiere exactamente qué peso usar para maximizar la ganancia muscular.',

  exercise_yt_title: 'Buscar técnica en YouTube',
  set_mark: 'Marcar serie como completada',
  set_unmark: 'Desmarcar serie',

  rest_timer_next_set: 'Serie {n}',
  rest_timer_next_exercise: 'Siguiente ejercicio',
  rest_done_notification: 'Descanso terminado',

  history_edit: 'Editar sesión',
  history_delete: 'Eliminar sesión',
  history_delete_confirm: '¿Eliminar esta sesión?',
  history_skipped: 'Saltado',
  save: 'Guardar',
  confirm: 'Confirmar',

  save_error_title: 'No se pudo guardar',
  save_error_dismiss: 'Entendido',

  app_error_generic: 'Algo salió mal. Tus datos están a salvo.',

  update_available: '¡Nueva versión disponible!',
  update_reload: 'Actualizar',

  backup_reminder: 'Hace tiempo que no hacés un backup de tu progreso.',
  backup_export_now: 'Exportar ahora',

  pr_celebration: '¡Nuevo récord! {exercise}: {weight} kg',

  nav_guard_confirm: '¿Salir del entrenamiento? El progreso no guardado se perderá.',

  nav_main: 'Navegación principal',
  nav_home: 'Inicio',
  nav_charts: 'Gráficos',
  nav_calendar: 'Calendario',

  unit_kg: 'kg',
  unit_kg_per_hand: 'kg por mano',
  unit_kg_per_arm: 'kg por brazo',
  unit_time: 'tiempo',
  unit_bodyweight: 'peso corporal',

  settings_title: 'Ajustes',
  settings_appearance: 'Apariencia',
  settings_dark_theme: 'Tema oscuro',
  settings_session: 'Sesión',
  settings_default_rest: 'Descanso por defecto',
  settings_rest_desc: 'segundos entre series',
  settings_sounds: 'Sonido al completar',
  settings_profile: 'Tu perfil',
  settings_profile_ai_note: 'Con una API key configurada, la IA usa tu perfil (edad, sexo, peso) para personalizar las sugerencias de carga.',
  settings_weight: 'Peso',
  settings_weight_prev: 'Anterior: {weight} kg',
  settings_weight_delta: '{delta} kg desde {date}',
  bodyweight_chart_title: 'Peso corporal',
  charts_metric_top: 'Peso máximo',
  charts_metric_1rm: '1RM estimado',
  charts_range_3m: '3M',
  charts_range_6m: '6M',
  charts_range_all: 'Todo',
  charts_empty_exercise: 'Entrená este ejercicio al menos 2 veces para ver su progresión.',
  settings_height: 'Altura',
  settings_age: 'Edad',
  settings_age_unit: 'años',
  settings_sex: 'Sexo',
  settings_sex_none: 'Sin especificar',
  settings_sex_male: 'Masculino',
  settings_sex_female: 'Femenino',
  settings_sex_other: 'Otro',
  settings_ai_section: 'Inteligencia artificial',
  settings_api_key_label: 'API Key de Groq (IA gratis)',
  settings_api_key_desc: 'Sin key se usa lógica local.',
  settings_api_key_free: 'Gratis en',
  settings_api_no_key: 'Sin key se usa lógica local.',
  settings_cohere_key_label: 'API Key de Cohere',
  settings_cohere_key_desc: 'Fallback de Groq. Si tenés ambas, se usa Groq primero.',
  settings_cohere_key_free: 'Gratis en',
  settings_show: 'Ver',
  settings_hide: 'Ocultar',
  settings_data: 'Datos',
  settings_export: 'Exportar JSON',
  settings_import: 'Importar JSON',
  settings_reset: 'Reiniciar todo',
  settings_reset_word: 'BORRAR',
  settings_reset_warning: 'Esta acción borra todos los datos y no se puede deshacer.',
  settings_reset_type: 'Escribe {word} para confirmar:',
  settings_reset_do: 'Borrar todo',
  settings_language: 'Idioma',
  settings_language_desc: 'Cambia el idioma de la interfaz',
};

export const en: Translations = {
  app_name: 'Gym',
  theme_toggle_dark: 'Light mode',
  theme_toggle_light: 'Dark mode',
  settings_btn: 'Settings',

  empty_title: 'No routines',
  empty_desc: 'Create your first training day to get started.',
  new_day_btn: 'New day',

  ai_hero_title: 'Train with Intelligence',
  ai_hero_subtitle: 'Personalized load suggestions based on your history',

  today_eyebrow: "TODAY'S WORKOUT",
  last_session_today: 'Trained today',
  last_session_first: 'First session — set your initial weights',
  last_session_days_one: 'Last session: 1 day ago',
  last_session_days_many: 'Last session: {n} days ago',
  start_training: 'Start training',
  continue_training: 'Continue training',
  sets_progress: '{done}/{total} sets completed',
  view_last_session: 'View last session',
  edit_routine: 'Edit routine',
  skip_day: 'Skip this day',
  skip_confirm_q: 'Register as skipped?',
  skip_yes: 'Yes, skip',
  cancel: 'Cancel',

  day_n: 'Day {n}',
  finish_btn: 'Finish',
  history_title: 'History',
  finish_title: 'End session?',
  sets_done_label: 'sets done',
  total_sets_label: 'total sets',
  finish_incomplete: '{n} sets remaining.',
  finish_all_done: 'All sets complete. Excellent!',
  keep_training: 'Keep training',
  save_finish: 'Save & finish',

  days_streak_one: 'day in a row',
  days_streak_many: '{n} days in a row',
  this_week: 'this week',
  first_week_prompt: 'First week! Let\'s go',

  routine_section_title: 'Your routine',
  today_label: 'TODAY',
  first_time_label: 'First time',
  days_ago_one: '1 day ago',
  days_ago_many: '{n} days ago',
  today_ago: 'Today',

  ai_source_badge: 'AI',
  ai_local_badge: 'Local',
  ai_analyzing: 'Analyzing...',

  hiw_eyebrow: 'Getting started',
  hiw_dismiss: 'Got it',
  how_title: 'How it works',
  how_step1_title: 'Quick Logging',
  how_step1_desc: 'Log sets and weights in seconds. Data is saved automatically — no account needed.',
  how_step2_title: 'Adaptive Intelligence',
  how_step2_desc: 'Local logic with proven progression rules. Add a free Groq API key and AI analyzes your full history.',
  how_step3_title: 'Real Progression',
  how_step3_desc: 'Every session the app suggests exactly what weight to use to maximize muscle gains.',

  exercise_yt_title: 'Search technique on YouTube',
  set_mark: 'Mark set as done',
  set_unmark: 'Unmark set',

  rest_timer_next_set: 'Set {n}',
  rest_timer_next_exercise: 'Next exercise',
  rest_done_notification: 'Rest finished',

  history_edit: 'Edit session',
  history_delete: 'Delete session',
  history_delete_confirm: 'Delete this session?',
  history_skipped: 'Skipped',
  save: 'Save',
  confirm: 'Confirm',

  save_error_title: 'Could not save',
  save_error_dismiss: 'Dismiss',

  app_error_generic: 'Something went wrong. Your data is safe.',

  update_available: 'New version available!',
  update_reload: 'Update',

  backup_reminder: "It's been a while since you backed up your progress.",
  backup_export_now: 'Export now',

  pr_celebration: 'New record! {exercise}: {weight} kg',

  nav_guard_confirm: 'Leave training? Unsaved progress will be lost.',

  nav_main: 'Main navigation',
  nav_home: 'Home',
  nav_charts: 'Charts',
  nav_calendar: 'Calendar',

  unit_kg: 'kg',
  unit_kg_per_hand: 'kg per hand',
  unit_kg_per_arm: 'kg per arm',
  unit_time: 'time',
  unit_bodyweight: 'bodyweight',

  settings_title: 'Settings',
  settings_appearance: 'Appearance',
  settings_dark_theme: 'Dark theme',
  settings_session: 'Session',
  settings_default_rest: 'Default rest',
  settings_rest_desc: 'seconds between sets',
  settings_sounds: 'Sound on complete',
  settings_profile: 'Your profile',
  settings_profile_ai_note: 'With an API key configured, AI uses your profile (age, sex, weight) to personalize load suggestions.',
  settings_weight: 'Weight',
  settings_weight_prev: 'Previous: {weight} kg',
  settings_weight_delta: '{delta} kg since {date}',
  bodyweight_chart_title: 'Body weight',
  charts_metric_top: 'Top weight',
  charts_metric_1rm: 'Estimated 1RM',
  charts_range_3m: '3M',
  charts_range_6m: '6M',
  charts_range_all: 'All',
  charts_empty_exercise: 'Train this exercise at least 2 times to see its progression.',
  settings_height: 'Height',
  settings_age: 'Age',
  settings_age_unit: 'years',
  settings_sex: 'Sex',
  settings_sex_none: 'Unspecified',
  settings_sex_male: 'Male',
  settings_sex_female: 'Female',
  settings_sex_other: 'Other',
  settings_ai_section: 'Artificial Intelligence',
  settings_api_key_label: 'Groq API Key (free AI)',
  settings_api_key_desc: 'No key uses local logic.',
  settings_api_key_free: 'Free at',
  settings_api_no_key: 'No key uses local logic.',
  settings_cohere_key_label: 'Cohere API Key',
  settings_cohere_key_desc: 'Groq fallback. If both are set, Groq is tried first.',
  settings_cohere_key_free: 'Free at',
  settings_show: 'Show',
  settings_hide: 'Hide',
  settings_data: 'Data',
  settings_export: 'Export JSON',
  settings_import: 'Import JSON',
  settings_reset: 'Reset all',
  settings_reset_word: 'DELETE',
  settings_reset_warning: 'This action deletes all data and cannot be undone.',
  settings_reset_type: 'Type {word} to confirm:',
  settings_reset_do: 'Delete all',
  settings_language: 'Language',
  settings_language_desc: 'Change the interface language',
};

export const TRANSLATIONS: Record<string, Translations> = { es, en };
