import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { EmployeeEventItem, EventService, compareEventsByAppliedDateDesc, compareEventsByOccurredDateAsc } from '../../../service/Firestore/event-service';
import { CalculationRunService, SystemCalculationRunItem } from '../../../service/Firestore/calculation-run-service';
import { EmployeeService } from '../../../service/Firestore/employee-service';
import { CommonService, MessageTimer } from '../../../service/common/common-service';
import { EmployeeDetailEventService } from '../../../service/logic/employee-detail-event-service';
import {
  EmployeeEventApprovalService,
  FixedSalaryApprovalDraft,
  HireInsuranceApprovalDraft,
  HireInsuranceDetailView,
  InsuranceApprovalDraft,
  RetireInsuranceDetailView,
} from '../../../service/logic/employee-event-approval.service';
import { EmployeeEventDisplayService } from '../../../service/logic/employee-event-display.service';
import { isEmploymentChangeSystemRun, isPriorMonthUnprocessedId } from '../../../service/logic/event-id-service';
import { TempEmployeeService } from '../../../service/Firestore/temp-employee-service';
import {
  DISABILITY_STATUSES,
  DISABILITY_TYPES,
  STUDENT_STATUSES,
  STUDENT_TYPES,
} from '../../../constants/model-constants';

type InsuranceStatus = 'joined' | 'notJoined' | 'lost';

const SCHEDULED_EVENT_TYPES = ['勤務状況変更', '固定給変更', '雇用形態変更', '扶養情報変更'] as const;

@Component({
  selector: 'app-system-application-list',
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './system-application-list.html',
  styleUrls: ['./system-application-list.css', '../employee-detail/employee-detail.css'],
})
export class SystemApplicationList {

  private eventService = inject(EventService);
  private calculationRunService = inject(CalculationRunService);
  private employeeService = inject(EmployeeService);
  private employeeDetailEventService = inject(EmployeeDetailEventService);
  private employeeEventApprovalService = inject(EmployeeEventApprovalService);
  private employeeEventDisplayService = inject(EmployeeEventDisplayService);
  commonService = inject(CommonService);
  private router = inject(Router);
  private tempEmployeeService = inject(TempEmployeeService);

  loginEmployeeId = sessionStorage.getItem('loginEmployeeId') ?? '';
  workingYear = Number(sessionStorage.getItem('workingYear'));
  workingMonth = Number(sessionStorage.getItem('workingMonth'));

  DISABILITY_STATUSES = DISABILITY_STATUSES;
  DISABILITY_TYPES = DISABILITY_TYPES;
  STUDENT_STATUSES = STUDENT_STATUSES;
  STUDENT_TYPES = STUDENT_TYPES;

  reachAgeEvents: EmployeeEventItem[] = [];
  fixedSalaryRuns: SystemCalculationRunItem[] = [];
  approvedFixedSalaryRuns: SystemCalculationRunItem[] = [];
  hireRuns: SystemCalculationRunItem[] = [];
  approvedHireRuns: SystemCalculationRunItem[] = [];
  canBulkApplyFixedSalary = false;
  canBulkApplyHire = false;
  canBulkApplyRetire = false;
  canBulkApplyQualification = false;
  canBulkApplyScheduled = false;
  applicableAdHocRevisions: SystemCalculationRunItem[] = [];
  retireRuns: SystemCalculationRunItem[] = [];
  approvedRetireRuns: SystemCalculationRunItem[] = [];
  qualificationRuns: SystemCalculationRunItem[] = [];
  approvedQualificationRuns: SystemCalculationRunItem[] = [];
  scheduledSystemRuns: SystemCalculationRunItem[] = [];
  approvedScheduledSystemRuns: SystemCalculationRunItem[] = [];
  scheduledEvents: EmployeeEventItem[] = [];
  approvedScheduledEvents: EmployeeEventItem[] = [];
  employeeApplicationEvents: EmployeeEventItem[] = [];
  approvedEmployeeApplicationEvents: EmployeeEventItem[] = [];
  hasScheduledHireApprovalRemaining = false;
  hasScheduledRetireApprovalRemaining = false;

  selectedReachAge = new Set<string>();
  selectedRetire = new Set<string>();
  selectedHire = new Set<string>();
  selectedAdHocRevisions = new Set<string>();
  selectedApprovedEmployeeApps = new Set<string>();
  selectedApprovedHireRuns = new Set<string>();
  selectedApprovedRetireRuns = new Set<string>();
  selectedApprovedQualificationRuns = new Set<string>();
  selectedApprovedScheduledRuns = new Set<string>();
  selectedApprovedScheduledEvents = new Set<string>();

  adHocApplyModalOpen = false;
  hireApplyModalOpen = false;
  retireApplyModalOpen = false;
  qualificationApplyModalOpen = false;
  scheduledApplyModalOpen = false;
  employeeApplyModalOpen = false;
  reviewingApprovedEmployeeEvent: EmployeeEventItem | null = null;

  scheduledReviewModalOpen = false;
  reviewingScheduledEvent: EmployeeEventItem | null = null;
  reviewingScheduledSystemRun: SystemCalculationRunItem | null = null;

  approvalModalOpen = false;
  approvalModalType: 'fixedSalary' | 'insurance' | null = null;
  approvingEvent: EmployeeEventItem | null = null;
  approvingSystemRun: SystemCalculationRunItem | null = null;
  fixedSalaryDraft: FixedSalaryApprovalDraft | null = null;
  insuranceDraft: InsuranceApprovalDraft | null = null;
  insuranceApprovalChangeDate = '';
  insuranceApprovalValidationError = '';

  insuranceHistoryDetailModalOpen = false;
  reviewingInsuranceHistoryRun: SystemCalculationRunItem | null = null;
  insuranceHistoryDraft: InsuranceApprovalDraft | null = null;

  employeeReviewModalOpen = false;
  reviewingEmployeeEvent: EmployeeEventItem | null = null;

  hireDetailModalOpen = false;
  reviewingHireRun: SystemCalculationRunItem | null = null;
  hireApprovalDraft: HireInsuranceApprovalDraft | null = null;
  hireApprovalValidationError = '';

  retireDetailModalOpen = false;
  reviewingRetireRun: SystemCalculationRunItem | null = null;
  retireInsuranceDetail: RetireInsuranceDetailView | null = null;

  message = '';
  private messageTimer: MessageTimer = null;

  async ngOnInit() {
    await this.employeeService.getAllEmployees();
    await this.loadEvents();
  }

  async loadEvents() {
    const events = await this.eventService.getAllPendingEventsForApproval();
    const sortRuns = (runs: SystemCalculationRunItem[]) =>
      [...runs].sort((left, right) => (right.detectedDate?.toMillis() ?? 0) - (left.detectedDate?.toMillis() ?? 0));
    const visibleRuns = (runs: SystemCalculationRunItem[]) =>
      sortRuns(runs.filter(run => this.isPendingListVisibleRun(run)));
    const visibleEvents = (items: EmployeeEventItem[]) =>
      items.filter(event => this.isPendingListVisibleEvent(event));

    this.reachAgeEvents = visibleEvents(events
      .filter(event => event.eventType === '一定年齢到達'))
      .sort(compareEventsByAppliedDateDesc);
    this.fixedSalaryRuns = visibleRuns(await this.calculationRunService.getPendingFixedSalaryRunsForApproval());
    this.approvedFixedSalaryRuns = sortRuns(await this.calculationRunService.getApplicableApprovedAdHocRevisionRuns());
    this.hireRuns = visibleRuns(await this.calculationRunService.getPendingHireQualificationRunsForApproval());
    this.approvedHireRuns = sortRuns(await this.calculationRunService.getApprovedHireQualificationRunsInWorkingPeriod());
    this.retireRuns = visibleRuns(await this.calculationRunService.getPendingRetireQualificationRunsForApproval());
    this.approvedRetireRuns = sortRuns(await this.calculationRunService.getApprovedRetireQualificationRunsInWorkingPeriod());
    this.qualificationRuns = visibleRuns(await this.calculationRunService.getPendingEmploymentChangeRunsForApproval());
    this.approvedQualificationRuns = sortRuns(await this.calculationRunService.getApprovedEmploymentChangeRunsInWorkingPeriod());
    this.scheduledSystemRuns = visibleRuns(await this.calculationRunService.getPendingScheduledSystemRunsForApproval());
    this.approvedScheduledSystemRuns = sortRuns(await this.calculationRunService.getApprovedScheduledSystemRunsInWorkingPeriod());
    this.scheduledEvents = visibleEvents(events
      .filter(event =>
        SCHEDULED_EVENT_TYPES.includes(event.eventType as typeof SCHEDULED_EVENT_TYPES[number])
        && event.applicantType !== '社員'
        && !(event.eventType === '扶養情報変更' && (event.lifeEventType === '入社' || event.lifeEventType === '退社')),
      ))
      .sort(compareEventsByAppliedDateDesc);
    this.approvedScheduledEvents = (await this.eventService.getAllApprovedEventsInWorkingPeriod(event =>
      SCHEDULED_EVENT_TYPES.includes(event.eventType as typeof SCHEDULED_EVENT_TYPES[number])
      && event.applicantType !== '社員'
      && !(event.eventType === '扶養情報変更' && (event.lifeEventType === '入社' || event.lifeEventType === '退社')),
    )).sort(compareEventsByAppliedDateDesc);
    this.employeeApplicationEvents = await this.eventService.getAllPendingEmployeeApplicationEvents();
    this.approvedEmployeeApplicationEvents = await this.eventService.getApprovedEmployeeApplicationEventsForCurrentWorkMonth();
    this.selectedReachAge.clear();
    this.selectedRetire.clear();
    this.selectedHire.clear();
    this.selectedAdHocRevisions.clear();
    this.selectedApprovedEmployeeApps.clear();
    this.applicableAdHocRevisions = await this.calculationRunService.getApplicableApprovedAdHocRevisionRuns();
    this.canBulkApplyFixedSalary = this.approvedFixedSalaryRuns.length > 0;
    this.canBulkApplyHire = this.approvedHireRuns.length > 0;
    this.canBulkApplyRetire = this.approvedRetireRuns.length > 0;
    this.canBulkApplyQualification = this.approvedQualificationRuns.length > 0;
    this.canBulkApplyScheduled = this.approvedScheduledEvents.length > 0 || this.approvedScheduledSystemRuns.length > 0;
    await this.loadScheduledHireRetireStatus();
  }

  private async loadScheduledHireRetireStatus() {
    const temps = await this.tempEmployeeService.getAllTempEmployees();
    this.hasScheduledHireApprovalRemaining = temps.some(temp =>
      !!temp.hireDate && this.employeeEventApprovalService.canApproveByOccurrenceDateOrInWorkingPeriod(temp.hireDate),
    );
    await this.employeeService.getAllEmployees(true);
    this.hasScheduledRetireApprovalRemaining = this.employeeService.allEmployees().some(employee =>
      employee.workStatus === '退社予定'
      && !!employee.resignationDate
      && this.employeeEventApprovalService.canApproveByOccurrenceDateOrInWorkingPeriod(employee.resignationDate),
    );
  }

  hasPendingApplications(): boolean {
    return this.reachAgeEvents.length > 0
      || this.fixedSalaryRuns.length > 0
      || this.hireRuns.length > 0
      || this.retireRuns.length > 0
      || this.qualificationRuns.length > 0
      || this.scheduledSystemRuns.length > 0
      || this.scheduledEvents.length > 0
      || this.employeeApplicationEvents.length > 0;
  }

  canApproveEventByDate(event: EmployeeEventItem): boolean {
    return this.employeeEventApprovalService.canApproveEvent(event);
  }

  canApplyEvent(event: EmployeeEventItem): boolean {
    return this.employeeEventApprovalService.canApplyEventInWorkingPeriod(event);
  }

  canApplyRun(run: SystemCalculationRunItem): boolean {
    return this.employeeEventApprovalService.canApplyRunInWorkingPeriod(run);
  }

  canApproveHireRun(run: SystemCalculationRunItem): boolean {
    return this.employeeEventApprovalService.canApproveHireInsuranceRun(run);
  }

  async canApproveRetireRun(run: SystemCalculationRunItem): Promise<boolean> {
    return this.employeeEventApprovalService.canApproveRetireInsuranceRun(run);
  }

  canApproveQualificationRun(run: SystemCalculationRunItem): boolean {
    return this.employeeEventApprovalService.canApproveEmploymentChangeRun(run);
  }

  canApproveRunByOccurrenceDate(run: SystemCalculationRunItem): boolean {
    return this.employeeEventApprovalService.canApproveSystemRun(run);
  }

  /** 申請一覧に表示するか（従業員申請以外は発生日が今日以前、または作業対象期間内） */
  private isPendingListVisibleEvent(event: EmployeeEventItem): boolean {
    return this.employeeEventApprovalService.canApproveEvent(event);
  }

  private isPendingListVisibleRun(run: SystemCalculationRunItem): boolean {
    if (run.type === '資格取得' && run.payload?.['source'] === '入社') {
      return true;
    }
    if (run.type === '資格喪失' && run.payload?.['source'] === '退社') {
      return true;
    }
    return this.employeeEventApprovalService.canApproveSystemRun(run);
  }

  private async applySystemRunQuiet(run: SystemCalculationRunItem): Promise<boolean> {
    if (run.type === '随時改定') {
      const { appliedCount } = await this.employeeEventApprovalService.applySelectedAdHocRevisions(
        [run.runId],
        this.loginEmployeeId,
      );
      return appliedCount > 0;
    }
    return this.employeeEventApprovalService.applySystemRun(run, this.loginEmployeeId);
  }

  private async applyEventQuiet(event: EmployeeEventItem): Promise<boolean> {
    if (event.eventType === '退社') {
      return this.employeeEventApprovalService.applyRetireEvent(event.employeeId, event, this.loginEmployeeId);
    }
    if (event.applicantType === '社員') {
      return this.employeeEventApprovalService.applyApprovedEmployeeApplicationEvent(
        event.employeeId,
        event,
        this.loginEmployeeId,
      );
    }
    return this.employeeEventApprovalService.applySimpleEvent(event.employeeId, event, this.loginEmployeeId);
  }

  openHireApplyModal() {
    this.selectedApprovedHireRuns.clear();
    this.approvedHireRuns.forEach(run => this.selectedApprovedHireRuns.add(this.getSystemRunKey(run)));
    this.hireApplyModalOpen = true;
  }

  closeHireApplyModal() {
    this.hireApplyModalOpen = false;
    this.selectedApprovedHireRuns.clear();
  }

  toggleApprovedHireRun(run: SystemCalculationRunItem, checked: boolean) {
    const key = this.getSystemRunKey(run);
    if (checked) this.selectedApprovedHireRuns.add(key);
    else this.selectedApprovedHireRuns.delete(key);
  }

  async applySelectedApprovedHireRuns() {
    if (this.selectedApprovedHireRuns.size === 0) return;
    if (!window.confirm('選択した入社時保険情報を従業員情報に反映しますか？')) return;

    let count = 0;
    for (const key of this.selectedApprovedHireRuns) {
      const run = this.approvedHireRuns.find(item => this.getSystemRunKey(item) === key);
      if (!run || !this.canApplyRun(run)) continue;
      const applied = await this.applySystemRunQuiet(run);
      if (applied) count++;
    }

    if (count > 0) {
      await this.employeeService.getAllEmployees(true);
      this.showMessage(`${count}件を反映しました`);
      this.closeHireApplyModal();
      await this.loadEvents();
    } else {
      this.showMessage('反映に失敗しました');
    }
  }

  openRetireApplyModal() {
    this.selectedApprovedRetireRuns.clear();
    this.approvedRetireRuns.forEach(run => this.selectedApprovedRetireRuns.add(this.getSystemRunKey(run)));
    this.retireApplyModalOpen = true;
  }

  closeRetireApplyModal() {
    this.retireApplyModalOpen = false;
    this.selectedApprovedRetireRuns.clear();
  }

  toggleApprovedRetireRun(run: SystemCalculationRunItem, checked: boolean) {
    const key = this.getSystemRunKey(run);
    if (checked) this.selectedApprovedRetireRuns.add(key);
    else this.selectedApprovedRetireRuns.delete(key);
  }

  async applySelectedApprovedRetireRuns() {
    if (this.selectedApprovedRetireRuns.size === 0) return;
    if (!window.confirm('選択した退社時保険喪失を従業員情報に反映しますか？')) return;

    let count = 0;
    for (const key of this.selectedApprovedRetireRuns) {
      const run = this.approvedRetireRuns.find(item => this.getSystemRunKey(item) === key);
      if (!run || !this.canApplyRun(run)) continue;
      const applied = await this.applySystemRunQuiet(run);
      if (applied) count++;
    }

    if (count > 0) {
      await this.employeeService.getAllEmployees(true);
      this.showMessage(`${count}件を反映しました`);
      this.closeRetireApplyModal();
      await this.loadEvents();
    } else {
      this.showMessage('反映に失敗しました');
    }
  }

  openQualificationApplyModal() {
    this.selectedApprovedQualificationRuns.clear();
    this.approvedQualificationRuns.forEach(run => this.selectedApprovedQualificationRuns.add(this.getSystemRunKey(run)));
    this.qualificationApplyModalOpen = true;
  }

  closeQualificationApplyModal() {
    this.qualificationApplyModalOpen = false;
    this.selectedApprovedQualificationRuns.clear();
  }

  toggleApprovedQualificationRun(run: SystemCalculationRunItem, checked: boolean) {
    const key = this.getSystemRunKey(run);
    if (checked) this.selectedApprovedQualificationRuns.add(key);
    else this.selectedApprovedQualificationRuns.delete(key);
  }

  async applySelectedApprovedQualificationRuns() {
    if (this.selectedApprovedQualificationRuns.size === 0) return;
    if (!window.confirm('選択した資格取得/喪失を従業員情報に反映しますか？')) return;

    let count = 0;
    for (const key of this.selectedApprovedQualificationRuns) {
      const run = this.approvedQualificationRuns.find(item => this.getSystemRunKey(item) === key);
      if (!run || !this.canApplyRun(run)) continue;
      const applied = await this.applySystemRunQuiet(run);
      if (applied) count++;
    }

    if (count > 0) {
      await this.employeeService.getAllEmployees(true);
      this.showMessage(`${count}件を反映しました`);
      this.closeQualificationApplyModal();
      await this.loadEvents();
    } else {
      this.showMessage('反映に失敗しました');
    }
  }

  openScheduledApplyModal() {
    this.selectedApprovedScheduledRuns.clear();
    this.selectedApprovedScheduledEvents.clear();
    this.approvedScheduledSystemRuns.forEach(run => this.selectedApprovedScheduledRuns.add(this.getSystemRunKey(run)));
    this.approvedScheduledEvents.forEach(event => this.selectedApprovedScheduledEvents.add(this.getEventKey(event)));
    this.scheduledApplyModalOpen = true;
  }

  closeScheduledApplyModal() {
    this.scheduledApplyModalOpen = false;
    this.selectedApprovedScheduledRuns.clear();
    this.selectedApprovedScheduledEvents.clear();
  }

  toggleApprovedScheduledRun(run: SystemCalculationRunItem, checked: boolean) {
    const key = this.getSystemRunKey(run);
    if (checked) this.selectedApprovedScheduledRuns.add(key);
    else this.selectedApprovedScheduledRuns.delete(key);
  }

  toggleApprovedScheduledEvent(event: EmployeeEventItem, checked: boolean) {
    const key = this.getEventKey(event);
    if (checked) this.selectedApprovedScheduledEvents.add(key);
    else this.selectedApprovedScheduledEvents.delete(key);
  }

  async applySelectedApprovedScheduledItems() {
    if (this.selectedApprovedScheduledRuns.size === 0 && this.selectedApprovedScheduledEvents.size === 0) return;
    if (!window.confirm('選択した予定登録イベントを従業員情報に反映しますか？')) return;

    const eventsToApply = [...this.selectedApprovedScheduledEvents]
      .map(key => this.approvedScheduledEvents.find(item => this.getEventKey(item) === key))
      .filter((event): event is EmployeeEventItem => !!event && this.canApplyEvent(event))
      .sort(compareEventsByOccurredDateAsc);

    let count = 0;
    for (const event of eventsToApply) {
      const applied = await this.applyEventQuiet(event);
      if (applied) count++;
    }
    for (const key of this.selectedApprovedScheduledRuns) {
      const run = this.approvedScheduledSystemRuns.find(item => this.getSystemRunKey(item) === key);
      if (!run || !this.canApplyRun(run)) continue;
      const applied = await this.applySystemRunQuiet(run);
      if (applied) count++;
    }

    if (count > 0) {
      await this.employeeService.getAllEmployees(true);
      this.showMessage(`${count}件を反映しました`);
      this.closeScheduledApplyModal();
      await this.loadEvents();
    } else {
      this.showMessage('反映に失敗しました');
    }
  }

  isPriorMonthUnprocessed(id: string): boolean {
    return isPriorMonthUnprocessedId(id, this.workingYear, this.workingMonth);
  }

  getAdHocRevisionPreviousGrade(run: SystemCalculationRunItem): number {
    const summary = run.payload?.['revisionSummary'] as { currentGrade?: number } | undefined;
    if (summary?.currentGrade != null) return Number(summary.currentGrade);
    const after = run.payload?.['after'] as { insurance?: { currentGrade?: number } } | undefined;
    return after?.insurance?.currentGrade ?? 0;
  }

  getAdHocRevisionApprovedGrade(run: SystemCalculationRunItem): number {
    const summary = run.payload?.['revisionSummary'] as { approvedGrade?: number } | undefined;
    if (summary?.approvedGrade != null) return Number(summary.approvedGrade);
    return this.getAdHocRevisionPreviousGrade(run);
  }

  openAdHocApplyModal() {
    this.selectedAdHocRevisions.clear();
    this.applicableAdHocRevisions.forEach(run => this.selectedAdHocRevisions.add(run.runId));
    this.adHocApplyModalOpen = true;
  }

  closeAdHocApplyModal() {
    this.adHocApplyModalOpen = false;
    this.selectedAdHocRevisions.clear();
  }

  toggleAdHocRevision(run: SystemCalculationRunItem, checked: boolean) {
    if (checked) this.selectedAdHocRevisions.add(run.runId);
    else this.selectedAdHocRevisions.delete(run.runId);
  }

  async applySelectedAdHocRevisions() {
    if (this.selectedAdHocRevisions.size === 0) return;
    if (!window.confirm('選択した随時改定を従業員情報に適用しますか？')) return;

    const { appliedCount } = await this.employeeEventApprovalService.applySelectedAdHocRevisions(
      [...this.selectedAdHocRevisions],
      this.loginEmployeeId,
    );
    if (appliedCount > 0) {
      await this.employeeService.getAllEmployees(true);
      this.showMessage(`${appliedCount}件の随時改定を反映しました`);
      this.closeAdHocApplyModal();
      await this.loadEvents();
    } else {
      this.showMessage('適用に失敗しました');
    }
  }

  openEmployeeApplyModal() {
    this.selectedApprovedEmployeeApps.clear();
    this.approvedEmployeeApplicationEvents.forEach(event => this.selectedApprovedEmployeeApps.add(this.getEventKey(event)));
    this.employeeApplyModalOpen = true;
  }

  closeEmployeeApplyModal() {
    this.employeeApplyModalOpen = false;
    this.reviewingApprovedEmployeeEvent = null;
    this.selectedApprovedEmployeeApps.clear();
  }

  toggleApprovedEmployeeApp(event: EmployeeEventItem, checked: boolean) {
    const key = this.getEventKey(event);
    if (checked) this.selectedApprovedEmployeeApps.add(key);
    else this.selectedApprovedEmployeeApps.delete(key);
  }

  openApprovedEmployeeDetail(event: EmployeeEventItem) {
    this.reviewingApprovedEmployeeEvent = event;
  }

  async applySelectedApprovedEmployeeEvents() {
    if (this.selectedApprovedEmployeeApps.size === 0) return;
    if (!window.confirm('選択した承認済みイベントを適用しますか？')) return;

    let count = 0;
    for (const key of this.selectedApprovedEmployeeApps) {
      const event = this.approvedEmployeeApplicationEvents.find(item => this.getEventKey(item) === key);
      if (!event) continue;
      const applied = await this.employeeEventApprovalService.applyApprovedEmployeeApplicationEvent(
        event.employeeId,
        event,
        this.loginEmployeeId,
      );
      if (applied) count++;
    }

    if (count > 0) {
      await this.employeeService.getAllEmployees(true);
      this.showMessage(`${count}件のイベントを反映しました`);
      this.closeEmployeeApplyModal();
      await this.loadEvents();
    } else {
      this.showMessage('適用に失敗しました');
    }
  }

  openScheduledEventReview(event: EmployeeEventItem) {
    this.reviewingScheduledEvent = event;
    this.reviewingScheduledSystemRun = null;
    this.scheduledReviewModalOpen = true;
  }

  openScheduledSystemRunReview(run: SystemCalculationRunItem) {
    if (this.calculationRunService.isInsuranceInfoChangeRun(run)) {
      void this.openQualificationReviewAsync(run);
      return;
    }
    this.reviewingScheduledSystemRun = run;
    this.reviewingScheduledEvent = null;
    this.scheduledReviewModalOpen = true;
  }

  closeScheduledReview() {
    this.scheduledReviewModalOpen = false;
    this.reviewingScheduledEvent = null;
    this.reviewingScheduledSystemRun = null;
  }

  async approveScheduledReview() {
    if (this.reviewingScheduledSystemRun) {
      await this.onApproveSystemRun(this.reviewingScheduledSystemRun);
      this.closeScheduledReview();
      return;
    }
    if (!this.reviewingScheduledEvent) return;

    const event = this.reviewingScheduledEvent;
    if (!this.canApproveEventByDate(event)) {
      this.showMessage('イベント発生日以降に承認できます');
      return;
    }

    let approved = false;
    if (event.eventType === '固定給変更') {
      approved = await this.employeeEventApprovalService.approveAdminFixedSalaryEvent(event.employeeId, event, this.loginEmployeeId);
    } else if (event.eventType === '雇用形態変更') {
      approved = await this.employeeEventApprovalService.approveAdminEmploymentChangeEvent(event.employeeId, event, this.loginEmployeeId);
    } else if (event.eventType === '勤務状況変更') {
      approved = await this.employeeEventApprovalService.approveAdminWorkStatusEvent(event.employeeId, event, this.loginEmployeeId);
    } else if (event.eventType === '扶養情報変更') {
      approved = await this.employeeEventApprovalService.approveAdminDependentChangeEvent(event.employeeId, event, this.loginEmployeeId);
    }

    if (approved) {
      this.showMessage('予定登録イベントを承認しました（反映は作業期間内に行ってください）');
      this.closeScheduledReview();
      await this.loadEvents();
    } else {
      this.showMessage('承認に失敗しました');
    }
  }

  async rejectScheduledReview() {
    if (this.reviewingScheduledSystemRun) {
      await this.onRejectSystemRun(this.reviewingScheduledSystemRun);
      this.closeScheduledReview();
      return;
    }
    if (!this.reviewingScheduledEvent) return;
    await this.onRejectEvent(this.reviewingScheduledEvent);
    this.closeScheduledReview();
  }

  openQualificationReview(run: SystemCalculationRunItem) {
    void this.openQualificationReviewAsync(run);
  }

  private async openQualificationReviewAsync(run: SystemCalculationRunItem) {
    if (this.calculationRunService.isInsuranceInfoChangeRun(run)) {
      await this.openInsuranceChangeHistoryApprovalModal(run);
      return;
    }

    this.approvingSystemRun = run;
    this.insuranceDraft = await this.employeeEventApprovalService.buildInsuranceChangeApprovalDraft(run);
    this.approvalModalType = 'insurance';
    this.insuranceApprovalChangeDate = this.formatDateInput(run.detectedDate?.toDate()) || this.formatDateInput(new Date());
    this.insuranceApprovalValidationError = '';
    this.approvalModalOpen = true;
  }

  private async openInsuranceChangeHistoryApprovalModal(run: SystemCalculationRunItem) {
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

  canApproveInsuranceHistoryDetail(): boolean {
    const run = this.reviewingInsuranceHistoryRun;
    if (!run || run.approval?.approvalStatus !== '申請中') return false;
    return this.employeeEventApprovalService.canApproveSystemRun(run);
  }

  canRejectInsuranceHistoryDetail(): boolean {
    return this.reviewingInsuranceHistoryRun?.approval?.approvalStatus === '申請中';
  }

  async approveInsuranceHistoryDetail() {
    const run = this.reviewingInsuranceHistoryRun;
    if (!run) return;
    if (!this.canApproveInsuranceHistoryDetail()) {
      this.showMessage('適用日以降、または作業対象期間内になってから承認できます');
      return;
    }
    if (!window.confirm('システム計算結果を承認しますか？')) return;

    let approved = false;
    if (run.type === 'その他' && run.runId?.startsWith('等級変更_')) {
      approved = await this.employeeEventApprovalService.approveGradeChangeRun(run, this.loginEmployeeId);
    } else if (this.insuranceHistoryDraft) {
      const validationError = this.employeeEventApprovalService.validateInsuranceApprovalDraft(this.insuranceHistoryDraft);
      if (validationError) {
        this.showMessage(validationError);
        return;
      }
      approved = await this.employeeEventApprovalService.approveInsuranceChangeRun(
        run,
        this.insuranceHistoryDraft,
        this.loginEmployeeId,
      );
    }

    if (approved) {
      this.showMessage('承認しました（反映は作業期間内に行ってください）');
      this.closeInsuranceHistoryDetail();
      await this.loadEvents();
    } else {
      this.showMessage('承認に失敗しました');
    }
  }

  async rejectInsuranceHistoryDetail() {
    const run = this.reviewingInsuranceHistoryRun;
    if (!run || !this.canRejectInsuranceHistoryDetail()) return;
    if (!window.confirm('システム計算結果を却下しますか？')) return;

    const rejected = await this.employeeEventApprovalService.rejectSystemRun(run.runId, this.loginEmployeeId);
    if (rejected) {
      this.showMessage('システム計算結果を却下しました');
      this.closeInsuranceHistoryDetail();
      await this.loadEvents();
    } else {
      this.showMessage('却下に失敗しました');
    }
  }

  getInsuranceHistoryGradeChange(run: SystemCalculationRunItem): { before?: number; after?: number } {
    const payload = run.payload ?? {};
    return {
      before: payload['beforeGrade'] as number | undefined,
      after: payload['afterGrade'] as number | undefined,
    };
  }

  getInsuranceHistoryReasonLabel(): string {
    const run = this.reviewingInsuranceHistoryRun;
    return run ? this.employeeEventApprovalService.getInsuranceChangeReasonLabel(run) : '—';
  }

  getInsuranceHistoryTypeLabelForRun(run: SystemCalculationRunItem): string {
    return this.employeeEventApprovalService.getInsuranceChangeTypeLabel(run);
  }

  getInsuranceChangeDetectedDateLabel(run: SystemCalculationRunItem): string {
    const date = this.employeeEventApprovalService.getInsuranceChangeDetectedDate(run);
    return date ? this.commonService.formatDate(date) : '—';
  }

  getInsuranceChangeDetailItems(run: SystemCalculationRunItem, draft: InsuranceApprovalDraft) {
    return this.employeeEventApprovalService.getInsuranceChangeDetailItems(run, draft);
  }

  getInsuranceHistoryModalEmployeeSubtitle(): string {
    return this.getModalEmployeeSubtitle(this.reviewingInsuranceHistoryRun?.employeeId);
  }

  closeQualificationReview() {
    this.cancelApprovalModal();
  }

  async approveQualificationReview() {
    await this.confirmApprovalModal();
  }

  async rejectQualificationReview() {
    await this.rejectApprovalModal();
  }

  getApproverName(employeeId: string): string {
    return this.commonService.getEmployeeName(employeeId) ?? employeeId;
  }

  async bulkApplyFixedSalary() {
    this.openAdHocApplyModal();
  }

  getSystemRunKey(run: SystemCalculationRunItem): string {
    return `${run.employeeId}:${run.runId}`;
  }

  async onApproveSystemRun(run: SystemCalculationRunItem) {
    const eventView = this.employeeEventApprovalService.buildEventViewFromRun(run);
    if (this.employeeDetailEventService.needsApprovalDialogForRun(run)) {
      if (run.eventType === '固定給変更') {
        this.fixedSalaryDraft = await this.employeeEventApprovalService.buildFixedSalaryApprovalDraft(eventView);
        this.approvalModalType = 'fixedSalary';
      } else {
        this.insuranceDraft = await this.employeeEventApprovalService.buildInsuranceApprovalDraft(eventView);
        this.approvalModalType = 'insurance';
        this.insuranceApprovalChangeDate = this.formatDateInput(eventView.occurredDate?.toDate()) || this.formatDateInput(new Date());
        this.insuranceApprovalValidationError = '';
      }
      this.approvingSystemRun = run;
      this.approvalModalOpen = true;
      return;
    }

    let approved = false;
    if (run.type === '資格喪失' || run.payload?.['source'] === '退社') {
      if (!(await this.canApproveRetireRun(run))) {
        this.showMessage('退社承認後に保険喪失を承認できます');
        return;
      }
      if (!window.confirm('退社処理の保険・扶養情報を承認しますか？')) {
        return;
      }
      approved = await this.employeeEventApprovalService.approveRetireQualificationRun(run, this.loginEmployeeId);
    } else if (run.eventType === '退社') {
      if (!window.confirm('退社イベントを承認しますか？')) {
        return;
      }
      approved = await this.employeeEventApprovalService.approveRetireEvent(
        run.employeeId, eventView, this.loginEmployeeId, run.runId,
      );
    }
    await this.afterApproval(approved);
  }

  async onRejectSystemRun(run: SystemCalculationRunItem) {
    if (!window.confirm('システム計算結果を却下しますか？')) return;
    const rejected = run.type === '資格喪失' || run.payload?.['source'] === '退社'
      ? await this.employeeEventApprovalService.rejectRetireQualificationRun(run, this.loginEmployeeId)
      : await this.employeeEventApprovalService.rejectSystemRun(run.runId, this.loginEmployeeId);
    if (rejected) {
      this.showMessage('システム計算結果を却下しました');
      await this.loadEvents();
    } else {
      this.showMessage('却下に失敗しました');
    }
  }

  getInsuranceChangeLabel(run: SystemCalculationRunItem): string {
    return this.employeeEventApprovalService.getInsuranceChangeLabel(run);
  }

  isInsuranceInfoChangeRun(run: SystemCalculationRunItem): boolean {
    return this.calculationRunService.isInsuranceInfoChangeRun(run);
  }

  getScheduledSystemRunTypeLabel(run: SystemCalculationRunItem): string {
    if (this.isInsuranceInfoChangeRun(run)) {
      return this.employeeEventApprovalService.getInsuranceChangeTypeLabel(run);
    }
    return run.eventType ?? run.type ?? '—';
  }

  getScheduledSystemRunOccurredDate(run: SystemCalculationRunItem) {
    if (this.isInsuranceInfoChangeRun(run)) {
      return run.detectedDate;
    }
    return run.payload?.['occurredDate'];
  }

  getEventKey(event: EmployeeEventItem): string {
    return `${event.employeeId}:${event.eventId}`;
  }

  getEmployeeName(employeeId: string): string {
    return this.commonService.getEmployeeName(employeeId) ?? employeeId;
  }

  getModalEmployeeSubtitle(employeeId?: string): string {
    if (!employeeId) return '';
    return `社員ID：${employeeId}　${this.getEmployeeName(employeeId)}`;
  }

  toggleReachAge(event: EmployeeEventItem, checked: boolean) {
    const key = this.getEventKey(event);
    if (checked) this.selectedReachAge.add(key);
    else this.selectedReachAge.delete(key);
  }

  toggleRetire(run: SystemCalculationRunItem, checked: boolean) {
    const key = this.getSystemRunKey(run);
    if (checked) this.selectedRetire.add(key);
    else this.selectedRetire.delete(key);
  }

  toggleHire(run: SystemCalculationRunItem, checked: boolean) {
    const key = this.getSystemRunKey(run);
    if (checked) this.selectedHire.add(key);
    else this.selectedHire.delete(key);
  }

  toggleAllReachAge() {
    this.reachAgeEvents.forEach(event => this.selectedReachAge.add(this.getEventKey(event)));
  }

  toggleAllReachAgeClear() {
    this.selectedReachAge.clear();
  }

  toggleAllRetire() {
    this.retireRuns.forEach(run => this.selectedRetire.add(this.getSystemRunKey(run)));
  }

  toggleAllRetireClear() {
    this.selectedRetire.clear();
  }

  toggleAllHire() {
    this.hireRuns.forEach(run => this.selectedHire.add(this.getSystemRunKey(run)));
  }

  toggleAllHireClear() {
    this.selectedHire.clear();
  }

  async openHireDetail(run: SystemCalculationRunItem) {
    this.reviewingHireRun = run;
    this.hireApprovalDraft = await this.employeeEventApprovalService.buildHireInsuranceApprovalDraft(run);
    this.hireApprovalValidationError = '';
    this.hireDetailModalOpen = true;
  }

  closeHireDetail() {
    this.hireDetailModalOpen = false;
    this.reviewingHireRun = null;
    this.hireApprovalDraft = null;
    this.hireApprovalValidationError = '';
  }

  getInsuranceJoinedLabel(detail?: { joined?: boolean }): string {
    return detail?.joined ? '加入' : '未加入';
  }

  async approveHireFromDetail() {
    if (!this.reviewingHireRun || !this.hireApprovalDraft) return;
    this.hireApprovalValidationError = this.employeeEventApprovalService.validateHireInsuranceApprovalDraft(this.hireApprovalDraft) ?? '';
    if (this.hireApprovalValidationError) return;
    if (!this.canApproveHireRun(this.reviewingHireRun)) {
      this.hireApprovalValidationError = '入社承認後、入社日以降に承認できます';
      return;
    }
    if (!window.confirm('入社処理の保険・扶養情報を承認しますか？')) return;

    const approved = await this.employeeEventApprovalService.approveHireQualificationRun(
      this.reviewingHireRun,
      this.loginEmployeeId,
      this.hireApprovalDraft,
    );
    if (approved) {
      this.showMessage('入社処理を承認しました（反映は作業期間内に行ってください）');
      this.closeHireDetail();
      await this.loadEvents();
    } else {
      this.showMessage('承認に失敗しました');
    }
  }

  async rejectHireRun(run: SystemCalculationRunItem) {
    if (!window.confirm('入社処理を却下しますか？')) return;

    const rejected = await this.employeeEventApprovalService.rejectHireQualificationRun(
      run,
      this.loginEmployeeId,
    );
    if (rejected) {
      this.showMessage('入社処理を却下しました');
      if (this.reviewingHireRun?.runId === run.runId) {
        this.closeHireDetail();
      }
      await this.loadEvents();
    } else {
      this.showMessage('却下に失敗しました');
    }
  }

  async rejectHireFromDetail() {
    if (!this.reviewingHireRun) return;
    await this.rejectHireRun(this.reviewingHireRun);
  }

  async openRetireDetail(run: SystemCalculationRunItem) {
    this.reviewingRetireRun = run;
    this.retireInsuranceDetail = await this.employeeEventApprovalService.buildRetireInsuranceDetailView(run);
    this.retireDetailModalOpen = true;
  }

  closeRetireDetail() {
    this.retireDetailModalOpen = false;
    this.reviewingRetireRun = null;
    this.retireInsuranceDetail = null;
  }

  async approveRetireFromDetail() {
    if (!this.reviewingRetireRun) return;
    if (!(await this.canApproveRetireRun(this.reviewingRetireRun))) {
      this.showMessage('退社承認後に保険喪失を承認できます');
      return;
    }
    if (!window.confirm('退社処理の保険・扶養情報を承認しますか？')) return;

    const approved = await this.employeeEventApprovalService.approveRetireQualificationRun(
      this.reviewingRetireRun,
      this.loginEmployeeId,
    );
    if (approved) {
      this.showMessage('退社処理を承認しました（反映は作業期間内に行ってください）');
      this.closeRetireDetail();
      await this.loadEvents();
    } else {
      this.showMessage('承認に失敗しました');
    }
  }

  async rejectRetireFromDetail() {
    if (!this.reviewingRetireRun) return;
    if (!window.confirm('退社処理を却下しますか？')) return;

    const rejected = await this.employeeEventApprovalService.rejectRetireQualificationRun(
      this.reviewingRetireRun,
      this.loginEmployeeId,
    );
    if (rejected) {
      this.showMessage('退社処理を却下しました');
      this.closeRetireDetail();
      await this.loadEvents();
    } else {
      this.showMessage('却下に失敗しました');
    }
  }

  async onApproveEvent(event: EmployeeEventItem) {
    if (!this.canApproveEventByDate(event)) {
      this.showMessage('イベント発生日以降に承認できます');
      return;
    }

    if (this.employeeDetailEventService.needsApprovalDialog(event)) {
      if (event.eventType === '固定給変更') {
        this.fixedSalaryDraft = await this.employeeEventApprovalService.buildFixedSalaryApprovalDraft(event);
        this.approvalModalType = 'fixedSalary';
      } else {
        this.insuranceDraft = await this.employeeEventApprovalService.buildInsuranceApprovalDraft(event);
        this.approvalModalType = 'insurance';
        this.insuranceApprovalChangeDate = this.formatDateInput(event.occurredDate?.toDate()) || this.formatDateInput(new Date());
        this.insuranceApprovalValidationError = '';
      }
      this.approvingEvent = event;
      this.approvalModalOpen = true;
      return;
    }

    let approved = false;
    if (event.eventType === '一定年齢到達') {
      approved = await this.employeeEventApprovalService.approveReachAgeEvent(event.employeeId, event, this.loginEmployeeId);
    } else if (event.eventType === '退社') {
      approved = await this.employeeEventApprovalService.approveRetireEvent(event.employeeId, event, this.loginEmployeeId);
    } else {
      approved = await this.employeeEventApprovalService.approveSimpleEvent(event.employeeId, event, this.loginEmployeeId);
    }

    await this.afterApproval(approved);
  }

  async onRejectEvent(event: EmployeeEventItem) {
    const rejected = await this.employeeEventApprovalService.rejectEvent(event.employeeId, event, this.loginEmployeeId);
    if (rejected) {
      this.showMessage('イベントを却下しました');
      await this.loadEvents();
    } else {
      this.showMessage('イベントの却下に失敗しました');
    }
  }

  openEmployeeReview(event: EmployeeEventItem) {
    this.reviewingEmployeeEvent = event;
    this.employeeReviewModalOpen = true;
  }

  closeEmployeeReview() {
    this.employeeReviewModalOpen = false;
    this.reviewingEmployeeEvent = null;
  }

  async approveEmployeeApplication() {
    if (!this.reviewingEmployeeEvent) return;

    const approved = await this.employeeEventApprovalService.approveEmployeeApplicationOnly(
      this.reviewingEmployeeEvent.employeeId,
      this.reviewingEmployeeEvent,
      this.loginEmployeeId,
    );

    if (approved) {
      this.showMessage('申請を承認しました（適用は「承認済みのイベントの適用」から行ってください）');
      this.closeEmployeeReview();
      await this.loadEvents();
    } else {
      this.showMessage('承認に失敗しました');
    }
  }

  async rejectEmployeeApplication() {
    if (!this.reviewingEmployeeEvent) return;
    await this.onRejectEvent(this.reviewingEmployeeEvent);
    this.closeEmployeeReview();
  }

  getEmployeeEventChangeLines(event: EmployeeEventItem): string[] {
    return this.employeeEventDisplayService.getChangeLines(event);
  }

  async bulkApproveReachAge() {
    if (!window.confirm('選択した一定年齢到達イベントを承認しますか？')) return;
    let count = 0;
    for (const key of this.selectedReachAge) {
      const event = this.reachAgeEvents.find(item => this.getEventKey(item) === key);
      if (!event) continue;
      const approved = await this.employeeEventApprovalService.approveReachAgeEvent(event.employeeId, event, this.loginEmployeeId);
      if (approved) count++;
    }
    if (count > 0) {
      this.showMessage(`${count}件の一定年齢到達イベントを承認しました`);
      await this.employeeService.getAllEmployees(true);
      await this.loadEvents();
    }
  }

  // 一定年齢到達イベント一括却下
  async bulkRejectReachAge() {
    if (!window.confirm('選択した一定年齢到達イベントを却下しますか？')) return;
    let count = 0;
    for (const key of this.selectedReachAge) {
      const event = this.reachAgeEvents.find(item => this.getEventKey(item) === key);
      if (!event) continue;
      const rejected = await this.employeeEventApprovalService.rejectEvent(event.employeeId, event, this.loginEmployeeId);
      if (rejected) count++;
    }
    if (count > 0) {
      this.showMessage(`${count}件の一定年齢到達イベントを却下しました`);
      await this.employeeService.getAllEmployees(true);
      await this.loadEvents();
    }
  }

  async bulkApproveRetire() {
    if (!window.confirm('選択した退社処理を承認して従業員情報に反映しますか？')) return;
    let count = 0;
    for (const key of this.selectedRetire) {
      const run = this.retireRuns.find(item => this.getSystemRunKey(item) === key);
      if (!run) continue;
      const approved = await this.employeeEventApprovalService.approveRetireQualificationRun(run, this.loginEmployeeId);
      if (approved) count++;
    }
    if (count > 0) {
      this.showMessage(`${count}件の退社処理を承認しました`);
      await this.employeeService.getAllEmployees(true);
      await this.loadEvents();
    }
  }

  async bulkRejectRetire() {
    if (!window.confirm('選択した退社処理を却下しますか？')) return;
    let count = 0;
    for (const key of this.selectedRetire) {
      const run = this.retireRuns.find(item => this.getSystemRunKey(item) === key);
      if (!run) continue;
      const rejected = await this.employeeEventApprovalService.rejectRetireQualificationRun(run, this.loginEmployeeId);
      if (rejected) count++;
    }
    if (count > 0) {
      this.showMessage(`${count}件の退社計算結果を却下しました`);
      await this.loadEvents();
    }
  }


  cancelApprovalModal() {
    this.approvalModalOpen = false;
    this.approvalModalType = null;
    this.approvingEvent = null;
    this.approvingSystemRun = null;
    this.fixedSalaryDraft = null;
    this.insuranceDraft = null;
    this.insuranceApprovalChangeDate = '';
    this.insuranceApprovalValidationError = '';
  }

  onInsuranceDraftStatusChange(insuranceKey: 'health' | 'nursing' | 'pension') {
    if (!this.insuranceDraft) return;
    this.employeeEventApprovalService.onInsuranceDraftStatusChange(
      this.insuranceDraft,
      insuranceKey,
      this.insuranceApprovalChangeDate,
    );
    this.insuranceApprovalValidationError = '';
  }

  isInsuranceGradeEditable(): boolean {
    return this.insuranceDraft?.healthStatus === 'joined';
  }

  private formatDateInput(date?: Date): string {
    if (!date) return '';
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  async rejectApprovalModal() {
    if (!window.confirm('システム計算結果を却下しますか？')) return;
    if (this.approvingSystemRun) {
      let rejected = false;
      if (this.approvalModalType === 'fixedSalary' && this.fixedSalaryDraft) {
        rejected = await this.employeeEventApprovalService.rejectFixedSalaryRun(
          this.approvingSystemRun.runId,
          this.fixedSalaryDraft,
          this.loginEmployeeId,
        );
      } else {
        rejected = await this.employeeEventApprovalService.rejectSystemRun(this.approvingSystemRun.runId, this.loginEmployeeId);
      }
      if (rejected) {
        this.showMessage('システム計算結果を却下しました');
        await this.loadEvents();
      } else {
        this.showMessage('却下に失敗しました');
      }
    } else if (this.approvingEvent) {
      await this.onRejectEvent(this.approvingEvent);
    }
    this.cancelApprovalModal();
  }

  async confirmApprovalModal() {
    if (!this.approvingSystemRun && !this.approvingEvent) return;
    if (!window.confirm('システム計算結果を承認しますか？')) {
      return;
    }

    let approved = false;
    const employeeId = this.approvingSystemRun?.employeeId ?? this.approvingEvent!.employeeId;
    const eventView = this.approvingSystemRun
      ? this.employeeEventApprovalService.buildEventViewFromRun(this.approvingSystemRun)
      : this.approvingEvent!;
    const runId = this.approvingSystemRun?.runId;
    const isInsuranceChangeRun = this.approvingSystemRun?.payload?.['source'] === '保険情報変更';
    const isEmploymentChangeRun = this.approvingSystemRun
      ? isEmploymentChangeSystemRun(this.approvingSystemRun)
      : false;

    if (this.approvalModalType === 'fixedSalary' && this.fixedSalaryDraft) {
      approved = await this.employeeEventApprovalService.approveFixedSalaryEvent(
        employeeId, eventView, this.fixedSalaryDraft, this.loginEmployeeId, runId,
      );
    } else if (this.approvalModalType === 'insurance' && this.insuranceDraft) {
      const validationError = this.employeeEventApprovalService.validateInsuranceApprovalDraft(this.insuranceDraft);
      if (validationError) {
        this.insuranceApprovalValidationError = validationError;
        this.showMessage(validationError);
        return;
      }
      if (isEmploymentChangeRun && this.approvingSystemRun) {
        approved = await this.employeeEventApprovalService.approveEmploymentChangeRun(
          this.approvingSystemRun,
          this.insuranceDraft,
          this.loginEmployeeId,
        );
      } else if (isInsuranceChangeRun && this.approvingSystemRun) {
        approved = await this.employeeEventApprovalService.approveInsuranceChangeRun(
          this.approvingSystemRun,
          this.insuranceDraft,
          this.loginEmployeeId,
        );
      } else {
        approved = await this.employeeEventApprovalService.approveInsuranceEvent(
          employeeId, eventView, this.insuranceDraft, this.loginEmployeeId, runId,
        );
      }
    }

    await this.afterApproval(approved);
    this.cancelApprovalModal();
  }

  getInsuranceStatusLabel(status: InsuranceStatus): string {
    switch (status) {
      case 'joined': return '加入';
      case 'lost': return '喪失';
      default: return '未加入';
    }
  }

  isApprovingEmploymentChangeRun(): boolean {
    return this.approvingSystemRun ? isEmploymentChangeSystemRun(this.approvingSystemRun) : false;
  }

  private async afterApproval(approved: boolean) {
    if (approved) {
      this.showMessage('承認しました（反映は作業期間内に行ってください）');
      await this.loadEvents();
    } else {
      this.showMessage('承認に失敗しました');
    }
  }

  private showMessage(message: string) {
    this.messageTimer = this.commonService.showTimedMessage(
      message,
      value => this.message = value,
      this.messageTimer,
    );
  }

  reachAgeInfoModalOpen = false;
  openReachAgeInfoModal() {
    this.reachAgeInfoModalOpen = true;
  }

  /** 給与入力へ遷移 */
  toMonthlySalary() {
    this.router.navigate(['/monthly-salary', this.workingYear, this.workingMonth]);
  }

  /** 保険料確認へ遷移 */
  toInsuranceConfirm() {
    if (this.hasPendingApplications()) {
      if (!window.confirm('申請中のものが残っていますが、次の作業に移動しますか？')) {
        return;
      }
    } else if (this.hasPendingApprovedApplies()) {
      window.alert('承認済みのイベントの適用が実施されていません。実施後に保険料の確認をおこなってください。');
      return;
    }
    this.router.navigate(['/insurance-confirm', this.workingYear, this.workingMonth]);
  }

  /** 承認済みの反映が未実施か */
  hasPendingApprovedApplies(): boolean {
    return this.canBulkApplyFixedSalary
      || this.canBulkApplyHire
      || this.canBulkApplyRetire
      || this.canBulkApplyQualification
      || this.canBulkApplyScheduled
      || this.approvedEmployeeApplicationEvents.length > 0;
  }

  /** 遡及修正へ遷移 */
  toCorrection() {
    this.router.navigate(['/retroactive-correction']);
  }

}