import { inject } from '@angular/core';
import { CanDeactivateFn } from '@angular/router';
import { UIStateService } from '../services/ui-state.service';
import { TranslationService } from '../services/translation.service';

export const trainingGuard: CanDeactivateFn<unknown> = () => {
  const uiState = inject(UIStateService);
  if (!uiState.trainingActive()) return true;
  const tr = inject(TranslationService);
  return window.confirm(tr.T().nav_guard_confirm);
};
