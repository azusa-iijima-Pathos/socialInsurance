import { ApplicantType, EmployeeEventType } from '../../constants/model-constants';
import { Timestamp } from '@angular/fire/firestore';

export type YearMonth = { year: number; month: number };

export function getWorkingYearMonth(): YearMonth {
  return {
    year: Number(sessionStorage.getItem('workingYear')),
    month: Number(sessionStorage.getItem('workingMonth')),
  };
}

/** 作業月を appliedFromMonth 用の数値に変換（YYYYMM） */
export function encodeAppliedFromMonth(year: number, month: number): number {
  return year * 100 + month;
}

/** appliedFromMonth（YYYYMM）を作業月に変換 */
export function decodeAppliedFromMonth(value: number): YearMonth {
  return {
    year: Math.floor(value / 100),
    month: value % 100,
  };
}

/** 現在の作業月を appliedFromMonth 用の数値に変換 */
export function getCurrentAppliedFromMonth(): number {
  const { year, month } = getWorkingYearMonth();
  return encodeAppliedFromMonth(year, month);
}

/** 承認・却下時に記録する作業月（YYYYMM）。月別イベント一覧の承認月表示で使用 */
export function getCurrentApprovedWorkingMonth(): number {
  return getCurrentAppliedFromMonth();
}

/** 前月以前の未処理申請（IDの作業月が現在作業月より前） */
export function isPriorMonthUnprocessedId(itemId: string, workingYear: number, workingMonth: number): boolean {
  const parsed = parseEventYearMonth(itemId, workingYear, workingMonth);
  if (!parsed) return false;
  return parsed.year * 12 + parsed.month < workingYear * 12 + workingMonth;
}

/** イベントIDが指定作業月と一致するか */
export function isEventIdForWorkMonth(itemId: string, targetYear: number, targetMonth: number, workingYear: number, workingMonth: number): boolean {
  const parsed = parseEventYearMonth(itemId, workingYear, workingMonth);
  if (!parsed) return false;
  return parsed.year === targetYear && parsed.month === targetMonth;
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

/** 固定給変更日から随時改定の作業月（変更月+3か月）を返す */
export function getAdHocRevisionWorkMonth(changeDate: Date, targetPeriodStart: number): YearMonth {
  const changeMonth = getWorkMonthForDate(changeDate, targetPeriodStart);
  return addMonths(changeMonth.year, changeMonth.month, 3);
}

/** 日付の前日（0時0分0秒） */
export function getDayBefore(date: Date): Date {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  result.setDate(result.getDate() - 1);
  return result;
}

/** 一定年齢到達タイプ（例: 40歳）から年齢数値を取得 */
export function parseReachAgeFromType(reachAgeType?: string | null): number | null {
  const reachAge = Number.parseInt(String(reachAgeType ?? '').replace('歳', ''), 10);
  return Number.isFinite(reachAge) && reachAge > 0 ? reachAge : null;
}

/** 到達年の誕生日 */
export function getReachAgeBirthdayOnReachYear(birthDate: Date, reachAge: number): Date {
  const normalized = new Date(birthDate);
  normalized.setHours(0, 0, 0, 0);
  const reachYear = normalized.getFullYear() + reachAge;
  return new Date(reachYear, normalized.getMonth(), normalized.getDate(), 0, 0, 0, 0);
}

/** 一定年齢到達時の保険取得日・喪失日（到達年の誕生日の前日） */
export function getReachAgeInsuranceChangeDate(birthDate: Date, reachAge: number): Date {
  return getDayBefore(getReachAgeBirthdayOnReachYear(birthDate, reachAge));
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

/** 退職日の翌日（資格喪失日） */
export function getQualificationLossDate(resignationDate: Date): Date {
  const lossDate = new Date(resignationDate);
  lossDate.setHours(0, 0, 0, 0);
  lossDate.setDate(lossDate.getDate() + 1);
  return lossDate;
}

export function getQualificationLossTimestamp(resignationDate: Timestamp): Timestamp {
  return Timestamp.fromDate(getQualificationLossDate(resignationDate.toDate()));
}

/** 退社時の資格喪失システム計算ID（例: 資格喪失_2026_05_emp001） */
export function buildRetireQualificationLossRunId(
  resignationDate: Date,
  employeeId: string,
  targetPeriodStart: number,
): string {
  const lossDate = getQualificationLossDate(resignationDate);
  const workMonth = getWorkMonthForDate(lossDate, targetPeriodStart);
  return `資格喪失_${formatYearMonth(workMonth.year, workMonth.month)}_${employeeId}`;
}

/** 退社（システム申請）: 退職日を含む作業月の翌月 */
export function buildQualificationAcquisitionRunId(acquiredDate: Date, targetPeriodStart: number): string {
  const workMonth = getWorkMonthForDate(acquiredDate, targetPeriodStart);
  return `資格取得_${formatYearMonth(workMonth.year, workMonth.month)}`;
}

/** 保険情報変更の資格喪失システム計算ID（例: 資格喪失_2026_04_healthInsurance） */
export function buildQualificationLossRunId(lostDate: Date, targetPeriodStart: number): string {
  const workMonth = getWorkMonthForDate(lostDate, targetPeriodStart);
  return `資格喪失_${formatYearMonth(workMonth.year, workMonth.month)}`;
}

export type InsuranceChangeKey = 'healthInsurance' | 'nursingCareInsurance' | 'employeePensionInsurance';

/** 雇用形態変更に伴う保険システム計算か（旧 type=雇用形態変更 も含む） */
export function isEmploymentChangeSystemRun(run: {
  type?: string;
  payload?: Record<string, unknown>;
}): boolean {
  return run.payload?.['source'] === '雇用形態変更' || run.type === '雇用形態変更';
}

/** 雇用形態変更のシステム計算ID（例: 雇用形態変更_2026_04_healthInsurance_emp001） */
export function buildEmploymentChangeRunId(
  effectiveDate: Date,
  employeeId: string,
  targetPeriodStart: number,
  insuranceKeys: InsuranceChangeKey[],
): string {
  const workMonth = getWorkMonthForDate(effectiveDate, targetPeriodStart);
  const keyPart = insuranceKeys.length > 0 ? `_${insuranceKeys.join('_')}` : '';
  return `雇用形態変更_${formatYearMonth(workMonth.year, workMonth.month)}${keyPart}_${employeeId}`;
}

/** 保険情報変更の資格取得/喪失システム計算ID（保険種別ごと・社員ID付き） */
export function buildInsuranceChangeRunId(
  type: '資格取得' | '資格喪失',
  date: Date,
  targetPeriodStart: number,
  insuranceKey: InsuranceChangeKey,
  employeeId: string,
): string {
  const workMonth = getWorkMonthForDate(date, targetPeriodStart);
  return `${type}_${formatYearMonth(workMonth.year, workMonth.month)}_${employeeId}_${insuranceKey}`;
}

/** 等級変更システム計算ID（例: 等級変更_2026_04） */
export function buildGradeChangeRunId(applicationDate: Date, targetPeriodStart: number): string {
  const workMonth = getWorkMonthForDate(applicationDate, targetPeriodStart);
  return `等級変更_${formatYearMonth(workMonth.year, workMonth.month)}`;
}

export function buildDependentChangeEventBaseId(date: Date, targetPeriodStart: number): string {
  const workMonth = getWorkMonthForDate(date, targetPeriodStart);
  return `扶養情報変更_${formatYearMonth(workMonth.year, workMonth.month)}`;
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

/** 随時改定 calculationRun ID（例: 随時改定_2026_04_emp001） */
export function buildAdHocRevisionRunId(revisionMonth: YearMonth, employeeId: string): string {
  return `随時改定_${formatYearMonth(revisionMonth.year, revisionMonth.month)}_${employeeId}`;
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
  const yearMonthInfixMatch = eventId.match(/_(\d{4})_(\d{2})_/);
  if (yearMonthInfixMatch) {
    return { year: Number(yearMonthInfixMatch[1]), month: Number(yearMonthInfixMatch[2]) };
  }

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

/** 承認日が指定月と一致するか */
export function isApprovedInTargetMonth(
  approval: { approvedDate?: { toDate?: () => Date; seconds?: number } | null } | undefined,
  targetYear: number,
  targetMonth: number,
): boolean {
  const parsed = getAppliedDateYearMonth(approval?.approvedDate);
  if (!parsed) return false;
  return parsed.year === targetYear && parsed.month === targetMonth;
}

/** 承認時の作業月が指定月と一致するか（月別イベント一覧の承認月表示用） */
export function isApprovedInTargetWorkingMonth(
  approval: { approvedWorkingMonth?: number } | undefined,
  targetYear: number,
  targetMonth: number,
): boolean {
  if (approval?.approvedWorkingMonth == null) return false;
  const decoded = decodeAppliedFromMonth(approval.approvedWorkingMonth);
  return decoded.year === targetYear && decoded.month === targetMonth;
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

function compareYearMonth(left: YearMonth, right: YearMonth): number {
  return left.year * 12 + left.month - (right.year * 12 + right.month);
}

/** 日付が作業対象期間内か */
export function isDateInWorkPeriod(date: Date, periodStart: Date, periodEnd: Date): boolean {
  const normalized = new Date(date);
  normalized.setHours(0, 0, 0, 0);
  const start = new Date(periodStart);
  start.setHours(0, 0, 0, 0);
  const end = new Date(periodEnd);
  end.setHours(23, 59, 59, 999);
  return normalized >= start && normalized <= end;
}

/** 日付が作業対象期間より前か */
export function isDateBeforeWorkPeriod(date: Date, periodStart: Date): boolean {
  const normalized = new Date(date);
  normalized.setHours(0, 0, 0, 0);
  const start = new Date(periodStart);
  start.setHours(0, 0, 0, 0);
  return normalized < start;
}

/** 日付の作業月が現在の作業月以降か */
export function isWorkMonthAtOrAfterCurrent(date: Date, targetPeriodStart: number): boolean {
  const workMonth = getWorkMonthForDate(date, targetPeriodStart);
  const current = getWorkingYearMonth();
  return compareYearMonth(workMonth, current) >= 0;
}

/** 日付の作業月が現在の作業月より先か */
export function isWorkMonthAfterCurrent(date: Date, targetPeriodStart: number): boolean {
  const workMonth = getWorkMonthForDate(date, targetPeriodStart);
  const current = getWorkingYearMonth();
  return compareYearMonth(workMonth, current) > 0;
}

/** イベントID用の作業月ベースID */
export function buildWorkMonthEventId(eventType: EmployeeEventType, date: Date, targetPeriodStart: number): string {
  const workMonth = getWorkMonthForDate(date, targetPeriodStart);
  return `${eventType}_${formatYearMonth(workMonth.year, workMonth.month)}`;
}

/** 日付が今日以前か（時刻は無視） */
export function isDateOnOrBeforeToday(date: Date): boolean {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(date);
  target.setHours(0, 0, 0, 0);
  return target.getTime() <= today.getTime();
}

/** 日付が今日より前か（今日は含めない） */
export function isDateStrictlyBeforeToday(date: Date): boolean {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(date);
  target.setHours(0, 0, 0, 0);
  return target.getTime() < today.getTime();
}

/** 日付が今日より後か（今日は含めない） */
export function isDateAfterToday(date: Date): boolean {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(date);
  target.setHours(0, 0, 0, 0);
  return target.getTime() > today.getTime();
}

/** 従業員詳細の管理者申請：適用日のタイミング */
export type AdminEffectiveDateTiming = 'future' | 'in_or_before_period_past' | 'after_period_past';

/**
 * 適用日が未来 / 過去かつ作業期間内または以前 / 過去かつ作業期間より後（今日以前）を判定する。
 */
export function resolveAdminEffectiveDateTiming(
  date: Date,
  bounds: { periodStart: Date; periodEnd: Date } | null | undefined,
): AdminEffectiveDateTiming {
  if (isDateAfterToday(date)) return 'future';
  if (!bounds) return 'in_or_before_period_past';

  const normalized = new Date(date);
  normalized.setHours(0, 0, 0, 0);
  const periodEnd = new Date(bounds.periodEnd);
  periodEnd.setHours(23, 59, 59, 999);
  if (normalized > periodEnd) return 'after_period_past';
  return 'in_or_before_period_past';
}

/** Firestore Timestamp 相当の値を Date に変換 */
export function resolveTimestampDate(
  value?: { toDate?: () => Date; seconds?: number } | null,
): Date | null {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate();
  if (typeof value.seconds === 'number') return new Date(value.seconds * 1000);
  return null;
}

/** 発生日が今日以前か */
export function isOccurrenceDateOnOrBeforeToday(
  occurredDate?: { toDate?: () => Date; seconds?: number } | null,
): boolean {
  const date = resolveTimestampDate(occurredDate);
  if (!date) return false;
  return isDateOnOrBeforeToday(date);
}

/** IDの対象月が作業月以前か（反映可能） */
export function canApplyInWorkingPeriod(
  itemId: string,
  workingYear: number,
  workingMonth: number,
  appliedDate?: { toDate?: () => Date; seconds?: number } | null,
): boolean {
  return isEventAtOrBeforeWorkingMonth(itemId, workingYear, workingMonth, appliedDate);
}
