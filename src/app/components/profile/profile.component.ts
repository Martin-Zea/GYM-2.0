import { Component, computed, inject } from '@angular/core';
import { IconComponent } from '../icon/icon.component';
import { StateService } from '../../services/state.service';
import { StorageService } from '../../services/storage.service';
import { UIStateService } from '../../services/ui-state.service';
import { TranslationService } from '../../services/translation.service';
import { ShareService } from '../../services/share.service';

interface PrRecord {
  exerciseName: string;
  weight: number;
  unit: string;
  dateISO: string;
}

const EXCLUDED_UNITS = new Set(['tiempo', 'peso corporal']);

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [IconComponent],
  templateUrl: './profile.component.html',
  styleUrl: './profile.component.scss',
})
export class ProfileComponent {
  protected readonly stateService = inject(StateService);
  private readonly storage = inject(StorageService);
  protected readonly uiState = inject(UIStateService);
  protected readonly tr = inject(TranslationService);
  protected readonly T = this.tr.T;
  private readonly shareService = inject(ShareService);

  protected readonly profile = computed(() => this.stateService.settings().userProfile);

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

  protected readonly achievements = computed<PrRecord[]>(() => {
    const s = this.stateService.state();
    const results: PrRecord[] = [];

    for (const day of s.days) {
      for (const ex of day.exercises) {
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
          unit: ex.unit,
          dateISO: best.dateISO,
        });
      }
    }

    return results.sort((a, b) => b.dateISO.localeCompare(a.dateISO));
  });

  protected formatDate(iso: string): string {
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
  }

  protected sharePr(pr: PrRecord): void {
    void this.shareService.share(pr.exerciseName, pr.weight, pr.unit, pr.dateISO);
  }

  protected openSettings(): void {
    this.uiState.openSettings();
  }

  protected sexLabel(sex: string | null): string {
    const t = this.T();
    switch (sex) {
      case 'male':
        return t.settings_sex_male;
      case 'female':
        return t.settings_sex_female;
      case 'other':
        return t.settings_sex_other;
      default:
        return t.profile_no_data;
    }
  }
}
