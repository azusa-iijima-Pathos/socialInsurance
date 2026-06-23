import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { CorrectionLogicService, BonusInsuranceComparison, MonthlyInsuranceComparisonRow } from '../../../service/logic/correction-logic.service';
import { EmployeeService } from '../../../service/Firestore/employee-service';
import { PayrollService } from '../../../service/Firestore/payroll-service';
import { CalculationRunService } from '../../../service/Firestore/calculation-run-service';
import { PayrollLockService } from '../../../service/Firestore/payroll-lock-service';
import { InsuranceSnapshotService } from '../../../service/Firestore/insurance-snapshot-service';
import { InsuranceDisplayService } from '../../../service/logic/insurance-display.service';
import { CommonService, MessageTimer } from '../../../service/common/common-service';
import { ValidationService } from '../../../service/common/validation-service';
import { CompanyService } from '../../../service/Firestore/company-service';
import { Payroll } from '../../../model/payroll';
import { Employee } from '../../../model/employee';
import { UPDATE_MESSAGES, CREATE_MESSAGES } from '../../../constants/constants';
import { getWorkingYearMonth } from '../../../service/logic/event-id-service';
import { timestampFromDateInput } from '../../../service/common/date-input.util';
import { Router, RouterLink } from '@angular/router';
import { BonusCsv } from '../../salary/bonus-csv/bonus-csv';
import { SalaryList } from '../../salary/salary-list/salary-list';

type BonusCorrectionRow = {
  payroll: Payroll;
  adjustedAmount: number;
  employeeName: string;
  grade: number;
  health: number;
  nursing: number;
  pension: number;
  total: number;
  editing: boolean;
  editAmount: number;
};

type BonusPayrollOption = {
  payrollId: string;
  label: string;
  isLocked: boolean;
};

@Component({
  selector: 'app-bonus-correction',
  imports: [CommonModule, FormsModule, ReactiveFormsModule, RouterLink, BonusCsv, SalaryList],
  templateUrl: './bonus-correction.html',
  styleUrls: ['./bonus-correction.css', '../../salary/bonus/bonus.css'],
})
export class BonusCorrection {

  private correctionLogicService = inject(CorrectionLogicService);
  private employeeService = inject(EmployeeService);
  private payrollService = inject(PayrollService);
  private calculationRunService = inject(CalculationRunService);
  private payrollLockService = inject(PayrollLockService);
  private insuranceSnapshotService = inject(InsuranceSnapshotService);
  private insuranceDisplayService = inject(InsuranceDisplayService);
  private companyService = inject(CompanyService);
  private validationService = inject(ValidationService);
  private fb = inject(FormBuilder);
  private router = inject(Router);
  commonService = inject(CommonService);

  companyId = sessionStorage.getItem('companyId') ?? '';
  payrollOptions: BonusPayrollOption[] = [];
  selectedPayrollId = '';

  message = '';
  registerMessage = '';
  confirmLockMessage = '';
  private messageTimer: MessageTimer = null;
  private registerMessageTimer: MessageTimer = null;
  private confirmLockMessageTimer: MessageTimer = null;

  previewOpen = false;
  previewComparison: BonusInsuranceComparison | null = null;
  pendingPayroll: Partial<Payroll> | null = null;
  pendingOriginalPayroll: Payroll | null = null;
  pendingCurrentAmount = 0;
  pendingEmployee: Employee | null = null;
  rows: BonusCorrectionRow[] = [];
  isPastFiscalYearBonus = false;

  private validatePaymentDateForPayrollId = (control: AbstractControl): ValidationErrors | null => {
    const paymentDate = control.value;
    if (!paymentDate || !this.selectedPayrollId) return null;

    const expectedPaymentMonth = this.selectedPayrollId.replace('_bonus', '');
    const inputPaymentMonth = String(paymentDate).slice(0, 7);
    return inputPaymentMonth === expectedPaymentMonth ? null : { paymentMonthMismatch: true };
  };

  registerForm = this.fb.nonNullable.group({
    employeeId: ['', [Validators.required, Validators.pattern('^[a-zA-Z0-9]+$')], [this.validationService.correctEmployeeId]],
    targetPeriodStart: ['', [Validators.required]],
    targetPeriodEnd: ['', [Validators.required]],
    paymentDate: ['', [Validators.required, this.validatePaymentDateForPayrollId]],
    actualPaymentAmount: [null as number | null, [Validators.required, Validators.min(1)]],
  });

  get selectedOption(): BonusPayrollOption | undefined {
    return this.payrollOptions.find(option => option.payrollId === this.selectedPayrollId);
  }

  get isInputMode(): boolean {
    return Boolean(this.selectedPayrollId && this.selectedOption && !this.selectedOption.isLocked);
  }

  async ngOnInit() {
    await this.companyService.getCompany();
    await this.employeeService.getAllEmployees();
    await this.loadPayrollOptions();
    this.selectedPayrollId = this.payrollOptions[0]?.payrollId ?? '';
    await this.onSelectionChange();
  }

  async loadPayrollOptions() {
    const optionMap = new Map<string, BonusPayrollOption>();

    const lockedPayrolls = await this.payrollLockService.getLockedPayrolls('賞与');
    for (const lock of lockedPayrolls) {
      optionMap.set(lock.payrollId, {
        payrollId: lock.payrollId,
        label: this.correctionLogicService.formatBonusPayrollDisplayLabel(lock.payrollId),
        isLocked: true,
      });
    }

    const pastCandidates = this.correctionLogicService.getPreviousFiscalYearBonusMonthOptions();
    for (const option of pastCandidates) {
      if (optionMap.has(option.payrollId)) continue;
      const locked = await this.payrollLockService.isPayrollLocked(option.payrollId);
      if (!locked) {
        optionMap.set(option.payrollId, {
          payrollId: option.payrollId,
          label: option.label,
          isLocked: false,
        });
      }
    }

    this.payrollOptions = Array.from(optionMap.values())
      .sort((left, right) => right.payrollId.localeCompare(left.payrollId));

    if (this.selectedPayrollId && !this.payrollOptions.some(option => option.payrollId === this.selectedPayrollId)) {
      this.selectedPayrollId = this.payrollOptions[0]?.payrollId ?? '';
    }
  }

  async onBonusPayrollIdChange() {
    await this.onSelectionChange();
  }

  private async onSelectionChange() {
    this.message = '';
    this.registerMessage = '';
    this.confirmLockMessage = '';
    this.resetRegisterForm();

    this.isPastFiscalYearBonus = this.isPastFiscalYearBonusPayroll(this.selectedPayrollId);

    if (!this.selectedPayrollId) {
      this.rows = [];
      return;
    }

    if (this.isInputMode) {
      this.rows = [];
      await this.payrollService.getAllPayrollListForMonth(this.selectedPayrollId, true);
      return;
    }

    await this.loadRows();
  }

  async loadRows() {
    this.rows = [];
    if (!this.selectedPayrollId || this.isInputMode) return;

    const adjustmentRuns = (await this.calculationRunService.getAllCalculationRuns())
      .filter(run => run.type === '差額調整');
    await this.payrollService.getAllPayrollListForMonth(this.selectedPayrollId);
    const payrollList = this.payrollService.allPayrollListForMonth()
      .find(item => item.payrollId === this.selectedPayrollId)?.payrollList ?? [];

    for (const payroll of payrollList) {
      const employeeId = payroll.employeeId ?? '';
      const employee = employeeId ? await this.employeeService.getEmployeeByEmployeeId(employeeId) : null;
      const snapshot = employeeId ? await this.insuranceSnapshotService.getSnapshot(employeeId, this.selectedPayrollId) : null;
      const totals = snapshot
        ? this.insuranceDisplayService.getAdjustedSnapshotTotals(snapshot, adjustmentRuns, employeeId, this.selectedPayrollId)
        : { health: 0, nursing: 0, pension: 0 };
      const adjustedAmount = this.getAdjustedBonusAmount(adjustmentRuns, employeeId, this.selectedPayrollId, payroll.actualPaymentAmount ?? 0);
      this.rows.push({
        payroll,
        adjustedAmount,
        employeeName: employeeId ? this.commonService.getEmployeeName(employeeId) ?? employeeId : '',
        grade: Number(snapshot?.grade ?? employee?.insurance?.currentGrade ?? 0),
        health: totals.health,
        nursing: totals.nursing,
        pension: totals.pension,
        total: totals.health + totals.nursing + totals.pension,
        editing: false,
        editAmount: adjustedAmount,
      });
    }
  }

  resetRegisterForm() {
    this.registerForm.reset({
      employeeId: '',
      targetPeriodStart: '',
      targetPeriodEnd: '',
      paymentDate: '',
      actualPaymentAmount: null,
    });
  }

  async registerBonus() {
    if (!this.isInputMode) return;
    if (this.registerForm.invalid) {
      this.registerForm.markAllAsTouched();
      return;
    }

    const bonus: Partial<Payroll> = {
      type: '賞与',
      companyId: this.companyId,
      payrollId: this.selectedPayrollId,
      targetPeriod: [
        timestampFromDateInput(this.registerForm.value.targetPeriodStart!),
        timestampFromDateInput(this.registerForm.value.targetPeriodEnd!),
      ],
      paymentDate: timestampFromDateInput(this.registerForm.value.paymentDate!),
      actualPaymentAmount: this.registerForm.value.actualPaymentAmount!,
    };
    const employeeId = this.registerForm.value.employeeId!;
    const employee = await this.employeeService.getEmployeeByEmployeeId(employeeId);
    const enrollmentError = this.correctionLogicService.validateBonusEnrollment(employee!, this.selectedPayrollId);
    if (!employee || enrollmentError) {
      this.showRegisterMessage(enrollmentError ?? '従業員が見つかりません');
      return;
    }

    const existingPayroll = await this.payrollService.getPayroll(employeeId, bonus);
    if (existingPayroll) {
      this.showRegisterMessage(`社員ID ${employeeId} の同じ支給月の賞与は既に登録済みです`);
      return;
    }

    const result = await this.payrollService.registerPayrollForCorrection(employeeId, bonus);
    if (!result.ok) {
      this.showRegisterMessage(this.payrollService.getRegisterErrorMessage(result));
      return;
    }

    this.showRegisterMessage(CREATE_MESSAGES.SUCCESS);
    await this.payrollService.getAllPayrollListForMonth(this.selectedPayrollId, true);
    this.resetRegisterForm();
  }

  async confirmBonusMonth() {
    if (!this.isInputMode) return;

    if (await this.hasUnregisteredBonus()) {
      window.alert('賞与が未登録の人がいます。');
    }

    const confirmed = window.confirm(
      '確定すると、この支給月の賞与登録フォームは表示されなくなります。\n確定しますか？',
    );
    if (!confirmed) return;

    const lockResult = await this.payrollLockService.lockPayroll(this.selectedPayrollId, '賞与');
    if (!lockResult) {
      this.confirmLockMessageTimer = this.commonService.showTimedMessage(
        '確定に失敗しました',
        value => this.confirmLockMessage = value,
        this.confirmLockMessageTimer,
      );
      return;
    }

    this.confirmLockMessage = '';
    const confirmedPayrollId = this.selectedPayrollId;
    await this.loadPayrollOptions();
    this.selectedPayrollId = confirmedPayrollId;
    await this.onSelectionChange();
  }

  onBonusRegistered() {
    if (this.selectedPayrollId) {
      void this.payrollService.getAllPayrollListForMonth(this.selectedPayrollId, true);
    }
  }

  startEdit(row: BonusCorrectionRow) {
    row.editing = true;
    row.editAmount = row.adjustedAmount;
  }

  cancelEdit(row: BonusCorrectionRow) {
    row.editing = false;
    row.editAmount = row.adjustedAmount;
  }

  async confirmInsurance(row: BonusCorrectionRow) {
    const employeeId = row.payroll.employeeId;
    if (!employeeId || !this.selectedPayrollId) return;

    const employee = await this.employeeService.getEmployeeByEmployeeId(employeeId);
    if (!employee) {
      this.showMessage('従業員が見つかりません');
      return;
    }

    const enrollmentError = await this.correctionLogicService.validatePayrollEnrollment(employee, this.selectedPayrollId);
    if (enrollmentError) {
      this.showMessage(enrollmentError);
      return;
    }

    const newAmount = Number(row.editAmount ?? 0);
    const comparison = await this.correctionLogicService.calculateBonusInsuranceComparison(
      employee,
      this.selectedPayrollId,
      row.adjustedAmount,
      newAmount,
    );

    if (!comparison) {
      this.showMessage('確定済み賞与の保険料スナップショットが見つかりません');
      return;
    }

    this.pendingPayroll = { ...row.payroll, actualPaymentAmount: newAmount };
    this.pendingOriginalPayroll = { ...row.payroll };
    this.pendingCurrentAmount = row.adjustedAmount;
    this.pendingEmployee = employee;
    this.previewComparison = comparison;
    this.previewOpen = true;
  }

  async approvePreview() {
    if (!this.pendingPayroll || !this.pendingOriginalPayroll || !this.pendingEmployee || !this.previewComparison) return;

    const amountChanged = this.pendingCurrentAmount !== (this.pendingPayroll.actualPaymentAmount ?? 0);
    if (this.previewComparison.totalDiff !== 0 || amountChanged) {
      const working = getWorkingYearMonth();
      const row: MonthlyInsuranceComparisonRow = {
        payrollId: this.previewComparison.payrollId,
        year: Number(this.previewComparison.payrollId.slice(0, 4)),
        month: Number(this.previewComparison.payrollId.slice(5, 7)),
        grade: this.pendingEmployee.insurance?.currentGrade ?? 0,
        currentHealth: this.previewComparison.currentHealth,
        currentNursing: this.previewComparison.currentNursing,
        currentPension: this.previewComparison.currentPension,
        newHealth: this.previewComparison.newHealth,
        newNursing: this.previewComparison.newNursing,
        newPension: this.previewComparison.newPension,
        healthDiff: this.previewComparison.healthDiff,
        nursingDiff: this.previewComparison.nursingDiff,
        pensionDiff: this.previewComparison.pensionDiff,
        totalDiff: this.previewComparison.totalDiff,
      };

      await this.calculationRunService.createMonthlyDifferenceAdjustmentRuns(
        this.pendingEmployee.employeeId,
        '賞与修正',
        '賞与遡及反映',
        working,
        [row],
        {
          originalAmount: this.pendingOriginalPayroll.actualPaymentAmount ?? 0,
          beforeAmount: this.pendingCurrentAmount,
          afterAmount: this.pendingPayroll.actualPaymentAmount ?? 0,
          payrollId: this.selectedPayrollId,
        },
      );
    }

    this.previewOpen = false;
    this.pendingPayroll = null;
    this.pendingOriginalPayroll = null;
    this.pendingCurrentAmount = 0;
    this.pendingEmployee = null;
    this.previewComparison = null;
    this.showMessage(`賞与修正を${UPDATE_MESSAGES.SUCCESS}`);
    await this.loadRows();
  }

  cancelPreview() {
    this.previewOpen = false;
    this.pendingPayroll = null;
    this.pendingOriginalPayroll = null;
    this.pendingCurrentAmount = 0;
    this.pendingEmployee = null;
    this.previewComparison = null;
  }

  displayBonusPayrollId(payrollId: string): string {
    return this.correctionLogicService.formatBonusPayrollDisplayLabel(payrollId);
  }

  showInsuranceCalculationExcluded(row: BonusCorrectionRow): boolean {
    return this.isPastFiscalYearBonus && row.total === 0;
  }

  private isPastFiscalYearBonusPayroll(payrollId: string): boolean {
    if (!payrollId?.endsWith('_bonus')) return false;
    const targetYearMonth = payrollId.replace('_bonus', '');
    const working = getWorkingYearMonth();
    const fiscalStartYear = working.month >= 4 ? working.year : working.year - 1;
    return targetYearMonth < `${fiscalStartYear}-04`;
  }

  toCorrectionBonusList() {
    this.router.navigate(['/correction-list'], { queryParams: { type: 'bonus' } });
  }

  private async hasUnregisteredBonus(): Promise<boolean> {
    if (!this.selectedPayrollId) return false;
    await this.payrollService.getAllPayrollListForMonth(this.selectedPayrollId, true);
    await this.employeeService.getAllEmployees();
    const registeredIds = new Set(
      this.payrollService.allPayrollListForMonth()
        .find(item => item.payrollId === this.selectedPayrollId)?.payrollList
        .map(payroll => payroll.employeeId ?? '') ?? [],
    );
    return this.employeeService.employeesEligibleForBonusPeriod(this.selectedPayrollId)
      .some(employee => !registeredIds.has(employee.employeeId));
  }

  private getAdjustedBonusAmount(
    runs: { type?: string; payload?: Record<string, unknown>; targetEmployeeIds?: string }[],
    employeeId: string,
    payrollId: string,
    originalAmount: number,
  ): number {
    const latestRun = runs
      .filter(run => run.type === '差額調整')
      .filter(run => String(run.payload?.['employeeId'] ?? run.targetEmployeeIds ?? '') === employeeId)
      .filter(run => String(run.payload?.['payrollId'] ?? '') === payrollId)
      .filter(run => run.payload?.['afterAmount'] !== undefined)
      .sort((left, right) => String((right as { runId?: string }).runId ?? '').localeCompare(String((left as { runId?: string }).runId ?? '')))[0];

    return latestRun ? Number(latestRun.payload?.['afterAmount'] ?? originalAmount) : originalAmount;
  }

  private showMessage(message: string) {
    this.messageTimer = this.commonService.showTimedMessage(
      message,
      value => this.message = value,
      this.messageTimer,
    );
  }

  private showRegisterMessage(message: string) {
    this.registerMessageTimer = this.commonService.showTimedMessage(
      message,
      value => this.registerMessage = value,
      this.registerMessageTimer,
    );
  }
}
