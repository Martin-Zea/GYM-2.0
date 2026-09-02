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

  // Routine section
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
  set_warmup_toggle: string;

  // Rest timer next-set labels
  rest_timer_next_set: string; // {n}
  rest_timer_next_exercise: string;
  rest_done_notification: string;

  // Day detail sheet
  detail_last_session_prefix: string;
  detail_no_data: string;
  detail_view_history: string;
  detail_train_day: string;

  // Exercise card
  prev_sets_label: string;

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
  save_error_dismiss: string;
  save_error_quota: string;
  save_error_generic: string;

  // Storage usage + history purge (RF-STO-08)
  settings_storage_title: string;
  settings_storage_app: string;
  settings_storage_origin: string;
  settings_purge_label: string;
  settings_purge_months: string;
  settings_purge_btn: string;
  settings_purge_confirm: string;
  settings_purge_done: string;
  settings_purge_nothing: string;

  // Backup import/export (RF-STO-05, RF-STO-05b)
  settings_import_merge: string;
  settings_import_replace: string;
  settings_export_credentials: string;
  settings_export_credentials_desc: string;
  import_merge_report: string;
  import_replace_report: string;
  import_remapped: string;
  import_credentials_warning: string;

  // Quarantine banner (StorageService, RF-STO-04)
  quarantine_title: string;
  quarantine_msg: string;
  quarantine_download: string;
  quarantine_discard: string;
  quarantine_discard_confirm: string;

  // Multi-tab conflict banner (TabLockService, RF-STO-09)
  tab_conflict_msg: string;
  tab_conflict_reload: string;

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
  pr_celebration_reps_at_weight: string;
  pr_celebration_e1rm: string;
  pr_celebration_reps: string;
  pr_celebration_time: string;
  pr_share_unit_e1rm: string;
  pr_share_unit_reps: string;
  pr_share_unit_seconds: string;
  pr_share_unit_reps_at: string;

  // Nav guard
  nav_guard_confirm: string;

  // Accessibility labels (buttons, inputs)
  close_btn: string;
  more_options: string;
  prev_month: string;
  next_month: string;
  view_chart: string;
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
  weight_log_today: string;
  weight_log_delete: string;
  weight_log_deleted: string; // {weight}
  weight_log_undo: string;
  bodyweight_chart_title: string;
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
  settings_goal_label: string;
  profile_equipment_label: string;
  profile_equipment_desc: string;
  profile_level_label: string;
  profile_level_desc: string;
  profile_level_beginner: string;
  profile_level_intermediate: string;
  profile_level_advanced: string;
  settings_goal_desc: string;
  settings_goal_strength: string;
  settings_goal_hypertrophy: string;
  settings_goal_endurance: string;
  settings_ai_notes_label: string;
  settings_ai_notes_desc: string;
  settings_ai_section: string;
  settings_api_key_label: string;
  settings_api_key_desc: string;
  settings_api_key_free: string;
  settings_cohere_key_label: string;
  settings_cohere_key_desc: string;
  settings_cohere_key_free: string;
  settings_ai_privacy_note: string;
  settings_show: string;
  settings_hide: string;
  settings_test_connection: string;
  settings_test_testing: string;
  settings_test_ok: string;
  settings_test_auth: string;
  settings_test_empty: string;
  settings_test_network: string;
  settings_test_other: string;
  settings_model_placeholder: string;
  settings_budget_label: string;
  settings_budget_desc: string;
  settings_budget_used: string;
  settings_budget_reached: string;
  settings_key_plain_warning: string;
  settings_ai_history: string;
  settings_data: string;
  settings_export: string;
  settings_export_shadow_log: string;
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

  // Charts page
  charts_vs_prev: string;

  // Calendar page
  cal_trained: string;
  cal_stat_sessions: string;
  cal_stat_streak: string;
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
  day_editor_delete_confirm: string;
  exercise_remove_confirm: string;
  day_editor_existing_title: string; // encabezado del dropdown de sugerencias
  exercise_sessions_one: string;
  exercise_sessions_many: string; // {n}
  exercise_archived: string; // tag para ejercicios fuera de toda rutina

  // Profile page
  profile_data_section: string;
  profile_bodyweight_change: string; // {delta} {days}
  profile_achievements_title: string;
  profile_achievements_empty: string;
  profile_pr_share: string;
  pr_share_text: string; // {exercise} {weight} {unit} {url}
  pr_share_fallback_msg: string;

  // UX audit additions
  profile_view_sub: string;
  skip_done_toast: string;
  ai_badge_title_ai: string;
  ai_badge_title_local: string;
  charts_view_session: string;
  cal_stat_vs_prev: string; // {n}

  // Rediseño: sesión enfocada
  session_active_eyebrow: string;
  session_exit: string;
  session_view_list: string;
  session_view_focused: string;
  asc_set_of: string; // {n} {total}
  asc_target: string; // {n}
  asc_set_done: string;
  asc_view_table: string;
  asc_exercise_done: string;
  asc_undo_set: string;
  asc_next_exercise: string;
  asc_extra_set: string;
  asc_note_add: string;
  asc_note_edit: string;
  asc_note_placeholder: string;
  asc_substitute: string;
  asc_substitute_hint: string;
  asc_substitute_pick: string;
  asc_remove_set: string;
  asc_remove_exercise: string;
  asc_remove_exercise_confirm: string;
  asc_add_exercise: string;
  asc_add_exercise_hint: string;
  asc_add_exercise_pick: string;
  asc_set_note_placeholder: string;
  ai_accept: string;
  ai_reject: string;
  ai_change_hint: string;
  ai_feedback_accepted: string;
  ai_feedback_rejected: string;
  ai_feedback_modified: string;
  summary_title: string;
  summary_tonnage: string;
  summary_sets: string;
  summary_exercises: string;
  summary_duration: string;
  summary_vs_prev: string;
  summary_vs_tonnage: string;
  summary_vs_same: string;
  summary_vs_duration: string;
  summary_no_prev_duration: string;
  summary_first_session: string;
  summary_prs: string;
  summary_pr_weight: string;
  summary_pr_reps_at_weight: string;
  summary_pr_e1rm: string;
  summary_pr_reps: string;
  summary_pr_time: string;
  summary_note: string;
  summary_note_placeholder: string;
  summary_close: string;
  resume_title: string;
  resume_msg: string;
  resume_continue: string;
  resume_finish: string;
  resume_discard: string;
  resume_discard_confirm: string;
  home_rest_done: string;
  home_rest_train_anyway: string;
  feel_question: string;
  feel_easy: string;
  feel_ok: string;
  feel_hard: string;
  plates_btn_title: string;
  plates_per_side: string; // {bar}
  plates_bar_only: string; // {bar}
  plates_below_bar: string; // {bar}
  plates_remainder: string; // {n}
  chart_sheet_sub: string;
  chart_sheet_last_sessions: string;
  day_switch_confirm: string;

  // Rediseño: dashboard
  today_ex_count: string; // {n}
  week_line_sessions: string; // {n}
  week_summary_title: string;
  week_summary_body: string; // {n} {vol}

  // Rediseño: historial unificado
  history_view_sub: string;
  history_exercise_label: string;
  history_prs_all: string;

  // Rediseño: editor
  day_editor_duplicate: string;
  day_editor_copy_suffix: string;
  day_editor_move: string;
  day_editor_move_pick: string;
  day_editor_rename: string;

  // Rediseño: datos (snapshots + papelera + discos)
  settings_snapshots_title: string;
  settings_snapshots_desc: string;
  settings_snapshots_empty: string;
  settings_snapshot_restore: string;
  settings_snapshot_restore_confirm: string;
  settings_trash_title: string;
  settings_trash_desc: string;
  settings_trash_empty: string;
  settings_trash_restore: string;
  settings_trash_clear: string;
  trash_deleted_on: string; // {date}
  settings_bar_weight: string;
  settings_plates_label: string;
  settings_plates_hint: string;
  muscle_chest: string;
  muscle_back: string;
  muscle_shoulders: string;
  muscle_biceps: string;
  muscle_triceps: string;
  muscle_quads: string;
  muscle_hamstrings: string;
  muscle_glutes: string;
  muscle_calves: string;
  muscle_core: string;
  muscle_forearms: string;
  equipment_barbell: string;
  equipment_dumbbell: string;
  equipment_machine: string;
  equipment_cable: string;
  equipment_bodyweight: string;
  equipment_band: string;
  library_add_from: string;
  library_search: string;
  library_all: string;
  day_editor_rep_min: string;
  day_editor_rpe: string;
  day_editor_optional: string;
  day_editor_set_style: string;
  day_editor_superset: string;
  day_editor_superset_on: string;
  day_editor_superset_off: string;
  set_style_normal: string;
  set_style_dropset: string;
  set_style_amrap: string;
  gen_days_label: string;
  settings_exercises_title: string;
  settings_exercises_desc: string;
  settings_archive: string;
  settings_unarchive: string;
  library_empty: string;
  onb_profile_title: string;
  onb_profile_desc: string;
  onb_weight_placeholder: string;
  onb_height_placeholder: string;
  onb_age_placeholder: string;
  onb_level_title: string;
  onb_level_desc: string;
  onb_equipment_title: string;
  onb_equipment_desc: string;
  onb_notes_title: string;
  onb_notes_desc: string;
  onb_notes_placeholder: string;
  onb_routine_title: string;
  onb_routine_desc: string;
  onb_routine_template: string;
  onb_routine_ai: string;
  onb_routine_manual: string;
  onb_routine_later: string;
  charts_aggregated: string;
  charts_missing_points: string;
  imbalance_title: string;
  imbalance_low: string;
  imbalance_high: string;
  measures_title: string;
  measures_desc: string;
  measures_add: string;
  measure_waist: string;
  measure_chest: string;
  measure_arm: string;
  measure_thigh: string;
  measure_hip: string;
  avg_duration: string;
  tools_title: string;
  tools_1rm: string;
  tools_1rm_hint: string;
  tools_plates: string;
  tools_plates_bar: string;
  tools_plates_none: string;
  tools_converter: string;
  tools_timer: string;
  tools_timer_start: string;
  tools_timer_stop: string;
  tools_open: string;
  about_title: string;
  about_disclaimer: string;
  about_privacy: string;
  about_version: string;
  prefs_units: string;
  prefs_units_desc: string;
  prefs_notifications: string;
  prefs_notifications_desc: string;
  prefs_notifications_enable: string;
  prefs_notifications_granted: string;
  prefs_notifications_denied: string;

  // Navegación de 5 tabs (T-802)
  nav_today: string;
  nav_routines: string;
  nav_progress: string;
  nav_coach: string;
  nav_settings: string;

  // Tab Rutinas — R1/R2/R6/R7 (T-803)
  routines_title: string;
  routines_active: string;
  routines_archived: string;
  routines_days_count: string;
  routines_next_day: string;
  routines_never_used: string;
  routines_last_used: string;
  routines_create_label: string;
  routines_create_ai: string;
  routines_create_template: string;
  routines_create_scratch: string;
  routines_new_name: string;
  routines_activate: string;
  routines_duplicate: string;
  routines_rename: string;
  routines_archive: string;
  routines_unarchive: string;
  routines_delete: string;
  routines_delete_confirm: string;
  routines_delete_last: string;
  routines_rotation: string;
  routines_today_chip: string;
  routines_exercises_n: string;
  routines_add_day: string;
  routines_empty_days: string;
  routines_copy_suffix: string;
  templates_title: string;
  templates_filtered: string;
  templates_all: string;
  templates_days_week: string;
  templates_import: string;
  templates_preview_title: string;
  templates_confirm_import: string;
  templates_imported: string;
  generator_title: string;
  generator_no_key: string;
  generator_offline: string;
  generator_over_budget: string;
  generator_auth_failed: string;
  generator_model_failed: string;
  generator_empty: string;
  generator_cost: string;
  generator_run: string;
  generator_running: string;
  generator_failed: string;
  generator_review: string;
  generator_short: string;
  generator_save_only: string;
  generator_save_activate: string;
  generator_discard: string;
  generator_context_title: string;
  generator_context_notes: string;
  generator_context_scope: string;
  generator_notes_placeholder: string;
  generator_equipment_any: string;
  generator_layoff_note: string;
  generator_days_week: string;
  generator_minutes: string;
  generator_saved: string;
  generator_saved_inactive: string;

  // Genéricas de navegación (T-802)
  back: string;

  // Tab Coach — C1/C2/C3 (T-804)
  coach_title: string;
  coach_tab_panel: string;
  coach_tab_chat: string;
  coach_tab_history: string;
  coach_provider_active: string;
  coach_provider_local: string;
  coach_next_day: string;
  coach_accept: string;
  coach_change: string;
  coach_reject: string;
  coach_accepted: string;
  coach_rejected: string;
  coach_modified: string;
  coach_no_suggestions: string;
  coach_usage_month: string;
  coach_usage_value: string;
  coach_change_prompt: string;
  coach_chat_placeholder: string;
  coach_chat_send: string;
  coach_chat_cost: string;
  coach_chat_empty: string;
  coach_chat_no_key: string;
  coach_chat_offline: string;
  coach_chat_over_budget: string;
  coach_chat_failed: string;
  coach_chat_auth: string;
  coach_chat_clear: string;
  coach_chat_disclaimer: string;
  coach_history_empty: string;
  coach_history_note: string;
  coach_suggested: string;
  coach_applied: string;

  // Menú de ajustes A1 (T-805)
  settings_menu_profile: string;
  settings_menu_ai: string;
  settings_menu_data: string;
  settings_menu_prefs: string;
  settings_menu_tools: string;
  settings_menu_about: string;
  settings_menu_tools_desc: string;
  settings_menu_backup_pending: string;
  settings_menu_no_key: string;
  settings_menu_profile_empty: string;

  // H1 según el diseño (T-806)
  home_streak: string;
  home_streak_unit: string;
  home_month: string;
  home_month_unit: string;
  home_last_pr: string;
  home_pr_line: string;

  // P1 según el diseño (T-807)
  progress_adherence: string;
  progress_avg_duration: string;
  progress_no_plan: string;
  progress_no_duration: string;

  // Selector de modelo desde la propia key (T-808)
  settings_models_load: string;
  settings_models_loading: string;
  settings_models_none: string;
  settings_models_default: string;
  settings_test_model: string;

  // Propuestas de contexto del coach (T-811)
  coach_proposal_title: string;
  coach_proposal_intro: string;
  coach_proposal_notes: string;
  coach_proposal_goal: string;
  coach_proposal_level: string;
  coach_proposal_layoff: string;
  coach_proposal_layoff_days: string;
  coach_proposal_layoff_note: string;
  coach_weights_head: string;
  settings_tab_readonly: string;
  coach_proposal_accept: string;
  coach_proposal_dismiss: string;
  coach_routine_title: string;
  coach_routine_summary: string;
  coach_routine_summary_days: string;
  coach_routine_note: string;
  coach_routine_open: string;
  coach_routine_accept_open: string;
  coach_proposal_saved: string;

  // Propuesta de pesos desde el chat (T-813)
  reps_short: string;
  coach_weights_title: string;
  coach_weights_intro: string;
  coach_weights_clamped: string;
  coach_weights_accept: string;
  coach_weights_saved: string;
}

export { es } from './es';
export { en } from './en';

export const TRANSLATIONS: Record<string, Translations> = { es, en };
