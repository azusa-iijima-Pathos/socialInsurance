import { CommonModule } from '@angular/common';
import { Component, DestroyRef, computed, inject } from '@angular/core';
import { AbstractControl, FormArray, FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  timestampFromDateInput,
  parseDateInputValue,
  isValidDateInputValue,
  optionalTimestampFromDateInput,
  formatTimestampForDateInput,
} from '../../../service/common/date-input.util';
import { EMPLOYMENT_CATEGORIES, EmploymentCategory, GENDERS, Gender, LEAVE_TYPES, LeaveType, RELATIONSHIPS, Relationship, WORK_STATUSES, WORK_STYLES, WorkStatus, WorkStyle, COHABITATION_TYPES, CohabitationType } from '../../../constants/model-constants';
import { DependentDisabilityStudentFields } from '../../common/dependent-disability-student-fields/dependent-disability-student-fields';
import {
  getDependentDisabilityStudentFormDefaults,
  mapDependentDisabilityStudentFromForm,
  setupDependentDisabilityStudentValidators,
} from '../../../service/common/dependent-field.util';
import { Dependent } from '../../../model/dependent';
import { Employee, EmployeeInsurance, EmploymentContract, InsuranceDetail } from '../../../model/employee';
import { CommonService, MessageTimer } from '../../../service/common/common-service';
import { ValidationService } from '../../../service/common/validation-service';
import { CompanyService } from '../../../service/Firestore/company-service';
import { DependentService } from '../../../service/Firestore/dependent-service';
import { EmployeeService } from '../../../service/Firestore/employee-service';
import { EventService } from '../../../service/Firestore/event-service';
import { OfficeService } from '../../../service/Firestore/office-service';
import { EmployeeLogicService } from '../../../service/logic/employee-logic-service';
import { InsuranceFormService } from '../../../service/logic/insurance-form.service';
import { ActivatedRoute } from '@angular/router';
import { CalculationRunService } from '../../../service/Firestore/calculation-run-service';
import { Event } from '../../../model/event';
import {
  buildDependentChangeEventBaseId,
  getCurrentApprovedWorkingMonth,
  getWorkMonthForDate,
  getWorkingYearMonth,
} from '../../../service/logic/event-id-service';
import { TempEmployee } from '../../../model/temp-employee';
import { TempEmployeeService } from '../../../service/Firestore/temp-employee-service';
import { Timestamp } from '@angular/fire/firestore';
import { CREATE_MESSAGES } from '../../../constants/constants';

type InsuranceName = 'healthInsurance' | 'nursingCareInsurance' | 'employeePensionInsurance';
type InsuranceStatus = 'joined' | 'notJoined';
type InsuranceJudgement = { isHealthInsuranceRequired?: boolean, isNursingCareInsuranceRequired?: boolean, isPensionInsuranceRequired?: boolean };
type HireStatus = '入社予定' | '入社済み';

@Component({
  selector: 'app-hire-entry',
  imports: [CommonModule, ReactiveFormsModule, FormsModule, DependentDisabilityStudentFields],
  templateUrl: './hire-entry.html',
  styleUrls: ['./hire-entry.css', '../employee-detail/employee-detail.css'],
})
export class HireEntry {

  private route = inject(ActivatedRoute);
  private fb = inject(FormBuilder);
  private destroyRef = inject(DestroyRef);
 commonService = inject(CommonService);
  private employeeService = inject(EmployeeService);
  private eventService = inject(EventService);
  private dependentService = inject(DependentService);
  private officeService = inject(OfficeService);
  private companyService = inject(CompanyService);
  private employeeLogicService = inject(EmployeeLogicService);
  private validationService = inject(ValidationService);
  private insuranceFormService = inject(InsuranceFormService);
  private calculationRunService = inject(CalculationRunService);
  private tempEmployeeService = inject(TempEmployeeService);

  WORK_STATUSES = WORK_STATUSES;
  LEAVE_TYPES = LEAVE_TYPES;
  EMPLOYMENT_CATEGORIES = EMPLOYMENT_CATEGORIES;
  WORK_STYLES = WORK_STYLES;
  GENDERS = GENDERS;
  RELATIONSHIPS = RELATIONSHIPS;
  COHABITATION_TYPES = COHABITATION_TYPES;
  officeNameMap = computed(() => this.officeService.allOfficeNameMap());

  message = '';
  scheduledListMessage = '';
  scheduledListRetroactiveMessage = '';
  isSpecificApplicableOffice = false;

  mode = this.route.snapshot.queryParamMap.get('mode');
  isExistingMode = this.mode === 'existing';
  isHireBeforeCurrentWorkPeriod = false;
  scheduledHires: TempEmployee[] = [];
  scheduledHireDateEdits: Record<string, string> = {};
  scheduledHireDateEditingIds = new Set<string>();

  // 表示用の加入判定
  autoInsuranceJudgement: InsuranceJudgement | null = null;
  autoGradeJudgement: number | null = null;

  private messageTimer: MessageTimer = null;
  private scheduledListMessageTimer: MessageTimer = null;
  private scheduledListRetroactiveMessageTimer: MessageTimer = null;

  loginEmployeeId = sessionStorage.getItem('loginEmployeeId') ?? '';

  form = this.fb.nonNullable.group({
    employeeId: ['', [Validators.required, Validators.pattern('^[a-zA-Z0-9]+$')], [this.validationService.validateEmployeeId]],
    firstName: ['', [Validators.required]],
    lastName: ['', [Validators.required]],
    birthDate: ['', [Validators.required, this.validationService.birthDateValidator]],
    gender: ['', [Validators.required]],
    hireDate: ['', [Validators.required]],
    hireStatus: ['入社予定' as HireStatus],
    workStatus: ['通常勤務' as WorkStatus],
    leaveTypes: ['' as LeaveType | ''],
    leaveStartDate: [''],
    leaveEndDate: [''],
    resignationDate: [''],
    // workStatus: ['通常勤務', [Validators.required]],
    // leaveTypes: [''],
    employmentContract: this.fb.nonNullable.group({
      employmentCategory: ['正社員', [Validators.required]],
      workStyle: ['フルタイム', [Validators.required]],
      officeId: ['', [Validators.required]],
      contractedWorkingHoursPerWeek: ['40', [Validators.required, Validators.min(0)]],
      contractedWorkingDaysPerMonth: ['20', [Validators.required, Validators.min(0)]],
      fixedSalary: ['', [Validators.required, Validators.min(0)]],
      transportationExpenses: ['', [Validators.min(0)]],
    }),
    insurance: this.fb.nonNullable.group({
      currentGrade: [0, [Validators.required, Validators.min(0), Validators.max(50)]],
      basicPensionNumber: ['', [Validators.pattern('^[a-zA-Z0-9]*$')]],
      healthInsurance: this.fb.nonNullable.group({
        joined: ['notJoined' as InsuranceStatus, [Validators.required]],
        acquiredDate: [''],
        companyBurdenRate: [50],
      }),
      nursingCareInsurance: this.fb.nonNullable.group({
        joined: ['notJoined' as InsuranceStatus, [Validators.required]],
        acquiredDate: [''],
        companyBurdenRate: [50],
      }),
      employeePensionInsurance: this.fb.nonNullable.group({
        joined: ['notJoined' as InsuranceStatus, [Validators.required]],
        acquiredDate: [''],
        companyBurdenRate: [50],
      }),
    }),
    dependents: this.fb.array<FormGroup>([]),
  });

  async ngOnInit() {
    // プルダウン表示と社員ID重複チェックに使うマスタを読み込む
    await this.officeService.getAllOffice();
    await this.employeeService.getAllEmployees(true);

    await this.commonService.getCurrentTargetPeriod();

    if (this.dependents.length === 0) {
      this.addDependent();

      this.form.controls.employmentContract.controls.employmentCategory.valueChanges
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe(category => {
          const workStyleControl =
            this.form.controls.employmentContract.controls.workStyle;
          if (category === 'パート') {
            workStyleControl.setValue('パート', { emitEvent: false });
          } else {
            workStyleControl.setValue('フルタイム', { emitEvent: false });
          }
        });
    }

    // 加入判定では会社が特定適用事業所かどうかを使う
    this.isSpecificApplicableOffice = await this.companyService.isSpecificApplicableOffice();
    await this.companyService.getCompany();
    if (!this.isExistingMode) {
      this.form.controls.hireStatus.disable({ emitEvent: false });
      await this.loadScheduledHires();
    }

    // 入力内容に応じて、必須/任意/disabled を切り替える
    this.setupTransportationExpensesValidation();
    if (this.isExistingMode) {
      this.form.controls.workStatus.setValidators([Validators.required]);
      this.setupExistingWorkStatusValidation();
    }
    this.setupInsuranceDetailControls('healthInsurance');
    this.setupInsuranceDetailControls('nursingCareInsurance');
    this.setupInsuranceDetailControls('employeePensionInsurance');
    this.setupInsuranceDependencyRules();

    // フォーム変更時に自動判定表示を更新する（入社済み時は入社日変更でフォームへ反映）
    this.form.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.updateAutoInsuranceJudgement();
        void this.updateAutoGradeJudgement();
      });
    this.form.controls.hireDate.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(hireDate => {
        void this.updateHireDateDerivedState(hireDate);
        this.patchDependentStartDatesFromHireDate(hireDate);
      });
    this.form.controls.hireStatus.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        void this.updateHireDateDerivedState(this.form.controls.hireDate.value);
      });
    if (this.form.controls.hireDate.value) {
      void this.updateHireDateDerivedState(this.form.controls.hireDate.value);
    }
    this.updateAutoInsuranceJudgement();
    await this.updateAutoGradeJudgement();
  }

  async onSubmit() {
    if (this.isExistingMode) {
      await this.registerExistingEmployee();
      return;
    }
    await this.registerHireEntry();
  }

  // 入社処理
  async registerHireEntry() {
    this.clearMessage();
    if (this.form.controls.hireStatus.value === '入社予定') {
      await this.registerScheduledHire();
      return;
    }

    this.ensureHireDatesBeforeSave();
    if (!this.isHireBeforeCurrentWorkPeriod && !this.validateHireDependentPeriods()) {
      this.form.markAllAsTouched();
      return;
    }
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const includeInsurance = !this.isHireBeforeCurrentWorkPeriod;
    const employee = this.buildEmployeeForSave({ includeInsurance: false });
    const employeeRegistered = await this.employeeService.registerEmployee(employee);
    if (!employeeRegistered) {
      this.showMessage(CREATE_MESSAGES.FAILED);
      return;
    }

    const insurance = includeInsurance ? this.createInsuranceInfo() : null;
    const dependents = includeInsurance ? this.createDependents(employee.employeeId!) : [];

    const eventsCreated = await this.createHireEvents(employee, insurance, dependents, includeInsurance);
    if (!eventsCreated) {
      this.showMessage('従業員は登録されましたが、イベントの作成に失敗しました');
      return;
    }

    this.showMessage(`社員ID：${employee.employeeId} ${employee.firstName} ${employee.lastName}さんの入社済みとして入社処理を${CREATE_MESSAGES.SUCCESS}`);
    this.resetHireFormAfterSubmit();
    await this.employeeService.getAllEmployees(true);
  }

  async registerScheduledHire() {
    this.ensureHireDatesBeforeSave();
    if (!this.validateHireDependentPeriods()) {
      this.form.markAllAsTouched();
      return;
    }
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const employee = this.buildEmployeeForSave({ includeInsurance: false });
    const insurance = this.createInsuranceInfo();
    const dependents = this.showDependentsSection() ? this.createDependents(employee.employeeId!) : [];

    const tempEmployee: Partial<TempEmployee> = {
      ...employee,
      insurance,
      tempDependents: dependents,
    };

    const registered = await this.tempEmployeeService.registerTempEmployee(tempEmployee);
    if (!registered) {
      this.showMessage(CREATE_MESSAGES.FAILED);
      return;
    }

    this.showMessage(`社員ID：${employee.employeeId} ${employee.firstName} ${employee.lastName}さんを入社予定者として${CREATE_MESSAGES.SUCCESS}`);
    this.resetHireFormAfterSubmit();
    await this.loadScheduledHires();
  }

  private resetHireFormAfterSubmit() {
    this.form.reset({ hireStatus: '入社予定' });
    this.form.controls.hireStatus.disable({ emitEvent: false });
    this.resetDependents();
    this.isHireBeforeCurrentWorkPeriod = false;
    this.form.controls.insurance.enable({ emitEvent: false });
  }

  async loadScheduledHires() {
    this.scheduledHires = await this.tempEmployeeService.getAllTempEmployees();
    this.scheduledHires.sort((left, right) => {
      const leftTime = left.hireDate?.toDate().getTime() ?? Number.MAX_SAFE_INTEGER;
      const rightTime = right.hireDate?.toDate().getTime() ?? Number.MAX_SAFE_INTEGER;
      return leftTime - rightTime;
    });
    this.scheduledHireDateEdits = {};
    this.scheduledHireDateEditingIds.clear();
    for (const temp of this.scheduledHires) {
      this.scheduledHireDateEdits[temp.employeeId] = formatTimestampForDateInput(temp.hireDate) ?? '';
    }
  }

  isScheduledHireMode(): boolean {
    return !this.isExistingMode && this.form.controls.hireStatus.value === '入社予定';
  }

  isInsuranceReadonly(): boolean {
    return this.isScheduledHireMode() && !this.isHireBeforeCurrentWorkPeriod;
  }

  showDependentsSection(): boolean {
    if (this.isExistingMode || this.isHireBeforeCurrentWorkPeriod) return false;
    const healthJoined = this.form.controls.insurance.getRawValue().healthInsurance.joined === 'joined';
    return healthJoined;
  }

  isDependentStartDateReadonly(): boolean {
    return this.isScheduledHireMode();
  }

  needsScheduledHireAttention(hireDate?: Timestamp): boolean {
    if (!hireDate) return false;
    const targetPeriodStart = this.companyService.company()?.settings?.targetPeriod[0] ?? 1;
    const hireMonth = getWorkMonthForDate(hireDate.toDate(), targetPeriodStart);
    const current = getWorkingYearMonth();
    return hireMonth.year * 12 + hireMonth.month <= current.year * 12 + current.month;
  }

  isHireDateBeforeCurrentWorkPeriod(hireDate: Timestamp): boolean {
    const targetPeriodStart = this.companyService.company()?.settings?.targetPeriod[0] ?? 1;
    const hireMonth = getWorkMonthForDate(hireDate.toDate(), targetPeriodStart);
    const current = getWorkingYearMonth();
    return hireMonth.year * 12 + hireMonth.month < current.year * 12 + current.month;
  }

  getScheduledEmployeeName(temp: TempEmployee): string {
    return `${temp.lastName ?? ''} ${temp.firstName ?? ''}`.trim();
  }

  isEditingScheduledHireDate(employeeId: string): boolean {
    return this.scheduledHireDateEditingIds.has(employeeId);
  }

  startEditingScheduledHireDate(temp: TempEmployee) {
    this.scheduledHireDateEdits[temp.employeeId] = formatTimestampForDateInput(temp.hireDate) ?? '';
    this.scheduledHireDateEditingIds.add(temp.employeeId);
  }

  async saveScheduledHireDate(temp: TempEmployee) {
    const newDate = this.scheduledHireDateEdits[temp.employeeId];
    if (!newDate) return;

    const hireDate = timestampFromDateInput(newDate);
    const tempDependents = (temp.tempDependents ?? []).map(dependent => ({
      ...dependent,
      dependentStartDate: hireDate,
    }));

    const updated = await this.tempEmployeeService.updateTempEmployee({
      employeeId: temp.employeeId,
      hireDate,
      tempDependents,
    });
    if (updated) {
      this.scheduledHireDateEditingIds.delete(temp.employeeId);
      this.showScheduledListMessage(`社員ID：${temp.employeeId} の入社日を更新しました`);
      await this.loadScheduledHires();
    } else {
      this.showScheduledListMessage('入社日の更新に失敗しました');
    }
  }

  async approveScheduledHire(temp: TempEmployee) {
    await this.companyService.getCompany();
    const hireDateStr = this.scheduledHireDateEdits[temp.employeeId];
    if (!hireDateStr) return;

    const name = this.getScheduledEmployeeName(temp);
    if (!window.confirm(`社員ID：${temp.employeeId} ${name}さんの入社を承認しますか？`)) return;

    const hireDate = timestampFromDateInput(hireDateStr);
    const beforePeriod = this.isHireDateBeforeCurrentWorkPeriod(hireDate);

    const { insurance, tempDependents, ...employeeBase } = temp;
    const employee: Partial<Employee> = {
      ...employeeBase,
      hireDate,
      workStatus: '通常勤務',
      insurance: { currentGrade: 0 },
    };

    const registered = await this.employeeService.registerEmployee(employee);
    if (!registered) {
      this.showScheduledListMessage('従業員の登録に失敗しました');
      return;
    }

    if (!beforePeriod) {
      const hireEmployee = { ...employee };
      const eventsCreated = await this.createHireEvents(
        hireEmployee,
        insurance ?? null,
        tempDependents ?? [],
        !!(insurance?.healthInsurance?.joined),
      );
      if (!eventsCreated) {
        this.showScheduledListMessage('従業員は登録されましたが、イベントの作成に失敗しました');
        return;
      }
    }

    const deleted = await this.tempEmployeeService.deleteTempEmployee(temp.employeeId);
    if (!deleted) {
      this.showScheduledListMessage('入社承認後の一時データ削除に失敗しました');
      return;
    }

    await this.employeeService.getAllEmployees(true);
    await this.loadScheduledHires();

    if (beforePeriod) {
      this.showScheduledListRetroactiveMessage(
        '入社を承認しました。<br>現在の作業対象期間より前の入社になります。<br>給与修正より保険料を算出したい月の給与を入力し、その後遡及修正より保険情報の登録をおこなってください。',
      );
    } else {
      this.showScheduledListMessage(`社員ID：${temp.employeeId} ${name}さんの入社を承認しました`);
    }
  }

  async cancelScheduledHire(temp: TempEmployee) {
    const name = this.getScheduledEmployeeName(temp);
    if (!window.confirm(`社員ID：${temp.employeeId} ${name}さんの入社予定を取り消しますか？`)) return;

    const deleted = await this.tempEmployeeService.deleteTempEmployee(temp.employeeId);
    if (deleted) {
      this.showScheduledListMessage(`社員ID：${temp.employeeId} の入社予定を取り消しました`);
      await this.loadScheduledHires();
    } else {
      this.showScheduledListMessage('入社予定の取り消しに失敗しました');
    }
  }

  async registerExistingEmployee() {
    this.clearMessage();
    this.ensureHireDatesBeforeSave();
    if (!this.validateHireDependentPeriods()) {
      this.form.markAllAsTouched();
      return;
    }
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const employee = this.buildEmployeeForSave({ includeInsurance: true });
    const employeeRegistered = await this.employeeService.registerEmployee(employee);
    if (!employeeRegistered) {
      this.showMessage(CREATE_MESSAGES.FAILED);
      return;
    }

    const dependents = this.createDependents(employee.employeeId!);
    if (dependents.length > 0) {
      const dependentsRegistered = await this.dependentService.registerDependents(employee.employeeId!, dependents);
      if (!dependentsRegistered) {
        this.showMessage('従業員は登録されましたが、扶養情報の作成に失敗しました');
        return;
      }
    }

    this.showMessage(`社員ID：${employee.employeeId} ${employee.firstName} ${employee.lastName}さんの登録を${CREATE_MESSAGES.SUCCESS}`);
    this.form.reset({ workStatus: '通常勤務' });
    this.resetDependents();
    await this.employeeService.getAllEmployees(true);
  }

  // リセット
  resetForm() {
    this.form.reset({ workStatus: '通常勤務', hireStatus: '入社予定' });
    if (!this.isExistingMode) {
      this.form.controls.hireStatus.disable({ emitEvent: false });
    }
    this.clearMessage();
    this.isHireBeforeCurrentWorkPeriod = false;
    this.form.controls.insurance.enable({ emitEvent: false });
    this.updateTransportationExpensesValidation();
    if (this.isExistingMode) {
      this.updateExistingWorkStatusValidation();
    }
    // this.updateLeaveTypesValidation();
    this.updateInsuranceDetailControls('notJoined', 'healthInsurance');
    this.updateInsuranceDetailControls('notJoined', 'nursingCareInsurance');
    this.updateInsuranceDetailControls('notJoined', 'employeePensionInsurance');
    this.resetDependents();
  }

  showLeaveFieldsForExisting(): boolean {
    return this.form.controls.workStatus.value === '休職中';
  }

  showResignationFieldForExisting(): boolean {
    const status = this.form.controls.workStatus.value;
    return status === '退社済み' || status === '退社予定';
  }

  // 通勤手当の表示/非表示
  showTransportationExpensesField() {
    const employmentContract = this.form.controls.employmentContract;
    return this.isTransportationExpensesRequired(
      employmentContract.controls.employmentCategory.value as EmploymentCategory,
      employmentContract.controls.workStyle.value as WorkStyle,
    );
  }

  // 扶養情報のFormArray
  get dependents(): FormArray {
    return this.form.controls.dependents;
  }

  // 扶養情報の追加
  addDependent() {
    this.dependents.push(this.createDependentForm());
    const hireDate = this.form.controls.hireDate.value;
    if (hireDate) {
      const lastIndex = this.dependents.length - 1;
      this.dependents.at(lastIndex).get('dependentStartDate')?.setValue(hireDate, { emitEvent: false });
    }
  }

  // 扶養情報の削除
  removeDependent(index: number) {
    this.dependents.removeAt(index);
    if (this.dependents.length === 0) {
      this.addDependent();
    }
  }

  getDependentControl(index: number, fieldName: string): AbstractControl | null {
    return this.dependents.at(index).get(fieldName);
  }

  /** 加入判定・等級判定の表示用。日付未入力でもエラーにしない */
  private buildEmployeeSnapshot(options?: { includeInsurance?: boolean }): Partial<Employee> {
    const includeInsurance = options?.includeInsurance ?? false;
    const birthDate = optionalTimestampFromDateInput(this.form.controls.birthDate.value);
    const hireDate = optionalTimestampFromDateInput(this.form.controls.hireDate.value);

    const employee: Partial<Employee> = {
      employeeId: this.form.controls.employeeId.value,
      firstName: this.form.controls.firstName.value,
      lastName: this.form.controls.lastName.value,
      gender: (this.form.controls.gender.value || undefined) as Gender | undefined,
      employmentContract: this.createEmploymentContractFromForm(),
      insurance: includeInsurance ? this.createInsuranceInfo() : { currentGrade: 0 },
      ...(birthDate ? { birthDate } : {}),
      ...(hireDate ? { hireDate } : {}),
    };

    if (this.isExistingMode) {
      employee.workStatus = this.form.controls.workStatus.value as WorkStatus;
      const leaveTypes = this.form.controls.leaveTypes.value;
      if (leaveTypes) employee.leaveTypes = leaveTypes as LeaveType;

      const leaveStartDate = optionalTimestampFromDateInput(this.form.controls.leaveStartDate.value);
      const leaveEndDate = optionalTimestampFromDateInput(this.form.controls.leaveEndDate.value);
      const resignationDate = optionalTimestampFromDateInput(this.form.controls.resignationDate.value);
      if (leaveStartDate) employee.leaveStartDate = leaveStartDate;
      if (leaveEndDate) employee.leaveEndDate = leaveEndDate;
      if (resignationDate) employee.resignationDate = resignationDate;
    } else {
      employee.workStatus = '通常勤務';
    }

    return employee;
  }

  /** Firestore 保存用。バリデーション通過後にのみ呼ぶ */
  private buildEmployeeForSave(options?: { includeInsurance?: boolean }): Partial<Employee> {
    const includeInsurance = options?.includeInsurance ?? true;

    const employee: Partial<Employee> = {
      employeeId: this.form.controls.employeeId.value,
      firstName: this.form.controls.firstName.value,
      lastName: this.form.controls.lastName.value,
      birthDate: timestampFromDateInput(this.form.controls.birthDate.value),
      gender: this.form.controls.gender.value as Gender,
      hireDate: timestampFromDateInput(this.form.controls.hireDate.value),
      employmentContract: this.createEmploymentContractFromForm(),
      insurance: includeInsurance ? this.createInsuranceInfo() : { currentGrade: 0 },
    };

    if (this.isExistingMode) {
      employee.workStatus = this.form.controls.workStatus.value as WorkStatus;
      const leaveTypes = this.form.controls.leaveTypes.value;
      if (leaveTypes) employee.leaveTypes = leaveTypes as LeaveType;

      const leaveStartDate = optionalTimestampFromDateInput(this.form.controls.leaveStartDate.value);
      const leaveEndDate = optionalTimestampFromDateInput(this.form.controls.leaveEndDate.value);
      const resignationDate = optionalTimestampFromDateInput(this.form.controls.resignationDate.value);
      if (leaveStartDate) employee.leaveStartDate = leaveStartDate;
      if (leaveEndDate) employee.leaveEndDate = leaveEndDate;
      if (resignationDate) employee.resignationDate = resignationDate;
    } else {
      employee.workStatus = '通常勤務';
    }

    return employee;
  }

  private createHireEventPayload(
    employee: Partial<Employee>,
  ): Partial<Event> {
    const { insurance, ...employeeWithoutInsurance } = employee;
    return {
      occurredDate: employee.hireDate!,
      eventType: '入社',
      appliedDate: Timestamp.now(),
      applicantType: '管理者',
      approval: {
        approvalStatus: '承認済み',
        approvedDate: Timestamp.now(),
        approvedBy: this.loginEmployeeId,
        approvedWorkingMonth: getCurrentApprovedWorkingMonth(),
      },
      payload: {
        employee: employeeWithoutInsurance,
      },
    };
  }

  private async createHireEvents(
    employee: Partial<Employee>,
    insurance: EmployeeInsurance | null,
    dependents: Partial<Dependent>[],
    includeInsurance: boolean,
  ): Promise<boolean> {
    const hireEventId = await this.eventService.createEvent(
      employee.employeeId!,
      this.createHireEventPayload(employee),
    );
    if (!hireEventId) return false;

    if (!includeInsurance || !insurance?.healthInsurance?.joined) {
      return true;
    }

    await this.companyService.getCompany();
    const targetPeriodStart = this.companyService.company()?.settings?.targetPeriod[0] ?? 1;
    const hireDate = employee.hireDate!;

    const dependentEventIds: string[] = [];
    const dependentBaseId = buildDependentChangeEventBaseId(hireDate.toDate(), targetPeriodStart);
    for (const dependent of dependents) {
      const effectiveDate = dependent.dependentStartDate ?? hireDate;
      const dependentEventId = await this.eventService.createEventWithBaseId(employee.employeeId!, dependentBaseId, {
        occurredDate: effectiveDate,
        eventType: '扶養情報変更',
        changeType: '追加',
        lifeEventType: '入社',
        appliedDate: Timestamp.now(),
        applicantType: '管理者',
        approval: {
          approvalStatus: '申請中',
        },
        payload: { before: null, after: dependent, appliedDate: effectiveDate },
      });
      if (!dependentEventId) return false;
      dependentEventIds.push(dependentEventId);
    }

    const qualificationRunId = await this.calculationRunService.createPendingHireQualificationRun(
      employee.employeeId!,
      hireDate,
      targetPeriodStart,
      insurance,
      dependentEventIds,
    );
    return !!qualificationRunId;
  }

  private async updateHireDateDerivedState(hireDate: string) {
    if (!hireDate || this.isExistingMode) return;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const target = parseDateInputValue(hireDate);
    const hireStatus: HireStatus = target >= today ? '入社予定' : '入社済み';
    if (this.form.controls.hireStatus.value !== hireStatus) {
      this.form.controls.hireStatus.setValue(hireStatus, { emitEvent: false });
    }

    await this.companyService.getCompany();
    const targetPeriodStart = this.companyService.company()?.settings?.targetPeriod[0] ?? 1;
    const hireMonth = getWorkMonthForDate(target, targetPeriodStart);
    const current = getWorkingYearMonth();
    const beforePeriod = hireMonth.year * 12 + hireMonth.month < current.year * 12 + current.month;
    this.isHireBeforeCurrentWorkPeriod = beforePeriod;

    this.updateAutoInsuranceJudgement();
    await this.updateAutoGradeJudgement();

    if (beforePeriod) {
      this.form.controls.insurance.disable({ emitEvent: false });
      return;
    }

    this.applyAutoJudgementToForm();

    if (this.isScheduledHireMode()) {
      this.form.controls.insurance.disable({ emitEvent: false });
      this.setDependentsStartDateReadonly(true);
      return;
    }

    this.form.controls.insurance.enable({ emitEvent: false });
    this.updateInsuranceDetailControls(
      this.form.controls.insurance.controls.healthInsurance.controls.joined.value,
      'healthInsurance',
    );
    this.updateInsuranceDetailControls(
      this.form.controls.insurance.controls.nursingCareInsurance.controls.joined.value,
      'nursingCareInsurance',
    );
    this.updateInsuranceDetailControls(
      this.form.controls.insurance.controls.employeePensionInsurance.controls.joined.value,
      'employeePensionInsurance',
    );
    this.setDependentsStartDateReadonly(false);
  }

  private applyAutoJudgementToForm() {
    if (this.isExistingMode || this.isHireBeforeCurrentWorkPeriod) return;

    const hireDate = this.form.controls.hireDate.value;
    if (!hireDate) return;

    const healthRequired = this.autoInsuranceJudgement?.isHealthInsuranceRequired ?? false;
    const nursingRequired = this.autoInsuranceJudgement?.isNursingCareInsuranceRequired ?? false;
    const pensionRequired = this.autoInsuranceJudgement?.isPensionInsuranceRequired ?? false;
    const grade = healthRequired ? (this.autoGradeJudgement ?? 0) : 0;

    this.form.controls.insurance.patchValue({
      currentGrade: grade,
      healthInsurance: {
        joined: healthRequired ? 'joined' : 'notJoined',
        acquiredDate: healthRequired ? hireDate : '',
        companyBurdenRate: 50,
      },
      nursingCareInsurance: {
        joined: nursingRequired ? 'joined' : 'notJoined',
        acquiredDate: nursingRequired ? hireDate : '',
        companyBurdenRate: 50,
      },
      employeePensionInsurance: {
        joined: pensionRequired ? 'joined' : 'notJoined',
        acquiredDate: pensionRequired ? hireDate : '',
        companyBurdenRate: 50,
      },
    }, { emitEvent: false });

    this.insuranceFormService.syncSubInsuranceStatusesWithHealth(
      this.form.controls.insurance,
      healthRequired ? 'joined' : 'notJoined',
    );
  }

  private setDependentsStartDateReadonly(readonly: boolean) {
    const hireDate = this.form.controls.hireDate.value;
    for (const control of this.dependents.controls) {
      const startControl = control.get('dependentStartDate');
      if (!startControl) continue;
      if (readonly) {
        if (hireDate) {
          startControl.setValue(hireDate, { emitEvent: false });
        }
        startControl.disable({ emitEvent: false });
      } else {
        startControl.enable({ emitEvent: false });
      }
    }
  }

  // 従業員保険情報を作る
  private createInsuranceInfo(): EmployeeInsurance {
    const raw = this.form.controls.insurance.getRawValue();
    return {
      currentGrade: raw.currentGrade,
      ...(raw.basicPensionNumber.trim()
        ? { basicPensionNumber: raw.basicPensionNumber.trim() }
        : {}),
      healthInsurance: this.createInsuranceDetailFromRaw('healthInsurance', raw),
      nursingCareInsurance: this.createInsuranceDetailFromRaw('nursingCareInsurance', raw),
      employeePensionInsurance: this.createInsuranceDetailFromRaw('employeePensionInsurance', raw),
    };
  }

  private createInsuranceDetailFromRaw(
    insuranceName: InsuranceName,
    raw: ReturnType<typeof this.form.controls.insurance.getRawValue>,
  ): InsuranceDetail {
    const value = raw[insuranceName];
    if (value.joined !== 'joined') {
      return { joined: false };
    }

    const acquiredDateValue = value.acquiredDate || this.form.controls.hireDate.value;
    if (!isValidDateInputValue(acquiredDateValue)) {
      return { joined: false };
    }

    return {
      joined: true,
      acquiredDate: timestampFromDateInput(acquiredDateValue),
      companyBurdenRate: value.companyBurdenRate,
    };
  }

  // 保険情報を作る
  private createInsuranceDetailFromForm(insuranceName: InsuranceName): InsuranceDetail {
    const value = this.form.controls.insurance.controls[insuranceName].getRawValue();
    if (value.joined !== 'joined') {
      return { joined: false };
    }

    const acquiredDateValue = value.acquiredDate || this.form.controls.hireDate.value;
    if (!isValidDateInputValue(acquiredDateValue)) {
      return { joined: true };
    }

    return {
      joined: true,
      acquiredDate: timestampFromDateInput(acquiredDateValue),
      companyBurdenRate: value.companyBurdenRate,
    };
  }

  // 扶養情報を作る
  private createDependents(employeeId: string): Partial<Dependent>[] {
    // 入力された扶養情報だけ、dependents サブコレクション用に変換する
    const hireDate = this.form.controls.hireDate.value;
    const dependents: Partial<Dependent>[] = [];
    this.dependents.controls.forEach((control, index) => {
      const value = control.getRawValue();
      if (!value.name && !value.birthDate && !value.relationship) return;
      if (!isValidDateInputValue(value.birthDate)) return;

      const startDateValue = value.dependentStartDate || hireDate;
      if (!isValidDateInputValue(startDateValue)) return;

      dependents.push({
        dependentId: `${index + 1}`,
        name: value.name!,
        birthDate: timestampFromDateInput(value.birthDate!),
        relationship: value.relationship! as Relationship,
        isDependent: true,
        dependentStartDate: timestampFromDateInput(startDateValue),
        ...(value.cohabitationType ? { cohabitationType: value.cohabitationType as CohabitationType } : {}),
        ...(value.annualIncome !== '' && value.annualIncome != null
          ? { annualIncome: Number(value.annualIncome) }
          : {}),
        ...(value.occupation?.trim() ? { occupation: value.occupation.trim() } : {}),
        ...mapDependentDisabilityStudentFromForm(value),
      });
    });
    return dependents;
  }

  // 扶養情報のFormGroupを作る
  private createDependentForm() {
    const disabilityStudentDefaults = getDependentDisabilityStudentFormDefaults();
    const hireDate = this.form.controls.hireDate.value;
    const group = this.fb.nonNullable.group({
      name: ['', [this.validationService.requiredIfAnyDependentFieldEntered]],
      birthDate: ['', [this.validationService.requiredIfAnyDependentFieldEntered]],
      relationship: ['' as Relationship | '', [this.validationService.requiredIfAnyDependentFieldEntered]],
      dependentStartDate: [hireDate, [this.validationService.requiredIfAnyDependentFieldEntered]],
      cohabitationType: ['' as CohabitationType | ''],
      annualIncome: [''],
      occupation: [''],
      ...disabilityStudentDefaults,
    });
    this.setupDependentRowValidation(group);
    setupDependentDisabilityStudentValidators(group, this.destroyRef);
    return group;
  }

  private patchDependentStartDatesFromHireDate(hireDate: string) {
    if (!hireDate) return;
    for (const control of this.dependents.controls) {
      control.get('dependentStartDate')?.setValue(hireDate, { emitEvent: false });
    }
  }

  private validateHireDependentPeriods(): boolean {
    const healthInsurance = this.createInsuranceDetailFromForm('healthInsurance');
    let valid = true;
    for (const control of this.dependents.controls) {
      const value = control.getRawValue();
      if (!value.name && !value.birthDate && !value.relationship) continue;
      const periodError = this.validationService.validateDependentPeriod(
        healthInsurance,
        {
          isDependent: true,
          startDate: value.dependentStartDate,
        },
      );
      if (periodError) {
        control.setErrors({ ...(control.errors ?? {}), dependentPeriod: periodError });
        control.markAllAsTouched();
        valid = false;
      }
    }
    return valid;
  }

  /** 扶養情報のバリデーションを設定 */
  private setupDependentRowValidation(group: FormGroup) {
    (['name', 'birthDate', 'relationship', 'dependentStartDate'] as const).forEach(fieldName => {
      group.get(fieldName)?.valueChanges
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe(() => this.validationService.refreshDependentRowValidation(group));
    });
  }

  // 通勤手当の入力可否を切り替える
  private setupTransportationExpensesValidation() {
    // 契約社員の時短・パートだけ、通勤手当を入力対象にする
    const employmentContract = this.form.controls.employmentContract;
    this.updateTransportationExpensesValidation();
    employmentContract.controls.employmentCategory.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.updateTransportationExpensesValidation());
    employmentContract.controls.workStyle.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.updateTransportationExpensesValidation());
  }

  // // 休職種別の入力可否を切り替える
  // private setupLeaveTypesValidation() {
  //   // 勤務状況が休職中のときだけ、休職種別を必須にする
  //   this.updateLeaveTypesValidation();
  //   this.form.controls.workStatus.valueChanges
  //     .pipe(takeUntilDestroyed(this.destroyRef))
  //     .subscribe(() => this.updateLeaveTypesValidation());
  //   this.form.controls.hireDate.valueChanges
  //     .pipe(takeUntilDestroyed(this.destroyRef))
  //     .subscribe(() => this.setAcquiredDateFromHireDate());
  // }

  private setupExistingWorkStatusValidation() {
    this.updateExistingWorkStatusValidation();
    this.form.controls.workStatus.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.updateExistingWorkStatusValidation());
  }

  private updateExistingWorkStatusValidation() {
    const workStatus = this.form.controls.workStatus.value;
    const isOnLeave = workStatus === '休職中';
    const isRetired = workStatus === '退社済み' || workStatus === '退社予定';

    const leaveTypes = this.form.controls.leaveTypes;
    const leaveStartDate = this.form.controls.leaveStartDate;
    const leaveEndDate = this.form.controls.leaveEndDate;
    const resignationDate = this.form.controls.resignationDate;

    leaveTypes.setValidators(isOnLeave ? [Validators.required] : null);
    leaveStartDate.setValidators(isOnLeave ? [Validators.required] : null);
    leaveEndDate.setValidators(null);
    resignationDate.setValidators(isRetired ? [Validators.required] : null);

    if (!isOnLeave) {
      leaveTypes.setValue('', { emitEvent: false });
      leaveStartDate.setValue('', { emitEvent: false });
      leaveEndDate.setValue('', { emitEvent: false });
    }
    if (!isRetired) {
      resignationDate.setValue('', { emitEvent: false });
    }

    for (const control of [leaveTypes, leaveStartDate, leaveEndDate, resignationDate]) {
      control.updateValueAndValidity({ emitEvent: false });
    }
  }

  // // 休職種別の必須チェックを切り替える
  // private updateLeaveTypesValidation() {
  //   // 勤務状況に応じて休職種別の必須チェックを切り替える
  //   const leaveTypesControl = this.form.controls.leaveTypes;
  //   const isLeaveTypesRequired = this.form.controls.workStatus.value === '休職中';
  //   leaveTypesControl.setValidators(isLeaveTypesRequired ? [Validators.required] : null);
  //   if (!isLeaveTypesRequired) {
  //     leaveTypesControl.setValue('', { emitEvent: false });
  //   }
  //   leaveTypesControl.updateValueAndValidity({ emitEvent: false });
  // }

  // 通勤手当の入力可否を切り替える
  private updateTransportationExpensesValidation() {
    // 雇用区分・勤務形態に応じて通勤手当の入力可否を切り替える
    const employmentContract = this.form.controls.employmentContract;
    const transportationExpensesControl = employmentContract.controls.transportationExpenses;
    const isTransportationExpensesRequired = this.isTransportationExpensesRequired(
      employmentContract.controls.employmentCategory.value as EmploymentCategory,
      employmentContract.controls.workStyle.value as WorkStyle,
    );

    transportationExpensesControl.setValidators(
      isTransportationExpensesRequired ? [Validators.required, Validators.min(0)] : [Validators.min(0)]
    );
    if (!isTransportationExpensesRequired) {
      transportationExpensesControl.setValue('', { emitEvent: false });
    }
    transportationExpensesControl.updateValueAndValidity({ emitEvent: false });
  }

  // 保険情報の入力可否を切り替える
  private setupInsuranceDetailControls(insuranceName: InsuranceName) {
    const insuranceGroup = this.form.controls.insurance.controls[insuranceName];
    this.updateInsuranceDetailControls(insuranceGroup.controls.joined.value, insuranceName);
    insuranceGroup.controls.joined.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(status => this.updateInsuranceDetailControls(status, insuranceName));
  }

  // 保険情報の入力可否を切り替える
  private updateInsuranceDetailControls(status: InsuranceStatus, insuranceName: InsuranceName) {
    // 加入の場合だけ取得日・会社負担率を必須入力にする
    const insuranceGroup = this.form.controls.insurance.controls[insuranceName];
    const needsInsuranceDetail = status === 'joined';
    const acquiredDateControl = insuranceGroup.controls.acquiredDate;
    const companyBurdenRateControl = insuranceGroup.controls.companyBurdenRate;

    acquiredDateControl.setValidators(needsInsuranceDetail ? [Validators.required] : null);
    companyBurdenRateControl.setValidators(
      needsInsuranceDetail ? [Validators.required, Validators.min(0), Validators.max(100)] : [Validators.min(0), Validators.max(100)]
    );

    for (const control of [acquiredDateControl, companyBurdenRateControl]) {
      if (needsInsuranceDetail) {
        control.enable({ emitEvent: false });
      } else {
        control.disable({ emitEvent: false });
      }
      control.updateValueAndValidity({ emitEvent: false });
    }
    if (needsInsuranceDetail && !acquiredDateControl.value && this.form.controls.hireDate.value) {
      acquiredDateControl.setValue(this.form.controls.hireDate.value, { emitEvent: false });
    }
    this.form.updateValueAndValidity({ emitEvent: false });
  }

  private setupInsuranceDependencyRules() {
    const insuranceForm = this.form.controls.insurance;
    insuranceForm.setValidators(control => this.insuranceFormService.healthInsuranceDependencyValidator(control));
    insuranceForm.controls.healthInsurance.controls.joined.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(status => {
        this.insuranceFormService.syncSubInsuranceStatusesWithHealth(insuranceForm, status);
        this.applyCurrentGradeRule();
      });

    for (const name of ['nursingCareInsurance', 'employeePensionInsurance'] as const) {
      insuranceForm.controls[name].controls.joined.valueChanges
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe(() => this.applyCurrentGradeRule());
    }

    this.applyCurrentGradeRule();
  }

  private applyCurrentGradeRule() {
    const insuranceForm = this.form.controls.insurance;
    const healthStatus = insuranceForm.controls.healthInsurance.controls.joined.value;
    this.insuranceFormService.updateCurrentGradeValidators(
      insuranceForm.controls.currentGrade,
      healthStatus,
    );
    if (this.areAllInsuranceStatusesNotJoined()) {
      insuranceForm.controls.currentGrade.setValue(0, { emitEvent: false });
    }
  }

  private areAllInsuranceStatusesNotJoined(): boolean {
    const insuranceForm = this.form.controls.insurance;
    return insuranceForm.controls.healthInsurance.controls.joined.value === 'notJoined'
      && insuranceForm.controls.nursingCareInsurance.controls.joined.value === 'notJoined'
      && insuranceForm.controls.employeePensionInsurance.controls.joined.value === 'notJoined';
  }

  getInsuranceGradeError(): string | null {
    return this.insuranceFormService.getControlErrorMessage(
      this.form.get('insurance.currentGrade'),
      '等級',
    );
  }

  isSubInsuranceJoinedDisabled(): boolean {
    return this.insuranceFormService.isSubInsuranceJoinedDisabled(
      this.form.controls.insurance.controls.healthInsurance.controls.joined.value,
    );
  }

  // 加入中の保険の取得日が空なら入社日を入れる
  private setAcquiredDateFromHireDate() {
    // 仮運用として、加入中の保険の取得日が空なら入社日を入れる
    const hireDate = this.form.controls.hireDate.value;
    if (!hireDate) return;

    (['healthInsurance', 'nursingCareInsurance', 'employeePensionInsurance'] as InsuranceName[]).forEach(insuranceName => {
      const insuranceGroup = this.form.controls.insurance.controls[insuranceName];
      if (insuranceGroup.controls.joined.value === 'joined' && !insuranceGroup.controls.acquiredDate.value) {
        insuranceGroup.controls.acquiredDate.setValue(hireDate, { emitEvent: false });
      }
    });
  }

  private ensureHireDatesBeforeSave() {
    this.setAcquiredDateFromHireDate();
    this.patchDependentStartDatesFromHireDate(this.form.controls.hireDate.value);
  }

  // 表示用の加入判定を更新する
  private updateAutoInsuranceJudgement() {
    const employee = this.buildEmployeeSnapshot();
    this.autoInsuranceJudgement = this.employeeLogicService.isInsuranceRequired(
      employee as Employee,
      this.isSpecificApplicableOffice,
    );
  }

  // 表示用の等級判定を更新する
  private async updateAutoGradeJudgement() {
    const employee = this.buildEmployeeSnapshot();
    const grade = await this.employeeLogicService.getInsuranceGradeAtNewEntry(employee as Employee);
    this.autoGradeJudgement = grade ?? null;
  }

  // 雇用契約情報を作る
  private createEmploymentContractFromForm(): Partial<EmploymentContract> {
    // 保存・判定の両方で使う雇用契約情報。通勤手当の要否は既存の表示/validationルールに従う。
    const controls = this.form.controls.employmentContract.controls;
    const transportationExpenses = this.toNumberOrUndefined(controls.transportationExpenses.value);

    return {
      employmentCategory: controls.employmentCategory.value as EmploymentCategory,
      workStyle: controls.workStyle.value as WorkStyle,
      officeId: controls.officeId.value,
      contractedWorkingHoursPerWeek: this.toNumberOrUndefined(controls.contractedWorkingHoursPerWeek.value),
      contractedWorkingDaysPerMonth: this.toNumberOrUndefined(controls.contractedWorkingDaysPerMonth.value),
      fixedSalary: this.toNumberOrUndefined(controls.fixedSalary.value),
      ...(transportationExpenses !== undefined ? { transportationExpenses } : {}),
    };
  }

  // 数値に変換する
  private toNumberOrUndefined(value: unknown): number | undefined {
    // 空文字や不正値は 0 に丸めず undefined として扱う
    if (value === '' || value === null || value === undefined) return undefined;
    const numberValue = Number(value);
    return Number.isFinite(numberValue) ? numberValue : undefined;
  }

  // 扶養情報をリセットする
  private resetDependents() {
    // リセット時も扶養入力行は1行だけ残す
    while (this.dependents.length > 0) {
      this.dependents.removeAt(0);
    }
    this.addDependent();
  }

  // 通勤手当の入力可否を判定する
  private isTransportationExpensesRequired(employmentCategory: EmploymentCategory, workStyle: WorkStyle) {
    return (employmentCategory === '契約社員' && workStyle === '時短') || employmentCategory === 'パート';
  }

  // メッセージを表示する
  private showMessage(message: string) {
    this.messageTimer = this.commonService.showTimedMessage(message, value => this.message = value, this.messageTimer);
  }

  // メッセージをクリアする
  private clearMessage() {
    this.messageTimer = this.commonService.clearTimedMessage(value => this.message = value, this.messageTimer);
  }

  private showScheduledListMessage(message: string) {
    this.scheduledListRetroactiveMessageTimer = this.commonService.clearTimedMessage(
      value => this.scheduledListRetroactiveMessage = value,
      this.scheduledListRetroactiveMessageTimer,
    );
    this.scheduledListMessageTimer = this.commonService.showTimedMessage(
      message,
      value => this.scheduledListMessage = value,
      this.scheduledListMessageTimer,
    );
  }

  private showScheduledListRetroactiveMessage(message: string) {
    this.scheduledListMessageTimer = this.commonService.clearTimedMessage(
      value => this.scheduledListMessage = value,
      this.scheduledListMessageTimer,
    );
    this.scheduledListRetroactiveMessageTimer = this.commonService.showTimedMessage(
      message,
      value => this.scheduledListRetroactiveMessage = value,
      this.scheduledListRetroactiveMessageTimer,
    );
  }

}
