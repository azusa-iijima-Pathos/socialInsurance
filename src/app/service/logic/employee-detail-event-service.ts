import { inject, Injectable } from '@angular/core';
import { Timestamp } from '@angular/fire/firestore';
import { Employee } from '../../model/employee';
import { Dependent } from '../../model/dependent';
import { EmployeeEventType } from '../../constants/model-constants';
import { EventService } from '../Firestore/event-service';
import { CalculationRunService } from '../Firestore/calculation-run-service';
import { CompanyService } from '../Firestore/company-service';
import { DependentService } from '../Firestore/dependent-service';
import {
  addMonths,
  buildCurrentWorkMonthEventId,
  buildDependentChangeEventBaseId,
  getWorkMonthForDate,
  getWorkingYearMonth,
  isEventAtOrBeforeWorkingMonth,
} from './event-id-service';
import { Event } from '../../model/event';

export type ContractChangeEventsResult = {
  createdIds: string[];
  needsRetroactiveNotice: boolean;
};

export type RetireEventsResult = {
  createdIds: string[];
  needsRetroactiveNotice: boolean;
};

@Injectable({
  providedIn: 'root',
})
export class EmployeeDetailEventService {

  private eventService = inject(EventService);
  private calculationRunService = inject(CalculationRunService);
  private companyService = inject(CompanyService);
  private dependentService = inject(DependentService);

  async createEventsFromContractChange(
    employeeId: string,
    before: Employee,
    after: Employee,
    loginEmployeeId: string,
  ): Promise<ContractChangeEventsResult> {
    const createdIds: string[] = [];
    const beforeContract = before.employmentContract;
    const afterContract = after.employmentContract;

    const isRetireStatus = after.workStatus === '退社済み' || after.workStatus === '退社予定';
    const wasRetireStatus = before.workStatus === '退社済み' || before.workStatus === '退社予定';

    if (isRetireStatus && after.resignationDate && (!wasRetireStatus || before.resignationDate?.toMillis() !== after.resignationDate?.toMillis())) {
      const retireResult = await this.createRetireEvents(employeeId, before, after, loginEmployeeId);
      return {
        createdIds: retireResult.createdIds,
        needsRetroactiveNotice: retireResult.needsRetroactiveNotice,
      };
    }

    if (beforeContract?.fixedSalary !== afterContract?.fixedSalary) {
      createdIds.push(...await this.createFixedSalaryEvents(employeeId, before, after, loginEmployeeId));
    }

    const contractShapeChanged =
      beforeContract?.employmentCategory !== afterContract?.employmentCategory
      || beforeContract?.workStyle !== afterContract?.workStyle
      || beforeContract?.officeId !== afterContract?.officeId
      || beforeContract?.contractedWorkingHoursPerWeek !== afterContract?.contractedWorkingHoursPerWeek
      || beforeContract?.contractedWorkingDaysPerMonth !== afterContract?.contractedWorkingDaysPerMonth;

    if (contractShapeChanged) {
      createdIds.push(...await this.createEmploymentChangeEvents(employeeId, before, after, loginEmployeeId));
    }

    if (
      !isRetireStatus
      && (before.workStatus !== after.workStatus || before.leaveTypes !== after.leaveTypes)
      && !contractShapeChanged
      && beforeContract?.fixedSalary === afterContract?.fixedSalary
    ) {
      const eventId = await this.createAdminApprovedEvent(
        employeeId,
        '勤務状況変更',
        before,
        after,
        loginEmployeeId,
      );
      if (eventId) createdIds.push(eventId);
    }

    return { createdIds, needsRetroactiveNotice: false };
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

    const dependentEventIds: string[] = [];
    const dependentBaseId = buildDependentChangeEventBaseId(resignationDate.toDate(), targetPeriodStart);
    for (const dependent of activeDependents) {
      const afterDependent: Partial<Dependent> = {
        ...dependent,
        isDependent: false,
        dependentEndDate: resignationDate,
      };
      const dependentEventId = await this.eventService.createEventWithBaseId(employeeId, dependentBaseId, {
        occurredDate: resignationDate,
        eventType: '扶養情報変更',
        lifeEventType: '退社',
        appliedDate: Timestamp.now(),
        applicantType: '管理者',
        approval: {
          approvalStatus: '申請中',
        },
        payload: { before: dependent, after: afterDependent },
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
    before: Dependent[],
    after: Dependent[],
    loginEmployeeId: string,
  ): Promise<string[]> {
    if (!this.hasDependentChanges(before, after)) {
      return [];
    }

    const eventId = await this.createAdminApprovedEvent(
      employeeId,
      '扶養情報変更',
      { dependents: before } as unknown as Employee,
      { dependents: after } as unknown as Employee,
      loginEmployeeId,
    );
    return eventId ? [eventId] : [];
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

  private async createFixedSalaryEvents(
    employeeId: string,
    before: Employee,
    after: Employee,
    loginEmployeeId: string,
  ): Promise<string[]> {
    const createdIds: string[] = [];
    const adminId = await this.createAdminApprovedEvent(employeeId, '固定給変更', before, after, loginEmployeeId);
    if (adminId) createdIds.push(adminId);

    const working = getWorkingYearMonth();
    const revisionMonth = addMonths(working.year, working.month, 3);
    const systemId = await this.calculationRunService.createAdHocRevisionRun(
      employeeId,
      revisionMonth,
      { before, after, fixedSalaryChangeDate: Timestamp.now() },
      Timestamp.now(),
    );
    if (systemId) createdIds.push(systemId);

    return createdIds;
  }

  private async createEmploymentChangeEvents(
    employeeId: string,
    before: Employee,
    after: Employee,
    loginEmployeeId: string,
  ): Promise<string[]> {
    const createdIds: string[] = [];
    const adminId = await this.createAdminApprovedEvent(employeeId, '雇用形態変更', before, after, loginEmployeeId);
    if (adminId) createdIds.push(adminId);

    if (this.shouldCreateEmploymentSystemRun(before, after)) {
      const systemId = await this.calculationRunService.createSystemEventRun(
        employeeId,
        buildCurrentWorkMonthEventId('雇用形態変更'),
        '雇用形態変更',
        { before, after },
        Timestamp.now(),
      );
      if (systemId) createdIds.push(systemId);
    }

    return createdIds;
  }

  private shouldCreateEmploymentSystemRun(before: Employee, after: Employee): boolean {
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

  private isShortContractOrPart(contract: NonNullable<Employee['employmentContract']>): boolean {
    return (contract.employmentCategory === '契約社員' && contract.workStyle === '時短')
      || contract.employmentCategory === 'パート'
      || contract.workStyle === 'パート';
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

  private hasDependentChanges(before: Dependent[], after: Dependent[]): boolean {
    if (before.length !== after.length) return true;

    const serialize = (dependents: Dependent[]) =>
      dependents
        .map(dependent => ({
          dependentId: dependent.dependentId,
          name: dependent.name ?? '',
          birthDate: dependent.birthDate?.toDate().toISOString().slice(0, 10) ?? '',
          relationship: dependent.relationship ?? '',
          isDependent: dependent.isDependent !== false,
          cohabitationType: dependent.cohabitationType ?? '',
          annualIncome: dependent.annualIncome ?? '',
          occupation: dependent.occupation ?? '',
          hasDisability: dependent.hasDisability ?? false,
          disabilityType: dependent.disabilityType ?? '',
          isStudent: dependent.isStudent ?? false,
          studentType: dependent.studentType ?? '',
        }))
        .sort((left, right) => left.dependentId.localeCompare(right.dependentId));

    return JSON.stringify(serialize(before)) !== JSON.stringify(serialize(after));
  }
}
