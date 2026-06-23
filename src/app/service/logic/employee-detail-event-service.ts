import { inject, Injectable } from '@angular/core';
import { Timestamp } from '@angular/fire/firestore';
import { Employee, EmploymentContract, EmployeeInsurance, InsuranceDetail } from '../../model/employee';
import { Dependent } from '../../model/dependent';
import { ChangeType, EmployeeEventType, LeaveType, LifeEventType, WorkStatus } from '../../constants/model-constants';
import { EventService } from '../Firestore/event-service';
import { CalculationRunService } from '../Firestore/calculation-run-service';
import { CompanyService } from '../Firestore/company-service';
import { DependentService } from '../Firestore/dependent-service';
import { EmployeeService } from '../Firestore/employee-service';
import { AnnouncementLogicService } from './announcement-logic.service';
import { Event } from '../../model/event';
import {
  addMonths,
  buildCurrentWorkMonthEventId,
  buildDependentChangeEventBaseId,
  buildEmploymentChangeRunId,
  buildGradeChangeRunId,
  buildInsuranceChangeRunId,
  buildWorkMonthEventId,
  getQualificationLossDate,
  getQualificationLossTimestamp,
  getWorkMonthForDate,
  getAdHocRevisionWorkMonth,
  getWorkingYearMonth,
  isDateAfterToday,
  isDateStrictlyBeforeToday,
  isDateBeforeWorkPeriod,
  isDateInWorkPeriod,
  isEventAtOrBeforeWorkingMonth,
  isWorkMonthAfterCurrent,
  resolveAdminEffectiveDateTiming,
  getCurrentAppliedFromMonth,
  getCurrentApprovedWorkingMonth,
} from './event-id-service';
import type { InsuranceChangeKey } from './event-id-service';
import { DependentChangeEventService } from './dependent-change-event.service';
import { EmployeeLogicService } from './employee-logic-service';

export type ContractChangeEventsResult = {
  createdIds: string[];
  needsRetroactiveNotice: boolean;
};

export type RetireEventsResult = {
  createdIds: string[];
  needsRetroactiveNotice: boolean;
};

export type WorkStatusChangeScenario = 'leaveStart' | 'leaveEnd' | 'leaveSwitch' | 'leaveModify';

export type WorkStatusChangeInput = {
  scenario: WorkStatusChangeScenario;
  leaveTypes?: LeaveType;
  leaveStartDate?: Timestamp;
  leaveEndDate?: Timestamp;
  switchDate?: Timestamp;
  lifeEventType?: LifeEventType;
  expectedBirthDate?: Timestamp;
  isMultipleBirth?: boolean;
  childName?: string;
};

export function isFixedSalaryChanged(before: Employee, after: Employee): boolean {
  return before.employmentContract?.fixedSalary !== after.employmentContract?.fixedSalary;
}

export function isEmploymentContractShapeChanged(before: Employee, after: Employee): boolean {
  const beforeContract = before.employmentContract;
  const afterContract = after.employmentContract;
  return beforeContract?.employmentCategory !== afterContract?.employmentCategory
    || beforeContract?.workStyle !== afterContract?.workStyle
    || beforeContract?.officeId !== afterContract?.officeId
    || beforeContract?.contractedWorkingHoursPerWeek !== afterContract?.contractedWorkingHoursPerWeek
    || beforeContract?.contractedWorkingDaysPerMonth !== afterContract?.contractedWorkingDaysPerMonth
    || beforeContract?.transportationExpenses !== afterContract?.transportationExpenses;
}

export type ScheduledLeaveInfo = {
  leaveTypes: LeaveType;
  leaveStartDate: Timestamp;
  leaveEndDate?: Timestamp;
};

export type ScheduledEmploymentContractInfo = {
  effectiveDate: Timestamp;
};

export type PendingInsuranceSchedule = {
  date: Timestamp;
  label: string;
};

export type { InsuranceChangeKey } from './event-id-service';

type InsuranceKey = InsuranceChangeKey;

const INSURANCE_TYPE_LABELS: Record<InsuranceKey, string> = {
  healthInsurance: '健康保険',
  nursingCareInsurance: '介護保険',
  employeePensionInsurance: '厚生年金',
};

const INSURANCE_PRIORITY: InsuranceKey[] = [
  'healthInsurance',
  'employeePensionInsurance',
  'nursingCareInsurance',
];

function getInsuranceJoinStatus(detail?: InsuranceDetail): 'joined' | 'notJoined' | 'lost' {
  if (detail?.joined === true) return 'joined';
  if (detail?.lostDate) return 'lost';
  return 'notJoined';
}

function isInsuranceAcquisition(before?: InsuranceDetail, after?: InsuranceDetail): boolean {
  return getInsuranceJoinStatus(before) !== 'joined' && getInsuranceJoinStatus(after) === 'joined';
}

function isInsuranceLoss(before?: InsuranceDetail, after?: InsuranceDetail): boolean {
  return getInsuranceJoinStatus(before) === 'joined' && getInsuranceJoinStatus(after) !== 'joined';
}

@Injectable({
  providedIn: 'root',
})
export class EmployeeDetailEventService {

  private eventService = inject(EventService);
  private calculationRunService = inject(CalculationRunService);
  private companyService = inject(CompanyService);
  private dependentService = inject(DependentService);
  private employeeService = inject(EmployeeService);
  private dependentChangeEventService = inject(DependentChangeEventService);
  private employeeLogicService = inject(EmployeeLogicService);
  private announcementLogicService = inject(AnnouncementLogicService);

  async createEventsFromWorkStatusChange(
    employeeId: string,
    before: Employee,
    input: WorkStatusChangeInput,
    loginEmployeeId: string,
  ): Promise<ContractChangeEventsResult> {
    const createdIds: string[] = [];
    const targetPeriodStart = await this.getTargetPeriodStart();

    if (input.scenario === 'leaveStart' && input.leaveStartDate && input.leaveTypes) {
      const occurredDate = input.leaveStartDate;
      const payload: Record<string, unknown> = {
        before: { workStatus: before.workStatus ?? '通常勤務' },
        after: {
          workStatus: '休職中' as const,
          leaveTypes: input.leaveTypes,
          leaveStartDate: occurredDate,
          ...(input.leaveEndDate ? { leaveEndDate: input.leaveEndDate } : {}),
        },
      };
      if (input.expectedBirthDate) payload['expectedBirthDate'] = input.expectedBirthDate;
      if (input.leaveTypes === '産前産後' && input.isMultipleBirth !== undefined) {
        payload['isMultipleBirth'] = input.isMultipleBirth;
      }
      if (input.childName) payload['childName'] = input.childName;
      const eventId = await this.createWorkStatusEvent(
        employeeId,
        '休職開始',
        occurredDate,
        payload,
        loginEmployeeId,
        targetPeriodStart,
        input.lifeEventType,
      );
      if (!eventId) return { createdIds, needsRetroactiveNotice: false };
      createdIds.push(eventId);

      if (input.leaveEndDate) {
        const endPayload = {
          before: {
            workStatus: '休職中' as const,
            leaveTypes: input.leaveTypes,
            leaveStartDate: occurredDate,
            leaveEndDate: input.leaveEndDate,
          },
          after: {
            leaveEndDate: input.leaveEndDate,
            workStatus: '通常勤務' as const,
          },
        };
        const endEventId = await this.createWorkStatusEvent(
          employeeId,
          '休職終了',
          input.leaveEndDate,
          endPayload,
          loginEmployeeId,
          targetPeriodStart,
          input.lifeEventType ?? this.resolveLeaveLifeEventType(input.leaveTypes),
        );
        if (!endEventId) return { createdIds, needsRetroactiveNotice: false };
        createdIds.push(endEventId);
      }
    }

    if (input.scenario === 'leaveEnd' && input.leaveEndDate) {
      const occurredDate = input.leaveEndDate;
      const payload = {
        before: {
          workStatus: before.workStatus ?? '休職中',
          leaveTypes: before.leaveTypes,
          leaveStartDate: before.leaveStartDate,
        },
        after: {
          leaveEndDate: occurredDate,
          workStatus: '通常勤務' as const,
        },
      };
      const eventId = await this.createWorkStatusEvent(
        employeeId,
        '休職終了',
        occurredDate,
        payload,
        loginEmployeeId,
        targetPeriodStart,
        input.lifeEventType ?? this.resolveLeaveLifeEventType(before.leaveTypes),
      );
      if (!eventId) return { createdIds, needsRetroactiveNotice: false };
      createdIds.push(eventId);
    }

    if (input.scenario === 'leaveSwitch' && input.switchDate && input.leaveTypes) {
      const switchDate = input.switchDate;
      const endPayload = {
        before: {
          workStatus: '休職中' as const,
          leaveTypes: before.leaveTypes,
          leaveStartDate: before.leaveStartDate,
        },
        after: {
          leaveEndDate: switchDate,
          workStatus: '通常勤務' as const,
        },
      };
      const endEventId = await this.createWorkStatusEvent(
        employeeId,
        '休職終了',
        switchDate,
        endPayload,
        loginEmployeeId,
        targetPeriodStart,
        this.resolveLeaveLifeEventType(before.leaveTypes),
      );
      if (!endEventId) return { createdIds, needsRetroactiveNotice: false };
      createdIds.push(endEventId);

      const startPayload = {
        before: { workStatus: '通常勤務' as const },
        after: {
          workStatus: '休職中' as const,
          leaveTypes: input.leaveTypes,
          leaveStartDate: switchDate,
        },
      };
      const startEventId = await this.createWorkStatusEvent(
        employeeId,
        '休職開始',
        switchDate,
        startPayload,
        loginEmployeeId,
        targetPeriodStart,
        this.resolveLeaveLifeEventType(input.leaveTypes),
      );
      if (!startEventId) return { createdIds, needsRetroactiveNotice: false };
      createdIds.push(startEventId);
    }

    if (input.scenario === 'leaveModify' && input.leaveStartDate) {
      const startChanged = !this.isSameTimestamp(input.leaveStartDate, before.leaveStartDate);

      if (!startChanged && input.leaveEndDate) {
        const occurredDate = input.leaveEndDate;
        const payload = {
          before: {
            workStatus: '休職中' as const,
            leaveTypes: before.leaveTypes,
            leaveStartDate: before.leaveStartDate,
            ...(before.leaveEndDate ? { leaveEndDate: before.leaveEndDate } : {}),
          },
          after: {
            leaveEndDate: occurredDate,
            workStatus: '通常勤務' as const,
          },
        };
        const eventId = await this.createWorkStatusEvent(
          employeeId,
          '休職終了',
          occurredDate,
          payload,
          loginEmployeeId,
          targetPeriodStart,
          this.resolveLeaveLifeEventType(before.leaveTypes),
        );
        if (!eventId) return { createdIds, needsRetroactiveNotice: false };
        createdIds.push(eventId);
      } else {
        const occurredDate = startChanged
          ? input.leaveStartDate
          : (input.leaveEndDate ?? input.leaveStartDate);
        const payload = {
          before: {
            workStatus: '休職中' as const,
            leaveTypes: before.leaveTypes,
            leaveStartDate: before.leaveStartDate,
            ...(before.leaveEndDate ? { leaveEndDate: before.leaveEndDate } : {}),
          },
          after: {
            workStatus: '休職中' as const,
            leaveTypes: before.leaveTypes,
            leaveStartDate: input.leaveStartDate,
            ...(input.leaveEndDate ? { leaveEndDate: input.leaveEndDate } : {}),
          },
        };
        const eventId = await this.createWorkStatusEvent(
          employeeId,
          '変更',
          occurredDate,
          payload,
          loginEmployeeId,
          targetPeriodStart,
        );
        if (!eventId) return { createdIds, needsRetroactiveNotice: false };
        createdIds.push(eventId);
      }
    }

    return { createdIds, needsRetroactiveNotice: false };
  }

  private resolveLeaveLifeEventType(leaveTypes?: LeaveType | null): LifeEventType | undefined {
    if (leaveTypes === '産前産後') return '出産';
    if (leaveTypes === '育児') return '育児';
    return undefined;
  }

  private isSameTimestamp(left?: Timestamp, right?: Timestamp): boolean {
    if (!left || !right) return false;
    return left.toMillis() === right.toMillis();
  }

  async createEventsFromEmploymentContractChange(
    employeeId: string,
    before: Employee,
    after: Employee,
    effectiveDate: Timestamp,
    loginEmployeeId: string,
  ): Promise<ContractChangeEventsResult> {
    const createdIds: string[] = [];
    const beforeContract = before.employmentContract;
    const afterContract = after.employmentContract;
    const targetPeriodStart = await this.getTargetPeriodStart();
    const isFutureWorkMonth = isWorkMonthAfterCurrent(effectiveDate.toDate(), targetPeriodStart);

    if (isFixedSalaryChanged(before, after)) {
      const bounds = this.employeeService.currentWorkPeriodBounds();
      const timing = resolveAdminEffectiveDateTiming(effectiveDate.toDate(), bounds);
      const contractStatus = timing === 'future'
        ? 'pending'
        : timing === 'after_period_past'
          ? 'approved'
          : 'applied';
      const eventId = await this.createContractEvent(
        employeeId,
        '固定給変更',
        effectiveDate,
        { before: beforeContract?.fixedSalary, after: afterContract?.fixedSalary },
        loginEmployeeId,
        targetPeriodStart,
        contractStatus,
      );
      if (eventId) {
        createdIds.push(eventId);
        if (timing === 'in_or_before_period_past') {
          await this.applyAdminFixedSalaryChangePast(employeeId, before, after, effectiveDate, loginEmployeeId);
        } else if (timing === 'after_period_past') {
          await this.createAdHocRevisionOnApproval(employeeId, before, after, effectiveDate, loginEmployeeId);
        }
      }
    }

    if (isEmploymentContractShapeChanged(before, after)) {
      const eventId = await this.createContractEvent(
        employeeId,
        '雇用形態変更',
        effectiveDate,
        {
          before: this.pickEmploymentContract(before),
          after: this.pickEmploymentContract(after),
        },
        loginEmployeeId,
        targetPeriodStart,
        isFutureWorkMonth ? 'pending' : 'approved',
      );
      if (eventId) {
        createdIds.push(eventId);
        if (!isFutureWorkMonth) {
          await this.employeeService.updateEmployee({ employeeId, employmentContract: after.employmentContract });
          await this.createEmploymentSystemRunOnApproval(employeeId, before, after, effectiveDate);
        }
      }
    }

    return { createdIds, needsRetroactiveNotice: false };
  }

  /** 社員ライフイベントからの休職開始申請（申請中・申請者=社員） */
  async createEmployeeLeaveStartApplicationEvent(
    employeeId: string,
    before: Employee,
    params: {
      leaveTypes: LeaveType;
      leaveStartDate: Timestamp;
      leaveEndDate?: Timestamp;
      lifeEventType: LifeEventType;
      extraPayload?: Record<string, unknown>;
    },
  ): Promise<string | null> {
    const targetPeriodStart = await this.getTargetPeriodStart();
    const occurredDate = params.leaveStartDate;
    const payload = {
      before: {
        workStatus: before.workStatus ?? '通常勤務',
        leaveTypes: before.leaveTypes,
        leaveStartDate: before.leaveStartDate,
      },
      after: {
        workStatus: '休職中' as const,
        leaveTypes: params.leaveTypes,
        leaveStartDate: params.leaveStartDate,
        ...(params.leaveEndDate ? { leaveEndDate: params.leaveEndDate } : {}),
      },
      ...params.extraPayload,
    };
    const baseId = buildWorkMonthEventId('勤務状況変更', occurredDate.toDate(), targetPeriodStart);
    return this.eventService.createEventWithBaseId(employeeId, baseId, {
      occurredDate,
      eventType: '勤務状況変更',
      changeType: '休職開始',
      lifeEventType: params.lifeEventType,
      appliedDate: Timestamp.now(),
      applicantType: '社員',
      approval: { approvalStatus: '申請中' },
      payload,
    });
  }

  async getPendingWorkStatusLeaveEvents(employeeId: string): Promise<Event[]> {
    const events = await this.eventService.getPendingEmployeeEvents(employeeId);
    return events.filter(event =>
      event.eventType === '勤務状況変更'
      && (event.changeType === '休職開始' || event.changeType === '休職終了'),
    );
  }

  async getPendingEmploymentContractEvents(employeeId: string): Promise<Event[]> {
    const events = await this.eventService.getPendingEmployeeEvents(employeeId);
    return events.filter(event =>
      event.eventType === '固定給変更' || event.eventType === '雇用形態変更',
    );
  }

  async rejectPendingEvents(
    employeeId: string,
    events: Event[],
    loginEmployeeId: string,
  ): Promise<boolean> {
    for (const event of events) {
      const rejected = await this.eventService.updateEvent(employeeId, event.eventId, {
        approval: {
          approvalStatus: '却下',
          approvedDate: Timestamp.now(),
          approvedBy: loginEmployeeId,
          approvedWorkingMonth: getCurrentApprovedWorkingMonth(),
        },
      });
      if (!rejected) return false;
    }
    return true;
  }

  /** 現在の休職期間に紐づく、差し替え可能な休職終了イベント（申請中・承認済み） */
  getReplaceableLeaveEndEventsForCurrentLeave(events: Event[], leaveStartDate?: Timestamp): Event[] {
    if (!leaveStartDate?.toMillis) return [];
    return events.filter(event => this.isLeaveEndEventForCurrentLeave(event, leaveStartDate)
      && (event.approval?.approvalStatus === '申請中' || event.approval?.approvalStatus === '承認済み'));
  }

  private isLeaveEndEventForCurrentLeave(event: Event, leaveStartDate: Timestamp): boolean {
    if (event.eventType !== '勤務状況変更' || event.changeType !== '休職終了') return false;
    if (event.applicantType !== '管理者') return false;
    if (!event.occurredDate?.toMillis || event.occurredDate.toMillis() < leaveStartDate.toMillis()) return false;
    const before = event.payload?.['before'] as Record<string, unknown> | undefined;
    const eventLeaveStart = before?.['leaveStartDate'] as Timestamp | undefined;
    if (eventLeaveStart?.toMillis && eventLeaveStart.toMillis() !== leaveStartDate.toMillis()) return false;
    return true;
  }

  getScheduledLeaveInfo(events: Event[], workStatus?: WorkStatus): ScheduledLeaveInfo | null {
    if (workStatus === '休職中') {
      return this.getScheduledLeaveInfoForActiveLeave(events, workStatus);
    }
    return this.getScheduledLeaveInfoForPendingLeave(events);
  }

  private getScheduledLeaveInfoForPendingLeave(events: Event[]): ScheduledLeaveInfo | null {
    const pendingStarts = events
      .filter(event => this.isPendingLeaveEvent(event) && event.changeType === '休職開始')
      .sort((left, right) => (right.occurredDate?.toMillis() ?? 0) - (left.occurredDate?.toMillis() ?? 0));
    const pendingStart = pendingStarts[0];
    if (!pendingStart) return null;

    const after = pendingStart.payload?.['after'] as Record<string, unknown> | undefined;
    const leaveTypes = after?.['leaveTypes'] as LeaveType | undefined;
    const leaveStartDate = (after?.['leaveStartDate'] as Timestamp | undefined) ?? pendingStart.occurredDate;
    const leaveEndDate = after?.['leaveEndDate'] as Timestamp | undefined;
    if (!leaveTypes || !leaveStartDate) return null;

    return { leaveTypes, leaveStartDate, leaveEndDate };
  }

  private getScheduledLeaveInfoForActiveLeave(events: Event[], workStatus?: WorkStatus): ScheduledLeaveInfo | null {
    const scheduleEvents = events
      .filter(event =>
        event.eventType === '勤務状況変更'
        && (event.changeType === '休職開始' || event.changeType === '変更' || event.changeType === '休職終了')
        && this.isScheduledLeaveEvent(event),
      )
      .sort((left, right) => (right.occurredDate?.toMillis() ?? 0) - (left.occurredDate?.toMillis() ?? 0));

    for (const event of scheduleEvents) {
      if (event.changeType === '休職終了' && this.isScheduledLeaveEvent(event)) {
        const after = event.payload?.['after'] as Record<string, unknown> | undefined;
        const before = event.payload?.['before'] as Record<string, unknown> | undefined;
        const leaveTypes = (before?.['leaveTypes'] as LeaveType | undefined);
        const leaveStartDate = (before?.['leaveStartDate'] as Timestamp | undefined);
        const leaveEndDate = (after?.['leaveEndDate'] as Timestamp | undefined) ?? event.occurredDate;
        if (leaveTypes && leaveStartDate && leaveEndDate) {
          return { leaveTypes, leaveStartDate, leaveEndDate };
        }
        continue;
      }

      if (event.changeType === '休職開始' || event.changeType === '変更') {
        const after = event.payload?.['after'] as Record<string, unknown> | undefined;
        const leaveTypes = after?.['leaveTypes'] as LeaveType | undefined;
        const leaveStartDate = (after?.['leaveStartDate'] as Timestamp | undefined) ?? event.occurredDate;
        const leaveEndDate = after?.['leaveEndDate'] as Timestamp | undefined;
        if (leaveTypes && leaveStartDate) {
          return { leaveTypes, leaveStartDate, leaveEndDate };
        }
      }
    }

    if (workStatus === '休職中') {
      const openStart = this.findAppliedOpenLeaveStartEvent(events);
      if (openStart) {
        const after = openStart.payload?.['after'] as Record<string, unknown> | undefined;
        const leaveTypes = after?.['leaveTypes'] as LeaveType | undefined;
        const leaveStartDate = (after?.['leaveStartDate'] as Timestamp | undefined) ?? openStart.occurredDate;
        if (leaveTypes && leaveStartDate) {
          const leaveEndDate = this.resolveScheduledLeaveEndDate(
            events,
            leaveStartDate,
            after?.['leaveEndDate'] as Timestamp | undefined,
          );
          return { leaveTypes, leaveStartDate, leaveEndDate };
        }
      }
    }

    return null;
  }

  private findAppliedOpenLeaveStartEvent(events: Event[]): Event | null {
    const leaveStarts = events
      .filter(event =>
        event.eventType === '勤務状況変更'
        && event.changeType === '休職開始'
        && this.isAppliedLeaveEvent(event),
      )
      .sort((left, right) => this.getLeaveStartMillis(right) - this.getLeaveStartMillis(left));

    for (const start of leaveStarts) {
      const startMillis = this.getLeaveStartMillis(start);
      const hasAppliedEndAfter = events.some(event =>
        event.eventType === '勤務状況変更'
        && event.changeType === '休職終了'
        && event.approval?.approvalStatus === '適用済み'
        && (event.occurredDate?.toMillis() ?? 0) >= startMillis,
      );
      if (!hasAppliedEndAfter) return start;
    }

    return null;
  }

  private getLeaveStartMillis(event: Event): number {
    const after = event.payload?.['after'] as Record<string, unknown> | undefined;
    const leaveStartDate = (after?.['leaveStartDate'] as Timestamp | undefined) ?? event.occurredDate;
    return leaveStartDate?.toMillis() ?? 0;
  }

  private isAppliedLeaveEvent(event: Event): boolean {
    const status = event.approval?.approvalStatus;
    return status === '適用済み' || status === '承認済み';
  }

  private isScheduledLeaveEvent(event: Event): boolean {
    const status = event.approval?.approvalStatus;
    return status === '申請中' || status === '承認済み';
  }

  private isPendingLeaveEvent(event: Event): boolean {
    return event.eventType === '勤務状況変更'
      && this.isScheduledLeaveEvent(event);
  }

  private resolveScheduledLeaveEndDate(
    events: Event[],
    leaveStartDate: Timestamp,
    startEventEndDate?: Timestamp,
  ): Timestamp | undefined {
    const startMillis = leaveStartDate.toMillis();
    const pendingLeaveEvent = events
      .filter(event =>
        event.eventType === '勤務状況変更'
        && this.isScheduledLeaveEvent(event)
        && event.changeType === '休職終了'
        && (event.occurredDate?.toMillis() ?? 0) >= startMillis,
      )
      .sort((left, right) => (left.occurredDate?.toMillis() ?? 0) - (right.occurredDate?.toMillis() ?? 0))[0];

    if (pendingLeaveEvent) {
      const after = pendingLeaveEvent.payload?.['after'] as Record<string, unknown> | undefined;
      const pendingEndDate = (after?.['leaveEndDate'] as Timestamp | undefined) ?? pendingLeaveEvent.occurredDate;
      if (pendingEndDate) return pendingEndDate;
    }

    return startEventEndDate;
  }

  getScheduledEmploymentContractInfo(events: Event[]): ScheduledEmploymentContractInfo | null {
    const pending = events.find(event =>
      (event.eventType === '固定給変更' || event.eventType === '雇用形態変更')
      && this.isScheduledEmploymentContractEvent(event),
    );
    if (!pending?.occurredDate) return null;
    return { effectiveDate: pending.occurredDate };
  }

  private isScheduledEmploymentContractEvent(event: Event): boolean {
    const status = event.approval?.approvalStatus;
    return status === '申請中' || status === '承認済み';
  }

  hasInsuranceQualificationChange(
    beforeInsurance: EmployeeInsurance | undefined,
    afterInsurance: EmployeeInsurance,
  ): boolean {
    const before = beforeInsurance ?? {};
    return INSURANCE_PRIORITY.some(key => isInsuranceAcquisition(before[key], afterInsurance[key]))
      || INSURANCE_PRIORITY.some(key => isInsuranceLoss(before[key], afterInsurance[key]));
  }

  getChangedInsuranceKeys(
    beforeInsurance: EmployeeInsurance | undefined,
    afterInsurance: EmployeeInsurance,
  ): InsuranceKey[] {
    const before = beforeInsurance ?? {};
    return INSURANCE_PRIORITY.filter(key => !this.isSameInsuranceDetail(before[key], afterInsurance[key]));
  }

  async getPendingInsuranceSchedules(employeeId: string): Promise<Partial<Record<InsuranceKey, PendingInsuranceSchedule>>> {
    const pending = await this.calculationRunService.getPendingInsuranceChangeRunsForEmployee(employeeId);
    const schedules: Partial<Record<InsuranceKey, PendingInsuranceSchedule>> = {};

    for (const run of pending) {
      const key = run.payload?.['insuranceKey'] as InsuranceKey | undefined;
      if (!key || schedules[key]) continue;

      const detectedDate = run.detectedDate as Timestamp | undefined;
      if (!detectedDate) continue;

      const actionLabel = '保険加入もしくは喪失予定あり';
      schedules[key] = {
        date: detectedDate,
        label: actionLabel,
      };
    }

    return schedules;
  }

  async confirmAndRejectPendingInsuranceChanges(
    employeeId: string,
    beforeInsurance: EmployeeInsurance | undefined,
    afterInsurance: EmployeeInsurance,
    loginEmployeeId: string,
  ): Promise<boolean> {
    const changedKeys = this.getChangedInsuranceKeys(beforeInsurance, afterInsurance);
    if (changedKeys.length === 0) return true;

    const pending = await this.calculationRunService.getPendingInsuranceChangeRunsForEmployee(employeeId);
    for (const key of changedKeys) {
      const pendingForKey = pending.filter(run => run.payload?.['insuranceKey'] === key);
      if (pendingForKey.length === 0) continue;

      const label = INSURANCE_TYPE_LABELS[key];
      const confirmed = window.confirm(
        `${label}の保険情報は変更申請中です。変更すると、現在申請中のものは却下されます。変更しますか？`,
      );
      if (!confirmed) return false;

      for (const run of pendingForKey) {
        if (!run.runId) continue;
        const rejected = await this.calculationRunService.markRunRejected(run.runId, loginEmployeeId);
        if (!rejected) return false;
      }
    }

    return true;
  }

  async resolveGradeChangeRunId(
    employeeId: string,
    applicationDate: Date,
    targetPeriodStart: number,
  ): Promise<string | null> {
    const baseRunId = buildGradeChangeRunId(applicationDate, targetPeriodStart);
    const existing = await this.calculationRunService.getEmployeeGradeChangeRuns(employeeId, baseRunId);
    if (existing.length === 0) {
      return baseRunId;
    }

    const confirmed = window.confirm('すでに該当の期間の等級変更がされています。変更を実施しますか？');
    if (!confirmed) return null;

    return this.calculationRunService.allocateGradeChangeRunId(employeeId, baseRunId);
  }

  async createInsuranceChangeRuns(
    employeeId: string,
    beforeInsurance: EmployeeInsurance | undefined,
    afterInsurance: EmployeeInsurance,
    gradeChange: { beforeGrade: number; afterGrade: number; applicationDate: Timestamp } | null,
    loginEmployeeId: string,
    gradeChangeRunId?: string | null,
    workPeriodBounds?: { periodStart: Date; periodEnd: Date } | null,
  ): Promise<{ success: boolean; runIds: string[] }> {
    const before = beforeInsurance ?? {};
    const targetPeriodStart = await this.getTargetPeriodStart();
    const runIds: string[] = [];

    for (const key of INSURANCE_PRIORITY) {
      if (isInsuranceAcquisition(before[key], afterInsurance[key])) {
        const detectedDate = afterInsurance[key]?.acquiredDate;
        if (!detectedDate) return { success: false, runIds };

        const date = detectedDate.toDate();
        if (workPeriodBounds && isDateBeforeWorkPeriod(date, workPeriodBounds.periodStart)) {
          return { success: false, runIds };
        }

        const timing = resolveAdminEffectiveDateTiming(date, workPeriodBounds);
        const baseRunId = buildInsuranceChangeRunId('資格取得', date, targetPeriodStart, key, employeeId);
        const payload = this.buildSingleInsuranceChangePayload(key, before, afterInsurance);
        let createdRunId: string | null = null;
        if (timing === 'future') {
          const runId = await this.calculationRunService.allocateSequentialRunId(baseRunId);
          createdRunId = await this.calculationRunService.createInsuranceChangeRun(
            employeeId,
            runId,
            '資格取得',
            key,
            payload,
            detectedDate,
            false,
            loginEmployeeId,
          );
        } else if (timing === 'after_period_past') {
          createdRunId = await this.calculationRunService.createApprovedInsuranceChangeRun(
            employeeId,
            baseRunId,
            '資格取得',
            { ...payload, insuranceKey: key },
            detectedDate,
            loginEmployeeId,
          );
        } else {
          const runId = await this.calculationRunService.allocateSequentialRunId(baseRunId);
          createdRunId = await this.calculationRunService.createInsuranceChangeRun(
            employeeId,
            runId,
            '資格取得',
            key,
            payload,
            detectedDate,
            true,
            loginEmployeeId,
          );
        }
        if (!createdRunId) return { success: false, runIds };
        runIds.push(createdRunId);
      }

      if (isInsuranceLoss(before[key], afterInsurance[key])) {
        const detectedDate = afterInsurance[key]?.lostDate;
        if (!detectedDate) return { success: false, runIds };

        const date = detectedDate.toDate();
        if (workPeriodBounds && isDateBeforeWorkPeriod(date, workPeriodBounds.periodStart)) {
          return { success: false, runIds };
        }

        const timing = resolveAdminEffectiveDateTiming(date, workPeriodBounds);
        const baseRunId = buildInsuranceChangeRunId('資格喪失', date, targetPeriodStart, key, employeeId);
        const payload = this.buildSingleInsuranceChangePayload(key, before, afterInsurance);
        let createdRunId: string | null = null;
        if (timing === 'future') {
          const runId = await this.calculationRunService.allocateSequentialRunId(baseRunId);
          createdRunId = await this.calculationRunService.createInsuranceChangeRun(
            employeeId,
            runId,
            '資格喪失',
            key,
            payload,
            detectedDate,
            false,
            loginEmployeeId,
          );
        } else if (timing === 'after_period_past') {
          createdRunId = await this.calculationRunService.createApprovedInsuranceChangeRun(
            employeeId,
            baseRunId,
            '資格喪失',
            { ...payload, insuranceKey: key },
            detectedDate,
            loginEmployeeId,
          );
        } else {
          const runId = await this.calculationRunService.allocateSequentialRunId(baseRunId);
          createdRunId = await this.calculationRunService.createInsuranceChangeRun(
            employeeId,
            runId,
            '資格喪失',
            key,
            payload,
            detectedDate,
            true,
            loginEmployeeId,
          );
        }
        if (!createdRunId) return { success: false, runIds };
        runIds.push(createdRunId);
      }
    }

    if (gradeChange && gradeChangeRunId) {
      const applicationDate = gradeChange.applicationDate.toDate();
      const timing = resolveAdminEffectiveDateTiming(applicationDate, workPeriodBounds);
      let runId: string | null = null;
      const gradePayload = {
        beforeGrade: gradeChange.beforeGrade,
        afterGrade: gradeChange.afterGrade,
        applicationDate: gradeChange.applicationDate,
      };
      if (timing === 'future') {
        runId = await this.calculationRunService.createPendingGradeChangeRun(
          employeeId,
          gradeChangeRunId,
          gradePayload,
          gradeChange.applicationDate,
        );
      } else if (timing === 'after_period_past') {
        runId = await this.calculationRunService.createApprovedGradeChangeRun(
          employeeId,
          gradeChangeRunId,
          gradePayload,
          gradeChange.applicationDate,
          loginEmployeeId,
        );
      } else {
        runId = await this.calculationRunService.createAppliedGradeChangeRun(
          employeeId,
          gradeChangeRunId,
          gradePayload,
          gradeChange.applicationDate,
          loginEmployeeId,
        );
      }
      if (!runId) return { success: false, runIds };
      runIds.push(runId);
    }

    return { success: true, runIds };
  }

  /** 適用日が未来の等級変更・資格取得/喪失は従業員情報へ即時反映しない */
  buildInsuranceForImmediateSave(
    beforeInsurance: EmployeeInsurance | undefined,
    afterInsurance: EmployeeInsurance,
    gradeApplicationDate?: Date | null,
    workPeriodBounds?: { periodStart: Date; periodEnd: Date } | null,
  ): EmployeeInsurance {
    const before = beforeInsurance ?? {};
    const result: EmployeeInsurance = {
      currentGrade: afterInsurance.currentGrade ?? 0,
      basicPensionNumber: afterInsurance.basicPensionNumber,
      healthInsurance: afterInsurance.healthInsurance
        ? { ...afterInsurance.healthInsurance }
        : { joined: false },
      nursingCareInsurance: afterInsurance.nursingCareInsurance
        ? { ...afterInsurance.nursingCareInsurance }
        : { joined: false },
      employeePensionInsurance: afterInsurance.employeePensionInsurance
        ? { ...afterInsurance.employeePensionInsurance }
        : { joined: false },
    };

    const shouldDeferInsuranceChange = (date: Date | null | undefined): boolean => {
      if (!date) return false;
      const timing = resolveAdminEffectiveDateTiming(date, workPeriodBounds);
      return timing === 'future' || timing === 'after_period_past';
    };

    if (shouldDeferInsuranceChange(gradeApplicationDate)) {
      result.currentGrade = before.currentGrade ?? result.currentGrade ?? 0;
    }

    for (const key of INSURANCE_PRIORITY) {
      const beforeDetail = before[key];
      const afterDetail = afterInsurance[key];
      if (isInsuranceAcquisition(beforeDetail, afterDetail)) {
        const acquiredDate = afterDetail?.acquiredDate?.toDate();
        if (shouldDeferInsuranceChange(acquiredDate)) {
          result[key] = beforeDetail ? { ...beforeDetail } : { joined: false };
        }
      }
      if (isInsuranceLoss(beforeDetail, afterDetail)) {
        const lostDate = afterDetail?.lostDate?.toDate();
        if (shouldDeferInsuranceChange(lostDate)) {
          result[key] = beforeDetail ? { ...beforeDetail } : { joined: false };
        }
      }
    }

    return result;
  }

  async createAnnouncementsForInsuranceChangeRuns(runIds: string[]): Promise<void> {
    for (const runId of runIds) {
      const run = await this.calculationRunService.getSystemCalculationRunById(runId);
      if (!run) continue;
      if (!this.announcementLogicService.shouldCreateAnnouncementForStatus(run.approval?.approvalStatus)) {
        continue;
      }
      try {
        await this.announcementLogicService.createFromInsuranceChangeRun(run);
      } catch (error) {
        console.error('届け出チェックリストの作成に失敗しました', error);
      }
    }
  }

  async createReachAgeInsuranceChangeRuns(
    employeeId: string,
    beforeInsurance: EmployeeInsurance | undefined,
    afterInsurance: EmployeeInsurance,
    loginEmployeeId: string,
    reachAgeEventId?: string,
    reachAgeType?: string,
  ): Promise<{ success: boolean; runIds: string[] }> {
    const before = beforeInsurance ?? {};
    const targetPeriodStart = await this.getTargetPeriodStart();
    const runIds: string[] = [];

    for (const key of INSURANCE_PRIORITY) {
      if (isInsuranceAcquisition(before[key], afterInsurance[key])) {
        const detectedDate = afterInsurance[key]?.acquiredDate;
        if (!detectedDate) return { success: false, runIds };

        const baseRunId = buildInsuranceChangeRunId('資格取得', detectedDate.toDate(), targetPeriodStart, key, employeeId);
        const runId = await this.calculationRunService.allocateSequentialRunId(baseRunId);
        const createdRunId = await this.calculationRunService.createAppliedEventQualificationRun(
          employeeId,
          runId,
          '資格取得',
          key,
          {
            ...this.buildSingleInsuranceChangePayload(key, before, afterInsurance),
            ...(reachAgeEventId ? { reachAgeEventId } : {}),
            ...(reachAgeType ? { reachAgeType } : {}),
          },
          detectedDate,
          loginEmployeeId,
          '一定年齢到達',
        );
        if (!createdRunId) return { success: false, runIds };
        runIds.push(createdRunId);
      }

      if (isInsuranceLoss(before[key], afterInsurance[key])) {
        const detectedDate = afterInsurance[key]?.lostDate;
        if (!detectedDate) return { success: false, runIds };

        const baseRunId = buildInsuranceChangeRunId('資格喪失', detectedDate.toDate(), targetPeriodStart, key, employeeId);
        const runId = await this.calculationRunService.allocateSequentialRunId(baseRunId);
        const createdRunId = await this.calculationRunService.createAppliedEventQualificationRun(
          employeeId,
          runId,
          '資格喪失',
          key,
          {
            ...this.buildSingleInsuranceChangePayload(key, before, afterInsurance),
            ...(reachAgeEventId ? { reachAgeEventId } : {}),
            ...(reachAgeType ? { reachAgeType } : {}),
          },
          detectedDate,
          loginEmployeeId,
          '一定年齢到達',
        );
        if (!createdRunId) return { success: false, runIds };
        runIds.push(createdRunId);
      }
    }

    return { success: true, runIds };
  }

  private buildSingleInsuranceChangePayload(
    insuranceKey: InsuranceKey,
    beforeInsurance: EmployeeInsurance | undefined,
    afterInsurance: EmployeeInsurance,
  ): { before: Record<string, unknown>; after: Record<string, unknown> } {
    const before = beforeInsurance ?? {};
    const beforeSnapshot: Record<string, unknown> = {
      [insuranceKey]: before[insuranceKey] ?? { joined: false },
    };
    const afterSnapshot: Record<string, unknown> = {
      [insuranceKey]: afterInsurance[insuranceKey] ?? { joined: false },
    };

    if (insuranceKey === 'healthInsurance') {
      if (before.currentGrade !== undefined) {
        beforeSnapshot['currentGrade'] = before.currentGrade;
      }
      if (afterInsurance.currentGrade !== undefined) {
        afterSnapshot['currentGrade'] = afterInsurance.currentGrade;
      }
    }

    return { before: beforeSnapshot, after: afterSnapshot };
  }

  private isSameInsuranceDetail(before?: InsuranceDetail, after?: InsuranceDetail): boolean {
    return JSON.stringify(before ?? null) === JSON.stringify(after ?? null);
  }

  async createAdHocRevisionOnApproval(
    employeeId: string,
    before: Employee,
    after: Employee,
    occurredDate: Timestamp,
    loginEmployeeId: string,
  ): Promise<string | null> {
    const targetPeriodStart = await this.getTargetPeriodStart();
    const revisionMonth = getAdHocRevisionWorkMonth(occurredDate.toDate(), targetPeriodStart);
    return this.calculationRunService.createAdHocRevisionRun(
      employeeId,
      revisionMonth,
      { before, after, fixedSalaryChangeDate: occurredDate, occurredDate },
      occurredDate,
    );
  }

  /** 固定給変更（今日以前）：従業員情報を反映し随時改定ランを作成 */
  private async applyAdminFixedSalaryChangePast(
    employeeId: string,
    before: Employee,
    after: Employee,
    effectiveDate: Timestamp,
    loginEmployeeId: string,
  ): Promise<void> {
    await this.employeeService.updateEmployee({ employeeId, employmentContract: after.employmentContract });
    await this.createAdHocRevisionOnApproval(employeeId, before, after, effectiveDate, loginEmployeeId);
  }

  async createEmploymentSystemRunOnApproval(
    employeeId: string,
    before: Employee,
    after: Employee,
    occurredDate: Timestamp,
  ): Promise<string | null> {
    const projection = await this.buildEmploymentInsuranceProjection(before, after, occurredDate);
    if (!projection) return null;

    const targetPeriodStart = await this.getTargetPeriodStart();
    const baseId = buildEmploymentChangeRunId(
      occurredDate.toDate(),
      employeeId,
      targetPeriodStart,
      projection.changedKeys,
    );

    return this.calculationRunService.createEmploymentChangeRun(
      employeeId,
      baseId,
      {
        before: projection.beforeSnapshot,
        after: projection.afterSnapshot,
        insuranceKeys: projection.changedKeys,
      },
      occurredDate,
      projection.qualificationType,
    );
  }

  async buildEmploymentInsuranceProjection(
    before: Employee,
    after: Employee,
    occurredDate: Timestamp,
  ): Promise<{
    beforeSnapshot: Record<string, unknown>;
    afterSnapshot: Record<string, unknown>;
    changedKeys: InsuranceKey[];
    qualificationType: '資格取得' | '資格喪失';
  } | null> {
    await this.companyService.getCompany();
    const isSpecificApplicableOffice = await this.companyService.isSpecificApplicableOffice();
    const required = this.employeeLogicService.isInsuranceRequired(after, isSpecificApplicableOffice);
    const autoGrade = await this.employeeLogicService.getInsuranceGradeAtNewEntry(after);
    const beforeInsurance = before.insurance ?? this.createEmptyInsurance();
    const currentGrade = beforeInsurance.currentGrade ?? 0;

    const healthStatus = this.resolveAutoInsuranceStatus(required.isHealthInsuranceRequired, beforeInsurance.healthInsurance);
    const nursingStatus = this.resolveAutoInsuranceStatus(required.isNursingCareInsuranceRequired, beforeInsurance.nursingCareInsurance);
    const pensionStatus = this.resolveAutoInsuranceStatus(required.isPensionInsuranceRequired, beforeInsurance.employeePensionInsurance);

    const afterInsurance: EmployeeInsurance = {
      currentGrade: this.resolveProjectedGrade(healthStatus, currentGrade, autoGrade),
      healthInsurance: this.buildProjectedInsuranceDetail(healthStatus, occurredDate, beforeInsurance.healthInsurance),
      nursingCareInsurance: this.buildProjectedInsuranceDetail(nursingStatus, occurredDate, beforeInsurance.nursingCareInsurance),
      employeePensionInsurance: this.buildProjectedInsuranceDetail(pensionStatus, occurredDate, beforeInsurance.employeePensionInsurance),
      basicPensionNumber: beforeInsurance.basicPensionNumber,
    };

    const changedKeys = INSURANCE_PRIORITY.filter(key =>
      isInsuranceAcquisition(beforeInsurance[key], afterInsurance[key])
      || isInsuranceLoss(beforeInsurance[key], afterInsurance[key]),
    );
    if (changedKeys.length === 0) return null;

    const hasAcquisition = changedKeys.some(key => isInsuranceAcquisition(beforeInsurance[key], afterInsurance[key]));
    const hasLoss = changedKeys.some(key => isInsuranceLoss(beforeInsurance[key], afterInsurance[key]));
    const qualificationType: '資格取得' | '資格喪失' = hasLoss ? '資格喪失' : '資格取得';
    const beforeGrade = beforeInsurance.currentGrade ?? 0;
    const afterGrade = afterInsurance.currentGrade ?? 0;

    return {
      beforeSnapshot: this.toEmploymentInsuranceSnapshot(
        beforeInsurance,
        hasLoss ? beforeGrade : undefined,
      ),
      afterSnapshot: this.toEmploymentInsuranceSnapshot(
        afterInsurance,
        hasAcquisition ? afterGrade : undefined,
      ),
      changedKeys,
      qualificationType,
    };
  }

  private createEmptyInsurance(): EmployeeInsurance {
    return {
      currentGrade: 0,
      healthInsurance: { joined: false },
      nursingCareInsurance: { joined: false },
      employeePensionInsurance: { joined: false },
    };
  }

  private resolveAutoInsuranceStatus(
    required: boolean | undefined,
    currentDetail?: InsuranceDetail,
  ): 'joined' | 'notJoined' | 'lost' {
    const current = getInsuranceJoinStatus(currentDetail);
    if (!required) {
      if (current === 'joined') return 'lost';
      return current;
    }
    return 'joined';
  }

  private resolveProjectedGrade(
    healthStatus: 'joined' | 'notJoined' | 'lost',
    currentGrade: number,
    autoGrade: number | undefined,
  ): number {
    if (healthStatus === 'notJoined') return 0;
    if (healthStatus === 'lost') return currentGrade;
    return autoGrade ?? currentGrade;
  }

  private buildProjectedInsuranceDetail(
    status: 'joined' | 'notJoined' | 'lost',
    changeDate: Timestamp,
    existing?: InsuranceDetail,
  ): InsuranceDetail {
    if (status === 'notJoined') return { joined: false };

    if (status === 'joined') {
      return {
        joined: true,
        number: existing?.number,
        acquiredDate: changeDate,
        companyBurdenRate: existing?.companyBurdenRate ?? 50,
      };
    }

    return {
      joined: false,
      number: existing?.number,
      acquiredDate: existing?.acquiredDate ?? changeDate,
      lostDate: changeDate,
      companyBurdenRate: existing?.companyBurdenRate ?? 50,
    };
  }

  private toEmploymentInsuranceSnapshot(
    insurance: EmployeeInsurance,
    grade?: number,
  ): Record<string, unknown> {
    const snapshot: Record<string, unknown> = {
      healthInsurance: insurance.healthInsurance ?? { joined: false },
      nursingCareInsurance: insurance.nursingCareInsurance ?? { joined: false },
      employeePensionInsurance: insurance.employeePensionInsurance ?? { joined: false },
    };
    if (grade !== undefined) {
      snapshot['currentGrade'] = grade;
    }
    return snapshot;
  }

  async createRetireEvents(
    employeeId: string,
    before: Employee,
    after: Employee,
    loginEmployeeId: string,
  ): Promise<RetireEventsResult> {
    const createdIds: string[] = [];
    if (!after.resignationDate) return { createdIds, needsRetroactiveNotice: false };

    if (after.workStatus === '退社予定') {
      const pendingId = await this.createPendingAdminEvent(employeeId, '退社', before, after);
      if (pendingId) createdIds.push(pendingId);
      return { createdIds, needsRetroactiveNotice: false };
    }

    const adminId = await this.createAdminApprovedEvent(employeeId, '退社', before, after, loginEmployeeId);
    if (adminId) createdIds.push(adminId);

    await this.companyService.getCompany();
    const targetPeriodStart = this.companyService.company()?.settings?.targetPeriod[0] ?? 1;
    const resignMonth = getWorkMonthForDate(after.resignationDate.toDate(), targetPeriodStart);
    const current = getWorkingYearMonth();
    const beforePeriod = resignMonth.year * 12 + resignMonth.month < current.year * 12 + current.month;
    if (beforePeriod) {
      return { createdIds, needsRetroactiveNotice: true };
    }

    const followUp = await this.createRetireInsuranceAndDependentEvents(employeeId, before, after.resignationDate);
    createdIds.push(...followUp.createdIds);
    return followUp;
  }

  async createRetireInsuranceAndDependentEvents(
    employeeId: string,
    before: Employee,
    resignationDate: Timestamp,
  ): Promise<RetireEventsResult> {
    const createdIds: string[] = [];

    await this.companyService.getCompany();
    const targetPeriodStart = this.companyService.company()?.settings?.targetPeriod[0] ?? 1;
    const resignMonth = getWorkMonthForDate(resignationDate.toDate(), targetPeriodStart);
    const current = getWorkingYearMonth();
    const beforePeriod = resignMonth.year * 12 + resignMonth.month < current.year * 12 + current.month;

    if (beforePeriod) {
      return { createdIds, needsRetroactiveNotice: true };
    }

    const dependents = await this.dependentService.getDependents(employeeId);
    const activeDependents = dependents.filter(dependent => dependent.isDependent !== false);
    const qualificationLossDate = getQualificationLossTimestamp(resignationDate);

    const dependentEventIds: string[] = [];
    const dependentBaseId = buildDependentChangeEventBaseId(
      getQualificationLossDate(resignationDate.toDate()),
      targetPeriodStart,
    );
    for (const dependent of activeDependents) {
      const afterDependent: Partial<Dependent> = {
        ...dependent,
        isDependent: false,
        dependentEndDate: qualificationLossDate,
      };
      const dependentEventId = await this.eventService.createEventWithBaseId(employeeId, dependentBaseId, {
        occurredDate: qualificationLossDate,
        eventType: '扶養情報変更',
        changeType: '削除',
        lifeEventType: '退社',
        appliedDate: Timestamp.now(),
        applicantType: 'システム',
        approval: {
          approvalStatus: '申請中',
        },
        payload: { before: dependent, after: afterDependent, appliedDate: qualificationLossDate },
      });
      if (!dependentEventId) return { createdIds, needsRetroactiveNotice: false };
      dependentEventIds.push(dependentEventId);
      createdIds.push(dependentEventId);
    }

    const qualificationRunId = await this.calculationRunService.createPendingRetireQualificationLossRun(
      employeeId,
      resignationDate,
      targetPeriodStart,
      before,
      dependentEventIds,
    );
    if (qualificationRunId) createdIds.push(qualificationRunId);

    return { createdIds, needsRetroactiveNotice: false };
  }

  async createEventFromDependentChange(
    employeeId: string,
    changes: {
      before: Dependent | null;
      after: Partial<Dependent>;
      appliedDateInput?: string;
    }[],
    loginEmployeeId: string,
  ): Promise<string[]> {
    if (changes.length === 0) {
      return [];
    }

    const inputs = this.dependentChangeEventService.buildChangeInputs(changes);
    return this.dependentChangeEventService.createAppliedDependentChangeEvents(employeeId, inputs, loginEmployeeId);
  }

  hasImmediateEvent(createdEventIds: string[]): boolean {
    const { year, month } = getWorkingYearMonth();
    if (!year || !month) return false;

    return createdEventIds.some(eventId =>
      isEventAtOrBeforeWorkingMonth(eventId, year, month),
    );
  }

  needsApprovalDialog(event: Event): boolean {
    if (event.approval?.approvalStatus !== '申請中' || event.applicantType !== 'システム') {
      return false;
    }
    return event.eventType === '固定給変更' || event.eventType === '雇用形態変更';
  }

  needsApprovalDialogForRun(run: { eventType?: string; approval?: { approvalStatus?: string } }): boolean {
    if (run.approval?.approvalStatus !== '申請中') return false;
    return run.eventType === '固定給変更' || run.eventType === '雇用形態変更';
  }

  private async createWorkStatusEvent(
    employeeId: string,
    changeType: ChangeType,
    occurredDate: Timestamp,
    payload: Record<string, unknown>,
    loginEmployeeId: string,
    targetPeriodStart: number,
    lifeEventType?: LifeEventType,
  ): Promise<string | null> {
    const isBeforeToday = isDateStrictlyBeforeToday(occurredDate.toDate());
    const baseId = buildWorkMonthEventId('勤務状況変更', occurredDate.toDate(), targetPeriodStart);
    const approval = isBeforeToday
      ? {
        approvalStatus: '承認済み' as const,
        approvedDate: Timestamp.now(),
        approvedBy: loginEmployeeId,
        approvedWorkingMonth: getCurrentApprovedWorkingMonth(),
      }
      : { approvalStatus: '申請中' as const };
    const eventId = await this.eventService.createEventWithBaseId(employeeId, baseId, {
      occurredDate,
      eventType: '勤務状況変更',
      changeType,
      ...(lifeEventType ? { lifeEventType } : {}),
      appliedDate: Timestamp.now(),
      applicantType: '管理者',
      approval,
      payload,
    });
    if (eventId && isBeforeToday) {
      await this.createLeaveAnnouncementIfNeeded(employeeId, {
        eventId,
        eventType: '勤務状況変更',
        changeType,
        occurredDate,
        payload,
        ...(lifeEventType ? { lifeEventType } : {}),
      });
    }
    return eventId;
  }

  private async createLeaveAnnouncementIfNeeded(
    employeeId: string,
    event: Pick<Event, 'eventId' | 'eventType' | 'changeType' | 'occurredDate' | 'payload' | 'lifeEventType'>,
  ): Promise<void> {
    try {
      await this.announcementLogicService.createFromLeaveEvent(event, employeeId);
    } catch (error) {
      console.error('届け出チェックリストの作成に失敗しました', error);
    }
  }

  private async createContractEvent(
    employeeId: string,
    eventType: '固定給変更' | '雇用形態変更',
    occurredDate: Timestamp,
    payload: Record<string, unknown>,
    loginEmployeeId: string,
    targetPeriodStart: number,
    status: 'pending' | 'approved' | 'applied',
  ): Promise<string | null> {
    const baseId = buildWorkMonthEventId(eventType, occurredDate.toDate(), targetPeriodStart);
    const approval = status === 'pending'
      ? { approvalStatus: '申請中' as const }
      : status === 'approved'
        ? {
          approvalStatus: '承認済み' as const,
          approvedDate: Timestamp.now(),
          approvedBy: loginEmployeeId,
          approvedWorkingMonth: getCurrentApprovedWorkingMonth(),
        }
        : {
          approvalStatus: '適用済み' as const,
          approvedDate: Timestamp.now(),
          approvedBy: loginEmployeeId,
          approvedWorkingMonth: getCurrentApprovedWorkingMonth(),
          appliedFromMonth: getCurrentAppliedFromMonth(),
        };
    return this.eventService.createEventWithBaseId(employeeId, baseId, {
      occurredDate,
      eventType,
      appliedDate: Timestamp.now(),
      applicantType: '管理者',
      approval,
      payload,
    });
  }

  private pickEmploymentContract(employee: Employee): EmploymentContract | undefined {
    if (!employee.employmentContract) return undefined;
    return { ...employee.employmentContract };
  }

  private async getTargetPeriodStart(): Promise<number> {
    await this.companyService.getCompany();
    return this.companyService.company()?.settings?.targetPeriod[0] ?? 1;
  }

  private async createPendingAdminEvent(
    employeeId: string,
    eventType: EmployeeEventType,
    before: Employee | Record<string, unknown>,
    after: Employee | Record<string, unknown>,
  ): Promise<string | null> {
    let occurredDate = Timestamp.now();
    if (eventType === '退社') {
      occurredDate = (after as Employee).resignationDate as Timestamp;
    }
    return this.eventService.createEventWithBaseId(employeeId, buildCurrentWorkMonthEventId(eventType), {
      occurredDate,
      eventType,
      appliedDate: Timestamp.now(),
      applicantType: '管理者',
      approval: {
        approvalStatus: '申請中',
      },
      payload: { before, after },
    });
  }

  private async createAdminApprovedEvent(
    employeeId: string,
    eventType: EmployeeEventType,
    before: Employee | Record<string, unknown>,
    after: Employee | Record<string, unknown>,
    loginEmployeeId: string,
  ): Promise<string | null> {
    let occurredDate = Timestamp.now();
    if (eventType === '退社') {
      occurredDate = (after as Employee).resignationDate as Timestamp;
    }
    return this.eventService.createEventWithBaseId(employeeId, buildCurrentWorkMonthEventId(eventType), {
      occurredDate: occurredDate,
      eventType,
      appliedDate: Timestamp.now(),
      applicantType: '管理者',
      approval: {
        approvalStatus: '承認済み',
        approvedDate: Timestamp.now(),
        approvedBy: loginEmployeeId,
        approvedWorkingMonth: getCurrentApprovedWorkingMonth(),
      },
      payload: { before, after },
    });
  }
}
