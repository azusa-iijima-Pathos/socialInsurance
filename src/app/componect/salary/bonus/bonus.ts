import { Component, DestroyRef, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { SalaryList } from '../salary-list/salary-list';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { timestampFromDateInput } from '../../../service/common/date-input.util';
import { Payroll } from '../../../model/payroll';
import { PayrollService } from '../../../service/Firestore/payroll-service';
import { CommonService, MessageTimer } from '../../../service/common/common-service';
import { CREATE_MESSAGES } from '../../../constants/constants';
import { ValidationService } from '../../../service/common/validation-service';
import { BonusCsv } from '../bonus-csv/bonus-csv';
import { ActivatedRoute, Router } from '@angular/router';
import { PayrollLockService } from '../../../service/Firestore/payroll-lock-service';
import { EmployeeService } from '../../../service/Firestore/employee-service';
import { CorrectionLogicService } from '../../../service/logic/correction-logic.service';
import { CompanyService } from '../../../service/Firestore/company-service';

@Component({
  selector: 'app-bonus',
  imports: [CommonModule, ReactiveFormsModule, BonusCsv, SalaryList],
  templateUrl: './bonus.html',
  styleUrl: './bonus.css',
})
export class Bonus {

  private fb = inject(FormBuilder);
  private payrollService = inject(PayrollService);
  private commonService = inject(CommonService);
  private validationService = inject(ValidationService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private payrollLockService = inject(PayrollLockService);
  private employeeService = inject(EmployeeService);
  private correctionLogicService = inject(CorrectionLogicService);
  private companyService = inject(CompanyService);
  private destroyRef = inject(DestroyRef);

  companyId = sessionStorage.getItem('companyId');
  payrollId = '';
  isPayrollLocked = false;

  message = '';
  messageTimer: MessageTimer = null;

  bonusMonth = '';
  priorBonusBlock: { month: number; payrollId: string } | null = null;

  async ngOnInit() {
    await this.companyService.getCompany();
    await this.employeeService.getAllEmployees();

    this.route.paramMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(params => {
        void this.loadBonusPage(params.get('payrollId') ?? '');
      });
  }

  navigateToPriorBonus() {
    if (!this.priorBonusBlock) return;
    void this.router.navigate(['/bonus', this.priorBonusBlock.payrollId]);
  }

  private async loadBonusPage(payrollId: string) {
    this.payrollId = payrollId;
    this.bonusMonth = payrollId.replace('_bonus', '');
    this.priorBonusBlock = null;
    this.isPayrollLocked = false;
    this.message = '';
    this.form.enable();
    this.resetForm();

    this.priorBonusBlock = await this.resolvePriorBonusBlock();
    if (this.priorBonusBlock) {
      return;
    }

    this.isPayrollLocked = await this.payrollLockService.isPayrollLocked(this.payrollId);
    if (this.isPayrollLocked) {
      this.form.disable();
    }
    this.form.controls.paymentDate.updateValueAndValidity();
  }

  private async resolvePriorBonusBlock(): Promise<{ month: number; payrollId: string } | null> {
    const bonusMonths = this.companyService.company()?.settings?.bonusMonths ?? [];
    if (bonusMonths.length < 2) return null;

    const options = this.correctionLogicService.getCurrentFiscalYearBonusMonthOptions();
    const currentIndex = options.findIndex(option => option.payrollId === this.payrollId);
    if (currentIndex <= 0) return null;

    const priorOption = options[currentIndex - 1];
    const isLocked = await this.payrollLockService.isPayrollLocked(priorOption.payrollId);
    if (isLocked) return null;

    return {
      month: priorOption.month,
      payrollId: priorOption.payrollId,
    };
  }

  // 支給日の年月が、トップから渡された賞与IDの年月と一致するか確認する
  private validatePaymentDateForPayrollId = (control: AbstractControl): ValidationErrors | null => {
    const paymentDate = control.value;
    if (!paymentDate || !this.payrollId) return null;

    const expectedPaymentMonth = this.payrollId.replace('_bonus', '');
    const inputPaymentMonth = String(paymentDate).slice(0, 7);
    return inputPaymentMonth === expectedPaymentMonth ? null : { paymentMonthMismatch: true };
  }

  form = this.fb.nonNullable.group({
    employeeId: ['', [Validators.required, Validators.pattern('^[a-zA-Z0-9]+$')], [this.validationService.correctEmployeeId]],
    targetPeriodStart: ['', [Validators.required]],
    targetPeriodEnd: ['', [Validators.required]],
    paymentDate: ['', [Validators.required, this.validatePaymentDateForPayrollId]],
    actualPaymentAmount: [null as number | null, [Validators.required, Validators.min(1)]],
  });

  // 個別フォームに入力された賞与をPayrollへ登録する
  async registerBonus() {
    if (this.isPayrollLocked) {
      this.message = '保険料確定済みのため、賞与情報は編集できません';
      return;
    }
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const bonus: Partial<Payroll> = {
      type: '賞与',
      companyId: this.companyId!,
      payrollId: this.payrollId,
      targetPeriod: [
        timestampFromDateInput(this.form.value.targetPeriodStart!),
        timestampFromDateInput(this.form.value.targetPeriodEnd!),
      ],
      paymentDate: timestampFromDateInput(this.form.value.paymentDate!),
      actualPaymentAmount: this.form.value.actualPaymentAmount!,
    };
    const employeeId = this.form.value.employeeId!;
    const employee = await this.employeeService.getEmployeeByEmployeeId(employeeId);
    const enrollmentError = await this.correctionLogicService.validatePayrollEnrollment(employee, this.payrollId);
    if (enrollmentError) {
      this.message = enrollmentError;
      return;
    }

    const existingPayroll = await this.payrollService.getPayroll(employeeId, bonus);
    if (existingPayroll) {
      this.message = `社員ID ${employeeId} の同じ支給月の賞与は既に登録済みです`;
      return;
    }

    const result = await this.payrollService.registerPayroll(employeeId, bonus);
    if (!result.ok) {
      this.message = this.payrollService.getRegisterErrorMessage(result);
      return;
    }

    this.message = CREATE_MESSAGES.SUCCESS;
    await this.payrollService.getAllPayrollListForMonth(this.payrollId, true);
    this.resetForm();
    this.commonService.showTimedMessage(this.message, value => this.message = value, this.messageTimer);
  }

  // 個別登録フォームを初期状態に戻す
  resetForm() {
    this.form.reset({
      employeeId: '',
      targetPeriodStart: '',
      targetPeriodEnd: '',
      paymentDate: '',
      actualPaymentAmount: null,
    });
  }

  toBonusInsuranceConfirm() {
    this.router.navigate(['/insurance-for-bonus', this.payrollId]);
  }
}
