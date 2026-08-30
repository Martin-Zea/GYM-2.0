import {
  AiRecommendation,
  Exercise,
  SetRecord,
  TodaySetProgress,
  UserProfile,
} from '../../models/workout.model';
import { HistoryEntry } from '../storage.service';
import { AiSessionContext, SessionRecommendation } from './session-context';

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

/**
 * Proveedor a nivel de SESIÓN (Art. 5, RF-IA-02).
 *
 * Es la interfaz principal desde F4: una llamada por sesión finalizada en vez de una por
 * ejercicio. Los proveedores de red la implementan con un único request; el motor local la
 * implementa recorriendo su motor de reglas, que no cuesta nada.
 */
export interface AiSessionProvider {
  readonly name: 'groq' | 'cohere' | 'local';
  recommendSession(ctx: AiSessionContext): Promise<SessionRecommendation>;
}
