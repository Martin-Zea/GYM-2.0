import { es } from './es';
import { en } from './en';

export interface Translations {
  // App shell
  app_name: string;
  theme_toggle_dark: string;
  theme_toggle_light: string;
  theme_toggle_high_contrast: string;
  nav_guard_exit: string;
  settings_theme_dark: string;
  settings_theme_light: string;
  settings_theme_hc: string;
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
  today_last_prefix: string;
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
  tsb_exercises: string;
  sets_label: string;
  col_seconds: string;
  col_weight: string;
  col_reps: string;
  ctrl_weight_down: string;
  ctrl_weight_up: string;
  ctrl_rep_down: string;
  ctrl_rep_up: string;

  // Week stats
  days_streak_one: string;
  days_streak_many: string; // {n}
  this_week: string;
  first_week_prompt: string;

  // Routine section
  routine_section_title: string;
  today_label: string;
  next_label: string;
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
  history_empty: string;
  history_edit: string;
  history_delete: string;
  history_delete_confirm: string;
  history_delete_confirm_detail: string; // {date} {vol}
  history_skipped: string;
  history_incomplete: string;
  history_vol_up: string; // {pct}
  history_vol_down: string; // {pct}
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

  // Accessibility labels (buttons, inputs)
  close_btn: string;
  more_options: string;
  prev_month: string;
  next_month: string;
  view_chart: string;
  exercise_move_up: string;
  exercise_move_down: string;
  exercise_remove: string;
  rest_adjust_minus: string;
  rest_adjust_plus: string;
  rest_label: string;
  rest_seg: string;
  rest_next_prefix: string;
  rest_skip_btn: string;
  set_weight_aria: string; // {n}
  set_reps_aria: string; // {n}
  select_day_title: string;

  // Bottom nav / topbar navigation
  nav_main: string;
  nav_home: string;
  nav_charts: string;
  nav_calendar: string;
  nav_profile: string;

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
  settings_haptics: string;
  settings_profile: string;
  settings_profile_ai_note: string;
  settings_weight: string;
  settings_weight_prev: string;
  settings_weight_delta: string;
  weight_log_today: string;
  weight_log_delete: string;
  weight_log_deleted: string; // {weight}
  weight_log_undo: string;
  bodyweight_chart_title: string;
  charts_label_metric: string;
  charts_label_range: string;
  charts_metric_top: string;
  charts_metric_1rm: string;
  charts_range_3m: string;
  charts_range_6m: string;
  charts_range_all: string;
  charts_no_data_title: string;
  charts_no_data_desc: string;
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
  settings_ai_privacy_note: string;
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
  import_invalid_backup: string;
  settings_version: string; // {version}
  settings_privacy_policy: string;
  settings_terms: string;

  // Legal gate (first launch — shown after onboarding)
  legal_gate_title: string;
  legal_gate_disclaimer: string;
  legal_gate_terms_link: string;
  legal_gate_privacy_link: string;
  legal_gate_checkbox: string;
  legal_gate_continue: string;

  // Onboarding (first launch)
  onboarding_slide1_title: string;
  onboarding_slide1_desc: string;
  onboarding_slide2_title: string;
  onboarding_slide2_desc: string;
  onboarding_slide3_title: string;
  onboarding_slide3_desc: string;
  onboarding_next: string;
  onboarding_back: string;
  onboarding_start: string;

  // Charts page
  charts_view_title: string;
  charts_view_sub: string;
  charts_vol_last: string;
  charts_vs_prev: string;

  // Calendar page
  calendar_view_title: string;
  calendar_view_sub: string;
  cal_trained: string;
  cal_stat_total: string;
  cal_stat_sessions: string;
  cal_stat_last30: string;
  cal_stat_workouts: string;
  cal_stat_streak: string;
  cal_stat_streak_sub: string;
  cal_routine_title: string;
  cal_no_sessions: string;
  yesterday: string;

  // Day editor
  day_editor_new_title: string;
  day_editor_edit_title: string;
  day_editor_day_name: string;
  day_editor_day_name_placeholder: string;
  day_editor_exercise_placeholder: string;
  day_editor_sets: string;
  day_editor_rep_target: string;
  day_editor_brick: string;
  day_editor_rest: string;
  day_editor_unit: string;
  day_editor_add_exercise: string;
  day_editor_delete_day: string;
  day_editor_existing_title: string; // encabezado del dropdown de sugerencias
  exercise_sessions_one: string;
  exercise_sessions_many: string; // {n}
  exercise_archived: string; // tag para ejercicios fuera de toda rutina

  // Profile page
  profile_data_section: string;
  profile_no_data: string;
  profile_edit_settings: string;
  profile_bodyweight_no_data: string;
  profile_bodyweight_change: string; // {delta} {days}
  profile_achievements_title: string;
  profile_achievements_empty: string;
  profile_pr_share: string;
  pr_share_text: string; // {exercise} {weight} {unit} {url}
  pr_share_fallback_msg: string;
}

export { es } from './es';
export { en } from './en';

export const TRANSLATIONS: Record<string, Translations> = { es, en };
