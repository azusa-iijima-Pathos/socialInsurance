import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { EmployeeEventItem, EventService, compareEventsByAppliedDateDesc } from '../../../service/Firestore/event-service';
import { CalculationRunService, SystemCalculationRunItem } from '../../../service/Firestore/calculation-run-service';
import { EmployeeService } from '../../../service/Firestore/employee-service';
import { CommonService } from '../../../service/common/common-service';
import { CorrectionLogicService } from '../../../service/logic/correction-logic.service';
import { EmployeeEventDisplayService } from '../../../service/logic/employee-event-display.service';
import { getWorkingYearMonth } from '../../../service/logic/event-id-service';
import { Event } from '../../../model/event';

@Component({
  selector: 'app-monthly-event-list',
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './monthly-event-list.html',
  styleUrls: ['./monthly-event-list.css', '../employee-detail/employee-detail.css'],
})
export class MonthlyEventList {

  private eventService = inject(EventService);
  private calculationRunService = inject(CalculationRunService);
  private employeeService = inject(EmployeeService);
  private correctionLogicService = inject(CorrectionLogicService);
  private employeeEventDisplayService = inject(EmployeeEventDisplayService);
  commonService = inject(CommonService);

  monthOptions = this.correctionLogicService.getPastYearMonthOptions(24);
  selectedMonthKey = `${getWorkingYearMonth().year}-${getWorkingYearMonth().month}`;

  reachAgeEvents: EmployeeEventItem[] = [];
  fixedSalaryRuns: SystemCalculationRunItem[] = [];
  retireRuns: SystemCalculationRunItem[] = [];
  otherSystemRuns: SystemCalculationRunItem[] = [];
  employeeApplicationEvents: EmployeeEventItem[] = [];
  otherEvents: EmployeeEventItem[] = [];

  detailModalOpen = false;
  detailModalEvent: Event | null = null;

  async ngOnInit() {
    await this.employeeService.getAllEmployees();
    await this.loadEvents();
  }

  async onMonthChange() {
    await this.loadEvents();
  }

  get selectedMonthLabel(): string {
    const option = this.monthOptions.find(item => `${item.year}-${item.month}` === this.selectedMonthKey);
    return option?.label ?? this.selectedMonthKey;
  }

  private getSelectedYearMonth(): { year: number; month: number } {
    const [yearText, monthText] = this.selectedMonthKey.split('-');
    return { year: Number(yearText), month: Number(monthText) };
  }

  async loadEvents() {
    const { year, month } = this.getSelectedYearMonth();
    const [events, systemRuns] = await Promise.all([
      this.eventService.getAllEventsForTargetMonth(year, month),
      this.calculationRunService.getSystemRunsForTargetMonth(year, month),
    ]);

    const sortRuns = (runs: SystemCalculationRunItem[]) =>
      [...runs].sort((left, right) => (right.detectedDate?.toMillis() ?? 0) - (left.detectedDate?.toMillis() ?? 0));

    this.reachAgeEvents = events
      .filter(event => event.eventType === '一定年齢到達')
      .sort(compareEventsByAppliedDateDesc);
    this.fixedSalaryRuns = sortRuns(systemRuns.filter(run => run.eventType === '固定給変更'));
    this.retireRuns = sortRuns(systemRuns.filter(run => run.eventType === '退社'));
    this.otherSystemRuns = sortRuns(systemRuns.filter(run => run.eventType === '雇用形態変更'));
    this.employeeApplicationEvents = events
      .filter(event => event.applicantType === '社員' && event.eventType !== '一定年齢到達')
      .sort(compareEventsByAppliedDateDesc);
    this.otherEvents = events
      .filter(event =>
        event.applicantType !== '社員'
        && event.eventType !== '一定年齢到達'
        && event.applicantType !== 'システム',
      )
      .sort(compareEventsByAppliedDateDesc);
  }

  getEmployeeName(employeeId: string): string {
    return this.commonService.getEmployeeName(employeeId) ?? employeeId;
  }

  showEventDetail(event: EmployeeEventItem) {
    this.detailModalEvent = event;
    this.detailModalOpen = true;
  }

  showSystemRunDetail(run: SystemCalculationRunItem) {
    this.detailModalEvent = this.calculationRunService.toEventView(run);
    this.detailModalOpen = true;
  }

  closeDetail() {
    this.detailModalOpen = false;
    this.detailModalEvent = null;
  }

  getEmployeeEventChangeLines(event: Event): string[] {
    return this.employeeEventDisplayService.getChangeLines(event);
  }

  getReasonLabel(event: Event): string {
    return event.lifeEventType ?? event.reachAgeType ?? '—';
  }

  getApprovalStatus(event: { approval?: { approvalStatus?: string } }): string {
    return event.approval?.approvalStatus ?? '—';
  }

  getApproverName(event: Event): string {
    return this.commonService.getEmployeeName(event.approval?.approvedBy ?? '') || '—';
  }

  getApprovalDate(event: Event): string {
    return event.approval?.approvedDate
      ? this.commonService.formatDateTime(event.approval.approvedDate)
      : '—';
  }

  hasAnyEvents(): boolean {
    return this.reachAgeEvents.length > 0
      || this.fixedSalaryRuns.length > 0
      || this.retireRuns.length > 0
      || this.otherSystemRuns.length > 0
      || this.employeeApplicationEvents.length > 0
      || this.otherEvents.length > 0;
  }
}
