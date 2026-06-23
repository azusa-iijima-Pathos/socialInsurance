import { Component, computed, DestroyRef, EventEmitter, inject, Input, OnChanges, Output, signal, SimpleChanges } from '@angular/core';
import { PayrollService } from '../../../service/Firestore/payroll-service';
import { CommonModule } from '@angular/common';
import { CommonService, MessageTimer } from '../../../service/common/common-service';
import { Payroll } from '../../../model/payroll';
import { CREATE_MESSAGES, DELETE_MESSAGES, UPDATE_MESSAGES } from '../../../constants/constants';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { Timestamp } from '@angular/fire/firestore';
import { EmployeeService } from '../../../service/Firestore/employee-service';
import { ValidationService } from '../../../service/common/validation-service';
import { CorrectionLogicService } from '../../../service/logic/correction-logic.service';
import { RouterLink } from '@angular/router';
import { formatTimestampForDateInput, parseDateInputValue, timestampFromDateInput } from '../../../service/common/date-input.util';
import { CompanyService } from '../../../service/Firestore/company-service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MonthlySalaryCSV } from '../monthly-salary-csv/monthly-salary-csv';
import { PayrollLockService } from '../../../service/Firestore/payroll-lock-service';

type CorrectionEmployeeRow = {
  employeeId: string;
  payroll: Payroll | null;
};

@Component({
  selector: 'app-salary-list',
  imports: [CommonModule, ReactiveFormsModule, RouterLink, MonthlySalaryCSV],
  templateUrl: './salary-list.html',
  styleUrls: ['./salary-list.css', '../monthly-salary/monthly-salary.css'],
})
export class SalaryList implements OnChanges {

  private payrollService = inject(PayrollService);
  commonService = inject(CommonService);
  private fb = inject(FormBuilder);
  private employeeService = inject(EmployeeService);
  private validationService = inject(ValidationService);
  private correctionLogicService = inject(CorrectionLogicService);
  private companyService = inject(CompanyService);
  private destroyRef = inject(DestroyRef);
  private payrollLockService = inject(PayrollLockService);

  message: string = '';
  registerMessage = '';
  confirmLockMessage = '';
  private messageTimer: MessageTimer = null;
  private registerMessageTimer: MessageTimer = null;
  private confirmLockMessageTimer: MessageTimer = null;
  editPayrollModalOpen = false;
  isAddMode = false;
  private originalPayroll: Payroll | null = null;
  targetPeriodStartError = '';
  private payrollIdState = signal('');
  private periodBoundsState = signal<{ periodStart: Date; periodEnd: Date } | null>(null);
  private isPayrollLockedState = signal(false);

  inputFormat: 1 | 2 = 2;
  companyId = sessionStorage.getItem('companyId') ?? '';

  allPayrollListForMonth = computed(() => {
    const payrollId = this.payrollIdState();
    const eligibleIds = this.isBonus
      ? this.employeeService.getBonusEligibleEmployeeIdSet(payrollId)
      : this.employeeService.getPayrollEligibleEmployeeIdSet(payrollId);
    return this.payrollService.allPayrollListForMonth()
      .find(item => item.payrollId === payrollId)?.payrollList
      .filter(payroll => eligibleIds.has(payroll.employeeId ?? '')) ?? [];
  });

  isEmptyCorrectionMonth = computed(() =>
    this.correctionMode && !this.isBonus && !this.isPayrollLockedState(),
  );

  hasCorrectionPayrollData = computed(() =>
    this.correctionMode && !this.isBonus && this.isPayrollLockedState(),
  );

  correctionEmployeeRows = computed((): CorrectionEmployeeRow[] => {
    if (!this.correctionMode || this.isBonus || !this.isPayrollLockedState()) return [];
    const bounds = this.periodBoundsState();
    if (!bounds) return [];

    const payrollMap = new Map(
      this.allPayrollListForMonth().map(payroll => [payroll.employeeId ?? '', payroll]),
    );

    return this.employeeService.allEmployees()
      .filter(employee => this.correctionLogicService.wasEmployedInPayrollPeriod(
        employee,
        bounds.periodStart,
        bounds.periodEnd,
      ))
      .sort((left, right) => left.employeeId.localeCompare(right.employeeId))
      .map(employee => ({
        employeeId: employee.employeeId,
        payroll: payrollMap.get(employee.employeeId) ?? null,
      }));
  });

  registrationEmployeeRows = computed((): CorrectionEmployeeRow[] => {
    if (!this.showAllEnrolledEmployees) return [];
    if (this.correctionMode && !this.isBonus) return [];

    const payrollId = this.payrollIdState();
    if (!payrollId) return [];

    const payrollMap = new Map(
      this.allPayrollListForMonth().map(payroll => [payroll.employeeId ?? '', payroll]),
    );

    return this.getRegistrationEligibleEmployees(payrollId)
      .sort((left, right) => left.employeeId.localeCompare(right.employeeId))
      .map(employee => ({
        employeeId: employee.employeeId,
        payroll: payrollMap.get(employee.employeeId) ?? null,
      }));
  });

  private getRegistrationEligibleEmployees(payrollId: string) {
    if (this.useBonusEligibility || this.isBonus) {
      return this.employeeService.employeesEligibleForBonusPeriod(payrollId);
    }
    return this.employeeService.employeesEligibleForPayrollPeriod(payrollId);
  }

  @Input() payrollId: string = '';
  @Input() isBonus: boolean = false;
  @Input() useBonusEligibility = false;
  @Input() disabled: boolean = false;
  @Input() correctionMode = false;
  @Input() showAllEnrolledEmployees = false;
  @Input() deferSave = false;
  @Output() payrollChange = new EventEmitter<{ original: Payroll; updated: Partial<Payroll> }>();

  form = this.fb.nonNullable.group({
    payrollId: [''],
    employeeId: [''],
    actualWorkingDays: [0, [Validators.required, Validators.min(0)]],
    actualWorkingHours: [0, [Validators.required, Validators.min(0)]],
    targetPeriodStart: ['', [Validators.required]],
    targetPeriodEnd: ['', [Validators.required]],
    paymentDate: ['', [Validators.required]],
    fixedSalary: [0, [Validators.required, Validators.min(0)]],
    actualPaymentAmount: [0, [Validators.required, Validators.min(0)]],
  });

  registerForm = this.fb.nonNullable.group({
    employeeId: ['', [Validators.required, Validators.pattern('^[a-zA-Z0-9]+$')], [this.validationService.correctEmployeeId]],
    actualWorkingDays: [0, [Validators.required, Validators.min(0)]],
    actualWorkingHours: [0, [Validators.required, Validators.min(0)]],
    paymentDate: ['', [Validators.required]],
    targetPeriodStart: ['', [Validators.required]],
    targetPeriodEnd: ['', [Validators.required]],
    basicSalary: [0],
    fixedAllowance: [0],
    transportAllowance: [0],
    variableAllowance: [0],
    fixedSalary: [0, [Validators.required, Validators.min(0)]],
    actualPaymentAmount: [0, [Validators.required, Validators.min(0)]],
  }, {
    validators: [
      this.validationService.validatePaymentAmount,
      control => this.validateCorrectionTargetPeriodStartMonth(control),
    ],
  });

  async ngOnInit() {
    this.payrollIdState.set(this.payrollId);
    await this.companyService.getCompany();
    if (this.correctionMode && !this.isBonus) {
      await this.companyService.getCompany();
      this.inputFormat = this.companyService.company()?.settings?.salaryInputFormat ?? 2;
      this.applyRegisterFormValidators();
      this.setupRegisterFormAutoCalculation();
    }
    await this.loadPayrollContext(true);
    this.updateFormValidators();
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['payrollId']) {
      this.payrollIdState.set(this.payrollId);
      if (!changes['payrollId'].firstChange && this.payrollId) {
        void this.loadPayrollContext(true);
      }
    }
    if (changes['correctionMode'] || changes['isBonus']) {
      this.updateFormValidators();
    }
  }

  private updateFormValidators() {
    if (!this.isBonus) {
      this.form.setValidators(this.validationService.validatePaymentAmount);
    } else {
      this.form.setValidators(null);
    }
    this.form.updateValueAndValidity({ emitEvent: false });
  }

  private async loadPayrollContext(forceReload = false) {
    if (!this.payrollId) return;
    await this.loadPayrollList(forceReload);

    if (this.correctionMode && !this.isBonus) {
      await this.companyService.getCompany();
      await this.employeeService.getAllEmployees(true);
      const bounds = await this.correctionLogicService.getPayrollPeriodBounds(this.payrollId);
      this.periodBoundsState.set(bounds);
      const locked = await this.payrollLockService.isPayrollLocked(this.payrollId);
      this.isPayrollLockedState.set(locked);
      await this.applyRegisterFormDefaults();
    }
  }

  private async loadPayrollList(forceReload = false) {
    if (!this.payrollId) return;
    await this.companyService.getCompany();
    await this.employeeService.getAllEmployees(forceReload);
    await this.payrollService.getAllPayrollListForMonth(this.payrollId, forceReload);
  }

  private async applyRegisterFormDefaults() {
    if (!this.payrollId) return;
    const defaults = await this.correctionLogicService.getDefaultPayrollPeriodDates(this.payrollId);
    this.registerForm.patchValue({
      paymentDate: defaults.paymentDate,
      targetPeriodStart: defaults.targetPeriodStart,
      targetPeriodEnd: defaults.targetPeriodEnd,
    }, { emitEvent: false });
  }

  private applyRegisterFormValidators() {
    const detailedControls = [
      this.registerForm.controls.basicSalary,
      this.registerForm.controls.fixedAllowance,
      this.registerForm.controls.transportAllowance,
      this.registerForm.controls.variableAllowance,
    ];
    for (const control of detailedControls) {
      control.setValidators(this.inputFormat === 1 ? [Validators.required, Validators.min(0)] : null);
      control.updateValueAndValidity({ emitEvent: false });
    }
  }

  private setupRegisterFormAutoCalculation() {
    const autoCalculationControls = [
      this.registerForm.controls.basicSalary,
      this.registerForm.controls.fixedAllowance,
      this.registerForm.controls.transportAllowance,
      this.registerForm.controls.variableAllowance,
    ];
    for (const control of autoCalculationControls) {
      control.valueChanges
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe(() => {
          if (this.inputFormat !== 1) return;
          this.updateRegisterFormCalculatedAmounts();
        });
    }
  }

  private updateRegisterFormCalculatedAmounts() {
    if (this.inputFormat !== 1) return;
    const fixedSalary = Number(this.registerForm.controls.basicSalary.value ?? 0)
      + Number(this.registerForm.controls.fixedAllowance.value ?? 0)
      + Number(this.registerForm.controls.transportAllowance.value ?? 0);
    const actualPaymentAmount = fixedSalary + Number(this.registerForm.controls.variableAllowance.value ?? 0);
    this.registerForm.patchValue({ fixedSalary, actualPaymentAmount }, { emitEvent: false });
  }

  private validateCorrectionTargetPeriodStartMonth(control: AbstractControl): ValidationErrors | null {
    if (!this.correctionMode || !this.payrollId) return null;
    const targetPeriodStart = control.get('targetPeriodStart')?.value;
    if (!targetPeriodStart) return null;

    const date = parseDateInputValue(targetPeriodStart);
    if (Number.isNaN(date.getTime())) return null;

    const isExpectedMonth = this.correctionLogicService.isTargetPeriodStartInPayrollMonth(targetPeriodStart, this.payrollId);
    return isExpectedMonth ? null : { targetPeriodStartMonthMismatch: true };
  }

  editPayroll(payroll: Payroll) {
    void this.openPayrollModal(payroll.employeeId ?? '', payroll);
  }

  openAddPayroll(employeeId: string) {
    void this.openPayrollModal(employeeId, null);
  }

  private async openPayrollModal(employeeId: string, payroll: Payroll | null) {
    if (this.disabled) return;

    this.isAddMode = !payroll;
    this.originalPayroll = payroll;
    this.editPayrollModalOpen = true;
    this.targetPeriodStartError = '';

    if (payroll) {
      this.form.patchValue({
        payrollId: payroll.payrollId,
        employeeId: payroll.employeeId ?? '',
        actualWorkingDays: payroll.actualWorkingDays ?? 0,
        actualWorkingHours: payroll.actualWorkingHours ?? 0,
        targetPeriodStart: formatTimestampForDateInput(payroll.targetPeriod?.[0]),
        targetPeriodEnd: formatTimestampForDateInput(payroll.targetPeriod?.[1]),
        paymentDate: formatTimestampForDateInput(payroll.paymentDate),
        fixedSalary: payroll.fixedSalary ?? 0,
        actualPaymentAmount: payroll.actualPaymentAmount ?? 0,
      });
      return;
    }

    const defaults = await this.correctionLogicService.getDefaultPayrollPeriodDates(this.payrollId);
    this.form.patchValue({
      payrollId: this.payrollId,
      employeeId,
      actualWorkingDays: 0,
      actualWorkingHours: 0,
      targetPeriodStart: defaults.targetPeriodStart,
      targetPeriodEnd: defaults.targetPeriodEnd,
      paymentDate: defaults.paymentDate,
      fixedSalary: 0,
      actualPaymentAmount: 0,
    });
  }

  getEditButtonLabel(): string {
    if (!this.correctionMode) return '編集';
    return this.isBonus ? '保険料確認' : '修正';
  }

  getRowActionLabel(payroll: Payroll | null): string {
    if (!payroll) return '登録';
    return this.getEditButtonLabel();
  }

  getModalTitle(): string {
    if (this.isBonus) return '賞与編集';
    if (this.isAddMode) return '給与・勤務実績登録';
    return '給与・勤務実績編集';
  }

  closeEditPayrollModal() {
    this.editPayrollModalOpen = false;
    this.isAddMode = false;
    this.originalPayroll = null;
    this.targetPeriodStartError = '';
    this.form.reset();
  }

  async editPayrollModalSubmit() {
    if (this.disabled) return;
    const formInvalid = this.isBonus
      ? this.form.controls.targetPeriodStart.invalid
        || this.form.controls.targetPeriodEnd.invalid
        || this.form.controls.paymentDate.invalid
        || this.form.controls.actualPaymentAmount.invalid
      : this.form.invalid;

    if (formInvalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.targetPeriodStartError = '';
    if (this.correctionMode && !this.isBonus) {
      const targetError = await this.correctionLogicService.validateSalaryCorrectionTargetPeriodStart(
        this.form.value.targetPeriodStart!,
        this.payrollId,
      );
      if (targetError) {
        this.targetPeriodStartError = targetError;
        this.form.controls.targetPeriodStart.markAsTouched();
        return;
      }
    }

    const payroll = this.buildPayrollFromForm(this.form.getRawValue());

    if (this.correctionMode && !this.isAddMode && !this.hasPayrollChanges(this.originalPayroll, payroll)) {
      this.commonService.showTimedMessage('変更がありません。', value => this.message = value, this.messageTimer);
      return;
    }

    if (this.deferSave && this.originalPayroll) {
      this.payrollChange.emit({ original: this.originalPayroll, updated: payroll });
      this.closeEditPayrollModal();
      return;
    }

    if (this.isAddMode) {
      const registered = await this.registerPayrollRecord(
        payroll,
        this.correctionMode || (this.isBonus && this.showAllEnrolledEmployees),
      );
      if (!registered) return;
      this.commonService.showTimedMessage(
        `従業員ID：${payroll.employeeId}の給与・勤務実績を${CREATE_MESSAGES.SUCCESS}`,
        value => this.message = value,
        this.messageTimer,
      );
    } else {
      const updatePayroll = this.correctionMode
        ? this.payrollService.updatePayrollForCorrection.bind(this.payrollService)
        : this.payrollService.updatePayroll.bind(this.payrollService);
      const result = await updatePayroll(payroll);
      if (!result) {
        this.commonService.showTimedMessage(UPDATE_MESSAGES.FAILED, value => this.message = value, this.messageTimer);
        this.closeEditPayrollModal();
        return;
      }
      this.commonService.showTimedMessage(
        `従業員ID：${payroll.employeeId}の給与・勤務実績を${UPDATE_MESSAGES.SUCCESS}`,
        value => this.message = value,
        this.messageTimer,
      );
    }

    this.closeEditPayrollModal();
    await this.loadPayrollContext(true);
  }

  async registerIndividualSalary() {
    if (this.registerForm.invalid) {
      this.registerForm.markAllAsTouched();
      return;
    }

    this.targetPeriodStartError = '';
    const targetError = await this.correctionLogicService.validateSalaryCorrectionTargetPeriodStart(
      this.registerForm.value.targetPeriodStart!,
      this.payrollId,
    );
    if (targetError) {
      this.targetPeriodStartError = targetError;
      this.registerForm.controls.targetPeriodStart.markAsTouched();
      return;
    }

    const payroll = this.buildPayrollFromRegisterForm();
    const registered = await this.registerPayrollRecord(payroll, false, 'register');
    if (!registered) return;

    this.commonService.showTimedMessage(CREATE_MESSAGES.SUCCESS, value => this.registerMessage = value, this.registerMessageTimer);
    this.registerForm.reset();
    await this.applyRegisterFormDefaults();
    this.applyRegisterFormValidators();
    this.updateRegisterFormCalculatedAmounts();
    await this.loadPayrollContext(true);
  }

  resetRegisterForm() {
    this.registerForm.reset();
    void this.applyRegisterFormDefaults();
    this.applyRegisterFormValidators();
    this.updateRegisterFormCalculatedAmounts();
  }

  onCorrectionPayrollRegistered() {
    void this.loadPayrollContext(true);
  }

  async confirmCorrectionPayrollMonth() {
    if (!this.payrollId) return;

    const confirmed = window.confirm(
      '確定すると、この月の給与・勤務実績の登録フォームは表示されなくなります。\n確定しますか？',
    );
    if (!confirmed) return;

    const lockResult = await this.payrollLockService.lockPayroll(this.payrollId, '毎月');
    if (!lockResult) {
      this.confirmLockMessageTimer = this.commonService.showTimedMessage(
        '確定に失敗しました',
        value => this.confirmLockMessage = value,
        this.confirmLockMessageTimer,
      );
      return;
    }

    this.confirmLockMessage = '';
    await this.loadPayrollContext(true);
  }

  private buildPayrollFromForm(value: ReturnType<typeof this.form.getRawValue>): Partial<Payroll> {
    const payroll: Partial<Payroll> = {
      payrollId: value.payrollId,
      employeeId: value.employeeId,
      type: this.isBonus ? '賞与' : '毎月',
      companyId: this.companyId,
      targetPeriod: [
        timestampFromDateInput(value.targetPeriodStart),
        timestampFromDateInput(value.targetPeriodEnd),
      ],
      paymentDate: timestampFromDateInput(value.paymentDate),
      actualPaymentAmount: value.actualPaymentAmount,
    };

    if (!this.isBonus) {
      payroll.actualWorkingDays = value.actualWorkingDays;
      payroll.actualWorkingHours = value.actualWorkingHours;
      payroll.fixedSalary = value.fixedSalary;
    }

    return payroll;
  }

  private buildPayrollFromRegisterForm(): Partial<Payroll> {
    const value = this.registerForm.getRawValue();
    return {
      payrollId: this.payrollId,
      type: '毎月',
      companyId: this.companyId,
      employeeId: value.employeeId,
      actualWorkingDays: value.actualWorkingDays!,
      actualWorkingHours: Math.round(value.actualWorkingHours! * 12 / 52),
      paymentDate: timestampFromDateInput(value.paymentDate!),
      targetPeriod: [
        timestampFromDateInput(value.targetPeriodStart!),
        timestampFromDateInput(value.targetPeriodEnd!),
      ],
      fixedSalary: value.fixedSalary!,
      actualPaymentAmount: value.actualPaymentAmount!,
    };
  }

  private async registerPayrollRecord(
    payroll: Partial<Payroll>,
    forCorrection = false,
    errorChannel: 'message' | 'register' = 'message',
  ): Promise<boolean> {
    const showError = (text: string) => {
      if (errorChannel === 'register') {
        this.commonService.showTimedMessage(text, value => this.registerMessage = value, this.registerMessageTimer);
      } else {
        this.commonService.showTimedMessage(text, value => this.message = value, this.messageTimer);
      }
    };

    const employeeId = payroll.employeeId!;
    const employee = await this.employeeService.getEmployeeByEmployeeId(employeeId);
    const enrollmentError = this.isBonus
      ? this.correctionLogicService.validateBonusEnrollment(employee!, this.payrollId)
      : await this.correctionLogicService.validatePayrollEnrollment(employee, this.payrollId);
    if (enrollmentError) {
      showError(enrollmentError);
      return false;
    }

    const existingPayroll = await this.payrollService.getPayroll(employeeId, payroll);
    if (existingPayroll) {
      showError(`社員ID ${employeeId} の同じ対象月の給与・勤務実績は既に登録済みです`);
      return false;
    }

    const result = forCorrection
      ? await this.payrollService.registerPayrollForCorrection(employeeId, payroll)
      : await this.payrollService.registerPayroll(employeeId, payroll);
    if (!result.ok) {
      showError(this.payrollService.getRegisterErrorMessage(result));
      return false;
    }
    return true;
  }

  async deletePayroll(payroll: Payroll) {
    if (this.disabled) return;
    const result = await this.payrollService.deletePayroll(payroll);
    if (!result) {
      this.commonService.showTimedMessage(DELETE_MESSAGES.FAILED, value => this.message = value, this.messageTimer);
      return;
    }
    this.commonService.showTimedMessage(`従業員ID：${payroll.employeeId}の給与・勤務実績を${DELETE_MESSAGES.SUCCESS}`, value => this.message = value, this.messageTimer);
  }

  private hasPayrollChanges(original: Payroll | null, updated: Partial<Payroll>): boolean {
    if (!original) return true;
    if (this.isBonus) {
      return (original.actualPaymentAmount ?? 0) !== (updated.actualPaymentAmount ?? 0)
        || formatTimestampForDateInput(original.paymentDate) !== formatTimestampForDateInput(updated.paymentDate as Timestamp)
        || formatTimestampForDateInput(original.targetPeriod?.[0]) !== formatTimestampForDateInput(updated.targetPeriod?.[0] as Timestamp)
        || formatTimestampForDateInput(original.targetPeriod?.[1]) !== formatTimestampForDateInput(updated.targetPeriod?.[1] as Timestamp);
    }
    return (original.fixedSalary ?? 0) !== (updated.fixedSalary ?? 0)
      || (original.actualPaymentAmount ?? 0) !== (updated.actualPaymentAmount ?? 0)
      || (original.actualWorkingDays ?? 0) !== (updated.actualWorkingDays ?? 0)
      || (original.actualWorkingHours ?? 0) !== (updated.actualWorkingHours ?? 0)
      || formatTimestampForDateInput(original.paymentDate) !== formatTimestampForDateInput(updated.paymentDate as Timestamp)
      || formatTimestampForDateInput(original.targetPeriod?.[0]) !== formatTimestampForDateInput(updated.targetPeriod?.[0] as Timestamp)
      || formatTimestampForDateInput(original.targetPeriod?.[1]) !== formatTimestampForDateInput(updated.targetPeriod?.[1] as Timestamp);
  }

}
