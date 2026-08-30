import { Exercise, SetRecord, TodaySetProgress, UserProfile } from '../../models/workout.model';
import { HistoryEntry } from '../storage.service';
import { AiSessionContext, SessionRecommendation } from './session-context';

/**
 * Contexto de UN ejercicio.
 *
 * La progresión va por sesión (Art. 5), así que esto ya no describe una llamada de la app:
 * lo usa el shadow log, que compara modelos candidatos ejercicio a ejercicio contra la
 * recomendación real (ver `specs/ai-shadow-log.md`).
 */
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
