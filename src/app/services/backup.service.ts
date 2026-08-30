import { Injectable, inject } from '@angular/core';
import { StateService } from './state.service';
import { StorageService } from './storage.service';
import { ApiKeyService } from './api-key.service';
import { TranslationService } from './translation.service';
import { STORAGE_KEYS } from './storage-keys';
import { buildBackup, parseBackup } from './backup-format';
import { MergeSummary, mergeStates } from './backup-merge';
import { APP_VERSION } from '../version';
import { AppState } from '../models/workout.model';

/** Qué hacer con el backup importado (RF-STO-05). */
export type ImportMode = 'merge' | 'replace';

export interface ImportOutcome {
  mode: ImportMode;
  /** Presente solo al fusionar: qué entró, qué ya estaba y qué hubo que renombrar. */
  summary?: MergeSummary;
  /** El backup venía del formato anterior, sin sobre ni checksum. */
  legacy: boolean;
  /** El archivo traía las keys de IA dentro (aviso de rotación, R-8). */
  includedCredentials: boolean;
}

/**
 * Exportación/importación de respaldos JSON. Separado de `StateService` para que el
 * estado no cargue con I/O de archivos ni con `navigator.share`/`<a download>` (SRP).
 */
@Injectable({ providedIn: 'root' })
export class BackupService {
  private readonly state = inject(StateService);
  private readonly storage = inject(StorageService);
  private readonly tr = inject(TranslationService);
  private readonly apiKeys = inject(ApiKeyService);

  /**
   * Exporta el estado. Las keys de IA quedan FUERA salvo pedido explícito: el archivo se
   * comparte por mensajería o se sube a la nube, y una credencial en texto plano ahí es
   * un problema del que el usuario no se entera (RF-STO-05b, `audit.md` R-8).
   */
  async exportData(opts: { includeCredentials?: boolean } = {}): Promise<void> {
    const includeCredentials = opts.includeCredentials === true;
    const envelope = buildBackup(this.state.state(), {
      appVersion: APP_VERSION,
      includeCredentials,
      // En claro y desde el vault: en el estado solo hay texto cifrado con una clave que no
      // sale de este dispositivo, así que copiar eso no restauraría nada en otro.
      credentials: includeCredentials
        ? { groq: this.apiKeys.get('groq'), cohere: this.apiKeys.get('cohere') }
        : undefined,
    });
    const fileName = `gym-backup-${this.storage.todayISO()}.json`;
    const file = new File([JSON.stringify(envelope, null, 2)], fileName, {
      type: 'application/json',
    });

    if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: 'GainAI backup' });
        localStorage.setItem(STORAGE_KEYS.lastExport, this.storage.todayISO());
        return;
      } catch (e) {
        // El usuario canceló el share: no es un error ni cuenta como export
        if (e instanceof DOMException && e.name === 'AbortError') return;
        // Otro fallo del share: cae al download clásico
      }
    }

    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
    localStorage.setItem(STORAGE_KEYS.lastExport, this.storage.todayISO());
  }

  /**
   * Importa un backup. `replace` sustituye todo; `merge` suma lo que falte sin pisar nada
   * de lo local ni duplicar sesiones ya registradas.
   *
   * Si el archivo no pasa la verificación, se lanza y **el estado actual queda intacto**:
   * nada se escribe hasta tener un estado válido en la mano (EA-5).
   */
  importData(mode: ImportMode = 'replace'): Promise<ImportOutcome | null> {
    return new Promise((resolve, reject) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'application/json';
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) {
          resolve(null);
          return;
        }
        try {
          resolve(this.applyBackup(await file.text(), mode));
        } catch (e) {
          reject(e);
        }
      };
      input.click();
    });
  }

  /** Verifica, valida y aplica el contenido de un backup. Separado para poder testearlo. */
  applyBackup(text: string, mode: ImportMode): ImportOutcome {
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new Error(this.tr.T().import_invalid_backup);
    }

    // 1. Sobre y checksum · 2. Esquema. Recién con las dos superadas se toca el estado.
    const parsed = parseBackup(raw);
    const imported = this.storage.validateImport(parsed.state);

    const outcome: ImportOutcome = {
      mode,
      legacy: parsed.legacy,
      includedCredentials: parsed.includesCredentials,
    };

    if (mode === 'replace') {
      this.state.state.set(imported);
      void this.adoptCredentials(imported);
      return outcome;
    }

    const { state, summary } = mergeStates(this.state.state(), imported);
    this.state.state.set(state);
    void this.adoptCredentials(imported);
    return { ...outcome, summary };
  }

  /**
   * Deja las keys utilizables tras importar.
   *
   * Dos casos, y los dos importan:
   *
   * - el backup TRAE keys en claro → se vuelven a cifrar con el vault de ESTE dispositivo y
   *   el texto plano sale del estado, que es la única forma de que una key sea portable sin
   *   quedar en claro para siempre;
   * - el backup NO trae keys → se re-sella la que ya tenía el usuario. En modo `replace` el
   *   estado importado no tiene credenciales, así que sin esto la key configurada aquí
   *   desaparecería al recargar por haber restaurado datos de entrenamiento.
   */
  private async adoptCredentials(imported: AppState): Promise<void> {
    const groq = imported.settings.apiKey?.trim() || this.apiKeys.get('groq');
    const cohere = imported.settings.cohereApiKey?.trim() || this.apiKeys.get('cohere');
    if (groq) await this.apiKeys.set('groq', groq);
    if (cohere) await this.apiKeys.set('cohere', cohere);
  }
}
