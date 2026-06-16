import { ApplicantType, EmployeeEventType } from '../../constants/model-constants';

export type YearMonth = { year: number; month: number };

export function getWorkingYearMonth(): YearMonth {
  return {
    year: Number(sessionStorage.getItem('workingYear')),
    month: Number(sessionStorage.getItem('workingMonth')),
  };
}

/** 日付が属する作業月を返す */
export function getWorkMonthForDate(date: Date, targetPeriodStart: number): YearMonth {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();

  if (targetPeriodStart === 1) {
    return { year, month };
  }
  if (day >= targetPeriodStart) {
    return { year, month };
  }
  if (month === 1) {
    return { year: year - 1, month: 12 };
  }
  return { year, month: month - 1 };
}

export function addMonths(year: number, month: number, delta: number): YearMonth {
  const date = new Date(year, month - 1 + delta, 1);
  return { year: date.getFullYear(), month: date.getMonth() + 1 };
}

function formatYearMonth(year: number, month: number): string {
  return `${year}_${String(month).padStart(2, '0')}`;
}

function formatMonthOnly(month: number): string {
  return String(month).padStart(2, '0');
}

/** 現在の作業月ベースのイベントID（例: 雇用形態変更_2026_04） */
export function buildCurrentWorkMonthEventId(eventType: EmployeeEventType, working?: YearMonth): string {
  const { year, month } = working ?? getWorkingYearMonth();
  return `${eventType}_${formatYearMonth(year, month)}`;
}

/** 入社時の資格取得システム計算ID（例: 資格取得_2026_04_emp001） */
export function buildHireQualificationAcquisitionRunId(
  hireDate: Date,
  employeeId: string,
  targetPeriodStart: number,
): string {
  const workMonth = getWorkMonthForDate(hireDate, targetPeriodStart);
  return `資格取得_${formatYearMonth(workMonth.year, workMonth.month)}_${employeeId}`;
}

/** 退社時の資格喪失システム計算ID（例: 資格喪失_2026_04_emp001） */
export function buildRetireQualificationLossRunId(
  resignationDate: Date,
  employeeId: string,
  targetPeriodStart: number,
): string {
  const workMonth = getWorkMonthForDate(resignationDate, targetPeriodStart);
  return `資格喪失_${formatYearMonth(workMonth.year, workMonth.month)}_${employeeId}`;
}

/** 退社（システム申請）: 退職日を含む作業月の翌月 */
export function buildQualificationAcquisitionRunId(acquiredDate: Date, targetPeriodStart: number): string {
  const workMonth = getWorkMonthForDate(acquiredDate, targetPeriodStart);
  return `資格取得_${formatYearMonth(workMonth.year, workMonth.month)}`;
}

export function buildDependentChangeEventBaseId(acquiredDate: Date, targetPeriodStart: number): string {
  const workMonth = getWorkMonthForDate(acquiredDate, targetPeriodStart);
  return `扶養変更_${formatYearMonth(workMonth.year, workMonth.month)}`;
}

export function buildRetireSystemEventId(resignationDate: Date, targetPeriodStart: number): string {
  const workMonth = getWorkMonthForDate(resignationDate, targetPeriodStart);
  const nextMonth = addMonths(workMonth.year, workMonth.month, 1);
  return `退社_${formatYearMonth(nextMonth.year, nextMonth.month)}`;
}

/** 固定給変更（システム申請）: 作業月の3か月後 */
export function buildFixedSalarySystemEventId(working?: YearMonth): string {
  const current = working ?? getWorkingYearMonth();
  const future = addMonths(current.year, current.month, 3);
  return `固定給変更_${formatYearMonth(future.year, future.month)}`;
}

/** 随時改定 calculationRun ID（例: 随時改定_2025_12） */
export function buildAdHocRevisionRunId(revisionMonth: YearMonth): string {
  return `随時改定_${formatYearMonth(revisionMonth.year, revisionMonth.month)}`;
}

/** 入社・年齢到達など従来ルール */
export function buildEventId(
  eventType: EmployeeEventType,
  applicantType?: ApplicantType,
  options: {
    occurredDate?: Date;
    targetPeriodStart?: number;
    workingYear?: number;
    workingMonth?: number;
  } = {},
): string {
  const working = options.workingYear && options.workingMonth
    ? { year: options.workingYear, month: options.workingMonth }
    : getWorkingYearMonth();
  const targetPeriodStart = options.targetPeriodStart ?? 1;

  switch (eventType) {
    case '入社': {
      const workMonth = getWorkMonthForDate(options.occurredDate!, targetPeriodStart);
      return `${eventType}_${formatYearMonth(workMonth.year, workMonth.month)}`;
    }
    case '退社':
      return buildRetireSystemEventId(options.occurredDate!, targetPeriodStart);
    case '一定年齢到達':
      return `一定年齢到達_${working.year}-${formatMonthOnly(working.month)}`;
    case '固定給変更':
      return buildFixedSalarySystemEventId(working);
    case '雇用形態変更':
    case '勤務状況変更':
    case '扶養情報変更':
      if (applicantType === '社員') {
        const occurredDate = getWorkMonthForDate(options.occurredDate!, targetPeriodStart);
        return `${eventType}_${formatYearMonth(occurredDate.year, occurredDate.month)}`;
      } else {
        return buildCurrentWorkMonthEventId(eventType, working);
      }
    default:
      return `${eventType}_${formatYearMonth(working.year, working.month)}`;
  }
}

export function parseEventYearMonth(
  eventId: string,
  workingYear: number,
  workingMonth: number,
): YearMonth | null {
  const yearMonthSeqMatch = eventId.match(/_(\d{4})_(\d{2})_\d+$/);
  if (yearMonthSeqMatch) {
    return { year: Number(yearMonthSeqMatch[1]), month: Number(yearMonthSeqMatch[2]) };
  }

  const yearMonthEmployeeIdMatch = eventId.match(/_(\d{4})_(\d{2})_[A-Za-z0-9]+$/);
  if (yearMonthEmployeeIdMatch) {
    return { year: Number(yearMonthEmployeeIdMatch[1]), month: Number(yearMonthEmployeeIdMatch[2]) };
  }

  const yearMonthMatch = eventId.match(/_(\d{4})_(\d{2})$/);
  if (yearMonthMatch) {
    return { year: Number(yearMonthMatch[1]), month: Number(yearMonthMatch[2]) };
  }

  const dashMatch = eventId.match(/_(\d{4})-(\d{2})$/);
  if (dashMatch) {
    return { year: Number(dashMatch[1]), month: Number(dashMatch[2]) };
  }

  const monthSeqMatch = eventId.match(/_(\d{2})_\d+$/);
  if (monthSeqMatch) {
    return { year: workingYear, month: Number(monthSeqMatch[1]) };
  }

  const monthOnlyMatch = eventId.match(/_(\d{2})$/);
  if (monthOnlyMatch) {
    return { year: workingYear, month: Number(monthOnlyMatch[1]) };
  }

  return null;
}

export function isEventAtOrBeforeWorkingMonth(
  eventId: string,
  workingYear: number,
  workingMonth: number,
  appliedDate?: { toDate?: () => Date; seconds?: number } | null,
): boolean {
  const parsed = parseEventYearMonth(eventId, workingYear, workingMonth);
  if (parsed) {
    return parsed.year * 12 + parsed.month <= workingYear * 12 + workingMonth;
  }

  const applied = getAppliedDateYearMonth(appliedDate);
  if (applied) {
    return applied.year * 12 + applied.month <= workingYear * 12 + workingMonth;
  }

  return true;
}

function getAppliedDateYearMonth(
  appliedDate?: { toDate?: () => Date; seconds?: number } | null,
): YearMonth | null {
  if (!appliedDate) return null;
  if (typeof appliedDate.toDate === 'function') {
    const date = appliedDate.toDate();
    return { year: date.getFullYear(), month: date.getMonth() + 1 };
  }
  if (typeof appliedDate.seconds === 'number') {
    const date = new Date(appliedDate.seconds * 1000);
    return { year: date.getFullYear(), month: date.getMonth() + 1 };
  }
  return null;
}

/** イベントID（または申請日）が指定作業月と一致するか */
export function isEventInTargetMonth(
  eventId: string,
  targetYear: number,
  targetMonth: number,
  workingYear: number,
  workingMonth: number,
  appliedDate?: { toDate?: () => Date; seconds?: number } | null,
): boolean {
  const parsed = parseEventYearMonth(eventId, workingYear, workingMonth);
  if (parsed) {
    return parsed.year === targetYear && parsed.month === targetMonth;
  }

  const applied = getAppliedDateYearMonth(appliedDate);
  if (applied) {
    return applied.year === targetYear && applied.month === targetMonth;
  }

  return false;
}

export function getFixedSalarySystemOccurredDate(working?: YearMonth): Date {
  const current = working ?? getWorkingYearMonth();
  const future = addMonths(current.year, current.month, 3);
  return new Date(future.year, future.month - 1, 1);
}
