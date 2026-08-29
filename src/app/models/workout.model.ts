export type ExerciseUnit = 'KG' | 'KG_PER_HAND' | 'KG_PER_ARM' | 'TIME' | 'BODYWEIGHT';

export interface Exercise {
  id: string;
  name: string;
  brick: number;
  defaultSets: number;
  defaultRepTarget: number;
  restSeconds: number;
  unit: ExerciseUnit;
  notes: string;
}

/**
 * Día tal como se consume en runtime: con sus ejercicios ya resueltos desde el
 * catálogo. Es la forma que ven los componentes (StateService.days() los resuelve).
 */
export interface WorkoutDay {
  id: string;
  name: string;
  exercises: Exercise[];
}

/**
 * Día tal como se persiste: referencia ejercicios del catálogo por id en vez de
 * embeberlos. Así borrar/reorganizar rutinas nunca destruye la identidad ni el
 * historial de un ejercicio. Ver `AppState.exercises`.
 */
export interface StoredWorkoutDay {
  id: string;
  name: string;
  exerciseIds: string[];
}

export interface SetRecord {
  exerciseId: string;
  setIndex: number;
  weight: number;
  reps: number;
  target?: string;
  repTarget?: number;
  isWarmup?: boolean;
}

/** Sensación subjetiva de un ejercicio al completarlo (RPE simplificado → prompt de IA). */
export type TrainingFeel = 'easy' | 'ok' | 'hard';

export interface Session {
  id: string;
  dayId: string;
  dateISO: string;
  sets: SetRecord[];
  skipped?: boolean;
  /** Sensación por ejercicio (exerciseId → feel), registrada al completar el ejercicio. */
  feelings?: Record<string, TrainingFeel>;
  /** Nota rápida por ejercicio (exerciseId → texto), p. ej. "me molestó el hombro". */
  notes?: Record<string, string>;
}

export interface TodaySetProgress {
  weight: number | string;
  reps: number | string;
  done: boolean;
  isWarmup?: boolean;
  aiPrefilled?: boolean;
}

export interface TodayDayProgress {
  dateISO: string;
  sets: Record<string, TodaySetProgress[]>;
  /** Sustituciones "solo por hoy": exerciseId original → exerciseId del catálogo que lo reemplaza. */
  overrides?: Record<string, string>;
}

export interface WeightLogEntry {
  dateISO: string;
  weightKg: number;
}

export type TrainingGoal = 'strength' | 'hypertrophy' | 'endurance';

export interface UserProfile {
  weightKg: number | null;
  heightCm: number | null;
  age: number | null;
  sex: 'male' | 'female' | 'other' | null;
  weightLog: WeightLogEntry[];
  goal: TrainingGoal | null;
  aiNotes: string;
}

export interface AppSettings {
  apiKey: string;
  cohereApiKey: string;
  defaultRest: number;
  sounds: boolean;
  haptics: boolean;
  theme: 'dark' | 'light' | 'high-contrast';
  userProfile: UserProfile;
  /** Calculadora de discos: peso de la barra (kg). Por defecto 20. */
  barWeightKg?: number;
  /** Calculadora de discos: discos disponibles por lado (kg). */
  platesKg?: number[];
}

/** Sesión borrada: espera 30 días en la papelera antes de desaparecer de verdad. */
export interface TrashedSession {
  session: Session;
  deletedISO: string;
}

export interface AppState {
  schemaVersion: number;
  /** Catálogo maestro de ejercicios: fuente de verdad de identidad e historial. */
  exercises: Exercise[];
  days: StoredWorkoutDay[];
  sessions: Session[];
  activeDayIndex: number;
  routinePointer: number;
  todayProgress: Record<string, TodayDayProgress>;
  settings: AppSettings;
  /** Papelera de sesiones (30 días). Opcional: estados viejos no la tienen. */
  trash?: TrashedSession[];
}

export interface SetRecommendation {
  weight: number;
  reps: number;
}

export interface AiRecommendation {
  sets: SetRecommendation[];
  reason: string;
  source: 'groq' | 'cohere' | 'local';
  loading?: boolean;
}

export interface RestTimerState {
  seconds: number;
  exerciseId: string;
  nextLabel: string;
  nextSetIndex?: number;
}
