import { Component, inject } from '@angular/core';
import { FormBuilder, Validators } from '@angular/forms';
import { ValidationService } from '../../../service/common/validation-service';
import { CommonService, MessageTimer } from '../../../service/common/common-service';
import { EmployeeService } from '../../../service/Firestore/employee-service';
import { Employee } from '../../../model/employee';
import { formatTimestampForDateInput, timestampFromDateInput } from '../../../service/common/date-input.util';
import { WorkStatus } from '../../../constants/model-constants';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormsModule } from '@angular/forms';
import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';
import { EmployeeDetailEventService } from '../../../service/logic/employee-detail-event-service';
import { CompanyService } from '../../../service/Firestore/company-service';
import { EventService } from '../../../service/Firestore/event-service';
import { EmployeeEventApprovalService } from '../../../service/logic/employee-event-approval.service';
import { Timestamp } from '@angular/fire/firestore';
import { getWorkMonthForDate, getWorkingYearMonth } from '../../../service/logic/event-id-service';

@Component({
  selector: 'app-retire-entry',
  imports: [CommonModule, ReactiveFormsModule, FormsModule],
  templateUrl: './retire-entry.html',
  styleUrls: ['./retire-entry.css', '../employee-detail/employee-detail.css'],
})
export class RetireEntry {

  private fb = inject(FormBuilder);
  private validationService = inject(ValidationService);
  private employeeService = inject(EmployeeService);
  private employeeDetailEventService = inject(EmployeeDetailEventService);
  private companyService = inject(CompanyService);
  private eventService = inject(EventService);
  private employeeEventApprovalService = inject(EmployeeEventApprovalService);
  commonService = inject(CommonService);

  form = this.fb.nonNullable.group({
    employeeId: ['', [Validators.required, Validators.pattern('^[a-zA-Z0-9]+$')], [this.validationService.validateRetireEntryEmployeeId]],
    workStatus: ['退社予定' as WorkStatus, [Validators.required]],
    occurredDate: ['', [Validators.required]],
  });

  message = '';
  scheduledListMessage = '';
  scheduledListRetroactiveMessage = '';
  messageTimer: MessageTimer = null;
  scheduledListMessageTimer: MessageTimer = null;
  scheduledListRetroactiveMessageTimer: MessageTimer = null;
  loginEmployeeId = sessionStorage.getItem('loginEmployeeId') ?? '';

  scheduledRetires: Employee[] = [];
  scheduledRetireDateEdits: Record<string, string> = {};
  scheduledRetireDateEditingIds = new Set<string>();
  isRetireBeforeCurrentWorkPeriod = false;

  async ngOnInit() {
    await this.employeeService.getAllEmployees();
    await this.companyService.getCompany();
    await this.loadScheduledRetires();
    this.form.setValidators([this.retireDateValidator]);

    this.form.get('occurredDate')?.valueChanges.subscribe(date => {
      if (!date) {
        this.isRetireBeforeCurrentWorkPeriod = false;
        return;
      }
      const today = new Date();
      const target = new Date(date);
      today.setHours(0, 0, 0, 0);
      target.setHours(0, 0, 0, 0);
      const status: WorkStatus =
        target <= today ? '退社済み' : '退社予定';
      this.form.patchValue(
        { workStatus: status },
        { emitEvent: false },
      );
      this.isRetireBeforeCurrentWorkPeriod = this.isResignationDateBeforeCurrentWorkPeriod(
        timestampFromDateInput(date),
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
      this.showMessage('自分自身の退職処理することはできません');
      return;
    }

    if (!window.confirm('退職処理を行いますか？')) {
      return;
    }

    const employee = await this.employeeService.getEmployeeByEmployeeId(this.form.value.employeeId!);
    if (!employee) {
      this.showMessage('社員情報が存在しません');
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
      this.showMessage('退職処理に失敗しました');
      return;
    }

    const retireResult = await this.employeeDetailEventService.createRetireEvents(
      this.form.value.employeeId!,
      previousEmployee,
      updatedEmployee,
      this.loginEmployeeId,
    );
    if (retireResult.createdIds.length === 0) {
      this.showMessage('退職イベントの作成に失敗しました');
      return;
    }

    let successMessage = this.form.value.workStatus === '退社予定'
      ? '退職予定の登録に成功しました'
      : '退職登録に成功しました';
    this.showMessage(successMessage);
    this.form.reset({ workStatus: '退社予定' });
    await this.loadScheduledRetires();
  }

  async loadScheduledRetires() {
    await this.employeeService.getAllEmployees(true);
    this.scheduledRetires = this.employeeService.allEmployees()
      .filter(employee => employee.workStatus === '退社予定')
      .sort((left, right) => {
        const leftTime = left.resignationDate?.toDate().getTime() ?? Number.MAX_SAFE_INTEGER;
        const rightTime = right.resignationDate?.toDate().getTime() ?? Number.MAX_SAFE_INTEGER;
        return leftTime - rightTime;
      });
    this.scheduledRetireDateEdits = {};
    this.scheduledRetireDateEditingIds.clear();
    for (const employee of this.scheduledRetires) {
      this.scheduledRetireDateEdits[employee.employeeId] =
        formatTimestampForDateInput(employee.resignationDate) ?? '';
    }
  }

  getScheduledEmployeeName(employee: Employee): string {
    return `${employee.lastName ?? ''} ${employee.firstName ?? ''}`.trim();
  }

  isEditingScheduledRetireDate(employeeId: string): boolean {
    return this.scheduledRetireDateEditingIds.has(employeeId);
  }

  startEditingScheduledRetireDate(employee: Employee) {
    this.scheduledRetireDateEdits[employee.employeeId] =
      formatTimestampForDateInput(employee.resignationDate) ?? '';
    this.scheduledRetireDateEditingIds.add(employee.employeeId);
  }

  needsScheduledRetireAttention(resignationDate?: Timestamp): boolean {
    if (!resignationDate) return false;
    const targetPeriodStart = this.companyService.company()?.settings?.targetPeriod[0] ?? 1;
    const resignMonth = getWorkMonthForDate(resignationDate.toDate(), targetPeriodStart);
    const current = getWorkingYearMonth();
    return resignMonth.year * 12 + resignMonth.month <= current.year * 12 + current.month;
  }

  isResignationDateBeforeCurrentWorkPeriod(resignationDate?: Timestamp): boolean {
    if (!resignationDate) return false;
    const targetPeriodStart = this.companyService.company()?.settings?.targetPeriod[0] ?? 1;
    const resignMonth = getWorkMonthForDate(resignationDate.toDate(), targetPeriodStart);
    const current = getWorkingYearMonth();
    return resignMonth.year * 12 + resignMonth.month < current.year * 12 + current.month;
  }

  async saveScheduledRetireDate(employee: Employee) {
    const newDate = this.scheduledRetireDateEdits[employee.employeeId];
    if (!newDate) return;

    const updated = await this.employeeService.updateEmployee({
      employeeId: employee.employeeId,
      resignationDate: timestampFromDateInput(newDate),
    });
    if (updated) {
      this.scheduledRetireDateEditingIds.delete(employee.employeeId);
      this.showScheduledListMessage(`社員ID：${employee.employeeId} の退職予定日を更新しました`);
      await this.loadScheduledRetires();
    } else {
      this.showScheduledListMessage('退職予定日の更新に失敗しました');
    }
  }

  async approveScheduledRetire(employee: Employee) {
    const retireEvent = await this.findPendingRetireEvent(employee.employeeId);
    if (!retireEvent) {
      this.showScheduledListMessage('申請中の退社イベントが見つかりません');
      return;
    }

    const name = this.getScheduledEmployeeName(employee);
    if (!window.confirm(`社員ID：${employee.employeeId} ${name}さんの退社を承認しますか？`)) return;

    const approved = await this.employeeEventApprovalService.approveRetireEvent(
      employee.employeeId,
      retireEvent,
      this.loginEmployeeId,
    );
    if (!approved) {
      this.showScheduledListMessage('退社承認に失敗しました');
      return;
    }

    const beforePeriod = this.isResignationDateBeforeCurrentWorkPeriod(employee.resignationDate);
    if (beforePeriod) {
      this.showScheduledListRetroactiveMessage(
        '退社を承認しました。<br>現在の作業対象期間より前の退社になります。<br>遡及修正より保険情報の喪失登録をおこなってください。',
      );
    } else {
      this.showScheduledListMessage(`社員ID：${employee.employeeId} ${name}さんの退社を承認しました`);
    }
    await this.loadScheduledRetires();
  }

  async cancelScheduledRetire(employee: Employee) {
    const name = this.getScheduledEmployeeName(employee);
    if (!window.confirm(`社員ID：${employee.employeeId} ${name}さんの退社予定を取り消しますか？`)) return;

    const retireEvent = await this.findPendingRetireEvent(employee.employeeId);
    if (retireEvent) {
      const rejected = await this.employeeEventApprovalService.rejectEvent(
        employee.employeeId,
        retireEvent,
        this.loginEmployeeId,
      );
      if (!rejected) {
        this.showScheduledListMessage('退社予定の取り消しに失敗しました');
        return;
      }
    }

    const updated = await this.employeeService.updateEmployee({
      employeeId: employee.employeeId,
      workStatus: '通常勤務',
      resignationDate: null,
    });
    if (!updated) {
      this.showScheduledListMessage('退社予定の取り消しに失敗しました');
      return;
    }

    this.showScheduledListMessage(`社員ID：${employee.employeeId} の退社予定を取り消しました`);
    await this.loadScheduledRetires();
  }

  private async findPendingRetireEvent(employeeId: string) {
    const pendingEvents = await this.eventService.getPendingEmployeeEvents(employeeId);
    return pendingEvents.find(event =>
      event.eventType === '退社' && event.applicantType === '管理者',
    ) ?? null;
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

  private showMessage(message: string) {
    this.messageTimer = this.commonService.showTimedMessage(message, value => this.message = value, this.messageTimer);
  }

  private showScheduledListMessage(message: string) {
    this.scheduledListRetroactiveMessageTimer = this.commonService.clearTimedMessage(
      value => this.scheduledListRetroactiveMessage = value,
      this.scheduledListRetroactiveMessageTimer,
    );
    this.scheduledListMessageTimer = this.commonService.showTimedMessage(
      message,
      value => this.scheduledListMessage = value,
      this.scheduledListMessageTimer,
    );
  }

  private showScheduledListRetroactiveMessage(message: string) {
    this.scheduledListMessageTimer = this.commonService.clearTimedMessage(
      value => this.scheduledListMessage = value,
      this.scheduledListMessageTimer,
    );
    this.scheduledListRetroactiveMessageTimer = this.commonService.showTimedMessage(
      message,
      value => this.scheduledListRetroactiveMessage = value,
      this.scheduledListRetroactiveMessageTimer,
    );
  }
}
