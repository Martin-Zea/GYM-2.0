import { SealedValue } from '../services/crypto-keys';

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
  /**
   * Enlace al catálogo estático (`CatalogExercise.ref`), resuelto por nombre normalizado.
   *
   * El id del ejercicio NUNCA cambia por esto: el enlace es un dato añadido, no una
   * identidad nueva, para no romper el historial (`audit.md` R-3).
   */
  catalogRef?: string;
  /** Rango de repeticiones objetivo (RF-RUT-01). `defaultRepTarget` es el tope del rango. */
  repMin?: number;
  /** RPE objetivo del esquema, 1–10 (RF-RUT-01). */
  targetRpe?: number;
  /** Ejercicios encadenados sin descanso: mismo `supersetId` = superserie (RF-RUT-02). */
  supersetId?: string;
  /** Tipo de esquema de la última serie (RF-RUT-02). */
  setStyle?: 'normal' | 'dropset' | 'amrap';
  /** Archivado: sigue en el catálogo con su historial, pero no se ofrece al añadir. */
  archived?: boolean;
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

/**
 * Rutina: un conjunto ordenado de días (RF-RUT-01).
 *
 * Los días viven en `AppState.days` y la rutina los referencia por id, igual que los días
 * referencian ejercicios del catálogo. Así un día puede archivarse con la rutina sin que su
 * historial —que apunta al `dayId`— quede huérfano.
 */
export interface Routine {
  id: string;
  name: string;
  dayIds: string[];
  archived?: boolean;
  /**
   * Posición APARCADA en la rotación de esta rutina (T-830).
   *
   * Solo tiene sentido mientras la rutina NO es la activa: la posición viva es
   * `AppState.routinePointer`, y se guarda aquí al salir y se lee al volver. Mientras la
   * rutina está activa este campo está deliberadamente desactualizado — quien manda es el
   * puntero global. Sin esto, cambiar de rutina y volver te devolvía siempre al día 1:
   * `setActiveRoutine()` hacía `routinePointer: 0` y la posición no vivía en ningún sitio.
   */
  pointer?: number;
}

export interface SetRecord {
  exerciseId: string;
  setIndex: number;
  weight: number;
  reps: number;
  target?: string;
  repTarget?: number;
  isWarmup?: boolean;
  /** Nota de esta serie concreta, p. ej. "última con ayuda" (RF-SES-05). */
  note?: string;
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
  /**
   * Inicio y fin reales de la sesión (ISO datetime completo, no solo la fecha).
   *
   * Ambos son OPCIONALES a propósito: ninguna sesión anterior a v7 los tiene, así que la UI
   * debe **omitir** la duración cuando falten en vez de mostrar "0 min" (RF-SES-08b, RF-PRO-05).
   * `endedAt` ausente en una sesión de HOY es además la señal de "sesión interrumpida" (RF-SES-07).
   */
  startedAt?: string;
  endedAt?: string;
  /** Nota de la sesión entera (distinta de `notes`, que es por ejercicio). */
  sessionNote?: string;
}

export interface TodaySetProgress {
  weight: number | string;
  reps: number | string;
  done: boolean;
  isWarmup?: boolean;
  aiPrefilled?: boolean;
  note?: string;
}

export interface TodayDayProgress {
  dateISO: string;
  sets: Record<string, TodaySetProgress[]>;
  /** Sustituciones "solo por hoy": exerciseId original → exerciseId del catálogo que lo reemplaza. */
  overrides?: Record<string, string>;
  /** Momento en que se pulsó "Entrenar"; se copia a `Session.startedAt` al registrar la 1ª serie. */
  startedAt?: string;
  /**
   * Cuántas series tiene hoy cada ejercicio, SI el usuario añadió o quitó alguna sobre la
   * marcha. Sin entrada aquí manda la rutina; nunca se toca `Exercise.defaultSets`, porque
   * hacer una serie de menos un martes no redefine la rutina (RF-SES-05).
   */
  setCounts?: Record<string, number>;
  /** Ejercicios añadidos y quitados SOLO por hoy; la rutina guardada queda intacta. */
  addedExerciseIds?: string[];
  hiddenExerciseIds?: string[];
}

export interface WeightLogEntry {
  dateISO: string;
  weightKg: number;
}

/** Medidas corporales de un día (RF-PER-04, vista P4). Todas opcionales: se apunta lo que se mide. */
export interface MeasureEntry {
  dateISO: string;
  waistCm?: number;
  chestCm?: number;
  armCm?: number;
  thighCm?: number;
  hipCm?: number;
}

export type TrainingGoal = 'strength' | 'hypertrophy' | 'endurance';

/**
 * Nivel de experiencia. Ajusta la agresividad de la progresión local (§3, RF-IA-01):
 * un principiante progresa en lineal casi cada sesión, un avanzado necesita confirmar
 * y descargar mucho antes.
 */
export type TrainingLevel = 'beginner' | 'intermediate' | 'advanced';

export interface UserProfile {
  weightKg: number | null;
  heightCm: number | null;
  age: number | null;
  sex: 'male' | 'female' | 'other' | null;
  weightLog: WeightLogEntry[];
  /** Historial de medidas corporales (RF-PER-04). */
  measures?: MeasureEntry[];
  goal: TrainingGoal | null;
  /** `null` = sin declarar: el motor asume intermedio, el punto medio menos arriesgado. */
  level: TrainingLevel | null;
  /** Equipo disponible (RF-PER-01). Filtra plantillas y sustitutos. `null` = sin declarar. */
  equipment: string[] | null;
  /** Días por semana que puede entrenar (RF-PER-01). */
  daysPerWeek: number | null;
  /**
   * Parón DECLARADO por el atleta: la VENTANA en la que no entrenó de verdad (T-817, T-827).
   *
   * Existe porque el registro no lo sabe todo: datos de prueba, una sesión que quedó
   * abierta, un mes usando otra app. La ventana va de `layoffSinceISO` (desde cuándo no
   * entrena) a `layoffDeclaredISO` (cuándo lo contó), y es un hecho HISTÓRICO que no hay
   * que borrar nunca: un registro dentro de la ventana miente y pierde contra la
   * declaración; una sesión POSTERIOR a la declaración es entrenamiento real de vuelta y
   * gana. Así cada ejercicio de la rutina arranca recortado exactamente UNA vez —la
   * primera que le toca tras el parón— en vez de que la primera sesión de hombros
   * "reacondicione" también al pecho (que era lo que pasaba borrando la bandera global).
   */
  layoffSinceISO?: string | null;
  layoffDeclaredISO?: string | null;
  aiNotes: string;
}

export interface AppSettings {
  /**
   * Keys en claro. Desde F4 solo se usan como paso intermedio de migración: en régimen
   * quedan vacías y el valor real vive cifrado en `*Sealed` (Art. 4, RF-IA-08).
   */
  apiKey: string;
  cohereApiKey: string;
  apiKeySealed?: SealedValue;
  cohereApiKeySealed?: SealedValue;
  defaultRest: number;
  sounds: boolean;
  haptics: boolean;
  theme: 'dark' | 'light' | 'high-contrast';
  userProfile: UserProfile;
  /** Calculadora de discos: peso de la barra (kg). Por defecto 20. */
  barWeightKg?: number;
  /** Calculadora de discos: discos disponibles por lado (kg). */
  platesKg?: number[];
  /** Modelo elegido por proveedor (RF-IA-09). Sin valor, el por defecto de cada uno. */
  groqModel?: string;
  cohereModel?: string;
  /**
   * Presupuesto mensual de tokens de la capa IA (RF-IA-07, EA-6). Al agotarse, la app cae
   * al motor local sola. `0` desactiva la IA sin tener que borrar la key.
   */
  aiTokenBudget?: number;
  /**
   * Unidad de PRESENTACIÓN del peso (RF-PWA-04). El almacenamiento es siempre kg: cambiar
   * de unidad no debe reescribir el historial (edge case §6 de la spec).
   */
  units?: 'kg' | 'lb';
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
  /** Feedback sobre las sugerencias (RF-IA-05). Se reinyecta en contextos futuros. */
  aiFeedback?: AiFeedbackEntry[];
  /** Rutinas del usuario (RF-RUT-01). Siempre hay al menos una. */
  routines: Routine[];
  /** Rutina en curso: de ella salen el día que toca y la rotación (RF-RUT-04). */
  activeRoutineId: string;
}

/** Qué hizo el atleta con una sugerencia (RF-IA-05, vista C1). */
export type AiFeedbackAction = 'accepted' | 'modified' | 'rejected';

export interface AiFeedbackEntry {
  id: string;
  dateISO: string;
  exerciseId: string;
  exerciseName: string;
  action: AiFeedbackAction;
  /** Lo que la IA propuso y lo que el atleta acabó haciendo (si difiere). */
  suggested: SetRecommendation | null;
  applied: SetRecommendation | null;
  source: 'groq' | 'cohere' | 'local';
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
