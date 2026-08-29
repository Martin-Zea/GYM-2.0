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
import { StorageEstimateInfo, StorageService } from '../../services/storage.service';
import { UIStateService } from '../../services/ui-state.service';
import { TranslationService } from '../../services/translation.service';
import { BackupService, ImportMode, ImportOutcome } from '../../services/backup.service';
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
  protected readonly importReport = signal('');
  /** Incluir las keys de IA en el export: apagado por defecto (RF-STO-05b). */
  protected readonly includeCredentials = signal(false);
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

  // ── Espacio usado y purga de historial (RF-STO-08) ──
  protected readonly storageInfo = signal<StorageEstimateInfo | null>(null);
  protected readonly purgeMonths = signal(12);
  protected readonly purgeReport = signal('');

  private async refreshStorageInfo(): Promise<void> {
    this.storageInfo.set(await this.storage.storageEstimate());
  }

  protected formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  /** Fecha de corte de la purga: hoy menos los meses elegidos. */
  private purgeCutoffISO(): string {
    const d = new Date();
    d.setMonth(d.getMonth() - this.purgeMonths());
    return d.toISOString().slice(0, 10);
  }

  protected async purgeHistory(): Promise<void> {
    const cutoff = this.purgeCutoffISO();
    const count = this.state.countSessionsBefore(cutoff);
    if (count === 0) {
      this.purgeReport.set(this.T().settings_purge_nothing);
      return;
    }
    // Purgar no pasa por la papelera: se avisa cuántas se van antes de tocarlas (G4).
    if (!window.confirm(this.tr.tp('settings_purge_confirm', { n: count, date: cutoff }))) return;

    const removed = this.state.purgeSessionsBefore(cutoff);
    this.purgeReport.set(this.tr.tp('settings_purge_done', { n: removed }));
    await this.refreshStorageInfo();
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
    void this.refreshStorageInfo();
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

  protected async importData(mode: ImportMode): Promise<void> {
    try {
      const outcome = await this.backup.importData(mode);
      this.importError.set('');
      this.importReport.set(outcome ? this.describeImport(outcome) : '');
    } catch (e) {
      this.importReport.set('');
      this.importError.set((e as Error).message || this.T().import_invalid_backup);
    }
  }

  protected exportData(): void {
    void this.backup.exportData({ includeCredentials: this.includeCredentials() });
  }

  /** Resumen de lo importado: el usuario tiene que ver qué entró y qué ya estaba (EA-5). */
  private describeImport(outcome: ImportOutcome): string {
    const t = this.T();
    const parts: string[] = [];

    if (outcome.summary) {
      const s = outcome.summary;
      parts.push(
        this.tr.tp('import_merge_report', {
          sessions: s.sessionsAdded,
          skipped: s.sessionsSkipped,
          exercises: s.exercisesAdded,
          days: s.daysAdded,
        }),
      );
      if (s.idsRemapped > 0) {
        parts.push(this.tr.tp('import_remapped', { n: s.idsRemapped }));
      }
    } else {
      parts.push(t.import_replace_report);
    }

    if (outcome.includedCredentials) parts.push(t.import_credentials_warning);
    return parts.join(' ');
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
