import { inject, Injectable } from '@angular/core';
import { Timestamp } from '@angular/fire/firestore';
import { ChangeType } from '../../constants/model-constants';
import { Dependent } from '../../model/dependent';
import { Event } from '../../model/event';
import { CompanyService } from '../Firestore/company-service';
import { DependentService } from '../Firestore/dependent-service';
import { EventService } from '../Firestore/event-service';
import {
  buildDependentChangeEventBaseId,
  getCurrentAppliedFromMonth,
  isWorkMonthAfterCurrent,
} from './event-id-service';
import { parseDateInputValue, timestampFromDateInput } from '../common/date-input.util';

export type DependentChangeInput = {
  before: Dependent | null;
  after: Partial<Dependent>;
  changeType: ChangeType;
  /** 変更タイプが「変更」のときの適用日（yyyy-MM-dd） */
  appliedDateInput?: string;
};

export function determineDependentChangeType(
  before: Dependent | null | undefined,
  after: Partial<Dependent>,
): ChangeType {
  if (!before) {
    return '追加';
  }

  const wasDependent = before.isDependent !== false;
  const isDependent = after.isDependent !== false;

  if (!wasDependent && isDependent) {
    return '追加';
  }
  if (wasDependent && !isDependent) {
    return '削除';
  }
  return '変更';
}

export function getDependentChangeEffectiveDateInput(
  changeType: ChangeType,
  after: Partial<Dependent>,
  appliedDateInput?: string,
): string {
  if (changeType === '変更') {
    return appliedDateInput ?? '';
  }
  if (changeType === '追加') {
    return after.dependentStartDate
      ? formatDateInputFromTimestamp(after.dependentStartDate)
      : '';
  }
  return after.dependentEndDate
    ? formatDateInputFromTimestamp(after.dependentEndDate)
    : '';
}

function formatDateInputFromTimestamp(value: Timestamp): string {
  const date = value.toDate();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

@Injectable({
  providedIn: 'root',
})
export class DependentChangeEventService {

  private eventService = inject(EventService);
  private dependentService = inject(DependentService);
  private companyService = inject(CompanyService);

  async validateDependentChangeDate(dateInput: string): Promise<string | null> {
    if (!dateInput) {
      return '日付は必須です';
    }
    await this.companyService.getCompany();
    const targetPeriodStart = this.companyService.company()?.settings?.targetPeriod[0] ?? 1;
    const date = parseDateInputValue(dateInput);
    if (isWorkMonthAfterCurrent(date, targetPeriodStart)) {
      return '作業対象期間より後の予定登録はできません。';
    }
    return null;
  }

  validateDependentChangeInputs(changes: DependentChangeInput[]): string | null {
    for (const change of changes) {
      const dateInput = getDependentChangeEffectiveDateInput(
        change.changeType,
        change.after,
        change.appliedDateInput,
      );
      if (!dateInput) {
        if (change.changeType === '変更') {
          return '変更の場合は適用日を入力してください';
        }
        if (change.changeType === '追加') {
          return '追加の場合は扶養開始日を入力してください';
        }
        return '削除の場合は扶養終了日を入力してください';
      }
    }
    return null;
  }

  async createAppliedDependentChangeEvents(
    employeeId: string,
    changes: DependentChangeInput[],
    loginEmployeeId: string,
    options?: { applicantType?: Event['applicantType'] },
  ): Promise<string[]> {
    const createdIds: string[] = [];
    await this.companyService.getCompany();
    const targetPeriodStart = this.companyService.company()?.settings?.targetPeriod[0] ?? 1;

    for (const change of changes) {
      const dateInput = getDependentChangeEffectiveDateInput(
        change.changeType,
        change.after,
        change.appliedDateInput,
      );
      const dateError = await this.validateDependentChangeDate(dateInput);
      if (dateError) {
        return createdIds;
      }

      const effectiveTimestamp = timestampFromDateInput(dateInput);
      const baseId = buildDependentChangeEventBaseId(parseDateInputValue(dateInput), targetPeriodStart);
      const eventId = await this.eventService.createEventWithBaseId(employeeId, baseId, {
        occurredDate: effectiveTimestamp,
        eventType: '扶養情報変更',
        changeType: change.changeType,
        appliedDate: Timestamp.now(),
        applicantType: options?.applicantType ?? '管理者',
        approval: {
          approvalStatus: '適用済み',
          approvedDate: Timestamp.now(),
          approvedBy: loginEmployeeId,
          appliedFromMonth: getCurrentAppliedFromMonth(),
        },
        payload: {
          before: change.before,
          after: change.after,
          appliedDate: effectiveTimestamp,
        },
      });
      if (!eventId) {
        return createdIds;
      }

      const applied = await this.applyDependentChange(employeeId, change);
      if (!applied) {
        return createdIds;
      }

      createdIds.push(eventId);
    }

    return createdIds;
  }

  async createPendingDependentChangeEvents(
    employeeId: string,
    changes: DependentChangeInput[],
    options?: { lifeEventType?: Event['lifeEventType'] },
  ): Promise<{ success: number; failed: boolean }> {
    let success = 0;
    let failed = false;

    await this.companyService.getCompany();
    const targetPeriodStart = this.companyService.company()?.settings?.targetPeriod[0] ?? 1;

    for (const change of changes) {
      const dateInput = getDependentChangeEffectiveDateInput(
        change.changeType,
        change.after,
        change.appliedDateInput,
      );
      const dateError = await this.validateDependentChangeDate(dateInput);
      if (dateError) {
        failed = true;
        continue;
      }

      const effectiveTimestamp = timestampFromDateInput(dateInput);
      const baseId = buildDependentChangeEventBaseId(parseDateInputValue(dateInput), targetPeriodStart);
      const created = await this.eventService.createEventWithBaseId(employeeId, baseId, {
        occurredDate: effectiveTimestamp,
        eventType: '扶養情報変更',
        changeType: change.changeType,
        lifeEventType: options?.lifeEventType,
        appliedDate: Timestamp.now(),
        applicantType: '社員',
        approval: { approvalStatus: '申請中' },
        payload: {
          before: change.before,
          after: change.after,
          appliedDate: effectiveTimestamp,
        },
      });

      if (created) {
        success++;
      } else {
        failed = true;
      }
    }

    return { success, failed };
  }

  buildChangeInputs(
    items: { before: Dependent | null; after: Partial<Dependent>; appliedDateInput?: string }[],
  ): DependentChangeInput[] {
    return items.map(item => ({
      before: item.before,
      after: item.after,
      appliedDateInput: item.appliedDateInput,
      changeType: determineDependentChangeType(item.before, item.after),
    }));
  }

  private async applyDependentChange(employeeId: string, change: DependentChangeInput): Promise<boolean> {
    const after = change.after;
    if (!after.dependentId) return false;

    const dependent: Partial<Dependent> = {
      dependentId: after.dependentId,
      name: after.name,
      relationship: after.relationship,
      birthDate: after.birthDate,
      isDependent: after.isDependent !== false,
      dependentStartDate: after.dependentStartDate,
      dependentEndDate: after.dependentEndDate,
      cohabitationType: after.cohabitationType,
      annualIncome: after.annualIncome,
      occupation: after.occupation,
      hasDisability: after.hasDisability,
      disabilityType: after.disabilityType,
      isStudent: after.isStudent,
      studentType: after.studentType,
    };

    return change.before
      ? this.dependentService.updateDependent(employeeId, dependent)
      : this.dependentService.registerDependents(employeeId, [dependent]);
  }
}
