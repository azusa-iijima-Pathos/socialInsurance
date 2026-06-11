import { DOCUMENT } from '@angular/common';
import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { Header } from './componect/header/header/header';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, Header],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App implements OnInit, OnDestroy {
  protected readonly title = signal('socialInsurance');

  private document = inject(DOCUMENT);
  private inputListeners: (() => void)[] = [];

  ngOnInit() {
    const inputHandler = (event: Event) => this.normalizeFormInput(event);
    const keydownHandler = (event: KeyboardEvent) => this.handleKeydown(event);

    this.document.addEventListener('input', inputHandler, true);
    this.document.addEventListener('keydown', keydownHandler, true);

    this.inputListeners = [
      () => this.document.removeEventListener('input', inputHandler, true),
      () => this.document.removeEventListener('keydown', keydownHandler, true),
    ];
  }

  ngOnDestroy() {
    this.inputListeners.forEach(removeListener => removeListener());
  }

  private normalizeFormInput(event: Event) {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || input.type !== 'number') return;

    this.normalizeNumberInput(input);
  }

  private handleKeydown(event: KeyboardEvent) {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || input.type !== 'number') return;

    if (event.key === 'e' || event.key === 'E' || event.key === '+') {
      event.preventDefault();
    }
  }

  private normalizeNumberInput(input: HTMLInputElement) {
    const originalValue = input.value;
    if (!originalValue) return;

    let value = originalValue.replace(/[eE+]/g, '');
    const sign = value.startsWith('-') ? '-' : '';
    if (sign) {
      value = value.slice(1);
    }

    const [integerPart, decimalPart] = value.split('.', 2);
    const normalizedInteger = integerPart.replace(/^0+(?=\d)/, '') || '0';
    const normalizedValue = `${sign}${normalizedInteger}${decimalPart !== undefined ? `.${decimalPart}` : ''}`;

    if (normalizedValue !== originalValue) {
      input.value = normalizedValue;
    }
  }
}
