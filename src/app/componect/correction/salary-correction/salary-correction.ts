import { Component, inject } from '@angular/core';
import { PayrollService } from '../../../service/Firestore/payroll-service';
import { CommonModule } from '@angular/common';
import { CommonService, MessageTimer } from '../../../service/common/common-service';
import { EmployeeService } from '../../../service/Firestore/employee-service';
import { Employee } from '../../../model/employee';
import { Payroll } from '../../../model/payroll';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { ValidationService } from '../../../service/common/validation-service';
import { UPDATE_MESSAGES } from '../../../constants/constants';

/**
 * 給与修正
 * 
 * ※で確定済みの算定基礎や随時改定に影響がある可能性があります。
 * 確認の上、保険情報が変更になる場合は遡及修正を行ってください。
 * 給与変更のみ。
 * システム計算結果なし
 */
@Component({
  selector: 'app-salary-correction',
  imports: [CommonModule, FormsModule, ReactiveFormsModule],
  templateUrl: './salary-correction.html',
  styleUrl: './salary-correction.css',
})
export class SalaryCorrection {

  private payrollService = inject(PayrollService);
  commonService = inject(CommonService);
  private employeeService = inject(EmployeeService);
  private fb = inject(FormBuilder);
  private validationService = inject(ValidationService);
  message: string = '';
  private messageTimer: MessageTimer = null;


  workingYear = Number(sessionStorage.getItem('workingYear'));
  workingMonth = Number(sessionStorage.getItem('workingMonth'));

  payrollId: string = '';
  payrollList: Payroll[] = [];
  payrollIdList: string[] = [];

  async ngOnInit() {
    await this.employeeService.getAllEmployees();

    //PayrollIdを設定（現在の作業月の一個前）
    if (this.workingMonth === 1) {
      this.payrollId = `${this.workingYear - 1}-12`;
    } else {
      this.payrollId = `${this.workingYear}-${String(this.workingMonth - 1).padStart(2, '0')}`;
    }

    await this.payrollService.getAllPayrollListForMonth(this.payrollId);
    this.payrollList = this.payrollService.allPayrollListForMonth().find(item => item.payrollId === this.payrollId)?.payrollList ?? [];
  }

  isEditPayrollModalOpen: boolean = false;
  form = this.fb.group({
    fixedSalary: [0, [Validators.required, Validators.min(0)]],
    actualPaymentAmount: [0, [Validators.required, this.validationService.validatePaymentAmount]],
  });

  selectedPayroll: Payroll | null = null;

  /** 給与修正モーダルを開く */
  editPayroll(payroll: Payroll) {
    this.selectedPayroll = payroll;
    this.form.patchValue({
      fixedSalary: payroll.fixedSalary ?? 0,
      actualPaymentAmount: payroll.actualPaymentAmount ?? 0,
    });
    this.isEditPayrollModalOpen = true;
  }

  /** 給与修正モーダルを送信 */
  async editPayrollModalSubmit() {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    if (this.form.value.fixedSalary === this.form.value.actualPaymentAmount && this.form.value.fixedSalary === 0) {
      this.commonService.showTimedMessage('変更がありません。', value => this.message = value, this.messageTimer);
      return;
    }

    const payroll: Partial<Payroll> = {
      ...this.selectedPayroll,
      fixedSalary: this.form.value.fixedSalary!,
      actualPaymentAmount: this.form.value.actualPaymentAmount!,
    };
    const result = await this.payrollService.updatePayroll(payroll);
    if (!result) {
      this.commonService.showTimedMessage(UPDATE_MESSAGES.FAILED, value => this.message = value, this.messageTimer);
      return;
    }
    this.commonService.showTimedMessage(`従業員ID：${payroll.employeeId}の給与・勤務実績を${UPDATE_MESSAGES.SUCCESS}`, value => this.message = value, this.messageTimer);
    this.closeEditPayrollModal();
  }

  /** 給与修正モーダルを閉じる */
  closeEditPayrollModal() {
    this.isEditPayrollModalOpen = false;
    this.selectedPayroll = null;
    this.form.reset();
  }

}
