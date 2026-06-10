import { Timestamp } from '@angular/fire/firestore';

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
