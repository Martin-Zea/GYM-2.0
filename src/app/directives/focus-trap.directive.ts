import { AfterViewInit, Directive, ElementRef, OnDestroy, inject } from '@angular/core';

const FOCUSABLE_SELECTOR = 'button, input, select, textarea, a[href], [tabindex]';

/**
 * Atrapa el foco del teclado dentro del host (paneles de bottom sheets).
 * Al montarse mueve el foco adentro; al destruirse lo devuelve al elemento
 * que lo tenía antes de abrir. Los sheets viven dentro de @if en app.html,
 * así que el ciclo de vida de la directiva coincide con abrir/cerrar.
 */
@Directive({
  selector: '[appFocusTrap]',
  standalone: true,
  host: { '(keydown)': 'onKeydown($event)' },
})
export class FocusTrapDirective implements AfterViewInit, OnDestroy {
  private readonly host: HTMLElement = inject(ElementRef).nativeElement;
  private readonly previousFocus: Element | null = document.activeElement;

  ngAfterViewInit(): void {
    const first = this.focusables()[0];
    if (first) {
      first.focus();
    } else {
      this.host.setAttribute('tabindex', '-1');
      this.host.focus();
    }
  }

  ngOnDestroy(): void {
    const prev = this.previousFocus;
    if (prev instanceof HTMLElement && document.contains(prev)) {
      prev.focus();
    }
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Tab') return;
    const els = this.focusables();
    if (!els.length) {
      event.preventDefault();
      return;
    }
    const first = els[0];
    const last = els[els.length - 1];
    const active = document.activeElement;
    const outside = !this.host.contains(active);
    if (event.shiftKey) {
      if (active === first || outside) {
        event.preventDefault();
        last.focus();
      }
    } else {
      if (active === last || outside) {
        event.preventDefault();
        first.focus();
      }
    }
  }

  /** Elementos enfocables visibles, no disabled y con tabindex no negativo */
  private focusables(): HTMLElement[] {
    return Array.from(this.host.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
      el =>
        !el.hasAttribute('disabled') &&
        el.tabIndex >= 0 &&
        el.getClientRects().length > 0,
    );
  }
}
