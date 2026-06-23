import { inject, Injectable } from '@angular/core';
import { Timestamp } from '@angular/fire/firestore';
import { EmployeeEventItem, EventService } from '../Firestore/event-service';
import { Event } from '../../model/event';
import { CalculationRunService, SystemCalculationRunItem } from '../Firestore/calculation-run-service';
import { EmployeeEventApprovalService } from './employee-event-approval.service';

const SCHEDULED_EVENT_TYPES = ['勤務状況変更', '固定給変更', '雇用形態変更', '扶養情報変更'] as const;

/**
 * 管理トップの「今月の申請一覧」完了判定。
 * 申請一覧画面に表示される承認待ち・反映待ちと同じ条件を使う。
 */
@Injectable({
  providedIn: 'root',
})
export class ApplicationTaskStatusService {

  private eventService = inject(EventService);
  private calculationRunService = inject(CalculationRunService);
  private employeeEventApprovalService = inject(EmployeeEventApprovalService);

  async isApplicationTaskComplete(): Promise<boolean> {
    const [hasPendingApprovals, hasPendingApplies] = await Promise.all([
      this.hasVisiblePendingApprovals(),
      this.hasVisiblePendingApplies(),
    ]);
    return !hasPendingApprovals && !hasPendingApplies;
  }

  private isVisibleEvent(event: EmployeeEventItem): boolean {
    return this.employeeEventApprovalService.canApproveEvent(event);
  }

  private isVisibleRun(run: SystemCalculationRunItem): boolean {
    return this.employeeEventApprovalService.canApproveSystemRun(run);
  }

  private filterVisibleRuns(runs: SystemCalculationRunItem[]): SystemCalculationRunItem[] {
    return runs.filter(run => this.isVisibleRun(run));
  }

  private isScheduledEvent(event: Event): boolean {
    return SCHEDULED_EVENT_TYPES.includes(event.eventType as typeof SCHEDULED_EVENT_TYPES[number])
      && event.applicantType !== '社員'
      && !(event.eventType === '扶養情報変更' && (event.lifeEventType === '入社' || event.lifeEventType === '退社'));
  }

  async hasVisiblePendingApprovals(): Promise<boolean> {
    const [
      events,
      fixedSalaryRuns,
      hireRuns,
      retireRuns,
      qualificationRuns,
      scheduledSystemRuns,
      employeeApplicationEvents,
    ] = await Promise.all([
      this.eventService.getAllPendingEventsForApproval(),
      this.calculationRunService.getPendingFixedSalaryRunsForApproval(),
      this.calculationRunService.getPendingHireQualificationRunsForApproval(),
      this.calculationRunService.getPendingRetireQualificationRunsForApproval(),
      this.calculationRunService.getPendingInsuranceChangeRunsForApproval(),
      this.calculationRunService.getPendingScheduledSystemRunsForApproval(),
      this.eventService.getAllPendingEmployeeApplicationEvents(),
    ]);

    const visibleEvents = events.filter(event => this.isVisibleEvent(event));
    if (visibleEvents.some(event => event.eventType === '一定年齢到達')) return true;
    if (visibleEvents.some(event => this.isScheduledEvent(event))) return true;
    if (employeeApplicationEvents.length > 0) return true;

    return this.filterVisibleRuns(fixedSalaryRuns).length > 0
      || this.filterVisibleRuns(hireRuns).length > 0
      || this.filterVisibleRuns(retireRuns).length > 0
      || this.filterVisibleRuns(qualificationRuns).length > 0
      || this.filterVisibleRuns(scheduledSystemRuns).length > 0;
  }

  async hasVisiblePendingApplies(): Promise<boolean> {
    const [
      applicableAdHocRevisions,
      approvedEmployeeApplicationEvents,
      approvedHireRuns,
      approvedRetireRuns,
      approvedQualificationRuns,
      approvedScheduledSystemRuns,
      approvedScheduledEvents,
    ] = await Promise.all([
      this.calculationRunService.getApplicableApprovedAdHocRevisionRuns(),
      this.eventService.getApprovedEmployeeApplicationEventsForCurrentWorkMonth(),
      this.calculationRunService.getApprovedHireQualificationRunsInWorkingPeriod(),
      this.calculationRunService.getApprovedRetireQualificationRunsInWorkingPeriod(),
      this.calculationRunService.getApprovedInsuranceChangeRunsInWorkingPeriod(),
      this.calculationRunService.getApprovedScheduledSystemRunsInWorkingPeriod(),
      this.eventService.getAllApprovedEventsInWorkingPeriod(event => this.isScheduledEvent(event)),
    ]);

    return applicableAdHocRevisions.length > 0
      || approvedEmployeeApplicationEvents.length > 0
      || approvedHireRuns.length > 0
      || approvedRetireRuns.length > 0
      || approvedQualificationRuns.length > 0
      || approvedScheduledSystemRuns.length > 0
      || approvedScheduledEvents.length > 0;
  }
}
