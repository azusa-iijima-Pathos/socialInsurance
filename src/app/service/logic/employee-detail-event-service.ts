import { inject, Injectable } from '@angular/core';
import { Timestamp } from '@angular/fire/firestore';
import { Employee } from '../../model/employee';
import { Dependent } from '../../model/dependent';
import { EmployeeEventType } from '../../constants/model-constants';
import { EventService } from '../Firestore/event-service';
import { CalculationRunService } from '../Firestore/calculation-run-service';
import { CompanyService } from '../Firestore/company-service';
import { EmployeeLogicService } from './employee-logic-service';
import {
  addMonths,
  buildAdHocRevisionRunId,
  buildCurrentWorkMonthEventId,
  buildRetireSystemEventId,
  getFixedSalarySystemOccurredDate,
  getWorkingYearMonth,
  isEventAtOrBeforeWorkingMonth,
} from './event-id-service';
import { Event } from '../../model/event';

type InsuranceStatusKind = 'joined' | 'notJoined' | 'lost';

@Injectable({
  providedIn: 'root',
})
export class EmployeeDetailEventService {

  private eventService = inject(EventService);
  private calculationRunService = inject(CalculationRunService);
  private companyService = inject(CompanyService);
  private employeeLogicService = inject(EmployeeLogicService);

  async createEventsFromContractChange(
    employeeId: string,
    before: Employee,
    after: Employee,
    loginEmployeeId: string,
  ): Promise<string[]> {
    const createdIds: string[] = [];
    const beforeContract = before.employmentContract;
    const afterContract = after.employmentContract;

    const isRetireStatus = after.workStatus === '退社済み' || after.workStatus === '退社予定';
    const wasRetireStatus = before.workStatus === '退社済み' || before.workStatus === '退社予定';

    if (isRetireStatus && after.resignationDate && (!wasRetireStatus || before.resignationDate?.toMillis() !== after.resignationDate?.toMillis())) {
      createdIds.push(...await this.createRetireEvents(employeeId, before, after, loginEmployeeId));
      return createdIds;
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

    return createdIds;
  }

  async createRetireEvents(
    employeeId: string,
    before: Employee,
    after: Employee,
    loginEmployeeId: string,
  ): Promise<string[]> {
    const createdIds: string[] = [];
    if (!after.resignationDate) return createdIds;

    const adminId = await this.createAdminApprovedEvent(employeeId, '退社', before, after, loginEmployeeId);
    if (adminId) createdIds.push(adminId);

    await this.companyService.getCompany();
    const targetPeriodStart = this.companyService.company()?.settings?.targetPeriod[0] ?? 1;
    const systemEventId = buildRetireSystemEventId(after.resignationDate.toDate(), targetPeriodStart);
    const systemId = await this.calculationRunService.createSystemEventRun(
      employeeId,
      systemEventId,
      '退社',
      { before, after },
      after.resignationDate,
    );
    if (systemId) createdIds.push(systemId);

    return createdIds;
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

  async hasInsuranceStatusChangePossible(before: Employee, after: Employee): Promise<boolean> {
    const isSpecificApplicableOffice = await this.companyService.isSpecificApplicableOffice();
    const beforeRequired = this.employeeLogicService.isInsuranceRequired(before, isSpecificApplicableOffice);
    const afterRequired = this.employeeLogicService.isInsuranceRequired(after, isSpecificApplicableOffice);

    const checks = [
      [beforeRequired.isHealthInsuranceRequired, afterRequired.isHealthInsuranceRequired, before.insurance?.healthInsurance],
      [beforeRequired.isNursingCareInsuranceRequired, afterRequired.isNursingCareInsuranceRequired, before.insurance?.nursingCareInsurance],
      [beforeRequired.isPensionInsuranceRequired, afterRequired.isPensionInsuranceRequired, before.insurance?.employeePensionInsurance],
    ] as const;

    for (const [beforeJoinRequired, afterJoinRequired, detail] of checks) {
      if (beforeJoinRequired !== afterJoinRequired) {
        return true;
      }
      const actual = this.getActualInsuranceStatus(detail);
      if (actual === 'lost') {
        continue;
      }
      const expectedAfter: InsuranceStatusKind = afterJoinRequired ? 'joined' : 'notJoined';
      if (actual !== expectedAfter) {
        return true;
      }
    }

    return false;
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
      { before, after },
      Timestamp.fromDate(getFixedSalarySystemOccurredDate()),
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

    if (await this.hasInsuranceStatusChangePossible(before, after)) {
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

  private async createAdminApprovedEvent(
    employeeId: string,
    eventType: EmployeeEventType,
    before: Employee | Record<string, unknown>,
    after: Employee | Record<string, unknown>,
    loginEmployeeId: string,
  ): Promise<string | null> {
    return this.eventService.createEventWithBaseId(employeeId, buildCurrentWorkMonthEventId(eventType), {
      occurredDate: Timestamp.now(),
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

  private getActualInsuranceStatus(detail?: { joined?: boolean; lostDate?: unknown }): InsuranceStatusKind {
    if (!detail) return 'notJoined';
    if (detail.joined) return 'joined';
    if (detail.lostDate) return 'lost';
    return 'notJoined';
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
        }))
        .sort((left, right) => left.dependentId.localeCompare(right.dependentId));

    return JSON.stringify(serialize(before)) !== JSON.stringify(serialize(after));
  }
}
