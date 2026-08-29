import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnDestroy,
  signal,
} from '@angular/core';
import { IconComponent } from '../icon/icon.component';
import { StateService } from '../../services/state.service';
import { StorageService } from '../../services/storage.service';
import { UIStateService } from '../../services/ui-state.service';
import { TranslationService } from '../../services/translation.service';
import { ShareService } from '../../services/share.service';
import { TrainingGoal, UserProfile, WeightLogEntry } from '../../models/workout.model';

interface PrRecord {
  exerciseName: string;
  weight: number;
  reps: number;
  unit: string;
  dateISO: string;
}

const EXCLUDED_UNITS = new Set(['TIME', 'BODYWEIGHT']);
const PAST_LOG_LIMIT = 3;

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [IconComponent],
  templateUrl: './profile.component.html',
  styleUrl: './profile.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProfileComponent implements OnDestroy {
  protected readonly stateService = inject(StateService);
  private readonly storage = inject(StorageService);
  protected readonly uiState = inject(UIStateService);
  protected readonly tr = inject(TranslationService);
  protected readonly T = this.tr.T;
  private readonly shareService = inject(ShareService);

  protected readonly profile = computed(() => this.stateService.settings().userProfile);

  // ── Registro de peso corporal (editable aquí; antes vivía en Ajustes) ──

  protected readonly weightLogDesc = computed(() =>
    [...this.profile().weightLog].sort((a, b) => b.dateISO.localeCompare(a.dateISO)),
  );

  protected readonly todayEntry = computed(
    () => this.weightLogDesc().find((e) => e.dateISO === this.stateService.todayKey) ?? null,
  );

  // Tope fijo: las correcciones reales son siempre recientes; un dato viejo errado
  // es ruido de tendencia.
  protected readonly pastLogDisplayed = computed(() =>
    this.weightLogDesc()
      .filter((e) => e.dateISO !== this.stateService.todayKey)
      .slice(0, PAST_LOG_LIMIT),
  );

  protected readonly undoEntry = signal<WeightLogEntry | null>(null);
  private undoTimer: ReturnType<typeof setTimeout> | null = null;

  ngOnDestroy(): void {
    if (this.undoTimer) clearTimeout(this.undoTimer);
  }

  protected readonly weightSummary = computed(() => {
    const log = [...this.profile().weightLog].sort((a, b) => a.dateISO.localeCompare(b.dateISO));
    if (!log.length) return null;
    const last = log[log.length - 1];
    if (log.length < 2) return { last: last.weightKg, delta: null, days: null };
    const first = log[0];
    const diff = last.weightKg - first.weightKg;
    const abs = Math.abs(diff);
    const delta = (diff < 0 ? '−' : '+') + (Number.isInteger(abs) ? String(abs) : abs.toFixed(1));
    const d1 = new Date(first.dateISO + 'T12:00:00Z');
    const d2 = new Date(last.dateISO + 'T12:00:00Z');
    const days = Math.round((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));
    return { last: last.weightKg, delta, days };
  });

  private patchProfile(p: Partial<UserProfile>): void {
    const s = this.stateService.settings();
    this.stateService.saveSettings({ ...s, userProfile: { ...s.userProfile, ...p } });
  }

  protected saveTodayWeight(event: Event): void {
    const val = (event.target as HTMLInputElement).value;
    const num = val === '' ? null : Number(val);
    if (num === null || isNaN(num) || num <= 0) return;
    const today = this.stateService.todayKey;
    const weightLog = [
      ...this.profile().weightLog.filter((e) => e.dateISO !== today),
      { dateISO: today, weightKg: num },
    ];
    this.patchProfile({ weightKg: num, weightLog });
  }

  protected updateWeightEntry(dateISO: string, event: Event): void {
    const val = (event.target as HTMLInputElement).value;
    const num = val === '' ? null : Number(val);
    if (num === null || isNaN(num) || num <= 0) return;
    const updated = this.profile().weightLog.map((e) =>
      e.dateISO === dateISO ? { ...e, weightKg: num } : e,
    );
    const sorted = [...updated].sort((a, b) => a.dateISO.localeCompare(b.dateISO));
    this.patchProfile({ weightKg: sorted[sorted.length - 1].weightKg, weightLog: updated });
  }

  protected deleteWeightEntry(dateISO: string): void {
    const entry = this.profile().weightLog.find((e) => e.dateISO === dateISO);
    if (!entry) return;
    const filtered = this.profile().weightLog.filter((e) => e.dateISO !== dateISO);
    const sorted = [...filtered].sort((a, b) => a.dateISO.localeCompare(b.dateISO));
    const weightKg = sorted.length ? sorted[sorted.length - 1].weightKg : null;
    this.patchProfile({ weightKg, weightLog: filtered });
    if (this.undoTimer) clearTimeout(this.undoTimer);
    this.undoEntry.set(entry);
    this.undoTimer = setTimeout(() => this.undoEntry.set(null), 3000);
  }

  protected undoDelete(): void {
    const entry = this.undoEntry();
    if (!entry) return;
    if (this.undoTimer) clearTimeout(this.undoTimer);
    const existing = this.profile().weightLog;
    const restored = [...existing.filter((e) => e.dateISO !== entry.dateISO), entry];
    const sorted = [...restored].sort((a, b) => a.dateISO.localeCompare(b.dateISO));
    this.patchProfile({ weightKg: sorted[sorted.length - 1].weightKg, weightLog: restored });
    this.undoEntry.set(null);
  }

  protected formatLogDate(dateISO: string): string {
    return `${dateISO.slice(8, 10)}/${dateISO.slice(5, 7)}/${dateISO.slice(2, 4)}`;
  }

  // ── Datos personales ──

  protected patchProfileNum(key: 'heightCm' | 'age', event: Event): void {
    const val = (event.target as HTMLInputElement).value;
    const num = val === '' ? null : Number(val);
    this.patchProfile({ [key]: num } as Partial<UserProfile>);
  }

  protected patchProfileSex(event: Event): void {
    const val = (event.target as HTMLSelectElement).value;
    this.patchProfile({ sex: (val || null) as UserProfile['sex'] });
  }

  // ── Objetivo y notas para la IA ──

  protected setGoal(goal: TrainingGoal | null): void {
    this.patchProfile({ goal });
  }

  protected patchAiNotes(event: Event): void {
    this.patchProfile({ aiNotes: (event.target as HTMLTextAreaElement).value.slice(0, 200) });
  }

  // ── Récords personales ──

  protected readonly achievements = computed<PrRecord[]>(() => {
    const s = this.stateService.state();
    const results: PrRecord[] = [];

    // Recorre el catálogo: incluye PRs de ejercicios archivados (ya no en ninguna rutina).
    for (const ex of s.exercises) {
      if (EXCLUDED_UNITS.has(ex.unit)) continue;
      const history = this.storage.historyForExercise(s, ex.id);
      if (!history.length) continue;
      let best = history[0];
      for (const entry of history) {
        if (entry.topWeight > best.topWeight) best = entry;
      }
      if (best.topWeight <= 0) continue;
      results.push({
        exerciseName: ex.name,
        weight: best.topWeight,
        reps: best.topReps,
        unit: ex.unit,
        dateISO: best.dateISO,
      });
    }

    return results.sort((a, b) => b.weight - a.weight);
  });

  protected formatDate(iso: string): string {
    const d = new Date(iso + 'T12:00:00Z');
    return new Intl.DateTimeFormat(this.tr.lang(), {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    }).format(d);
  }

  protected sharePr(pr: PrRecord): void {
    void this.shareService.share(pr.exerciseName, pr.weight, pr.unit, pr.dateISO);
  }
}
