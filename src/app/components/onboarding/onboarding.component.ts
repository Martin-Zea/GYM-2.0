import { ChangeDetectionStrategy, Component, inject, output, signal } from '@angular/core';
import { TranslationService } from '../../services/translation.service';
import { IconComponent } from '../icon/icon.component';
import { TrainingGoal, TrainingLevel, UserProfile } from '../../models/workout.model';
import { Equipment } from '../../data/exercise-catalog';

/** Qué quiere hacer el usuario con su primera rutina (O6, RF-PER-03). */
export type FirstRoutineChoice = 'template' | 'ai' | 'manual' | 'later';

export interface OnboardingResult {
  profile: Partial<UserProfile>;
  units: 'kg' | 'lb';
  choice: FirstRoutineChoice;
  /** Días por semana elegidos; también se usa para filtrar plantillas. */
  daysPerWeek: number;
}

const SLIDE_COUNT = 8;

/**
 * Onboarding O1–O6 (RF-PER-01/02/03).
 *
 * Todos los pasos son omitibles menos las unidades: seguir adelante deja el campo en `null`,
 * que la app entiende como "no lo dijo" y no como un valor por defecto inventado. Quien solo
 * quiere entrenar llega al final en cinco taps.
 */
@Component({
  selector: 'app-onboarding',
  standalone: true,
  imports: [IconComponent],
  templateUrl: './onboarding.component.html',
  styleUrl: './onboarding.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OnboardingComponent {
  protected readonly T = inject(TranslationService).T;

  readonly done = output<OnboardingResult>();

  protected readonly slideCount = SLIDE_COUNT;
  protected readonly slideIndices = Array.from({ length: SLIDE_COUNT }, (_, i) => i);
  protected readonly current = signal(0);

  // O2 · perfil básico + unidades (lo único obligatorio)
  protected readonly units = signal<'kg' | 'lb'>('kg');
  protected readonly weightKg = signal<number | null>(null);
  protected readonly heightCm = signal<number | null>(null);
  protected readonly age = signal<number | null>(null);

  // O3 · nivel y objetivo
  protected readonly level = signal<TrainingLevel | null>(null);
  protected readonly goal = signal<TrainingGoal | null>(null);

  // O4 · equipo y días
  protected readonly equipment = signal<Equipment[]>([]);
  protected readonly daysPerWeek = signal(4);

  // O5 · lesiones y limitaciones
  protected readonly notes = signal('');

  protected readonly levels: TrainingLevel[] = ['beginner', 'intermediate', 'advanced'];
  protected readonly goals: TrainingGoal[] = ['strength', 'hypertrophy', 'endurance'];
  protected readonly equipmentOptions: Equipment[] = [
    'barbell',
    'dumbbell',
    'machine',
    'cable',
    'bodyweight',
    'band',
  ];

  protected levelLabel(level: TrainingLevel): string {
    const t = this.T();
    return level === 'beginner'
      ? t.profile_level_beginner
      : level === 'intermediate'
        ? t.profile_level_intermediate
        : t.profile_level_advanced;
  }

  protected goalLabel(goal: TrainingGoal): string {
    const t = this.T();
    return goal === 'strength'
      ? t.settings_goal_strength
      : goal === 'hypertrophy'
        ? t.settings_goal_hypertrophy
        : t.settings_goal_endurance;
  }

  protected equipmentLabel(eq: Equipment): string {
    return this.T()[`equipment_${eq}` as keyof ReturnType<typeof this.T>] as string;
  }

  protected toggleEquipment(eq: Equipment): void {
    this.equipment.update((list) =>
      list.includes(eq) ? list.filter((e) => e !== eq) : [...list, eq],
    );
  }

  protected setNumber(target: 'weightKg' | 'heightCm' | 'age', event: Event): void {
    const raw = (event.target as HTMLInputElement).value.trim();
    const num = Number(raw);
    const value = raw && Number.isFinite(num) && num > 0 ? num : null;
    if (target === 'weightKg') this.weightKg.set(value);
    else if (target === 'heightCm') this.heightCm.set(value);
    else this.age.set(value);
  }

  protected next(): void {
    if (this.current() < SLIDE_COUNT - 1) this.current.update((s) => s + 1);
  }

  protected back(): void {
    this.current.update((s) => Math.max(0, s - 1));
  }

  protected goTo(index: number): void {
    this.current.set(index);
  }

  /** Cierra el onboarding con lo que haya dicho, sea mucho o nada. */
  protected finish(choice: FirstRoutineChoice): void {
    const kgFactor = this.units() === 'lb' ? 0.45359237 : 1;
    const weight = this.weightKg();
    this.done.emit({
      profile: {
        // El peso se guarda SIEMPRE en kg: lb es solo cómo lo escribe el usuario (R-4)
        weightKg: weight !== null ? Math.round(weight * kgFactor * 10) / 10 : null,
        heightCm: this.heightCm(),
        age: this.age(),
        level: this.level(),
        goal: this.goal(),
        equipment: this.equipment().length ? this.equipment() : null,
        daysPerWeek: this.daysPerWeek(),
        aiNotes: this.notes().trim(),
      },
      units: this.units(),
      choice,
      daysPerWeek: this.daysPerWeek(),
    });
  }
}
