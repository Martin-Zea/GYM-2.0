import { inject } from '@angular/core';
import { CanDeactivateFn } from '@angular/router';
import { UIStateService } from '../services/ui-state.service';
import { StateService } from '../services/state.service';

export const trainingGuard: CanDeactivateFn<unknown> = () => {
  const uiState = inject(UIStateService);
  const state = inject(StateService);
  if (!uiState.trainingActive()) return true;

  // Sin series marcadas no hay nada que proteger: navegar libremente (la sesión
  // sigue activa y se retoma al volver). Confirmar solo cuando hay progreso real.
  const day = state.activeDay();
  const hasProgress =
    !!day &&
    Object.values(state.getTodayProgress(day.id).sets).some((arr) => arr.some((s) => s?.done));
  if (!hasProgress) return true;

  return uiState.requestTrainingExit();
};
