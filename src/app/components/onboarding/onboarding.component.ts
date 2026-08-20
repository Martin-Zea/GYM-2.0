import { ChangeDetectionStrategy, Component, inject, output, signal } from '@angular/core';
import { TranslationService } from '../../services/translation.service';
import { IconComponent } from '../icon/icon.component';

const SLIDE_COUNT = 4;

@Component({
  selector: 'app-onboarding',
  standalone: true,
  imports: [IconComponent],
  templateUrl: './onboarding.component.html',
  styleUrl: './onboarding.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OnboardingComponent {
  protected readonly T = inject(TranslationService).T;

  /** Emite la cantidad de días elegida en el wizard de rutina. */
  readonly done = output<3 | 4 | 5>();

  protected readonly slideCount = SLIDE_COUNT;
  protected readonly slideIndices = Array.from({ length: SLIDE_COUNT }, (_, i) => i);
  protected readonly current = signal(0);

  protected next(): void {
    if (this.current() < SLIDE_COUNT - 1) {
      this.current.update((s) => s + 1);
    }
  }

  protected pickDays(days: 3 | 4 | 5): void {
    this.done.emit(days);
  }

  protected back(): void {
    this.current.update((s) => Math.max(0, s - 1));
  }

  protected goTo(index: number): void {
    this.current.set(index);
  }
}
