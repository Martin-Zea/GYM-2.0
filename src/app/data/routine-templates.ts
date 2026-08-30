import { TrainingLevel } from '../models/workout.model';
import { Equipment } from './exercise-catalog';

export interface TemplateDay {
  /** Clave i18n del nombre del día. */
  key: string;
  es: string;
  en: string;
  /** Ejercicios por `ref` del catálogo estático. */
  refs: string[];
}

export interface RoutineTemplate {
  id: string;
  es: string;
  en: string;
  daysPerWeek: number;
  levels: TrainingLevel[];
  /** Equipo que hace falta. Se filtra contra lo que el atleta declara tener. */
  equipment: Equipment[];
  days: TemplateDay[];
}

/**
 * Plantillas locales de rutina (RF-RUT-03, vista R6).
 *
 * Van en el bundle como el catálogo: son contenido de la app. Cada una declara nivel, días
 * por semana y equipo para poder filtrarlas por el perfil, en vez de mostrar al principiante
 * sin gimnasio una PPL de 6 días con barra.
 */
export const ROUTINE_TEMPLATES: readonly RoutineTemplate[] = [
  {
    id: 'fullbody_3',
    es: 'Full Body 3 días',
    en: 'Full Body 3 days',
    daysPerWeek: 3,
    levels: ['beginner'],
    equipment: ['barbell', 'dumbbell', 'machine', 'cable'],
    days: [
      {
        key: 'a',
        es: 'Full Body A',
        en: 'Full Body A',
        refs: ['back_squat', 'bench_press', 'barbell_row', 'plank'],
      },
      {
        key: 'b',
        es: 'Full Body B',
        en: 'Full Body B',
        refs: ['romanian_deadlift', 'overhead_press', 'lat_pulldown', 'crunch'],
      },
      {
        key: 'c',
        es: 'Full Body C',
        en: 'Full Body C',
        refs: ['leg_press', 'db_bench_press', 'seated_row', 'lateral_raise'],
      },
    ],
  },
  {
    id: 'upper_lower_4',
    es: 'Torso / Pierna 4 días',
    en: 'Upper / Lower 4 days',
    daysPerWeek: 4,
    levels: ['intermediate', 'advanced'],
    equipment: ['barbell', 'dumbbell', 'machine', 'cable'],
    days: [
      {
        key: 'u1',
        es: 'Torso A',
        en: 'Upper A',
        refs: ['bench_press', 'barbell_row', 'overhead_press', 'db_curl', 'triceps_pushdown'],
      },
      {
        key: 'l1',
        es: 'Pierna A',
        en: 'Lower A',
        refs: ['back_squat', 'romanian_deadlift', 'leg_curl', 'calf_raise'],
      },
      {
        key: 'u2',
        es: 'Torso B',
        en: 'Upper B',
        refs: ['db_incline_press', 'lat_pulldown', 'lateral_raise', 'hammer_curl', 'skull_crusher'],
      },
      {
        key: 'l2',
        es: 'Pierna B',
        en: 'Lower B',
        refs: ['deadlift', 'leg_press', 'leg_extension', 'hip_thrust'],
      },
    ],
  },
  {
    id: 'ppl_6',
    es: 'Empuje / Tirón / Pierna 6 días',
    en: 'Push / Pull / Legs 6 days',
    daysPerWeek: 6,
    levels: ['advanced'],
    equipment: ['barbell', 'dumbbell', 'machine', 'cable'],
    days: [
      {
        key: 'push1',
        es: 'Empuje A',
        en: 'Push A',
        refs: [
          'bench_press',
          'overhead_press',
          'db_incline_press',
          'lateral_raise',
          'triceps_pushdown',
        ],
      },
      {
        key: 'pull1',
        es: 'Tirón A',
        en: 'Pull A',
        refs: ['deadlift', 'pull_up', 'seated_row', 'face_pull', 'barbell_curl'],
      },
      {
        key: 'legs1',
        es: 'Pierna A',
        en: 'Legs A',
        refs: ['back_squat', 'romanian_deadlift', 'leg_extension', 'calf_raise'],
      },
      {
        key: 'push2',
        es: 'Empuje B',
        en: 'Push B',
        refs: ['db_bench_press', 'db_shoulder_press', 'cable_crossover', 'skull_crusher'],
      },
      {
        key: 'pull2',
        es: 'Tirón B',
        en: 'Pull B',
        refs: ['barbell_row', 'lat_pulldown', 'rear_delt_fly', 'hammer_curl'],
      },
      {
        key: 'legs2',
        es: 'Pierna B',
        en: 'Legs B',
        refs: ['front_squat', 'hip_thrust', 'leg_curl', 'lunge'],
      },
    ],
  },
  {
    id: 'dumbbell_3',
    es: 'Solo mancuernas 3 días',
    en: 'Dumbbells only 3 days',
    daysPerWeek: 3,
    levels: ['beginner', 'intermediate'],
    equipment: ['dumbbell'],
    days: [
      {
        key: 'a',
        es: 'Empuje',
        en: 'Push',
        refs: ['db_bench_press', 'db_shoulder_press', 'lateral_raise', 'overhead_extension'],
      },
      { key: 'b', es: 'Tirón', en: 'Pull', refs: ['db_row', 'shrug', 'rear_delt_fly', 'db_curl'] },
      {
        key: 'c',
        es: 'Pierna y core',
        en: 'Legs & core',
        refs: ['goblet_squat', 'bulgarian_split_squat', 'lunge', 'plank'],
      },
    ],
  },
  {
    id: 'bodyweight_3',
    es: 'Peso corporal 3 días',
    en: 'Bodyweight 3 days',
    daysPerWeek: 3,
    levels: ['beginner', 'intermediate'],
    equipment: ['bodyweight'],
    days: [
      { key: 'a', es: 'Empuje', en: 'Push', refs: ['push_up', 'dip', 'bench_dip', 'plank'] },
      { key: 'b', es: 'Tirón', en: 'Pull', refs: ['pull_up', 'chin_up', 'hanging_leg_raise'] },
      {
        key: 'c',
        es: 'Pierna',
        en: 'Legs',
        refs: ['bulgarian_split_squat', 'lunge', 'crunch', 'side_plank'],
      },
    ],
  },
];
