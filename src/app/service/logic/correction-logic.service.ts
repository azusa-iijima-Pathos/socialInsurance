import { inject, Injectable } from '@angular/core';
import { Employee, EmployeeInsurance } from '../../model/employee';
import { InsuranceSnapshot } from '../../model/insurance-snapshot';
import { EmployeeService } from '../Firestore/employee-service';
import { InsuranceSnapshotService } from '../Firestore/insurance-snapshot-service';
import { OfficeService } from '../Firestore/office-service';
import { EmployeeLogicService } from './employee-logic-service';
import { addMonths, getWorkMonthForDate, getWorkingYearMonth, YearMonth } from './event-id-service';
import { EventService } from '../Firestore/event-service';
import { CalculationRunService } from '../Firestore/calculation-run-service';
import { CompanyService } from '../Firestore/company-service';
import { InsuranceRates } from '../Firestore/insurance-rates';
import { PayrollService } from '../Firestore/payroll-service';

export type MonthlyInsuranceDiff = {
  payrollId: string;
  year: number;
  month: number;
  healthDiff: number;
  nursingDiff: number;
  pensionDiff: number;
  totalDiff: number;
};

export type BonusInsuranceComparison = {
  payrollId: string;
  currentHealth: number;
  currentNursing: number;
  currentPension: number;
  newHealth: number;
  newNursing: number;
  newPension: number;
  healthDiff: number;
  nursingDiff: number;
  pensionDiff: number;
  totalDiff: number;
};

export type MonthlyInsuranceComparisonRow = MonthlyInsuranceDiff & {
  grade: number;
  currentHealth: number;
  currentNursing: number;
  currentPension: number;
  newHealth: number;
  newNursing: number;
  newPension: number;
};

@Injectable({
  providedIn: 'root',
})
export class CorrectionLogicService {

  private employeeService = inject(EmployeeService);
  private insuranceSnapshotService = inject(InsuranceSnapshotService);
  private officeService = inject(OfficeService);
  private employeeLogicService = inject(EmployeeLogicService);
  private companyService = inject(CompanyService);
  private eventService = inject(EventService);
  private calculationRunService = inject(CalculationRunService);
  private insuranceRates = inject(InsuranceRates);
  private payrollService = inject(PayrollService);
  enumerateConfirmedMonths(from: YearMonth, toExclusive: YearMonth): YearMonth[] {
    const months: YearMonth[] = [];
    let current = { ...from };

    while (current.year * 12 + current.month < toExclusive.year * 12 + toExclusive.month) {
      months.push({ ...current });
      current = addMonths(current.year, current.month, 1);
    }

    return months;
  }

  getPayrollId(year: number, month: number): string {
    return `${year}-${String(month).padStart(2, '0')}`;
  }

  /** 過去Nか月の作業月オプション（先頭=現在作業月） */
  getPastYearMonthOptions(count = 12): { label: string; year: number; month: number; payrollId: string }[] {
    const working = getWorkingYearMonth();
    const options: { label: string; year: number; month: number; payrollId: string }[] = [];
    let year = working.year;
    let month = working.month;
    for (let i = 0; i < count; i++) {
      options.push({
        label: `${year}年${month}月`,
        year,
        month,
        payrollId: this.getPayrollId(year, month),
      });
      const prev = addMonths(year, month, -1);
      year = prev.year;
      month = prev.month;
    }
    return options;
  }

  /** 遡及修正の適用日バリデーション（エラーメッセージを返す。OKならnull） */
  async validateRetroactiveApplyDate(employeeId: string, applyDate: Date, requireConfirmedMonths = true): Promise<string | null> {
    const working = getWorkingYearMonth();
    const applyMonth = await this.getWorkMonthForInputDate(applyDate);
    const applyKey = applyMonth.year * 12 + applyMonth.month;
    const workingKey = working.year * 12 + working.month;

    if (applyKey >= workingKey) {
      return '適用日は現在の作業月より前の日付を指定してください';
    }

    if (!requireConfirmedMonths) {
      return null;
    }

    const snapshots = await this.insuranceSnapshotService.getSnapshotsForEmployee(employeeId);
    const snapshotIds = new Set(snapshots.map(snapshot => snapshot.payrollId ?? ''));
    const hasConfirmed = this.enumerateConfirmedMonths(applyMonth, working)
      .some(month => snapshotIds.has(this.getPayrollId(month.year, month.month)));

    if (!hasConfirmed) {
      return '適用日に対応する確定済み対象月がありません';
    }

    return null;
  }

  /** 日付が現在の作業月より前か */
  async isDateBeforeCurrentWorkingMonth(date: Date): Promise<boolean> {
    const working = getWorkingYearMonth();
    const workMonth = await this.getWorkMonthForInputDate(date);
    return workMonth.year * 12 + workMonth.month < working.year * 12 + working.month;
  }

  /** 月額給与修正：対象期間開始日のバリデーション */
  async validateSalaryCorrectionTargetPeriod(targetPeriodStart: string): Promise<string | null> {
    if (!targetPeriodStart) return null;
    const isBefore = await this.isDateBeforeCurrentWorkingMonth(new Date(targetPeriodStart));
    if (!isBefore) {
      return '対象期間開始日は現在の作業月より前の日付を指定してください';
    }
    return null;
  }

  /** 適用作業月から作業月1つ前までの保険料比較（ポップ表示用） */
  async calculateInsuranceComparison(
    employee: Employee,
    afterInsurance: EmployeeInsurance,
    from: YearMonth,
    toExclusive: YearMonth,
  ): Promise<MonthlyInsuranceComparisonRow[]> {
    const snapshots = await this.insuranceSnapshotService.getSnapshotsForEmployee(employee.employeeId);
    const snapshotMap = new Map(snapshots.map(snapshot => [snapshot.payrollId ?? '', snapshot]));
    const prefecture = await this.officeService.getOfficeLocation(employee.employmentContract?.officeId ?? '');
    const rows: MonthlyInsuranceComparisonRow[] = [];

    for (const month of this.enumerateConfirmedMonths(from, toExclusive)) {
      const payrollId = this.getPayrollId(month.year, month.month);
      const snapshot = snapshotMap.get(payrollId);
      if (!snapshot) continue;

      const recalculated = await this.calculateMonthlyInsurance(employee, afterInsurance, prefecture ?? undefined, payrollId);
      const current = this.getSnapshotTotals(snapshot);
      const calculated = this.getCalculatedTotals(recalculated);

      rows.push({
        payrollId,
        year: month.year,
        month: month.month,
        grade: afterInsurance.currentGrade ?? 0,
        currentHealth: current.health,
        currentNursing: current.nursing,
        currentPension: current.pension,
        newHealth: calculated.health,
        newNursing: calculated.nursing,
        newPension: calculated.pension,
        healthDiff: calculated.health - current.health,
        nursingDiff: calculated.nursing - current.nursing,
        pensionDiff: calculated.pension - current.pension,
        totalDiff: (calculated.health - current.health) + (calculated.nursing - current.nursing) + (calculated.pension - current.pension),
      });
    }

    return rows;
  }

  /** 休職開始日をイベント・システム計算結果から特定（直近の休職開始） */
  async getLeaveStartFromEvents(employeeId: string): Promise<Date | null> {
    const candidates: Date[] = [];

    const events = await this.eventService.getEmployeeEvents(employeeId);
    for (const event of events) {
      if (event.eventType !== '勤務状況変更' && event.eventType !== '雇用形態変更') continue;
      const after = event.payload?.['after'] as Employee | undefined;
      const before = event.payload?.['before'] as Employee | undefined;
      if (after?.workStatus !== '休職中') continue;
      if (before?.workStatus === '休職中') continue;

      const date = event.occurredDate?.toDate() ?? event.appliedDate?.toDate();
      if (date) candidates.push(date);
    }

    const runs = await this.calculationRunService.getAllCalculationRuns();
    for (const run of runs) {
      const runEmployeeId = String(run.targetEmployeeIds ?? run.payload?.['employeeId'] ?? '');
      if (runEmployeeId !== employeeId || run.type !== 'イベント') continue;

      const eventType = run.payload?.['eventType'];
      if (eventType !== '勤務状況変更' && eventType !== '雇用形態変更') continue;

      const after = run.payload?.['after'] as Employee | undefined;
      const before = run.payload?.['before'] as Employee | undefined;
      if (after?.workStatus !== '休職中' || before?.workStatus === '休職中') continue;

      const occurred = run.payload?.['occurredDate'] as { toDate?: () => Date } | undefined;
      if (occurred?.toDate) candidates.push(occurred.toDate());
    }

    if (candidates.length === 0) return null;
    candidates.sort((left, right) => right.getTime() - left.getTime());
    return candidates[0];
  }

  /** 賞与修正時の保険料比較 */
  async calculateBonusInsuranceComparison(
    employee: Employee,
    payrollId: string,
    newAmount: number,
  ): Promise<BonusInsuranceComparison | null> {
    const snapshot = await this.insuranceSnapshotService.getSnapshot(employee.employeeId, payrollId);
    if (!snapshot) return null;

    const current = this.getSnapshotTotals(snapshot);
    const calculated = await this.calculateBonusInsuranceTotals(employee, payrollId, newAmount);

    return {
      payrollId,
      currentHealth: current.health,
      currentNursing: current.nursing,
      currentPension: current.pension,
      newHealth: calculated.health,
      newNursing: calculated.nursing,
      newPension: calculated.pension,
      healthDiff: calculated.health - current.health,
      nursingDiff: calculated.nursing - current.nursing,
      pensionDiff: calculated.pension - current.pension,
      totalDiff: (calculated.health - current.health) + (calculated.nursing - current.nursing) + (calculated.pension - current.pension),
    };
  }

  /** 作業月の1つ前（デフォルト選択用） */
  getPreviousWorkMonth(): YearMonth {
    const options = this.getPastYearMonthOptions(2);
    return options[1] ?? options[0] ?? getWorkingYearMonth();
  }

  /** 適用作業月から確定済み月までの保険料差額を算出 */
  async calculateInsuranceDiffs(
    employee: Employee,
    afterInsurance: EmployeeInsurance,
    from: YearMonth,
    toExclusive: YearMonth,
  ): Promise<MonthlyInsuranceDiff[]> {
    const snapshots = await this.insuranceSnapshotService.getSnapshotsForEmployee(employee.employeeId);
    const snapshotMap = new Map(snapshots.map(snapshot => [snapshot.payrollId ?? '', snapshot]));
    const prefecture = await this.officeService.getOfficeLocation(employee.employmentContract?.officeId ?? '');
    const diffs: MonthlyInsuranceDiff[] = [];

    for (const month of this.enumerateConfirmedMonths(from, toExclusive)) {
      const payrollId = this.getPayrollId(month.year, month.month);
      const snapshot = snapshotMap.get(payrollId);
      if (!snapshot) continue;

      const recalculated = await this.calculateMonthlyInsurance(employee, afterInsurance, prefecture ?? undefined, payrollId);
      const oldTotals = this.getSnapshotTotals(snapshot);
      const newTotals = this.getCalculatedTotals(recalculated);

      const healthDiff = newTotals.health - oldTotals.health;
      const nursingDiff = newTotals.nursing - oldTotals.nursing;
      const pensionDiff = newTotals.pension - oldTotals.pension;

      if (healthDiff === 0 && nursingDiff === 0 && pensionDiff === 0) continue;

      diffs.push({
        payrollId,
        year: month.year,
        month: month.month,
        healthDiff,
        nursingDiff,
        pensionDiff,
        totalDiff: healthDiff + nursingDiff + pensionDiff,
      });
    }

    return diffs;
  }

  /** 日付が属する作業月 */
  async getWorkMonthForInputDate(date: Date): Promise<YearMonth> {
    await this.companyService.getCompany();
    const targetPeriodStart = this.companyService.company()?.settings?.targetPeriod[0] ?? 1;
    return getWorkMonthForDate(date, targetPeriodStart);
  }

  /** 休職開始日の差分月（簡易：登録済みと実際の作業月の間） */
  getLeaveCorrectionMonths(
    registeredStart: YearMonth,
    actualStart: YearMonth,
    toExclusive: YearMonth,
  ): YearMonth[] {
    const start = registeredStart.year * 12 + registeredStart.month <= actualStart.year * 12 + actualStart.month
      ? registeredStart
      : actualStart;
    return this.enumerateConfirmedMonths(start, toExclusive);
  }

  private async calculateMonthlyInsurance(
    employee: Employee,
    insurance: EmployeeInsurance,
    prefecture: string | undefined,
    payrollId: string,
  ) {
    const grade = insurance.currentGrade ?? 0;
    const merged: Employee = { ...employee, insurance };

    if (this.isMaternityOrChildcareLeave(merged)) {
      return { health: 0, nursing: 0, pension: 0 };
    }

    if (!prefecture || !grade || !insurance.healthInsurance?.joined || insurance.healthInsurance?.lostDate) {
      return { health: 0, nursing: 0, pension: 0 };
    }

    const rates = await this.employeeLogicService.getInsuranceRate(prefecture, grade, payrollId);
    if (!rates) {
      return { health: 0, nursing: 0, pension: 0 };
    }

    const nursing = insurance.nursingCareInsurance?.joined && !insurance.nursingCareInsurance?.lostDate
      ? rates.nursingCare
      : 0;
    const pension = insurance.employeePensionInsurance?.joined && !insurance.employeePensionInsurance?.lostDate
      ? rates.pension
      : 0;

    return {
      health: rates.healthInsurance,
      nursing,
      pension,
    };
  }

  private isMaternityOrChildcareLeave(employee: Employee): boolean {
    return employee.workStatus === '休職中'
      && (employee.leaveTypes === '産前産後' || employee.leaveTypes === '育児');
  }

  private getSnapshotTotals(snapshot: InsuranceSnapshot) {
    const payments = snapshot.insurancePayments ?? [];
    const sum = (type: string) => {
      const payment = payments.find(item => item.insuranceType === type);
      return (payment?.employeeBurdenAmount ?? 0) + (payment?.companyBurdenAmount ?? 0);
    };
    return {
      health: sum('健康保険'),
      nursing: sum('介護保険'),
      pension: sum('厚生年金'),
    };
  }

  private getCalculatedTotals(calculated: { health: number; nursing: number; pension: number }) {
    return {
      health: Math.round(calculated.health),
      nursing: Math.round(calculated.nursing),
      pension: Math.round(calculated.pension),
    };
  }

  private async calculateBonusInsuranceTotals(employee: Employee, payrollId: string, amount: number) {
    const targetYearMonth = payrollId.replace('_bonus', '');
    const standardBonusAmount = Math.floor((Number(amount) || 0) / 1000) * 1000;
    const previousHealthStandardBonus = await this.getPreviousHealthStandardBonusTotal(employee.employeeId, payrollId, targetYearMonth);
    const healthStandardBonusAmount = Math.min(standardBonusAmount, Math.max(5730000 - previousHealthStandardBonus, 0));
    const pensionStandardBonusAmount = Math.min(standardBonusAmount, 1500000);

    const prefecture = await this.officeService.getOfficeLocation(employee.employmentContract?.officeId ?? '');
    const rate = prefecture ? await this.getBonusInsuranceRate(targetYearMonth, prefecture) : null;

    let health = this.normalizeBonusAmount(healthStandardBonusAmount * ((rate?.healthInsuranceRate ?? 0) / 100));
    let nursing = this.normalizeBonusAmount(healthStandardBonusAmount * ((rate?.nursingCareRate ?? 0) / 100));
    let pension = this.normalizeBonusAmount(pensionStandardBonusAmount * ((rate?.pensionRate ?? 0) / 100));

    if (!employee.insurance?.healthInsurance?.joined || employee.insurance?.healthInsurance?.lostDate) {
      health = 0;
      nursing = 0;
    }
    if (!employee.insurance?.nursingCareInsurance?.joined || employee.insurance?.nursingCareInsurance?.lostDate) {
      nursing = 0;
    }
    if (!employee.insurance?.employeePensionInsurance?.joined || employee.insurance?.employeePensionInsurance?.lostDate) {
      pension = 0;
    }
    if (employee.workStatus === '休職中' && (employee.leaveTypes === '産前産後' || employee.leaveTypes === '育児')) {
      health = 0;
      nursing = 0;
      pension = 0;
    }

    return { health, nursing, pension };
  }

  private async getBonusInsuranceRate(targetYearMonth: string, prefecture: string) {
    const [yearText, monthText] = targetYearMonth.split('-');
    const year = Number(yearText);
    const month = Number(monthText);
    const masterYear = String(month <= 2 ? year - 1 : year);
    await this.insuranceRates.getRateData(masterYear);
    return this.insuranceRates.getApplicableRateData(masterYear, targetYearMonth).find(rate => rate.prefecture === prefecture) ?? null;
  }

  private async getPreviousHealthStandardBonusTotal(employeeId: string, payrollId: string, targetYearMonth: string) {
    const [yearText, monthText] = targetYearMonth.split('-');
    const year = Number(yearText);
    const month = Number(monthText);
    const fiscalStartYear = month >= 4 ? year : year - 1;
    const fiscalStartYearMonth = `${fiscalStartYear}-04`;
    const fiscalEndYearMonth = `${fiscalStartYear + 1}-03`;

    const payrollList = await this.payrollService.getPayrollListForEmployee(employeeId);
    return payrollList
      .filter(payroll => payroll.type === '賞与')
      .filter(payroll => payroll.payrollId !== payrollId)
      .filter(payroll => {
        const payrollYearMonth = payroll.payrollId?.slice(0, 7) ?? '';
        return fiscalStartYearMonth <= payrollYearMonth && payrollYearMonth <= fiscalEndYearMonth;
      })
      .reduce((total, payroll) => total + Math.floor((payroll.actualPaymentAmount ?? 0) / 1000) * 1000, 0);
  }

  private normalizeBonusAmount(amount: number) {
    return Math.round(amount);
  }
}
