import { Component, DestroyRef, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { EmployeeService } from '../../../service/Firestore/employee-service';
import { CommonService, MessageTimer } from '../../../service/common/common-service';
import { AbstractControl, FormArray, FormBuilder, FormGroup, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { FormsModule } from '@angular/forms';
import { Employee, EmployeeInsurance, EmploymentContract, InsuranceDetail } from '../../../model/employee';
import { OfficeService } from '../../../service/Firestore/office-service';
import { EmployeeLogicService } from '../../../service/logic/employee-logic-service';
import { CompanyService } from '../../../service/Firestore/company-service';
import { ActivatedRoute } from '@angular/router';
import { DependentService } from '../../../service/Firestore/dependent-service';
import { Dependent } from '../../../model/dependent';
import { EmployeeDetailEventService } from '../../../service/logic/employee-detail-event-service';
import { InsuranceFormService } from '../../../service/logic/insurance-form.service';
import { EmployeeEventApprovalService, FixedSalaryApprovalDraft, InsuranceApprovalDraft } from '../../../service/logic/employee-event-approval.service';
import { EmployeeEventDisplayService } from '../../../service/logic/employee-event-display.service';
import { EventService } from '../../../service/Firestore/event-service';
import { CalculationRunService, SystemCalculationRunItem } from '../../../service/Firestore/calculation-run-service';
import { InsuranceDisplayService } from '../../../service/logic/insurance-display.service';
import { Event as EmployeeEvent } from '../../../model/event';
import { ValidationService } from '../../../service/common/validation-service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Timestamp } from '@angular/fire/firestore';
import { UPDATE_MESSAGES } from '../../../constants/constants';
import { InsuranceSnapshotService } from '../../../service/Firestore/insurance-snapshot-service';
import { PayrollService } from '../../../service/Firestore/payroll-service';
import { Payroll } from '../../../model/payroll';
import { InsuranceSnapshot } from '../../../model/insurance-snapshot';
import { InsuranceDraftService } from '../../../service/Firestore/insurance-draft-service';
import { InsuranceDraft } from '../../../model/insurance-draft';
import { CalculationRun } from '../../../model/calculation-run';
import { getWorkingYearMonth } from '../../../service/logic/event-id-service';
import { formatTimestampForDateInput, timestampFromDateInput } from '../../../service/common/date-input.util';
import {
  EMPLOYMENT_CATEGORIES,
  EmploymentCategory,
  LEAVE_TYPES,
  LeaveType,
  RELATIONSHIPS,
  Relationship,
  COHABITATION_TYPES,
  CohabitationType,
  WORK_STATUSES,
  WORK_STYLES,
  WorkStatus,
  WorkStyle,
} from '../../../constants/model-constants';
import { DependentDisabilityStudentFields } from '../../common/dependent-disability-student-fields/dependent-disability-student-fields';
import {
  formatDisabilityForDisplay,
  formatStudentForDisplay,
  getDependentDisabilityStudentFormDefaults,
  mapDependentDisabilityStudentFromForm,
  setupDependentDisabilityStudentValidators,
} from '../../../service/common/dependent-field.util';

type InsuranceName = 'healthInsurance' | 'nursingCareInsurance' | 'employeePensionInsurance';
type InsuranceStatus = 'joined' | 'notJoined' | 'lost';
type InsuranceJudgement = {
  isHealthInsuranceRequired?: boolean;
  isNursingCareInsuranceRequired?: boolean;
  isPensionInsuranceRequired?: boolean;
};
type DependentCoverageStatus = 'dependent' | 'notDependent';
type InsuranceHistoryRow = {
  payrollId: string;
  targetMonth: string;
  paymentDate: string;
  grade: string;
  healthStatus: string;
  nursingStatus: string;
  pensionStatus: string;
  healthEmployee: number;
  healthTotal: number;
  nursingEmployee: number;
  nursingTotal: number;
  pensionEmployee: number;
  pensionTotal: number;
  allEmployee: number;
  allTotal: number;
};

type EmployeeDetailEventListItem =
  | { kind: 'event'; data: EmployeeEvent; sortTime: number }
  | { kind: 'run'; data: SystemCalculationRunItem; sortTime: number };

@Component({
  selector: 'app-employee-detail',
  imports: [CommonModule, FormsModule, ReactiveFormsModule, DependentDisabilityStudentFields],
  templateUrl: './employee-detail.html',
  styleUrl: './employee-detail.css',
})
export class EmployeeDetail {

  commonService = inject(CommonService);
  private employeeService = inject(EmployeeService);
  private officeService = inject(OfficeService);
  private employeeLogicService = inject(EmployeeLogicService);
  private companyService = inject(CompanyService);
  private route = inject(ActivatedRoute);
  private dependentService = inject(DependentService);
  private fb = inject(FormBuilder);
  private validationService = inject(ValidationService);
  private employeeDetailEventService = inject(EmployeeDetailEventService);
  private insuranceFormService = inject(InsuranceFormService);
  private employeeEventApprovalService = inject(EmployeeEventApprovalService);
  private employeeEventDisplayService = inject(EmployeeEventDisplayService);
  private eventService = inject(EventService);
  private calculationRunService = inject(CalculationRunService);
  private insuranceSnapshotService = inject(InsuranceSnapshotService);
  private payrollService = inject(PayrollService);
  private insuranceDraftService = inject(InsuranceDraftService);
  private insuranceDisplayService = inject(InsuranceDisplayService);
  private destroyRef = inject(DestroyRef);

  loginEmployeeId = sessionStorage.getItem('loginEmployeeId') ?? '';
  workingMonth = sessionStorage.getItem('workingMonth') ?? '';
  employeeEvents: EmployeeEvent[] = [];
  adHocRevisionRuns: SystemCalculationRunItem[] = [];
  eventListItems: EmployeeDetailEventListItem[] = [];
  pendingSystemRuns: SystemCalculationRunItem[] = [];
  // showEventNotice = false;

  approvalModalOpen = false;
  approvalModalType: 'fixedSalary' | 'insurance' | null = null;
  approvingEvent: EmployeeEvent | null = null;
  approvingSystemRun: SystemCalculationRunItem | null = null;
  fixedSalaryDraft: FixedSalaryApprovalDraft | null = null;
  insuranceDraft: InsuranceApprovalDraft | null = null;
  insuranceApprovalChangeDate = '';
  insuranceApprovalValidationError = '';

  WORK_STATUSES = WORK_STATUSES;
  LEAVE_TYPES = LEAVE_TYPES;
  EMPLOYMENT_CATEGORIES = EMPLOYMENT_CATEGORIES;
  WORK_STYLES = WORK_STYLES;
  RELATIONSHIPS = RELATIONSHIPS;
  COHABITATION_TYPES = COHABITATION_TYPES;

  employeeSearchText = '';

  employeeMap = this.employeeService.allEmployeeNameMap;
  officeNameMap = computed(() => this.officeService.allOfficeNameMap());

  selectedEmployeeId: string = '';
  selectedEmployee: Employee | null = null;

  dependents: Dependent[] = [];
  insuranceHistoryRows: InsuranceHistoryRow[] = [];

  message: string = '';
  private messageTimer: MessageTimer = null;

  contractModalOpen = false;
  insuranceModalOpen = false;
  dependentModalOpen = false;
  employeeReviewModalOpen = false;
  reviewingEmployeeEvent: EmployeeEvent | null = null;

  isSpecificApplicableOffice = false;
  modalAutoInsuranceJudgement: InsuranceJudgement | null = null;
  modalAutoInsuranceGrade: number | null = null;

  contractForm = this.fb.nonNullable.group({
    workStatus: ['通常勤務', [Validators.required]],
    leaveTypes: [''],
    resignationDate: [''],
    employmentContract: this.fb.nonNullable.group({
      employmentCategory: ['正社員', [Validators.required]],
      workStyle: ['フルタイム', [Validators.required]],
      officeId: ['', [Validators.required]],
      contractedWorkingHoursPerWeek: ['40', [Validators.required, Validators.min(0)]],
      contractedWorkingDaysPerMonth: ['20', [Validators.required, Validators.min(0)]],
      fixedSalary: ['', [Validators.required, Validators.min(0)]],
      transportationExpenses: ['', [Validators.min(0)]],
    }),
  });

  insuranceForm = this.fb.nonNullable.group({
    currentGrade: [0, [Validators.required, Validators.min(0), Validators.max(50)]],
    basicPensionNumber: ['', [Validators.pattern('^[a-zA-Z0-9]*$')]],
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

  dependentForm = this.fb.group({
    dependents: this.fb.array<FormGroup>([]),
  });

  autoHealthInsuranceRequired: boolean = false;
  autoNursingCareInsuranceRequired: boolean = false;
  autoPensionInsuranceRequired: boolean = false;
  autoInsuranceGrade: number | undefined;

  async ngOnInit() {
    await this.employeeService.getAllEmployees();
    await this.officeService.getAllOffice();
    this.isSpecificApplicableOffice = await this.companyService.isSpecificApplicableOffice();

    this.setupContractFormValidation();
    this.setupInsuranceFormValidation();
    this.setupWorkStyleAutoSelection();

    const employeeId = this.route.snapshot.queryParamMap.get('employeeId');
    if (employeeId) {
      this.selectedEmployeeId = employeeId;
      await this.selectEmployee(false);
    }
  }

  private setupWorkStyleAutoSelection() {
    const employmentContract = this.contractForm.controls.employmentContract;
  
    employmentContract.controls.employmentCategory.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(category => {
  
        const workStyleControl = employmentContract.controls.workStyle;
  
        if (category === 'パート') {
          workStyleControl.setValue('パート', { emitEvent: false });
        } else if (workStyleControl.value === 'パート') {
          workStyleControl.setValue('フルタイム', { emitEvent: false });
        }
      });
  }

  get dependentsArray(): FormArray<FormGroup> {
    return this.dependentForm.controls.dependents;
  }

  async onEmployeeIdChange(employeeId: string) {
    this.selectedEmployeeId = employeeId;
    if (!employeeId) {
      this.selectedEmployee = null;
      this.dependents = [];
      this.employeeEvents = [];
      this.adHocRevisionRuns = [];
      this.eventListItems = [];
      this.insuranceHistoryRows = [];
      this.pendingSystemRuns = [];
      return;
    }
    await this.selectEmployee(false);
  }

  async selectEmployee(clearMessage = true) {
    if (clearMessage) {
      this.message = '';
    }
    const employee = await this.employeeService.getEmployeeByEmployeeId(this.selectedEmployeeId);
    if (employee) {
      this.selectedEmployee = employee;
      this.dependents = await this.dependentService.getDependents(this.selectedEmployeeId);
      await this.getAutoCalculationResult();
      await this.loadEmployeeEvents();
      await this.loadInsuranceHistory();
    } else {
      this.selectedEmployee = null;
      this.dependents = [];
      this.employeeEvents = [];
      this.adHocRevisionRuns = [];
      this.eventListItems = [];
      this.insuranceHistoryRows = [];
      // this.showEventNotice = false;
      this.resetAutoCalculationResult();
      this.message = '従業員情報が見つかりませんでした';
    }
  }

  private async getAutoCalculationResult() {
    if (!this.selectedEmployee) {
      this.resetAutoCalculationResult();
      return;
    }

    /** 保険の必要性を自動判定 */
    const insuranceRequired = this.employeeLogicService.isInsuranceRequired(
      this.selectedEmployee,
      this.isSpecificApplicableOffice,
    );
    this.autoHealthInsuranceRequired = insuranceRequired.isHealthInsuranceRequired!;
    this.autoNursingCareInsuranceRequired = insuranceRequired.isNursingCareInsuranceRequired!;
    this.autoPensionInsuranceRequired = insuranceRequired.isPensionInsuranceRequired!;
    this.autoInsuranceGrade = undefined;

    /** 健康保険の等級を自動計算 */
    if (this.selectedEmployee.insurance?.healthInsurance?.joined) {
      let insuranceGrade: number | undefined;
      const year = new Date().getFullYear();
      const today = new Date();
      const juneThirty = new Date(year, 5, 30);
      if (this.selectedEmployee.insurance?.healthInsurance?.acquiredDate?.toDate().getFullYear() === year
        && today <= juneThirty) {
        insuranceGrade = await this.employeeLogicService.getInsuranceGradeAtNewEntry(this.selectedEmployee);
      } else {
        insuranceGrade = await this.employeeLogicService.getCalculationBase(this.selectedEmployee);
      }
      this.autoInsuranceGrade = insuranceGrade;
    }
  }

  private resetAutoCalculationResult() {
    this.autoHealthInsuranceRequired = false;
    this.autoNursingCareInsuranceRequired = false;
    this.autoPensionInsuranceRequired = false;
    this.autoInsuranceGrade = undefined;
  }

  getInsuranceStatus(insuranceDetail?: InsuranceDetail): string {
    if (!insuranceDetail) {
      return '未登録';
    }
    return this.insuranceFormService.getStatusForDisplay(insuranceDetail);
  }


  getFilteredActiveEmployees(): Employee[] {
    return this.filterEmployeesBySearch(
      this.employeeService.allEmployees().filter(employee => employee.workStatus !== '退社済み'),
    );
  }

  getFilteredRetiredEmployees(): Employee[] {
    return this.filterEmployeesBySearch(
      this.employeeService.allEmployees().filter(employee => employee.workStatus === '退社済み'),
    );
  }

  isRetiredEmployee(): boolean {
    return this.selectedEmployee?.workStatus === '退社済み';
  }

  private filterEmployeesBySearch(employees: Employee[]): Employee[] {
    const query = this.employeeSearchText.trim().toLowerCase();
    const sorted = [...employees].sort((left, right) => left.employeeId.localeCompare(right.employeeId));
    if (!query) return sorted;

    return sorted.filter(employee => {
      const name = `${employee.firstName ?? ''} ${employee.lastName ?? ''}`.toLowerCase();
      return employee.employeeId.toLowerCase().includes(query) || name.includes(query);
    });
  }

  editContractInfo() {
    if (this.isRetiredEmployee()) return;
    if (!this.selectedEmployee) return;

    this.contractForm.patchValue({
      workStatus: this.selectedEmployee.workStatus ?? '通常勤務',
      leaveTypes: this.selectedEmployee.leaveTypes ?? '',
      resignationDate: this.formatDateForInput(this.selectedEmployee.resignationDate),
      employmentContract: {
        employmentCategory: this.selectedEmployee.employmentContract?.employmentCategory ?? '正社員',
        workStyle: this.selectedEmployee.employmentContract?.workStyle ?? 'フルタイム',
        officeId: this.selectedEmployee.employmentContract?.officeId ?? '',
        contractedWorkingHoursPerWeek: this.selectedEmployee.employmentContract?.contractedWorkingHoursPerWeek?.toString() ?? '40',
        contractedWorkingDaysPerMonth: this.selectedEmployee.employmentContract?.contractedWorkingDaysPerMonth?.toString() ?? '20',
        fixedSalary: this.selectedEmployee.employmentContract?.fixedSalary?.toString() ?? '',
        transportationExpenses: this.selectedEmployee.employmentContract?.transportationExpenses?.toString() ?? '',
      },
    });
    this.updateLeaveTypesValidation();
    this.updateResignationDateValidation();
    this.updateTransportationExpensesValidation();
    this.contractModalOpen = true;
  }

  closeContractModal() {
    this.contractModalOpen = false;
    this.contractForm.reset();
  }

  /** 勤務状況・雇用契約情報を送信 */
  async submitContractModal() {
    if (this.contractForm.invalid) {
      this.contractForm.markAllAsTouched();
      return;
    }

    const previousEmployee: Employee = {
      ...this.selectedEmployee!,
      employmentContract: this.selectedEmployee!.employmentContract
        ? { ...this.selectedEmployee!.employmentContract }
        : undefined,
    };

    const newWorkStatus = this.contractForm.controls.workStatus.value as WorkStatus;
    const wasRetireStatus = previousEmployee.workStatus === '退社済み';
    const isNewRetireStatus = newWorkStatus === '退社済み';
    if (isNewRetireStatus && !wasRetireStatus) {
      const confirmed = window.confirm(
        '退社にした場合、情報変更ができなくなります。変更後、イベント一覧から退社イベントの承認のみ行ってください。',
      );
      if (!confirmed) return;
    } else {
      const confirmed = window.confirm(
        '勤務状況・契約情報を変更しますか？',
      );
      if (!confirmed) return;
    }

    const contractControls = this.contractForm.controls.employmentContract.controls;
    const transportationExpenses = this.toNumberOrUndefined(contractControls.transportationExpenses.value);
    const employmentContract: Partial<EmploymentContract> = {
      employmentCategory: contractControls.employmentCategory.value as EmploymentCategory,
      workStyle: contractControls.workStyle.value as WorkStyle,
      officeId: contractControls.officeId.value,
      contractedWorkingHoursPerWeek: Number(contractControls.contractedWorkingHoursPerWeek.value),
      contractedWorkingDaysPerMonth: Number(contractControls.contractedWorkingDaysPerMonth.value),
      fixedSalary: Number(contractControls.fixedSalary.value),
      ...(this.showTransportationExpensesField()
        ? { transportationExpenses: transportationExpenses ?? 0 }
        : {}),
    };

    const employee: Partial<Employee> = {
      employeeId: this.selectedEmployeeId,
      workStatus: this.contractForm.controls.workStatus.value as WorkStatus,
      ...(this.contractForm.controls.workStatus.value === '休職中'
        ? { leaveTypes: this.contractForm.controls.leaveTypes.value as LeaveType }
        : { leaveTypes: null }),
      ...(this.showResignationDateField()
        ? { resignationDate: timestampFromDateInput(this.contractForm.controls.resignationDate.value) }
        : {}),
      employmentContract,
    };

    const updatedEmployee: Employee = {
      ...previousEmployee,
      ...employee,
      employmentContract: {
        ...previousEmployee.employmentContract,
        ...employmentContract,
      },
    } as Employee;

    const result = await this.employeeService.updateEmployee(employee);
    if (!result) {
      this.showMessage(UPDATE_MESSAGES.FAILED);
      return;
    }

    const createdEventIds = await this.employeeDetailEventService.createEventsFromContractChange(
      this.selectedEmployeeId,
      previousEmployee,
      updatedEmployee,
      this.loginEmployeeId,
    );
    await this.handleCreatedEvents(createdEventIds, `勤務状況・雇用契約情報を${UPDATE_MESSAGES.SUCCESS}`);
    await this.employeeService.getAllEmployees(true);
    this.closeContractModal();
    await this.selectEmployee(false);
  }


  editInsuranceInfo() {
    if (this.isRetiredEmployee()) return;
    if (!this.selectedEmployee) return;

    const insurance = this.selectedEmployee.insurance;
    this.insuranceForm.patchValue({
      currentGrade: insurance?.currentGrade ?? 0,
      basicPensionNumber: insurance?.basicPensionNumber ?? '',
      healthInsurance: this.patchInsuranceGroup(insurance?.healthInsurance),
      nursingCareInsurance: this.patchInsuranceGroup(insurance?.nursingCareInsurance),
      employeePensionInsurance: this.patchInsuranceGroup(insurance?.employeePensionInsurance),
    });

    this.insuranceFormService.syncSharedInsuranceNumbers(this.insuranceForm);

    this.updateInsuranceDetailControls(this.insuranceForm.controls.healthInsurance.controls.joined.value, 'healthInsurance');
    this.updateInsuranceDetailControls(this.insuranceForm.controls.nursingCareInsurance.controls.joined.value, 'nursingCareInsurance');
    this.updateInsuranceDetailControls(this.insuranceForm.controls.employeePensionInsurance.controls.joined.value, 'employeePensionInsurance');
    this.syncSubInsuranceStatusesWithHealth(this.insuranceForm.controls.healthInsurance.controls.joined.value);

    void this.updateModalAutoCalculation();
    this.insuranceModalOpen = true;
  }

  closeInsuranceModal() {
    this.insuranceModalOpen = false;
    this.insuranceForm.reset();
    this.modalAutoInsuranceJudgement = null;
    this.modalAutoInsuranceGrade = null;
  }

  /** 保険情報を送信 */
  async submitInsuranceModal() {
    this.insuranceFormService.syncSharedInsuranceNumbers(this.insuranceForm);
    this.insuranceForm.updateValueAndValidity({ emitEvent: false });

    if (this.insuranceForm.invalid) {
      this.insuranceForm.markAllAsTouched();
      this.showMessage('保険情報の入力内容を確認してください');
      return;
    }

    const insuranceInfo = this.insuranceFormService.createEmployeeInsuranceForSave(this.insuranceForm, {
      currentGrade: this.getCurrentGradeForSave(),
      basicPensionNumber: this.insuranceForm.controls.basicPensionNumber.value,
    });

    if (!window.confirm('保険情報を更新しますか？')) {
      return;
    }

    const result = await this.employeeService.updateEmployeeInsurance(this.selectedEmployeeId, insuranceInfo);
    if (!result) {
      this.showMessage(UPDATE_MESSAGES.FAILED);
      return;
    }

    if (!insuranceInfo.healthInsurance?.joined) {
      const dependentsUpdated = await this.updateDependentsToNotDependent();
      if (!dependentsUpdated) {
        this.showMessage('扶養情報の更新に失敗しました');
        return;
      }
    }

    this.closeInsuranceModal();
    this.showMessage(`保険情報を${UPDATE_MESSAGES.SUCCESS}`);
    await this.employeeService.getAllEmployees(true);
    await this.selectEmployee(false);
  }

  editDependentInfo() {
    if (this.isRetiredEmployee()) return;
    if (!this.selectedEmployee) return;

    while (this.dependentsArray.length > 0) {
      this.dependentsArray.removeAt(0);
    }

    this.dependents.forEach(dependent => {
      this.dependentsArray.push(this.createExistingDependentForm(dependent));
    });
    if (this.canRegisterDependent()) {
      this.addNewDependentRow();
    }
    this.dependentModalOpen = true;
  }

  closeDependentModal() {
    this.dependentModalOpen = false;
    while (this.dependentsArray.length > 0) {
      this.dependentsArray.removeAt(0);
    }
  }

  addNewDependentRow() {
    if (!this.canRegisterDependent()) {
      this.showMessage('健康保険に加入していないため、扶養の登録はできません。');
      return;
    }
    this.dependentsArray.push(this.createNewDependentForm());
  }

  removeNewDependent(index: number) {
    const row = this.dependentsArray.at(index);
    if (row.controls['isExisting'].value) return;
    this.dependentsArray.removeAt(index);
    if (this.dependentsArray.length === 0) {
      this.addNewDependentRow();
    }
  }

  /** 扶養情報を送信 */
  async submitDependentModal() {
    if (this.dependentForm.invalid) {
      this.dependentForm.markAllAsTouched();
      this.showMessage('扶養情報の入力内容を確認してください');
      return;
    }

    const previousDependents = this.dependents.map(dependent => ({ ...dependent }));
    const existingUpdates: Partial<Dependent>[] = [];
    const newDependents: Partial<Dependent>[] = [];
    let nextId = this.getNextDependentId();

    for (const control of this.dependentsArray.controls) {
      const value = control.getRawValue();
      if (value.isExisting) {
        existingUpdates.push({
          dependentId: value.dependentId,
          name: value.name,
          birthDate: timestampFromDateInput(value.birthDate),
          relationship: value.relationship as Relationship,
          isDependent: value.isDependentStatus === 'dependent',
          ...this.mapDependentExtraFields(value),
        });
        continue;
      }

      if (!value.name && !value.birthDate && !value.relationship) continue;

      if (!this.canRegisterDependent()) {
        this.showMessage('健康保険に加入していないため、扶養の登録はできません。');
        return;
      }

      newDependents.push({
        dependentId: `${nextId++}`,
        name: value.name,
        birthDate: timestampFromDateInput(value.birthDate),
        relationship: value.relationship as Relationship,
        isDependent: true,
        ...this.mapDependentExtraFields(value),
      });
    }

    if (!this.canRegisterDependent() && existingUpdates.some(dependent => dependent.isDependent === true)) {
      this.showMessage('健康保険に加入していないため、扶養の登録はできません。');
      return;
    }

    if (existingUpdates.length > 0) {
      const updateResult = await this.dependentService.updateDependents(this.selectedEmployeeId, existingUpdates);
      if (!updateResult) {
        this.showMessage(UPDATE_MESSAGES.FAILED);
        return;
      }
    }

    if (newDependents.length > 0) {
      const createResult = await this.dependentService.registerDependents(this.selectedEmployeeId, newDependents);
      if (!createResult) {
        this.showMessage(UPDATE_MESSAGES.FAILED);
        return;
      }
    }

    this.dependents = await this.dependentService.getDependents(this.selectedEmployeeId);

    const createdEventIds = await this.employeeDetailEventService.createEventFromDependentChange(
      this.selectedEmployeeId,
      previousDependents,
      this.dependents,
      this.loginEmployeeId,
    );
    await this.handleCreatedEvents(createdEventIds, `扶養情報を${UPDATE_MESSAGES.SUCCESS}`);
    this.closeDependentModal();
  }

  async loadEmployeeEvents() {
    if (!this.selectedEmployeeId) {
      this.employeeEvents = [];
      this.pendingSystemRuns = [];
      return;
    }
    try {
      this.employeeEvents = await this.eventService.getEmployeeEventsByAppliedDateDesc(this.selectedEmployeeId);
      this.adHocRevisionRuns = await this.calculationRunService.getAdHocRevisionRunsForEmployee(this.selectedEmployeeId);
      this.pendingSystemRuns = await this.calculationRunService.getPendingSystemRunsForEmployee(this.selectedEmployeeId);
      this.eventListItems = this.buildEventListItems();
    } catch (error) {
      console.error(error);
      this.employeeEvents = [];
      this.adHocRevisionRuns = [];
      this.eventListItems = [];
      this.showMessage('イベント一覧の取得に失敗しました');
    }
  }

  private buildEventListItems(): EmployeeDetailEventListItem[] {
    const items: EmployeeDetailEventListItem[] = [
      ...this.employeeEvents.map(event => ({
        kind: 'event' as const,
        data: event,
        sortTime: this.getEventAppliedMillis(event),
      })),
      ...this.adHocRevisionRuns.map(run => ({
        kind: 'run' as const,
        data: run,
        sortTime: run.detectedDate?.toMillis() ?? 0,
      })),
    ];
    return items.sort((left, right) => right.sortTime - left.sortTime);
  }

  private getEventAppliedMillis(event: EmployeeEvent): number {
    const appliedDate = event.appliedDate as { toMillis?: () => number; seconds?: number } | undefined;
    if (!appliedDate) return 0;
    if (typeof appliedDate.toMillis === 'function') return appliedDate.toMillis();
    if (typeof appliedDate.seconds === 'number') return appliedDate.seconds * 1000;
    return 0;
  }

  getEventListItemType(item: EmployeeDetailEventListItem): string {
    return item.kind === 'run' ? '随時改定（固定給変更）' : (item.data.eventType ?? '—');
  }

  getEventListItemReason(item: EmployeeDetailEventListItem): string {
    if (item.kind === 'run') return '—';
    return item.data.lifeEventType ?? item.data.reachAgeType ?? '—';
  }

  getEventListItemApplicant(item: EmployeeDetailEventListItem): string {
    return item.kind === 'run' ? 'システム' : (item.data.applicantType ?? '');
  }

  getEventListItemAppliedDate(item: EmployeeDetailEventListItem): string {
    const date = item.kind === 'run' ? item.data.detectedDate : item.data.appliedDate;
    return this.commonService.formatDateTime(date);
  }

  getEventListItemOccurredDate(item: EmployeeDetailEventListItem): string {
    if (item.kind === 'run') {
      return this.commonService.formatDate(item.data.payload?.['occurredDate'] as Timestamp | undefined);
    }
    return this.commonService.formatDate(item.data.occurredDate);
  }

  getEventListItemApprovalStatus(item: EmployeeDetailEventListItem): string {
    return item.kind === 'run'
      ? (item.data.approval?.approvalStatus ?? '')
      : (item.data.approval?.approvalStatus ?? '');
  }

  getEventListItemApprover(item: EmployeeDetailEventListItem): string {
    const approver = item.kind === 'run'
      ? item.data.approval?.approvedBy
      : item.data.approval?.approvedBy;
    return this.commonService.getEmployeeName(approver ?? '') ?? '';
  }

  getEventListItemApprovalDate(item: EmployeeDetailEventListItem): string {
    const date = item.kind === 'run' ? item.data.approval?.approvedDate : item.data.approval?.approvedDate;
    return date ? this.commonService.formatDateTime(date) : '';
  }

  isPendingListItem(item: EmployeeDetailEventListItem): boolean {
    if (item.kind === 'run') return item.data.approval?.approvalStatus === '申請中';
    return this.isPendingEvent(item.data);
  }

  canShowEventDetail(item: EmployeeDetailEventListItem): boolean {
    if (this.isPendingListItem(item)) return false;
    if (item.kind === 'run') return true;
    return item.data.eventType !== '退社' && item.data.eventType !== '一定年齢到達';
  }

  async showListItemDetail(item: EmployeeDetailEventListItem) {
    if (item.kind === 'event') {
      this.showDetail(item.data);
      return;
    }
    let eventView = this.calculationRunService.toEventView(item.data);
    if (!item.data.payload?.['revisionSummary']) {
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
    this.detailModalEmployeeEvent = eventView;
    this.detailModalOpen = true;
  }

  async onApproveListItem(item: EmployeeDetailEventListItem) {
    if (item.kind === 'run') {
      await this.onApproveSystemRun(item.data);
      return;
    }
    await this.onApproveEvent(item.data);
  }

  async onRejectListItem(item: EmployeeDetailEventListItem) {
    if (item.kind === 'run') {
      if (!window.confirm('システム計算結果を却下しますか？')) return;
      const rejected = await this.employeeEventApprovalService.rejectSystemRun(item.data.runId, this.loginEmployeeId);
      if (rejected) {
        this.showMessage('システム計算結果を却下しました');
        await this.loadEmployeeEvents();
      } else {
        this.showMessage('却下に失敗しました');
      }
      return;
    }
    await this.onRejectEvent(item.data);
  }

  private async loadInsuranceHistory() {
    if (!this.selectedEmployee) {
      this.insuranceHistoryRows = [];
      return;
    }

    const employeeId = this.selectedEmployee.employeeId ?? this.selectedEmployeeId;
    let adjustmentRuns: CalculationRun[] = [];
    try {
      adjustmentRuns = (await this.calculationRunService.getAllCalculationRuns())
        .filter(run => run.type === '差額調整');
    } catch (error) {
      console.error('差額調整の取得に失敗しました', error);
    }

    try {
      const snapshots = await this.insuranceSnapshotService.getSnapshotsForEmployee(employeeId);
      const snapshotMap = new Map(
        snapshots
          .filter(snapshot => this.getSnapshotPayrollId(snapshot) && snapshot.type !== '賞与')
          .map(snapshot => [this.getSnapshotPayrollId(snapshot)!, snapshot]),
      );
      const payrolls = await this.payrollService.getPayrollListForEmployee(employeeId);
      const payrollMap = new Map(payrolls.map(payroll => [payroll.payrollId, payroll]));

      const payrollIds = this.buildInsuranceHistoryPayrollIds(
        snapshots,
        payrolls,
        snapshotMap.size,
      );

      const rows: InsuranceHistoryRow[] = [];
      for (const payrollId of payrollIds) {
        const snapshot = snapshotMap.get(payrollId);
        const payroll = payrollMap.get(payrollId);
        if (snapshot) {
          rows.push(this.toInsuranceHistoryRowFromSnapshot(
            snapshot,
            payroll,
            adjustmentRuns,
            employeeId,
          ));
          continue;
        }

        const draft = await this.insuranceDraftService.getDraft(payrollId, employeeId);
        if (draft && (draft.grade || draft.healthInsurance || draft.nursingCareInsurance || draft.pensionInsurance)) {
          rows.push(this.toInsuranceHistoryRowFromDraft(draft, payroll));
        }
      }

      this.insuranceHistoryRows = rows;
    } catch (error) {
      console.error(error);
      this.insuranceHistoryRows = [];
    }
  }

  private buildInsuranceHistoryPayrollIds(
    snapshots: InsuranceSnapshot[],
    payrolls: Payroll[],
    snapshotCount: number,
  ): string[] {
    const ids = new Set<string>();

    for (const snapshot of snapshots) {
      const payrollId = this.getSnapshotPayrollId(snapshot);
      if (payrollId && snapshot.type !== '賞与') {
        ids.add(payrollId);
      }
    }
    for (const payroll of payrolls) {
      if (payroll.payrollId && !payroll.payrollId.endsWith('_bonus')) {
        ids.add(payroll.payrollId);
      }
    }
    if (ids.size === 0 || snapshotCount === 0) {
      for (const payrollId of this.getRecentMonthlyPayrollIds(12)) {
        ids.add(payrollId);
      }
    }

    return [...ids]
      .sort((left, right) => right.localeCompare(left))
      .slice(0, 12);
  }

  private getRecentMonthlyPayrollIds(count: number): string[] {
    const { year, month } = getWorkingYearMonth();
    if (!year || !month) return [];

    const payrollIds: string[] = [];
    let currentYear = year;
    let currentMonth = month;
    for (let index = 0; index < count; index++) {
      payrollIds.push(`${currentYear}-${String(currentMonth).padStart(2, '0')}`);
      currentMonth--;
      if (currentMonth < 1) {
        currentMonth = 12;
        currentYear--;
      }
    }
    return payrollIds;
  }

  private toInsuranceHistoryRowFromSnapshot(
    snapshot: InsuranceSnapshot,
    payroll: Payroll | undefined,
    adjustmentRuns: CalculationRun[],
    employeeId: string,
  ): InsuranceHistoryRow {
    const payrollId = this.getSnapshotPayrollId(snapshot) ?? '';
    const confirmed = this.insuranceDisplayService.getSnapshotBreakdown(snapshot);
    const payrollAdjustmentRuns = adjustmentRuns.filter(run =>
      String(run.payload?.['employeeId'] ?? run.targetEmployeeIds ?? '') === employeeId
      && String(run.payload?.['payrollId'] ?? '') === payrollId,
    );

    let breakdown = confirmed;
    let grade = Number(snapshot.grade ?? 0);
    if (payrollAdjustmentRuns.length > 0) {
      breakdown = this.insuranceDisplayService.getAdjustedSnapshotBreakdown(
        snapshot,
        payrollAdjustmentRuns,
        employeeId,
        payrollId,
      );
      grade = this.insuranceDisplayService.getAdjustedGrade(
        snapshot,
        payrollAdjustmentRuns,
        employeeId,
        payrollId,
      ) || grade;

      const latestComparison = payrollAdjustmentRuns.at(-1)?.payload?.['comparison'] as {
        newHealth?: number;
      } | undefined;
      if (confirmed.totalInsurance > 0 && breakdown.totalInsurance === 0 && latestComparison?.newHealth === undefined) {
        breakdown = confirmed;
      }
    }

    return this.buildInsuranceHistoryRow(
      payrollId,
      payroll,
      String(grade || snapshot.grade || ''),
      breakdown,
    );
  }

  private toInsuranceHistoryRowFromDraft(
    draft: InsuranceDraft,
    payroll: Payroll | undefined,
  ): InsuranceHistoryRow {
    const payrollId = draft.payrollId;
    const targetMonth = payrollId.replace('_bonus', '');
    const allTotal = draft.healthInsurance + draft.nursingCareInsurance + draft.pensionInsurance;
    const allEmployee = draft.healthInsuranceForEmployee + draft.nursingCareInsuranceForEmployee + draft.pensionInsuranceForEmployee;

    return {
      payrollId,
      targetMonth,
      paymentDate: payroll?.paymentDate ? this.commonService.formatDate(payroll.paymentDate) : '',
      grade: String(draft.grade ?? ''),
      healthStatus: this.getHistoryStatusFromAmount(draft.healthInsurance),
      nursingStatus: this.getHistoryStatusFromAmount(draft.nursingCareInsurance),
      pensionStatus: this.getHistoryStatusFromAmount(draft.pensionInsurance),
      healthEmployee: draft.healthInsuranceForEmployee,
      healthTotal: draft.healthInsurance,
      nursingEmployee: draft.nursingCareInsuranceForEmployee,
      nursingTotal: draft.nursingCareInsurance,
      pensionEmployee: draft.pensionInsuranceForEmployee,
      pensionTotal: draft.pensionInsurance,
      allEmployee,
      allTotal,
    };
  }

  private buildInsuranceHistoryRow(
    payrollId: string,
    payroll: Payroll | undefined,
    grade: string,
    breakdown: ReturnType<InsuranceDisplayService['getSnapshotBreakdown']>,
  ): InsuranceHistoryRow {
    const targetMonth = payrollId.replace('_bonus', '');
    return {
      payrollId,
      targetMonth,
      paymentDate: payroll?.paymentDate ? this.commonService.formatDate(payroll.paymentDate) : '',
      grade,
      healthStatus: this.getHistoryStatusFromAmount(breakdown.healthInsurance),
      nursingStatus: this.getHistoryStatusFromAmount(breakdown.nursingCareInsurance),
      pensionStatus: this.getHistoryStatusFromAmount(breakdown.pensionInsurance),
      healthEmployee: breakdown.healthInsuranceForEmployee,
      healthTotal: breakdown.healthInsurance,
      nursingEmployee: breakdown.nursingCareInsuranceForEmployee,
      nursingTotal: breakdown.nursingCareInsurance,
      pensionEmployee: breakdown.pensionInsuranceForEmployee,
      pensionTotal: breakdown.pensionInsurance,
      allEmployee: breakdown.totalInsuranceForEmployee,
      allTotal: breakdown.totalInsurance,
    };
  }

  private getHistoryStatusFromAmount(amount: number): string {
    return amount > 0 ? '加入' : '未加入';
  }

  private getSnapshotPayrollId(snapshot: InsuranceSnapshot): string | undefined {
    const payrollId = snapshot.payrollId ?? snapshot.snapshotId;
    return payrollId || undefined;
  }

  exportDependentsCsv() {
    if (!this.selectedEmployee || this.dependents.length === 0) return;

    const headers = [
      '社員ID',
      '扶養者ID',
      '名前',
      '生年月日',
      '続柄',
      '扶養状況',
      '同居・別居区分',
      '収入額（年収見込み）',
      '職業',
      '障害',
      '学生',
    ];
    const rows = this.dependents.map(dependent => [
      this.selectedEmployee!.employeeId!,
      dependent.dependentId,
      dependent.name ?? '',
      this.commonService.formatDate(dependent.birthDate),
      dependent.relationship ?? '',
      this.getDependentStatusLabel(dependent.isDependent),
      dependent.cohabitationType ?? '',
      dependent.annualIncome != null ? String(dependent.annualIncome) : '',
      dependent.occupation ?? '',
      formatDisabilityForDisplay(dependent),
      formatStudentForDisplay(dependent),
    ]);

    const csv = [headers, ...rows]
      .map(row => row.map(value => this.escapeCsv(String(value ?? ''))).join(','))
      .join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `dependents-${this.selectedEmployeeId}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  exportInsuranceHistoryCsv() {
    const headers = [
      '対象月',
      '支払日',
      '等級',
      '健康保険状態',
      '健康保険個人負担額',
      '健康保険総額',
      '介護保険状態',
      '介護保険個人負担額',
      '介護保険総額',
      '厚生年金状態',
      '厚生年金個人負担額',
      '厚生年金総額',
      '全保険個人負担額',
      '全保険総額',
    ];
    const rows = this.insuranceHistoryRows.map(row => [
      row.targetMonth,
      row.paymentDate,
      row.grade,
      row.healthStatus,
      row.healthEmployee,
      row.healthTotal,
      row.nursingStatus,
      row.nursingEmployee,
      row.nursingTotal,
      row.pensionStatus,
      row.pensionEmployee,
      row.pensionTotal,
      row.allEmployee,
      row.allTotal,
    ]);
    const csv = [headers, ...rows]
      .map(row => row.map(value => this.escapeCsv(String(value ?? ''))).join(','))
      .join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `insurance-history-${this.selectedEmployeeId}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  private escapeCsv(value: string): string {
    if (!/[",\n]/.test(value)) return value;
    return `"${value.replace(/"/g, '""')}"`;
  }

  hasPendingSystemRuns(): boolean {
    return this.pendingSystemRuns.length > 0;
  }

  async onApproveSystemRun(run: SystemCalculationRunItem) {
    if (this.isRetiredEmployee()) return;
    const eventView = this.employeeEventApprovalService.buildEventViewFromRun(run);
    if (this.employeeDetailEventService.needsApprovalDialogForRun(run)) {
      if (run.eventType === '固定給変更') {
        this.fixedSalaryDraft = await this.employeeEventApprovalService.buildFixedSalaryApprovalDraft(eventView);
        this.approvalModalType = 'fixedSalary';
      } else {
        this.insuranceDraft = await this.employeeEventApprovalService.buildInsuranceApprovalDraft(eventView);
        this.approvalModalType = 'insurance';
        this.insuranceApprovalChangeDate = this.formatDateForInput(eventView.occurredDate)
          || this.formatDateForInput(Timestamp.fromDate(new Date()));
        this.insuranceApprovalValidationError = '';
      }
      this.approvingSystemRun = run;
      this.approvalModalOpen = true;
      return;
    }

    if (run.eventType === '退社') {
      if (!window.confirm('システム計算結果を承認しますか？\n退社処理を行うと保険情報の変更はできません。')) {
        return;
      }
      const approved = await this.employeeEventApprovalService.approveRetireEvent(
        this.selectedEmployeeId, eventView, this.loginEmployeeId, run.runId,
      );
      if (approved) {
        this.showMessage('システム計算結果を承認しました');
        await this.employeeService.getAllEmployees(true);
        await this.selectEmployee(false);
      } else {
        this.showMessage('承認に失敗しました');
      }
    }
  }

  showInsuranceDetail(detail?: InsuranceDetail): boolean {
    if (!detail) return false;
    return detail.joined === true || !!detail.lostDate || !!detail.number || !!detail.acquiredDate;
  }

  isInsuranceNumberMissing(detail?: InsuranceDetail, sharedNumber?: string): boolean {
    return this.insuranceFormService.isInsuranceNumberMissing(detail, sharedNumber);
  }

  isPendingEvent(event: EmployeeEvent): boolean {
    return event.approval?.approvalStatus === '申請中';
  }

  async onApproveEvent(event: EmployeeEvent) {
    if (this.isRetiredEmployee()) return;
    if (event.applicantType === '社員') {
      this.openEmployeeReview(event);
      return;
    }
    if (this.employeeDetailEventService.needsApprovalDialog(event)) {
      if (event.eventType === '固定給変更') {
        this.fixedSalaryDraft = await this.employeeEventApprovalService.buildFixedSalaryApprovalDraft(event);
        this.approvalModalType = 'fixedSalary';
      } else {
        this.insuranceDraft = await this.employeeEventApprovalService.buildInsuranceApprovalDraft(event);
        this.approvalModalType = 'insurance';
        this.insuranceApprovalChangeDate = this.formatDateForInput(event.occurredDate)
          || this.formatDateForInput(Timestamp.fromDate(new Date()));
        this.insuranceApprovalValidationError = '';
      }
      this.approvingEvent = event;
      this.approvalModalOpen = true;
      return;
    }

    let approved = false;
    if (event.eventType === '退社' && event.applicantType === 'システム') {
      return;
    } else if (event.eventType === '一定年齢到達') {
      if (!window.confirm('一定年齢到達イベントを承認しますか？\n年齢到達時の保険適用方法に沿って登録内容が変わります。')) {
        return;
      }
      approved = await this.employeeEventApprovalService.approveReachAgeEvent(
        this.selectedEmployeeId,
        event,
        this.loginEmployeeId,
      );
    } else if (event.eventType === '退社') {
      approved = await this.employeeEventApprovalService.approveRetireEvent(
        this.selectedEmployeeId,
        event,
        this.loginEmployeeId,
      );
    } else {
      approved = await this.employeeEventApprovalService.approveSimpleEvent(
        this.selectedEmployeeId,
        event,
        this.loginEmployeeId,
      );
    }

    if (approved) {
      this.showMessage('イベントを承認しました');
      await this.employeeService.getAllEmployees(true);
      await this.selectEmployee(false);
    } else {
      this.showMessage('イベントの承認に失敗しました');
    }
  }

  openEmployeeReview(event: EmployeeEvent) {
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
      this.selectedEmployeeId,
      this.reviewingEmployeeEvent,
      this.loginEmployeeId,
    );
    if (approved) {
      this.showMessage('申請内容を承認し、反映しました');
      this.closeEmployeeReview();
      await this.employeeService.getAllEmployees(true);
      await this.selectEmployee(false);
    } else {
      this.showMessage('承認・反映に失敗しました');
    }
  }

  async rejectEmployeeApplication() {
    if (!this.reviewingEmployeeEvent) return;
    await this.onRejectEvent(this.reviewingEmployeeEvent);
    this.closeEmployeeReview();
  }

  getEmployeeEventChangeLines(event: EmployeeEvent): string[] {
    return this.employeeEventDisplayService.getChangeLines(event);
  }

  /** 申請者 */
  getApplicantLabel(event: EmployeeEvent): string {
    return event.applicantType ?? '';
  }

  /** 承認者 */
  getApproverLabel(event: EmployeeEvent): string {
    return event.approval?.approvedBy ?? '';
  }

  /** 承認日 */
  getApprovalDateLabel(event: EmployeeEvent): string {
    return event.approval?.approvedDate ? this.commonService.formatDateTime(event.approval.approvedDate) : '';
  }

  async onRejectEvent(event: EmployeeEvent) {
    if (this.isRetiredEmployee()) return;
    const rejected = await this.employeeEventApprovalService.rejectEvent(
      this.selectedEmployeeId,
      event,
      this.loginEmployeeId,
    );
    if (rejected) {
      this.showMessage('イベントを却下しました');
      await this.loadEmployeeEvents();
    } else {
      this.showMessage('イベントの却下に失敗しました');
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

  async rejectApprovalModal() {
    if (!window.confirm('システム計算結果を却下しますか？')) return;
    if (this.approvingSystemRun) {
      await this.employeeEventApprovalService.rejectSystemRun(this.approvingSystemRun.runId, this.loginEmployeeId);
      await this.loadEmployeeEvents();
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

    const eventView = this.approvingSystemRun
      ? this.employeeEventApprovalService.buildEventViewFromRun(this.approvingSystemRun)
      : this.approvingEvent!;
    const runId = this.approvingSystemRun?.runId;

    let approved = false;
    if (this.approvalModalType === 'fixedSalary' && this.fixedSalaryDraft) {
      approved = await this.employeeEventApprovalService.approveFixedSalaryEvent(
        this.selectedEmployeeId, eventView, this.fixedSalaryDraft, this.loginEmployeeId, runId,
      );
    } else if (this.approvalModalType === 'insurance' && this.insuranceDraft) {
      const validationError = this.employeeEventApprovalService.validateInsuranceApprovalDraft(this.insuranceDraft);
      if (validationError) {
        this.insuranceApprovalValidationError = validationError;
        this.showMessage(validationError);
        return;
      }
      approved = await this.employeeEventApprovalService.approveInsuranceEvent(
        this.selectedEmployeeId, eventView, this.insuranceDraft, this.loginEmployeeId, runId,
      );
    }

    if (approved) {
      this.showMessage('イベントを承認しました');
      await this.employeeService.getAllEmployees(true);
      await this.selectEmployee(false);
    } else {
      this.showMessage('イベントの承認に失敗しました');
    }
    this.cancelApprovalModal();
  }

  getInsuranceStatusLabel(status: InsuranceStatus): string {
    switch (status) {
      case 'joined': return '加入';
      case 'lost': return '喪失';
      default: return '未加入';
    }
  }

  private async handleCreatedEvents(createdEventIds: string[], baseMessage: string) {
    await this.loadEmployeeEvents();

    if (this.employeeDetailEventService.hasImmediateEvent(createdEventIds)) {
      // this.showEventNotice = true;
      this.showMessage(`${baseMessage} 下記のイベント一覧から確認してください。`);
      return;
    }

    // this.showEventNotice = false;
    this.showMessage(baseMessage);
  }

  showLeaveTypesField(): boolean {
    return this.contractForm.controls.workStatus.value === '休職中';
  }

  showResignationDateField(): boolean {
    const status = this.contractForm.controls.workStatus.value;
    return status === '退社済み' || status === '退社予定';
  }

  showResignationDateDisplay(): boolean {
    const status = this.selectedEmployee?.workStatus;
    return status === '退社済み' || status === '退社予定';
  }

  showTransportationExpensesField(): boolean {
    const employmentContract = this.contractForm.controls.employmentContract;
    return this.isTransportationExpensesRequired(
      employmentContract.controls.employmentCategory.value as EmploymentCategory,
      employmentContract.controls.workStyle.value as WorkStyle,
    );
  }

  isExistingDependentRow(index: number): boolean {
    return this.dependentsArray.at(index).controls['isExisting'].value === true;
  }

  private setupContractFormValidation() {
    this.updateLeaveTypesValidation();
    this.updateResignationDateValidation();
    this.updateTransportationExpensesValidation();

    this.contractForm.controls.workStatus.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.updateLeaveTypesValidation();
        this.updateResignationDateValidation();
      });

    const employmentContract = this.contractForm.controls.employmentContract;
    employmentContract.controls.employmentCategory.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.updateTransportationExpensesValidation());
    employmentContract.controls.workStyle.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.updateTransportationExpensesValidation());
  }

  private setupInsuranceFormValidation() {
    this.setupInsuranceDetailControls('healthInsurance');
    this.setupInsuranceDetailControls('nursingCareInsurance');
    this.setupInsuranceDetailControls('employeePensionInsurance');
    this.insuranceForm.setValidators(this.insuranceFormService.healthInsuranceDependencyValidator);

    this.insuranceForm.controls.healthInsurance.controls.joined.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(status => {
        this.syncSubInsuranceStatusesWithHealth(status);
        this.applyCurrentGradeRule();
      });

    for (const name of ['nursingCareInsurance', 'employeePensionInsurance'] as const) {
      this.insuranceForm.controls[name].controls.joined.valueChanges
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe(() => this.applyCurrentGradeRule());
    }

    this.insuranceFormService.setupSharedInsuranceNumberSync(this.insuranceForm, this.destroyRef);

    this.insuranceForm.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => void this.updateModalAutoCalculation());
  }

  private setupInsuranceDetailControls(insuranceName: InsuranceName) {
    const insuranceGroup = this.insuranceForm.controls[insuranceName];
    this.updateInsuranceDetailControls(insuranceGroup.controls.joined.value, insuranceName);
    insuranceGroup.controls.joined.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(status => this.updateInsuranceDetailControls(status, insuranceName));
    insuranceGroup.controls.acquiredDate.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => insuranceGroup.controls.lostDate.updateValueAndValidity());
  }

  private updateInsuranceDetailControls(status: InsuranceStatus, insuranceName: InsuranceName) {
    this.insuranceFormService.updateInsuranceDetailControls(
      this.insuranceForm.controls[insuranceName],
      status,
    );
    this.insuranceForm.updateValueAndValidity({ emitEvent: false });
  }

  getInsuranceControlError(controlPath: string, label: string): string | null {
    return this.insuranceFormService.getControlErrorMessage(this.insuranceForm.get(controlPath), label);
  }

  private syncSubInsuranceStatusesWithHealth(healthStatus: InsuranceStatus) {
    this.insuranceFormService.syncSubInsuranceStatusesWithHealth(this.insuranceForm, healthStatus);
    this.applyCurrentGradeRule();
  }

  isSubInsuranceJoinedDisabled(): boolean {
    return this.insuranceForm.controls.healthInsurance.controls.joined.value !== 'joined';
  }

  private applyCurrentGradeRule() {
    if (this.areAllInsuranceStatusesNotJoined()) {
      this.insuranceForm.controls.currentGrade.setValue(0, { emitEvent: false });
    }
  }

  private getCurrentGradeForSave(): number {
    return this.areAllInsuranceStatusesNotJoined() ? 0 : Number(this.insuranceForm.controls.currentGrade.value ?? 0);
  }

  private areAllInsuranceStatusesNotJoined(): boolean {
    return this.insuranceForm.controls.healthInsurance.controls.joined.value === 'notJoined'
      && this.insuranceForm.controls.nursingCareInsurance.controls.joined.value === 'notJoined'
      && this.insuranceForm.controls.employeePensionInsurance.controls.joined.value === 'notJoined';
  }

  canRegisterDependent(): boolean {
    return this.selectedEmployee?.insurance?.healthInsurance?.joined === true;
  }

  private async updateDependentsToNotDependent(): Promise<boolean> {
    const activeDependents = this.dependents.filter(dependent => dependent.isDependent !== false);
    if (activeDependents.length === 0) return true;

    const updates: Partial<Dependent>[] = activeDependents.map(dependent => ({
      dependentId: dependent.dependentId,
      isDependent: false,
    }));
    const result = await this.dependentService.updateDependents(this.selectedEmployeeId, updates);
    if (result) {
      this.dependents = await this.dependentService.getDependents(this.selectedEmployeeId);
    }
    return result;
  }

  private dependentBirthDateNotFutureValidator = (control: AbstractControl): ValidationErrors | null => {
    const value = control.value;
    if (!value) return null;
    const selected = new Date(value);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    selected.setHours(0, 0, 0, 0);
    return selected <= today ? null : { futureBirthDate: true };
  };

  private updateLeaveTypesValidation() {
    const leaveTypesControl = this.contractForm.controls.leaveTypes;
    const isLeaveTypesRequired = this.contractForm.controls.workStatus.value === '休職中';
    leaveTypesControl.setValidators(isLeaveTypesRequired ? [Validators.required] : null);
    if (!isLeaveTypesRequired) {
      leaveTypesControl.setValue('', { emitEvent: false });
    }
    leaveTypesControl.updateValueAndValidity({ emitEvent: false });
  }

  private updateResignationDateValidation() {
    const resignationDateControl = this.contractForm.controls.resignationDate;
    const isRequired = this.showResignationDateField();
    resignationDateControl.setValidators(isRequired ? [Validators.required] : null);
    if (!isRequired) {
      resignationDateControl.setValue('', { emitEvent: false });
    }
    resignationDateControl.updateValueAndValidity({ emitEvent: false });
  }

  private updateTransportationExpensesValidation() {
    const employmentContract = this.contractForm.controls.employmentContract;
    const transportationExpensesControl = employmentContract.controls.transportationExpenses;
    const isRequired = this.isTransportationExpensesRequired(
      employmentContract.controls.employmentCategory.value as EmploymentCategory,
      employmentContract.controls.workStyle.value as WorkStyle,
    );

    transportationExpensesControl.setValidators(
      isRequired ? [Validators.required, Validators.min(0)] : [Validators.min(0)],
    );
    if (!isRequired) {
      transportationExpensesControl.setValue('', { emitEvent: false });
    }
    transportationExpensesControl.updateValueAndValidity({ emitEvent: false });
  }

  private async updateModalAutoCalculation() {
    if (!this.selectedEmployee) {
      this.modalAutoInsuranceJudgement = null;
      this.modalAutoInsuranceGrade = null;
      return;
    }

    const employee = this.buildEmployeeForInsuranceCalculation();
    this.modalAutoInsuranceJudgement = this.employeeLogicService.isInsuranceRequired(
      employee,
      this.isSpecificApplicableOffice,
    );

    const healthJoined = this.insuranceForm.controls.healthInsurance.controls.joined.value;
    if (healthJoined === 'joined') {
      const year = new Date().getFullYear();
      const today = new Date();
      const juneThirty = new Date(year, 5, 30);
      const acquiredDate = this.insuranceForm.controls.healthInsurance.controls.acquiredDate.value;
      let grade: number | undefined;
      if (acquiredDate && new Date(acquiredDate).getFullYear() === year && today <= juneThirty) {
        grade = await this.employeeLogicService.getInsuranceGradeAtNewEntry(employee);
      } else {
        grade = await this.employeeLogicService.getCalculationBase(employee);
      }
      this.modalAutoInsuranceGrade = grade ?? null;
    } else {
      this.modalAutoInsuranceGrade = null;
    }
  }

  private buildEmployeeForInsuranceCalculation(): Employee {
    const insuranceInfo = this.insuranceFormService.createEmployeeInsuranceForSave(this.insuranceForm, {
      currentGrade: this.insuranceForm.controls.currentGrade.value,
      basicPensionNumber: this.insuranceForm.controls.basicPensionNumber.value,
    });

    return {
      ...this.selectedEmployee!,
      insurance: insuranceInfo as EmployeeInsurance,
    };
  }

  private createInsuranceDetailFromForm(insuranceName: InsuranceName): InsuranceDetail {
    return this.insuranceFormService.createDetailFromForm(
      this.insuranceForm.controls[insuranceName].getRawValue(),
    );
  }

  private patchInsuranceGroup(detail?: InsuranceDetail) {
    return this.insuranceFormService.toFormValue(detail);
  }

  private getInsuranceStatusValue(detail?: InsuranceDetail): InsuranceStatus {
    return this.insuranceFormService.getStatusValue(detail);
  }

  getDependentStatusLabel(isDependent?: boolean): string {
    return isDependent !== false ? '扶養対象' : '扶養対象外';
  }

  formatDisabilityForDisplay(dependent: Dependent): string {
    return formatDisabilityForDisplay(dependent);
  }

  formatStudentForDisplay(dependent: Dependent): string {
    return formatStudentForDisplay(dependent);
  }

  private createExistingDependentForm(dependent: Dependent) {
    const disabilityStudentDefaults = getDependentDisabilityStudentFormDefaults(dependent);
    const group = this.fb.nonNullable.group({
      dependentId: [dependent.dependentId],
      isExisting: [true],
      name: [dependent.name ?? '', [Validators.required]],
      birthDate: [this.formatDateForInput(dependent.birthDate), [Validators.required, this.dependentBirthDateNotFutureValidator]],
      relationship: [dependent.relationship ?? ('' as Relationship | ''), [Validators.required]],
      cohabitationType: [dependent.cohabitationType ?? ('' as CohabitationType | '')],
      annualIncome: [dependent.annualIncome ?? ''],
      occupation: [dependent.occupation ?? ''],
      ...disabilityStudentDefaults,
      isDependentStatus: [(dependent.isDependent !== false ? 'dependent' : 'notDependent') as DependentCoverageStatus],
    });
    setupDependentDisabilityStudentValidators(group, this.destroyRef);
    return group;
  }

  private createNewDependentForm() {
    const disabilityStudentDefaults = getDependentDisabilityStudentFormDefaults();
    const group = this.fb.nonNullable.group({
      dependentId: [''],
      isExisting: [false],
      name: ['', [this.validationService.requiredIfAnyDependentFieldEntered]],
      birthDate: ['', [this.validationService.requiredIfAnyDependentFieldEntered, this.dependentBirthDateNotFutureValidator]],
      relationship: ['' as Relationship | '', [this.validationService.requiredIfAnyDependentFieldEntered]],
      cohabitationType: ['' as CohabitationType | ''],
      annualIncome: [''],
      occupation: [''],
      ...disabilityStudentDefaults,
      isDependentStatus: ['dependent' as DependentCoverageStatus],
    });
    this.setupDependentRowValidation(group);
    setupDependentDisabilityStudentValidators(group, this.destroyRef);
    return group;
  }

  private mapDependentExtraFields(value: Record<string, unknown>): Partial<Dependent> {
    const annualIncomeRaw = value['annualIncome'];
    const annualIncome = annualIncomeRaw === '' || annualIncomeRaw == null
      ? undefined
      : Number(annualIncomeRaw);
    return {
      cohabitationType: (value['cohabitationType'] || undefined) as CohabitationType | undefined,
      annualIncome: Number.isFinite(annualIncome) ? annualIncome : undefined,
      occupation: String(value['occupation'] ?? '').trim() || undefined,
      ...mapDependentDisabilityStudentFromForm(value),
    };
  }

  private setupDependentRowValidation(group: FormGroup) {
    (['name', 'birthDate', 'relationship'] as const).forEach(fieldName => {
      group.get(fieldName)?.valueChanges
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe(() => this.validationService.refreshDependentRowValidation(group));
    });
  }

  private getNextDependentId(): number {
    const ids = this.dependents
      .map(dependent => Number(dependent.dependentId))
      .filter(id => Number.isFinite(id));
    return ids.length > 0 ? Math.max(...ids) + 1 : 1;
  }

  private formatDateForInput(date: Timestamp | null | undefined): string {
    return formatTimestampForDateInput(date);
  }

  private isTransportationExpensesRequired(employmentCategory: EmploymentCategory, workStyle: WorkStyle) {
    return (employmentCategory === '契約社員' && workStyle === '時短') || employmentCategory === 'パート';
  }

  private toNumberOrUndefined(value: unknown): number | undefined {
    if (value === '' || value === null || value === undefined) return undefined;
    const numberValue = Number(value);
    return Number.isFinite(numberValue) ? numberValue : undefined;
  }

  private showMessage(message: string) {
    this.messageTimer = this.commonService.showTimedMessage(
      message,
      value => this.message = value,
      this.messageTimer,
    );
  }


  detailModalOpen = false;
  detailModalEmployeeEvent: EmployeeEvent | null = null;
  showDetail(employeeEvent: EmployeeEvent) {
    this.detailModalEmployeeEvent = employeeEvent;
    this.detailModalOpen = true;
  }


}
