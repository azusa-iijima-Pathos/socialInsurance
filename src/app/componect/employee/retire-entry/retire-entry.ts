import { Component, inject } from '@angular/core';
import { EventService } from '../../../service/Firestore/event-service';
import { FormBuilder, Validators } from '@angular/forms';
import { ValidationService } from '../../../service/common/validation-service';
import { CommonService, MessageTimer } from '../../../service/common/common-service';
import { EmployeeService } from '../../../service/Firestore/employee-service';
import { Employee } from '../../../model/employee';
import { Timestamp } from '@angular/fire/firestore';
import { WorkStatus } from '../../../constants/model-constants';
import { Event } from '../../../model/event';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule } from '@angular/forms';
import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

@Component({
  selector: 'app-retire-entry',
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './retire-entry.html',
  styleUrl: './retire-entry.css',
})
export class RetireEntry {

  private eventService = inject(EventService);
  private fb = inject(FormBuilder);
  private validationService = inject(ValidationService);
  private employeeService = inject(EmployeeService);
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
  }

  async registerRetireEntry() {
    this.message = '';
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    if(this.form.value.employeeId === this.loginEmployeeId) {
      const message = '自分自身の退職処理することはできません';
      this.commonService.showTimedMessage(message, value => this.message = value, this.messageTimer);
      return;
    }

    //Windows標準確認ポップを表示
    const confirmed = window.confirm(
      '退職処理を行いますか？'
    );
    if (!confirmed) {
      return;
    }

    // 社員情報を取得
    const employee = await this.employeeService.getEmployeeByEmployeeId(this.form.value.employeeId!);
    if (!employee) {
      const message = '社員情報が存在しません';
      this.commonService.showTimedMessage(message, value => this.message = value, this.messageTimer);
      return;
    }

    // 社員情報を更新用
    const employeeForm: Partial<Employee> = {
      ...employee,
      workStatus: this.form.value.workStatus!,
      resignationDate: Timestamp.fromDate(new Date(this.form.value.occurredDate!)),
    };

    //退社予定の場合
    if (this.form.value.workStatus! === '退社予定') {
      // 退職イベントを作成
      const event: Partial<Event> = {
        occurredDate: Timestamp.fromDate(new Date(this.form.value.occurredDate!)),
        eventType: '退社',
        appliedDate: Timestamp.now(),
        applicantType: '管理者',
        approval: {
          approvalStatus: '申請中',
        },
        payload: {
          employee: employeeForm,
        }
      };
      const result = await this.eventService.createEvent(this.form.value.employeeId!, event);
      if (!result) {
        const message = '退職イベントの作成に失敗しました';
        this.commonService.showTimedMessage(message, value => this.message = value, this.messageTimer);
      }
      const message = '退職予定の登録に成功しました\n退職後に承認一覧から退職承認を行ってください。';
      this.commonService.showTimedMessage(message, value => this.message = value, this.messageTimer);
      this.form.reset();
      await this.employeeService.getAllEmployees(true);
      return;

      //退社済みの場合
    } else if (this.form.value.workStatus! === '退社済み') {
      // 退職イベントを作成
      const event: Partial<Event> = {
        occurredDate: Timestamp.fromDate(new Date(this.form.value.occurredDate!)),
        eventType: '退社',
        appliedDate: Timestamp.now(),
        applicantType: '管理者',
        approval: {
          approvalStatus: '承認済み',
          approvedDate: Timestamp.now(),
          approvedBy: this.loginEmployeeId,
        },
        payload: {
          employee: employeeForm,
        }
      };
      const result = await this.eventService.createEvent(this.form.value.employeeId!, event);
      if (!result) {
        const message = '退職イベントの作成に失敗しました';
        this.commonService.showTimedMessage(message, value => this.message = value, this.messageTimer);
      }
      const message = '退職登録に成功しました';
      this.commonService.showTimedMessage(message, value => this.message = value, this.messageTimer);
      this.form.reset();
      await this.employeeService.getAllEmployees(true);
      return;
    }
  }

  // 退職日のバリデーション
private retireDateValidator: ValidatorFn = (group: AbstractControl): ValidationErrors | null => {
  const workStatus = group.get('workStatus')?.value;
  const occurredDate = group.get('occurredDate')?.value;

  if (!workStatus || !occurredDate) return null;

  const today = new Date();
  const targetDate = new Date(occurredDate);

  // 時間を0時に揃える（比較ブレ防止）
  today.setHours(0, 0, 0, 0);
  targetDate.setHours(0, 0, 0, 0);

  if (workStatus === '退社予定') {
    if (targetDate <= today) {
      return { retireDateInvalid: true };
    }
  }

  if (workStatus === '退社済み') {
    if (targetDate > today) {
      return { retireDateInvalid: true };
    }
  }
  return null;
};
}
