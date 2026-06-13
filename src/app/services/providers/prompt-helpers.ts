import { UserProfile } from '../../models/workout.model';

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

export function parseAndNormalizeSets(
  parsed: unknown,
  setsTarget: number,
  brick: number,
  repTarget: number,
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

  return normalized.map((s) => ({
    weight: roundToBrick(s.weight || 0, brick),
    reps: Math.max(1, Math.round(s.reps || repTarget)),
  }));
}
