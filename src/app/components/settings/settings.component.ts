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
import { AiProviderName, ApiKeyService } from '../../services/api-key.service';
import { KeyVault } from '../../services/crypto-keys';
import {
  DEFAULT_TOKEN_BUDGET,
  totalTokens,
  usageForMonth,
} from '../../services/providers/ai-usage';
import { AiShadowLogService } from '../../services/ai-shadow-log.service';
import { AiFeedbackAction, AiFeedbackEntry, AppSettings } from '../../models/workout.model';
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
  private readonly apiKeys = inject(ApiKeyService);
  protected readonly shadowLog = inject(AiShadowLogService);
  protected readonly T = this.tr.T;

  protected readonly appVersion = APP_VERSION;
  /** Sección pedida desde el menú A1; `null` = todas. */
  protected shows(section: 'prefs' | 'ai' | 'data' | 'about'): boolean {
    const active = this.uiState.settingsSection();
    return active === null || active === section;
  }

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

  // ── A5 · Preferencias y A6/A7 (RF-PWA-03/04, RF-HER-01) ──

  protected readonly appVersionLabel = APP_VERSION;
  protected readonly notificationState = signal<'default' | 'granted' | 'denied' | 'unsupported'>(
    typeof Notification === 'undefined'
      ? 'unsupported'
      : (Notification.permission as 'default' | 'granted' | 'denied'),
  );

  protected openTools(): void {
    this.uiState.closeSettings();
    this.uiState.openTools();
  }

  protected patchUnits(units: 'kg' | 'lb'): void {
    this.patch({ units });
  }

  /**
   * Pide permiso de notificaciones desde un gesto explícito (RF-PWA-03).
   *
   * Pedirlo al arrancar es la forma más rápida de que lo denieguen para siempre: aquí el
   * usuario ya sabe para qué es.
   */
  protected async requestNotifications(): Promise<void> {
    if (typeof Notification === 'undefined') return;
    try {
      const result = await Notification.requestPermission();
      this.notificationState.set(result as 'default' | 'granted' | 'denied');
    } catch {
      /* el navegador no lo permite en este contexto */
    }
  }

  // ── Catálogo de ejercicios (RF-EJ-03) ──

  protected readonly catalogList = computed(() =>
    [...this.state.exercises()].sort((a, b) => a.name.localeCompare(b.name)),
  );

  protected toggleArchived(exerciseId: string, archived: boolean): void {
    this.state.setExerciseArchived(exerciseId, archived);
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

  // ── Keys, modelos y presupuesto (A3, RF-IA-07/08/09) ──

  protected readonly vaultAvailable = inject(KeyVault).available;
  protected readonly testResult = signal<Partial<Record<AiProviderName, string>>>({});

  protected keyValue(provider: AiProviderName): string {
    return this.apiKeys.get(provider);
  }

  protected saveKey(provider: AiProviderName, event: Event): void {
    void this.apiKeys.set(provider, (event.target as HTMLInputElement).value);
    this.testResult.update((r) => ({ ...r, [provider]: undefined }));
  }

  protected async testConnection(provider: AiProviderName): Promise<void> {
    this.testResult.update((r) => ({ ...r, [provider]: 'testing' }));
    const res = await this.apiKeys.testConnection(provider);
    this.testResult.update((r) => ({ ...r, [provider]: res.ok ? 'ok' : res.reason }));
  }

  protected connectionLabel(result: string): string {
    const t = this.T();
    switch (result) {
      case 'testing':
        return t.settings_test_testing;
      case 'ok':
        return t.settings_test_ok;
      case 'auth':
        return t.settings_test_auth;
      case 'empty':
        return t.settings_test_empty;
      case 'model':
        return t.settings_test_model;
      case 'network':
        return t.settings_test_network;
      default:
        return t.settings_test_other;
    }
  }

  /**
   * Modelos que la key puede usar, preguntados al proveedor (T-808).
   *
   * Vacío hasta que el usuario lo pide: es una llamada de red y no tiene por qué salir sola
   * al abrir Ajustes.
   */
  protected readonly models = signal<Record<AiProviderName, string[]>>({ groq: [], cohere: [] });
  protected readonly loadingModels = signal<AiProviderName | null>(null);
  protected readonly modelsEmpty = signal<AiProviderName | null>(null);

  protected async loadModels(provider: AiProviderName): Promise<void> {
    if (this.loadingModels()) return;
    this.loadingModels.set(provider);
    this.modelsEmpty.set(null);
    try {
      const list = await this.apiKeys.listModels(provider);
      this.models.update((m) => ({ ...m, [provider]: list }));
      if (!list.length) this.modelsEmpty.set(provider);
    } finally {
      this.loadingModels.set(null);
    }
  }

  protected selectModel(provider: AiProviderName, event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.patch(
      provider === 'groq' ? { groqModel: value || undefined } : { cohereModel: value || undefined },
    );
  }

  protected patchModel(provider: AiProviderName, event: Event): void {
    const value = (event.target as HTMLInputElement).value.trim();
    this.patch(
      provider === 'groq' ? { groqModel: value || undefined } : { cohereModel: value || undefined },
    );
  }

  protected readonly tokenBudget = computed(
    () => this.settings().aiTokenBudget ?? DEFAULT_TOKEN_BUDGET,
  );
  protected readonly usedTokens = computed(() => {
    this.state.state();
    return totalTokens(usageForMonth());
  });
  protected readonly overBudget = computed(() => this.usedTokens() >= this.tokenBudget());

  /** C3: historial de sugerencias y qué se hizo con cada una (RF-IA-05). */
  protected readonly aiHistory = computed(() =>
    [...(this.state.state().aiFeedback ?? [])].reverse().slice(0, 15),
  );

  protected feedbackLabel(action: AiFeedbackAction): string {
    const t = this.T();
    return action === 'accepted'
      ? t.ai_feedback_accepted
      : action === 'rejected'
        ? t.ai_feedback_rejected
        : t.ai_feedback_modified;
  }

  protected suggestionLabel(entry: AiFeedbackEntry): string {
    const s = entry.suggested;
    return s ? `${s.weight}×${s.reps}` : '—';
  }

  protected patchBudget(event: Event): void {
    const n = Number((event.target as HTMLInputElement).value);
    if (!Number.isFinite(n) || n < 0) return;
    this.patch({ aiTokenBudget: n });
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
