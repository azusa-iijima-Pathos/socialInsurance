import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { CalculationRun } from '../../../model/calculation-run';
import { CalculationRunService } from '../../../service/Firestore/calculation-run-service';
import { CommonService, MessageTimer } from '../../../service/common/common-service';
import { EmployeeService } from '../../../service/Firestore/employee-service';
import { SocialInsuranceFormCsvService } from '../../../service/CSV/social-insurance-form-csv.service';
import { AnnouncementLogicService } from '../../../service/logic/announcement-logic.service';

@Component({
  selector: 'app-calculation-base-pending-list',
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './calculation-base-pending-list.html',
  styleUrl: './calculation-base-pending-list.css',
})
export class CalculationBasePendingList {

  private calculationRunService = inject(CalculationRunService);
  private commonService = inject(CommonService);
  private employeeService = inject(EmployeeService);
  private formCsvService = inject(SocialInsuranceFormCsvService);
  private announcementLogicService = inject(AnnouncementLogicService);

  runs: CalculationRun[] = [];
  approvedGradeMap: Record<string, number> = {};
  calculationBaseRun: CalculationRun | null = null;
  targetYear = Number(sessionStorage.getItem('workingYear')) || new Date().getFullYear();
  displayYear = this.targetYear;
  message = '';
  private messageTimer: MessageTimer = null;

  calculationBaseEditErrors: string[] = [];
  calculating = false;
  editMode = false;

  get canEditDisplayedYear(): boolean {
    const workingYear = Number(sessionStorage.getItem('workingYear')) || new Date().getFullYear();
    return this.displayYear === workingYear;
  }

  get canApplyApprovedResults(): boolean {
    const workingMonth = Number(sessionStorage.getItem('workingMonth'));
    return workingMonth >= 9 && this.calculationBaseRun?.approval?.approvalStatus === '承認済み' && !this.isApplied;
  }

  get isInternallyApproved(): boolean {
    return this.calculationBaseRun?.approval?.approvalStatus === '承認済み';
  }

  get isApplied(): boolean {
    return this.getCalculationBaseStatus() === '反映済み';
  }

  get targetYearOptions(): number[] {
    const workingYear = Number(sessionStorage.getItem('workingYear')) || new Date().getFullYear();
    return Array.from({ length: 10 }, (_, index) => workingYear - index);
  }

  async ngOnInit() {
    await this.loadRuns();
  }

  editApprovedGrades() {
    if (this.isInternallyApproved) {
      const confirmed = window.confirm('社内承認済みですが、等級修正しますか？');
      if (!confirmed) return;
    }

    this.editMode = true;
    this.message = '';
    this.calculationBaseEditErrors = [];
  }

  cancelEditApprovedGrades() {
    this.editMode = false;
    this.message = '';
    this.calculationBaseEditErrors = [];
    this.resetApprovedGradeMap();
  }

  async calculateBase() {
    this.message = '';
    this.calculationBaseEditErrors = [];
    const confirmed = window.confirm(
      `${this.displayYear}年6月支払いの給与入力は完了していますか？\n` +
      '未入力の給与がある場合、正しく算定されない可能性があります。\n' +
      '算定基礎を自動計算しますか？'
    );
    if (!confirmed) return;

    this.calculating = true;
    const result = await this.calculationRunService.calculateBaseForAllEmployees(this.displayYear);
    this.calculating = false;

    if (!result) {
      this.showMessage('算定基礎の自動計算に失敗しました');
      return;
    }

    this.showMessage(`${this.displayYear}年の算定基礎を自動計算しました`);
    await this.loadRuns();
  }

  async showSelectedYearRuns() {
    this.displayYear = Number(this.targetYear);
    this.editMode = false;
    this.message = '';
    this.calculationBaseEditErrors = [];
    await this.loadRuns();
  }

  private async loadRuns() {
    this.calculationBaseRun = await this.calculationRunService.getCalculationBaseRun(this.displayYear);
    this.runs = await this.calculationRunService.getPendingCalculationBaseRuns(this.displayYear);
    this.resetApprovedGradeMap();
  }

  private resetApprovedGradeMap() {
    this.approvedGradeMap = this.runs.reduce<Record<string, number>>((map, run) => {
      const employeeId = this.getEmployeeId(run);
      const grade = Number(this.getPayload(run)['approvedGrade'] ?? this.getPayload(run)['calculatedGrade'] ?? 0);
      if (employeeId) {
        map[employeeId] = grade;
      }
      return map;
    }, {});
  }

  getPayload(run: CalculationRun) {
    return run.payload ?? {};
  }

  getEmployeeId(run: CalculationRun): string {
    return String(this.getPayload(run)['employeeId'] ?? run.targetEmployeeIds ?? '');
  }

  getTargetPayrollText(run: CalculationRun): string {
    const targetPayrolls = this.getPayload(run)['targetPayrolls'] as { paymentYearMonth?: string; actualWorkingDays?: number; actualPaymentAmount?: number }[] | undefined;
    if (!targetPayrolls?.length) {
      return '対象月なし';
    }

    return targetPayrolls
      .map(payroll => `${payroll.paymentYearMonth}：${payroll.actualWorkingDays ?? 0}日 / ${payroll.actualPaymentAmount ?? 0}円`)
      .join('、');
  }

  displayGrade(grade: unknown): string {
    const gradeNumber = Number(grade);
    if (!Number.isFinite(gradeNumber)) {
      return '未設定';
    }
    return gradeNumber === 0 ? '未加入' : `${gradeNumber}等級`;
  }

  getCalculationBaseStatus(): string {
    return String(this.calculationBaseRun?.payload?.['status'] ?? '');
  }

  async saveApprovedGrades() {
    this.calculationBaseEditErrors = this.validateApprovedGrades();
    if (this.calculationBaseEditErrors.length) {
      return;
    }

    for (const run of this.runs) {
      const employeeId = this.getEmployeeId(run);
      const grade = this.approvedGradeMap[employeeId];
      const result = await this.calculationRunService.saveCalculationBaseApprovedGrade(this.displayYear, employeeId, grade, run);
      if (!result) {
        this.calculationBaseEditErrors = ['反映等級の保存に失敗しました'];
        return;
      }
    }

    this.editMode = false;
    this.showMessage('反映等級を一括保存しました');
    await this.loadRuns();
  }

  async approveRuns() {
    this.calculationBaseEditErrors = this.validateApprovedGrades();
    if (this.calculationBaseEditErrors.length) {
      return;
    }

    for (const run of this.runs) {
      const employeeId = this.getEmployeeId(run);
      const grade = this.approvedGradeMap[employeeId];
      const result = await this.calculationRunService.saveCalculationBaseApprovedGrade(this.displayYear, employeeId, grade, run);
      if (!result) {
        this.calculationBaseEditErrors = ['算定基礎結果の一括承認に失敗しました'];
        return;
      }
    }

    const approved = await this.calculationRunService.approveCalculationBase(this.displayYear);
    if (!approved) {
      this.calculationBaseEditErrors = ['算定基礎結果の社内承認に失敗しました'];
      return;
    }

    await this.announcementLogicService.createFromCalculationBaseApproval(this.displayYear);

    this.editMode = false;
    this.showMessage('算定基礎結果を社内承認しました');
    await this.loadRuns();
  }

  async applyApprovedResults() {
    const confirmed = window.confirm(
      '算定基礎結果を反映すると、従業員の現在等級が即時更新されます。\n' +
      '9月分までの保険料計算が完了している場合等級を再度確認の上、反映してください。\n' +
      '反映しますか？'
    );
    if (!confirmed) return;

    const result = await this.calculationRunService.applyApprovedCalculationBaseResults(this.displayYear);
    this.showMessage(result ? '社内承認済みの算定基礎結果を反映しました' : '算定基礎結果の反映に失敗しました');
    this.employeeService.getAllEmployees(true);
    await this.loadRuns();
  }

  async exportCalculationBaseCsv() {
    const year = Number(this.targetYear);
    const runs = await this.calculationRunService.getPendingCalculationBaseRuns(year);
    if (runs.length === 0) {
      this.showMessage(`${year}年の算定基礎データがありません`);
      return;
    }

    await this.formCsvService.exportCalculationBaseCsv(runs, year);
  }

  private showMessage(message: string) {
    this.messageTimer = this.commonService.showTimedMessage(
      message,
      value => this.message = value,
      this.messageTimer,
    );
  }

  private validateApprovedGrades(): string[] {
    return this.getInvalidApprovedGradeEmployeeIds()
      .map(employeeId => `社員ID ${employeeId}：反映等級は0以上50以下で入力してください`);
  }

  private getInvalidApprovedGradeEmployeeIds(): string[] {
    return this.runs
      .map(run => this.getEmployeeId(run))
      .filter(employeeId => {
      const grade = this.approvedGradeMap[employeeId];
        return !Number.isFinite(Number(grade)) || Number(grade) < 0 || Number(grade) > 50;
      });
  }

}
