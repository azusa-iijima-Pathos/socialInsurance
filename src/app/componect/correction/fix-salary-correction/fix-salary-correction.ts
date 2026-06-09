import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { EmployeeService } from '../../../service/Firestore/employee-service';
import { CommonService, MessageTimer } from '../../../service/common/common-service';
import { CorrectionLogicService } from '../../../service/logic/correction-logic.service';
import { CalculationRunService } from '../../../service/Firestore/calculation-run-service';
import { Employee } from '../../../model/employee';
import { Timestamp } from '@angular/fire/firestore';
import { addMonths, getFixedSalarySystemOccurredDate, getWorkingYearMonth } from '../../../service/logic/event-id-service';
import { UPDATE_MESSAGES } from '../../../constants/constants';

@Component({
  selector: 'app-fix-salary-correction',
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './fix-salary-correction.html',
  styleUrl: './fix-salary-correction.css',
})
export class FixSalaryCorrection {

  private fb = inject(FormBuilder);
  private employeeService = inject(EmployeeService);
  private correctionLogicService = inject(CorrectionLogicService);
  private calculationRunService = inject(CalculationRunService);
  commonService = inject(CommonService);

  message = '';
  private messageTimer: MessageTimer = null;

  form = this.fb.nonNullable.group({
    employeeId: ['', Validators.required],
    applyDate: ['', Validators.required],
    fixedSalary: [0, [Validators.required, Validators.min(0)]],
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
    const revisionMonth = addMonths(applyMonth.year, applyMonth.month, 3);
    const working = getWorkingYearMonth();
    const before = { ...employee };
    const after: Employee = {
      ...employee,
      employmentContract: {
        ...employee.employmentContract,
        fixedSalary: Number(this.form.value.fixedSalary),
      },
    };

    const updated = await this.employeeService.updateEmployee({
      employeeId,
      employmentContract: after.employmentContract,
    });
    if (!updated) {
      this.showMessage(UPDATE_MESSAGES.FAILED);
      return;
    }

    const revisionKey = revisionMonth.year * 12 + revisionMonth.month;
    const workingKey = working.year * 12 + working.month;

    if (revisionKey <= workingKey) {
      await this.calculationRunService.createAdHocRevisionRun(
        employeeId,
        revisionMonth,
        { before, after },
        Timestamp.fromDate(getFixedSalarySystemOccurredDate(revisionMonth)),
      );
      this.showMessage(`固定給を${UPDATE_MESSAGES.SUCCESS}。随時改定のシステム計算結果を作成しました。`);
    } else {
      this.showMessage(`固定給を${UPDATE_MESSAGES.SUCCESS}。随時改定は${revisionMonth.year}年${revisionMonth.month}月以降に反映されます。`);
    }
  }

  private showMessage(message: string) {
    this.messageTimer = this.commonService.showTimedMessage(
      message,
      value => this.message = value,
      this.messageTimer,
    );
  }
}
