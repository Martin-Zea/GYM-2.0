export type ExerciseUnit = 'kg' | 'kg por mano' | 'kg por brazo' | 'tiempo' | 'peso corporal';

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

export interface Session {
  id: string;
  dayId: string;
  dateISO: string;
  sets: SetRecord[];
  skipped?: boolean;
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
