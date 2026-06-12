import { Component, inject, signal } from '@angular/core';
import { IconComponent } from '../icon/icon.component';
import { TranslationService } from '../../services/translation.service';

@Component({
  selector: 'app-how-it-works',
  standalone: true,
  imports: [IconComponent],
  templateUrl: './how-it-works.component.html',
  styleUrl: './how-it-works.component.scss',
})
export class HowItWorksComponent {
  protected readonly T = inject(TranslationService).T;

  protected readonly visible = signal(localStorage.getItem('gym_hiw_dismissed') !== '1');

  protected dismiss(): void {
    localStorage.setItem('gym_hiw_dismissed', '1');
    this.visible.set(false);
  }
}
