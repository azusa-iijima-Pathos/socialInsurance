import { inject, Injectable } from '@angular/core';
import { Timestamp } from '@angular/fire/firestore';
import { Employee, EmploymentContract, EmployeeInsurance, InsuranceDetail } from '../../model/employee';
import { Dependent } from '../../model/dependent';
import { ChangeType, EmployeeEventType, LeaveType } from '../../constants/model-constants';
import { EventService } from '../Firestore/event-service';
import { CalculationRunService } from '../Firestore/calculation-run-service';
import { CompanyService } from '../Firestore/company-service';
import { DependentService } from '../Firestore/dependent-service';
import { EmployeeService } from '../Firestore/employee-service';
import {
  addMonths,
  buildCurrentWorkMonthEventId,
  buildDependentChangeEventBaseId,
  buildGradeChangeRunId,
  buildInsuranceChangeRunId,
  buildWorkMonthEventId,
  getQualificationLossDate,
  getQualificationLossTimestamp,
  getWorkMonthForDate,
  getWorkingYearMonth,
  isDateBeforeWorkPeriod,
  isDateInWorkPeriod,
  isEventAtOrBeforeWorkingMonth,
  isWorkMonthAfterCurrent,
} from './event-id-service';
import type { InsuranceChangeKey } from './event-id-service';
import { DependentChangeEventService } from './dependent-change-event.service';
import { Event } from '../../model/event';

export type ContractChangeEventsResult = {
  createdIds: string[];
  needsRetroactiveNotice: boolean;
};

export type RetireEventsResult = {
  createdIds: string[];
  needsRetroactiveNotice: boolean;
};

export type WorkStatusChangeScenario = 'leaveStart' | 'leaveEnd' | 'leaveSwitch';

export type WorkStatusChangeInput = {
  scenario: WorkStatusChangeScenario;
  leaveTypes?: LeaveType;
  leaveStartDate?: Timestamp;
  leaveEndDate?: Timestamp;
  switchDate?: Timestamp;
};

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
      const payload = {
        before: { workStatus: before.workStatus ?? '通常勤務' },
        after: {
          workStatus: '休職中' as const,
          leaveTypes: input.leaveTypes,
          leaveStartDate: occurredDate,
          ...(input.leaveEndDate ? { leaveEndDate: input.leaveEndDate } : {}),
        },
      };
      const eventId = await this.createWorkStatusEvent(
        employeeId,
        '休職開始',
        occurredDate,
        payload,
        loginEmployeeId,
        targetPeriodStart,
      );
      if (!eventId) return { createdIds, needsRetroactiveNotice: false };
      createdIds.push(eventId);

      if (!isWorkMonthAfterCurrent(occurredDate.toDate(), targetPeriodStart)) {
        await this.employeeService.updateEmployee({
          employeeId,
          workStatus: '休職中',
          leaveTypes: input.leaveTypes,
          leaveStartDate: occurredDate,
          ...(input.leaveEndDate ? { leaveEndDate: input.leaveEndDate } : {}),
        });
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
      );
      if (!eventId) return { createdIds, needsRetroactiveNotice: false };
      createdIds.push(eventId);

      if (!isWorkMonthAfterCurrent(occurredDate.toDate(), targetPeriodStart)) {
        await this.employeeService.updateEmployee({
          employeeId,
          workStatus: '通常勤務',
          leaveTypes: null,
          leaveEndDate: occurredDate,
        });
      }
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
      );
      if (!startEventId) return { createdIds, needsRetroactiveNotice: false };
      createdIds.push(startEventId);

      if (!isWorkMonthAfterCurrent(switchDate.toDate(), targetPeriodStart)) {
        await this.employeeService.updateEmployee({
          employeeId,
          workStatus: '休職中',
          leaveTypes: input.leaveTypes,
          leaveStartDate: switchDate,
        });
      }
    }

    return { createdIds, needsRetroactiveNotice: false };
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
    const isFuture = isWorkMonthAfterCurrent(effectiveDate.toDate(), targetPeriodStart);

    if (beforeContract?.fixedSalary !== afterContract?.fixedSalary) {
      const eventId = await this.createContractEvent(
        employeeId,
        '固定給変更',
        effectiveDate,
        { before: beforeContract?.fixedSalary, after: afterContract?.fixedSalary },
        loginEmployeeId,
        targetPeriodStart,
        isFuture,
      );
      if (eventId) {
        createdIds.push(eventId);
        if (!isFuture) {
          await this.employeeService.updateEmployee({ employeeId, employmentContract: after.employmentContract });
          await this.createAdHocRevisionOnApproval(employeeId, before, after, effectiveDate, loginEmployeeId);
        }
      }
    }

    const contractShapeChanged =
      beforeContract?.employmentCategory !== afterContract?.employmentCategory
      || beforeContract?.workStyle !== afterContract?.workStyle
      || beforeContract?.officeId !== afterContract?.officeId
      || beforeContract?.contractedWorkingHoursPerWeek !== afterContract?.contractedWorkingHoursPerWeek
      || beforeContract?.contractedWorkingDaysPerMonth !== afterContract?.contractedWorkingDaysPerMonth
      || beforeContract?.transportationExpenses !== afterContract?.transportationExpenses;

    if (contractShapeChanged) {
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
        isFuture,
      );
      if (eventId) {
        createdIds.push(eventId);
        if (!isFuture) {
          await this.employeeService.updateEmployee({ employeeId, employmentContract: after.employmentContract });
          if (this.shouldCreateEmploymentSystemRun(before, after)) {
            await this.createEmploymentSystemRunOnApproval(employeeId, before, after, effectiveDate);
          }
        }
      }
    }

    return { createdIds, needsRetroactiveNotice: false };
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
        },
      });
      if (!rejected) return false;
    }
    return true;
  }

  getScheduledLeaveInfo(events: Event[]): ScheduledLeaveInfo | null {
    const pendingStart = events.find(event =>
      event.eventType === '勤務状況変更'
      && event.changeType === '休職開始'
      && (event.approval?.approvalStatus === '申請中' || event.approval?.approvalStatus === '承認済み'),
    );
    if (!pendingStart) return null;

    const after = pendingStart.payload?.['after'] as Record<string, unknown> | undefined;
    const leaveTypes = after?.['leaveTypes'] as LeaveType | undefined;
    const leaveStartDate = (after?.['leaveStartDate'] as Timestamp | undefined) ?? pendingStart.occurredDate;
    const leaveEndDate = after?.['leaveEndDate'] as Timestamp | undefined;
    if (!leaveTypes || !leaveStartDate) return null;

    return { leaveTypes, leaveStartDate, leaveEndDate };
  }

  getScheduledEmploymentContractInfo(events: Event[]): ScheduledEmploymentContractInfo | null {
    const pending = events.find(event =>
      (event.eventType === '固定給変更' || event.eventType === '雇用形態変更')
      && event.approval?.approvalStatus === '申請中',
    );
    if (!pending?.occurredDate) return null;
    return { effectiveDate: pending.occurredDate };
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

        const approved = workPeriodBounds
          ? isDateInWorkPeriod(date, workPeriodBounds.periodStart, workPeriodBounds.periodEnd)
          : !isWorkMonthAfterCurrent(date, targetPeriodStart);
        const runId = buildInsuranceChangeRunId('資格取得', date, targetPeriodStart, key);
        const createdRunId = await this.calculationRunService.createInsuranceChangeRun(
          employeeId,
          runId,
          '資格取得',
          key,
          { before, after: afterInsurance },
          detectedDate,
          approved,
          loginEmployeeId,
        );
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

        const approved = workPeriodBounds
          ? isDateInWorkPeriod(date, workPeriodBounds.periodStart, workPeriodBounds.periodEnd)
          : !isWorkMonthAfterCurrent(date, targetPeriodStart);
        const runId = buildInsuranceChangeRunId('資格喪失', date, targetPeriodStart, key);
        const createdRunId = await this.calculationRunService.createInsuranceChangeRun(
          employeeId,
          runId,
          '資格喪失',
          key,
          { before, after: afterInsurance },
          detectedDate,
          approved,
          loginEmployeeId,
        );
        if (!createdRunId) return { success: false, runIds };
        runIds.push(createdRunId);
      }
    }

    if (gradeChange && gradeChangeRunId) {
      const runId = await this.calculationRunService.createAppliedGradeChangeRun(
        employeeId,
        gradeChangeRunId,
        {
          beforeGrade: gradeChange.beforeGrade,
          afterGrade: gradeChange.afterGrade,
          applicationDate: gradeChange.applicationDate,
        },
        gradeChange.applicationDate,
        loginEmployeeId,
      );
      if (!runId) return { success: false, runIds };
      runIds.push(runId);
    }

    return { success: true, runIds };
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
    const working = getWorkingYearMonth();
    const revisionMonth = addMonths(working.year, working.month, 3);
    return this.calculationRunService.createAdHocRevisionRun(
      employeeId,
      revisionMonth,
      { before, after, occurredDate },
      occurredDate,
    );
  }

  async createEmploymentSystemRunOnApproval(
    employeeId: string,
    before: Employee,
    after: Employee,
    occurredDate: Timestamp,
  ): Promise<string | null> {
    const targetPeriodStart = await this.getTargetPeriodStart();
    const baseId = buildWorkMonthEventId('雇用形態変更', occurredDate.toDate(), targetPeriodStart);
    return this.calculationRunService.createSystemEventRun(
      employeeId,
      baseId,
      '雇用形態変更',
      {
        before: { insurance: before.insurance },
        after: { insurance: after.insurance },
      },
      occurredDate,
    );
  }

  shouldCreateEmploymentSystemRun(before: Employee, after: Employee): boolean {
    const beforeContract = before.employmentContract;
    const afterContract = after.employmentContract;
    if (!beforeContract || !afterContract) return false;

    const afterIsShortContractOrPart = this.isShortContractOrPart(afterContract);
    const beforeIsShortContractOrPart = this.isShortContractOrPart(beforeContract);
    const changedContractCondition =
      beforeContract.employmentCategory !== afterContract.employmentCategory
      || beforeContract.workStyle !== afterContract.workStyle
      || beforeContract.contractedWorkingHoursPerWeek !== afterContract.contractedWorkingHoursPerWeek
      || beforeContract.contractedWorkingDaysPerMonth !== afterContract.contractedWorkingDaysPerMonth;

    return (beforeContract.employmentCategory === '正社員' && afterIsShortContractOrPart)
      || (beforeIsShortContractOrPart && changedContractCondition);
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
        applicantType: '管理者',
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
  ): Promise<string | null> {
    const isFuture = isWorkMonthAfterCurrent(occurredDate.toDate(), targetPeriodStart);
    const baseId = buildWorkMonthEventId('勤務状況変更', occurredDate.toDate(), targetPeriodStart);
    return this.eventService.createEventWithBaseId(employeeId, baseId, {
      occurredDate,
      eventType: '勤務状況変更',
      changeType,
      appliedDate: Timestamp.now(),
      applicantType: '管理者',
      approval: isFuture
        ? { approvalStatus: '申請中' }
        : {
          approvalStatus: '承認済み',
          approvedDate: Timestamp.now(),
          approvedBy: loginEmployeeId,
        },
      payload,
    });
  }

  private async createContractEvent(
    employeeId: string,
    eventType: '固定給変更' | '雇用形態変更',
    occurredDate: Timestamp,
    payload: Record<string, unknown>,
    loginEmployeeId: string,
    targetPeriodStart: number,
    isFuture: boolean,
  ): Promise<string | null> {
    const baseId = buildWorkMonthEventId(eventType, occurredDate.toDate(), targetPeriodStart);
    return this.eventService.createEventWithBaseId(employeeId, baseId, {
      occurredDate,
      eventType,
      appliedDate: Timestamp.now(),
      applicantType: '管理者',
      approval: isFuture
        ? { approvalStatus: '申請中' }
        : {
          approvalStatus: '承認済み',
          approvedDate: Timestamp.now(),
          approvedBy: loginEmployeeId,
        },
      payload,
    });
  }

  private pickEmploymentContract(employee: Employee): EmploymentContract | undefined {
    if (!employee.employmentContract) return undefined;
    return { ...employee.employmentContract };
  }

  private isShortContractOrPart(contract: NonNullable<Employee['employmentContract']>): boolean {
    return (contract.employmentCategory === '契約社員' && contract.workStyle === '時短')
      || contract.employmentCategory === 'パート'
      || contract.workStyle === 'パート';
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
      },
      payload: { before, after },
    });
  }
}
