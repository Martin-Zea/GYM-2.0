import { ErrorHandler, Injectable, Injector, inject } from '@angular/core';
import { ErrorService } from './error.service';

@Injectable()
export class GlobalErrorHandler implements ErrorHandler {
  private readonly injector = inject(Injector);

  handleError(error: unknown): void {
    console.error(error);
    try {
      this.injector.get(ErrorService).report(error);
    } catch {
      // never throw inside an error handler
    }
  }
}
