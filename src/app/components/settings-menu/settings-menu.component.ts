import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import { IconComponent } from '../icon/icon.component';
import { StateService } from '../../services/state.service';
import { TranslationService } from '../../services/translation.service';
import { UIStateService } from '../../services/ui-state.service';
import { ApiKeyService } from '../../services/api-key.service';
import { STORAGE_KEYS } from '../../services/storage-keys';
import {
  DEFAULT_TOKEN_BUDGET,
  totalTokens,
  usageForMonth,
} from '../../services/providers/ai-usage';

/**
 * A1 · menú de ajustes.
 *
 * Cada fila resume su propio estado (si la IA tiene key, si hay copia pendiente) porque el
 * valor del menú es que se vea de un vistazo lo que hace falta atender; una lista de seis
 * palabras sin contexto obliga a entrar en las seis.
 */
@Component({
  selector: 'app-settings-menu',
  standalone: true,
  imports: [IconComponent],
  templateUrl: './settings-menu.component.html',
  styleUrl: './settings-menu.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsMenuComponent {
  private readonly state = inject(StateService);
  protected readonly tr = inject(TranslationService);
  protected readonly T = this.tr.T;
  protected readonly uiState = inject(UIStateService);
  private readonly keys = inject(ApiKeyService);
  private readonly router = inject(Router);

  protected readonly profileSummary = computed(() => {
    const p = this.state.settings().userProfile;
    const parts: string[] = [];
    if (p.level) parts.push(p.level);
    if (p.goal) parts.push(p.goal);
    if (p.weightKg) parts.push(`${p.weightKg} kg`);
    return parts.length ? parts.join(' · ') : this.T().settings_menu_profile_empty;
  });

  protected readonly aiSummary = computed(() => {
    const s = this.state.settings();
    const hasKey = !!(
      this.keys.get('groq') ||
      s.apiKey ||
      this.keys.get('cohere') ||
      s.cohereApiKey
    );
    if (!hasKey) return this.T().settings_menu_no_key;
    const used = totalTokens(usageForMonth());
    const budget = s.aiTokenBudget ?? DEFAULT_TOKEN_BUDGET;
    return `${used} / ${budget}`;
  });

  /** Sesiones registradas desde la última exportación. */
  protected readonly backupPending = computed(() => {
    let last: string | null = null;
    try {
      last = localStorage.getItem(STORAGE_KEYS.lastExport);
    } catch {
      /* sin localStorage no se puede saber; se asume al día antes que alarmar en falso */
    }
    if (!last) return this.state.sessions().length > 0;
    return this.state.sessions().some((s) => s.dateISO > last);
  });

  protected openProfile(): void {
    void this.router.navigate(['/profile']);
  }
}
