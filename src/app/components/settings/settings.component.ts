import { Component, computed, inject, signal } from '@angular/core';
import { IconComponent } from '../icon/icon.component';
import { StateService } from '../../services/state.service';
import { UIStateService } from '../../services/ui-state.service';
import { TranslationService } from '../../services/translation.service';
import { AppSettings, UserProfile } from '../../models/workout.model';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [IconComponent],
  templateUrl: './settings.component.html',
  styleUrl: './settings.component.scss',
})
export class SettingsComponent {
  protected readonly state = inject(StateService);
  protected readonly uiState = inject(UIStateService);
  protected readonly tr = inject(TranslationService);
  protected readonly T = this.tr.T;

  protected readonly showApiKey = signal(false);
  protected readonly showCohereKey = signal(false);
  protected readonly importError = signal('');
  protected readonly resetConfirm = signal(false);
  protected readonly resetInput = signal('');

  protected readonly settings = computed(() => this.state.settings());

  protected close(): void {
    this.uiState.showSettings.set(false);
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
    this.patchProfile({ [key]: val === '' ? null : Number(val) } as Partial<UserProfile>);
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
    this.uiState.showSettings.set(false);
  }
}
