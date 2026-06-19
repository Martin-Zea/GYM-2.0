import {
  AiRecommendation,
  Exercise,
  SetRecord,
  SetRecommendation,
  TodaySetProgress,
  UserProfile,
} from '../../models/workout.model';
import { HistoryEntry } from '../storage.service';
import { AiProvider, AiProviderContext } from './ai-provider';
import { roundToBrick } from './prompt-helpers';

const DELOAD_SESSIONS = 4;
const PLATEAU_SESSIONS = 5;
const SPACING_MODERATE_DAYS = 14;
const SPACING_LONG_DAYS = 28;
const DOUBLE_PROG_CONFIRM_SESSIONS = 2;

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

    deload: (topWeight: number, deloadWeight: number) =>
      es
        ? `Llevás ${DELOAD_SESSIONS}+ sesiones progresando seguido. Semana de descarga: ${deloadWeight}kg para recuperarte bien.`
        : `${DELOAD_SESSIONS}+ consecutive progress sessions. Deload week: ${deloadWeight}kg to recover properly.`,

    plateau: (topWeight: number) =>
      es
        ? `Meseta en ${topWeight}kg hace ${PLATEAU_SESSIONS}+ sesiones. Cambiá el rango de reps o el tempo para romperla.`
        : `Plateau at ${topWeight}kg for ${PLATEAU_SESSIONS}+ sessions. Change rep range or tempo to break through.`,

    premature: (prevWeight: number) =>
      es
        ? `Subiste el peso antes de consolidar. Volvé a ${prevWeight}kg y cerrá el objetivo de reps.`
        : `Weight went up before consolidating. Return to ${prevWeight}kg and hit the rep target.`,

    spacingLong: (topWeight: number, reducedWeight: number) =>
      es
        ? `Más de ${SPACING_LONG_DAYS} días sin entrenar este ejercicio. Arrancá conservador con ${reducedWeight}kg.`
        : `Over ${SPACING_LONG_DAYS} days since last session. Start conservative with ${reducedWeight}kg.`,

    spacingModerate: (topWeight: number, reducedWeight: number) =>
      es
        ? `Más de ${SPACING_MODERATE_DAYS} días sin entrenar. Bajamos un ladrillo a ${reducedWeight}kg por precaución.`
        : `Over ${SPACING_MODERATE_DAYS} days since last session. Dropping one increment to ${reducedWeight}kg.`,

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
  const ratio = exercise.unit === 'kg por mano' || exercise.unit === 'kg por brazo' ? 0.15 : 0.3;
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

function completionRatio(sets: SetRecord[], repTarget: number, setsTarget: number): number {
  const maxPossible = setsTarget * repTarget;
  if (maxPossible <= 0) return 0;
  // Use repTarget stored at time of recording if available, fall back to current target
  const totalReps = sets.reduce((sum, s) => {
    const target = s.repTarget ?? repTarget;
    return sum + Math.min(s.reps || 0, target);
  }, 0);
  return totalReps / maxPossible;
}

function detectDeload(history: HistoryEntry[]): boolean {
  if (history.length < DELOAD_SESSIONS) return false;
  const last = history.slice(-DELOAD_SESSIONS);
  return last.every((h, i) => i === 0 || h.topWeight > last[i - 1].topWeight);
}

function detectPlateau(
  history: HistoryEntry[],
  topWeight: number,
  repTarget: number,
  setsTarget: number,
): boolean {
  if (history.length < PLATEAU_SESSIONS) return false;
  const last = history.slice(-PLATEAU_SESSIONS);
  return last.every((h) => {
    const sameWeight = h.topWeight === topWeight;
    const ratio = completionRatio(h.sets, repTarget, setsTarget);
    return sameWeight && ratio < 1;
  });
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

function consecutiveConfirmed(
  history: HistoryEntry[],
  topWeight: number,
  repTarget: number,
  setsTarget: number,
): boolean {
  if (history.length < DOUBLE_PROG_CONFIRM_SESSIONS) return false;
  const last = history.slice(-DOUBLE_PROG_CONFIRM_SESSIONS);
  return last.every(
    (h) => h.topWeight === topWeight && completionRatio(h.sets, repTarget, setsTarget) >= 1,
  );
}

export class LocalProvider implements AiProvider {
  recommend({
    exercise,
    todaySets,
    lastSets,
    history,
    userProfile,
    lastSessionDate,
    lang,
  }: AiProviderContext): Promise<AiRecommendation> {
    return Promise.resolve(
      this.compute(exercise, todaySets, lastSets, history, userProfile, lastSessionDate, lang),
    );
  }

  compute(
    exercise: Exercise,
    todaySets: TodaySetProgress[],
    lastSets: SetRecord[] | null,
    history: HistoryEntry[] = [],
    userProfile: UserProfile = {
      weightKg: null,
      heightCm: null,
      age: null,
      sex: null,
      weightLog: [],
    },
    lastSessionDate: string | null = null,
    lang: 'es' | 'en' = 'es',
  ): AiRecommendation {
    const brick = exercise.brick || 2.5;
    const repTarget = exercise.defaultRepTarget || 10;
    const setsTarget = exercise.defaultSets || 3;
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
    if (exercise.unit === 'tiempo') {
      return this.computeTime(baseSets, exercise, setsTarget, repTarget, r);
    }
    if (exercise.unit === 'peso corporal') {
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
    if (lastSessionDate) {
      const today = new Date().toISOString().slice(0, 10);
      const gap = daysBetween(lastSessionDate, today);
      if (gap > SPACING_LONG_DAYS) {
        const reduced = Math.max(brick, roundToBrick(topWeight - brick * 2, brick));
        return {
          sets: Array.from({ length: setsTarget }, () => ({ weight: reduced, reps: repTarget })),
          reason: r.spacingLong(topWeight, reduced),
          source: 'local',
        };
      }
      if (gap > SPACING_MODERATE_DAYS) {
        const reduced = Math.max(brick, roundToBrick(topWeight - brick, brick));
        return {
          sets: Array.from({ length: setsTarget }, () => ({ weight: reduced, reps: repTarget })),
          reason: r.spacingModerate(topWeight, reduced),
          source: 'local',
        };
      }
    }

    // --- Deload por acumulación ---
    if (detectDeload(history)) {
      const deloadWeight = roundToBrick(topWeight * 0.7, brick);
      return {
        sets: Array.from({ length: setsTarget }, () => ({ weight: deloadWeight, reps: repTarget })),
        reason: r.deload(topWeight, deloadWeight),
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

    // --- Meseta ---
    if (detectPlateau(history, topWeight, repTarget, setsTarget) && ratio < 1) {
      return {
        sets: Array.from({ length: setsTarget }, () => ({ weight: topWeight, reps: repTarget })),
        reason: r.plateau(topWeight),
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

    // --- Objetivo cumplido ---
    if (ratio >= 1) {
      const newWeight = roundToBrick(topWeight + brick, brick);
      // Doble progresión: si confirmó 2 sesiones seguidas al 100%, subir todas las series
      if (consecutiveConfirmed(history, topWeight, repTarget, setsTarget)) {
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
      const newTop = roundToBrick(topWeight + brick, brick);
      const delta = newTop - topWeight;
      return {
        sets: Array.from({ length: setsTarget }, (_, i) => ({
          weight: roundToBrick((weightMap[i] ?? topWeight) + delta, brick),
          reps: baseSets[i]?.reps ?? repTarget,
        })),
        reason: r.pyramid(newTop),
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
