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

export interface WorkoutDay {
  id: string;
  name: string;
  exercises: Exercise[];
}

export interface SetRecord {
  exerciseId: string;
  setIndex: number;
  weight: number;
  reps: number;
  target?: string;
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
}

export interface TodayDayProgress {
  dateISO: string;
  sets: Record<string, TodaySetProgress[]>;
}

export interface WeightLogEntry {
  dateISO: string;
  weightKg: number;
}

export interface UserProfile {
  weightKg: number | null;
  heightCm: number | null;
  age: number | null;
  sex: 'male' | 'female' | 'other' | null;
  weightLog: WeightLogEntry[];
}

export interface AppSettings {
  apiKey: string;
  cohereApiKey: string;
  defaultRest: number;
  sounds: boolean;
  haptics: boolean;
  theme: 'dark' | 'light';
  userProfile: UserProfile;
}

export interface AppState {
  schemaVersion: number;
  days: WorkoutDay[];
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
