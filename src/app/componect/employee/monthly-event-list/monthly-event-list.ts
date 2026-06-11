import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { EmployeeEventItem, EventService, compareEventsByAppliedDateDesc } from '../../../service/Firestore/event-service';
import { CalculationRunService, SystemCalculationRunItem } from '../../../service/Firestore/calculation-run-service';
import { EmployeeService } from '../../../service/Firestore/employee-service';
import { OfficeService } from '../../../service/Firestore/office-service';
import { CommonService } from '../../../service/common/common-service';
import { CorrectionLogicService } from '../../../service/logic/correction-logic.service';
import { EmployeeEventDisplayService } from '../../../service/logic/employee-event-display.service';
import { EmployeeEventApprovalService } from '../../../service/logic/employee-event-approval.service';
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
  private officeService = inject(OfficeService);
  private correctionLogicService = inject(CorrectionLogicService);
  private employeeEventDisplayService = inject(EmployeeEventDisplayService);
  private employeeEventApprovalService = inject(EmployeeEventApprovalService);
  commonService = inject(CommonService);

  monthOptions = this.correctionLogicService.getPastYearMonthOptions(24);
  selectedMonthKey = `${getWorkingYearMonth().year}-${getWorkingYearMonth().month}`;

  /** 表示セクション用リスト（イベントデータ自体は変更しない） */
  hireEvents: EmployeeEventItem[] = [];
  retireEvents: EmployeeEventItem[] = [];
  fixedSalaryRuns: SystemCalculationRunItem[] = [];
  retireRuns: SystemCalculationRunItem[] = [];
  employeeApplicationEvents: EmployeeEventItem[] = [];
  otherEvents: EmployeeEventItem[] = [];
  otherSystemRuns: SystemCalculationRunItem[] = [];

  detailModalOpen = false;
  detailModalEvent: Event | null = null;

  async ngOnInit() {
    await this.employeeService.getAllEmployees();
    await this.officeService.getAllOffice();
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

    // 入社セクション
    this.hireEvents = events
      .filter(event => event.eventType === '入社')
      .sort(compareEventsByAppliedDateDesc);

    // 退社セクション（イベント + calculationRun）
    this.retireEvents = events
      .filter(event => event.eventType === '退社')
      .sort(compareEventsByAppliedDateDesc);
    this.retireRuns = sortRuns(systemRuns.filter(run => run.eventType === '退社'));

    // 随時改定（calculationRun の固定給変更のみ）
    this.fixedSalaryRuns = sortRuns(systemRuns.filter(run => run.eventType === '固定給変更'));

    // 従業員からの申請
    this.employeeApplicationEvents = events
      .filter(event => event.applicantType === '社員' && event.eventType !== '一定年齢到達' && event.eventType !== '入社')
      .sort(compareEventsByAppliedDateDesc);

    // その他（入社・退社・従業員申請を除く）
    this.otherEvents = events
      .filter(event =>
        event.eventType !== '入社'
        && event.eventType !== '退社'
        && event.applicantType !== '社員'
        && (event.eventType === '一定年齢到達' || event.applicantType !== 'システム'),
      )
      .sort(compareEventsByAppliedDateDesc);

    this.otherSystemRuns = sortRuns(systemRuns.filter(run =>
      run.eventType !== '退社' && run.eventType !== '固定給変更',
    ));
  }

  getEmployeeName(employeeId: string): string {
    return this.commonService.getEmployeeName(employeeId) ?? employeeId;
  }

  canShowEventDetail(event: Event): boolean {
    return event.eventType !== '退社' && event.eventType !== '一定年齢到達';
  }

  showEventDetail(event: EmployeeEventItem) {
    this.detailModalEvent = event;
    this.detailModalOpen = true;
  }

  async showSystemRunDetail(run: SystemCalculationRunItem) {
    let eventView = this.calculationRunService.toEventView(run);
    if (run.eventType === '固定給変更' && !run.payload?.['revisionSummary']) {
      const draft = await this.employeeEventApprovalService.buildFixedSalaryApprovalDraft(eventView);
      if (draft) {
        eventView = {
          ...eventView,
          payload: {
            ...eventView.payload,
            revisionSummary: {
              currentGrade: draft.currentGrade,
              approvedGrade: draft.approvedGrade,
              averageSalary: draft.averageSalary,
            },
          },
        };
      }
    }
    this.detailModalEvent = eventView;
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

  getOtherEventTypeLabel(event: Event): string {
    if (event.eventType === '一定年齢到達') {
      return `一定年齢到達（${event.reachAgeType ?? '—'}）`;
    }
    return event.eventType ?? '—';
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

}
