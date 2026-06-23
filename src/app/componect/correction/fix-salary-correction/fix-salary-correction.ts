import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { EmployeeService } from '../../../service/Firestore/employee-service';
import { CommonService, MessageTimer } from '../../../service/common/common-service';
import { CalculationRunService } from '../../../service/Firestore/calculation-run-service';
import { Employee } from '../../../model/employee';
import { parseDateInputValue } from '../../../service/common/date-input.util';
import { Timestamp } from '@angular/fire/firestore';
import { getAdHocRevisionWorkMonth } from '../../../service/logic/event-id-service';
import { UPDATE_MESSAGES } from '../../../constants/constants';
import { CompanyService } from '../../../service/Firestore/company-service';

@Component({
  selector: 'app-fix-salary-correction',
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './fix-salary-correction.html',
  styleUrl: './fix-salary-correction.css',
})
export class FixSalaryCorrection {

  private fb = inject(FormBuilder);
  private employeeService = inject(EmployeeService);
  private calculationRunService = inject(CalculationRunService);
  private companyService = inject(CompanyService);
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

    const applyDate = parseDateInputValue(this.form.value.applyDate!);
    await this.companyService.getCompany();
    const targetPeriodStart = this.companyService.company()?.settings?.targetPeriod[0] ?? 1;
    const revisionMonth = getAdHocRevisionWorkMonth(applyDate, targetPeriodStart);
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

    await this.calculationRunService.createAdHocRevisionRun(
      employeeId,
      revisionMonth,
      { before, after, fixedSalaryChangeDate: Timestamp.fromDate(applyDate) },
      Timestamp.fromDate(applyDate),
    );
    this.showMessage(`固定給を${UPDATE_MESSAGES.SUCCESS}。随時改定は${revisionMonth.year}年${revisionMonth.month}月以降に確認してください。`);
  }

  private showMessage(message: string) {
    this.messageTimer = this.commonService.showTimedMessage(
      message,
      value => this.message = value,
      this.messageTimer,
    );
  }
}
