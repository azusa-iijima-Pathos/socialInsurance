import { Timestamp } from '@angular/fire/firestore';
import { InsuranceDetail } from '../../model/employee';
import { parseDateInputValue } from '../common/date-input.util';
import { parseMonthlyPayrollId } from './employee-enrollment.util';
/** 日付をローカル0時に正規化する */
export function normalizeToStartOfDay(date: Date): Date {
  const normalized = new Date(date);
  normalized.setHours(0, 0, 0, 0);
  return normalized;
}

/** 暦月の1日（0時）を返す */
export function startOfCalendarMonth(year: number, month: number): Date {
  return new Date(year, month - 1, 1, 0, 0, 0, 0);
}

/** 日付が属する暦月の1日（0時）を返す */
export function startOfCalendarMonthFromDate(date: Date): Date {
  const normalized = normalizeToStartOfDay(date);
  return new Date(normalized.getFullYear(), normalized.getMonth(), 1, 0, 0, 0, 0);
}

/** 2つの日付が同じ暦月か */
export function isSameCalendarMonth(left: Date, right: Date): boolean {
  const a = normalizeToStartOfDay(left);
  const b = normalizeToStartOfDay(right);
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

/** 日付がその月の末日か */
export function isLastDayOfCalendarMonth(date: Date): boolean {
  const normalized = normalizeToStartOfDay(date);
  const lastDay = new Date(normalized.getFullYear(), normalized.getMonth() + 1, 0).getDate();
  return normalized.getDate() === lastDay;
}

/** 給与サイクルIDから法律上の保険料対象月（暦月1日）を返す */
export function resolveInsuranceTargetMonthStart(payrollId: string): Date | null {
  const parsed = parseMonthlyPayrollId(payrollId);
  if (!parsed) return null;
  return startOfCalendarMonth(parsed.year, parsed.month);
}

function toDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return normalizeToStartOfDay(value);
  if (value instanceof Timestamp) return normalizeToStartOfDay(value.toDate());
  if (typeof value === 'object' && value !== null && 'toDate' in value && typeof (value as Timestamp).toDate === 'function') {
    return normalizeToStartOfDay((value as Timestamp).toDate());
  }
  if (typeof value === 'object' && value !== null && 'seconds' in value) {
    const seconds = Number((value as { seconds: number }).seconds);
    if (Number.isFinite(seconds)) {
      return normalizeToStartOfDay(new Date(seconds * 1000));
    }
  }
  if (typeof value === 'string') {
    const normalized = value.trim().replace(/\//g, '-');
    const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
      const parsed = parseDateInputValue(`${match[1]}-${match[2]}-${match[3]}`);
      if (!Number.isNaN(parsed.getTime())) {
        return normalizeToStartOfDay(parsed);
      }
    }
  }
  return null;
}

function isTruthyJoined(joined: unknown): boolean {
  return joined === true || joined === 1 || joined === '1';
}

function isFalsyJoined(joined: unknown): boolean {
  return joined === false || joined === 0 || joined === '0';
}

function hasActiveInsuranceCoverage(detail: InsuranceDetail): boolean {
  if (isTruthyJoined(detail.joined)) return true;
  if (isFalsyJoined(detail.joined) && !detail.acquiredDate) return false;
  return Boolean(detail.acquiredDate);
}
/**
 * 対象月に当該保険料を徴収すべきかを判定する。
 * 判定は給与締め日ではなく、法律上の保険料対象月（暦月）ベースで行う。
 */
export function shouldCollectInsurancePremium(
  detail: InsuranceDetail | undefined,
  targetYear: number,
  targetMonth: number,
): boolean {
  if (!detail) return false;

  const hasCoverage = hasActiveInsuranceCoverage(detail);
  if (!hasCoverage) return false;

  const targetMonthStart = startOfCalendarMonth(targetYear, targetMonth);
  const acquiredDate = toDate(detail.acquiredDate);

  if (acquiredDate) {
    const acquiredMonthStart = startOfCalendarMonthFromDate(acquiredDate);
    if (targetMonthStart.getTime() < acquiredMonthStart.getTime()) {
      return false;
    }
  }

  const lostDate = toDate(detail.lostDate);
  if (!lostDate) {
    return !isFalsyJoined(detail.joined);
  }

  const lostMonthStart = startOfCalendarMonthFromDate(lostDate);

  if (lostMonthStart.getTime() < targetMonthStart.getTime()) {
    return false;
  }

  if (lostMonthStart.getTime() > targetMonthStart.getTime()) {
    return true;
  }

  return isLastDayOfCalendarMonth(lostDate);
}

/** 賞与支給日から保険料判定用の暦月を返す */
export function resolveBonusTargetMonthFromPaymentDate(paymentDate: Date): { year: number; month: number } {
  const normalized = normalizeToStartOfDay(paymentDate);
  return {
    year: normalized.getFullYear(),
    month: normalized.getMonth() + 1,
  };
}

/**
 * 賞与支給月に当該保険料を徴収すべきかを判定する。
 * 対象月は賞与支給日の属する暦月。喪失は月単位で判定し、同月喪失は一律免除。
 */
export function shouldCollectBonusInsurancePremium(
  detail: InsuranceDetail | undefined,
  targetYear: number,
  targetMonth: number,
): boolean {
  if (!detail) return false;

  const hasCoverage = hasActiveInsuranceCoverage(detail);
  if (!hasCoverage) return false;

  const targetMonthStart = startOfCalendarMonth(targetYear, targetMonth);
  const acquiredDate = toDate(detail.acquiredDate);

  if (acquiredDate) {
    const acquiredMonthStart = startOfCalendarMonthFromDate(acquiredDate);
    if (targetMonthStart.getTime() < acquiredMonthStart.getTime()) {
      return false;
    }
  }

  const lostDate = toDate(detail.lostDate);
  if (!lostDate) {
    return !isFalsyJoined(detail.joined);
  }

  const lostMonthStart = startOfCalendarMonthFromDate(lostDate);

  if (lostMonthStart.getTime() <= targetMonthStart.getTime()) {
    return false;
  }

  return true;
}
