import { inject } from '@angular/core';
import { CanDeactivateFn } from '@angular/router';
import { UIStateService } from '../services/ui-state.service';

export const trainingGuard: CanDeactivateFn<unknown> = () => {
  const uiState = inject(UIStateService);
  if (!uiState.trainingActive()) return true;
  return uiState.requestTrainingExit();
};
