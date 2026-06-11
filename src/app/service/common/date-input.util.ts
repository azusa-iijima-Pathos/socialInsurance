import { Timestamp } from '@angular/fire/firestore';

const DATE_INPUT_VALUE_PATTERN = /^(\d+)-(\d+)-(\d+)$/;

function formatDateParts(yearText: string, month: number, day: number): string | null {
  const year = Number(yearText);
  if (yearText.length !== 4 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }
  return `${yearText}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** 数字列の先頭8桁を YYYY-MM-DD として解釈する（20261010 → 2026-10-10） */
export function formatDateFromDigitSequence(digits: string): string | null {
  if (digits.length < 8) return null;
  const yearText = digits.slice(0, 4);
  const month = Number(digits.slice(4, 6));
  const day = Number(digits.slice(6, 8));
  return formatDateParts(yearText, month, day);
}

export type NormalizeDateInputOptions = {
  /** false のとき月・日が1桁の途中入力はそのまま（10日入力の「1」で 01 にならない） */
  padPartial?: boolean;
};

/** type="date" 用。年4桁・月日2桁に正規化。値は消去しない */
export function normalizeDateInputValue(
  value: string,
  options: NormalizeDateInputOptions = {},
): string {
  const padPartial = options.padPartial ?? true;
  if (!value) return '';

  const digits = value.replace(/\D/g, '');
  if (padPartial || digits.length >= 8) {
    const fromDigits = formatDateFromDigitSequence(digits);
    if (fromDigits) return fromDigits;
  }

  const match = value.match(DATE_INPUT_VALUE_PATTERN);
  if (!match) return value;

  const [, yearText, monthText, dayText] = match;

  if (yearText.length === 4) {
    const isPartialMonthOrDay = monthText.length < 2 || dayText.length < 2;
    if (!padPartial && isPartialMonthOrDay) {
      return value;
    }
    const formatted = formatDateParts(yearText, Number(monthText), Number(dayText));
    if (formatted) return formatted;
  }

  if (yearText.length >= 6) {
    const recovered = formatDateFromDigitSequence(digits);
    if (recovered) return recovered;
  }

  return value;
}

/** type="date" の文字列をローカル日付として解釈する */
export function parseDateInputValue(value: string): Date {
  return new Date(`${value}T00:00:00`);
}

export function formatDateForDateInput(date?: Date | null): string {
  if (!date) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function formatTimestampForDateInput(value?: Timestamp | null): string {
  if (!value) return '';
  return formatDateForDateInput(value.toDate());
}

export function timestampFromDateInput(value: string): Timestamp {
  return Timestamp.fromDate(parseDateInputValue(value));
}
