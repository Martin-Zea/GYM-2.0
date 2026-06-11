import { ErrorHandler, Injectable, Injector, inject } from '@angular/core';
import { UIStateService } from './ui-state.service';
import { TranslationService } from './translation.service';

/**
 * ErrorHandler global: loguea el error completo en consola (debugging)
 * y muestra al usuario solo un mensaje genérico i18n vía UIStateService.appError.
 */
@Injectable()
export class GlobalErrorHandler implements ErrorHandler {
  // Injector lazy: ErrorHandler se instancia antes que el resto de la app
  private readonly injector = inject(Injector);

  handleError(error: unknown): void {
    console.error(error);
    try {
      const uiState = this.injector.get(UIStateService);
      // Si ya hay un error visible, no re-setear (evita loops de errores en cascada)
      if (uiState.appError() !== null) return;
      const tr = this.injector.get(TranslationService);
      uiState.appError.set(tr.T().app_error_generic);
    } catch {
      // el handler de errores nunca debe lanzar su propio error
    }
  }
}
