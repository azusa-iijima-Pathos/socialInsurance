import { Timestamp } from '@angular/fire/firestore';
import { LeaveType } from '../../constants/model-constants';
import { Employee } from '../../model/employee';
import { Payroll } from '../../model/payroll';

function normalizeStartOfDay(date: Date): Date {
  const normalized = new Date(date);
  normalized.setHours(0, 0, 0, 0);
  return normalized;
}

function normalizeEndOfDay(date: Date): Date {
  const normalized = new Date(date);
  normalized.setHours(23, 59, 59, 999);
  return normalized;
}

function toDate(value: Timestamp | Date): Date {
  return value instanceof Date ? value : value.toDate();
}

export function isMaternityOrChildcareLeaveType(leaveTypes?: LeaveType | null): boolean {
  return leaveTypes === '産前産後' || leaveTypes === '育児';
}

/** 給与データの作業対象期間。未入力時は会社設定ベースの期間を使う */
export function resolvePayrollTargetPeriodBounds(
  payroll: Payroll | undefined,
  fallback: { periodStart: Date; periodEnd: Date },
): { periodStart: Date; periodEnd: Date } {
  if (payroll?.targetPeriod?.[0] && payroll?.targetPeriod?.[1]) {
    return {
      periodStart: normalizeStartOfDay(toDate(payroll.targetPeriod[0])),
      periodEnd: normalizeEndOfDay(toDate(payroll.targetPeriod[1])),
    };
  }
  return {
    periodStart: normalizeStartOfDay(fallback.periodStart),
    periodEnd: normalizeEndOfDay(fallback.periodEnd),
  };
}

/** 期間が1日でも重なるか */
export function doDateRangesOverlap(
  rangeStart: Date,
  rangeEnd: Date,
  periodStart: Date,
  periodEnd: Date,
): boolean {
  return rangeStart <= periodEnd && periodStart <= rangeEnd;
}

/**
 * 産休・育休が作業対象期間に1日でも含まれるか。
 * 勤務状況・休職種別・休職開始日・終了予定日から判定する。
 */
export function isMaternityOrChildcareLeaveOverlappingPeriod(
  employee: Employee,
  periodStart: Date,
  periodEnd: Date,
): boolean {
  if (employee.workStatus !== '休職中' || !isMaternityOrChildcareLeaveType(employee.leaveTypes)) {
    return false;
  }

  if (!employee.leaveStartDate) {
    return true;
  }

  const leaveStart = normalizeStartOfDay(employee.leaveStartDate.toDate());
  const leaveEnd = employee.leaveEndDate
    ? normalizeEndOfDay(employee.leaveEndDate.toDate())
    : normalizeEndOfDay(new Date(9999, 11, 31));

  return doDateRangesOverlap(
    leaveStart,
    leaveEnd,
    normalizeStartOfDay(periodStart),
    normalizeEndOfDay(periodEnd),
  );
}
