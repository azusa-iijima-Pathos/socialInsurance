import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { EmployeeService } from '../../../service/Firestore/employee-service';
import { CommonService, MessageTimer } from '../../../service/common/common-service';
import { CorrectionLogicService } from '../../../service/logic/correction-logic.service';
import { CalculationRunService } from '../../../service/Firestore/calculation-run-service';
import { Employee, EmployeeInsurance } from '../../../model/employee';
import { Timestamp } from '@angular/fire/firestore';
import { getWorkingYearMonth } from '../../../service/logic/event-id-service';
import { UPDATE_MESSAGES } from '../../../constants/constants';

@Component({
  selector: 'app-insurance-correction',
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './insurance-correction.html',
  styleUrl: './insurance-correction.css',
})
export class InsuranceCorrection {

  private fb = inject(FormBuilder);
  private employeeService = inject(EmployeeService);
  private correctionLogicService = inject(CorrectionLogicService);
  private calculationRunService = inject(CalculationRunService);
  commonService = inject(CommonService);

  message = '';
  private messageTimer: MessageTimer = null;
  monthlyDiffs: { payrollId: string; totalDiff: number }[] = [];

  form = this.fb.nonNullable.group({
    employeeId: ['', Validators.required],
    applyDate: ['', Validators.required],
    currentGrade: [0, [Validators.required, Validators.min(0), Validators.max(50)]],
  });

  async ngOnInit() {
    await this.employeeService.getAllEmployees();
  }

  get employees() {
    return this.employeeService.allEmployees();
  }

  async submit() {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const employeeId = this.form.value.employeeId!;
    const employee = await this.employeeService.getEmployeeByEmployeeId(employeeId);
    if (!employee) {
      this.showMessage('従業員が見つかりません');
      return;
    }

    const applyDate = new Date(this.form.value.applyDate!);
    const applyMonth = await this.correctionLogicService.getWorkMonthForInputDate(applyDate);
    const working = getWorkingYearMonth();

    const beforeInsurance = { ...employee.insurance } as EmployeeInsurance;
    const afterInsurance: EmployeeInsurance = {
      ...beforeInsurance,
      currentGrade: Number(this.form.value.currentGrade),
    };

    const monthlyDiffs = await this.correctionLogicService.calculateInsuranceDiffs(
      employee,
      afterInsurance,
      applyMonth,
      working,
    );

    const updated = await this.employeeService.updateEmployee({
      employeeId,
      insurance: afterInsurance,
    });
    if (!updated) {
      this.showMessage(UPDATE_MESSAGES.FAILED);
      return;
    }

    if (monthlyDiffs.length > 0) {
      await this.calculationRunService.createDifferenceAdjustmentRun(
        employeeId,
        '保険情報修正',
        applyMonth,
        monthlyDiffs,
        { before: beforeInsurance, after: afterInsurance },
      );
    }

    this.monthlyDiffs = monthlyDiffs.map(item => ({ payrollId: item.payrollId, totalDiff: item.totalDiff }));
    this.showMessage(`保険情報を${UPDATE_MESSAGES.SUCCESS}${monthlyDiffs.length ? '（差額調整を作成しました）' : ''}`);
  }

  private showMessage(message: string) {
    this.messageTimer = this.commonService.showTimedMessage(
      message,
      value => this.message = value,
      this.messageTimer,
    );
  }
}
