import {
  AiRecommendation,
  Exercise,
  SetRecord,
  SetRecommendation,
  TodaySetProgress,
} from '../../models/workout.model';
import { AiProvider, AiProviderContext } from './ai-provider';
import { roundToBrick } from './prompt-helpers';

function localReasons(lang: 'es' | 'en') {
  return {
    firstSession:
      lang === 'en'
        ? 'First session: set an initial weight and complete sets so the AI can guide you.'
        : 'Primera sesión: definí un peso inicial y completá para que la IA te guíe.',
    goalMet: (topWeight: number, newWeight: number) =>
      lang === 'en'
        ? `Goal met at ${topWeight}kg. Last 2 sets go up to ${newWeight}kg.`
        : `Objetivo cumplido con ${topWeight}kg. Las últimas 2 series suben a ${newWeight}kg.`,
    almostThere: (topWeight: number) =>
      lang === 'en'
        ? `Very close to the goal at ${topWeight}kg. Repeat this weight to close it out.`
        : `Muy cerca del objetivo con ${topWeight}kg. Repetís este peso para cerrar.`,
    consolidate: (topWeight: number) =>
      lang === 'en'
        ? `Keep consolidating ${topWeight}kg. Focus on technique.`
        : `Seguimos consolidando ${topWeight}kg. Enfocate en la técnica.`,
    tooHeavy: (prevWeight: number) =>
      lang === 'en'
        ? `Weight was too heavy. Dropping to ${prevWeight}kg with more reps to maintain stimulus.`
        : `El peso fue excesivo. Bajamos a ${prevWeight}kg con más reps para mantener el estímulo.`,
  };
}

export class LocalProvider implements AiProvider {
  recommend({ exercise, todaySets, lastSets, lang }: AiProviderContext): Promise<AiRecommendation> {
    return Promise.resolve(this.compute(exercise, todaySets, lastSets, lang));
  }

  compute(
    exercise: Exercise,
    todaySets: TodaySetProgress[],
    lastSets: SetRecord[] | null,
    lang: 'es' | 'en' = 'es',
  ): AiRecommendation {
    const brick = exercise.brick || 2.5;
    const repTarget = exercise.defaultRepTarget || 10;
    const setsTarget = exercise.defaultSets || 3;
    const r = localReasons(lang);

    const doneSets = todaySets
      .filter((s) => s?.done)
      .map((s) => ({
        exerciseId: exercise.id,
        setIndex: 0,
        weight: typeof s.weight === 'number' ? s.weight : 0,
        reps: typeof s.reps === 'number' ? s.reps : 0,
      }));

    const baseSets: SetRecord[] = doneSets.length > 0 ? doneSets : (lastSets ?? []);

    if (baseSets.length === 0) {
      return {
        sets: Array.from({ length: setsTarget }, () => ({ weight: 0, reps: repTarget })),
        reason: r.firstSession,
        source: 'local',
      };
    }

    const topWeight = Math.max(...baseSets.map((s) => s.weight || 0));
    const totalRepsAtTop = baseSets
      .filter((s) => (s.weight || 0) === topWeight)
      .reduce((sum, s) => sum + (s.reps || 0), 0);
    const maxPossibleReps = setsTarget * repTarget;
    const completionRatio = maxPossibleReps > 0 ? totalRepsAtTop / maxPossibleReps : 0;

    if (completionRatio >= 1) {
      const newWeight = roundToBrick(topWeight + brick, brick);
      const challengeFrom = Math.max(0, setsTarget - 2);
      const sets: SetRecommendation[] = Array.from({ length: setsTarget }, (_, i) => ({
        weight: i >= challengeFrom ? newWeight : topWeight,
        reps: repTarget,
      }));
      return { sets, reason: r.goalMet(topWeight, newWeight), source: 'local' };
    }

    if (completionRatio >= 0.8) {
      return {
        sets: Array.from({ length: setsTarget }, () => ({ weight: topWeight, reps: repTarget })),
        reason: r.almostThere(topWeight),
        source: 'local',
      };
    }

    if (completionRatio >= 0.5) {
      return {
        sets: Array.from({ length: setsTarget }, () => ({ weight: topWeight, reps: repTarget })),
        reason: r.consolidate(topWeight),
        source: 'local',
      };
    }

    const prevWeight = roundToBrick(Math.max(topWeight - brick, 0), brick);
    const higherReps = Math.round(repTarget * 1.3);
    return {
      sets: Array.from({ length: setsTarget }, () => ({ weight: prevWeight, reps: higherReps })),
      reason: r.tooHeavy(prevWeight),
      source: 'local',
    };
  }
}
