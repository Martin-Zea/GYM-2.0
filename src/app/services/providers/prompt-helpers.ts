import { ExerciseUnit, TrainingGoal, UserProfile } from '../../models/workout.model';
import { HistoryEntry } from '../storage.service';

export const AI_TIMEOUT_MS = 12000;
export const HISTORY_SESSIONS = 5;

export function roundToBrick(weight: number, brick: number): number {
  if (!brick || brick <= 0) return Math.round(weight * 2) / 2;
  return Math.round(weight / brick) * brick;
}

export async function fetchWithTimeout(url: string, options: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export function buildPerfilParts(userProfile: UserProfile): string[] {
  const parts: string[] = [];
  if (userProfile.weightKg) parts.push(`peso corporal ${userProfile.weightKg}kg`);
  if (userProfile.heightCm) parts.push(`altura ${userProfile.heightCm}cm`);
  if (userProfile.age) parts.push(`edad ${userProfile.age} años`);
  if (userProfile.sex) {
    const sexLabel =
      userProfile.sex === 'male' ? 'masculino' : userProfile.sex === 'female' ? 'femenino' : 'otro';
    parts.push(`sexo ${sexLabel}`);
    if (userProfile.sex === 'female') parts.push('(considerar ciclo hormonal en recuperación)');
  }
  return parts.filter((p) => !p.startsWith('('));
}

export function buildProfileNote(perfilParts: string[], userProfile: UserProfile): string {
  if (!perfilParts.length) return '';

  const ageTip = userProfile.age
    ? userProfile.age >= 50
      ? 'El usuario es mayor de 50 años: priorizá recuperación y evitá incrementos agresivos.'
      : userProfile.age <= 22
        ? 'El usuario es joven: puede tolerar progresiones más frecuentes.'
        : ''
    : '';

  const sexTip =
    userProfile.sex === 'female'
      ? 'Mujeres generalmente necesitan más reps y menos peso absoluto, ajustá en consecuencia.'
      : '';

  const bwNote = userProfile.weightKg
    ? `El peso corporal (${userProfile.weightKg}kg) es referencia para evaluar la fuerza relativa.`
    : '';

  const tips = [ageTip, sexTip, bwNote].filter(Boolean).join(' ');
  return `- Perfil: ${perfilParts.join(', ')}. ${tips}\n`;
}

// Used only by LocalProvider — AI providers receive goal as context, not as a rep directive
export function goalRepTarget(
  goal: TrainingGoal | null | undefined,
  defaultRep: number,
  unit?: ExerciseUnit,
): number {
  if (unit === 'peso corporal' || unit === 'tiempo') return defaultRep;
  if (goal === 'strength') return Math.min(defaultRep, 5);
  if (goal === 'endurance') return Math.max(defaultRep, 15);
  return defaultRep;
}

export function buildGoalNote(
  goal: TrainingGoal | null | undefined,
  aiNotes: string | undefined,
): string {
  const lines: string[] = [];
  if (goal) {
    const labels: Record<TrainingGoal, string> = {
      strength:
        'fuerza (priorizar carga pesada, 3-5 reps en compuestos; en aislamiento ajustá según historial y tipo de ejercicio)',
      hypertrophy: 'hipertrofia (rango 6-12 reps, volumen moderado-alto)',
      endurance:
        'resistencia muscular (15+ reps, pesos moderados; ajustá según el tipo de ejercicio y su historial)',
    };
    lines.push(`- Objetivo del atleta: ${labels[goal]}.`);
    lines.push(
      `- El campo "objetivo" en los datos refleja el target natural del ejercicio. Aplicá el goal como guía profesional, no como directiva rígida de reps.`,
    );
  }
  if (aiNotes?.trim()) {
    lines.push(`- Contexto personal del atleta: ${aiNotes.trim()}`);
  }
  return lines.length ? lines.join('\n') + '\n' : '';
}

/**
 * Principios de progresión compartidos por todos los providers de IA.
 * compact=false → Groq (modelo grande, prompt detallado)
 * compact=true  → Cohere (modelo pequeño, prompt compacto)
 */
export function buildPrinciplesPrompt(brick: number, compact = false): string {
  const principles = [
    `Doble progresión: subí peso solo cuando el atleta confirmó el objetivo de reps en al menos 2 sesiones consecutivas con el mismo peso, no al primer éxito.`,
    `Super-completado: si alguna serie tuvo reps ≥ 150% del objetivo (ej: 9+ reps con target 6), el peso fue demasiado liviano — aumentá 2 ladrillos en vez de 1.`,
    `Degradación entre series: si las reps cayeron más del 40% entre la primera y la última serie, priorizá consolidar la técnica antes de subir.`,
    `Descanso largo (el sistema lo enforcea en código): si dias > 28 el peso se limitará al 85% del anterior; si dias > 14 al 90%. Mencionalo en el reason cuando aplique.`,
    `Pirámide: si los pesos de las series son distintos, respetá la estructura y ajustá proporcionalmente.`,
    `Meseta: si el peso top se repitió 5+ sesiones sin llegar al objetivo, sugerí cambiar el rango de reps o el tempo en el reason.`,
    `Deload: si el historial muestra 4+ sesiones consecutivas de aumento de peso, sugerí una sesión más suave (~70% del máximo).`,
    `Unidad tiempo: el progreso es en segundos, no en carga. Devolvé weight: 0 y reps como segundos.`,
    `Unidad peso corporal: el progreso es en reps. Devolvé weight: 0 y aumentá reps cuando se completa el objetivo.`,
    `El peso debe ser múltiplo exacto de ${brick}kg.`,
  ];

  if (compact) {
    return `Principios: ${principles.join(' | ')}\n`;
  }

  return `Principios para tu análisis (no son reglas rígidas, usá tu criterio):\n${principles.map((p) => `- ${p}`).join('\n')}\n`;
}

export function buildHistoryDetail(
  history: HistoryEntry[],
  maxSessions = HISTORY_SESSIONS,
): object[] {
  return history.slice(-maxSessions).map((h) => ({
    fecha: h.dateISO,
    series: h.sets.map((s, i) => ({ s: i + 1, kg: s.weight, r: s.reps })),
    vol: h.volume,
  }));
}

export interface ParseNormalizeSetsOptions {
  unit?: ExerciseUnit;
  lastSets?: { reps: number | string }[] | null;
}

export function bodyweightRepFloor(
  unit: ExerciseUnit | undefined,
  lastSets: { reps: number | string }[] | null | undefined,
): number {
  if (unit !== 'peso corporal' && unit !== 'tiempo') return 1;
  if (!lastSets?.length) return 1;
  const max = Math.max(
    ...lastSets.map((s) => (typeof s.reps === 'number' ? s.reps : Number(s.reps)) || 0),
  );
  return max > 0 ? max : 1;
}

export function parseAndNormalizeSets(
  parsed: unknown,
  setsTarget: number,
  brick: number,
  repTarget: number,
  opts: ParseNormalizeSetsOptions = {},
): { weight: number; reps: number }[] {
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !Array.isArray((parsed as { sets?: unknown }).sets) ||
    (parsed as { sets: unknown[] }).sets.length === 0
  ) {
    throw new Error('JSON IA incompleto');
  }

  const raw = (parsed as { sets: unknown[] }).sets;
  const validSets = raw.filter(
    (s) =>
      typeof s === 'object' &&
      s !== null &&
      typeof (s as { weight?: unknown }).weight === 'number' &&
      typeof (s as { reps?: unknown }).reps === 'number',
  ) as { weight: number; reps: number }[];

  if (validSets.length === 0) throw new Error('Sets sin valores numéricos');

  const normalized = Array.from(
    { length: setsTarget },
    (_, i) => validSets[i] ?? validSets[validSets.length - 1],
  );

  const floor = bodyweightRepFloor(opts.unit, opts.lastSets);
  return normalized.map((s) => ({
    weight: roundToBrick(s.weight || 0, brick),
    reps: Math.max(floor, Math.round(s.reps || repTarget)),
  }));
}
