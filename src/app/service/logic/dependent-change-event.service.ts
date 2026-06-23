import { inject, Injectable } from '@angular/core';
import { Timestamp } from '@angular/fire/firestore';
import { ChangeType } from '../../constants/model-constants';
import { Dependent } from '../../model/dependent';
import { Event } from '../../model/event';
import { CompanyService } from '../Firestore/company-service';
import { DependentService } from '../Firestore/dependent-service';
import { EventService } from '../Firestore/event-service';
import { AnnouncementLogicService } from './announcement-logic.service';
import {
  buildDependentChangeEventBaseId,
  getCurrentAppliedFromMonth,
  getCurrentApprovedWorkingMonth,
  resolveAdminEffectiveDateTiming,
} from './event-id-service';
import { parseDateInputValue, timestampFromDateInput } from '../common/date-input.util';
import { EmployeeService } from '../Firestore/employee-service';

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
  private announcementLogicService = inject(AnnouncementLogicService);
  private employeeService = inject(EmployeeService);

  async validateDependentChangeDate(dateInput: string): Promise<string | null> {
    if (!dateInput) {
      return '日付は必須です';
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

  /** 管理者・システムの扶養変更：適用日が今日以前なら適用済み＋即反映、今日より後なら申請中 */
  async createAppliedDependentChangeEvents(
    employeeId: string,
    changes: DependentChangeInput[],
    loginEmployeeId: string,
    options?: { applicantType?: Event['applicantType'] },
  ): Promise<string[]> {
    const createdIds: string[] = [];
    await this.companyService.getCompany();
    const targetPeriodStart = this.companyService.company()?.settings?.targetPeriod[0] ?? 1;
    const applicantType = options?.applicantType ?? '管理者';

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

      const effectiveDate = parseDateInputValue(dateInput);
      const effectiveTimestamp = timestampFromDateInput(dateInput);
      const bounds = this.employeeService.currentWorkPeriodBounds();
      const timing = resolveAdminEffectiveDateTiming(effectiveDate, bounds);
      const baseId = buildDependentChangeEventBaseId(effectiveDate, targetPeriodStart);
      const eventPayload = {
        before: change.before,
        after: change.after,
        appliedDate: effectiveTimestamp,
      };

      if (timing === 'future') {
        const eventId = await this.eventService.createEventWithBaseId(employeeId, baseId, {
          occurredDate: effectiveTimestamp,
          eventType: '扶養情報変更',
          changeType: change.changeType,
          appliedDate: Timestamp.now(),
          applicantType,
          approval: { approvalStatus: '申請中' },
          payload: eventPayload,
        });
        if (!eventId) {
          return createdIds;
        }
        createdIds.push(eventId);
        continue;
      }

      if (timing === 'after_period_past') {
        const eventId = await this.eventService.createEventWithBaseId(employeeId, baseId, {
          occurredDate: effectiveTimestamp,
          eventType: '扶養情報変更',
          changeType: change.changeType,
          appliedDate: Timestamp.now(),
          applicantType,
          approval: {
            approvalStatus: '承認済み',
            approvedDate: Timestamp.now(),
            approvedBy: loginEmployeeId,
            approvedWorkingMonth: getCurrentApprovedWorkingMonth(),
          },
          payload: eventPayload,
        });
        if (!eventId) {
          return createdIds;
        }
        createdIds.push(eventId);
        await this.createDependentAnnouncementIfNeeded(employeeId, {
          eventId,
          eventType: '扶養情報変更',
          changeType: change.changeType,
          occurredDate: effectiveTimestamp,
          appliedDate: Timestamp.now(),
          applicantType,
          approval: {
            approvalStatus: '承認済み',
            approvedDate: Timestamp.now(),
            approvedBy: loginEmployeeId,
            approvedWorkingMonth: getCurrentApprovedWorkingMonth(),
          },
          payload: eventPayload,
        } as Pick<Event, 'eventId' | 'eventType' | 'changeType' | 'lifeEventType' | 'occurredDate' | 'payload' | 'approval'>);
        continue;
      }

      const eventId = await this.eventService.createEventWithBaseId(employeeId, baseId, {
        occurredDate: effectiveTimestamp,
        eventType: '扶養情報変更',
        changeType: change.changeType,
        appliedDate: Timestamp.now(),
        applicantType,
        approval: {
          approvalStatus: '適用済み',
          approvedDate: Timestamp.now(),
          approvedBy: loginEmployeeId,
          appliedFromMonth: getCurrentAppliedFromMonth(),
          approvedWorkingMonth: getCurrentApprovedWorkingMonth(),
        },
        payload: eventPayload,
      });
      if (!eventId) {
        return createdIds;
      }

      const applied = await this.applyDependentChange(employeeId, change);
      if (!applied) {
        return createdIds;
      }

      createdIds.push(eventId);
      await this.createDependentAnnouncementIfNeeded(employeeId, {
        eventId,
        eventType: '扶養情報変更',
        changeType: change.changeType,
        occurredDate: effectiveTimestamp,
        appliedDate: Timestamp.now(),
        applicantType,
        approval: {
          approvalStatus: '適用済み',
          approvedDate: Timestamp.now(),
          approvedBy: loginEmployeeId,
          appliedFromMonth: getCurrentAppliedFromMonth(),
          approvedWorkingMonth: getCurrentApprovedWorkingMonth(),
        },
        payload: eventPayload,
      } as Pick<Event, 'eventId' | 'eventType' | 'changeType' | 'lifeEventType' | 'occurredDate' | 'payload' | 'approval'>);
    }

    return createdIds;
  }

  private async createDependentAnnouncementIfNeeded(
    employeeId: string,
    event: Pick<Event, 'eventId' | 'eventType' | 'changeType' | 'lifeEventType' | 'occurredDate' | 'payload' | 'approval'>,
  ): Promise<void> {
    if (!this.announcementLogicService.shouldCreateAnnouncementForStatus(event.approval?.approvalStatus)) {
      return;
    }
    try {
      await this.announcementLogicService.createFromDependentEvent(event as Event, employeeId);
    } catch (error) {
      console.error('届け出チェックリストの作成に失敗しました', error);
    }
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

  async getPendingAdminDependentChangeEventsForDependentIds(
    employeeId: string,
    dependentIds: string[],
  ): Promise<Event[]> {
    if (dependentIds.length === 0) return [];
    const targetIds = new Set(dependentIds.map(id => String(id)));
    const events = await this.eventService.getPendingEmployeeEvents(employeeId);
    return events.filter(event => {
      if (event.eventType !== '扶養情報変更' || event.applicantType !== '管理者') return false;
      const dependentId = this.resolveDependentIdFromChangeEvent(event);
      return dependentId != null && targetIds.has(dependentId);
    });
  }

  private resolveDependentIdFromChangeEvent(event: Event): string | null {
    const after = event.payload?.['after'] as Partial<Dependent> | undefined;
    if (after?.dependentId) return String(after.dependentId);
    const before = event.payload?.['before'] as Dependent | null | undefined;
    if (before?.dependentId) return String(before.dependentId);
    return null;
  }

  private async applyDependentChange(employeeId: string, change: DependentChangeInput): Promise<boolean> {
    const after = change.after;
    const dependentId = String(after.dependentId ?? '').trim();
    if (!dependentId) return false;

    const dependent: Partial<Dependent> = {
      dependentId,
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

    return this.dependentService.saveDependent(employeeId, dependent);
  }
}
