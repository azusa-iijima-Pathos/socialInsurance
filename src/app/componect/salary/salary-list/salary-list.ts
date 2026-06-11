import { Component, computed, EventEmitter, inject, Input, OnChanges, Output, signal, SimpleChanges } from '@angular/core';
import { PayrollService } from '../../../service/Firestore/payroll-service';
import { CommonModule } from '@angular/common';
import { CommonService, MessageTimer } from '../../../service/common/common-service';
import { Payroll } from '../../../model/payroll';
import { DELETE_MESSAGES, UPDATE_MESSAGES } from '../../../constants/constants';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Timestamp } from '@angular/fire/firestore';
import { EmployeeService } from '../../../service/Firestore/employee-service';
import { ValidationService } from '../../../service/common/validation-service';
import { CorrectionLogicService } from '../../../service/logic/correction-logic.service';
import { RouterLink } from '@angular/router';
import { formatTimestampForDateInput, parseDateInputValue, timestampFromDateInput } from '../../../service/common/date-input.util';

@Component({
  selector: 'app-salary-list',
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  templateUrl: './salary-list.html',
  styleUrl: './salary-list.css',
})
export class SalaryList implements OnChanges {

  private payrollService = inject(PayrollService);
  commonService = inject(CommonService);
  private fb = inject(FormBuilder);
  private employeeService = inject(EmployeeService);
  private validationService = inject(ValidationService);
  private correctionLogicService = inject(CorrectionLogicService);

  message: string = '';
  private messageTimer: MessageTimer = null;
  editPayrollModalOpen = false;
  private originalPayroll: Payroll | null = null;
  targetPeriodStartError = '';
  private payrollIdState = signal('');

  allPayrollListForMonth = computed(() => {
    const payrollId = this.payrollIdState();
    const retiredIds = this.employeeService.retiredEmployeeIdSet();
    return this.payrollService.allPayrollListForMonth()
      .find(item => item.payrollId === payrollId)?.payrollList
      .filter(payroll => !retiredIds.has(payroll.employeeId ?? '')) ?? [];
  });

  @Input() payrollId: string = '';
  @Input() isBonus: boolean = false;
  @Input() disabled: boolean = false;
  @Input() correctionMode = false;
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

  async ngOnInit() {
    this.payrollIdState.set(this.payrollId);
    await this.loadPayrollList(true);
    await this.employeeService.getAllEmployees();
    this.updateFormValidators();
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['payrollId']) {
      this.payrollIdState.set(this.payrollId);
      if (!changes['payrollId'].firstChange && this.payrollId) {
        void this.loadPayrollList(true);
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

  private async loadPayrollList(forceReload = false) {
    if (!this.payrollId) return;
    await this.payrollService.getAllPayrollListForMonth(this.payrollId, forceReload);
  }

  editPayroll(payroll: Payroll) {
    if (this.disabled) return;
    this.originalPayroll = payroll;
    this.editPayrollModalOpen = true;
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
  }

  getEditButtonLabel(): string {
    if (!this.correctionMode) return '編集';
    return this.isBonus ? '保険料確認' : '修正';
  }

  closeEditPayrollModal() {
    this.editPayrollModalOpen = false;
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
      const targetError = await this.correctionLogicService.validateSalaryCorrectionTargetPeriod(
        this.form.value.targetPeriodStart!,
      );
      if (targetError) {
        this.targetPeriodStartError = targetError;
        this.form.controls.targetPeriodStart.markAsTouched();
        return;
      }
    }

    const payroll: Partial<Payroll> = {
      payrollId: this.form.value.payrollId!,
      employeeId: this.form.value.employeeId!,
      targetPeriod: [
        timestampFromDateInput(this.form.value.targetPeriodStart!),
        timestampFromDateInput(this.form.value.targetPeriodEnd!),
      ],
      paymentDate: timestampFromDateInput(this.form.value.paymentDate!),
      actualPaymentAmount: this.form.value.actualPaymentAmount!,
    };

    if (!this.isBonus) {
      payroll.actualWorkingDays = this.form.value.actualWorkingDays!;
      payroll.actualWorkingHours = this.form.value.actualWorkingHours!;
      payroll.fixedSalary = this.form.value.fixedSalary!;
    }

    if (this.correctionMode && !this.hasPayrollChanges(this.originalPayroll, payroll)) {
      this.commonService.showTimedMessage('変更がありません。', value => this.message = value, this.messageTimer);
      return;
    }

    if (this.deferSave && this.originalPayroll) {
      this.payrollChange.emit({ original: this.originalPayroll, updated: payroll });
      this.closeEditPayrollModal();
      return;
    }

    const result = await this.payrollService.updatePayroll(payroll);
    if (!result) {
      this.commonService.showTimedMessage(UPDATE_MESSAGES.FAILED, value => this.message = value, this.messageTimer);
      this.closeEditPayrollModal();
      return;
    }

    this.commonService.showTimedMessage(`従業員ID：${payroll.employeeId}の給与・勤務実績を${UPDATE_MESSAGES.SUCCESS}`, value => this.message = value, this.messageTimer);
    this.closeEditPayrollModal();
  }

  async deletePayroll(payroll: Payroll) {
    if (this.disabled) return;
    const result = await this.payrollService.deletePayroll(payroll);
    if (!result) {
      this.commonService.showTimedMessage(DELETE_MESSAGES.FAILED, value => this.message = value, this.messageTimer);
      return;
    }
    this.commonService.showTimedMessage(`従業員ID：${payroll.employeeId}の給与・勤務実績を${DELETE_MESSAGES.SUCCESS}`, value => this.message = value, this.messageTimer);
    return;
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
