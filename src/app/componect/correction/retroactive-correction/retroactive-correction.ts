import { Component, DestroyRef, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { debounceTime } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { EmployeeService } from '../../../service/Firestore/employee-service';
import { CommonService, MessageTimer } from '../../../service/common/common-service';
import { CorrectionLogicService, MonthlyInsuranceComparisonRow } from '../../../service/logic/correction-logic.service';
import { CalculationRunService } from '../../../service/Firestore/calculation-run-service';
import { EventService } from '../../../service/Firestore/event-service';
import { Employee, EmployeeInsurance, InsuranceDetail } from '../../../model/employee';
import { LeaveType, WorkStatus } from '../../../constants/model-constants';
import { addMonths, buildWorkMonthEventId, getCurrentAppliedFromMonth, getWorkingYearMonth } from '../../../service/logic/event-id-service';
import { InsuranceFormService, InsuranceName, InsuranceStatus } from '../../../service/logic/insurance-form.service';
import { parseDateInputValue, timestampFromDateInput } from '../../../service/common/date-input.util';
import { Timestamp } from '@angular/fire/firestore';
import { Router } from '@angular/router';
import { CompanyService } from '../../../service/Firestore/company-service';
import { DependentService } from '../../../service/Firestore/dependent-service';
import { Dependent } from '../../../model/dependent';
import { UPDATE_MESSAGES } from '../../../constants/constants';
import { EmployeeDetailEventService } from '../../../service/logic/employee-detail-event-service';
import { AnnouncementLogicService } from '../../../service/logic/announcement-logic.service';
import { Event } from '../../../model/event';
import { wasEmployedOnDate } from '../../../service/logic/employee-enrollment.util';

type RetroactiveTab = 'insurance' | 'fixedSalary' | 'leave';

@Component({
  selector: 'app-retroactive-correction',
  imports: [CommonModule, FormsModule, ReactiveFormsModule],
  templateUrl: './retroactive-correction.html',
  styleUrls: [
    './retroactive-correction.css',
    '../../employee/add-insurance-info/add-insurance-info.css',
    '../../employee/employee-detail/employee-detail.css',
    '../../insurance/insurance-confirm/insurance-confirm.css',
  ],
})
export class RetroactiveCorrection {

  private fb = inject(FormBuilder);
  private destroyRef = inject(DestroyRef);
  private employeeService = inject(EmployeeService);
  private correctionLogicService = inject(CorrectionLogicService);
  private calculationRunService = inject(CalculationRunService);
  private eventService = inject(EventService);
  private dependentService = inject(DependentService);
  private insuranceFormService = inject(InsuranceFormService);
  commonService = inject(CommonService);
  private router = inject(Router);
  private companyService = inject(CompanyService);
  private employeeDetailEventService = inject(EmployeeDetailEventService);
  private announcementLogicService = inject(AnnouncementLogicService);

  eligibleEmployeesForApplyDate: Employee[] = [];

  activeTab: RetroactiveTab = 'insurance';
  selectedEmployee: Employee | null = null;
  leaveStartFromEvent: Date | null = null;
  leaveEndFromEvent: Date | null = null;

  previewModalOpen = false;
  previewRows: MonthlyInsuranceComparisonRow[] = [];
  previewRemark = '';

  message = '';
  private messageTimer: MessageTimer = null;
  employeeSearchText = '';

  form = this.fb.nonNullable.group({
    employeeId: ['', Validators.required],
    applyDate: ['', Validators.required],
    currentGrade: [0, [Validators.required, Validators.min(0), Validators.max(50)]],
    fixedSalary: [0, [Validators.required, Validators.min(0)]],
    leaveTypes: ['産前産後' as LeaveType],
    leaveStartDate: [''],
    leaveEndDate: [''],
    healthInsurance: this.fb.nonNullable.group({
      joined: ['notJoined' as InsuranceStatus, [Validators.required]],
      number: [''],
      acquiredDate: [''],
      lostDate: [''],
      companyBurdenRate: [50],
    }),
    nursingCareInsurance: this.fb.nonNullable.group({
      joined: ['notJoined' as InsuranceStatus, [Validators.required]],
      number: [''],
      acquiredDate: [''],
      lostDate: [''],
      companyBurdenRate: [50],
    }),
    employeePensionInsurance: this.fb.nonNullable.group({
      joined: ['notJoined' as InsuranceStatus, [Validators.required]],
      number: [''],
      acquiredDate: [''],
      lostDate: [''],
      companyBurdenRate: [50],
    }),
  });

  async ngOnInit() {
    await this.companyService.getCompany();
    await this.employeeService.getAllEmployees();
    this.setupInsuranceDetailControls('healthInsurance');
    this.setupInsuranceDetailControls('nursingCareInsurance');
    this.setupInsuranceDetailControls('employeePensionInsurance');
    this.setupInsuranceDependencyRules();
    this.form.controls.applyDate.valueChanges
      .pipe(debounceTime(200), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        void this.refreshEligibleEmployeesForApplyDate();
        this.refreshInsuranceValidatorsForApplyDate();
      });
    this.form.controls.employeeId.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => void this.onEmployeeChange());
  }

  private async refreshEligibleEmployeesForApplyDate() {
    const applyDate = this.form.controls.applyDate.value;
    if (!applyDate) {
      this.eligibleEmployeesForApplyDate = [];
      return;
    }
    const date = parseDateInputValue(applyDate);
    this.eligibleEmployeesForApplyDate = this.employeeService.allEmployees().filter(employee =>
      wasEmployedOnDate(employee, date),
    );
  }

  private refreshInsuranceValidatorsForApplyDate() {
    for (const name of ['healthInsurance', 'nursingCareInsurance', 'employeePensionInsurance'] as const) {
      this.updateInsuranceDetailControls(this.form.controls[name].controls.joined.value, name);
    }
  }

  private setupInsuranceDependencyRules() {
    this.form.setValidators(control => this.insuranceFormService.healthInsuranceDependencyValidator(control));
    this.form.controls.healthInsurance.controls.joined.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(status => {
        this.syncSubInsuranceStatusesWithHealth(status);
        this.applyCurrentGradeRule();
      });

    for (const name of ['nursingCareInsurance', 'employeePensionInsurance'] as const) {
      this.form.controls[name].controls.joined.valueChanges
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe(() => this.applyCurrentGradeRule());
    }
  }

  get employees() {
    return this.employeeService.allEmployees();
  }

  getFilteredActiveEmployees(): Employee[] {
    const source = this.eligibleEmployeesForApplyDate.length > 0
      ? this.eligibleEmployeesForApplyDate
      : this.employeeService.allActiveEmployees();
    return this.filterEmployees(source.filter(employee => employee.workStatus !== '退社済み'));
  }

  getFilteredRetiredEmployees(): Employee[] {
    const source = this.eligibleEmployeesForApplyDate.length > 0
      ? this.eligibleEmployeesForApplyDate
      : this.employeeService.allRetiredEmployeesInCurrentWorkPeriod();
    return this.filterEmployees(source.filter(employee => employee.workStatus === '退社済み'));
  }

  // async selectEmployee() {
  //   await this.onEmployeeChange();
  // }

  setActiveTab(tab: RetroactiveTab) {
    this.activeTab = tab;
    this.previewModalOpen = false;
  }

  selectedEmployeeId = '';
  async onEmployeeIdChange(employeeId: string) {
    this.selectedEmployeeId = employeeId;
    this.form.patchValue({ employeeId }, { emitEvent: false });
    if (!employeeId) {
      this.selectedEmployee = null;
      return;
    }
    await this.onEmployeeChange();
  }


  /**
   * 社員情報を取得し、フォームに設定する
   */
  async onEmployeeChange() {
    const employeeId = this.selectedEmployeeId;
    if (!employeeId) {
      this.selectedEmployee = null;
      this.leaveStartFromEvent = null;
      this.leaveEndFromEvent = null;
      return;
    }
    this.selectedEmployee = await this.employeeService.getEmployeeByEmployeeId(employeeId);
    if (!this.selectedEmployee) return;

    const ins = this.selectedEmployee.insurance;
    this.form.patchValue({
      currentGrade: ins?.currentGrade ?? 0,
      fixedSalary: this.selectedEmployee.employmentContract?.fixedSalary ?? 0,
      leaveTypes: (this.selectedEmployee.leaveTypes ?? '産前産後') as LeaveType,
      healthInsurance: this.insuranceFormService.toFormValue(ins?.healthInsurance),
      nursingCareInsurance: this.insuranceFormService.toFormValue(ins?.nursingCareInsurance),
      employeePensionInsurance: this.insuranceFormService.toFormValue(ins?.employeePensionInsurance),
      leaveStartDate: '',
      leaveEndDate: '',
    });

    this.leaveStartFromEvent = null;
    this.leaveEndFromEvent = null;
    if (this.selectedEmployee.workStatus === '休職中') {
      this.leaveStartFromEvent = await this.correctionLogicService.getLeaveStartFromEvents(employeeId);
      if (this.leaveStartFromEvent) {
        this.form.patchValue({ leaveStartDate: this.formatDateInput(this.leaveStartFromEvent) });
      }
    }
    this.leaveEndFromEvent = await this.correctionLogicService.getLeaveEndFromEvents(employeeId);
    if (this.leaveEndFromEvent) {
      this.form.patchValue({ leaveEndDate: this.formatDateInput(this.leaveEndFromEvent) });
    }

    this.refreshInsuranceValidatorsForApplyDate();
    this.applyCurrentGradeRule();
  }

  getLeaveEndDisplay(): string {
    if (this.leaveEndFromEvent) {
      return this.formatDateInput(this.leaveEndFromEvent).replace(/-/g, '/');
    }
    return '—';
  }

  getLeaveStartDisplay(): string {
    if (this.selectedEmployee?.workStatus !== '休職中') return '—';
    if (this.leaveStartFromEvent) {
      return this.formatDateInput(this.leaveStartFromEvent).replace(/-/g, '/');
    }
    return '不明';
  }

  getPreviewCurrentTotal(row: MonthlyInsuranceComparisonRow): number {
    return row.currentHealth + row.currentNursing + row.currentPension;
  }

  getPreviewNewTotal(row: MonthlyInsuranceComparisonRow): number {
    return row.newHealth + row.newNursing + row.newPension;
  }

  async validateApplyDateControl(): Promise<boolean> {
    const applyDateValue = this.form.value.applyDate;
    if (!applyDateValue || !this.selectedEmployee) {
      return false;
    }

    const applyDate = parseDateInputValue(applyDateValue);

    if (this.activeTab === 'fixedSalary') {
      const error = await this.correctionLogicService.validateRetroactiveApplyDate(
        this.selectedEmployee.employeeId,
        applyDate,
        false,
      );
      if (error) {
        this.form.controls.applyDate.setErrors({ retroactiveApplyDate: true });
        this.form.controls.applyDate.markAsTouched();
        return false;
      }
    } else if (this.activeTab === 'insurance') {
      if (!wasEmployedOnDate(this.selectedEmployee, applyDate)) {
        this.form.controls.applyDate.setErrors({ notEmployedOnDate: true });
        this.form.controls.applyDate.markAsTouched();
        return false;
      }
    }

    const existingErrors = this.form.controls.applyDate.errors;
    if (existingErrors?.['retroactiveApplyDate'] || existingErrors?.['notEmployedOnDate']) {
      const { retroactiveApplyDate: _, notEmployedOnDate: __, ...rest } = existingErrors;
      this.form.controls.applyDate.setErrors(Object.keys(rest).length ? rest : null);
    }

    return true;
  }

  private async validateBeforeSubmit(): Promise<boolean> {
    if (this.selectedEmployeeId) {
      this.form.patchValue({ employeeId: this.selectedEmployeeId }, { emitEvent: false });
    }
    this.form.markAllAsTouched();

    if (this.form.controls.employeeId.invalid) {
      this.showMessage('社員を選択してください');
      return false;
    }
    if (this.activeTab !== 'leave') {
      if (this.form.controls.applyDate.invalid) return false;

      if (!(await this.validateApplyDateControl())) {
        return false;
      }
    }

    if (this.activeTab === 'insurance') {
      if (this.form.controls.currentGrade.invalid) return false;
      for (const name of ['healthInsurance', 'nursingCareInsurance', 'employeePensionInsurance'] as const) {
        if (this.form.controls[name].invalid) return false;
      }
      if (this.form.hasError('healthInsuranceDependency')) return false;
      if (!this.validateInsuranceDateMatchesApplyDate()) return false;
      if (!this.validateInsuranceDatesEnrolled()) return false;
    }

    if (this.activeTab === 'fixedSalary') {
      if (this.form.controls.fixedSalary.invalid) return false;
    }

    if (this.activeTab === 'leave') {
      const leaveStartDate = this.form.controls.leaveStartDate.value?.trim();
      const leaveEndDate = this.form.controls.leaveEndDate.value?.trim();
      if (!this.isCurrentlyOnLeave() && !leaveStartDate) {
        this.form.controls.leaveStartDate.setErrors({ required: true });
        this.form.controls.leaveStartDate.markAsTouched();
        return false;
      }
      if (this.isCurrentlyOnLeave() && !leaveEndDate) {
        this.form.controls.leaveEndDate.setErrors({ required: true });
        this.form.controls.leaveEndDate.markAsTouched();
        return false;
      }
      if (leaveStartDate && leaveEndDate && leaveEndDate <= leaveStartDate) {
        this.form.controls.leaveEndDate.setErrors({ leaveEndBeforeStart: true });
        this.form.controls.leaveEndDate.markAsTouched();
        return false;
      }
      if (!this.validateLeaveDatesEnrolled()) return false;
    }

    return !!this.selectedEmployee;
  }

  getInsuranceStatusText(detail?: InsuranceDetail): string {
    return this.insuranceFormService.getStatusForDisplay(detail);
  }

  getInsuranceDateText(detail?: InsuranceDetail): string {
    return this.insuranceFormService.getDateText(detail, value => this.commonService.formatDate(value));
  }

  getInsuranceControlError(controlPath: string, label: string): string | null {
    return this.insuranceFormService.getControlErrorMessage(this.form.get(controlPath), label);
  }

  isCurrentlyOnLeave(): boolean {
    return this.selectedEmployee?.workStatus === '休職中';
  }

  isSubInsuranceJoinedDisabled(): boolean {
    return this.insuranceFormService.isSubInsuranceJoinedDisabled(
      this.form.controls.healthInsurance.controls.joined.value,
    );
  }

  private validateInsuranceDateMatchesApplyDate(): boolean {
    const applyDate = this.form.controls.applyDate.value;
    if (!applyDate || !this.selectedEmployee) return true;

    let isValid = true;
    for (const name of ['healthInsurance', 'nursingCareInsurance', 'employeePensionInsurance'] as const) {
      const group = this.form.controls[name];
      const currentDetail = this.selectedEmployee.insurance?.[name];
      const currentAcquiredDate = this.formatDateInput(currentDetail?.acquiredDate?.toDate());
      const currentLostDate = this.formatDateInput(currentDetail?.lostDate?.toDate());

      if (group.controls.acquiredDate.value && group.controls.acquiredDate.value !== currentAcquiredDate) {
        isValid = this.applyDateMatchError(group.controls.acquiredDate, applyDate) && isValid;
      } else {
        this.clearControlError(group.controls.acquiredDate, 'applyDateMismatch');
      }

      if (group.controls.lostDate.value && group.controls.lostDate.value !== currentLostDate) {
        isValid = this.applyDateMatchError(group.controls.lostDate, applyDate) && isValid;
      } else {
        this.clearControlError(group.controls.lostDate, 'applyDateMismatch');
      }
    }

    return isValid;
  }

  private validateInsuranceDatesEnrolled(): boolean {
    const employee = this.selectedEmployee;
    if (!employee) return false;

    for (const name of ['healthInsurance', 'nursingCareInsurance', 'employeePensionInsurance'] as const) {
      const group = this.form.controls[name];
      const currentDetail = employee.insurance?.[name];
      const currentAcquiredDate = this.formatDateInput(currentDetail?.acquiredDate?.toDate());
      const currentLostDate = this.formatDateInput(currentDetail?.lostDate?.toDate());

      if (group.controls.acquiredDate.value && group.controls.acquiredDate.value !== currentAcquiredDate) {
        if (!wasEmployedOnDate(employee, parseDateInputValue(group.controls.acquiredDate.value))) {
          this.showMessage('この期間に在籍していません');
          return false;
        }
      }

      if (group.controls.lostDate.value && group.controls.lostDate.value !== currentLostDate) {
        if (!wasEmployedOnDate(employee, parseDateInputValue(group.controls.lostDate.value))) {
          this.showMessage('この期間に在籍していません');
          return false;
        }
      }
    }

    return true;
  }

  private validateLeaveDatesEnrolled(): boolean {
    const employee = this.selectedEmployee;
    if (!employee) return false;

    const leaveStartDate = this.form.controls.leaveStartDate.value?.trim();
    const leaveEndDate = this.form.controls.leaveEndDate.value?.trim();
    const dates = [leaveStartDate, leaveEndDate].filter((value): value is string => Boolean(value));

    for (const dateValue of dates) {
      if (!wasEmployedOnDate(employee, parseDateInputValue(dateValue))) {
        this.showMessage('この期間に在籍していません');
        return false;
      }
    }

    return true;
  }

  private applyDateMatchError(control: { value: string; errors: Record<string, unknown> | null; setErrors: (errors: Record<string, unknown> | null) => void; markAsTouched: () => void }, applyDate: string): boolean {
    if (control.value === applyDate) {
      this.clearControlError(control, 'applyDateMismatch');
      return true;
    }

    control.setErrors({ ...(control.errors ?? {}), applyDateMismatch: true });
    control.markAsTouched();
    return false;
  }

  private clearControlError(control: { errors: Record<string, unknown> | null; setErrors: (errors: Record<string, unknown> | null) => void }, errorKey: string) {
    if (!control.errors?.[errorKey]) return;

    const { [errorKey]: _, ...rest } = control.errors;
    control.setErrors(Object.keys(rest).length ? rest : null);
  }

  async submit() {
    if (this.activeTab === 'fixedSalary') {
      await this.applyFixedSalary();
      return;
    }
    await this.openPreview();
  }

  async applyFixedSalary() {
    if (!(await this.validateBeforeSubmit())) {
      return;
    }

    const selectedEmployee = this.selectedEmployee!;
    const newSalary = Number(this.form.getRawValue().fixedSalary);
    const currentSalary = selectedEmployee.employmentContract?.fixedSalary ?? 0;
    if (newSalary === currentSalary) {
      this.showMessage('変更がありません。');
      return;
    }

    if (!confirm('固定給を変更します。\nよろしいですか？')) {
      return;
    }

    const employeeId = selectedEmployee.employeeId;
    const loginEmployeeId = sessionStorage.getItem('loginEmployeeId') ?? sessionStorage.getItem('employeeId') ?? '';
    const applyDate = parseDateInputValue(this.form.value.applyDate!);
    const applyMonth = await this.correctionLogicService.getWorkMonthForInputDate(applyDate);
    const revisionMonth = addMonths(applyMonth.year, applyMonth.month, 3);
    const targetPeriodStart = this.companyService.company()?.settings?.targetPeriod[0] ?? 1;
    const before = { ...selectedEmployee };
    const after: Employee = {
      ...before,
      employeeId,
      employmentContract: {
        ...before.employmentContract,
        fixedSalary: newSalary,
      },
    };

    await this.eventService.createEventWithBaseId(
      employeeId,
      buildWorkMonthEventId('固定給変更', applyDate, targetPeriodStart),
      {
        occurredDate: Timestamp.fromDate(applyDate),
        eventType: '固定給変更',
        appliedDate: Timestamp.now(),
        applicantType: '管理者',
        approval: {
          approvalStatus: '承認済み',
          approvedDate: Timestamp.now(),
          approvedBy: loginEmployeeId,
        },
        payload: { before, after },
      },
    );

    const updated = await this.employeeService.updateEmployee({
      employeeId,
      employmentContract: after.employmentContract,
    });
    if (!updated) {
      this.showMessage(UPDATE_MESSAGES.FAILED);
      return;
    }

    const runId = await this.calculationRunService.createAdHocRevisionRun(
      employeeId,
      revisionMonth,
      { before, after, fixedSalaryChangeDate: Timestamp.fromDate(applyDate) },
      Timestamp.fromDate(applyDate),
    );
    if (!runId) {
      this.showMessage('随時改定の作成に失敗しました');
      return;
    }
    this.showMessage(`固定給を${UPDATE_MESSAGES.SUCCESS}。随時改定は${revisionMonth.year}年${revisionMonth.month}月以降に確認してください。`);

    await this.employeeService.getAllEmployees(true);
    await this.refreshSelectedEmployee();
  }

  private async refreshSelectedEmployee() {
    const employeeId = this.form.value.employeeId;
    if (!employeeId) {
      this.selectedEmployee = null;
      return;
    }
    this.selectedEmployee = await this.employeeService.getEmployeeByEmployeeId(employeeId);
    await this.onEmployeeChange();
  }

  async openPreview() {
    if (!(await this.validateBeforeSubmit())) {
      return;
    }

    const applyMonth = await this.getCorrectionStartMonth();
    const working = getWorkingYearMonth();
    const afterEmployee = this.buildAfterEmployee();

    this.previewRows = await this.correctionLogicService.calculateInsuranceComparison(
      afterEmployee,
      afterEmployee.insurance!,
      applyMonth,
      working,
    );

    this.previewRemark = this.getRemarkLabel();
    this.previewModalOpen = true;
  }

  /**
   * 遡及修正を承認する
   */
  async approvePreview() {
    if (!this.selectedEmployee) return;

    const createDifferenceAdjustment = this.previewRows.length > 0;
    const applied = await this.applyCorrectionChanges(createDifferenceAdjustment);
    if (!applied) {
      return;
    }

    this.previewModalOpen = false;
    if (createDifferenceAdjustment) {
      this.showMessage(`${UPDATE_MESSAGES.SUCCESS}（${this.previewRows.length}件の差額調整を作成しました）`);
    } else {
      this.showMessage(UPDATE_MESSAGES.SUCCESS);
    }
    await this.employeeService.getAllEmployees(true);
    await this.refreshSelectedEmployee();
  }

  getNoDifferenceOnlyChangeLabel(): string {
    switch (this.activeTab) {
      case 'leave': return '産休・育休情報のみ変更します。';
      default: return '保険情報のみ変更します。';
    }
  }

  /**
   * 保険・休職の変更内容を反映する（差額調整は任意）
   */
  private async applyCorrectionChanges(createDifferenceAdjustment: boolean): Promise<boolean> {
    if (!this.selectedEmployee) return false;

    const employeeId = this.selectedEmployee.employeeId;
    const beforeEmployee = { ...this.selectedEmployee };
    const afterEmployee = this.buildAfterEmployee();
    const working = getWorkingYearMonth();
    const sourceType = this.getSourceTypeLabel();
    const loginEmployeeId = sessionStorage.getItem('loginEmployeeId') ?? sessionStorage.getItem('employeeId') ?? '';
    const beforeInsurance = beforeEmployee.insurance;
    const afterInsurance = afterEmployee.insurance!;
    const gradeChanged = (beforeInsurance?.currentGrade ?? 0) !== (afterInsurance.currentGrade ?? 0);
    const qualChanged = this.employeeDetailEventService.hasInsuranceQualificationChange(beforeInsurance, afterInsurance);

    if (this.activeTab === 'insurance' && (qualChanged || gradeChanged)) {
      const rejected = await this.employeeDetailEventService.confirmAndRejectPendingInsuranceChanges(
        employeeId,
        beforeInsurance,
        afterInsurance,
        loginEmployeeId,
      );
      if (!rejected) {
        return false;
      }

      let gradeChangeRunId: string | null | undefined;
      if (gradeChanged) {
        const targetPeriodStart = this.companyService.company()?.settings?.targetPeriod[0] ?? 1;
        gradeChangeRunId = await this.employeeDetailEventService.resolveGradeChangeRunId(
          employeeId,
          parseDateInputValue(this.form.value.applyDate!),
          targetPeriodStart,
        );
        if (gradeChangeRunId === null) {
          return false;
        }
      }

      const gradeChange = gradeChanged
        ? {
          beforeGrade: beforeInsurance?.currentGrade ?? 0,
          afterGrade: afterInsurance.currentGrade ?? 0,
          applicationDate: timestampFromDateInput(this.form.value.applyDate!),
        }
        : null;
      const runResult = await this.employeeDetailEventService.createInsuranceChangeRuns(
        employeeId,
        beforeInsurance,
        afterInsurance,
        gradeChange,
        loginEmployeeId,
        gradeChangeRunId,
        null,
      );
      if (!runResult.success) {
        this.showMessage('保険情報のシステム計算作成に失敗しました');
        return false;
      }
    }

    if (this.activeTab === 'leave') {
      const leaveEventsCreated = await this.createLeaveWorkStatusEvents(
        employeeId,
        beforeEmployee,
        afterEmployee,
        loginEmployeeId,
      );
      if (!leaveEventsCreated) {
        this.showMessage('勤務状況変更イベントの作成に失敗しました');
        return false;
      }
    }

    let updated = false;
    if (this.activeTab === 'insurance') {
      updated = await this.employeeService.updateEmployeeInsurance(employeeId, afterEmployee.insurance!);
    } else if (this.activeTab === 'leave') {
      updated = await this.employeeService.updateEmployee({
        employeeId,
        workStatus: afterEmployee.workStatus,
        leaveTypes: afterEmployee.leaveTypes,
      });
    }

    if (!updated) {
      this.showMessage(UPDATE_MESSAGES.FAILED);
      return false;
    }

    if (this.activeTab === 'insurance' && !afterEmployee.insurance?.healthInsurance?.joined) {
      const dependentsUpdated = await this.updateDependentsToNotDependent(employeeId);
      if (!dependentsUpdated) {
        this.showMessage('扶養情報の更新に失敗しました');
        return false;
      }
    }

    if (createDifferenceAdjustment && this.previewRows.length > 0) {
      await this.calculationRunService.createMonthlyDifferenceAdjustmentRuns(
        employeeId,
        sourceType,
        this.previewRemark,
        working,
        this.previewRows,
        { before: beforeEmployee, after: afterEmployee },
      );
    }

    return true;
  }

  /**
   * 遡及修正プレビューをキャンセルする
   */
  cancelPreview() {
    this.previewModalOpen = false;
  }

  private async getCorrectionStartMonth(): Promise<{ year: number; month: number }> {
    if (this.activeTab !== 'leave') {
      return await this.correctionLogicService.getWorkMonthForInputDate(parseDateInputValue(this.form.value.applyDate!));
    }

    const leaveDate = this.getLeaveCorrectionDate();
    const leaveWorkMonth = await this.correctionLogicService.getWorkMonthForInputDate(leaveDate);
    return this.isCurrentlyOnLeave()
      ? addMonths(leaveWorkMonth.year, leaveWorkMonth.month, 1)
      : leaveWorkMonth;
  }

  private getLeaveCorrectionDate(): Date {
    const value = this.isCurrentlyOnLeave()
      ? this.form.controls.leaveEndDate.value
      : this.form.controls.leaveStartDate.value;
    return parseDateInputValue(value);
  }

  private buildAfterEmployee(): Employee {
    const base = { ...this.selectedEmployee! };
    const v = this.form.getRawValue();

    if (this.activeTab === 'leave') {
      const leaveEnd = v.leaveEndDate ? parseDateInputValue(v.leaveEndDate) : null;
      const leaveStart = v.leaveStartDate ? parseDateInputValue(v.leaveStartDate) : null;

      if (leaveEnd) {
        return {
          ...base,
          workStatus: '通常勤務' as WorkStatus,
          leaveTypes: null,
        };
      }

      if (leaveStart || base.workStatus === '休職中') {
        return {
          ...base,
          workStatus: '休職中' as WorkStatus,
          leaveTypes: v.leaveTypes as LeaveType,
        };
      }

      return {
        ...base,
        workStatus: '通常勤務' as WorkStatus,
        leaveTypes: null,
      };
    }

    const insurance: EmployeeInsurance = {
      currentGrade: this.getCurrentGradeForSave(),
      healthInsurance: this.createInsuranceDetailFromForm('healthInsurance'),
      nursingCareInsurance: this.createInsuranceDetailFromForm('nursingCareInsurance'),
      employeePensionInsurance: this.createInsuranceDetailFromForm('employeePensionInsurance'),
    };

    return { ...base, insurance };
  }

  /**
   * 育休・産休修正を承認する
   */
  private async createLeaveWorkStatusEvents(
    employeeId: string,
    beforeEmployee: Employee,
    afterEmployee: Employee,
    loginEmployeeId: string,
  ): Promise<boolean> {
    const leaveStartDate = this.form.controls.leaveStartDate.value?.trim();
    const leaveEndDate = this.form.controls.leaveEndDate.value?.trim();
    const previousStart = this.leaveStartFromEvent ? this.formatDateInput(this.leaveStartFromEvent) : '';
    const previousEnd = this.leaveEndFromEvent ? this.formatDateInput(this.leaveEndFromEvent) : '';
    const targetPeriodStart = this.companyService.company()?.settings?.targetPeriod[0] ?? 1;

    if (leaveStartDate && leaveStartDate !== previousStart) {
      const before: Employee = {
        ...beforeEmployee,
        workStatus: '通常勤務',
      };
      const after: Employee = {
        ...beforeEmployee,
        workStatus: '休職中',
        leaveTypes: afterEmployee.leaveTypes,
      };
      const occurredDate = timestampFromDateInput(leaveStartDate);
      const eventId = await this.eventService.createEventWithBaseId(
        employeeId,
        buildWorkMonthEventId('勤務状況変更', occurredDate.toDate(), targetPeriodStart),
        {
          occurredDate,
          eventType: '勤務状況変更',
          changeType: '休職開始',
          appliedDate: Timestamp.now(),
          applicantType: '管理者',
          approval: {
            approvalStatus: '適用済み',
            approvedDate: Timestamp.now(),
            approvedBy: loginEmployeeId,
            appliedFromMonth: getCurrentAppliedFromMonth(),
          },
          payload: { before, after },
        },
      );
      if (!eventId) return false;
      await this.createLeaveAnnouncementIfNeeded(employeeId, {
        eventId,
        eventType: '勤務状況変更',
        changeType: '休職開始',
        occurredDate,
        payload: { before, after },
      });
    }

    if (leaveEndDate && leaveEndDate !== previousEnd) {
      const before: Employee = {
        ...afterEmployee,
        workStatus: '休職中',
        leaveTypes: afterEmployee.leaveTypes ?? beforeEmployee.leaveTypes,
      };
      const after: Employee = {
        ...afterEmployee,
        workStatus: '通常勤務',
        leaveTypes: null,
      };
      const occurredDate = timestampFromDateInput(leaveEndDate);
      const eventId = await this.eventService.createEventWithBaseId(
        employeeId,
        buildWorkMonthEventId('勤務状況変更', occurredDate.toDate(), targetPeriodStart),
        {
          occurredDate,
          eventType: '勤務状況変更',
          changeType: '休職終了',
          appliedDate: Timestamp.now(),
          applicantType: '管理者',
          approval: {
            approvalStatus: '適用済み',
            approvedDate: Timestamp.now(),
            approvedBy: loginEmployeeId,
            appliedFromMonth: getCurrentAppliedFromMonth(),
          },
          payload: { before, after },
        },
      );
      if (!eventId) return false;
      await this.createLeaveAnnouncementIfNeeded(employeeId, {
        eventId,
        eventType: '勤務状況変更',
        changeType: '休職終了',
        occurredDate,
        payload: { before, after },
      });
    }

    return true;
  }

  private async createLeaveAnnouncementIfNeeded(
    employeeId: string,
    event: Pick<Event, 'eventId' | 'eventType' | 'changeType' | 'occurredDate' | 'payload'>,
  ): Promise<void> {
    if (!this.announcementLogicService.isMaternityOrParentalLeaveEvent(event)) return;
    try {
      await this.announcementLogicService.createFromLeaveEvent(event, employeeId);
    } catch (error) {
      console.error('届け出チェックリストの作成に失敗しました', error);
    }
  }

  private createInsuranceDetailFromForm(insuranceName: InsuranceName): InsuranceDetail {
    return this.insuranceFormService.createDetailFromForm(this.form.controls[insuranceName].getRawValue());
  }

  private setupInsuranceDetailControls(insuranceName: InsuranceName) {
    const insuranceGroup = this.form.controls[insuranceName];
    this.updateInsuranceDetailControls(insuranceGroup.controls.joined.value, insuranceName);
    insuranceGroup.controls.joined.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(status => {
        this.updateInsuranceDetailControls(status, insuranceName);
        this.applyCurrentGradeRule();
      });
    insuranceGroup.controls.acquiredDate.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => insuranceGroup.controls.lostDate.updateValueAndValidity());
  }

  private updateInsuranceDetailControls(status: InsuranceStatus, insuranceName: InsuranceName) {
    this.insuranceFormService.updateInsuranceDetailControls(
      this.form.controls[insuranceName],
      status,
    );
    this.form.updateValueAndValidity({ emitEvent: false });
  }

  private syncSubInsuranceStatusesWithHealth(healthStatus: InsuranceStatus) {
    this.insuranceFormService.syncSubInsuranceStatusesWithHealth(this.form, healthStatus);
  }

  private applyCurrentGradeRule() {
    const healthStatus = this.form.controls.healthInsurance.controls.joined.value;
    this.insuranceFormService.updateCurrentGradeValidators(
      this.form.controls.currentGrade,
      healthStatus,
    );
    if (this.areAllInsuranceStatusesNotJoined()) {
      this.form.controls.currentGrade.setValue(0, { emitEvent: false });
    }
  }

  private getCurrentGradeForSave(): number {
    return this.areAllInsuranceStatusesNotJoined() ? 0 : Number(this.form.controls.currentGrade.value ?? 0);
  }

  private areAllInsuranceStatusesNotJoined(): boolean {
    return this.form.controls.healthInsurance.controls.joined.value === 'notJoined'
      && this.form.controls.nursingCareInsurance.controls.joined.value === 'notJoined'
      && this.form.controls.employeePensionInsurance.controls.joined.value === 'notJoined';
  }

  private async updateDependentsToNotDependent(employeeId: string): Promise<boolean> {
    const dependents = await this.dependentService.getDependents(employeeId);
    const activeDependents = dependents.filter(dependent => dependent.isDependent !== false);
    if (activeDependents.length === 0) return true;

    const updates: Partial<Dependent>[] = activeDependents.map(dependent => ({
      ...dependent,
      isDependent: false,
    }));
    return await this.dependentService.updateDependents(employeeId, updates);
  }

  private getSourceTypeLabel(): string {
    switch (this.activeTab) {
      case 'insurance': return '保険情報修正';
      case 'leave': return '産休・育休修正';
      default: return '';
    }
  }

  private getRemarkLabel(): string {
    switch (this.activeTab) {
      case 'insurance': return '保険情報遡及反映';
      case 'leave': return '育休免除遡及反映';
      default: return '';
    }
  }

  private formatDateInput(date?: Date): string {
    if (!date) return '';
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  private showMessage(message: string) {
    this.messageTimer = this.commonService.showTimedMessage(
      message,
      value => this.message = value,
      this.messageTimer,
    );
  }

  private filterEmployees(employees: Employee[]): Employee[] {
    const keyword = this.employeeSearchText.trim().toLowerCase();
    if (!keyword) return employees;

    return employees.filter(employee => {
      const text = `${employee.employeeId} ${employee.firstName ?? ''} ${employee.lastName ?? ''}`.toLowerCase();
      return text.includes(keyword);
    });
  }

  /** 差額調整一覧へ遷移 */
  toCorrectionList() {
    this.router.navigate(['/correction-list']);
  }
}
