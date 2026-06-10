import { Component, DestroyRef, ViewChild, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { Payroll } from '../../../model/payroll';
import { CompanyService } from '../../../service/Firestore/company-service';
import { parseDateInputValue, timestampFromDateInput } from '../../../service/common/date-input.util';
import { PayrollService } from '../../../service/Firestore/payroll-service';
import { CREATE_MESSAGES } from '../../../constants/constants';
import { CommonService, MessageTimer } from '../../../service/common/common-service';
import { ValidationService } from '../../../service/common/validation-service';
import { MonthlySalaryCSV } from '../monthly-salary-csv/monthly-salary-csv';
import { SalaryList } from '../salary-list/salary-list';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { EmployeeService } from '../../../service/Firestore/employee-service';

@Component({
  selector: 'app-monthly-salary',
  imports: [CommonModule, ReactiveFormsModule, MonthlySalaryCSV, SalaryList],
  templateUrl: './monthly-salary.html',
  styleUrl: './monthly-salary.css',
})
export class MonthlySalary {

  private fb = inject(FormBuilder);
  private companyService = inject(CompanyService);
  private payrollService = inject(PayrollService);
  private commonService = inject(CommonService);
  private validationService = inject(ValidationService);
  private destroyRef = inject(DestroyRef);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private employeeService = inject(EmployeeService);

  companyId = sessionStorage.getItem('companyId');
  workingYear = Number(sessionStorage.getItem('workingYear'));
  workingMonth = Number(sessionStorage.getItem('workingMonth'));

  inputFormat: 1 | 2 = 2;
  paymentMonth: '当月' | '翌月' = '翌月';
  paymentMonthNumber: number = 0;

  payrollId = '';

  message: string = '';
  messageTimer: MessageTimer = null;

  async ngOnInit() {
    //パラムとセッションの作業年・作業月が一致しているか
    const paramYear = this.route.snapshot.paramMap.get('workingYear');
    const paramMonth = this.route.snapshot.paramMap.get('workingMonth');

    if (Number(paramYear) !== this.workingYear || Number(paramMonth) !== this.workingMonth) {
      this.router.navigate(['/monthly-salary', this.workingYear, this.workingMonth]);
      return;
    }

    await this.companyService.getCompany();

    /** 会社設定があれば適用してフォームに反映*/
    const companySettings = this.companyService.company()?.settings;
    const paymentDateDay = companySettings?.paymentDate ?? 25;
    const targetPeriod = companySettings?.targetPeriod ?? [1, 31];

    this.inputFormat = companySettings?.salaryInputFormat ?? 2;
    this.paymentMonth = companySettings?.paymentMonth ?? '翌月';
    this.payrollId = `${this.workingYear}-${String(this.workingMonth).padStart(2, '0')}`;
    //支払月
    this.setPaymentMonth();

    const paymentDate = this.payrollService.toDateInputValue(this.workingYear, this.paymentMonthNumber, paymentDateDay);
    const targetPeriodStart = this.payrollService.toDateInputValue(this.workingYear, this.workingMonth, targetPeriod[0]);
    const targetPeriodEnd = this.payrollService.toDateInputValue(
      this.workingYear,
      //対象期間終了日が対象期間開始日より前の場合、対象期間終了月を1ヶ月進める
      targetPeriod[1] < targetPeriod[0]
        ? this.workingMonth + 1
        : this.workingMonth,
      targetPeriod[1],
    );

    this.form.patchValue({
      paymentDate,
      targetPeriodStart,
      targetPeriodEnd,
    });

    this.applySalaryInputValidators();
    this.setAutoSalaryCalculation();
    this.updateCalculatedSalaryAmounts();

    //権限問題ないか


  }

  //支払月
  private setPaymentMonth() {
    const companySettings = this.companyService.company()?.settings;

    if (this.paymentMonth === '当月') {
      if (companySettings?.targetPeriod[0] === 1) {
        this.paymentMonthNumber = this.workingMonth;
      } else {
        this.paymentMonthNumber = this.workingMonth + 1;
      }
    } else {
      if (companySettings?.targetPeriod[0] === 1) {
        this.paymentMonthNumber = this.workingMonth + 1;
      } else {
        this.paymentMonthNumber = this.workingMonth + 2;
      }
    }
    if (this.paymentMonthNumber > 12) {
      const value = this.paymentMonthNumber - 12;
      this.paymentMonthNumber = value;
    }
  }

  // 給与・勤務実績1件分の入力フォーム
  form = this.fb.nonNullable.group({
    employeeId: ['', [Validators.required, Validators.pattern('^[a-zA-Z0-9]+$')], [this.validationService.correctEmployeeId]],
    actualWorkingDays: [, [Validators.required, Validators.min(0)]],
    actualWorkingHours: [, [Validators.required, Validators.min(0)]],
    paymentDate: ['', [Validators.required]],
    targetPeriodStart: ['', [Validators.required]],
    targetPeriodEnd: ['', [Validators.required]],
    basicSalary: [0],
    fixedAllowance: [0],
    transportAllowance: [0],
    variableAllowance: [0],
    fixedSalary: [null as number | null, [Validators.required, Validators.min(0)]],
    actualPaymentAmount: [null as number | null, [Validators.required, Validators.min(0)]],
  }, {
    validators: [
      this.validationService.validateSalaryNumber,
      this.validationService.validateWorkingHoursAndDays,
      this.validationService.validatePaymentAmount,
      control => this.validateTargetPeriodStartMonth(control),
    ],
  });

  //フォーマット１用バリデーション
  private applySalaryInputValidators() {
    const detailedControls = [
      this.form.controls.basicSalary,
      this.form.controls.fixedAllowance,
      this.form.controls.transportAllowance,
      this.form.controls.variableAllowance,
    ];
    //バリデーションをそれぞれの項目にセット
    for (const control of detailedControls) {
      control.setValidators(this.inputFormat === 1 ? [Validators.required, Validators.min(0)] : null);
      //「今の値で、今のルールなら valid か invalid かを再判定
      control.updateValueAndValidity({ emitEvent: false });
    }
  }

  //フォーマット１用自動計算
  private setAutoSalaryCalculation() {
    const autoCalculationControls = [
      this.form.controls.basicSalary,
      this.form.controls.fixedAllowance,
      this.form.controls.transportAllowance,
      this.form.controls.variableAllowance,
    ];
    for (const control of autoCalculationControls) {
      control.valueChanges
        //コンポーネントが破棄されるまで購読
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe(() => {
          if (this.inputFormat !== 1) return;

          this.updateCalculatedSalaryAmounts();
        });
    }
  }

  private updateCalculatedSalaryAmounts() {
    if (this.inputFormat !== 1) return;

    const fixedSalary = this.calculateFixedSalary();
    const actualPaymentAmount = this.calculateActualPaymentAmount(fixedSalary);

    this.form.patchValue(
      {
        fixedSalary,
        actualPaymentAmount,
      },
      { emitEvent: false },
    );
  }

  /** 固定給を計算 */
  private calculateFixedSalary() {
    const fixedSalary = Number(this.form.controls.basicSalary.value ?? 0)
      + Number(this.form.controls.fixedAllowance.value ?? 0)
      + Number(this.form.controls.transportAllowance.value ?? 0);
    return fixedSalary;
  }

  /** 総支給額を計算 */
  private calculateActualPaymentAmount(fixedSalary = this.calculateFixedSalary()) {
    const actualPaymentAmount = fixedSalary + Number(this.form.controls.variableAllowance.value ?? 0);
    return actualPaymentAmount;
  }

  /** 対象期間開始月が作業月と一致しているかバリデーション */
  private validateTargetPeriodStartMonth(control: AbstractControl): ValidationErrors | null {
    const targetPeriodStart = control.get('targetPeriodStart')?.value;
    if (!targetPeriodStart) return null;

    const date = parseDateInputValue(targetPeriodStart);
    if (Number.isNaN(date.getTime())) return null;

    const isExpectedMonth = date.getFullYear() === this.workingYear && date.getMonth() + 1 === this.workingMonth;
    return isExpectedMonth ? null : { targetPeriodStartMonthMismatch: true };
  }

  /** 個別入力内容登録 */
  async registerIndividualSalary() {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const salary: Partial<Payroll> = {
      payrollId: this.payrollId,
      type: '毎月',
      companyId: this.companyId!,
      actualWorkingDays: this.form.value.actualWorkingDays!,
      //入力値は月単位、DBには週単位で登録する
      actualWorkingHours: Math.round(this.form.value.actualWorkingHours! * 12 / 52),
      paymentDate: timestampFromDateInput(this.form.value.paymentDate!),
      targetPeriod: [
        timestampFromDateInput(this.form.value.targetPeriodStart!),
        timestampFromDateInput(this.form.value.targetPeriodEnd!),
      ],
      fixedSalary: this.form.value.fixedSalary!,
      actualPaymentAmount: this.form.value.actualPaymentAmount!,
    };

    const employeeId = this.form.value.employeeId!;
    const employee = await this.employeeService.getEmployeeByEmployeeId(employeeId);
    if (this.employeeService.isRetired(employee)) {
      this.message = `社員ID ${employeeId} は退社済みのため、給与入力の対象外です`;
      return;
    }

    const existingPayroll = await this.payrollService.getPayroll(employeeId, salary);
    if (existingPayroll) {
      this.message = `社員ID ${employeeId} の同じ対象月の給与・勤務実績は既に登録済みです`;
      return;
    }

    const result = await this.payrollService.registerPayroll(employeeId, salary);
    if (!result) {
      this.message = CREATE_MESSAGES.FAILED;
      this.form.reset();
      return;
    }
    this.message = CREATE_MESSAGES.SUCCESS;
    await this.payrollService.getAllPayrollListForMonth(this.payrollId, true);
    this.form.reset();
    this.commonService.showTimedMessage(this.message, value => this.message = value, this.messageTimer);
  }

  //リセット
  resetForm() {
    this.form.reset();
    this.applySalaryInputValidators();
    this.updateCalculatedSalaryAmounts();
  }

  /** 今月の申請一覧へ遷移 */
  toApplicationList() {
    this.router.navigate(['/system-application-list']);
  }

  /** 保険料確認へ遷移 */
  toInsuranceConfirm() {
    this.router.navigate(['/insurance-confirm', this.workingYear, this.workingMonth]);
  }
}
