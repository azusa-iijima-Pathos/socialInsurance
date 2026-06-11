import { DOCUMENT } from '@angular/common';
import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { Header } from './componect/header/header/header';
import {
  formatDateFromDigitSequence,
  normalizeDateInputValue,
} from './service/common/date-input.util';

type DateInputState = {
  digits: string;
  lastKeyAt: number;
};

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
  private dateInputStates = new WeakMap<HTMLInputElement, DateInputState>();
  private static readonly DATE_DIGIT_PAUSE_MS = 3000;

  ngOnInit() {
    const inputHandler = (event: Event) => this.normalizeFormInput(event);
    const changeHandler = (event: Event) => this.normalizeFormChange(event);
    const keydownHandler = (event: KeyboardEvent) => this.handleKeydown(event);
    const focusHandler = (event: Event) => this.prepareDateInput(event);

    this.document.addEventListener('input', inputHandler, true);
    this.document.addEventListener('change', changeHandler, true);
    this.document.addEventListener('keydown', keydownHandler, true);
    this.document.addEventListener('focusin', focusHandler, true);

    this.inputListeners = [
      () => this.document.removeEventListener('input', inputHandler, true),
      () => this.document.removeEventListener('change', changeHandler, true),
      () => this.document.removeEventListener('keydown', keydownHandler, true),
      () => this.document.removeEventListener('focusin', focusHandler, true),
    ];
  }

  ngOnDestroy() {
    this.inputListeners.forEach(removeListener => removeListener());
  }

  private normalizeFormInput(event: Event) {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;

    if (input.type === 'number') {
      this.normalizeNumberInput(input);
      return;
    }

    if (input.type === 'date') {
      this.ensureDateInputMax(input);
      this.handleDateInput(event, input, false);
    }
  }

  private normalizeFormChange(event: Event) {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || input.type !== 'date') return;

    this.ensureDateInputMax(input);
    this.handleDateInput(event, input, true);
  }

  private handleKeydown(event: KeyboardEvent) {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;

    if (input.type === 'number') {
      this.preventInvalidNumberKey(event);
      return;
    }

    if (input.type === 'date') {
      this.handleDateKeydown(event, input);
    }
  }

  private preventInvalidNumberKey(event: KeyboardEvent) {
    if (event.key === 'e' || event.key === 'E' || event.key === '+') {
      event.preventDefault();
    }
  }

  private handleDateKeydown(event: KeyboardEvent, input: HTMLInputElement) {
    if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;

    if (event.key === 'Tab' || event.key === 'Enter' || event.key.startsWith('Arrow')) {
      this.dateInputStates.delete(input);
      return;
    }

    if (event.key === 'Backspace' || event.key === 'Delete') {
      this.dateInputStates.delete(input);
      return;
    }

    if (!/^\d$/.test(event.key)) return;

    const now = Date.now();
    const previous = this.dateInputStates.get(input);
    const isNewSequence = !previous || now - previous.lastKeyAt > App.DATE_DIGIT_PAUSE_MS;
    const digits = isNewSequence ? event.key : `${previous.digits}${event.key}`;

    this.dateInputStates.set(input, { digits, lastKeyAt: now });

    if (!isNewSequence) {
      event.preventDefault();
    }

    if (digits.length < 8) return;

    const formatted = formatDateFromDigitSequence(digits.slice(0, 8));
    if (!formatted) return;

    event.preventDefault();
    this.applyDateValue(input, formatted);
    this.dateInputStates.delete(input);
  }

  private handleDateInput(event: Event, input: HTMLInputElement, padPartial: boolean) {
    const inputEvent = event as InputEvent;
    const pastedText = inputEvent.inputType === 'insertFromPaste' ? inputEvent.data ?? '' : '';
    const pastedDigits = pastedText.replace(/\D/g, '');

    if (pastedDigits.length >= 8) {
      const formatted = formatDateFromDigitSequence(pastedDigits.slice(0, 8));
      if (formatted) {
        this.applyDateValue(input, formatted);
        return;
      }
    }

    const state = this.dateInputStates.get(input);
    if (!input.value && state?.digits.length === 8) {
      const formatted = formatDateFromDigitSequence(state.digits);
      if (formatted) {
        this.applyDateValue(input, formatted);
        return;
      }
    }

    this.normalizeDateInput(input, padPartial);
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

  private prepareDateInput(event: Event) {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || input.type !== 'date') return;

    this.ensureDateInputMax(input);
    this.dateInputStates.delete(input);
  }

  private ensureDateInputMax(input: HTMLInputElement) {
    input.max = input.max || '9999-12-31';
  }

  private normalizeDateInput(input: HTMLInputElement, padPartial: boolean) {
    const normalized = normalizeDateInputValue(input.value, { padPartial });
    if (normalized === input.value) return;

    this.applyDateValue(input, normalized);
  }

  private applyDateValue(input: HTMLInputElement, value: string) {
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }
}
