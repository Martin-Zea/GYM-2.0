import { Component, HostListener, computed, inject, signal } from '@angular/core';
import { IconComponent } from '../icon/icon.component';
import { FocusTrapDirective } from '../../directives/focus-trap.directive';
import { StateService } from '../../services/state.service';
import { UIStateService } from '../../services/ui-state.service';
import { TranslationService } from '../../services/translation.service';
import { AppSettings, UserProfile } from '../../models/workout.model';
import { APP_VERSION } from '../../version';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [IconComponent, FocusTrapDirective],
  templateUrl: './settings.component.html',
  styleUrl: './settings.component.scss',
})
export class SettingsComponent {
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

  /** Resumen bajo el input de peso: medición anterior y delta vs. la última */
  protected readonly weightSummary = computed(() => {
    const log = [...this.settings().userProfile.weightLog]
      .sort((a, b) => a.dateISO.localeCompare(b.dateISO));
    if (log.length < 2) return null;
    const prev = log[log.length - 2];
    const last = log[log.length - 1];
    const diff = last.weightKg - prev.weightKg;
    const abs = Math.abs(diff);
    const delta = (diff < 0 ? '−' : '+') + (Number.isInteger(abs) ? String(abs) : abs.toFixed(1));
    return {
      prevWeight: prev.weightKg,
      delta,
      date: `${prev.dateISO.slice(8, 10)}/${prev.dateISO.slice(5, 7)}`,
    };
  });

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

  protected patchProfileNum(key: 'weightKg' | 'heightCm' | 'age', event: Event): void {
    const val = (event.target as HTMLInputElement).value;
    const num = val === '' ? null : Number(val);
    if (key === 'weightKg' && num !== null && !Number.isNaN(num)) {
      // Upsert de la entrada de hoy en weightLog: nunca dos entradas del mismo día
      const today = this.state.todayKey;
      const weightLog = [
        ...this.settings().userProfile.weightLog.filter(e => e.dateISO !== today),
        { dateISO: today, weightKg: num },
      ];
      this.patchProfile({ weightKg: num, weightLog });
      return;
    }
    this.patchProfile({ [key]: num } as Partial<UserProfile>);
  }

  protected patchProfileSex(event: Event): void {
    const val = (event.target as HTMLSelectElement).value;
    this.patchProfile({ sex: (val || null) as UserProfile['sex'] });
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
