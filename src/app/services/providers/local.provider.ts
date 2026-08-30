import {
  AiRecommendation,
  Exercise,
  SetRecord,
  SetRecommendation,
  TodaySetProgress,
  TrainingFeel,
  UserProfile,
} from '../../models/workout.model';
import { HistoryEntry } from '../storage.service';
import { AiProvider, AiProviderContext, AiSessionProvider } from './ai-provider';
import { AiSessionContext, SessionRecommendation } from './session-context';
import { floorToBrick, goalRepTarget, roundToBrick } from './prompt-helpers';
import { LAYOFF_LONG_DAYS, LAYOFF_MODERATE_DAYS, layoffFactor } from './progression-rules';
import { injuryBlocksIncrease } from './session-response';
import {
  completionRatio,
  confirmedAtWeight,
  consecutiveFailures,
  failureDropWeight,
  isStagnant,
  levelParams,
  progressStreak,
} from './progression-rules';

function daysBetween(isoA: string, isoB: string): number {
  return Math.round((new Date(isoB).getTime() - new Date(isoA).getTime()) / (1000 * 60 * 60 * 24));
}

function buildReasons(lang: 'es' | 'en') {
  const es = lang === 'es';
  return {
    firstSession: (weight: number) =>
      es
        ? weight > 0
          ? `Primera sesión: arrancá con ${weight}kg, ajustá según cómo te sientas.`
          : 'Primera sesión: definí un peso inicial y completá para que la IA te guíe.'
        : weight > 0
          ? `First session: start with ${weight}kg, adjust based on how you feel.`
          : 'First session: set an initial weight and complete sets so the AI can guide you.',

    firstSessionTime: (secs: number) =>
      es
        ? `Primera sesión: intentá ${secs} segundos como punto de partida.`
        : `First session: try ${secs} seconds as a starting point.`,

    firstSessionBw: (reps: number) =>
      es
        ? `Primera sesión: arrancá con ${reps} reps e irás subiendo el objetivo.`
        : `First session: start with ${reps} reps and build from there.`,

    deload: (sessions: number, deloadWeight: number) =>
      es
        ? `Llevás ${sessions} sesiones progresando seguido. Semana de descarga: ${deloadWeight}kg para recuperarte bien.`
        : `${sessions} consecutive progress sessions. Deload week: ${deloadWeight}kg to recover properly.`,

    plateau: (topWeight: number, sessions: number) =>
      es
        ? `Meseta en ${topWeight}kg hace ${sessions} sesiones. Cambiá el rango de reps o el tempo para romperla.`
        : `Plateau at ${topWeight}kg for ${sessions} sessions. Change rep range or tempo to break through.`,

    hardFeel: (topWeight: number) =>
      es
        ? `Cumpliste el objetivo, pero marcaste la última como pesada. Consolidá ${topWeight}kg antes de subir.`
        : `You hit the target, but marked the last one as hard. Consolidate ${topWeight}kg before adding weight.`,

    injuryHold: (topWeight: number) =>
      es
        ? `Anotaste una molestia en este ejercicio. Sostenemos ${topWeight}kg hasta que pase.`
        : `You logged discomfort on this exercise. Holding at ${topWeight}kg until it settles.`,

    consecutiveFailures: (sessions: number, newWeight: number) =>
      es
        ? `${sessions} sesiones seguidas sin cerrar el objetivo. Bajamos a ${newWeight}kg para volver a completarlo.`
        : `${sessions} sessions in a row short of the target. Dropping to ${newWeight}kg to complete it again.`,

    stagnation: (sessions: number, deloadWeight: number) =>
      es
        ? `Sin avanzar hace ${sessions} sesiones. Descarga a ${deloadWeight}kg y volvé a subir con margen.`
        : `No progress for ${sessions} sessions. Deload to ${deloadWeight}kg and build back up.`,

    premature: (prevWeight: number) =>
      es
        ? `Subiste el peso antes de consolidar. Volvé a ${prevWeight}kg y cerrá el objetivo de reps.`
        : `Weight went up before consolidating. Return to ${prevWeight}kg and hit the rep target.`,

    spacingLong: (topWeight: number, reducedWeight: number) =>
      es
        ? `Más de ${LAYOFF_LONG_DAYS} días sin entrenar este ejercicio. Arrancá conservador con ${reducedWeight}kg.`
        : `Over ${LAYOFF_LONG_DAYS} days since last session. Start conservative with ${reducedWeight}kg.`,

    spacingModerate: (topWeight: number, reducedWeight: number) =>
      es
        ? `Más de ${LAYOFF_MODERATE_DAYS} días sin entrenar. Bajamos un ladrillo a ${reducedWeight}kg por precaución.`
        : `Over ${LAYOFF_MODERATE_DAYS} days since last session. Dropping one increment to ${reducedWeight}kg.`,

    goalMet: (topWeight: number, newWeight: number) =>
      es
        ? `Objetivo cumplido con ${topWeight}kg. Las últimas 2 series suben a ${newWeight}kg.`
        : `Goal met at ${topWeight}kg. Last 2 sets go up to ${newWeight}kg.`,

    goalMetConfirmed: (topWeight: number, newWeight: number) =>
      es
        ? `Confirmaste ${topWeight}kg dos sesiones seguidas. Todas las series suben a ${newWeight}kg.`
        : `Confirmed ${topWeight}kg two sessions in a row. All sets go up to ${newWeight}kg.`,

    almostThere: (topWeight: number) =>
      es
        ? `Muy cerca del objetivo con ${topWeight}kg. Repetís este peso para cerrarlo.`
        : `Very close to the goal at ${topWeight}kg. Repeat to close it out.`,

    consolidate: (topWeight: number) =>
      es
        ? `Seguimos consolidando ${topWeight}kg. Enfocate en la técnica.`
        : `Keep consolidating ${topWeight}kg. Focus on technique.`,

    degradation: (topWeight: number) =>
      es
        ? `Caída brusca entre series con ${topWeight}kg. Consolidá la técnica antes de subir.`
        : `Sharp drop between sets at ${topWeight}kg. Consolidate technique before going up.`,

    superCompletion: (topWeight: number, newWeight: number) =>
      es
        ? `Superaste ampliamente el objetivo con ${topWeight}kg. El peso fue muy liviano — saltamos 2 ladrillos a ${newWeight}kg.`
        : `Far exceeded the target at ${topWeight}kg. Weight was too light — jumping 2 increments to ${newWeight}kg.`,

    tooHeavy: (prevWeight: number) =>
      es
        ? `El peso fue excesivo. Bajamos a ${prevWeight}kg con más reps para mantener el estímulo.`
        : `Weight was too heavy. Dropping to ${prevWeight}kg with more reps to maintain stimulus.`,

    // Unidades especiales
    timeProg: (secs: number, newSecs: number) =>
      es
        ? `Completaste ${secs}s en todas las series. La próxima sesión subís a ${newSecs}s.`
        : `Completed ${secs}s on all sets. Next session go up to ${newSecs}s.`,

    timeConsolidate: (secs: number) =>
      es
        ? `Seguís consolidando ${secs}s. Mantené el tiempo objetivo.`
        : `Keep consolidating ${secs}s. Hold the target duration.`,

    timeTooHard: (prevSecs: number) =>
      es
        ? `El tiempo fue excesivo. Bajá a ${prevSecs}s para mantener la calidad.`
        : `Duration was too hard. Drop to ${prevSecs}s to maintain quality.`,

    bwProg: (reps: number, newReps: number) =>
      es
        ? `Completaste ${reps} reps en todas las series. El próximo objetivo es ${newReps} reps.`
        : `Completed ${reps} reps on all sets. Next target is ${newReps} reps.`,

    bwConsolidate: (reps: number) =>
      es
        ? `Seguís consolidando ${reps} reps. Mantené la técnica.`
        : `Keep consolidating ${reps} reps. Focus on technique.`,

    bwTooHard: (prevReps: number) =>
      es
        ? `Demasiado volumen. Volvé a ${prevReps} reps con buena técnica.`
        : `Too much volume. Return to ${prevReps} reps with good technique.`,

    pyramid: (topWeight: number) =>
      es
        ? `Pirámide detectada. Mantené el esquema con peso tope ${topWeight}kg.`
        : `Pyramid detected. Keep the scheme with top weight ${topWeight}kg.`,
  };
}

function estimateStartWeight(exercise: Exercise, userProfile: UserProfile): number {
  const bw = userProfile?.weightKg;
  const brick = exercise.brick || 2.5;
  if (!bw) return roundToBrick(brick * 4, brick);
  // Rough ratio by unit: bilateral kg ≈ 30% bw, unilateral ≈ 15% per side
  const ratio = exercise.unit === 'KG_PER_HAND' || exercise.unit === 'KG_PER_ARM' ? 0.15 : 0.3;
  return Math.max(brick, roundToBrick(bw * ratio, brick));
}

function isAsymmetric(sets: SetRecord[]): boolean {
  if (sets.length < 2) return false;
  const first = sets[0].weight || 0;
  return sets.some((s) => (s.weight || 0) !== first);
}

function detectDegradation(sets: SetRecord[]): boolean {
  if (sets.length < 2) return false;
  const firstReps = sets[0].reps || 0;
  const lastReps = sets[sets.length - 1].reps || 0;
  return firstReps > 0 && lastReps < firstReps * 0.6;
}

function detectPrematureIncrease(currentSets: SetRecord[], lastSets: SetRecord[]): boolean {
  if (!lastSets.length || !currentSets.length) return false;
  const currentTop = Math.max(...currentSets.map((s) => s.weight || 0));
  const lastTop = Math.max(...lastSets.map((s) => s.weight || 0));
  if (currentTop <= lastTop) return false;
  const currentTotal = currentSets.reduce((sum, s) => sum + (s.reps || 0), 0);
  const lastTotal = lastSets.reduce((sum, s) => sum + (s.reps || 0), 0);
  return currentTotal < lastTotal;
}

function detectSuperCompletion(sets: SetRecord[], repTarget: number): boolean {
  return sets.some((s) => (s.reps || 0) >= repTarget * 1.5);
}

const DEFAULT_PROFILE: UserProfile = {
  weightKg: null,
  heightCm: null,
  age: null,
  sex: null,
  weightLog: [],
  goal: null,
  level: null,
  equipment: null,
  daysPerWeek: null,
  aiNotes: '',
};

/** Peso de referencia: lo de hoy si ya hay series hechas, si no lo de la última sesión. */
function referenceTop(todaySets: TodaySetProgress[], lastSets: SetRecord[] | null): number {
  const done = todaySets
    .filter((s) => s?.done && !s.isWarmup)
    .map((s) => (typeof s.weight === 'number' ? s.weight : 0));
  const base = done.length
    ? done
    : (lastSets ?? []).filter((s) => !s.isWarmup).map((s) => s.weight || 0);
  return base.length ? Math.max(...base) : 0;
}

/**
 * Prohíbe subir en un ejercicio sobre el que el atleta declaró una molestia (RF-IA-04).
 *
 * Solo pone un techo: no baja el peso ni desaconseja entrenar. Una molestia no es un
 * diagnóstico y la app no lo hace; lo único que sí puede hacer sin equivocarse es dejar de
 * empujarte hacia arriba mientras dure. Es la misma regla que ya acotaba a la IA
 * (`injuryBlocksIncrease`), aplicada ahora también al motor local.
 */
function capForInjury(
  rec: AiRecommendation,
  exercise: Exercise,
  todaySets: TodaySetProgress[],
  lastSets: SetRecord[] | null,
  userProfile: UserProfile,
  lang: 'es' | 'en',
): AiRecommendation {
  if (exercise.unit === 'TIME' || exercise.unit === 'BODYWEIGHT') return rec;
  if (!injuryBlocksIncrease(exercise.name, userProfile.aiNotes)) return rec;

  const ceiling = referenceTop(todaySets, lastSets);
  if (ceiling <= 0 || !rec.sets.some((s) => s.weight > ceiling)) return rec;

  return {
    sets: rec.sets.map((s) => ({ ...s, weight: Math.min(s.weight, ceiling) })),
    reason: buildReasons(lang).injuryHold(ceiling),
    source: 'local',
  };
}

export class LocalProvider implements AiProvider, AiSessionProvider {
  readonly name = 'local' as const;

  /**
   * La sesión entera resuelta con el motor de reglas.
   *
   * Recorrer los ejercicios uno a uno aquí no tiene coste: no hay red ni tokens. La interfaz
   * de sesión existe para que el orquestador trate igual a los tres proveedores.
   */
  recommendSession(ctx: AiSessionContext): Promise<SessionRecommendation> {
    const byExercise: Record<string, AiRecommendation> = {};
    for (const ec of ctx.exercises) {
      byExercise[ec.exercise.id] = this.compute(
        ec.exercise,
        [],
        ec.lastSets,
        ec.history,
        ctx.userProfile,
        ec.lastSessionDate,
        ctx.lang,
        { lastFeel: ec.lastFeel },
      );
    }
    return Promise.resolve({ byExercise, source: 'local' });
  }

  recommend({
    exercise,
    todaySets,
    lastSets,
    history,
    userProfile,
    lastSessionDate,
    lang,
    lastFeel,
  }: AiProviderContext): Promise<AiRecommendation> {
    return Promise.resolve(
      this.compute(exercise, todaySets, lastSets, history, userProfile, lastSessionDate, lang, {
        lastFeel,
      }),
    );
  }

  /**
   * Recomendación del motor de reglas, ya acotada por lo que el atleta declaró.
   *
   * El motor razona sobre lo que MIDE (series, reps, fechas). Lo que el atleta CUENTA —una
   * molestia en un ejercicio concreto— no aparece en ninguna de esas señales, así que se
   * aplica aquí, encima del resultado. Sin este paso, contarle una lesión al coach no movía
   * ni un gramo mientras las sugerencias no las calculara la IA (T-816).
   */
  compute(
    exercise: Exercise,
    todaySets: TodaySetProgress[],
    lastSets: SetRecord[] | null,
    history: HistoryEntry[] = [],
    userProfile: UserProfile = DEFAULT_PROFILE,
    lastSessionDate: string | null = null,
    lang: 'es' | 'en' = 'es',
    opts: { lastFeel?: TrainingFeel | null } = {},
  ): AiRecommendation {
    const rec = this.computeInner(
      exercise,
      todaySets,
      lastSets,
      history,
      userProfile,
      lastSessionDate,
      lang,
      opts,
    );
    return capForInjury(rec, exercise, todaySets, lastSets, userProfile, lang);
  }

  private computeInner(
    exercise: Exercise,
    todaySets: TodaySetProgress[],
    lastSets: SetRecord[] | null,
    history: HistoryEntry[],
    userProfile: UserProfile,
    lastSessionDate: string | null,
    lang: 'es' | 'en',
    opts: { lastFeel?: TrainingFeel | null },
  ): AiRecommendation {
    const brick = exercise.brick || 2.5;
    const repTarget = goalRepTarget(
      userProfile.goal,
      exercise.defaultRepTarget || 10,
      exercise.unit,
    );
    const setsTarget = exercise.defaultSets || 3;
    const params = levelParams(userProfile.level);
    const r = buildReasons(lang);

    const doneSets = todaySets
      .filter((s) => s?.done && !s.isWarmup)
      .map(
        (s, i): SetRecord => ({
          exerciseId: exercise.id,
          setIndex: i,
          weight: typeof s.weight === 'number' ? s.weight : 0,
          reps: typeof s.reps === 'number' ? s.reps : 0,
          repTarget: repTarget,
        }),
      );

    const baseSets: SetRecord[] = doneSets.length > 0 ? doneSets : (lastSets ?? []);

    // --- Ramas por unidad ---
    if (exercise.unit === 'TIME') {
      return this.computeTime(baseSets, exercise, setsTarget, repTarget, r);
    }
    if (exercise.unit === 'BODYWEIGHT') {
      return this.computeBodyweight(baseSets, exercise, setsTarget, repTarget, r);
    }

    // --- Sin historial: primera sesión ---
    if (baseSets.length === 0) {
      const startWeight = estimateStartWeight(exercise, userProfile);
      return {
        sets: Array.from({ length: setsTarget }, () => ({ weight: startWeight, reps: repTarget })),
        reason: r.firstSession(startWeight),
        source: 'local',
      };
    }

    // --- Pirámide / sets asimétricos ---
    if (isAsymmetric(baseSets)) {
      return this.computePyramid(baseSets, exercise, setsTarget, repTarget, brick, r);
    }

    const topWeight = Math.max(...baseSets.map((s) => s.weight || 0));

    // --- Sesión espaciada ---
    // El recorte es PROPORCIONAL y lo decide `layoffFactor`, la misma regla que acota lo que
    // responde la IA. Antes aquí se restaban dos incrementos fijos: tras un mes y tras tres
    // años daba el mismo peso, y no coincidía con el tope del validador.
    if (lastSessionDate) {
      const today = new Date().toISOString().slice(0, 10);
      const gap = daysBetween(lastSessionDate, today);
      const factor = layoffFactor(lastSessionDate, today);
      if (factor < 1) {
        // Hacia abajo, igual que el techo del validador: si no, el motor propondría
        // un peso que la propia validación consideraría excesivo.
        const reduced = floorToBrick(topWeight * factor, brick);
        return {
          sets: Array.from({ length: setsTarget }, () => ({ weight: reduced, reps: repTarget })),
          reason:
            gap > LAYOFF_LONG_DAYS
              ? r.spacingLong(topWeight, reduced)
              : r.spacingModerate(topWeight, reduced),
          source: 'local',
        };
      }
    }

    // El estancamiento de §4.5 es no avanzar A PESAR de intentarlo. Quien cumple el objetivo
    // cada sesión no está estancado aunque el peso no suba: le toca subirlo, no descargar.
    // Por eso las dos señales van juntas y nunca se mira la falta de progreso por sí sola.
    const failures = consecutiveFailures(history, repTarget, setsTarget);
    const stagnant = isStagnant(history, params.stagnationSessions);

    // --- Estancamiento real: falla el objetivo Y la marca lleva N sesiones sin moverse ---
    if (failures >= params.failSessions && stagnant) {
      const deloadWeight = roundToBrick(topWeight * params.deloadFactor, brick);
      return {
        sets: Array.from({ length: setsTarget }, () => ({ weight: deloadWeight, reps: repTarget })),
        reason: r.stagnation(params.stagnationSessions, deloadWeight),
        source: 'local',
      };
    }

    // --- Fallos consecutivos sin estancamiento largo: bajar 5–10% según nivel (§4.5) ---
    // Va antes que cualquier regla de progreso: insistir en un peso que no se completa dos
    // sesiones seguidas es la vía rápida a la lesión y al abandono.
    if (failures >= params.failSessions) {
      const dropped = failureDropWeight(topWeight, brick, params.failDrop);
      return {
        sets: Array.from({ length: setsTarget }, () => ({ weight: dropped, reps: repTarget })),
        reason: r.consecutiveFailures(failures, dropped),
        source: 'local',
      };
    }

    // --- Descarga preventiva tras una racha larga de progreso ---
    const streak = progressStreak(history);
    if (streak >= params.deloadAfterProgress) {
      const deloadWeight = roundToBrick(topWeight * params.deloadFactor, brick);
      return {
        sets: Array.from({ length: setsTarget }, () => ({ weight: deloadWeight, reps: repTarget })),
        reason: r.deload(streak, deloadWeight),
        source: 'local',
      };
    }

    // --- Progresión prematura ---
    if (lastSets && doneSets.length === 0 && detectPrematureIncrease(baseSets, lastSets)) {
      const prevTop = Math.max(...lastSets.map((s) => s.weight || 0));
      return {
        sets: Array.from({ length: setsTarget }, () => ({ weight: prevTop, reps: repTarget })),
        reason: r.premature(prevTop),
        source: 'local',
      };
    }

    const ratio = completionRatio(baseSets, repTarget, setsTarget);

    // --- Meseta: falló la última, la marca no se mueve, pero aún no son N fallos seguidos.
    //     Se sostiene el peso y se sugiere cambiar el esquema antes de tocar la carga. ---
    if (failures > 0 && stagnant && ratio < 1) {
      return {
        sets: Array.from({ length: setsTarget }, () => ({ weight: topWeight, reps: repTarget })),
        reason: r.plateau(topWeight, params.stagnationSessions),
        source: 'local',
      };
    }

    // --- Degradación brusca entre series ---
    if (detectDegradation(baseSets) && ratio >= 0.5) {
      return {
        sets: Array.from({ length: setsTarget }, () => ({ weight: topWeight, reps: repTarget })),
        reason: r.degradation(topWeight),
        source: 'local',
      };
    }

    // --- Super-completado: reps >> objetivo en al menos 1 serie ---
    if (ratio >= 1 && detectSuperCompletion(baseSets, repTarget)) {
      const newWeight = roundToBrick(topWeight + brick * 2, brick);
      return {
        sets: Array.from({ length: setsTarget }, () => ({ weight: newWeight, reps: repTarget })),
        reason: r.superCompletion(topWeight, newWeight),
        source: 'local',
      };
    }

    // --- Objetivo cumplido ---
    if (ratio >= 1) {
      // §4.5 exige RPE ≤ 8 para subir. La app registra la sensación como fácil/bien/pesado:
      // si la última vez costó, se consolida el peso en vez de subirlo aunque salgan las reps.
      if (opts.lastFeel === 'hard') {
        return {
          sets: Array.from({ length: setsTarget }, () => ({ weight: topWeight, reps: repTarget })),
          reason: r.hardFeel(topWeight),
          source: 'local',
        };
      }
      const newWeight = roundToBrick(topWeight + brick, brick);
      // Doble progresión: si confirmó 2 sesiones seguidas al 100%, subir todas las series
      if (confirmedAtWeight(history, topWeight, repTarget, setsTarget, params.confirmSessions)) {
        return {
          sets: Array.from({ length: setsTarget }, () => ({ weight: newWeight, reps: repTarget })),
          reason: r.goalMetConfirmed(topWeight, newWeight),
          source: 'local',
        };
      }
      // Primera vez al 100%: subir solo las últimas 2 series
      const challengeFrom = Math.max(0, setsTarget - 2);
      const sets: SetRecommendation[] = Array.from({ length: setsTarget }, (_, i) => ({
        weight: i >= challengeFrom ? newWeight : topWeight,
        reps: repTarget,
      }));
      return { sets, reason: r.goalMet(topWeight, newWeight), source: 'local' };
    }

    if (ratio >= 0.8) {
      return {
        sets: Array.from({ length: setsTarget }, () => ({ weight: topWeight, reps: repTarget })),
        reason: r.almostThere(topWeight),
        source: 'local',
      };
    }

    if (ratio >= 0.5) {
      return {
        sets: Array.from({ length: setsTarget }, () => ({ weight: topWeight, reps: repTarget })),
        reason: r.consolidate(topWeight),
        source: 'local',
      };
    }

    const prevWeight = roundToBrick(Math.max(topWeight - brick, brick), brick);
    const higherReps = Math.round(repTarget * 1.3);
    return {
      sets: Array.from({ length: setsTarget }, () => ({ weight: prevWeight, reps: higherReps })),
      reason: r.tooHeavy(prevWeight),
      source: 'local',
    };
  }

  private computeTime(
    baseSets: SetRecord[],
    exercise: Exercise,
    setsTarget: number,
    timeTarget: number,
    r: ReturnType<typeof buildReasons>,
  ): AiRecommendation {
    const timeBrick = exercise.brick || 5;

    if (baseSets.length === 0) {
      const startSecs = Math.max(10, timeTarget);
      return {
        sets: Array.from({ length: setsTarget }, () => ({ weight: 0, reps: startSecs })),
        reason: r.firstSessionTime(startSecs),
        source: 'local',
      };
    }

    const totalSecs = baseSets.reduce((sum, s) => sum + (s.reps || 0), 0);
    const maxSecs = setsTarget * timeTarget;
    const ratio = maxSecs > 0 ? totalSecs / maxSecs : 0;

    if (ratio >= 1) {
      const newSecs = Math.round(timeTarget + timeBrick);
      return {
        sets: Array.from({ length: setsTarget }, () => ({ weight: 0, reps: newSecs })),
        reason: r.timeProg(timeTarget, newSecs),
        source: 'local',
      };
    }

    if (ratio >= 0.7) {
      return {
        sets: Array.from({ length: setsTarget }, () => ({ weight: 0, reps: timeTarget })),
        reason: r.timeConsolidate(timeTarget),
        source: 'local',
      };
    }

    const reducedSecs = Math.max(5, Math.round(timeTarget * 0.8));
    return {
      sets: Array.from({ length: setsTarget }, () => ({ weight: 0, reps: reducedSecs })),
      reason: r.timeTooHard(reducedSecs),
      source: 'local',
    };
  }

  private computeBodyweight(
    baseSets: SetRecord[],
    exercise: Exercise,
    setsTarget: number,
    repTarget: number,
    r: ReturnType<typeof buildReasons>,
  ): AiRecommendation {
    if (baseSets.length === 0) {
      return {
        sets: Array.from({ length: setsTarget }, () => ({ weight: 0, reps: repTarget })),
        reason: r.firstSessionBw(repTarget),
        source: 'local',
      };
    }

    const totalReps = baseSets.reduce((sum, s) => sum + (s.reps || 0), 0);
    const maxReps = setsTarget * repTarget;
    const ratio = maxReps > 0 ? totalReps / maxReps : 0;

    if (ratio >= 1) {
      const newTarget = repTarget + 2;
      return {
        sets: Array.from({ length: setsTarget }, () => ({ weight: 0, reps: newTarget })),
        reason: r.bwProg(repTarget, newTarget),
        source: 'local',
      };
    }

    if (ratio >= 0.7) {
      return {
        sets: Array.from({ length: setsTarget }, () => ({ weight: 0, reps: repTarget })),
        reason: r.bwConsolidate(repTarget),
        source: 'local',
      };
    }

    const reducedReps = Math.max(1, Math.round(repTarget * 0.8));
    return {
      sets: Array.from({ length: setsTarget }, () => ({ weight: 0, reps: reducedReps })),
      reason: r.bwTooHard(reducedReps),
      source: 'local',
    };
  }

  private computePyramid(
    baseSets: SetRecord[],
    exercise: Exercise,
    setsTarget: number,
    repTarget: number,
    brick: number,
    r: ReturnType<typeof buildReasons>,
  ): AiRecommendation {
    const topWeight = Math.max(...baseSets.map((s) => s.weight || 0));
    const topSets = baseSets.filter((s) => (s.weight || 0) === topWeight);
    const topRatio = completionRatio(topSets, repTarget, topSets.length);

    // Reproduce the same weight structure; optionally increase top weight if top sets hit 100%
    const weightMap = baseSets.map((s) => s.weight || 0);
    if (topRatio >= 1) {
      const brickJump = detectSuperCompletion(topSets, repTarget) ? 2 : 1;
      const newTop = roundToBrick(topWeight + brick * brickJump, brick);
      const delta = newTop - topWeight;
      return {
        sets: Array.from({ length: setsTarget }, (_, i) => ({
          weight: roundToBrick((weightMap[i] ?? topWeight) + delta, brick),
          reps: baseSets[i]?.reps ?? repTarget,
        })),
        reason: brickJump > 1 ? r.superCompletion(topWeight, newTop) : r.pyramid(newTop),
        source: 'local',
      };
    }

    return {
      sets: Array.from({ length: setsTarget }, (_, i) => ({
        weight: weightMap[i] ?? topWeight,
        reps: baseSets[i]?.reps ?? repTarget,
      })),
      reason: r.pyramid(topWeight),
      source: 'local',
    };
  }
}
