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
import { SocialInsuranceFormCsvService } from '../../../service/CSV/social-insurance-form-csv.service';
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
  private formCsvService = inject(SocialInsuranceFormCsvService);
  commonService = inject(CommonService);

  monthOptions = this.correctionLogicService.getPastYearMonthOptions(24);
  selectedMonthKey = `${getWorkingYearMonth().year}-${getWorkingYearMonth().month}`;

  /** 表示セクション用リスト（イベントデータ自体は変更しない） */
  hireEvents: EmployeeEventItem[] = [];
  retireEvents: EmployeeEventItem[] = [];
  fixedSalaryRuns: SystemCalculationRunItem[] = [];
  retireRuns: SystemCalculationRunItem[] = [];
  dependentChangeEvents: EmployeeEventItem[] = [];
  workStatusChangeEvents: EmployeeEventItem[] = [];
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

    const isOtherSectionEvent = (event: EmployeeEventItem) =>
      event.eventType !== '入社' && event.eventType !== '退社';

    // 扶養情報変更
    this.dependentChangeEvents = events
      .filter(event => event.eventType === '扶養情報変更')
      .sort(compareEventsByAppliedDateDesc);

    // 勤務状況変更
    this.workStatusChangeEvents = events
      .filter(event => event.eventType === '勤務状況変更')
      .sort(compareEventsByAppliedDateDesc);

    // その他（入社・退社・扶養情報変更・勤務状況変更を除く）
    this.otherEvents = events
      .filter(event =>
        isOtherSectionEvent(event)
        && event.eventType !== '扶養情報変更'
        && event.eventType !== '勤務状況変更',
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

  async exportHireCsv() {
    if (this.hireEvents.length === 0) {
      alert('入社イベントがありません');
      return;
    }
    await this.formCsvService.exportHireEventsCsv(this.hireEvents, this.selectedMonthKey);
  }

  async exportRetireCsv() {
    const approvedEvents = this.retireEvents.filter(item => item.approval?.approvalStatus === '承認済み');
    const approvedRuns = this.retireRuns.filter(item => item.approval?.approvalStatus === '承認済み');
    if (approvedEvents.length === 0 && approvedRuns.length === 0) {
      alert('承認済みの退社イベントがありません');
      return;
    }
    await this.formCsvService.exportApprovedRetireEventsCsv(this.retireEvents, this.retireRuns, this.selectedMonthKey);
  }

  async exportFixedSalaryCsv() {
    const approvedRuns = this.fixedSalaryRuns.filter(item => item.approval?.approvalStatus === '承認済み');
    if (approvedRuns.length === 0) {
      alert('承認済みの随時改定がありません');
      return;
    }

    const enrichedRuns = await Promise.all(approvedRuns.map(async run => {
      const eventView = this.calculationRunService.toEventView(run);
      const draft = await this.employeeEventApprovalService.buildFixedSalaryApprovalDraft(eventView);
      const storedSummary = (run.payload?.['revisionSummary'] ?? {}) as Record<string, unknown>;
      if (!draft) return run;

      return {
        ...run,
        payload: {
          ...run.payload,
          revisionSummary: {
            currentGrade: storedSummary['currentGrade'] ?? draft.currentGrade,
            approvedGrade: storedSummary['approvedGrade'] ?? draft.approvedGrade,
            averageSalary: storedSummary['averageSalary'] ?? draft.averageSalary,
          },
          targetPayrolls: run.payload?.['targetPayrolls'] ?? draft.targetPayrolls,
        },
      };
    }));

    await this.formCsvService.exportApprovedFixedSalaryCsv(enrichedRuns, this.selectedMonthKey);
  }

}
