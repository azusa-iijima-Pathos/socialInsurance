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
  InsuranceApprovalDraft,
} from '../../../service/logic/employee-event-approval.service';
import { ReachAgeService } from '../../../service/logic/reach-age';
import { Employee } from '../../../model/employee';
import { Timestamp } from '@angular/fire/firestore';

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
  commonService = inject(CommonService);

  loginEmployeeId = sessionStorage.getItem('loginEmployeeId') ?? '';
  workingYear = Number(sessionStorage.getItem('workingYear'));
  workingMonth = Number(sessionStorage.getItem('workingMonth'));

  reachAgeEvents: EmployeeEventItem[] = [];
  fixedSalaryRuns: SystemCalculationRunItem[] = [];
  retireRuns: SystemCalculationRunItem[] = [];
  otherSystemRuns: SystemCalculationRunItem[] = [];
  employeeApplicationEvents: EmployeeEventItem[] = [];
  otherEvents: EmployeeEventItem[] = [];

  selectedReachAge = new Set<string>();
  selectedRetire = new Set<string>();

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
    this.retireRuns = sortRuns(systemRuns.filter(run => run.eventType === '退社'));
    this.otherSystemRuns = sortRuns(systemRuns.filter(run => run.eventType === '雇用形態変更'));
    this.employeeApplicationEvents = events
      .filter(event => event.applicantType === '社員')
      .sort(compareEventsByAppliedDateDesc);
    this.otherEvents = events
      .filter(event =>
        event.applicantType !== '社員'
        && event.eventType !== '一定年齢到達'
        && event.applicantType !== 'システム',
      )
      .sort(compareEventsByAppliedDateDesc);
    this.selectedReachAge.clear();
    this.selectedRetire.clear();
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
    if (run.eventType === '退社') {
      if (!window.confirm('システム計算結果を承認しますか？\n退社処理を行うと保険情報の変更はできません。')) {
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
    const rejected = await this.employeeEventApprovalService.rejectSystemRun(run.runId, this.loginEmployeeId);
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
    const payload = event.payload ?? {};
    const before = payload['before'];
    const after = payload['after'];

    if (event.eventType === '氏名変更') {
      return [`姓：${before ?? '—'} → ${after ?? '—'}`];
    }

    if (event.eventType === '扶養情報変更') {
      const lines: string[] = [];
      const beforeDep = before as Record<string, unknown> | null;
      const afterDep = after as Record<string, unknown>;
      if (beforeDep) {
        lines.push(`氏名：${beforeDep['name'] ?? '—'} → ${afterDep['name'] ?? '—'}`);
        lines.push(`続柄：${beforeDep['relationship'] ?? '—'} → ${afterDep['relationship'] ?? '—'}`);
        lines.push(`生年月日：${this.formatPayloadDate(beforeDep['birthDate'])} → ${this.formatPayloadDate(afterDep['birthDate'])}`);
        lines.push(`扶養区分：${this.formatDependentFlag(beforeDep['isDependent'])} → ${this.formatDependentFlag(afterDep['isDependent'])}`);
      } else {
        lines.push(`氏名：${afterDep['name'] ?? '—'}（新規）`);
        lines.push(`続柄：${afterDep['relationship'] ?? '—'}`);
        lines.push(`生年月日：${this.formatPayloadDate(afterDep['birthDate'])}`);
        lines.push(`扶養区分：${this.formatDependentFlag(afterDep['isDependent'])}`);
      }
      if (event.lifeEventType) {
        lines.unshift(`ライフイベント：${event.lifeEventType}`);
      }
      return lines;
    }

    if (event.eventType === '勤務状況変更') {
      const beforeEmp = before as Employee | undefined;
      const afterEmp = after as Employee | undefined;
      const expectedBirthDate = event.payload?.['expectedBirthDate'];
      const isMultipleBirth = event.payload?.['isMultipleBirth'] as boolean | undefined;
      const occurredDate = event.occurredDate;
      const lines: string[] = [];
      if (beforeEmp?.workStatus !== afterEmp?.workStatus) {
        lines.push(`勤務状況：${beforeEmp?.workStatus ?? '—'} → ${afterEmp?.workStatus ?? '—'}`);
      }
      if (beforeEmp?.leaveTypes !== afterEmp?.leaveTypes) {
        lines.push(`休業種別：${beforeEmp?.leaveTypes ?? '—'} → ${afterEmp?.leaveTypes ?? '—'}`);
      }
      if (occurredDate) {
        lines.push(`休職開始日：${this.commonService.formatDate(occurredDate)}`);
      }
      if (expectedBirthDate) {
        if (event.lifeEventType === '出産') {
          lines.push(`出産予定日：${this.commonService.formatDate(expectedBirthDate)}`);
        } else if (event.lifeEventType === '育児') {
          lines.push(`子どもの誕生日：${this.commonService.formatDate(expectedBirthDate)}`);
        }
      }
      if (isMultipleBirth === true) {
        lines.push(`多胎妊娠：○`);
      } else if (isMultipleBirth === false) {
        lines.push(`多胎妊娠：×`);
      }
      if (event.lifeEventType) {
        lines.unshift(`ライフイベント：${event.lifeEventType}`);
      }
      return lines.length ? lines : ['変更内容を確認してください'];
    }

    return ['変更内容を確認してください'];
  }

  private formatPayloadDate(value: unknown): string {
    if (!value) return '—';
    if (typeof value === 'string') return value;
    if (typeof value === 'object' && value !== null && 'toDate' in value) {
      return (value as Timestamp).toDate().toLocaleDateString();
    }
    return String(value);
  }

  private formatDependentFlag(value: unknown): string {
    return value === false ? '扶養ではない' : '扶養';
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
    if (!window.confirm('選択した退社処理を承認しますか？\n退社処理を行うと保険情報の変更はできません。')) return;
    let count = 0;
    for (const key of this.selectedRetire) {
      const run = this.retireRuns.find(item => this.getSystemRunKey(item) === key);
      if (!run) continue;
      const eventView = this.employeeEventApprovalService.buildEventViewFromRun(run);
      const approved = await this.employeeEventApprovalService.approveRetireEvent(
        run.employeeId, eventView, this.loginEmployeeId, run.runId,
      );
      if (approved) count++;
    }
    if (count > 0) {
      this.showMessage(`${count}件の退社計算結果を承認しました`);
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
      const rejected = await this.employeeEventApprovalService.rejectSystemRun(run.runId, this.loginEmployeeId);
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
      await this.employeeService.getAllEmployees(true);
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

}