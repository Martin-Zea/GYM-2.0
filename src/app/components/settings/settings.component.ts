import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { IconComponent } from '../icon/icon.component';
import { FocusTrapDirective } from '../../directives/focus-trap.directive';
import { StateService } from '../../services/state.service';
import { StorageService } from '../../services/storage.service';
import { UIStateService } from '../../services/ui-state.service';
import { TranslationService } from '../../services/translation.service';
import { BackupService } from '../../services/backup.service';
import { AiShadowLogService } from '../../services/ai-shadow-log.service';
import { AppSettings } from '../../models/workout.model';
import { DEFAULT_BAR_KG, DEFAULT_PLATES_KG } from '../../utils/plates';
import { APP_VERSION } from '../../version';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [IconComponent, FocusTrapDirective],
  templateUrl: './settings.component.html',
  styleUrl: './settings.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsComponent implements OnInit {
  protected readonly state = inject(StateService);
  private readonly storage = inject(StorageService);
  protected readonly uiState = inject(UIStateService);
  protected readonly tr = inject(TranslationService);
  protected readonly backup = inject(BackupService);
  protected readonly shadowLog = inject(AiShadowLogService);
  protected readonly T = this.tr.T;

  protected readonly appVersion = APP_VERSION;
  protected readonly showApiKey = signal(false);
  protected readonly showCohereKey = signal(false);
  protected readonly importError = signal('');
  protected readonly resetConfirm = signal(false);
  protected readonly resetInput = signal('');

  protected readonly settings = computed(() => this.state.settings());

  // ── Calculadora de discos ──
  protected readonly barWeight = computed(() => this.settings().barWeightKg ?? DEFAULT_BAR_KG);
  protected readonly platesCsv = computed(() =>
    (this.settings().platesKg ?? DEFAULT_PLATES_KG).join(', '),
  );

  protected patchBarWeight(event: Event): void {
    const num = Number((event.target as HTMLInputElement).value);
    if (isNaN(num) || num <= 0) return;
    this.patch({ barWeightKg: num });
  }

  protected patchPlates(event: Event): void {
    const raw = (event.target as HTMLInputElement).value;
    const plates = raw
      .split(/[,;]/)
      .map((p) => Number(p.trim().replace(',', '.')))
      .filter((n) => !isNaN(n) && n > 0);
    if (plates.length) this.patch({ platesKg: plates });
  }

  // ── Copias automáticas (snapshots en IndexedDB) ──
  protected readonly snapshots = signal<string[]>([]);
  protected readonly snapshotRestored = signal(false);

  private async refreshSnapshots(): Promise<void> {
    this.snapshots.set(await this.storage.listSnapshots());
  }

  protected async restoreSnapshot(key: string): Promise<void> {
    const msg = this.tr.tp('settings_snapshot_restore_confirm', { date: key });
    if (!window.confirm(msg)) return;
    const snap = await this.storage.getSnapshot(key);
    if (!snap) return;
    this.state.state.set(snap);
    this.snapshotRestored.set(true);
    setTimeout(() => this.snapshotRestored.set(false), 3000);
  }

  // ── Papelera de sesiones ──
  protected readonly trash = computed(() => [...(this.state.state().trash ?? [])].reverse());

  protected trashLabel(dateISO: string): string {
    return `${dateISO.slice(8, 10)}/${dateISO.slice(5, 7)}/${dateISO.slice(2, 4)}`;
  }

  protected dayNameFor(dayId: string): string {
    return this.state.days().find((d) => d.id === dayId)?.name ?? '—';
  }

  ngOnInit(): void {
    void this.refreshSnapshots();
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


  protected async importData(): Promise<void> {
    try {
      await this.backup.importData();
      this.importError.set('');
    } catch (e) {
      this.importError.set((e as Error).message || this.T().import_invalid_backup);
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
