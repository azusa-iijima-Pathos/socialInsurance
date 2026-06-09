import { Component, DestroyRef, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { EmployeeService } from '../../../service/Firestore/employee-service';
import { CommonService, MessageTimer } from '../../../service/common/common-service';
import { CorrectionLogicService, MonthlyInsuranceComparisonRow } from '../../../service/logic/correction-logic.service';
import { CalculationRunService } from '../../../service/Firestore/calculation-run-service';
import { EventService } from '../../../service/Firestore/event-service';
import { Employee, EmployeeInsurance, InsuranceDetail } from '../../../model/employee';
import { LeaveType } from '../../../constants/model-constants';
import { addMonths, buildCurrentWorkMonthEventId, getFixedSalarySystemOccurredDate, getWorkingYearMonth } from '../../../service/logic/event-id-service';
import { UPDATE_MESSAGES } from '../../../constants/constants';
import { Timestamp } from '@angular/fire/firestore';
import { Router } from '@angular/router';
import { DependentService } from '../../../service/Firestore/dependent-service';
import { Dependent } from '../../../model/dependent';

type RetroactiveTab = 'insurance' | 'fixedSalary' | 'leave';
type InsuranceName = 'healthInsurance' | 'nursingCareInsurance' | 'employeePensionInsurance';
type InsuranceStatus = 'joined' | 'notJoined' | 'lost';

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
  commonService = inject(CommonService);
  private router = inject(Router);

  activeTab: RetroactiveTab = 'insurance';
  selectedEmployee: Employee | null = null;
  leaveStartFromEvent: Date | null = null;

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
  }

  private setupInsuranceDependencyRules() {
    this.form.setValidators(control => this.healthInsuranceDependencyValidator(control));
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
      return;
    }
    this.selectedEmployee = await this.employeeService.getEmployeeByEmployeeId(employeeId);
    if (!this.selectedEmployee) return;

    const ins = this.selectedEmployee.insurance;
    this.form.patchValue({
      currentGrade: ins?.currentGrade ?? 0,
      fixedSalary: this.selectedEmployee.employmentContract?.fixedSalary ?? 0,
      leaveTypes: (this.selectedEmployee.leaveTypes ?? '産前産後') as LeaveType,
      healthInsurance: this.toInsuranceFormValue(ins?.healthInsurance),
      nursingCareInsurance: this.toInsuranceFormValue(ins?.nursingCareInsurance),
      employeePensionInsurance: this.toInsuranceFormValue(ins?.employeePensionInsurance),
    });

    this.leaveStartFromEvent = null;
    if (this.selectedEmployee.workStatus === '休職中') {
      this.leaveStartFromEvent = await this.correctionLogicService.getLeaveStartFromEvents(employeeId);
      if (this.leaveStartFromEvent) {
        this.form.patchValue({
          leaveStartDate: this.formatDateInput(this.leaveStartFromEvent),
        });
      }
    }
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
    if (this.form.controls.applyDate.invalid) return false;

    if (!(await this.validateApplyDateControl())) {
      return false;
    }

    if (this.activeTab === 'insurance') {
      if (this.form.controls.currentGrade.invalid) return false;
      for (const name of ['healthInsurance', 'nursingCareInsurance', 'employeePensionInsurance'] as const) {
        if (this.form.controls[name].invalid) return false;
      }
      if (this.form.hasError('healthInsuranceDependency')) return false;
    }

    if (this.activeTab === 'fixedSalary') {
      if (this.form.controls.fixedSalary.invalid) return false;
    }

    if (this.activeTab === 'leave') {
      this.form.controls.leaveStartDate.setErrors(null);
    }

    return !!this.selectedEmployee;
  }

  getInsuranceStatusText(detail?: InsuranceDetail): string {
    if (!detail) return '未加入';
    if (detail.lostDate) return '喪失';
    return detail.joined ? '加入' : '未加入';
  }

  getInsuranceDateText(detail?: InsuranceDetail): string {
    if (!detail) return '';
    if (detail.lostDate) {
      return `（喪失日：${this.commonService.formatDate(detail.lostDate)}）`;
    }
    if (detail.joined && detail.acquiredDate) {
      return `（取得日：${this.commonService.formatDate(detail.acquiredDate)}）`;
    }
    return '';
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
    const loginEmployeeId = sessionStorage.getItem('employeeId') ?? '';
    const applyDate = new Date(this.form.value.applyDate!);
    const applyMonth = await this.correctionLogicService.getWorkMonthForInputDate(applyDate);
    const revisionMonth = addMonths(applyMonth.year, applyMonth.month, 3);
    const working = getWorkingYearMonth();
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

    const revisionKey = revisionMonth.year * 12 + revisionMonth.month;
    const workingKey = working.year * 12 + working.month;
    if (revisionKey <= workingKey) {
      const baseRunId = `固定給変更_${revisionMonth.year}_${String(revisionMonth.month).padStart(2, '0')}`;
      await this.calculationRunService.createSystemEventRun(
        employeeId,
        baseRunId,
        '固定給変更',
        { before, after },
        Timestamp.fromDate(getFixedSalarySystemOccurredDate(revisionMonth)),
      );
      this.showMessage(`固定給を${UPDATE_MESSAGES.SUCCESS}。適用日から3か月後の随時改定を確認してください。`);
    } else {
      this.showMessage(`固定給を${UPDATE_MESSAGES.SUCCESS}。随時改定は${revisionMonth.year}年${revisionMonth.month}月以降に反映されます。`);
    }

    this.employeeService.getAllEmployees(true);
    await this.onEmployeeChange();
  }

  async openPreview() {
    if (!(await this.validateBeforeSubmit())) {
      return;
    }

    const applyDate = new Date(this.form.value.applyDate!);
    const applyMonth = await this.correctionLogicService.getWorkMonthForInputDate(applyDate);
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
    const afterEmployee = this.buildAfterEmployee();
    const working = getWorkingYearMonth();
    const sourceType = this.getSourceTypeLabel();

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
      { before: this.selectedEmployee, after: afterEmployee },
    );

    this.previewModalOpen = false;
    this.showMessage(`${UPDATE_MESSAGES.SUCCESS}（${this.previewRows.length}件の差額調整を作成しました）`);
    this.employeeService.getAllEmployees(true);
    await this.onEmployeeChange();
  }

  /**
   * 遡及修正プレビューをキャンセルする
   */
  cancelPreview() {
    this.previewModalOpen = false;
  }

  private buildAfterEmployee(): Employee {
    const base = { ...this.selectedEmployee! };
    const v = this.form.getRawValue();

    if (this.activeTab === 'leave') {
      return {
        ...base,
        workStatus: '休職中',
        leaveTypes: v.leaveTypes as LeaveType,
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

  private createInsuranceDetailFromForm(insuranceName: InsuranceName): InsuranceDetail {
    const value = this.form.controls[insuranceName].getRawValue();
    if (value.joined === 'notJoined') {
      return { joined: false };
    }

    return {
      joined: value.joined === 'joined',
      number: value.number,
      acquiredDate: Timestamp.fromDate(new Date(value.acquiredDate)),
      ...(value.lostDate ? { lostDate: Timestamp.fromDate(new Date(value.lostDate)) } : {}),
      companyBurdenRate: value.companyBurdenRate,
    };
  }

  private toInsuranceFormValue(detail?: InsuranceDetail) {
    if (!detail) {
      return { joined: 'notJoined' as InsuranceStatus, number: '', acquiredDate: '', lostDate: '', companyBurdenRate: 50 };
    }
    if (detail.lostDate) {
      return {
        joined: 'lost' as InsuranceStatus,
        number: detail.number ?? '',
        acquiredDate: this.formatDateInput(detail.acquiredDate?.toDate()),
        lostDate: this.formatDateInput(detail.lostDate?.toDate()),
        companyBurdenRate: detail.companyBurdenRate ?? 50,
      };
    }
    if (detail.joined) {
      return {
        joined: 'joined' as InsuranceStatus,
        number: detail.number ?? '',
        acquiredDate: this.formatDateInput(detail.acquiredDate?.toDate()),
        lostDate: '',
        companyBurdenRate: detail.companyBurdenRate ?? 50,
      };
    }
    return { joined: 'notJoined' as InsuranceStatus, number: '', acquiredDate: '', lostDate: '', companyBurdenRate: 50 };
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
    const insuranceGroup = this.form.controls[insuranceName];
    const needsInsuranceDetail = status === 'joined' || status === 'lost';
    const needsLostDate = status === 'lost';

    const numberControl = insuranceGroup.controls.number;
    const acquiredDateControl = insuranceGroup.controls.acquiredDate;
    const lostDateControl = insuranceGroup.controls.lostDate;
    const companyBurdenRateControl = insuranceGroup.controls.companyBurdenRate;

    numberControl.setValidators(
      needsInsuranceDetail
        ? [Validators.required, Validators.pattern('^[a-zA-Z0-9]+$')]
        : [Validators.pattern('^[a-zA-Z0-9]+$')],
    );
    acquiredDateControl.setValidators(needsInsuranceDetail ? [Validators.required] : null);
    lostDateControl.setValidators(
      needsInsuranceDetail
        ? [needsLostDate ? Validators.required : null, this.lostDateAfterAcquiredDateValidator].filter(validator => validator !== null)
        : null,
    );
    companyBurdenRateControl.setValidators(
      needsInsuranceDetail
        ? [Validators.required, Validators.min(0), Validators.max(100)]
        : [Validators.min(0), Validators.max(100)],
    );

    for (const control of [numberControl, acquiredDateControl, lostDateControl, companyBurdenRateControl]) {
      if (needsInsuranceDetail) {
        control.enable({ emitEvent: false });
      } else {
        control.disable({ emitEvent: false });
      }
      control.updateValueAndValidity({ emitEvent: false });
    }
    this.form.updateValueAndValidity({ emitEvent: false });
  }

  private healthInsuranceDependencyValidator = (control: AbstractControl): ValidationErrors | null => {
    const healthStatus = control.get('healthInsurance.joined')?.value as InsuranceStatus | undefined;
    const nursingStatus = control.get('nursingCareInsurance.joined')?.value as InsuranceStatus | undefined;
    const pensionStatus = control.get('employeePensionInsurance.joined')?.value as InsuranceStatus | undefined;
    if (healthStatus === 'joined') return null;
    return nursingStatus === 'joined' || pensionStatus === 'joined'
      ? { healthInsuranceDependency: true }
      : null;
  };

  private syncSubInsuranceStatusesWithHealth(healthStatus: InsuranceStatus) {
    if (healthStatus === 'joined') {
      this.form.updateValueAndValidity({ emitEvent: false });
      return;
    }

    for (const name of ['nursingCareInsurance', 'employeePensionInsurance'] as const) {
      const control = this.form.controls[name].controls.joined;
      if (control.value === 'joined') {
        control.setValue(healthStatus, { emitEvent: true });
      }
    }
    this.form.updateValueAndValidity({ emitEvent: false });
  }

  isSubInsuranceJoinedDisabled(): boolean {
    return this.form.controls.healthInsurance.controls.joined.value !== 'joined';
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

  private lostDateAfterAcquiredDateValidator = (control: AbstractControl): ValidationErrors | null => {
    const lostDate = control.value;
    const acquiredDate = control.parent?.get('acquiredDate')?.value;
    if (!lostDate || !acquiredDate) return null;
    return lostDate > acquiredDate ? null : { lostDateBeforeAcquiredDate: true };
  };

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
