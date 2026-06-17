import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { EmployeeEventItem, EventService, compareEventsByAppliedDateDesc } from '../../../service/Firestore/event-service';
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
import { ReachAgeService } from '../../../service/logic/reach-age';
import { EmployeeEventDisplayService } from '../../../service/logic/employee-event-display.service';
import {
  DISABILITY_STATUSES,
  DISABILITY_TYPES,
  STUDENT_STATUSES,
  STUDENT_TYPES,
} from '../../../constants/model-constants';

type InsuranceStatus = 'joined' | 'notJoined' | 'lost';

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
  private reachAgeService = inject(ReachAgeService);
  private employeeEventDisplayService = inject(EmployeeEventDisplayService);
  commonService = inject(CommonService);

  loginEmployeeId = sessionStorage.getItem('loginEmployeeId') ?? '';
  workingYear = Number(sessionStorage.getItem('workingYear'));
  workingMonth = Number(sessionStorage.getItem('workingMonth'));

  DISABILITY_STATUSES = DISABILITY_STATUSES;
  DISABILITY_TYPES = DISABILITY_TYPES;
  STUDENT_STATUSES = STUDENT_STATUSES;
  STUDENT_TYPES = STUDENT_TYPES;

  reachAgeEvents: EmployeeEventItem[] = [];
  fixedSalaryRuns: SystemCalculationRunItem[] = [];
  hireRuns: SystemCalculationRunItem[] = [];
  canBulkApplyFixedSalary = false;
  retireRuns: SystemCalculationRunItem[] = [];
  otherSystemRuns: SystemCalculationRunItem[] = [];
  employeeApplicationEvents: EmployeeEventItem[] = [];
  otherEvents: EmployeeEventItem[] = [];

  selectedReachAge = new Set<string>();
  selectedRetire = new Set<string>();
  selectedHire = new Set<string>();

  approvalModalOpen = false;
  approvalModalType: 'fixedSalary' | 'insurance' | null = null;
  approvingEvent: EmployeeEventItem | null = null;
  approvingSystemRun: SystemCalculationRunItem | null = null;
  fixedSalaryDraft: FixedSalaryApprovalDraft | null = null;
  insuranceDraft: InsuranceApprovalDraft | null = null;
  insuranceApprovalChangeDate = '';
  insuranceApprovalValidationError = '';

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
  reachAgeMessage = '';
  private messageTimer: MessageTimer = null;
  private reachAgeMessageTimer: MessageTimer = null;

  async ngOnInit() {
    await this.employeeService.getAllEmployees();
    await this.loadEvents();
  }

  async loadEvents() {
    const events = await this.eventService.getAllPendingEventsUpToWorkingMonth();
    const systemRuns = await this.calculationRunService.getPendingSystemRunsUpToWorkingMonth();
    const sortRuns = (runs: SystemCalculationRunItem[]) =>
      [...runs].sort((left, right) => (right.detectedDate?.toMillis() ?? 0) - (left.detectedDate?.toMillis() ?? 0));

    this.reachAgeEvents = events
      .filter(event => event.eventType === '一定年齢到達')
      .sort(compareEventsByAppliedDateDesc);
    this.fixedSalaryRuns = sortRuns(systemRuns.filter(run => run.eventType === '固定給変更'));
    this.hireRuns = sortRuns(await this.calculationRunService.getPendingHireQualificationRunsUpToWorkingMonth());
    this.retireRuns = sortRuns(await this.calculationRunService.getPendingRetireQualificationLossRunsUpToWorkingMonth());
    this.otherSystemRuns = sortRuns(systemRuns.filter(run => run.eventType === '雇用形態変更'));
    this.employeeApplicationEvents = events
      .filter(event => event.applicantType === '社員')
      .sort(compareEventsByAppliedDateDesc);
    this.otherEvents = events
      .filter(event =>
        event.applicantType !== '社員'
        && event.eventType !== '一定年齢到達'
        && event.applicantType !== 'システム'
        && !(event.eventType === '扶養情報変更' && event.lifeEventType === '入社')
        && !(event.eventType === '扶養情報変更' && event.lifeEventType === '退社'),
      )
      .sort(compareEventsByAppliedDateDesc);
    this.selectedReachAge.clear();
    this.selectedRetire.clear();
    this.selectedHire.clear();
    const applicableRevisions = await this.calculationRunService.getApplicableApprovedAdHocRevisionRuns();
    this.canBulkApplyFixedSalary = applicableRevisions.length > 0;
  }

  async bulkApplyFixedSalary() {
    if (!this.canBulkApplyFixedSalary) return;
    if (!window.confirm('承認済みの随時改定を従業員情報に反映しますか？')) return;

    const { appliedCount } = await this.employeeEventApprovalService.applyApprovedAdHocRevisions(this.loginEmployeeId);
    if (appliedCount > 0) {
      await this.employeeService.getAllEmployees(true);
      this.showMessage(`${appliedCount}件の随時改定を適用しました`);
      await this.loadEvents();
    } else {
      this.showMessage('適用に失敗しました');
    }
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
      if (!window.confirm('退社処理の保険・扶養情報を承認して従業員情報に反映しますか？')) {
        return;
      }
      approved = await this.employeeEventApprovalService.approveRetireQualificationRun(run, this.loginEmployeeId);
    } else if (run.eventType === '退社') {
      if (!window.confirm('システム計算結果を承認しますか？')) {
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

  async searchReachAge() {
    const count = await this.reachAgeService.createEvent();
    await this.employeeService.getAllEmployees(true);
    await this.loadEvents();
    this.reachAgeMessageTimer = this.commonService.showTimedMessage(
      `${count}件検出しました`,
      value => this.reachAgeMessage = value,
      this.reachAgeMessageTimer,
    );
  }

  getEventKey(event: EmployeeEventItem): string {
    return `${event.employeeId}:${event.eventId}`;
  }

  getEmployeeName(employeeId: string): string {
    return this.commonService.getEmployeeName(employeeId) ?? employeeId;
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
    if (!window.confirm('入社処理の保険・扶養情報を承認して従業員情報に反映しますか？')) return;

    const approved = await this.employeeEventApprovalService.approveHireQualificationRun(
      this.reviewingHireRun,
      this.loginEmployeeId,
      this.hireApprovalDraft,
    );
    if (approved) {
      await this.employeeService.getAllEmployees(true);
      this.showMessage('入社処理を承認し、従業員情報に反映しました');
      this.closeHireDetail();
      await this.loadEvents();
    } else {
      this.showMessage('承認・反映に失敗しました');
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
    if (!window.confirm('退社処理の保険・扶養情報を承認して従業員情報に反映しますか？')) return;

    const approved = await this.employeeEventApprovalService.approveRetireQualificationRun(
      this.reviewingRetireRun,
      this.loginEmployeeId,
    );
    if (approved) {
      await this.employeeService.getAllEmployees(true);
      this.showMessage('退社処理を承認し、従業員情報に反映しました');
      this.closeRetireDetail();
      await this.loadEvents();
    } else {
      this.showMessage('承認・反映に失敗しました');
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

    const approved = await this.employeeEventApprovalService.approveEmployeeApplicationEvent(
      this.reviewingEmployeeEvent.employeeId,
      this.reviewingEmployeeEvent,
      this.loginEmployeeId,
    );

    if (approved) {
      await this.employeeService.getAllEmployees(true);
      this.showMessage('申請内容を承認し、反映しました');
      this.closeEmployeeReview();
      await this.loadEvents();
    } else {
      this.showMessage('承認・反映に失敗しました');
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
      const rejected = await this.employeeEventApprovalService.rejectSystemRun(this.approvingSystemRun.runId, this.loginEmployeeId);
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
      approved = await this.employeeEventApprovalService.approveInsuranceEvent(
        employeeId, eventView, this.insuranceDraft, this.loginEmployeeId, runId,
      );
    }

    if (approved) {
      if (this.approvalModalType !== 'fixedSalary') {
        await this.employeeService.getAllEmployees(true);
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

  private async afterApproval(approved: boolean) {
    if (approved) {
      this.showMessage('イベントを承認しました');
      await this.loadEvents();
    } else {
      this.showMessage('イベントの承認に失敗しました');
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


  private router = inject(Router);


  /** 給与入力へ遷移 */
  toMonthlySalary() {
    this.router.navigate(['/monthly-salary', this.workingYear, this.workingMonth]);
  }

  /** 保険料確認へ遷移 */
  toInsuranceConfirm() {
    this.router.navigate(['/insurance-confirm', this.workingYear, this.workingMonth]);
  }

  /** 遡及修正へ遷移 */
  toCorrection() {
    this.router.navigate(['/retroactive-correction']);
  }

}