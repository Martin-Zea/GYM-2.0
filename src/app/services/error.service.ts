import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class ErrorService {
  readonly lastError = signal<{ message: string; when: string } | null>(null);

  report(err: unknown): void {
    if (this.lastError() !== null) return;
    const message = err instanceof Error ? err.message : String(err);
    this.lastError.set({ message, when: new Date().toISOString() });
  }
}
