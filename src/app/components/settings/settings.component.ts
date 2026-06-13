import { Component, HostListener, OnDestroy, computed, inject, signal } from '@angular/core';
import { IconComponent } from '../icon/icon.component';
import { FocusTrapDirective } from '../../directives/focus-trap.directive';
import { StateService } from '../../services/state.service';
import { UIStateService } from '../../services/ui-state.service';
import { TranslationService } from '../../services/translation.service';
import { AppSettings, UserProfile, WeightLogEntry } from '../../models/workout.model';
import { APP_VERSION } from '../../version';

const PAST_LOG_LIMIT = 3;

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [IconComponent, FocusTrapDirective],
  templateUrl: './settings.component.html',
  styleUrl: './settings.component.scss',
})
export class SettingsComponent implements OnDestroy {
  protected readonly state = inject(StateService);
  protected readonly uiState = inject(UIStateService);
  protected readonly tr = inject(TranslationService);
  protected readonly T = this.tr.T;

  protected readonly appVersion = APP_VERSION;
  protected readonly showApiKey = signal(false);
  protected readonly showCohereKey = signal(false);
  protected readonly importError = signal('');
  protected readonly resetConfirm = signal(false);
  protected readonly resetInput = signal('');

  protected readonly settings = computed(() => this.state.settings());

  protected readonly weightLogDesc = computed(() =>
    [...this.settings().userProfile.weightLog].sort((a, b) => b.dateISO.localeCompare(a.dateISO)),
  );

  protected readonly todayEntry = computed(
    () => this.weightLogDesc().find((e) => e.dateISO === this.state.todayKey) ?? null,
  );

  // Tope fijo: las correcciones reales son siempre recientes; un dato viejo errado
  // es ruido de tendencia. Sin "ver más" — Ajustes se mantiene corto.
  protected readonly pastLogDisplayed = computed(() =>
    this.weightLogDesc()
      .filter((e) => e.dateISO !== this.state.todayKey)
      .slice(0, PAST_LOG_LIMIT),
  );

  protected readonly undoEntry = signal<WeightLogEntry | null>(null);
  private undoTimer: ReturnType<typeof setTimeout> | null = null;

  ngOnDestroy(): void {
    if (this.undoTimer) clearTimeout(this.undoTimer);
  }

  @HostListener('document:keydown.escape')
  protected close(): void {
    this.uiState.closeSettings();
  }

  protected patch(p: Partial<AppSettings>): void {
    this.state.saveSettings({ ...this.settings(), ...p });
  }

  protected patchDefaultRest(event: Event): void {
    this.patch({ defaultRest: Number((event.target as HTMLInputElement).value) });
  }

  protected patchApiKey(event: Event): void {
    this.patch({ apiKey: (event.target as HTMLInputElement).value });
  }

  protected patchCohereApiKey(event: Event): void {
    this.patch({ cohereApiKey: (event.target as HTMLInputElement).value });
  }

  protected patchProfileNum(key: 'heightCm' | 'age', event: Event): void {
    const val = (event.target as HTMLInputElement).value;
    const num = val === '' ? null : Number(val);
    this.patchProfile({ [key]: num } as Partial<UserProfile>);
  }

  protected patchProfileSex(event: Event): void {
    const val = (event.target as HTMLSelectElement).value;
    this.patchProfile({ sex: (val || null) as UserProfile['sex'] });
  }

  protected saveTodayWeight(event: Event): void {
    const val = (event.target as HTMLInputElement).value;
    const num = val === '' ? null : Number(val);
    if (num === null || isNaN(num) || num <= 0) return;
    const today = this.state.todayKey;
    const weightLog = [
      ...this.settings().userProfile.weightLog.filter((e) => e.dateISO !== today),
      { dateISO: today, weightKg: num },
    ];
    this.patchProfile({ weightKg: num, weightLog });
  }

  protected updateWeightEntry(dateISO: string, event: Event): void {
    const val = (event.target as HTMLInputElement).value;
    const num = val === '' ? null : Number(val);
    if (num === null || isNaN(num) || num <= 0) return;
    const updated = this.settings().userProfile.weightLog.map((e) =>
      e.dateISO === dateISO ? { ...e, weightKg: num } : e,
    );
    const sorted = [...updated].sort((a, b) => a.dateISO.localeCompare(b.dateISO));
    this.patchProfile({ weightKg: sorted[sorted.length - 1].weightKg, weightLog: updated });
  }

  protected deleteWeightEntry(dateISO: string): void {
    const entry = this.settings().userProfile.weightLog.find((e) => e.dateISO === dateISO);
    if (!entry) return;
    const filtered = this.settings().userProfile.weightLog.filter((e) => e.dateISO !== dateISO);
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
    const existing = this.settings().userProfile.weightLog;
    const restored = [...existing.filter((e) => e.dateISO !== entry.dateISO), entry];
    const sorted = [...restored].sort((a, b) => a.dateISO.localeCompare(b.dateISO));
    this.patchProfile({ weightKg: sorted[sorted.length - 1].weightKg, weightLog: restored });
    this.undoEntry.set(null);
  }

  protected formatLogDate(dateISO: string): string {
    return `${dateISO.slice(8, 10)}/${dateISO.slice(5, 7)}/${dateISO.slice(2, 4)}`;
  }

  private patchProfile(p: Partial<UserProfile>): void {
    const s = this.settings();
    this.state.saveSettings({ ...s, userProfile: { ...s.userProfile, ...p } });
  }

  protected async importData(): Promise<void> {
    try {
      await this.state.importData();
      this.importError.set('');
    } catch (e) {
      this.importError.set((e as Error).message ?? 'Error al importar');
    }
  }

  protected openResetConfirm(): void {
    this.resetConfirm.set(true);
    this.resetInput.set('');
  }

  protected cancelReset(): void {
    this.resetConfirm.set(false);
    this.resetInput.set('');
  }

  protected confirmReset(): void {
    if (this.resetInput() !== this.T().settings_reset_word) return;
    this.state.resetAll();
    this.uiState.closeSettings();
  }
}
