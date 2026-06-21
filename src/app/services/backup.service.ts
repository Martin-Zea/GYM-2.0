import { Injectable, inject } from '@angular/core';
import { StateService } from './state.service';
import { StorageService, isValidAppState } from './storage.service';
import { TranslationService } from './translation.service';
import { STORAGE_KEYS } from './storage-keys';

/**
 * Exportación/importación de respaldos JSON. Separado de `StateService` para que el
 * estado no cargue con I/O de archivos ni con `navigator.share`/`<a download>` (SRP).
 */
@Injectable({ providedIn: 'root' })
export class BackupService {
  private readonly state = inject(StateService);
  private readonly storage = inject(StorageService);
  private readonly tr = inject(TranslationService);

  async exportData(): Promise<void> {
    const exportState = {
      ...this.state.state(),
      exportedAt: new Date().toISOString(),
      appVersion: '2.0',
    };
    const fileName = `gym-backup-${this.storage.todayISO()}.json`;
    const file = new File([JSON.stringify(exportState, null, 2)], fileName, {
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

  importData(): Promise<void> {
    return new Promise((resolve, reject) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'application/json';
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) {
          resolve();
          return;
        }
        const invalidMsg = this.tr.T().import_invalid_backup;
        try {
          const text = await file.text();
          let data: unknown;
          try {
            data = JSON.parse(text);
          } catch {
            throw new Error(invalidMsg);
          }
          if (!isValidAppState(data)) throw new Error(invalidMsg);
          this.state.state.set(this.storage.validateImport(data));
          resolve();
        } catch (e) {
          reject(e);
        }
      };
      input.click();
    });
  }
}
