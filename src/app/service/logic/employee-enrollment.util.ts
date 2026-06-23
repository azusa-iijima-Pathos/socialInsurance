import { Employee } from '../../model/employee';
import { parseDateInputValue } from '../common/date-input.util';

/** 対象期間に1日でも在籍しているか（入社日・退社日を考慮） */
export function wasEmployedInPeriod(
  employee: Employee,
  periodStart: Date,
  periodEnd: Date,
): boolean {
  const hire = employee.hireDate?.toDate();
  if (!hire) return false;

  const hireDate = new Date(hire);
  hireDate.setHours(0, 0, 0, 0);
  if (hireDate > periodEnd) return false;

  const resign = employee.resignationDate?.toDate();
  if (resign) {
    const resignationDate = new Date(resign);
    resignationDate.setHours(0, 0, 0, 0);
    if (resignationDate < periodStart) return false;
  }

  return true;
}

/** 指定日に在籍しているか（入社日・退職日を考慮） */
export function wasEmployedOnDate(employee: Employee, date: Date): boolean {
  const target = new Date(date);
  target.setHours(0, 0, 0, 0);
  return wasEmployedInPeriod(employee, target, target);
}

/** 作業月（YYYY-MM または YYYY-MM_bonus）の対象期間 */
export function buildPayrollPeriodBounds(
  workingYear: number,
  workingMonth: number,
  targetPeriod: [number, number],
): { periodStart: Date; periodEnd: Date } {
  const periodStart = parseDateInputValue(
    `${workingYear}-${String(workingMonth).padStart(2, '0')}-${String(targetPeriod[0]).padStart(2, '0')}`,
  );
  const endMonth = targetPeriod[1] < targetPeriod[0] ? workingMonth + 1 : workingMonth;
  const endYear = endMonth > 12 ? workingYear + 1 : workingYear;
  const normalizedEndMonth = endMonth > 12 ? endMonth - 12 : endMonth;
  const periodEnd = parseDateInputValue(
    `${endYear}-${String(normalizedEndMonth).padStart(2, '0')}-${String(targetPeriod[1]).padStart(2, '0')}`,
  );
  periodStart.setHours(0, 0, 0, 0);
  periodEnd.setHours(23, 59, 59, 999);
  return { periodStart, periodEnd };
}

/** 賞与支給月の在籍判定用期間（支給月およびその3か月前まで） */
export function buildBonusEligibilityPeriodBounds(
  paymentYear: number,
  paymentMonth: number,
): { periodStart: Date; periodEnd: Date } {
  let startYear = paymentYear;
  let startMonth = paymentMonth - 3;
  while (startMonth <= 0) {
    startMonth += 12;
    startYear -= 1;
  }
  const periodStart = new Date(startYear, startMonth - 1, 1, 0, 0, 0, 0);
  const periodEnd = new Date(paymentYear, paymentMonth, 0, 23, 59, 59, 999);
  return { periodStart, periodEnd };
}

export function parseMonthlyPayrollId(payrollId: string): { year: number; month: number } | null {
  const normalized = payrollId.replace(/_bonus$/, '');
  const match = normalized.match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]) };
}
