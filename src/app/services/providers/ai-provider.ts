import {
  AiRecommendation,
  Exercise,
  SetRecord,
  TodaySetProgress,
  UserProfile,
} from '../../models/workout.model';
import { HistoryEntry } from '../storage.service';

export interface AiProviderContext {
  exercise: Exercise;
  todaySets: TodaySetProgress[];
  lastSets: SetRecord[] | null;
  history: HistoryEntry[];
  userProfile: UserProfile;
  lang: 'es' | 'en';
  lastSessionDate: string | null;
  /** Sensación reportada en la última sesión de este ejercicio (RPE simplificado). */
  lastFeel?: 'easy' | 'ok' | 'hard' | null;
  /** Nota rápida del atleta en la última sesión de este ejercicio. */
  lastNote?: string | null;
}

export interface AiProvider {
  recommend(ctx: AiProviderContext): Promise<AiRecommendation>;
}
