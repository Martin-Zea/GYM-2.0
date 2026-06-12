import { Component, inject, output, signal } from '@angular/core';
import { TranslationService } from '../../services/translation.service';
import { IconComponent } from '../icon/icon.component';

const SLIDE_COUNT = 3;

@Component({
  selector: 'app-onboarding',
  standalone: true,
  imports: [IconComponent],
  templateUrl: './onboarding.component.html',
  styleUrl: './onboarding.component.scss',
})
export class OnboardingComponent {
  protected readonly T = inject(TranslationService).T;

  readonly done = output<void>();

  protected readonly slideCount = SLIDE_COUNT;
  protected readonly slideIndices = Array.from({ length: SLIDE_COUNT }, (_, i) => i);
  protected readonly current = signal(0);

  protected next(): void {
    if (this.current() < SLIDE_COUNT - 1) {
      this.current.update(s => s + 1);
    } else {
      this.done.emit();
    }
  }

  protected back(): void {
    this.current.update(s => Math.max(0, s - 1));
  }

  protected goTo(index: number): void {
    this.current.set(index);
  }
}
