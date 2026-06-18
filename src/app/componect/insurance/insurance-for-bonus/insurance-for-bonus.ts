import { Component, inject } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Payroll } from '../../../model/payroll';
import { PayrollService } from '../../../service/Firestore/payroll-service';
import { EmployeeService } from '../../../service/Firestore/employee-service';
import { Employee, InsuranceDetail } from '../../../model/employee';
import { OfficeService } from '../../../service/Firestore/office-service';
import { CommonService } from '../../../service/common/common-service';
import { InsuranceRates } from '../../../service/Firestore/insurance-rates';
import { InsuranceDraftService } from '../../../service/Firestore/insurance-draft-service';
import { InsuranceDraft } from '../../../model/insurance-draft';
import { InsuranceSnapshotService } from '../../../service/Firestore/insurance-snapshot-service';
import { InsuranceSnapshot } from '../../../model/insurance-snapshot';
import { PayrollLockService } from '../../../service/Firestore/payroll-lock-service';
import { InsuranceConfirmCsvService } from '../../../service/CSV/insurance-confirm-csv-service';
import { SocialInsuranceFormCsvService } from '../../../service/CSV/social-insurance-form-csv.service';
import { CalculationRunService } from '../../../service/Firestore/calculation-run-service';
import { CalculationRun } from '../../../model/calculation-run';
import { InsuranceDisplayService, InsuranceNoticeSummary, OfficeInsuranceSummary } from '../../../service/logic/insurance-display.service';
import { CorrectionLogicService } from '../../../service/logic/correction-logic.service';
import {
  isMaternityOrChildcareLeaveOverlappingPeriod,
  resolvePayrollTargetPeriodBounds,
} from '../../../service/logic/leave-insurance.util';
import { CompanyService } from '../../../service/Firestore/company-service';

type BonusInsurance = {
  employeeId: string;
  employeeName: string;
  hasBonusData: boolean;
  actualPaymentAmount: number;
  standardBonusAmount: number;
  annualStandardBonusAmount: number;
  healthStandardBonusAmount: number;
  pensionStandardBonusAmount: number;
  isHealthBonusLimitExceeded: boolean;
  hasInsuranceGrade: boolean;
  grade: number;
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
  calculatedValues: BonusInsuranceCalculatedValues;
};

type BonusInsuranceCalculatedValues = {
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

type BonusInsuranceSummary = InsuranceNoticeSummary;

type OutputViewMode = 'adjusted' | 'confirmed';

@Component({
  selector: 'app-insurance-for-bonus',
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './insurance-for-bonus.html',
  styleUrl: './insurance-for-bonus.css',
})
export class InsuranceForBonus {

  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private payrollService = inject(PayrollService);
  private employeeService = inject(EmployeeService);
  private officeService = inject(OfficeService);
  private commonService = inject(CommonService);
  private insuranceRates = inject(InsuranceRates);
  private insuranceDraftService = inject(InsuranceDraftService);
  private insuranceSnapshotService = inject(InsuranceSnapshotService);
  private payrollLockService = inject(PayrollLockService);
  private insuranceConfirmCsvService = inject(InsuranceConfirmCsvService);
  private formCsvService = inject(SocialInsuranceFormCsvService);
  private calculationRunService = inject(CalculationRunService);
  private insuranceDisplayService = inject(InsuranceDisplayService);
  private correctionLogicService = inject(CorrectionLogicService);
  private companyService = inject(CompanyService);

  payrollId = '';
  targetYearMonth = '';
  bonusData: Payroll[] = [];
  employeeData: Employee[] = [];
  dataForShow: BonusInsurance[] = [];
  insuranceDraftMap: Record<string, InsuranceDraft> = {};
  editMode = false;
  isOutputMode = false;
  outputViewMode: OutputViewMode = 'adjusted';
  differenceAdjustmentRuns: CalculationRun[] = [];
  confirmedOutputRows: BonusInsurance[] = [];
  adjustedOutputRows: BonusInsurance[] = [];
  fiscalYearLabel = '';
  fiscalYearSummary: BonusInsuranceSummary = this.createEmptySummary();
  officeSummaries: OfficeInsuranceSummary[] = [];
  lockedBonusPayrollIds: string[] = [];
  selectedBonusPayrollId = '';
  editButtonDisabled = false;
  insuranceEditErrors: string[] = [];
  insuranceSummary: BonusInsuranceSummary = this.createEmptySummary();

  async ngOnInit() {
    this.payrollId = this.route.snapshot.params['payrollId'];
    if (!this.payrollId?.endsWith('_bonus')) {
      this.router.navigate(['/top-for-manage']);
      return;
    }

    this.isOutputMode = this.route.snapshot.queryParamMap.get('mode') === 'output';
    if (this.isOutputMode) {
      const lockedBonusPayrolls = await this.payrollLockService.getLockedPayrolls('賞与');
      this.lockedBonusPayrollIds = lockedBonusPayrolls.map(lock => lock.payrollId);
    }
    this.selectedBonusPayrollId = this.payrollId;
    await this.loadBonusInsuranceData();
  }

  private async loadBonusInsuranceData() {
    this.bonusData = [];
    this.employeeData = [];
    this.dataForShow = [];
    this.insuranceDraftMap = {};

    this.targetYearMonth = this.payrollId.replace('_bonus', '');
    this.editButtonDisabled = this.isOutputMode || await this.payrollLockService.isPayrollLocked(this.payrollId);
    await this.payrollService.getAllPayrollListForMonth(this.payrollId);
    this.bonusData = this.payrollService.allPayrollListForMonth().find(item => item.payrollId === this.payrollId)?.payrollList ?? [];
    await this.companyService.getCompany();
    await this.employeeService.getAllEmployees();
    this.employeeData = this.employeeService.employeesEligibleForPayrollPeriod(this.payrollId);
    const drafts = await this.insuranceDraftService.getDrafts(this.payrollId);
    this.insuranceDraftMap = drafts.reduce<Record<string, InsuranceDraft>>((map, draft) => {
      map[draft.employeeId] = draft;
      return map;
    }, {});

    await this.getBonusInsurance(this.employeeData);
  }

  setOutputViewMode(mode: OutputViewMode) {
    this.outputViewMode = mode;
    this.dataForShow = mode === 'adjusted' ? this.adjustedOutputRows : this.confirmedOutputRows;
    this.calculateInsuranceSummary();
    void this.updateExtendedSummaries(mode === 'adjusted');
  }

  private async loadOutputModeData() {
    this.differenceAdjustmentRuns = (await this.calculationRunService.getAllCalculationRuns())
      .filter(run => run.type === '差額調整');
    this.confirmedOutputRows = [];
    this.adjustedOutputRows = [];

    for (const employee of this.employeeData) {
      const bonus = this.bonusData.find(item => item.employeeId === employee.employeeId);
      const snapshot = await this.insuranceSnapshotService.getSnapshot(employee.employeeId, this.payrollId);
      if (!snapshot && !bonus) continue;

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

      this.confirmedOutputRows.push(await this.buildOutputBonusRow(employee, bonus, snapshot, confirmedBreakdown));
      this.adjustedOutputRows.push(await this.buildOutputBonusRow(
        employee,
        bonus,
        snapshot,
        adjustedBreakdown,
        adjustedGrade,
        this.getAdjustedBonusAmount(employee.employeeId, this.payrollId, bonus?.actualPaymentAmount ?? 0),
        true,
      ));
    }

    this.setOutputViewMode(this.outputViewMode);
  }

  private async buildOutputBonusRow(
    employee: Employee,
    bonus: Payroll | undefined,
    snapshot: InsuranceSnapshot | null,
    breakdown: ReturnType<InsuranceDisplayService['getSnapshotBreakdown']>,
    gradeOverride?: number,
    amountOverride?: number,
    useAdjustedPreviousBonus = false,
  ): Promise<BonusInsurance> {
    const hasBonusData = Boolean(bonus);
    const actualPaymentAmount = amountOverride ?? bonus?.actualPaymentAmount ?? 0;
    const standardBonusAmount = this.toStandardBonusAmount(actualPaymentAmount);
    const previousHealthStandardBonus = await this.getPreviousHealthStandardBonusTotal(employee.employeeId, useAdjustedPreviousBonus);
    const annualStandardBonusAmount = previousHealthStandardBonus + standardBonusAmount;
    const healthStandardBonusAmount = Math.min(standardBonusAmount, Math.max(5730000 - previousHealthStandardBonus, 0));
    const pensionStandardBonusAmount = Math.min(standardBonusAmount, 1500000);
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
      hasBonusData,
      actualPaymentAmount,
      standardBonusAmount,
      annualStandardBonusAmount,
      healthStandardBonusAmount,
      pensionStandardBonusAmount,
      isHealthBonusLimitExceeded: healthStandardBonusAmount < standardBonusAmount,
      hasInsuranceGrade: Boolean(gradeOverride ?? snapshot?.grade ?? employee.insurance?.currentGrade),
      grade: gradeOverride ?? Number(snapshot?.grade ?? employee.insurance?.currentGrade ?? 0),
      ...breakdown,
      calculatedValues,
    };
  }

  private async updateExtendedSummaries(useAdjusted: boolean) {
    const range = this.insuranceDisplayService.getFiscalYearRange(this.targetYearMonth);
    this.fiscalYearLabel = range.label;
    this.fiscalYearSummary = await this.buildFiscalYearSummary(range.start, range.end, useAdjusted);
    await this.officeService.getAllOffice();
    this.officeSummaries = this.insuranceDisplayService.buildOfficeSummaries(
      this.dataForShow.filter(item => this.canCalculateInsurance(item)),
      this.employeeData,
      this.officeService.allOfficeNameMap(),
    );
  }

  private async buildFiscalYearSummary(start: string, end: string, useAdjusted: boolean): Promise<BonusInsuranceSummary> {
    const months = this.insuranceDisplayService.enumerateYearMonths(start, end);
    const rows: ReturnType<InsuranceDisplayService['getSnapshotBreakdown']>[] = [];

    if (this.isOutputMode) {
      for (const employee of this.employeeData) {
        const snapshots = await this.insuranceSnapshotService.getSnapshotsForEmployee(employee.employeeId);
        const snapshotMap = new Map(snapshots.map(snapshot => [snapshot.payrollId ?? '', snapshot]));
        for (const month of months) {
          const bonusPayrollId = `${month}_bonus`;
          if (bonusPayrollId > this.payrollId) continue;
          const snapshot = snapshotMap.get(bonusPayrollId);
          if (!snapshot || snapshot.type !== '賞与') continue;
          rows.push(
            useAdjusted
              ? this.insuranceDisplayService.getAdjustedSnapshotBreakdown(
                snapshot,
                this.differenceAdjustmentRuns,
                employee.employeeId,
                bonusPayrollId,
              )
              : this.insuranceDisplayService.getSnapshotBreakdown(snapshot),
          );
        }
      }
      return this.insuranceDisplayService.summarizeRows(rows);
    }

    for (const month of months) {
      const bonusPayrollId = `${month}_bonus`;
      if (bonusPayrollId > this.payrollId) continue;
      if (bonusPayrollId === this.payrollId) {
        rows.push(...this.dataForShow.filter(item => this.canCalculateInsurance(item)));
        continue;
      }

      for (const employee of this.employeeData) {
        const snapshot = await this.insuranceSnapshotService.getSnapshot(employee.employeeId, bonusPayrollId);
        if (!snapshot || snapshot.type !== '賞与') continue;
        rows.push(this.insuranceDisplayService.getSnapshotBreakdown(snapshot));
      }
    }

    return this.insuranceDisplayService.summarizeRows(rows);
  }

  private createEmptySummary(): BonusInsuranceSummary {
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

  async changeBonusPayroll() {
    this.payrollId = this.selectedBonusPayrollId;
    await this.router.navigate(['/insurance-for-bonus', this.payrollId], { queryParams: { mode: 'output' } });
    await this.loadBonusInsuranceData();
  }

  private async getBonusInsurance(employees: Employee[]) {
    if (this.isOutputMode) {
      await this.loadOutputModeData();
      return;
    }

    const defaultPeriodBounds = await this.correctionLogicService.getPayrollPeriodBounds(this.targetYearMonth);

    for (const employee of employees) {
      const bonus = this.bonusData.find(item => item.employeeId === employee.employeeId);
      const hasBonusData = Boolean(bonus);
      const { periodStart, periodEnd } = resolvePayrollTargetPeriodBounds(bonus, defaultPeriodBounds);
      const zeroPremiumForLeave = isMaternityOrChildcareLeaveOverlappingPeriod(employee, periodStart, periodEnd);
      const hasInsuranceGrade = Boolean(employee.insurance?.currentGrade);
      const actualPaymentAmount = bonus?.actualPaymentAmount ?? 0;
      const standardBonusAmount = this.toStandardBonusAmount(actualPaymentAmount);
      const previousHealthStandardBonus = await this.getPreviousHealthStandardBonusTotal(employee.employeeId);
      const annualStandardBonusAmount = previousHealthStandardBonus + standardBonusAmount;
      const healthStandardBonusAmount = Math.min(standardBonusAmount, Math.max(5730000 - previousHealthStandardBonus, 0));
      const pensionStandardBonusAmount = Math.min(standardBonusAmount, 1500000);
      const isHealthBonusLimitExceeded = healthStandardBonusAmount < standardBonusAmount;
      const prefecture = await this.officeService.getOfficeLocation(employee.employmentContract?.officeId ?? '');
      const rate = prefecture ? await this.getInsuranceRate(prefecture) : null;

      const healthInsuranceCompanyRate = employee.insurance?.healthInsurance?.companyBurdenRate ?? 50;
      const nursingCareInsuranceCompanyRate = employee.insurance?.nursingCareInsurance?.companyBurdenRate ?? 50;
      const pensionInsuranceCompanyRate = employee.insurance?.employeePensionInsurance?.companyBurdenRate ?? 50;

      let healthInsurance = this.normalizeInsuranceAmount(healthStandardBonusAmount * ((rate?.healthInsuranceRate ?? 0) / 100));
      let nursingCareInsurance = this.normalizeInsuranceAmount(healthStandardBonusAmount * ((rate?.nursingCareRate ?? 0) / 100));
      let pensionInsurance = this.normalizeInsuranceAmount(pensionStandardBonusAmount * ((rate?.pensionRate ?? 0) / 100));

      let healthInsuranceForEmployee = this.roundEmployeeBurden(healthInsurance * ((100 - healthInsuranceCompanyRate) / 100));
      let nursingCareInsuranceForEmployee = this.roundEmployeeBurden(nursingCareInsurance * ((100 - nursingCareInsuranceCompanyRate) / 100));
      let pensionInsuranceForEmployee = this.roundEmployeeBurden(pensionInsurance * ((100 - pensionInsuranceCompanyRate) / 100));

      if (!employee.insurance?.healthInsurance?.joined || this.isLostInTargetMonth(employee.insurance?.healthInsurance)) {
        healthInsurance = 0;
        nursingCareInsurance = 0;
        healthInsuranceForEmployee = 0;
        nursingCareInsuranceForEmployee = 0;
      }
      if (!employee.insurance?.nursingCareInsurance?.joined || this.isLostInTargetMonth(employee.insurance?.nursingCareInsurance ?? employee.insurance?.healthInsurance)) {
        nursingCareInsurance = 0;
        nursingCareInsuranceForEmployee = 0;
      }
      if (!employee.insurance?.employeePensionInsurance?.joined || this.isLostInTargetMonth(employee.insurance?.employeePensionInsurance)) {
        pensionInsurance = 0;
        pensionInsuranceForEmployee = 0;
      }
      if (zeroPremiumForLeave || !hasBonusData || !hasInsuranceGrade) {
        healthInsurance = 0;
        nursingCareInsurance = 0;
        pensionInsurance = 0;
        healthInsuranceForEmployee = 0;
        nursingCareInsuranceForEmployee = 0;
        pensionInsuranceForEmployee = 0;
      }

      const employeeInsurance: BonusInsurance = {
        employeeId: employee.employeeId,
        employeeName: this.commonService.getEmployeeName(employee.employeeId)!,
        hasBonusData,
        actualPaymentAmount,
        standardBonusAmount,
        annualStandardBonusAmount,
        healthStandardBonusAmount,
        pensionStandardBonusAmount,
        isHealthBonusLimitExceeded,
        hasInsuranceGrade,
        grade: employee.insurance?.currentGrade ?? 0,
        healthInsurance,
        nursingCareInsurance,
        pensionInsurance,
        healthInsuranceForCompany: this.normalizeInsuranceAmount(healthInsurance * (healthInsuranceCompanyRate / 100)),
        nursingCareInsuranceForCompany: this.normalizeInsuranceAmount(nursingCareInsurance * (nursingCareInsuranceCompanyRate / 100)),
        pensionInsuranceForCompany: this.normalizeInsuranceAmount(pensionInsurance * (pensionInsuranceCompanyRate / 100)),
        healthInsuranceForEmployee,
        nursingCareInsuranceForEmployee,
        pensionInsuranceForEmployee,
        totalInsurance: 0,
        totalInsuranceForCompany: 0,
        totalInsuranceForEmployee: 0,
        calculatedValues: {
          healthInsurance: 0,
          nursingCareInsurance: 0,
          pensionInsurance: 0,
          healthInsuranceForCompany: 0,
          nursingCareInsuranceForCompany: 0,
          pensionInsuranceForCompany: 0,
          healthInsuranceForEmployee: 0,
          nursingCareInsuranceForEmployee: 0,
          pensionInsuranceForEmployee: 0,
        },
      };

      employeeInsurance.calculatedValues = {
        healthInsurance: employeeInsurance.healthInsurance,
        nursingCareInsurance: employeeInsurance.nursingCareInsurance,
        pensionInsurance: employeeInsurance.pensionInsurance,
        healthInsuranceForCompany: employeeInsurance.healthInsuranceForCompany,
        nursingCareInsuranceForCompany: employeeInsurance.nursingCareInsuranceForCompany,
        pensionInsuranceForCompany: employeeInsurance.pensionInsuranceForCompany,
        healthInsuranceForEmployee: employeeInsurance.healthInsuranceForEmployee,
        nursingCareInsuranceForEmployee: employeeInsurance.nursingCareInsuranceForEmployee,
        pensionInsuranceForEmployee: employeeInsurance.pensionInsuranceForEmployee,
      };

      this.applyDraft(employeeInsurance);
      this.updateEmployeeInsuranceTotal(employeeInsurance);
      this.dataForShow.push(employeeInsurance);
    }
    this.calculateInsuranceSummary();
    await this.updateExtendedSummaries(false);
  }

  private async getInsuranceRate(prefecture: string) {
    const targetYear = this.getInsuranceMasterYear();
    await this.insuranceRates.getRateData(targetYear);
    return this.insuranceRates.getApplicableRateData(targetYear, this.targetYearMonth).find(rate => rate.prefecture === prefecture) ?? null;
  }

  private getInsuranceMasterYear() {
    const [yearText, monthText] = this.targetYearMonth.split('-');
    const year = Number(yearText);
    const month = Number(monthText);
    return String(month <= 2 ? year - 1 : year);
  }

  private async getPreviousHealthStandardBonusTotal(employeeId: string, useAdjusted = false) {
    const { fiscalStartYearMonth, fiscalEndYearMonth } = this.getFiscalYearRange();
    const payrollList = await this.payrollService.getPayrollListForEmployee(employeeId);
    return payrollList
      .filter(payroll => payroll.type === '賞与')
      .filter(payroll => payroll.payrollId !== this.payrollId)
      .filter(payroll => {
        const payrollYearMonth = this.getPayrollYearMonth(payroll.payrollId);
        return fiscalStartYearMonth <= payrollYearMonth && payrollYearMonth <= fiscalEndYearMonth;
      })
      .reduce((total, payroll) => {
        const amount = useAdjusted
          ? this.getAdjustedBonusAmount(employeeId, payroll.payrollId ?? '', payroll.actualPaymentAmount ?? 0)
          : payroll.actualPaymentAmount ?? 0;
        return total + this.toStandardBonusAmount(amount);
      }, 0);
  }

  private getAdjustedBonusAmount(employeeId: string, payrollId: string, originalAmount: number): number {
    const latestRun = this.differenceAdjustmentRuns
      .filter(run => run.type === '差額調整')
      .filter(run => String(run.payload?.['employeeId'] ?? run.targetEmployeeIds ?? '') === employeeId)
      .filter(run => String(run.payload?.['payrollId'] ?? '') === payrollId)
      .filter(run => run.payload?.['afterAmount'] !== undefined)
      .sort((left, right) => String(right.runId ?? '').localeCompare(String(left.runId ?? '')))[0];

    return latestRun ? Number(latestRun.payload?.['afterAmount'] ?? originalAmount) : originalAmount;
  }

  private getFiscalYearRange() {
    const [yearText, monthText] = this.targetYearMonth.split('-');
    const year = Number(yearText);
    const month = Number(monthText);
    const fiscalStartYear = month >= 4 ? year : year - 1;

    return {
      fiscalStartYearMonth: `${fiscalStartYear}-04`,
      fiscalEndYearMonth: `${fiscalStartYear + 1}-03`,
    };
  }

  private toStandardBonusAmount(amount: number) {
    return Math.floor((Number(amount) || 0) / 1000) * 1000;
  }

  private getPayrollYearMonth(payrollId: string) {
    return payrollId.slice(0, 7);
  }

  private isLostInTargetMonth(insuranceDetail?: InsuranceDetail) {
    const lostDate = insuranceDetail?.lostDate?.toDate();
    if (!lostDate) return false;

    const lostYearMonth = `${lostDate.getFullYear()}-${String(lostDate.getMonth() + 1).padStart(2, '0')}`;
    return lostYearMonth === this.targetYearMonth;
  }

  private applyDraft(employeeInsurance: BonusInsurance) {
    const draft = this.insuranceDraftMap[employeeInsurance.employeeId];
    if (!draft || !this.canCalculateInsurance(employeeInsurance)) return;
    if (draft.actualPaymentAmount !== employeeInsurance.actualPaymentAmount) return;

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

  updateEmployeeInsuranceTotal(employeeInsurance: BonusInsurance) {
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

  isEditedAmount(employeeInsurance: BonusInsurance, key: keyof BonusInsuranceCalculatedValues): boolean {
    return this.normalizeInsuranceAmount(employeeInsurance[key]) !== this.normalizeInsuranceAmount(employeeInsurance.calculatedValues[key]);
  }

  private normalizeInsuranceAmount(amount: number): number {
    const numericAmount = Number(amount) || 0;
    return Math.round(numericAmount * 100) / 100;
  }

  private roundEmployeeBurden(amount: number): number {
    const yen = Math.floor(amount);
    const fraction = amount - yen;
    return fraction <= 0.5 ? yen : yen + 1;
  }

  private calculateInsuranceSummary() {
    this.insuranceSummary = this.insuranceDisplayService.summarizeRows(
      this.dataForShow.filter(item => this.canCalculateInsurance(item)),
    );
  }

  editInsurance() {
    if (this.editButtonDisabled) return;
    this.editMode = true;
    this.insuranceEditErrors = this.validateInsuranceDrafts();
  }

  cancelEditInsurance() {
    this.editMode = false;
    this.insuranceEditErrors = [];
  }

  async saveInsuranceDrafts() {
    this.insuranceEditErrors = this.validateInsuranceDrafts();
    if (this.insuranceEditErrors.length) return;

    for (const employeeInsurance of this.dataForShow.filter(item => this.canCalculateInsurance(item))) {
      const result = await this.insuranceDraftService.saveDraft(
        this.payrollId,
        employeeInsurance.employeeId,
        this.createInsuranceDraft(employeeInsurance),
      );
      if (!result) {
        console.error(`社員ID：${employeeInsurance.employeeId} の賞与保険料修正を保存できませんでした`);
        return;
      }
    }
    this.editMode = false;
    this.insuranceEditErrors = [];
  }

  private validateInsuranceDrafts(): string[] {
    const errors: string[] = [];

    for (const employeeInsurance of this.dataForShow.filter(item => this.canCalculateInsurance(item))) {
      this.validateInsuranceBalance(errors, employeeInsurance, '健康保険', employeeInsurance.healthInsurance, employeeInsurance.healthInsuranceForCompany, employeeInsurance.healthInsuranceForEmployee);
      this.validateInsuranceBalance(errors, employeeInsurance, '介護保険', employeeInsurance.nursingCareInsurance, employeeInsurance.nursingCareInsuranceForCompany, employeeInsurance.nursingCareInsuranceForEmployee);
      this.validateInsuranceBalance(errors, employeeInsurance, '厚生年金', employeeInsurance.pensionInsurance, employeeInsurance.pensionInsuranceForCompany, employeeInsurance.pensionInsuranceForEmployee);
    }

    return errors;
  }

  private validateInsuranceBalance(errors: string[], employeeInsurance: BonusInsurance, insuranceName: string, insuranceAmount: number, companyAmount: number, employeeAmount: number) {
    const burdenTotal = this.normalizeInsuranceAmount(companyAmount + employeeAmount);
    const difference = this.normalizeInsuranceAmount(insuranceAmount - burdenTotal);
    if (Math.abs(difference) <= 0.5) return;

    errors.push(`${employeeInsurance.employeeId} ${employeeInsurance.employeeName}：${insuranceName}の保険料と負担額合計が一致していません（差額 ${difference}円）`);
  }

  canCalculateInsurance(employeeInsurance: BonusInsurance): boolean {
    return employeeInsurance.hasBonusData && employeeInsurance.hasInsuranceGrade;
  }

  async confirmInsurance() {
    if (this.editButtonDisabled) return;
    const confirmed = window.confirm(
      '確定すると、賞与保険料の修正ができなくなります。\n' +
      '賞与保険料を確定しますか？\n'
    );
    if (!confirmed) return;

    for (const employeeInsurance of this.dataForShow) {
      const result = await this.insuranceSnapshotService.saveInsuranceSnapshot(
        employeeInsurance.employeeId,
        this.createInsuranceSnapshot(employeeInsurance),
      );
      if (!result) {
        console.error('賞与保険料を保存できませんでした');
        return;
      }
    }
    const lockResult = await this.payrollLockService.lockPayroll(this.payrollId, '賞与');
    if (!lockResult) {
      console.error('賞与の編集ロックを保存できませんでした');
      return;
    }
    this.editButtonDisabled = true;
  }

  private createInsuranceSnapshot(employeeInsurance: BonusInsurance): Partial<InsuranceSnapshot> {
    return {
      snapshotId: this.payrollId,
      employeeId: employeeInsurance.employeeId,
      payrollId: this.payrollId,
      type: '賞与',
      grade: employeeInsurance.grade.toString(),
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

  private createInsuranceDraft(employeeInsurance: BonusInsurance): Partial<InsuranceDraft> {
    return {
      grade: employeeInsurance.grade,
      actualPaymentAmount: employeeInsurance.actualPaymentAmount,
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
    this.insuranceConfirmCsvService.exportBonusInsuranceOnly(this.createBonusCsvRows(), this.payrollId, suffix);
  }

  exportWithSalaryCsv() {
    const suffix = this.isOutputMode ? `-${this.outputViewMode}` : '';
    this.insuranceConfirmCsvService.exportBonusWithSalary(this.createBonusCsvRows(), this.payrollId, suffix);
  }

  exportInsuranceSummaryCsv() {
    const suffix = this.isOutputMode ? `-${this.outputViewMode}` : '';
    const fileName = `bonus-insurance-summary-${this.payrollId}${suffix}.csv`;
    this.insuranceConfirmCsvService.exportInsuranceSummary(
      this.insuranceSummary,
      this.officeSummaries,
      fileName,
    );
  }

  exportBonusFormCsv() {
    const rows = this.confirmedOutputRows
      .filter(row => row.hasBonusData)
      .map(row => {
        const bonus = this.bonusData.find(item => item.employeeId === row.employeeId);
        return {
          employeeId: row.employeeId,
          employeeName: row.employeeName,
          paymentDate: bonus?.paymentDate,
          bonusAmount: row.actualPaymentAmount,
          standardBonusAmount: row.standardBonusAmount,
        };
      });

    if (rows.length === 0) {
      alert('出力対象の賞与データがありません');
      return;
    }

    this.formCsvService.exportConfirmedBonusCsv(rows, this.payrollId);
  }

  private createBonusCsvRows() {
    return this.dataForShow.map(employeeInsurance => ({
      ...employeeInsurance,
      fixedSalary: 0,
    }));
  }

  /** 賞与入力へ遷移 */
  toBonusInput() {
    this.router.navigate(['/bonus', this.payrollId]);
  }
  /** トップ画面に遷移 */
  toTop() {
    this.router.navigate(['/top-for-manage']);
  }

}
