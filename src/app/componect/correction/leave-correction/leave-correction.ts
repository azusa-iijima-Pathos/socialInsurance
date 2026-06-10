import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { EmployeeService } from '../../../service/Firestore/employee-service';
import { CommonService, MessageTimer } from '../../../service/common/common-service';
import { CorrectionLogicService } from '../../../service/logic/correction-logic.service';
import { getWorkingYearMonth } from '../../../service/logic/event-id-service';
import { LeaveType } from '../../../constants/model-constants';
import { UPDATE_MESSAGES } from '../../../constants/constants';
import { parseDateInputValue } from '../../../service/common/date-input.util';

@Component({
  selector: 'app-leave-correction',
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './leave-correction.html',
  styleUrl: './leave-correction.css',
})
export class LeaveCorrection {

  private fb = inject(FormBuilder);
  private employeeService = inject(EmployeeService);
  private correctionLogicService = inject(CorrectionLogicService);
  commonService = inject(CommonService);

  message = '';
  private messageTimer: MessageTimer = null;

  form = this.fb.nonNullable.group({
    employeeId: ['', Validators.required],
    leaveTypes: ['産前産後' as LeaveType, Validators.required],
    actualStartDate: ['', Validators.required],
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

    const actualStart = parseDateInputValue(this.form.value.actualStartDate!);
    const actualMonth = await this.correctionLogicService.getWorkMonthForInputDate(actualStart);
    const working = getWorkingYearMonth();
    const leaveTypes = this.form.value.leaveTypes as LeaveType;

    const updated = await this.employeeService.updateEmployee({
      employeeId,
      workStatus: '休職中',
      leaveTypes,
    });

    if (!updated) {
      this.showMessage(UPDATE_MESSAGES.FAILED);
      return;
    }

    const months = this.correctionLogicService.getLeaveCorrectionMonths(actualMonth, actualMonth, working);
    this.showMessage(`休職情報を${UPDATE_MESSAGES.SUCCESS}（${months.length}か月分を確認対象としました）`);
  }

  private showMessage(message: string) {
    this.messageTimer = this.commonService.showTimedMessage(
      message,
      value => this.message = value,
      this.messageTimer,
    );
  }
}
