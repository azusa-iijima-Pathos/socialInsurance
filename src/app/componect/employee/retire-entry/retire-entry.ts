import { Component, inject } from '@angular/core';
import { FormBuilder, Validators } from '@angular/forms';
import { ValidationService } from '../../../service/common/validation-service';
import { CommonService, MessageTimer } from '../../../service/common/common-service';
import { EmployeeService } from '../../../service/Firestore/employee-service';
import { Employee } from '../../../model/employee';
import { timestampFromDateInput } from '../../../service/common/date-input.util';
import { WorkStatus } from '../../../constants/model-constants';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule } from '@angular/forms';
import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';
import { EmployeeDetailEventService } from '../../../service/logic/employee-detail-event-service';

@Component({
  selector: 'app-retire-entry',
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './retire-entry.html',
  styleUrl: './retire-entry.css',
})
export class RetireEntry {

  private fb = inject(FormBuilder);
  private validationService = inject(ValidationService);
  private employeeService = inject(EmployeeService);
  private employeeDetailEventService = inject(EmployeeDetailEventService);
  commonService = inject(CommonService);

  form = this.fb.nonNullable.group({
    employeeId: ['', [Validators.required, Validators.pattern('^[a-zA-Z0-9]+$')], [this.validationService.correctEmployeeId]],
    workStatus: ['退社予定' as WorkStatus, [Validators.required]],
    occurredDate: ['', [Validators.required]],
  });

  message = '';
  messageTimer: MessageTimer = null;
  loginEmployeeId = sessionStorage.getItem('loginEmployeeId') ?? '';

  async ngOnInit() {
    await this.employeeService.getAllEmployees();
    this.form.setValidators([this.retireDateValidator]);
    
      this.form.get('occurredDate')?.valueChanges.subscribe(date => {
        if (!date) return;
        const today = new Date();
        const target = new Date(date);
        today.setHours(0, 0, 0, 0);
        target.setHours(0, 0, 0, 0);
        const status: WorkStatus =
          target <= today ? '退社済み' : '退社予定';
        this.form.patchValue(
          { workStatus: status },
          { emitEvent: false } // 無限ループ防止
        );
      });
    }


  async registerRetireEntry() {
    this.message = '';
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    if (this.form.value.employeeId === this.loginEmployeeId) {
      this.commonService.showTimedMessage(
        '自分自身の退職処理することはできません',
        value => this.message = value,
        this.messageTimer,
      );
      return;
    }

    if (!window.confirm('退職処理を行いますか？')) {
      return;
    }

    const employee = await this.employeeService.getEmployeeByEmployeeId(this.form.value.employeeId!);
    if (!employee) {
      this.commonService.showTimedMessage(
        '社員情報が存在しません',
        value => this.message = value,
        this.messageTimer,
      );
      return;
    }

    const previousEmployee: Employee = {
      ...employee,
      employmentContract: employee.employmentContract ? { ...employee.employmentContract } : undefined,
    };
    const resignationDate = timestampFromDateInput(this.form.value.occurredDate!);
    const updatedEmployee: Employee = {
      ...previousEmployee,
      workStatus: this.form.value.workStatus!,
      resignationDate,
    };

    const updateResult = await this.employeeService.updateEmployee({
      employeeId: this.form.value.employeeId!,
      workStatus: this.form.value.workStatus!,
      resignationDate,
    });
    if (!updateResult) {
      this.commonService.showTimedMessage(
        '退職処理に失敗しました',
        value => this.message = value,
        this.messageTimer,
      );
      return;
    }

    const createdEventIds = await this.employeeDetailEventService.createRetireEvents(
      this.form.value.employeeId!,
      previousEmployee,
      updatedEmployee,
      this.loginEmployeeId,
    );
    if (createdEventIds.length === 0) {
      this.commonService.showTimedMessage(
        '退職イベントの作成に失敗しました',
        value => this.message = value,
        this.messageTimer,
      );
      return;
    }

    const message = this.form.value.workStatus === '退社予定'
      ? '退職予定の登録に成功しました'
      : '退職登録に成功しました';
    this.commonService.showTimedMessage(message, value => this.message = value, this.messageTimer);
    this.form.reset({ workStatus: '退社予定' });
    await this.employeeService.getAllEmployees(true);
  }

  private retireDateValidator: ValidatorFn = (group: AbstractControl): ValidationErrors | null => {
    const workStatus = group.get('workStatus')?.value;
    const occurredDate = group.get('occurredDate')?.value;

    if (!workStatus || !occurredDate) return null;

    const today = new Date();
    const targetDate = new Date(occurredDate);
    today.setHours(0, 0, 0, 0);
    targetDate.setHours(0, 0, 0, 0);

    if (workStatus === '退社予定' && targetDate <= today) {
      return { retireDateInvalid: true };
    }

    if (workStatus === '退社済み' && targetDate > today) {
      return { retireDateInvalid: true };
    }

    return null;
  };
}
