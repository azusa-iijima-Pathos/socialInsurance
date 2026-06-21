import { Component, inject } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Payroll } from '../../../model/payroll';
import { PayrollService } from '../../../service/Firestore/payroll-service';
import { CommonService } from '../../../service/common/common-service';
import { CommonModule } from '@angular/common';
import { EmployeeService } from '../../../service/Firestore/employee-service';
import { Employee, InsuranceDetail } from '../../../model/employee';
import { OfficeService } from '../../../service/Firestore/office-service';
import { EmployeeLogicService } from '../../../service/logic/employee-logic-service';
import { CompanyService } from '../../../service/Firestore/company-service';
import { InsuranceConfirmCsvService } from '../../../service/CSV/insurance-confirm-csv-service';
import { InsuranceSnapshotService } from '../../../service/Firestore/insurance-snapshot-service';
import { InsuranceSnapshot } from '../../../model/insurance-snapshot';
import { InsuranceRates } from '../../../service/Firestore/insurance-rates';
import { FormsModule } from '@angular/forms';
import { InsuranceDraftService } from '../../../service/Firestore/insurance-draft-service';
import { InsuranceDraft } from '../../../model/insurance-draft';
import { CalculationRunService } from '../../../service/Firestore/calculation-run-service';
import { CalculationRun } from '../../../model/calculation-run';
import { InsuranceDisplayService, InsuranceNoticeSummary, OfficeInsuranceSummary } from '../../../service/logic/insurance-display.service';
import { CorrectionLogicService } from '../../../service/logic/correction-logic.service';
import {
  isMaternityOrChildcareLeaveOverlappingPeriod,
  resolvePayrollTargetPeriodBounds,
} from '../../../service/logic/leave-insurance.util';
import { PayrollLockService } from '../../../service/Firestore/payroll-lock-service';
import { ReachAgeService } from '../../../service/logic/reach-age';
import {
  shouldCollectInsurancePremium,
} from '../../../service/logic/insurance-premium-collection.util';
import { parseMonthlyPayrollId } from '../../../service/logic/employee-enrollment.util';
import { InsuranceFormService } from '../../../service/logic/insurance-form.service';

type EmployeeInsurance = {
  employeeId: string;
  employeeName: string;
  hasPayrollData: boolean;
  actualWorkingDays: number;
  actualWorkingHours: number;
  fixedSalary: number;
  actualPaymentAmount: number;
  grade: number;
  gradeNote?: string;

  healthInsurance: number;
  nursingCareInsurance: number;
  pensionInsurance: number;

  healthInsuranceForCompany: number;
  nursingCareInsuranceForCompany: number;
  pensionInsuranceForCompany: number;

  healthInsuranceForEmployee: number;
  nursingCareInsuranceForEmployee: number;
  pensionInsuranceForEmployee: number;

  totalInsurance: number;
  totalInsuranceForCompany: number;
  totalInsuranceForEmployee: number;
  calculatedValues: InsuranceCalculatedValues;
}

type InsuranceCalculatedValues = {
  healthInsurance: number;
  nursingCareInsurance: number;
  pensionInsurance: number;
  healthInsuranceForCompany: number;
  nursingCareInsuranceForCompany: number;
  pensionInsuranceForCompany: number;
  healthInsuranceForEmployee: number;
  nursingCareInsuranceForEmployee: number;
  pensionInsuranceForEmployee: number;
};

type InsuranceSummary = InsuranceNoticeSummary;

type OutputViewMode = 'adjusted' | 'confirmed';


@Component({
  selector: 'app-insurance-confirm',
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './insurance-confirm.html',
  styleUrl: './insurance-confirm.css',
})
export class InsuranceConfirm {

  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private payrollService = inject(PayrollService);
  private employeeService = inject(EmployeeService);
  private officeService = inject(OfficeService);
  commonService = inject(CommonService);
  private employeeLogicService = inject(EmployeeLogicService);
  private companyService = inject(CompanyService);
  private insuranceConfirmCsvService = inject(InsuranceConfirmCsvService);
  private insuranceSnapshotService = inject(InsuranceSnapshotService);
  private insuranceDraftService = inject(InsuranceDraftService);
  private insuranceRates = inject(InsuranceRates);
  private calculationRunService = inject(CalculationRunService);
  private insuranceDisplayService = inject(InsuranceDisplayService);
  private correctionLogicService = inject(CorrectionLogicService);
  private payrollLockService = inject(PayrollLockService);
  private reachAgeService = inject(ReachAgeService);
  private insuranceFormService = inject(InsuranceFormService);

  companyId = sessionStorage.getItem('companyId');

  workingYear = Number(sessionStorage.getItem('workingYear'));
  workingMonth = Number(sessionStorage.getItem('workingMonth'));
  payrollId = '';

  //作業月の給与データ（従業員ID、給与データ）
  payrollData: Payroll[] = [];

  //従業員情報（等級と負担割合と事業所IDを使用）
  employeeData: Employee[] = [];

  //表示用データ
  dataForShow: EmployeeInsurance[] = [];
  insuranceDraftMap: Record<string, InsuranceDraft> = {};
  editMode = false;
  isOutputMode = false;
  outputViewMode: OutputViewMode = 'adjusted';
  outputYearMonth = '';
  fiscalYearLabel = '';
  differenceAdjustmentRuns: CalculationRun[] = [];
  confirmedOutputRows: EmployeeInsurance[] = [];
  adjustedOutputRows: EmployeeInsurance[] = [];
  fiscalYearSummary: InsuranceSummary = this.createEmptySummary();
  officeSummaries: OfficeInsuranceSummary[] = [];
  insuranceEditErrors: string[] = [];
  insuranceSummary: InsuranceSummary = this.createEmptySummary();

  async ngOnInit() {
    // //標準月額報酬を取得
    // await this.insuranceRates.getRemunerationData(this.workingYear.toString());

    await this.commonService.getCurrentTargetPeriod();

    //作業月が一致しない場合はリダイレクト
    const paramYear = this.route.snapshot.paramMap.get('workingYear');
    const paramMonth = this.route.snapshot.paramMap.get('workingMonth');
    this.isOutputMode = this.route.snapshot.queryParamMap.get('mode') === 'output';
    if (!this.isOutputMode && (Number(paramYear) !== this.workingYear || Number(paramMonth) !== this.workingMonth)) {
      this.router.navigate(['/insurance-confirm', this.workingYear, this.workingMonth]);
      return;
    }
    this.workingYear = Number(paramYear);
    this.workingMonth = Number(paramMonth);
    this.outputYearMonth = `${this.workingYear}-${String(this.workingMonth).padStart(2, '0')}`;

    await this.loadInsuranceConfirmData();
  }

  private async loadInsuranceConfirmData() {
    this.dataForShow = [];
    this.payrollData = [];
    this.employeeData = [];
    this.insuranceDraftMap = {};

    this.insuranceRates.resetCache();
    this.payrollId = `${this.workingYear}-${String(this.workingMonth).padStart(2, '0')}`;
    // this.editButtonDisabled = this.isOutputMode || await this.insuranceSnapshotService.hasInsuranceSnapshot(this.payrollId);
    await this.payrollService.getAllPayrollListForMonth(this.payrollId);
    this.payrollData = this.payrollService.allPayrollListForMonth().find(item => item.payrollId === this.payrollId)?.payrollList ?? [];

    await this.companyService.getCompany();
    await this.employeeService.getAllEmployees();
    this.employeeData = this.employeeService.employeesEligibleForPayrollPeriod(this.payrollId);
    const drafts = await this.insuranceDraftService.getDrafts(this.payrollId);
    this.insuranceDraftMap = drafts.reduce<Record<string, InsuranceDraft>>((map, draft) => {
      map[draft.employeeId] = draft;
      return map;
    }, {});

    this.differenceAdjustmentRuns = (await this.calculationRunService.getAllCalculationRuns())
      .filter(run => run.type === '差額調整');

    //従業員情報から保険料を取得
    if (this.isOutputMode) {
      await this.loadOutputModeData();
    } else {
      await this.getEmployeeInsurance(this.employeeData);
      await this.updateExtendedSummaries(false);
    }
  }

  setOutputViewMode(mode: OutputViewMode) {
    this.outputViewMode = mode;
    this.dataForShow = mode === 'adjusted' ? this.adjustedOutputRows : this.confirmedOutputRows;
    this.calculateInsuranceSummary();
    void this.updateExtendedSummaries(mode === 'adjusted');
  }

  private async loadOutputModeData() {
    await this.officeService.getAllOffice();
    this.confirmedOutputRows = [];
    this.adjustedOutputRows = [];
    const defaultPeriodBounds = await this.correctionLogicService.getPayrollPeriodBounds(this.payrollId);

    for (const employee of this.employeeData) {
      const payroll = this.payrollData.find(item => item.employeeId === employee.employeeId);
      const snapshot = await this.insuranceSnapshotService.getSnapshot(employee.employeeId, this.payrollId);
      if (!snapshot && !payroll) continue;

      const confirmedBreakdown = this.insuranceDisplayService.getSnapshotBreakdown(snapshot);
      const adjustedBreakdown = this.insuranceDisplayService.getAdjustedSnapshotBreakdown(
        snapshot,
        this.differenceAdjustmentRuns,
        employee.employeeId,
        this.payrollId,
      );

      const adjustedGrade = this.insuranceDisplayService.getAdjustedGrade(
        snapshot,
        this.differenceAdjustmentRuns,
        employee.employeeId,
        this.payrollId,
      );

      this.confirmedOutputRows.push(this.buildOutputRow(employee, payroll, snapshot, confirmedBreakdown, undefined, defaultPeriodBounds));
      this.adjustedOutputRows.push(this.buildOutputRow(employee, payroll, snapshot, adjustedBreakdown, adjustedGrade, defaultPeriodBounds));
    }

    this.setOutputViewMode(this.outputViewMode);
  }

  private buildOutputRow(
    employee: Employee,
    payroll: Payroll | undefined,
    snapshot: InsuranceSnapshot | null,
    breakdown: ReturnType<InsuranceDisplayService['getSnapshotBreakdown']>,
    gradeOverride?: number,
    defaultPeriodBounds?: { periodStart: Date; periodEnd: Date },
  ): EmployeeInsurance {
    const hasPayrollData = Boolean(payroll);
    const { periodStart, periodEnd } = defaultPeriodBounds
      ? resolvePayrollTargetPeriodBounds(payroll, defaultPeriodBounds)
      : { periodStart: new Date(), periodEnd: new Date() };
    const calculatedValues = {
      healthInsurance: breakdown.healthInsurance,
      nursingCareInsurance: breakdown.nursingCareInsurance,
      pensionInsurance: breakdown.pensionInsurance,
      healthInsuranceForCompany: breakdown.healthInsuranceForCompany,
      nursingCareInsuranceForCompany: breakdown.nursingCareInsuranceForCompany,
      pensionInsuranceForCompany: breakdown.pensionInsuranceForCompany,
      healthInsuranceForEmployee: breakdown.healthInsuranceForEmployee,
      nursingCareInsuranceForEmployee: breakdown.nursingCareInsuranceForEmployee,
      pensionInsuranceForEmployee: breakdown.pensionInsuranceForEmployee,
    };

    return {
      employeeId: employee.employeeId,
      employeeName: this.commonService.getEmployeeName(employee.employeeId)!,
      hasPayrollData,
      actualWorkingDays: payroll?.actualWorkingDays ?? 0,
      actualWorkingHours: payroll?.actualWorkingHours ?? 0,
      fixedSalary: payroll?.fixedSalary ?? 0,
      actualPaymentAmount: payroll?.actualPaymentAmount ?? 0,
      grade: gradeOverride ?? Number(snapshot?.grade ?? employee.insurance?.currentGrade ?? 0),
      gradeNote: this.getGradeDisplayNote(employee, periodStart, periodEnd),
      ...breakdown,
      calculatedValues,
    };
  }

  private async updateExtendedSummaries(useAdjusted: boolean) {
    const range = this.insuranceDisplayService.getFiscalYearRange(this.payrollId);
    this.fiscalYearLabel = range.label;
    this.fiscalYearSummary = await this.buildFiscalYearSummary(range.start, range.end, useAdjusted);
    await this.officeService.getAllOffice();
    this.officeSummaries = this.insuranceDisplayService.buildOfficeSummaries(
      this.dataForShow,
      this.employeeData,
      this.officeService.allOfficeNameMap(),
    );
  }

  private async buildFiscalYearSummary(start: string, end: string, useAdjusted: boolean): Promise<InsuranceSummary> {
    const months = this.insuranceDisplayService.enumerateYearMonths(start, end);
    const rows: ReturnType<InsuranceDisplayService['getSnapshotBreakdown']>[] = [];

    if (this.isOutputMode) {
      for (const employee of this.employeeData) {
        const snapshots = await this.insuranceSnapshotService.getSnapshotsForEmployee(employee.employeeId);
        const snapshotMap = new Map(snapshots.map(snapshot => [snapshot.payrollId ?? '', snapshot]));
        for (const monthPayrollId of months) {
          const snapshot = snapshotMap.get(monthPayrollId);
          if (!snapshot) continue;
          rows.push(
            useAdjusted
              ? this.insuranceDisplayService.getAdjustedSnapshotBreakdown(
                snapshot,
                this.differenceAdjustmentRuns,
                employee.employeeId,
                monthPayrollId,
              )
              : this.insuranceDisplayService.getSnapshotBreakdown(snapshot),
          );
        }
      }
      return this.insuranceDisplayService.summarizeRows(rows);
    }

    for (const monthPayrollId of months) {
      if (monthPayrollId === this.payrollId) {
        rows.push(...this.dataForShow.filter(item => item.hasPayrollData));
        continue;
      }

      for (const employee of this.employeeData) {
        const snapshot = await this.insuranceSnapshotService.getSnapshot(employee.employeeId, monthPayrollId);
        if (!snapshot) continue;
        rows.push(this.insuranceDisplayService.getAdjustedSnapshotBreakdown(
          snapshot,
          this.differenceAdjustmentRuns,
          employee.employeeId,
          monthPayrollId,
        ));
      }
    }

    return this.insuranceDisplayService.summarizeRows(rows);
  }

  private createEmptySummary(): InsuranceSummary {
    return {
      healthInsuranceNotice: 0,
      nursingCareInsuranceNotice: 0,
      pensionInsuranceNotice: 0,
      totalInsuranceNotice: 0,
      healthInsuranceForEmployee: 0,
      nursingCareInsuranceForEmployee: 0,
      pensionInsuranceForEmployee: 0,
      totalInsuranceForEmployee: 0,
      healthInsuranceForCompany: 0,
      nursingCareInsuranceForCompany: 0,
      pensionInsuranceForCompany: 0,
      totalInsuranceForCompany: 0,
    };
  }

  async changeOutputYearMonth() {
    const [year, month] = this.outputYearMonth.split('-').map(Number);
    this.workingYear = year;
    this.workingMonth = month;
    await this.router.navigate(['/insurance-confirm', year, month], { queryParams: { mode: 'output' } });
    await this.loadInsuranceConfirmData();
  }

  getOutputYearMonthOptions(): string[] {
    const sessionWorkingYear = Number(sessionStorage.getItem('workingYear'));
    const sessionWorkingMonth = Number(sessionStorage.getItem('workingMonth'));
    if (!sessionWorkingYear || !sessionWorkingMonth) return [];

    const options: string[] = [];
    let year = sessionWorkingYear;
    let month = sessionWorkingMonth - 1;

    for (let i = 0; i < 12; i++) {
      if (month < 1) {
        month = 12;
        year--;
      }
      options.push(`${year}-${String(month).padStart(2, '0')}`);
      month--;
    }
    return options;
  }


  private async getEmployeeInsurance(employees: Employee[]) {
    const defaultPeriodBounds = await this.correctionLogicService.getPayrollPeriodBounds(this.payrollId);
    const parsedTargetMonth = parseMonthlyPayrollId(this.payrollId);
    const targetYear = parsedTargetMonth?.year ?? this.workingYear;
    const targetMonth = parsedTargetMonth?.month ?? this.workingMonth;

    await this.officeService.getAllOffice();

    for (const employee of employees) {
      const payroll = this.payrollData.find(item => item.employeeId === employee.employeeId);
      const hasPayrollData = Boolean(payroll);
      const { periodStart, periodEnd } = resolvePayrollTargetPeriodBounds(payroll, defaultPeriodBounds);
      const zeroPremiumForLeave = isMaternityOrChildcareLeaveOverlappingPeriod(employee, periodStart, periodEnd);
      let prefecture = await this.officeService.getOfficeLocation(employee.employmentContract?.officeId ?? '');
      if (!prefecture) {
        prefecture = this.companyService.company()?.headOfficePrefecture ?? null;
      }
      const grade = Number(employee.insurance?.currentGrade ?? 0);
      const shouldCollectHealth = shouldCollectInsurancePremium(
        employee.insurance?.healthInsurance,
        targetYear,
        targetMonth,
      );
      const shouldCollectNursing = shouldCollectInsurancePremium(
        employee.insurance?.nursingCareInsurance,
        targetYear,
        targetMonth,
      );
      const shouldCollectPension = shouldCollectInsurancePremium(
        employee.insurance?.employeePensionInsurance,
        targetYear,
        targetMonth,
      );

      let insurance: Awaited<ReturnType<EmployeeLogicService['getInsuranceRate']>> | null = null;
      if (prefecture && grade > 0 && hasPayrollData) {
        try {
          insurance = await this.employeeLogicService.getInsuranceRate(prefecture, grade, this.payrollId);
        } catch (error) {
          console.error(`社員ID：${employee.employeeId} の保険料計算に失敗しました`, error);
        }
      }

      const healthInsuranceCompanyRate = employee.insurance?.healthInsurance?.companyBurdenRate ?? 50;
      const nursingCareInsuranceCompanyRate = employee.insurance?.nursingCareInsurance?.companyBurdenRate ?? 50;
      const pensionInsuranceCompanyRate = employee.insurance?.employeePensionInsurance?.companyBurdenRate ?? 50;
      const healthInsurance = this.normalizeInsuranceAmount(insurance?.healthInsurance ?? 0);
      const nursingCareInsurance = this.normalizeInsuranceAmount(insurance?.nursingCare ?? 0);
      const pensionInsurance = this.normalizeInsuranceAmount(insurance?.pension ?? 0);
      const healthInsuranceForEmployee = this.roundEmployeeBurden(healthInsurance * ((100 - healthInsuranceCompanyRate) / 100));
      const nursingCareInsuranceForEmployee = this.roundEmployeeBurden(nursingCareInsurance * ((100 - nursingCareInsuranceCompanyRate) / 100));
      const pensionInsuranceForEmployee = this.roundEmployeeBurden(pensionInsurance * ((100 - pensionInsuranceCompanyRate) / 100));
      const healthInsuranceForCompany = this.normalizeInsuranceAmount(healthInsurance * (healthInsuranceCompanyRate / 100));
      const nursingCareInsuranceForCompany = this.normalizeInsuranceAmount(nursingCareInsurance * (nursingCareInsuranceCompanyRate / 100));
      const pensionInsuranceForCompany = this.normalizeInsuranceAmount(pensionInsurance * (pensionInsuranceCompanyRate / 100));

      const calculatedValues: InsuranceCalculatedValues = {
        healthInsurance: shouldCollectHealth && !zeroPremiumForLeave && hasPayrollData ? healthInsurance : 0,
        nursingCareInsurance: shouldCollectNursing && !zeroPremiumForLeave && hasPayrollData ? nursingCareInsurance : 0,
        pensionInsurance: shouldCollectPension && !zeroPremiumForLeave && hasPayrollData ? pensionInsurance : 0,
        healthInsuranceForCompany: shouldCollectHealth && !zeroPremiumForLeave && hasPayrollData ? healthInsuranceForCompany : 0,
        nursingCareInsuranceForCompany: shouldCollectNursing && !zeroPremiumForLeave && hasPayrollData ? nursingCareInsuranceForCompany : 0,
        pensionInsuranceForCompany: shouldCollectPension && !zeroPremiumForLeave && hasPayrollData ? pensionInsuranceForCompany : 0,
        healthInsuranceForEmployee: shouldCollectHealth && !zeroPremiumForLeave && hasPayrollData ? healthInsuranceForEmployee : 0,
        nursingCareInsuranceForEmployee: shouldCollectNursing && !zeroPremiumForLeave && hasPayrollData ? nursingCareInsuranceForEmployee : 0,
        pensionInsuranceForEmployee: shouldCollectPension && !zeroPremiumForLeave && hasPayrollData ? pensionInsuranceForEmployee : 0,
      };

      let employeeInsurance: EmployeeInsurance = {
        employeeId: employee.employeeId,
        employeeName: this.commonService.getEmployeeName(employee.employeeId)!,
        hasPayrollData,
        actualWorkingDays: payroll?.actualWorkingDays ?? 0,
        actualWorkingHours: payroll?.actualWorkingHours ?? 0,
        fixedSalary: payroll?.fixedSalary ?? 0,
        actualPaymentAmount: payroll?.actualPaymentAmount ?? 0,
        grade: grade,
        gradeNote: this.getGradeDisplayNote(employee, periodStart, periodEnd),

        healthInsurance: calculatedValues.healthInsurance,
        nursingCareInsurance: calculatedValues.nursingCareInsurance,
        pensionInsurance: calculatedValues.pensionInsurance,

        healthInsuranceForCompany: calculatedValues.healthInsuranceForCompany,
        nursingCareInsuranceForCompany: calculatedValues.nursingCareInsuranceForCompany,
        pensionInsuranceForCompany: calculatedValues.pensionInsuranceForCompany,

        healthInsuranceForEmployee: calculatedValues.healthInsuranceForEmployee,
        nursingCareInsuranceForEmployee: calculatedValues.nursingCareInsuranceForEmployee,
        pensionInsuranceForEmployee: calculatedValues.pensionInsuranceForEmployee,

        totalInsurance: calculatedValues.healthInsurance + calculatedValues.nursingCareInsurance + calculatedValues.pensionInsurance,
        totalInsuranceForCompany: calculatedValues.healthInsuranceForCompany + calculatedValues.nursingCareInsuranceForCompany + calculatedValues.pensionInsuranceForCompany,
        totalInsuranceForEmployee: calculatedValues.healthInsuranceForEmployee + calculatedValues.nursingCareInsuranceForEmployee + calculatedValues.pensionInsuranceForEmployee,
        calculatedValues,
      };

      this.applyDraft(employeeInsurance);
      this.updateEmployeeInsuranceTotal(employeeInsurance);

      this.dataForShow.push(employeeInsurance);
    }
    this.calculateInsuranceSummary();
    if (!this.isOutputMode) {
      await this.updateExtendedSummaries(false);
    }
  }

  private applyDraft(employeeInsurance: EmployeeInsurance) {
    const draft = this.insuranceDraftMap[employeeInsurance.employeeId];
    if (!draft || !employeeInsurance.hasPayrollData) return;

    const draftTotal = (draft.healthInsurance ?? 0) + (draft.nursingCareInsurance ?? 0) + (draft.pensionInsurance ?? 0);
    const calculatedTotal = employeeInsurance.calculatedValues.healthInsurance
      + employeeInsurance.calculatedValues.nursingCareInsurance
      + employeeInsurance.calculatedValues.pensionInsurance;
    if (draftTotal === 0 && calculatedTotal > 0) return;

    employeeInsurance.grade = draft.grade;
    employeeInsurance.healthInsurance = draft.healthInsurance;
    employeeInsurance.nursingCareInsurance = draft.nursingCareInsurance;
    employeeInsurance.pensionInsurance = draft.pensionInsurance;
    employeeInsurance.healthInsuranceForEmployee = draft.healthInsuranceForEmployee;
    employeeInsurance.nursingCareInsuranceForEmployee = draft.nursingCareInsuranceForEmployee;
    employeeInsurance.pensionInsuranceForEmployee = draft.pensionInsuranceForEmployee;
    employeeInsurance.healthInsuranceForCompany = draft.healthInsuranceForCompany;
    employeeInsurance.nursingCareInsuranceForCompany = draft.nursingCareInsuranceForCompany;
    employeeInsurance.pensionInsuranceForCompany = draft.pensionInsuranceForCompany;
  }

  updateEmployeeInsuranceTotal(employeeInsurance: EmployeeInsurance) {
    employeeInsurance.healthInsurance = this.normalizeInsuranceAmount(employeeInsurance.healthInsurance);
    employeeInsurance.nursingCareInsurance = this.normalizeInsuranceAmount(employeeInsurance.nursingCareInsurance);
    employeeInsurance.pensionInsurance = this.normalizeInsuranceAmount(employeeInsurance.pensionInsurance);
    employeeInsurance.healthInsuranceForEmployee = this.normalizeInsuranceAmount(employeeInsurance.healthInsuranceForEmployee);
    employeeInsurance.nursingCareInsuranceForEmployee = this.normalizeInsuranceAmount(employeeInsurance.nursingCareInsuranceForEmployee);
    employeeInsurance.pensionInsuranceForEmployee = this.normalizeInsuranceAmount(employeeInsurance.pensionInsuranceForEmployee);
    employeeInsurance.healthInsuranceForCompany = this.normalizeInsuranceAmount(employeeInsurance.healthInsuranceForCompany);
    employeeInsurance.nursingCareInsuranceForCompany = this.normalizeInsuranceAmount(employeeInsurance.nursingCareInsuranceForCompany);
    employeeInsurance.pensionInsuranceForCompany = this.normalizeInsuranceAmount(employeeInsurance.pensionInsuranceForCompany);
    employeeInsurance.totalInsurance = this.normalizeInsuranceAmount(employeeInsurance.healthInsurance + employeeInsurance.nursingCareInsurance + employeeInsurance.pensionInsurance);
    employeeInsurance.totalInsuranceForEmployee = this.normalizeInsuranceAmount(employeeInsurance.healthInsuranceForEmployee + employeeInsurance.nursingCareInsuranceForEmployee + employeeInsurance.pensionInsuranceForEmployee);
    employeeInsurance.totalInsuranceForCompany = this.normalizeInsuranceAmount(employeeInsurance.healthInsuranceForCompany + employeeInsurance.nursingCareInsuranceForCompany + employeeInsurance.pensionInsuranceForCompany);
    this.calculateInsuranceSummary();
    this.insuranceEditErrors = this.validateInsuranceDrafts();
  }

  private normalizeInsuranceAmount(amount: number): number {
    const numericAmount = Number(amount) || 0;
    return Math.round(numericAmount * 100) / 100;
  }

  isEditedAmount(employeeInsurance: EmployeeInsurance, key: keyof InsuranceCalculatedValues): boolean {
    return this.normalizeInsuranceAmount(employeeInsurance[key]) !== this.normalizeInsuranceAmount(employeeInsurance.calculatedValues[key]);
  }

  private roundEmployeeBurden(amount: number): number {
    const yen = Math.floor(amount);
    const fraction = amount - yen;
    return fraction <= 0.5 ? yen : yen + 1;
  }

  private getInsuranceStatus(detail?: InsuranceDetail): 'joined' | 'notJoined' | 'lost' {
    if (!detail) return 'notJoined';
    if (detail.joined) return 'joined';
    if (detail.lostDate) return 'lost';
    return 'notJoined';
  }

  private getGradeDisplayNote(employee: Employee, periodStart: Date, periodEnd: Date): string | undefined {
    if (isMaternityOrChildcareLeaveOverlappingPeriod(employee, periodStart, periodEnd)) {
      if (employee.leaveTypes === '産前産後') return '（産休）';
      if (employee.leaveTypes === '育児') return '（育休）';
    }

    const insurance = employee.insurance;
    const statuses = [
      this.getInsuranceStatus(insurance?.healthInsurance),
      this.getInsuranceStatus(insurance?.nursingCareInsurance),
      this.getInsuranceStatus(insurance?.employeePensionInsurance),
    ];
    if (!statuses.every(status => status === 'notJoined' || status === 'lost')) {
      return undefined;
    }

    const healthStatus = this.getInsuranceStatus(insurance?.healthInsurance);
    return healthStatus === 'lost' ? '（喪失）' : '（未加入）';
  }

  private calculateInsuranceSummary() {
    this.insuranceSummary = this.insuranceDisplayService.summarizeRows(this.dataForShow.filter(item => item.hasPayrollData));
  }

  editInsurance() {
    // if (this.editButtonDisabled) return;
    this.editMode = true;
    this.insuranceEditErrors = this.validateInsuranceDrafts();
  }

  cancelEditInsurance() {
    this.editMode = false;
    this.insuranceEditErrors = [];
  }

  async saveInsuranceDrafts() {
    this.insuranceEditErrors = this.validateInsuranceDrafts();
    if (this.insuranceEditErrors.length) {
      return;
    }

    for (const employeeInsurance of this.dataForShow.filter(item => item.hasPayrollData)) {
      const result = await this.insuranceDraftService.saveDraft(
        this.payrollId,
        employeeInsurance.employeeId,
        this.createInsuranceDraft(employeeInsurance),
      );
      if (!result) {
        console.error(`社員ID：${employeeInsurance.employeeId} の保険料修正を保存できませんでした`);
        return;
      }
    }
    this.editMode = false;
    this.insuranceEditErrors = [];
  }

  private validateInsuranceDrafts(): string[] {
    const errors: string[] = [];

    for (const employeeInsurance of this.dataForShow.filter(item => item.hasPayrollData)) {
      this.validateInsuranceBalance(
        errors,
        employeeInsurance,
        '健康保険',
        employeeInsurance.healthInsurance,
        employeeInsurance.healthInsuranceForCompany,
        employeeInsurance.healthInsuranceForEmployee,
      );
      this.validateInsuranceBalance(
        errors,
        employeeInsurance,
        '介護保険',
        employeeInsurance.nursingCareInsurance,
        employeeInsurance.nursingCareInsuranceForCompany,
        employeeInsurance.nursingCareInsuranceForEmployee,
      );
      this.validateInsuranceBalance(
        errors,
        employeeInsurance,
        '厚生年金',
        employeeInsurance.pensionInsurance,
        employeeInsurance.pensionInsuranceForCompany,
        employeeInsurance.pensionInsuranceForEmployee,
      );
    }

    return errors;
  }

  private validateInsuranceBalance(
    errors: string[],
    employeeInsurance: EmployeeInsurance,
    insuranceName: string,
    insuranceAmount: number,
    companyAmount: number,
    employeeAmount: number,
  ) {
    const burdenTotal = this.normalizeInsuranceAmount(companyAmount + employeeAmount);
    const difference = this.normalizeInsuranceAmount(insuranceAmount - burdenTotal);
    if (Math.abs(difference) <= 0.5) return;

    errors.push(
      `${employeeInsurance.employeeId} ${employeeInsurance.employeeName}：${insuranceName}の保険料と負担額合計が一致していません（差額 ${difference}円）`
    );
  }

  isDone:boolean = false;
  //保険料をFirestoreに保存する。作業月を移動・編集ボタンを押せなくする
  async confirmInsurance() {
    // if (this.editButtonDisabled) return;
    if (this.hasUndeterminedInsuranceEmployees()) {
      const proceedDespiteUndetermined = window.confirm(
        '保険料未定の社員がいますが、保険料を確定してもよろしいでしょうか。'
      );
      if (!proceedDespiteUndetermined) {
        return;
      }
    }

    //Windows標準確認ポップを表示
    const confirmed = window.confirm(
      '確定すると、現在の作業対象期間の保険料修正は差額調整になります。\n' +
      '確定しますか？'
    );
    if (!confirmed) {
      return;
    }

    //保険料をFirestoreに保存
    const snapshotSaved = await this.saveInsuranceSnapshots();
    if (!snapshotSaved) {
      console.error('保険料を保存できませんでした');
      return;
    }

    const lockResult = await this.payrollLockService.lockPayroll(this.payrollId, '毎月');
    if (!lockResult) {
      console.error('給与の編集ロックを保存できませんでした');
      return;
    }

    await this.reachAgeService.createEvent();
    await this.commonService.refreshTargetPeriod();

    this.isDone = true;
  }

  private hasUndeterminedInsuranceEmployees(): boolean {
    return this.dataForShow.some(employee => !employee.hasPayrollData);
  }

  private async saveInsuranceSnapshots(): Promise<boolean> {
    for (const employeeInsurance of this.dataForShow) {
      const snapshot = this.createInsuranceSnapshot(employeeInsurance);
      const result = await this.insuranceSnapshotService.saveInsuranceSnapshot(employeeInsurance.employeeId, snapshot);
      if (!result) {
        return false;
      }
    }
    return true;
  }

  private createInsuranceSnapshot(employeeInsurance: EmployeeInsurance): Partial<InsuranceSnapshot> {
    const employee = this.employeeData.find(item => item.employeeId === employeeInsurance.employeeId);
    return {
      snapshotId: this.payrollId,
      employeeId: employeeInsurance.employeeId,
      payrollId: this.payrollId,
      type: '毎月',
      grade: employeeInsurance.grade.toString(),
      insuranceEnrollmentStatuses: this.insuranceFormService.buildEnrollmentStatuses(employee?.insurance),
      insurancePayments: [
        {
          insuranceType: '健康保険',
          employeeBurdenAmount: employeeInsurance.healthInsuranceForEmployee,
          companyBurdenAmount: employeeInsurance.healthInsuranceForCompany,
        },
        {
          insuranceType: '介護保険',
          employeeBurdenAmount: employeeInsurance.nursingCareInsuranceForEmployee,
          companyBurdenAmount: employeeInsurance.nursingCareInsuranceForCompany,
        },
        {
          insuranceType: '厚生年金',
          employeeBurdenAmount: employeeInsurance.pensionInsuranceForEmployee,
          companyBurdenAmount: employeeInsurance.pensionInsuranceForCompany,
        },
      ],
    };
  }

  private createInsuranceDraft(employeeInsurance: EmployeeInsurance): Partial<InsuranceDraft> {
    return {
      grade: employeeInsurance.grade,
      healthInsurance: employeeInsurance.healthInsurance,
      nursingCareInsurance: employeeInsurance.nursingCareInsurance,
      pensionInsurance: employeeInsurance.pensionInsurance,
      healthInsuranceForEmployee: employeeInsurance.healthInsuranceForEmployee,
      nursingCareInsuranceForEmployee: employeeInsurance.nursingCareInsuranceForEmployee,
      pensionInsuranceForEmployee: employeeInsurance.pensionInsuranceForEmployee,
      healthInsuranceForCompany: employeeInsurance.healthInsuranceForCompany,
      nursingCareInsuranceForCompany: employeeInsurance.nursingCareInsuranceForCompany,
      pensionInsuranceForCompany: employeeInsurance.pensionInsuranceForCompany,
    };
  }

  exportInsuranceOnlyCsv() {
    const suffix = this.isOutputMode ? `-${this.outputViewMode}` : '';
    this.insuranceConfirmCsvService.exportInsuranceOnly(
      this.dataForShow,
      this.workingYear,
      this.workingMonth,
      suffix,
    );
  }

  exportWithSalaryCsv() {
    const suffix = this.isOutputMode ? `-${this.outputViewMode}` : '';
    this.insuranceConfirmCsvService.exportWithSalary(
      this.dataForShow,
      this.workingYear,
      this.workingMonth,
      suffix,
    );
  }

  exportInsuranceSummaryCsv() {
    const suffix = this.isOutputMode ? `-${this.outputViewMode}` : '';
    const fileName = this.isOutputMode
      ? `insurance-summary-${this.outputYearMonth}${suffix}.csv`
      : `insurance-summary-${this.workingYear}-${String(this.workingMonth).padStart(2, '0')}${suffix}.csv`;
    this.insuranceConfirmCsvService.exportInsuranceSummary(
      this.insuranceSummary,
      this.officeSummaries,
      fileName,
    );
  }

  /** 給与・勤務実績登録へ遷移 */
  toPayrollForm() {
    this.router.navigate(['/monthly-salary', this.workingYear, this.workingMonth]);
  }

  /** 今月の申請一覧へ遷移 */
  toApplicationList() {
    this.router.navigate(['/system-application-list']);
  }

  /** トップ画面に遷移 */
  toTop() {
    this.router.navigate(['/top-for-manage']);
  }

}
