import { Component, DestroyRef, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { EmployeeService } from '../../../service/Firestore/employee-service';
import { CommonService, MessageTimer } from '../../../service/common/common-service';
import { CorrectionLogicService, MonthlyInsuranceComparisonRow } from '../../../service/logic/correction-logic.service';
import { CalculationRunService } from '../../../service/Firestore/calculation-run-service';
import { EventService } from '../../../service/Firestore/event-service';
import { Employee, EmployeeInsurance, InsuranceDetail } from '../../../model/employee';
import { LeaveType, WorkStatus } from '../../../constants/model-constants';
import { addMonths, buildCurrentWorkMonthEventId, getWorkingYearMonth } from '../../../service/logic/event-id-service';
import { InsuranceFormService, InsuranceName, InsuranceStatus } from '../../../service/logic/insurance-form.service';
import { UPDATE_MESSAGES } from '../../../constants/constants';
import { Timestamp } from '@angular/fire/firestore';
import { Router } from '@angular/router';
import { DependentService } from '../../../service/Firestore/dependent-service';
import { Dependent } from '../../../model/dependent';

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
    await this.employeeService.getAllEmployees();
    this.setupInsuranceDetailControls('healthInsurance');
    this.setupInsuranceDetailControls('nursingCareInsurance');
    this.setupInsuranceDetailControls('employeePensionInsurance');
    this.setupInsuranceDependencyRules();
    this.form.controls.applyDate.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.refreshInsuranceValidatorsForApplyDate());
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
    return this.filterEmployees(this.employeeService.allActiveEmployees());
  }

  getFilteredRetiredEmployees(): Employee[] {
    return this.filterEmployees(this.employeeService.allEmployees().filter(employee => employee.workStatus === '退社済み'));
  }

  async selectEmployee() {
    await this.onEmployeeChange();
  }

  setActiveTab(tab: RetroactiveTab) {
    this.activeTab = tab;
    this.previewModalOpen = false;
  }

  /**
   * 社員情報を取得し、フォームに設定する
   */
  async onEmployeeChange() {
    const employeeId = this.form.value.employeeId;
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

    const requireConfirmed = this.activeTab !== 'fixedSalary';
    const error = await this.correctionLogicService.validateRetroactiveApplyDate(
      this.selectedEmployee.employeeId,
      new Date(applyDateValue),
      requireConfirmed,
    );

    if (error) {
      this.form.controls.applyDate.setErrors({ retroactiveApplyDate: true });
      this.form.controls.applyDate.markAsTouched();
      return false;
    }

    const existingErrors = this.form.controls.applyDate.errors;
    if (existingErrors?.['retroactiveApplyDate']) {
      const { retroactiveApplyDate: _, ...rest } = existingErrors;
      this.form.controls.applyDate.setErrors(Object.keys(rest).length ? rest : null);
    }

    return true;
  }

  private async validateBeforeSubmit(): Promise<boolean> {
    this.form.markAllAsTouched();

    if (this.form.controls.employeeId.invalid) return false;
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
    const applyDate = new Date(this.form.value.applyDate!);
    const applyMonth = await this.correctionLogicService.getWorkMonthForInputDate(applyDate);
    const revisionMonth = addMonths(applyMonth.year, applyMonth.month, 3);
    const before = { ...selectedEmployee };
    const after: Employee = {
      ...before,
      employeeId,
      employmentContract: {
        ...before.employmentContract,
        fixedSalary: newSalary,
      },
    };

    const updated = await this.employeeService.updateEmployee({
      employeeId,
      employmentContract: after.employmentContract,
    });
    if (!updated) {
      this.showMessage(UPDATE_MESSAGES.FAILED);
      return;
    }

    await this.eventService.createEventWithBaseId(
      employeeId,
      buildCurrentWorkMonthEventId('固定給変更', applyMonth),
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
    this.showMessage(`固定給を${UPDATE_MESSAGES.SUCCESS}。随時改定を確認してください。`);

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
    if (!this.selectedEmployee || this.previewRows.length === 0) return;

    const employeeId = this.selectedEmployee.employeeId;
    const beforeEmployee = { ...this.selectedEmployee };
    const afterEmployee = this.buildAfterEmployee();
    const working = getWorkingYearMonth();
    const sourceType = this.getSourceTypeLabel();
    const loginEmployeeId = sessionStorage.getItem('loginEmployeeId') ?? sessionStorage.getItem('employeeId') ?? '';
    const applyMonth = await this.getCorrectionStartMonth();

    let updated = false;
    if (this.activeTab === 'insurance') {
      updated = await this.employeeService.updateEmployeeInsurance(employeeId, afterEmployee.insurance!);
    } else {
      updated = await this.employeeService.updateEmployee({
        employeeId,
        workStatus: afterEmployee.workStatus,
        leaveTypes: afterEmployee.leaveTypes,
      });
    }

    if (!updated) {
      this.showMessage(UPDATE_MESSAGES.FAILED);
      return;
    }

    if (this.activeTab === 'leave') {
      const leaveEventsCreated = await this.createLeaveWorkStatusEvents(
        employeeId,
        beforeEmployee,
        afterEmployee,
        applyMonth,
        loginEmployeeId,
      );
      if (!leaveEventsCreated) {
        this.showMessage('勤務状況変更イベントの作成に失敗しました');
        return;
      }
    }

    if (this.activeTab === 'insurance' && !afterEmployee.insurance?.healthInsurance?.joined) {
      const dependentsUpdated = await this.updateDependentsToNotDependent(employeeId);
      if (!dependentsUpdated) {
        this.showMessage('扶養情報の更新に失敗しました');
        return;
      }
    }

    await this.calculationRunService.createMonthlyDifferenceAdjustmentRuns(
      employeeId,
      sourceType,
      this.previewRemark,
      working,
      this.previewRows,
      { before: beforeEmployee, after: afterEmployee },
    );

    this.previewModalOpen = false;
    this.showMessage(`${UPDATE_MESSAGES.SUCCESS}（${this.previewRows.length}件の差額調整を作成しました）`);
    await this.employeeService.getAllEmployees(true);
    await this.refreshSelectedEmployee();
  }

  /**
   * 遡及修正プレビューをキャンセルする
   */
  cancelPreview() {
    this.previewModalOpen = false;
  }

  private async getCorrectionStartMonth(): Promise<{ year: number; month: number }> {
    if (this.activeTab !== 'leave') {
      return await this.correctionLogicService.getWorkMonthForInputDate(new Date(this.form.value.applyDate!));
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
    return new Date(value);
  }

  private buildAfterEmployee(): Employee {
    const base = { ...this.selectedEmployee! };
    const v = this.form.getRawValue();

    if (this.activeTab === 'leave') {
      const leaveEnd = v.leaveEndDate ? new Date(v.leaveEndDate) : null;
      const leaveStart = v.leaveStartDate ? new Date(v.leaveStartDate) : null;

      if (leaveEnd) {
        return {
          ...base,
          workStatus: '通常勤務' as WorkStatus,
          leaveTypes: undefined,
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
        leaveTypes: undefined,
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

  private async createLeaveWorkStatusEvents(
    employeeId: string,
    beforeEmployee: Employee,
    afterEmployee: Employee,
    applyMonth: { year: number; month: number },
    loginEmployeeId: string,
  ): Promise<boolean> {
    const leaveStartDate = this.form.controls.leaveStartDate.value?.trim();
    const leaveEndDate = this.form.controls.leaveEndDate.value?.trim();
    const previousStart = this.leaveStartFromEvent ? this.formatDateInput(this.leaveStartFromEvent) : '';
    const previousEnd = this.leaveEndFromEvent ? this.formatDateInput(this.leaveEndFromEvent) : '';

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
      const created = await this.eventService.createEventWithBaseId(
        employeeId,
        buildCurrentWorkMonthEventId('勤務状況変更', applyMonth),
        {
          occurredDate: Timestamp.fromDate(new Date(leaveStartDate)),
          eventType: '勤務状況変更',
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
      if (!created) return false;
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
        leaveTypes: undefined,
      };
      const created = await this.eventService.createEventWithBaseId(
        employeeId,
        buildCurrentWorkMonthEventId('勤務状況変更', applyMonth),
        {
          occurredDate: Timestamp.fromDate(new Date(leaveEndDate)),
          eventType: '勤務状況変更',
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
      if (!created) return false;
    }

    return true;
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
