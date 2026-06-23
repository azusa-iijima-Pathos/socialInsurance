import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { EmployeeEventItem, EventService, compareEventsByAppliedDateDesc } from '../../../service/Firestore/event-service';
import { CalculationRunService, SystemCalculationRunItem } from '../../../service/Firestore/calculation-run-service';
import { EmployeeService } from '../../../service/Firestore/employee-service';
import { OfficeService } from '../../../service/Firestore/office-service';
import { CommonService } from '../../../service/common/common-service';
import { CorrectionLogicService } from '../../../service/logic/correction-logic.service';
import { EmployeeEventDisplayService } from '../../../service/logic/employee-event-display.service';
import { EmployeeEventApprovalService, InsuranceApprovalDraft } from '../../../service/logic/employee-event-approval.service';
import { decodeAppliedFromMonth, getWorkingYearMonth, isEmploymentChangeSystemRun } from '../../../service/logic/event-id-service';
import { SocialInsuranceFormCsvService } from '../../../service/CSV/social-insurance-form-csv.service';
import { Event } from '../../../model/event';

type InsuranceStatus = 'joined' | 'notJoined' | 'lost';
type MonthlyEventGroupingMode = 'occurred' | 'approved';

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
  private route = inject(ActivatedRoute);
  commonService = inject(CommonService);

  monthOptions = this.correctionLogicService.getMonthlyEventListMonthOptions(24);
  selectedMonthKey = `${getWorkingYearMonth().year}-${getWorkingYearMonth().month}`;
  groupingMode: MonthlyEventGroupingMode = 'occurred';

  /** 表示セクション用リスト（イベントデータ自体は変更しない） */
  hireEvents: EmployeeEventItem[] = [];
  retireEvents: EmployeeEventItem[] = [];
  fixedSalaryRuns: SystemCalculationRunItem[] = [];
  retireRuns: SystemCalculationRunItem[] = [];
  dependentChangeEvents: EmployeeEventItem[] = [];
  workStatusChangeEvents: EmployeeEventItem[] = [];
  insuranceRuns: SystemCalculationRunItem[] = [];
  employeeApplicationEvents: EmployeeEventItem[] = [];
  otherEvents: EmployeeEventItem[] = [];
  otherSystemRuns: SystemCalculationRunItem[] = [];

  detailModalOpen = false;
  detailModalEvent: EmployeeEventItem | null = null;
  insuranceHistoryDetailModalOpen = false;
  reviewingInsuranceHistoryRun: SystemCalculationRunItem | null = null;
  insuranceHistoryDraft: InsuranceApprovalDraft | null = null;

  async ngOnInit() {
    const grouping = this.route.snapshot.queryParamMap.get('grouping');
    if (grouping === 'approved') {
      this.groupingMode = 'approved';
    }
    await this.employeeService.getAllEmployees();
    await this.officeService.getAllOffice();
    await this.loadEvents();
  }

  async onMonthChange() {
    await this.loadEvents();
  }

  async setGroupingMode(mode: MonthlyEventGroupingMode) {
    if (this.groupingMode === mode) return;
    this.groupingMode = mode;
    await this.loadEvents();
  }

  getExportMonthKey(): string {
    return this.groupingMode === 'approved'
      ? `${this.selectedMonthKey}-approved`
      : this.selectedMonthKey;
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
    if (this.groupingMode === 'approved') {
      await this.loadEventsByApprovalMonth();
      return;
    }
    await this.loadEventsByOccurredMonth();
  }

  private async loadEventsByOccurredMonth() {
    const { year, month } = this.getSelectedYearMonth();
    const [events, systemRuns, insuranceRuns, employeeApplicationEvents] = await Promise.all([
      this.eventService.getAllEventsForTargetMonth(year, month),
      this.calculationRunService.getSystemRunsForTargetMonth(year, month),
      this.calculationRunService.getInsuranceChangeHistoryForTargetMonth(year, month),
      this.eventService.getAllPendingEmployeeApplicationEvents(),
    ]);
    this.assignEventSections(events, systemRuns, insuranceRuns, employeeApplicationEvents);
  }

  private async loadEventsByApprovalMonth() {
    const { year, month } = this.getSelectedYearMonth();
    const [events, systemRuns, insuranceRuns] = await Promise.all([
      this.eventService.getAllEventsForApprovalMonth(year, month),
      this.calculationRunService.getSystemRunsForApprovalMonth(year, month),
      this.calculationRunService.getInsuranceChangeHistoryForApprovalMonth(year, month),
    ]);
    this.assignEventSections(events, systemRuns, insuranceRuns, []);
  }

  private assignEventSections(
    events: EmployeeEventItem[],
    systemRuns: SystemCalculationRunItem[],
    insuranceRuns: SystemCalculationRunItem[],
    employeeApplicationEvents: EmployeeEventItem[],
  ) {
    const excludeRejected = this.groupingMode === 'approved';
    const visibleEvents = excludeRejected
      ? events.filter(event => event.approval?.approvalStatus !== '却下')
      : events;
    const visibleRuns = excludeRejected
      ? systemRuns.filter(run => run.approval?.approvalStatus !== '却下')
      : systemRuns;
    const visibleInsuranceRuns = excludeRejected
      ? insuranceRuns.filter(run => run.approval?.approvalStatus !== '却下')
      : insuranceRuns;

    const sortRuns = (runs: SystemCalculationRunItem[]) =>
      [...runs].sort((left, right) => (right.detectedDate?.toMillis() ?? 0) - (left.detectedDate?.toMillis() ?? 0));

    if (excludeRejected) {
      this.hireEvents = [];
      this.retireEvents = [];
      this.retireRuns = [];
      this.employeeApplicationEvents = [];
    } else {
      // 入社セクション
      this.hireEvents = visibleEvents
        .filter(event => event.eventType === '入社')
        .sort(compareEventsByAppliedDateDesc);

      // 退社セクション（イベント + calculationRun）
      this.retireEvents = visibleEvents
        .filter(event => event.eventType === '退社')
        .sort(compareEventsByAppliedDateDesc);
      this.retireRuns = sortRuns(visibleRuns.filter(run => run.eventType === '退社'));
      this.employeeApplicationEvents = employeeApplicationEvents;
    }

    // 随時改定（calculationRun の固定給変更のみ）
    this.fixedSalaryRuns = sortRuns(visibleRuns.filter(run => run.eventType === '固定給変更'));

    const isOtherSectionEvent = (event: EmployeeEventItem) =>
      event.eventType !== '入社' && event.eventType !== '退社';

    const isEmployeePendingApplication = (event: EmployeeEventItem) =>
      event.applicantType === '社員' && event.approval?.approvalStatus === '申請中';

    // 扶養情報変更
    this.dependentChangeEvents = visibleEvents
      .filter(event => event.eventType === '扶養情報変更' && !isEmployeePendingApplication(event))
      .sort(compareEventsByAppliedDateDesc);

    // 勤務状況変更
    this.workStatusChangeEvents = visibleEvents
      .filter(event => event.eventType === '勤務状況変更' && !isEmployeePendingApplication(event))
      .sort(compareEventsByAppliedDateDesc);

    this.insuranceRuns = visibleInsuranceRuns.filter(run => run.payload?.['source'] !== '保険情報変更');

    const insuranceRunIds = new Set(visibleInsuranceRuns.map(run => run.runId));

    // その他（入社・退社・扶養情報変更・勤務状況変更を除く）
    this.otherEvents = visibleEvents
      .filter(event =>
        isOtherSectionEvent(event)
        && event.eventType !== '扶養情報変更'
        && event.eventType !== '勤務状況変更'
        && !isEmployeePendingApplication(event),
      )
      .sort(compareEventsByAppliedDateDesc);

    this.otherSystemRuns = sortRuns(visibleRuns.filter(run =>
      run.eventType !== '退社'
      && run.eventType !== '固定給変更'
      && !insuranceRunIds.has(run.runId),
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

  async showInsuranceRunDetail(run: SystemCalculationRunItem) {
    if (run.type === '随時改定') {
      await this.showSystemRunDetail(run);
      return;
    }

    this.reviewingInsuranceHistoryRun = run;
    if (
      (run.type === 'その他' && run.runId?.startsWith('等級変更_'))
      || run.type === '算定基礎'
    ) {
      this.insuranceHistoryDraft = null;
      this.insuranceHistoryDetailModalOpen = true;
      return;
    }
    this.insuranceHistoryDraft = await this.employeeEventApprovalService.buildInsuranceChangeApprovalDraft(run);
    this.insuranceHistoryDetailModalOpen = true;
  }

  closeInsuranceHistoryDetail() {
    this.insuranceHistoryDetailModalOpen = false;
    this.reviewingInsuranceHistoryRun = null;
    this.insuranceHistoryDraft = null;
  }

  isEmploymentChangeRun(run: SystemCalculationRunItem): boolean {
    return isEmploymentChangeSystemRun(run);
  }

  getApprovalModalTypeLabel(): string {
    if (this.reviewingInsuranceHistoryRun) {
      return this.employeeEventApprovalService.getInsuranceChangeReasonLabel(this.reviewingInsuranceHistoryRun);
    }
    return '保険情報変更';
  }

  getInsuranceChangeDetectedDateLabel(run: SystemCalculationRunItem): string {
    const date = this.employeeEventApprovalService.getInsuranceChangeDetectedDate(run);
    return date ? this.commonService.formatDate(date) : '—';
  }

  getInsuranceChangeDetailItems(run: SystemCalculationRunItem, draft: InsuranceApprovalDraft) {
    return this.employeeEventApprovalService.getInsuranceChangeDetailItems(run, draft);
  }

  getInsuranceHistoryGradeChange(run: SystemCalculationRunItem): { before?: number; after?: number } {
    const payload = run.payload ?? {};
    return {
      before: payload['beforeGrade'] as number | undefined,
      after: payload['afterGrade'] as number | undefined,
    };
  }

  getInsuranceStatusLabel(status: InsuranceStatus): string {
    switch (status) {
      case 'joined': return '加入';
      case 'lost': return '喪失';
      default: return '未加入';
    }
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
    this.detailModalEvent = { ...eventView, employeeId: run.employeeId };
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
    if (event.changeType) {
      return event.lifeEventType ? `${event.changeType}（${event.lifeEventType}）` : event.changeType;
    }
    return event.lifeEventType ?? event.reachAgeType ?? '—';
  }

  getDependentChangeTypeLabel(event: Event): string {
    return event.changeType ?? '—';
  }

  getWorkStatusLeaveTypeLabel(event: Event): string {
    const after = event.payload?.['after'] as Record<string, unknown> | undefined;
    const before = event.payload?.['before'] as Record<string, unknown> | undefined;
    return String(after?.['leaveTypes'] ?? before?.['leaveTypes'] ?? '—');
  }

  getWorkStatusChangeTypeLabel(event: Event): string {
    return event.changeType ?? '—';
  }

  getDependentChangeReasonLabel(event: Event): string {
    return event.lifeEventType ?? '—';
  }

  getModalEmployeeSubtitle(employeeId?: string): string {
    if (!employeeId) return '';
    return `社員ID：${employeeId}　${this.getEmployeeName(employeeId)}`;
  }

  getInsuranceHistoryTypeLabel(run: SystemCalculationRunItem): string {
    return this.employeeEventApprovalService.getInsuranceChangeTypeLabel(run);
  }

  getInsuranceHistoryReasonLabel(run: SystemCalculationRunItem): string {
    return this.employeeEventApprovalService.getInsuranceChangeReasonLabel(run);
  }

  getInsuranceHistoryInsuranceLabel(run: SystemCalculationRunItem): string {
    if (run.runId?.startsWith('等級変更_')) return '等級';
    return this.employeeEventApprovalService.getInsuranceChangeLabel(run);
  }

  getInsuranceHistoryAppliedMonth(run: SystemCalculationRunItem): string {
    const appliedFromMonth = run.approval?.appliedFromMonth;
    if (appliedFromMonth == null) return '—';
    const { year, month } = decodeAppliedFromMonth(appliedFromMonth);
    return `${year}年${month}月`;
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

  isRejectedItem(item: { approval?: { approvalStatus?: string } }): boolean {
    return item.approval?.approvalStatus === '却下';
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
    await this.formCsvService.exportHireEventsCsv(this.hireEvents, this.getExportMonthKey());
  }

  async exportRetireCsv() {
    const approvedEvents = this.retireEvents.filter(item => item.approval?.approvalStatus === '承認済み');
    const approvedRuns = this.retireRuns.filter(item => item.approval?.approvalStatus === '承認済み');
    if (approvedEvents.length === 0 && approvedRuns.length === 0) {
      alert('承認済みの退社イベントがありません');
      return;
    }
    await this.formCsvService.exportApprovedRetireEventsCsv(this.retireEvents, this.retireRuns, this.getExportMonthKey());
  }

  async exportFixedSalaryCsv() {
    await this.exportFixedSalaryCsvByStatus('承認済み');
  }

  async exportAppliedFixedSalaryCsv() {
    await this.exportFixedSalaryCsvByStatus('適用済み');
  }

  private async exportFixedSalaryCsvByStatus(status: '承認済み' | '適用済み') {
    const targetRuns = this.fixedSalaryRuns.filter(item => item.approval?.approvalStatus === status);
    if (targetRuns.length === 0) {
      alert(`${status}の随時改定がありません`);
      return;
    }

    const enrichedRuns = await this.enrichFixedSalaryRuns(targetRuns);
    if (status === '適用済み') {
      await this.formCsvService.exportAppliedFixedSalaryCsv(enrichedRuns, this.getExportMonthKey());
      return;
    }
    await this.formCsvService.exportApprovedFixedSalaryCsv(enrichedRuns, this.getExportMonthKey());
  }

  private async enrichFixedSalaryRuns(runs: SystemCalculationRunItem[]) {
    return Promise.all(runs.map(async run => {
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
  }

  exportDependentAcquisitionCsv() {
    this.formCsvService.exportDependentChangeEventsCsv(
      this.dependentChangeEvents,
      this.getExportMonthKey(),
      '追加',
    );
  }

  exportDependentLossCsv() {
    this.formCsvService.exportDependentChangeEventsCsv(
      this.dependentChangeEvents,
      this.getExportMonthKey(),
      '削除',
    );
  }

  exportDependentChangeCsv() {
    this.formCsvService.exportDependentChangeEventsCsv(
      this.dependentChangeEvents,
      this.getExportMonthKey(),
      '変更',
    );
  }

  async exportMaternityLeaveCsv() {
    await this.formCsvService.exportMaternityLeaveCsv(this.workStatusChangeEvents, this.getExportMonthKey());
  }

  async exportParentalLeaveCsv() {
    await this.formCsvService.exportParentalLeaveCsv(this.workStatusChangeEvents, this.getExportMonthKey());
  }

  async exportInsuranceAcquisitionCsv() {
    await this.formCsvService.exportInsuranceAcquisitionCsv(this.insuranceRuns, this.getExportMonthKey());
  }

  async exportInsuranceLossCsv() {
    await this.formCsvService.exportInsuranceLossCsv(this.insuranceRuns, this.getExportMonthKey());
  }

  async exportInsuranceAcquisitionExcludingReachAgeCsv() {
    await this.formCsvService.exportInsuranceAcquisitionExcludingReachAgeCsv(this.insuranceRuns, this.getExportMonthKey());
  }

  async exportInsuranceLossExcludingReachAgeCsv() {
    await this.formCsvService.exportInsuranceLossExcludingReachAgeCsv(this.insuranceRuns, this.getExportMonthKey());
  }

}
