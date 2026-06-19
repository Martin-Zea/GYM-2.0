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
}

export interface AiProvider {
  recommend(ctx: AiProviderContext): Promise<AiRecommendation>;
}
