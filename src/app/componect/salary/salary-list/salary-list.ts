import { Component, computed, inject, Input } from '@angular/core';
import { PayrollService } from '../../../service/Firestore/payroll-service';
import { CommonModule } from '@angular/common';
import { CommonService, MessageTimer } from '../../../service/common/common-service';
import { Payroll } from '../../../model/payroll';
import { DELETE_MESSAGES, UPDATE_MESSAGES } from '../../../constants/constants';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Timestamp } from '@angular/fire/firestore';
import { EmployeeService } from '../../../service/Firestore/employee-service';

@Component({
  selector: 'app-salary-list',
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './salary-list.html',
  styleUrl: './salary-list.css',
})
export class SalaryList {

  private payrollService = inject(PayrollService);
  commonService = inject(CommonService);
  private fb = inject(FormBuilder);
  private employeeService = inject(EmployeeService);

  message: string = '';
  private messageTimer: MessageTimer = null;
  editPayrollModalOpen = false;

  allPayrollListForMonth = computed(() =>
    this.payrollService.allPayrollListForMonth()
      .find(item => item.payrollId === this.payrollId)?.payrollList ?? []
  );

  @Input() payrollId: string = '';
  @Input() isBonus: boolean = false;
  @Input() disabled: boolean = false;

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
    await this.payrollService.getAllPayrollListForMonth(this.payrollId);

    await this.employeeService.getAllEmployees();
  }

  editPayroll(payroll: Payroll) {
    if (this.disabled) return;
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

  closeEditPayrollModal() {
    this.editPayrollModalOpen = false;
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

}
