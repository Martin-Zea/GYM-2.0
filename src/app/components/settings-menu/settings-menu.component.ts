import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { IconComponent } from '../icon/icon.component';
import { SettingsComponent } from '../settings/settings.component';
import { ViewportService } from '../../services/viewport.service';
import { SettingsSection } from '../../services/ui-state.service';
import { DEFAULT_DESKTOP_VIEW } from '../bottom-nav/nav-items';
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
  imports: [IconComponent, SettingsComponent],
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
  private readonly route = inject(ActivatedRoute);
  protected readonly viewport = inject(ViewportService);

  constructor() {
    // La sección vive en la URL, igual que el resto de sub-vistas: la columna de sección
    // enlaza a cada una y `uiState.settingsSection` sigue siendo quien decide qué se pinta,
    // así que sheet y página comparten mecanismo en vez de tener uno cada uno.
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      const fallback = DEFAULT_DESKTOP_VIEW['/settings'];
      const vista = params.get('vista') ?? fallback;
      const valid: string[] = ['prefs', 'ai', 'data', 'about'];
      // Un valor inventado en la URL cae en el defecto, no en "enséñalo todo": con `null`
      // la página pintaba las cuatro secciones seguidas y ninguna fila quedaba marcada.
      this.uiState.settingsSection.set(
        (valid.includes(vista) ? vista : fallback) as SettingsSection,
      );
    });
  }

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
