import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { TranslationService } from '../../services/translation.service';
import { IconComponent } from '../icon/icon.component';

@Component({
  selector: 'app-bottom-nav',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, IconComponent],
  templateUrl: './bottom-nav.component.html',
  styleUrl: './bottom-nav.component.scss',
})
export class BottomNavComponent {
  protected readonly tr = inject(TranslationService);
  protected readonly T = this.tr.T;
}
