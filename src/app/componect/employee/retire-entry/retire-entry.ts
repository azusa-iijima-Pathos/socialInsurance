import { Component, inject } from '@angular/core';
import { FormBuilder, Validators } from '@angular/forms';
import { ValidationService } from '../../../service/common/validation-service';
import { CommonService, MessageTimer } from '../../../service/common/common-service';
import { EmployeeService } from '../../../service/Firestore/employee-service';
import { Employee } from '../../../model/employee';
import { Event } from '../../../model/event';
import { formatTimestampForDateInput, parseDateInputValue, timestampFromDateInput } from '../../../service/common/date-input.util';
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
import { wasEmployedOnDate } from '../../../service/logic/employee-enrollment.util';

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

  employeeSearchText = '';

  form = this.fb.nonNullable.group({
    employeeId: ['', [Validators.required], [this.validationService.validateRetireEntryEmployeeId]],
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

    this.form.get('employeeId')?.valueChanges.subscribe(() => {
      this.form.updateValueAndValidity({ emitEvent: false });
    });

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
    this.employeeSearchText = '';
    await this.loadScheduledRetires();
  }

  getFilteredRetireTargetEmployees(): Employee[] {
    return this.filterEmployeesBySearch(
      this.employeeService.allEmployees().filter(employee =>
        employee.workStatus !== '退社済み' && employee.workStatus !== '退社予定',
      ),
    );
  }

  private filterEmployeesBySearch(employees: Employee[]): Employee[] {
    const query = this.employeeSearchText.trim().toLowerCase();
    const sorted = [...employees].sort((left, right) => left.employeeId.localeCompare(right.employeeId));
    if (!query) return sorted;

    return sorted.filter(employee => {
      const name = `${employee.firstName ?? ''} ${employee.lastName ?? ''}`.toLowerCase();
      return employee.employeeId.toLowerCase().includes(query) || name.includes(query);
    });
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
    return this.employeeEventApprovalService.canApproveByOccurrenceDateOrInWorkingPeriod(resignationDate);
  }

  isResignationDateBeforeCurrentWorkPeriod(resignationDate?: Timestamp): boolean {
    if (!resignationDate) return false;
    const targetPeriodStart = this.companyService.company()?.settings?.targetPeriod[0] ?? 1;
    const resignMonth = getWorkMonthForDate(resignationDate.toDate(), targetPeriodStart);
    const current = getWorkingYearMonth();
    return resignMonth.year * 12 + resignMonth.month < current.year * 12 + current.month;
  }

  private isResignationDateOnOrAfterHireDate(employee: Employee, targetDate: Date): boolean {
    const hire = employee.hireDate?.toDate();
    if (!hire) return false;
    const hireDate = new Date(hire);
    hireDate.setHours(0, 0, 0, 0);
    const target = new Date(targetDate);
    target.setHours(0, 0, 0, 0);
    return target.getTime() >= hireDate.getTime();
  }

  async saveScheduledRetireDate(employee: Employee) {
    const newDate = this.scheduledRetireDateEdits[employee.employeeId];
    if (!newDate) return;

    const targetDate = parseDateInputValue(newDate);
    if (!this.isResignationDateOnOrAfterHireDate(employee, targetDate)) {
      this.showScheduledListMessage('退職予定日は入社日以降で指定してください');
      return;
    }

    const resignationDate = timestampFromDateInput(newDate);
    const updated = await this.employeeService.updateEmployee({
      employeeId: employee.employeeId,
      resignationDate,
    });
    if (!updated) {
      this.showScheduledListMessage('退職予定日の更新に失敗しました');
      return;
    }

    const synced = await this.syncPendingRetireEventResignationDate(employee.employeeId, resignationDate);
    if (!synced) {
      this.showScheduledListMessage('退職予定日の更新に失敗しました（退社イベント）');
      return;
    }

    this.scheduledRetireDateEditingIds.delete(employee.employeeId);
    this.showScheduledListMessage(`社員ID：${employee.employeeId} の退職予定日を更新しました`);
    await this.loadScheduledRetires();
  }

  async approveScheduledRetire(employee: Employee) {
    let retireEvent = await this.findPendingRetireEvent(employee.employeeId);
    if (!retireEvent) {
      this.showScheduledListMessage('申請中の退社イベントが見つかりません');
      return;
    }

    const freshEmployee = await this.employeeService.getEmployeeByEmployeeId(employee.employeeId);
    if (freshEmployee?.resignationDate) {
      const synced = await this.syncPendingRetireEventResignationDate(
        employee.employeeId,
        freshEmployee.resignationDate,
      );
      if (!synced) {
        this.showScheduledListMessage('退社イベントの退職日同期に失敗しました');
        return;
      }
      retireEvent = synced;
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

    const resignationDate = freshEmployee?.resignationDate ?? employee.resignationDate;
    const beforePeriod = this.isResignationDateBeforeCurrentWorkPeriod(resignationDate);
    const approvedEvent: Event = {
      ...retireEvent,
      approval: {
        ...retireEvent.approval,
        approvalStatus: '承認済み',
      },
    };

    if (this.employeeEventApprovalService.canApplyEventInWorkingPeriod(approvedEvent)) {
      const applied = await this.employeeEventApprovalService.applyRetireEvent(
        employee.employeeId,
        approvedEvent,
        this.loginEmployeeId,
      );
      if (!applied) {
        this.showScheduledListMessage('退社承認しましたが、従業員情報への反映に失敗しました');
        await this.loadScheduledRetires();
        return;
      }

      if (beforePeriod) {
        this.showScheduledListRetroactiveMessage(
          '退社を承認し、従業員情報に反映しました。<br>現在の作業対象期間より前の退社になります。<br>遡及修正より保険情報の喪失登録をおこなってください。',
        );
      } else {
        this.showScheduledListMessage(
          `社員ID：${employee.employeeId} ${name}さんの退社を承認し、従業員情報に反映しました`,
        );
      }
      await this.loadScheduledRetires();
      return;
    }

    if (beforePeriod) {
      this.showScheduledListRetroactiveMessage(
        '退社を承認しました。<br>現在の作業対象期間より前の退社になります。<br>遡及修正より保険情報の喪失登録をおこなってください。',
      );
    } else {
      this.showScheduledListMessage(`社員ID：${employee.employeeId} ${name}さんの退社を承認しました（反映は作業期間内に行ってください）`);
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

  /** 退社予定日変更時、申請中退社イベントの発生日・payload を社員マスタと揃える */
  private async syncPendingRetireEventResignationDate(
    employeeId: string,
    resignationDate: Timestamp,
  ): Promise<Event | null> {
    const retireEvent = await this.findPendingRetireEvent(employeeId);
    if (!retireEvent?.eventId) return null;

    const currentDateInput = formatTimestampForDateInput(retireEvent.occurredDate);
    const newDateInput = formatTimestampForDateInput(resignationDate);
    const after = retireEvent.payload?.['after'] as Employee | undefined;
    const updatedAfter = after ? { ...after, resignationDate } : undefined;

    if (currentDateInput === newDateInput && formatTimestampForDateInput(after?.resignationDate) === newDateInput) {
      return retireEvent;
    }

    const eventUpdated = await this.eventService.updateEvent(employeeId, retireEvent.eventId, {
      occurredDate: resignationDate,
      payload: {
        ...retireEvent.payload,
        ...(updatedAfter ? { after: updatedAfter } : {}),
      },
    });
    if (!eventUpdated) return null;

    return {
      ...retireEvent,
      occurredDate: resignationDate,
      payload: {
        ...retireEvent.payload,
        ...(updatedAfter ? { after: updatedAfter } : {}),
      },
    };
  }

  private retireDateValidator: ValidatorFn = (group: AbstractControl): ValidationErrors | null => {
    const workStatus = group.get('workStatus')?.value;
    const occurredDate = group.get('occurredDate')?.value;
    const employeeId = group.get('employeeId')?.value;

    if (!workStatus || !occurredDate) return null;

    const today = new Date();
    const targetDate = parseDateInputValue(occurredDate);
    today.setHours(0, 0, 0, 0);

    if (employeeId) {
      const employee = this.employeeService.allEmployees().find(item => item.employeeId === employeeId);
      if (employee && !wasEmployedOnDate(employee, targetDate)) {
        return { notEmployedOnDate: true };
      }
    }

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
