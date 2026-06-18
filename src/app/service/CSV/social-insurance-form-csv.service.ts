import { inject, Injectable } from '@angular/core';
import { Timestamp } from '@angular/fire/firestore';
import { Employee, EmployeeInsurance } from '../../model/employee';
import { Dependent } from '../../model/dependent';
import { CalculationRun } from '../../model/calculation-run';
import { Event } from '../../model/event';
import { ChangeType } from '../../constants/model-constants';
import { EmployeeEventItem } from '../Firestore/event-service';
import { SystemCalculationRunItem } from '../Firestore/calculation-run-service';
import { EmployeeService } from '../Firestore/employee-service';
import { OfficeService } from '../Firestore/office-service';
import { InsuranceRates } from '../Firestore/insurance-rates';
import { PayrollService } from '../Firestore/payroll-service';
import { DependentService } from '../Firestore/dependent-service';
import { EmployeeEventApprovalService } from '../logic/employee-event-approval.service';
import { determineDependentChangeType } from '../logic/dependent-change-event.service';
import { isEmploymentChangeSystemRun } from '../logic/event-id-service';
import {
  formatDisabilityForDisplay,
  formatStudentForDisplay,
} from '../common/dependent-field.util';

type PayrollSummary = {
  payrollId: string;
  paymentYearMonth?: string;
  actualPaymentAmount?: number;
  actualWorkingDays?: number;
};

@Injectable({
  providedIn: 'root',
})
export class SocialInsuranceFormCsvService {
  private employeeService = inject(EmployeeService);
  private officeService = inject(OfficeService);
  private insuranceRates = inject(InsuranceRates);
  private payrollService = inject(PayrollService);
  private dependentService = inject(DependentService);
  private employeeEventApprovalService = inject(EmployeeEventApprovalService);

  private readonly dependentCsvHeaders = [
    '社員ID',
    '扶養者ID',
    '名前',
    '生年月日',
    '続柄',
    '扶養状況',
    '扶養開始日',
    '扶養終了日',
    '同居・別居区分',
    '収入額（年収見込み）',
    '職業',
    '障害',
    '学生',
  ] as const;

  async exportHireEventsCsv(events: EmployeeEventItem[], monthKey: string): Promise<void> {
    const headers = [
      '事業所整理記号',
      '事業所番号',
      '被保険者整理番号',
      '基礎年金番号',
      '氏名',
      '生年月日',
      '取得年月日',
      '報酬月額',
      '標準報酬月額',
      '健康保険取得区分',
      '厚生年金取得区分',
      '雇用形態',
      '短時間労働者区分',
    ];

    const body: (string | number)[][] = [];
    for (const event of events) {
      const employeeId = event.employeeId;
      const employee = await this.resolveHireEmployee(employeeId, event);
      if (!employee) continue;

      const office = await this.resolveOffice(employee);
      const insurance = employee.insurance ?? {};
      const employment = employee.employmentContract ?? {};
      const grade = Number(insurance.currentGrade ?? 0);
      const acquiredTimestamp = insurance.healthInsurance?.acquiredDate
        ?? insurance.employeePensionInsurance?.acquiredDate
        ?? event.occurredDate;
      const targetYearMonth = this.toYearMonthKey(acquiredTimestamp) ?? monthKey.slice(0, 7);
      const standardAmount = grade
        ? await this.getStandardAmountByGrade(grade, targetYearMonth)
        : undefined;

      body.push([
        office.symbol,
        office.number,
        employeeId,
        String(insurance.basicPensionNumber ?? ''),
        `${employee.firstName ?? ''} ${employee.lastName ?? ''}`.trim(),
        this.formatDateSlash(employee.birthDate),
        this.formatDateSlash(acquiredTimestamp),
        Number(employment.fixedSalary ?? ''),
        standardAmount ?? '',
        this.acquisitionCode(insurance.healthInsurance),
        this.acquisitionCode(insurance.employeePensionInsurance),
        String(employment.employmentCategory ?? ''),
        this.shortTimeWorkerCategory(employment),
      ]);
    }

    this.downloadCsv(headers, body, `hire-events-${monthKey}.csv`);
  }

  async exportApprovedRetireEventsCsv(
    retireEvents: EmployeeEventItem[],
    retireRuns: SystemCalculationRunItem[],
    monthKey: string,
  ): Promise<void> {
    const headers = [
      '事業所整理記号',
      '被保険者整理番号',
      '基礎年金番号',
      '氏名',
      '喪失年月日',
      '喪失原因',
      '退職年月日',
    ];

    const body: (string | number)[][] = [];

    for (const event of retireEvents.filter(item => item.approval?.approvalStatus === '承認済み')) {
      const employeeId = event.employeeId;
      const employee = await this.resolveEmployee(employeeId, event);
      if (!employee) continue;

      const office = await this.resolveOffice(employee);
      const after = (event.payload?.['after'] ?? {}) as Record<string, unknown>;
      const insurance = (after['insurance'] ?? employee.insurance ?? {}) as Record<string, unknown>;
      const employment = (after['employmentContract'] ?? employee.employmentContract ?? {}) as Record<string, unknown>;
      const resignationTimestamp = (after['resignationDate'] as Timestamp | undefined)
        ?? (employment['resignationDate'] as Timestamp | undefined)
        ?? employee.resignationDate
        ?? event.occurredDate;
      const resignationDate = this.formatDateSlash(resignationTimestamp);
      const lostDate = this.formatDateSlash(this.addDays(resignationTimestamp, 1));

      body.push([
        office.symbol,
        employeeId,
        String(insurance['basicPensionNumber'] ?? employee.insurance?.basicPensionNumber ?? ''),
        `${employee.firstName ?? ''} ${employee.lastName ?? ''}`.trim(),
        lostDate,
        '退職',
        resignationDate,
      ]);
    }

    for (const run of retireRuns.filter(item => item.approval?.approvalStatus === '承認済み')) {
      const employeeId = String(run.payload?.['employeeId'] ?? run.targetEmployeeIds ?? '');
      const employee = await this.employeeService.getEmployeeByEmployeeId(employeeId);
      if (!employee) continue;

      const office = await this.resolveOffice(employee);
      const insurance = (run.payload?.['after'] as Record<string, unknown> | undefined)?.['insurance'] as Record<string, unknown> | undefined
        ?? employee.insurance as unknown as Record<string, unknown>;
      const employment = (run.payload?.['after'] as Record<string, unknown> | undefined)?.['employmentContract'] as Record<string, unknown> | undefined
        ?? employee.employmentContract as unknown as Record<string, unknown>;
      const resignationTimestamp = (run.payload?.['after'] as Record<string, unknown> | undefined)?.['resignationDate'] as Timestamp | undefined
        ?? (employment?.['resignationDate'] as Timestamp | undefined)
        ?? employee.resignationDate
        ?? (run.payload?.['occurredDate'] as Timestamp | undefined);
      const resignationDate = this.formatDateSlash(resignationTimestamp);
      const lostDate = this.formatDateSlash(this.addDays(resignationTimestamp, 1));

      body.push([
        office.symbol,
        employeeId,
        String(insurance?.['basicPensionNumber'] ?? employee.insurance?.basicPensionNumber ?? ''),
        `${employee.firstName ?? ''} ${employee.lastName ?? ''}`.trim(),
        lostDate,
        '退職',
        resignationDate,
      ]);
    }

    this.downloadCsv(headers, body, `retire-events-${monthKey}.csv`);
  }

  async exportApprovedFixedSalaryCsv(runs: SystemCalculationRunItem[], monthKey: string): Promise<void> {
    const headers = [
      '被保険者整理番号',
      '改定年月',
      '固定的賃金変更日',
      '変更前標準報酬',
      '変更後標準報酬候補',
      '1か月目報酬',
      '2か月目報酬',
      '3か月目報酬',
      '各月支払基礎日数',
      '昇給・降給区分',
    ];

    const body: (string | number)[][] = [];
    const approvedRuns = runs.filter(run => run.approval?.approvalStatus === '承認済み');

    for (const run of approvedRuns) {
      const employeeId = String(run.payload?.['employeeId'] ?? run.targetEmployeeIds ?? '');
      const employee = await this.employeeService.getEmployeeByEmployeeId(employeeId);
      if (!employee) continue;

      const summary = (run.payload?.['revisionSummary'] ?? {}) as Record<string, unknown>;
      const currentGrade = Number(summary['currentGrade'] ?? run.payload?.['currentGrade'] ?? 0);
      const approvedGrade = Number(
        summary['approvedGrade']
          ?? run.payload?.['approvedGrade']
          ?? summary['calculatedGrade']
          ?? run.payload?.['calculatedGrade']
          ?? 0,
      );
      const changeDate = (run.payload?.['occurredDate'] as Timestamp | undefined)?.toDate()
        ?? (run.payload?.['fixedSalaryChangeDate'] as Timestamp | undefined)?.toDate()
        ?? run.detectedDate?.toDate()
        ?? new Date();
      const revisionDate = this.addMonthsPreserveDay(changeDate, 3);
      const targetYearMonth = `${revisionDate.getFullYear()}-${String(revisionDate.getMonth() + 1).padStart(2, '0')}`;
      const beforeStandard = currentGrade
        ? await this.getStandardAmountByGrade(currentGrade, targetYearMonth)
        : undefined;
      const afterStandard = approvedGrade
        ? await this.getStandardAmountByGrade(approvedGrade, targetYearMonth)
        : undefined;

      const payrollSummaries = await this.resolveRevisionPayrolls(employeeId, run);
      const month1 = payrollSummaries[0];
      const month2 = payrollSummaries[1];
      const month3 = payrollSummaries[2];

      body.push([
        employeeId,
        this.formatYearMonthSlash(revisionDate),
        this.formatDateSlash(changeDate),
        beforeStandard ?? '',
        afterStandard ?? '',
        month1?.actualPaymentAmount ?? '',
        month2?.actualPaymentAmount ?? '',
        month3?.actualPaymentAmount ?? '',
        [month1?.actualWorkingDays, month2?.actualWorkingDays, month3?.actualWorkingDays]
          .map(value => value ?? '')
          .join('/'),
        this.salaryChangeCategory(currentGrade, approvedGrade),
      ]);
    }

    this.downloadCsv(headers, body, `fixed-salary-revision-${monthKey}.csv`);
  }

  exportDependentChangeEventsCsv(
    events: EmployeeEventItem[],
    monthKey: string,
    changeType: ChangeType,
  ): void {
    const headers = [...this.dependentCsvHeaders];
    const filtered = events.filter(event => {
      if (event.lifeEventType === '退社') return false;
      if (!this.isApprovedOrApplied(event.approval?.approvalStatus)) return false;
      return this.resolveDependentChangeType(event) === changeType;
    });

    if (filtered.length === 0) {
      alert('出力対象の扶養イベントがありません');
      return;
    }

    const body = filtered
      .map(event => this.dependentEventToCsvRow(event))
      .filter((row): row is (string | number)[] => row !== null);

    const suffix = changeType === '追加' ? 'acquisition' : changeType === '削除' ? 'loss' : 'change';
    this.downloadCsv(headers, body, `dependent-${suffix}-${monthKey}.csv`);
  }

  async exportMaternityLeaveCsv(events: EmployeeEventItem[], monthKey: string): Promise<void> {
    const headers = ['社員ID', '出産予定日', '休業開始日', '終了予定日'];
    const filtered = events.filter(event =>
      this.isApprovedOrApplied(event.approval?.approvalStatus)
      && this.isMaternityLeaveEvent(event),
    );

    if (filtered.length === 0) {
      alert('出力対象の産休イベントがありません');
      return;
    }

    const body = filtered.map(event => {
      const after = event.payload?.['after'] as Employee | undefined;
      const expectedBirthDate = event.payload?.['expectedBirthDate'] as Timestamp | undefined;
      const leaveStart = after?.leaveStartDate ?? event.occurredDate;
      const leaveEnd = after?.leaveEndDate;
      return [
        event.employeeId,
        this.formatDateSlash(expectedBirthDate),
        this.formatDateSlash(leaveStart),
        this.formatDateSlash(leaveEnd),
      ];
    });

    this.downloadCsv(headers, body, `maternity-leave-${monthKey}.csv`);
  }

  async exportParentalLeaveCsv(events: EmployeeEventItem[], monthKey: string): Promise<void> {
    const headers = ['社員ID', '子どもの名前', '子どもの生年月日', '休業開始日', '終了予定日'];
    const filtered = events.filter(event =>
      this.isApprovedOrApplied(event.approval?.approvalStatus)
      && this.isParentalLeaveEvent(event),
    );

    if (filtered.length === 0) {
      alert('出力対象の育休イベントがありません');
      return;
    }

    const body: (string | number)[][] = [];
    for (const event of filtered) {
      const after = event.payload?.['after'] as Employee | undefined;
      const expectedBirthDate = event.payload?.['expectedBirthDate'] as Timestamp | undefined;
      const leaveStart = after?.leaveStartDate ?? event.occurredDate;
      const leaveEnd = after?.leaveEndDate;
      const childName = await this.resolveChildName(event.employeeId, expectedBirthDate);
      body.push([
        event.employeeId,
        childName,
        this.formatDateSlash(expectedBirthDate),
        this.formatDateSlash(leaveStart),
        this.formatDateSlash(leaveEnd),
      ]);
    }

    this.downloadCsv(headers, body, `parental-leave-${monthKey}.csv`);
  }

  async exportInsuranceAcquisitionCsv(runs: SystemCalculationRunItem[], monthKey: string): Promise<void> {
    const headers = [
      '事業所整理記号',
      '事業所番号',
      '被保険者整理番号',
      '基礎年金番号',
      '氏名',
      '生年月日',
      '取得年月日',
      '報酬月額',
      '標準報酬月額',
      '健康保険取得区分',
      '厚生年金取得区分',
      '雇用形態',
      '短時間労働者区分',
      '対象保険',
      '資格変更原因',
    ];

    const filtered = this.filterMonthlyInsuranceCsvRuns(runs)
      .filter(run => this.isApprovedOrApplied(run.approval?.approvalStatus) && this.isAcquisitionRun(run));
    if (filtered.length === 0) {
      alert('出力対象の資格取得がありません');
      return;
    }

    const body: (string | number)[][] = [];
    for (const run of filtered) {
      const row = await this.buildAcquisitionCsvRow(run, monthKey);
      if (row) body.push(row);
    }

    if (body.length === 0) {
      alert('出力対象の資格取得がありません');
      return;
    }

    this.downloadCsv(headers, body, `insurance-acquisition-${monthKey}.csv`);
  }

  async exportInsuranceLossCsv(runs: SystemCalculationRunItem[], monthKey: string): Promise<void> {
    const headers = [
      '事業所整理記号',
      '被保険者整理番号',
      '基礎年金番号',
      '氏名',
      '喪失年月日',
      '喪失原因',
      '退職年月日',
      '対象保険',
      '資格変更原因',
    ];

    const filtered = this.filterMonthlyInsuranceCsvRuns(runs)
      .filter(run => this.isApprovedOrApplied(run.approval?.approvalStatus) && this.isLossRun(run));
    if (filtered.length === 0) {
      alert('出力対象の資格喪失がありません');
      return;
    }

    const body: (string | number)[][] = [];
    for (const run of filtered) {
      const row = await this.buildLossCsvRow(run);
      if (row) body.push(row);
    }

    if (body.length === 0) {
      alert('出力対象の資格喪失がありません');
      return;
    }

    this.downloadCsv(headers, body, `insurance-loss-${monthKey}.csv`);
  }

  async exportCalculationBaseCsv(
    runs: CalculationRun[],
    year: number,
    suffix = '',
  ): Promise<void> {
    const headers = [
      '被保険者整理番号',
      '氏名',
      '4月報酬',
      '5月報酬',
      '6月報酬',
      '4月支払基礎日数',
      '5月支払基礎日数',
      '6月支払基礎日数',
      '修正平均額',
      '従前標準報酬',
      '決定後標準報酬',
    ];

    const body: (string | number)[][] = [];
    const targetYearMonth = `${year}-06`;

    for (const run of runs) {
      const employeeId = String(run.payload?.['employeeId'] ?? run.targetEmployeeIds ?? '');
      const employeeName = String(run.payload?.['employeeName'] ?? '');
      const payrolls = (run.payload?.['targetPayrolls'] ?? []) as PayrollSummary[];
      const april = this.findMonthPayroll(payrolls, year, 4);
      const may = this.findMonthPayroll(payrolls, year, 5);
      const june = this.findMonthPayroll(payrolls, year, 6);
      const currentGrade = Number(run.payload?.['currentGrade'] ?? 0);
      const approvedGrade = Number(run.payload?.['approvedGrade'] ?? run.payload?.['calculatedGrade'] ?? 0);
      const beforeStandard = currentGrade
        ? await this.getStandardAmountByGrade(currentGrade, targetYearMonth)
        : undefined;
      const afterStandard = approvedGrade
        ? await this.getStandardAmountByGrade(approvedGrade, targetYearMonth)
        : undefined;

      body.push([
        employeeId,
        employeeName,
        april?.actualPaymentAmount ?? '',
        may?.actualPaymentAmount ?? '',
        june?.actualPaymentAmount ?? '',
        april?.actualWorkingDays ?? '',
        may?.actualWorkingDays ?? '',
        june?.actualWorkingDays ?? '',
        run.payload?.['averageSalary'] ?? '',
        beforeStandard ?? '',
        afterStandard ?? '',
      ]);
    }

    this.downloadCsv(headers, body, `calculation-base-${year}${suffix}.csv`);
  }

  exportConfirmedBonusCsv(
    rows: {
      employeeId: string;
      employeeName: string;
      paymentDate?: Timestamp;
      bonusAmount: number;
      standardBonusAmount: number;
    }[],
    payrollId: string,
  ): void {
    const headers = [
      '被保険者整理番号',
      '氏名',
      '賞与支給年月日',
      '賞与額',
      '標準賞与額',
    ];

    const body = rows.map(row => [
      row.employeeId,
      row.employeeName,
      this.formatDateSlash(row.paymentDate),
      row.bonusAmount,
      row.standardBonusAmount,
    ]);

    this.downloadCsv(headers, body, `bonus-form-${payrollId}.csv`);
  }

  private async resolveRevisionPayrolls(employeeId: string, run: SystemCalculationRunItem): Promise<PayrollSummary[]> {
    let payloadPayrolls = (run.payload?.['targetPayrolls'] ?? []) as PayrollSummary[];

    if (payloadPayrolls.length < 3) {
      const changeDate = (run.payload?.['occurredDate'] as Timestamp | undefined)?.toDate()
        ?? (run.payload?.['fixedSalaryChangeDate'] as Timestamp | undefined)?.toDate()
        ?? run.detectedDate?.toDate()
        ?? new Date();
      payloadPayrolls = [0, 1, 2].map(offset => {
        const monthDate = this.addMonthsPreserveDay(changeDate, offset);
        const payrollId = `${monthDate.getFullYear()}-${String(monthDate.getMonth() + 1).padStart(2, '0')}`;
        return { payrollId };
      });
    }

    const payrollList = await this.payrollService.getPayrollListForEmployee(employeeId);
    const payrollMap = new Map(payrollList.map(payroll => [payroll.payrollId, payroll]));

    return payloadPayrolls.slice(0, 3).map(item => {
      const payroll = payrollMap.get(item.payrollId);
      return {
        payrollId: item.payrollId,
        actualPaymentAmount: item.actualPaymentAmount ?? payroll?.actualPaymentAmount,
        actualWorkingDays: item.actualWorkingDays ?? payroll?.actualWorkingDays,
        paymentYearMonth: payroll?.paymentDate
          ? `${payroll.paymentDate.toDate().getFullYear()}-${String(payroll.paymentDate.toDate().getMonth() + 1).padStart(2, '0')}`
          : item.paymentYearMonth,
      };
    });
  }

  private findMonthPayroll(payrolls: PayrollSummary[], year: number, month: number): PayrollSummary | undefined {
    const key = `${year}-${String(month).padStart(2, '0')}`;
    return payrolls.find(item => item.paymentYearMonth === key || item.payrollId?.includes(key));
  }

  private async resolveHireEmployee(employeeId: string, event: EmployeeEventItem): Promise<Employee | undefined> {
    const dbEmployee = await this.employeeService.getEmployeeByEmployeeId(employeeId);
    const after = event.payload?.['after'] as Employee | undefined;
    if (!after && !dbEmployee) return undefined;
    if (!after) return dbEmployee ?? undefined;

    return {
      ...dbEmployee,
      ...after,
      employeeId,
      insurance: {
        ...dbEmployee?.insurance,
        ...after.insurance,
        healthInsurance: { ...dbEmployee?.insurance?.healthInsurance, ...after.insurance?.healthInsurance },
        nursingCareInsurance: { ...dbEmployee?.insurance?.nursingCareInsurance, ...after.insurance?.nursingCareInsurance },
        employeePensionInsurance: { ...dbEmployee?.insurance?.employeePensionInsurance, ...after.insurance?.employeePensionInsurance },
      },
      employmentContract: {
        ...dbEmployee?.employmentContract,
        ...after.employmentContract,
      },
    } as Employee;
  }

  private async getStandardAmountByGrade(grade: number, targetYearMonth: string): Promise<number | undefined> {
    const year = targetYearMonth.slice(0, 4);
    return this.insuranceRates.getStandardMonthlyAmount(year, grade, targetYearMonth);
  }

  private toYearMonthKey(value?: Timestamp | Date | null): string | undefined {
    if (!value) return undefined;
    const date = value instanceof Timestamp ? value.toDate() : value;
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return undefined;
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  }

  private salaryChangeCategory(currentGrade: number, approvedGrade: number): number | '' {
    if (!currentGrade || !approvedGrade || currentGrade === approvedGrade) return '';
    return approvedGrade > currentGrade ? 1 : 2;
  }

  private addDays(value?: Timestamp | Date | null, days = 1): Date | undefined {
    if (!value) return undefined;
    const date = value instanceof Timestamp ? value.toDate() : new Date(value);
    if (Number.isNaN(date.getTime())) return undefined;
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
  }

  private async resolveEmployee(employeeId: string, event?: EmployeeEventItem): Promise<Employee | undefined> {
    const fromDb = await this.employeeService.getEmployeeByEmployeeId(employeeId);
    if (fromDb) return fromDb;

    const after = event?.payload?.['after'] as Employee | undefined;
    return after;
  }

  private async resolveOffice(employee: Employee): Promise<{ symbol: string; number: string }> {
    const officeId = employee.employmentContract?.officeId;
    if (!officeId) {
      return { symbol: '', number: '' };
    }
    await this.officeService.getAllOffice();
    const office = this.officeService.allOffices().find(item => item.officeId === officeId);
    return {
      symbol: office?.officeOrganizationSymbol ?? '',
      number: office?.officeNumber ?? '',
    };
  }

  private acquisitionCode(detail?: Record<string, unknown> | { joined?: boolean }): number {
    if (!detail) return 0;
    return detail['joined'] === true || (detail as { joined?: boolean }).joined === true ? 1 : 0;
  }

  private shortTimeWorkerCategory(employment?: Employee['employmentContract']): number {
    const category = employment?.employmentCategory ?? '';
    const workStyle = employment?.workStyle ?? '';
    const isFullTimeRegular = category === '正社員' && workStyle === 'フルタイム';
    const isFullTimeContract = category === '契約社員' && workStyle === 'フルタイム';
    return isFullTimeRegular || isFullTimeContract ? 0 : 1;
  }

  private addMonthsPreserveDay(date: Date, months: number): Date {
    const result = new Date(date);
    const day = result.getDate();
    result.setMonth(result.getMonth() + months);
    if (result.getDate() !== day) {
      result.setDate(0);
    }
    return result;
  }

  private formatYearMonthSlash(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    return `${y}/${m}`;
  }

  private formatDateSlash(value?: Timestamp | Date | null): string {
    if (!value) return '';
    const date = value instanceof Timestamp ? value.toDate() : value;
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}/${m}/${d}`;
  }

  private isApprovedOrApplied(status?: string): boolean {
    return status === '承認済み' || status === '適用済み';
  }

  private resolveDependentChangeType(event: Event): ChangeType {
    if (event.changeType === '追加' || event.changeType === '削除' || event.changeType === '変更') {
      return event.changeType;
    }
    const before = event.payload?.['before'] as Dependent | null | undefined;
    const after = event.payload?.['after'] as Dependent | undefined;
    if (!after) return '変更';
    return determineDependentChangeType(before ?? null, after);
  }

  private dependentEventToCsvRow(event: EmployeeEventItem): (string | number)[] | null {
    const after = event.payload?.['after'] as Dependent | undefined;
    if (!after) return null;

    return [
      event.employeeId,
      after.dependentId ?? '',
      after.name ?? '',
      this.formatDateSlash(after.birthDate),
      after.relationship ?? '',
      after.isDependent !== false ? '扶養対象' : '扶養対象外',
      this.formatDateSlash(after.dependentStartDate),
      this.formatDateSlash(after.dependentEndDate),
      after.cohabitationType ?? '',
      after.annualIncome != null ? String(after.annualIncome) : '',
      after.occupation ?? '',
      formatDisabilityForDisplay(after),
      formatStudentForDisplay(after),
    ];
  }

  private isMaternityLeaveEvent(event: Event): boolean {
    const after = event.payload?.['after'] as Employee | undefined;
    return after?.leaveTypes === '産前産後';
  }

  private isParentalLeaveEvent(event: Event): boolean {
    const after = event.payload?.['after'] as Employee | undefined;
    return after?.leaveTypes === '育児';
  }

  private async resolveChildName(employeeId: string, birthDate?: Timestamp): Promise<string> {
    const dependents = await this.dependentService.getDependents(employeeId);
    if (birthDate) {
      const birthMillis = birthDate.toMillis();
      const matched = dependents.find(dependent =>
        dependent.birthDate?.toMillis() === birthMillis,
      );
      if (matched?.name) return matched.name;
    }
    const child = dependents.find(dependent => dependent.relationship === '子');
    return child?.name ?? '';
  }

  private isAcquisitionRun(run: SystemCalculationRunItem): boolean {
    if (run.type === '資格取得') return true;
    if (run.type === 'イベント' && run.payload?.['qualificationType'] === '資格取得') return true;
    if (isEmploymentChangeSystemRun(run) && run.type !== '資格喪失') {
      return this.hasEmploymentInsuranceAcquisition(run);
    }
    return false;
  }

  private isLossRun(run: SystemCalculationRunItem): boolean {
    if (run.type === '資格喪失') return true;
    if (run.type === 'イベント' && run.payload?.['qualificationType'] === '資格喪失') return true;
    if (isEmploymentChangeSystemRun(run) && run.type !== '資格取得') {
      return this.hasEmploymentInsuranceLoss(run);
    }
    return false;
  }

  private filterMonthlyInsuranceCsvRuns(runs: SystemCalculationRunItem[]): SystemCalculationRunItem[] {
    return runs.filter(run => run.payload?.['source'] !== '保険情報変更');
  }

  private hasEmploymentInsuranceAcquisition(run: SystemCalculationRunItem): boolean {
    const before = this.extractRunInsuranceSnapshot(run.payload?.['before']);
    const after = this.extractRunInsuranceSnapshot(run.payload?.['after']);
    const keys = ['healthInsurance', 'nursingCareInsurance', 'employeePensionInsurance'] as const;
    return keys.some(key => !before?.[key]?.joined && after?.[key]?.joined === true);
  }

  private hasEmploymentInsuranceLoss(run: SystemCalculationRunItem): boolean {
    const before = this.extractRunInsuranceSnapshot(run.payload?.['before']);
    const after = this.extractRunInsuranceSnapshot(run.payload?.['after']);
    const keys = ['healthInsurance', 'nursingCareInsurance', 'employeePensionInsurance'] as const;
    return keys.some(key => before?.[key]?.joined === true && after?.[key]?.joined !== true);
  }

  private extractRunInsuranceSnapshot(payload: unknown): EmployeeInsurance | undefined {
    if (!payload || typeof payload !== 'object') return undefined;
    const data = payload as Record<string, unknown>;
    if (data['insurance']) return data['insurance'] as EmployeeInsurance;
    if (
      'healthInsurance' in data
      || 'nursingCareInsurance' in data
      || 'employeePensionInsurance' in data
      || 'currentGrade' in data
    ) {
      return data as EmployeeInsurance;
    }
    return undefined;
  }

  private resolveRunInsurance(
    run: SystemCalculationRunItem,
    employee: Employee,
  ): EmployeeInsurance {
    const before = this.extractRunInsuranceSnapshot(run.payload?.['before']);
    const after = this.extractRunInsuranceSnapshot(run.payload?.['after']);
    const merged: EmployeeInsurance = {
      currentGrade: employee.insurance?.currentGrade ?? 0,
      basicPensionNumber: employee.insurance?.basicPensionNumber,
      healthInsurance: employee.insurance?.healthInsurance ?? { joined: false },
      nursingCareInsurance: employee.insurance?.nursingCareInsurance ?? { joined: false },
      employeePensionInsurance: employee.insurance?.employeePensionInsurance ?? { joined: false },
    };

    if (before?.currentGrade !== undefined) merged.currentGrade = before.currentGrade;
    if (after?.currentGrade !== undefined) merged.currentGrade = after.currentGrade;
    if (before?.basicPensionNumber !== undefined) merged.basicPensionNumber = before.basicPensionNumber;
    if (after?.basicPensionNumber !== undefined) merged.basicPensionNumber = after.basicPensionNumber;
    if (before?.healthInsurance) merged.healthInsurance = { ...merged.healthInsurance, ...before.healthInsurance };
    if (after?.healthInsurance) merged.healthInsurance = { ...merged.healthInsurance, ...after.healthInsurance };
    if (before?.nursingCareInsurance) merged.nursingCareInsurance = { ...merged.nursingCareInsurance, ...before.nursingCareInsurance };
    if (after?.nursingCareInsurance) merged.nursingCareInsurance = { ...merged.nursingCareInsurance, ...after.nursingCareInsurance };
    if (before?.employeePensionInsurance) merged.employeePensionInsurance = { ...merged.employeePensionInsurance, ...before.employeePensionInsurance };
    if (after?.employeePensionInsurance) merged.employeePensionInsurance = { ...merged.employeePensionInsurance, ...after.employeePensionInsurance };

    return merged;
  }

  private resolveRunInsuranceDate(
    run: SystemCalculationRunItem,
    insurance: EmployeeInsurance,
    kind: 'acquired' | 'lost',
  ): Timestamp | undefined {
    type InsuranceDetailKey = 'healthInsurance' | 'nursingCareInsurance' | 'employeePensionInsurance';
    const defaultKeys: InsuranceDetailKey[] = ['healthInsurance', 'nursingCareInsurance', 'employeePensionInsurance'];
    const keys = String(run.payload?.['insuranceKey'] ?? '')
      .split(',')
      .map(key => key.trim())
      .filter((key): key is InsuranceDetailKey =>
        key === 'healthInsurance' || key === 'nursingCareInsurance' || key === 'employeePensionInsurance',
      );

    const targetKeys: InsuranceDetailKey[] = keys.length > 0 ? keys : defaultKeys;

    for (const key of targetKeys) {
      const detail = insurance[key];
      const date = kind === 'acquired' ? detail?.acquiredDate : detail?.lostDate;
      if (date) return date;
    }

    return run.detectedDate as Timestamp | undefined;
  }

  private async buildAcquisitionCsvRow(
    run: SystemCalculationRunItem,
    monthKey: string,
  ): Promise<(string | number)[] | null> {
    const employeeId = run.employeeId;
    const employee = await this.employeeService.getEmployeeByEmployeeId(employeeId);
    if (!employee) return null;

    const insurance = this.resolveRunInsurance(run, employee);
    const office = await this.resolveOffice(employee);
    const employment = employee.employmentContract ?? {};
    const grade = Number(insurance.currentGrade ?? employee.insurance?.currentGrade ?? 0);
    const acquiredTimestamp = this.resolveRunInsuranceDate(run, insurance, 'acquired')
      ?? (run.payload?.['occurredDate'] as Timestamp | undefined)
      ?? run.detectedDate;
    const targetYearMonth = this.toYearMonthKey(acquiredTimestamp) ?? monthKey.slice(0, 7);
    const standardAmount = grade
      ? await this.getStandardAmountByGrade(grade, targetYearMonth)
      : undefined;

    return [
      office.symbol,
      office.number,
      employeeId,
      String(insurance.basicPensionNumber ?? employee.insurance?.basicPensionNumber ?? ''),
      `${employee.firstName ?? ''} ${employee.lastName ?? ''}`.trim(),
      this.formatDateSlash(employee.birthDate),
      this.formatDateSlash(acquiredTimestamp),
      Number(employment.fixedSalary ?? ''),
      standardAmount ?? '',
      this.acquisitionCode(insurance.healthInsurance),
      this.acquisitionCode(insurance.employeePensionInsurance),
      String(employment.employmentCategory ?? ''),
      this.shortTimeWorkerCategory(employment),
      this.employeeEventApprovalService.getInsuranceChangeLabel(run),
      this.employeeEventApprovalService.getInsuranceChangeReasonLabel(run),
    ];
  }

  private async buildLossCsvRow(run: SystemCalculationRunItem): Promise<(string | number)[] | null> {
    const employeeId = run.employeeId;
    const employee = await this.employeeService.getEmployeeByEmployeeId(employeeId);
    if (!employee) return null;

    const office = await this.resolveOffice(employee);
    const mergedInsurance = this.resolveRunInsurance(run, employee);
    const insuranceKey = run.payload?.['insuranceKey'] as keyof Pick<
      EmployeeInsurance,
      'healthInsurance' | 'nursingCareInsurance' | 'employeePensionInsurance'
    > | undefined;
    const insuranceDetail = insuranceKey && !String(insuranceKey).includes(',')
      ? mergedInsurance[insuranceKey]
      : undefined;

    const resignationTimestamp = run.payload?.['source'] === '退社'
      ? ((run.payload?.['occurredDate'] as Timestamp | undefined) ?? employee.resignationDate)
      : undefined;
    const lostTimestamp = insuranceDetail?.lostDate
      ?? this.resolveRunInsuranceDate(run, mergedInsurance, 'lost')
      ?? (run.payload?.['occurredDate'] as Timestamp | undefined)
      ?? run.detectedDate;
    const lostDate = this.formatDateSlash(
      resignationTimestamp ? this.addDays(resignationTimestamp, 1) : lostTimestamp,
    );
    const resignationDate = resignationTimestamp ? this.formatDateSlash(resignationTimestamp) : '';
    const lossReason = run.payload?.['source'] === '退社' ? '退職' : '資格喪失';

    return [
      office.symbol,
      employeeId,
      String(mergedInsurance.basicPensionNumber ?? employee.insurance?.basicPensionNumber ?? ''),
      `${employee.firstName ?? ''} ${employee.lastName ?? ''}`.trim(),
      lostDate,
      lossReason,
      resignationDate,
      this.employeeEventApprovalService.getInsuranceChangeLabel(run),
      this.employeeEventApprovalService.getInsuranceChangeReasonLabel(run),
    ];
  }

  private downloadCsv(headers: string[], body: (string | number)[][], fileName: string): void {
    const csv = [
      headers,
      ...body,
    ].map(row => row.map(value => this.escapeCsvValue(value)).join(',')).join('\r\n');

    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
  }

  private escapeCsvValue(value: string | number): string {
    const text = String(value ?? '');
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }
}
