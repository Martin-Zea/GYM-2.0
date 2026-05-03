export type ExerciseUnit = 'kg' | 'kg por mano' | 'tiempo' | 'peso corporal';

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

export interface UserProfile {
  weightKg: number | null;
  heightCm: number | null;
  sex: 'male' | 'female' | 'other' | null;
}

export interface AppSettings {
  apiKey: string;
  defaultRest: number;
  sounds: boolean;
  theme: 'dark' | 'light';
  userProfile: UserProfile;
}

export interface AppState {
  schemaVersion: number;
  days: WorkoutDay[];
  sessions: Session[];
  activeDayIndex: number;
  todayProgress: Record<string, TodayDayProgress>;
  settings: AppSettings;
}

export interface AiRecommendation {
  weight: number;
  reps: number;
  reason: string;
  source: 'gemini' | 'local';
  loading?: boolean;
}

export interface RestTimerState {
  seconds: number;
  exerciseId: string;
  nextLabel: string;
}
