import { Component, inject, output, signal } from '@angular/core';
import { TranslationService } from '../../services/translation.service';
import { IconComponent } from '../icon/icon.component';

@Component({
  selector: 'app-legal-gate',
  standalone: true,
  imports: [IconComponent],
  templateUrl: './legal-gate.component.html',
  styleUrl: './legal-gate.component.scss',
})
export class LegalGateComponent {
  protected readonly T = inject(TranslationService).T;

  readonly accepted = output<void>();

  protected readonly checked = signal(false);

  protected accept(): void {
    if (!this.checked()) return;
    this.accepted.emit();
  }
}
