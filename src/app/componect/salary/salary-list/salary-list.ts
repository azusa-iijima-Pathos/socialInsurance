import { Component, computed, EventEmitter, inject, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
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

  allPayrollListForMonth = computed(() => {
    const retiredIds = this.employeeService.retiredEmployeeIdSet();
    return this.payrollService.allPayrollListForMonth()
      .find(item => item.payrollId === this.payrollId)?.payrollList
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
    await this.loadPayrollList();
    await this.employeeService.getAllEmployees();
    this.updateFormValidators();
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['payrollId'] && !changes['payrollId'].firstChange && this.payrollId) {
      void this.loadPayrollList();
    }
    if (changes['correctionMode'] || changes['isBonus']) {
      this.updateFormValidators();
    }
  }

  private updateFormValidators() {
    if (this.correctionMode && !this.isBonus) {
      this.form.setValidators(this.validationService.validatePaymentAmount);
    } else {
      this.form.setValidators(null);
    }
    this.form.updateValueAndValidity({ emitEvent: false });
  }

  private async loadPayrollList() {
    if (!this.payrollId) return;
    await this.payrollService.getAllPayrollListForMonth(this.payrollId);
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
      targetPeriodStart: this.formatDateForInput(payroll.targetPeriod?.[0]),
      targetPeriodEnd: this.formatDateForInput(payroll.targetPeriod?.[1]),
      paymentDate: this.formatDateForInput(payroll.paymentDate),
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
        Timestamp.fromDate(new Date(this.form.value.targetPeriodStart!)),
        Timestamp.fromDate(new Date(this.form.value.targetPeriodEnd!)),
      ],
      paymentDate: Timestamp.fromDate(new Date(this.form.value.paymentDate!)),
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

  private formatDateForInput(date: Timestamp | null | undefined): string {
    if (!date) return '';

    const dateValue = date.toDate();
    const year = dateValue.getFullYear();
    const month = String(dateValue.getMonth() + 1).padStart(2, '0');
    const day = String(dateValue.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private hasPayrollChanges(original: Payroll | null, updated: Partial<Payroll>): boolean {
    if (!original) return true;
    if (this.isBonus) {
      return (original.actualPaymentAmount ?? 0) !== (updated.actualPaymentAmount ?? 0)
        || this.formatDateForInput(original.paymentDate) !== this.formatDateForInput(updated.paymentDate as Timestamp)
        || this.formatDateForInput(original.targetPeriod?.[0]) !== this.formatDateForInput(updated.targetPeriod?.[0] as Timestamp)
        || this.formatDateForInput(original.targetPeriod?.[1]) !== this.formatDateForInput(updated.targetPeriod?.[1] as Timestamp);
    }
    return (original.fixedSalary ?? 0) !== (updated.fixedSalary ?? 0)
      || (original.actualPaymentAmount ?? 0) !== (updated.actualPaymentAmount ?? 0)
      || (original.actualWorkingDays ?? 0) !== (updated.actualWorkingDays ?? 0)
      || (original.actualWorkingHours ?? 0) !== (updated.actualWorkingHours ?? 0)
      || this.formatDateForInput(original.paymentDate) !== this.formatDateForInput(updated.paymentDate as Timestamp)
      || this.formatDateForInput(original.targetPeriod?.[0]) !== this.formatDateForInput(updated.targetPeriod?.[0] as Timestamp)
      || this.formatDateForInput(original.targetPeriod?.[1]) !== this.formatDateForInput(updated.targetPeriod?.[1] as Timestamp);
  }

}
