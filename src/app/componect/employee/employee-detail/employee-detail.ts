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
import { EmployeeDetailEventService, isEmploymentContractShapeChanged, isFixedSalaryChanged } from '../../../service/logic/employee-detail-event-service';
import {
  DependentChangeEventService,
  getDependentChangeEffectiveDateInput,
} from '../../../service/logic/dependent-change-event.service';
import { InsuranceFormService } from '../../../service/logic/insurance-form.service';
import { EmployeeEventApprovalService, FixedSalaryApprovalDraft, HireInsuranceApprovalDraft, InsuranceApprovalDraft, RetireInsuranceDetailView } from '../../../service/logic/employee-event-approval.service';
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
import { InsuranceSnapshot, InsuranceEnrollmentStatuses } from '../../../model/insurance-snapshot';
import { InsuranceDraftService } from '../../../service/Firestore/insurance-draft-service';
import { InsuranceDraft } from '../../../model/insurance-draft';
import { CalculationRun } from '../../../model/calculation-run';
import { ScheduledEmploymentContractInfo, ScheduledLeaveInfo, WorkStatusChangeInput, PendingInsuranceSchedule } from '../../../service/logic/employee-detail-event-service';
import { getWorkingYearMonth, isDateAfterToday, isDateBeforeWorkPeriod, isOccurrenceDateOnOrBeforeToday, isWorkMonthAtOrAfterCurrent, isEventAtOrBeforeWorkingMonth, parseEventYearMonth, decodeAppliedFromMonth, isEmploymentChangeSystemRun } from '../../../service/logic/event-id-service';
import { formatTimestampForDateInput, parseDateInputValue, timestampFromDateInput } from '../../../service/common/date-input.util';
import {
  EMPLOYMENT_CATEGORIES,
  EmploymentCategory,
  LEAVE_TYPES,
  LeaveType,
  LifeEventType,
  RELATIONSHIPS,
  Relationship,
  COHABITATION_TYPES,
  CohabitationType,
  WORK_STATUSES,
  WORK_STYLES,
  WorkStatus,
  WorkStyle,
  DISABILITY_STATUSES,
  DISABILITY_TYPES,
  STUDENT_STATUSES,
  STUDENT_TYPES,
} from '../../../constants/model-constants';
import { DependentDisabilityStudentFields } from '../../common/dependent-disability-student-fields/dependent-disability-student-fields';
import {
  formatDisabilityForDisplay,
  formatStudentForDisplay,
  getDependentDisabilityStudentFormDefaults,
  getDependentEndDateFormDefault,
  getDependentStartDateFormDefault,
  mapDependentDisabilityStudentFromForm,
  mapDependentPeriodFromForm,
  setupDependentDisabilityStudentValidators,
  setupDependentPeriodValidators,
  validateAllDependentPeriods,
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

type InsuranceChangeHistoryRow = {
  run: SystemCalculationRunItem;
  employeeId: string;
  employeeName: string;
  typeLabel: string;
  reasonLabel: string;
  insuranceLabel: string;
  appliedMonth: string;
  detectedDate: string;
  approvalStatus: string;
  approverName: string;
  approvalDate: string;
};

type PendingSystemCalculationItem = {
  label: string;
  run: SystemCalculationRunItem;
};

const SCHEDULED_EVENT_TYPES = ['勤務状況変更', '固定給変更', '雇用形態変更', '扶養情報変更'] as const;

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
  private dependentChangeEventService = inject(DependentChangeEventService);
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
  eventListItems: EmployeeDetailEventListItem[] = [];
  scheduledSystemRunNotices: string[] = [];
  pendingSystemCalculationItems: PendingSystemCalculationItem[] = [];
  insuranceChangeHistoryRows: InsuranceChangeHistoryRow[] = [];
  employeeSystemRuns: SystemCalculationRunItem[] = [];
  // showEventNotice = false;

  DISABILITY_STATUSES = DISABILITY_STATUSES;
  DISABILITY_TYPES = DISABILITY_TYPES;
  STUDENT_STATUSES = STUDENT_STATUSES;
  STUDENT_TYPES = STUDENT_TYPES;
  workingYear = Number(sessionStorage.getItem('workingYear'));
  workingMonthNum = Number(sessionStorage.getItem('workingMonth'));

  approvalModalOpen = false;
  approvalModalType: 'fixedSalary' | 'insurance' | null = null;
  approvingEvent: EmployeeEvent | null = null;
  approvingSystemRun: SystemCalculationRunItem | null = null;
  fixedSalaryDraft: FixedSalaryApprovalDraft | null = null;
  insuranceDraft: InsuranceApprovalDraft | null = null;
  insuranceApprovalChangeDate = '';
  insuranceApprovalValidationError = '';

  WORK_STATUSES = WORK_STATUSES;
  WORK_STATUS_CHANGE_OPTIONS = ['通常勤務', '休職中'] as const;
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
  workStatusModalError = '';
  employmentContractModalError = '';
  insuranceModalError = '';
  dependentModalError = '';
  private messageTimer: MessageTimer = null;

  workStatusModalOpen = false;
  employmentContractModalOpen = false;
  insuranceModalOpen = false;
  dependentModalOpen = false;
  employeeReviewModalOpen = false;
  reviewingEmployeeEvent: EmployeeEvent | null = null;

  hireDetailModalOpen = false;
  reviewingHireRun: SystemCalculationRunItem | null = null;
  hireApprovalDraft: HireInsuranceApprovalDraft | null = null;
  hireApprovalValidationError = '';

  retireDetailModalOpen = false;
  reviewingRetireRun: SystemCalculationRunItem | null = null;
  retireInsuranceDetail: RetireInsuranceDetailView | null = null;

  scheduledReviewModalOpen = false;
  reviewingScheduledEvent: EmployeeEvent | null = null;
  reviewingScheduledSystemRun: SystemCalculationRunItem | null = null;

  insuranceHistoryDetailModalOpen = false;
  reviewingInsuranceHistoryRun: SystemCalculationRunItem | null = null;
  insuranceHistoryDraft: InsuranceApprovalDraft | null = null;

  isSpecificApplicableOffice = false;
  modalAutoInsuranceJudgement: InsuranceJudgement | null = null;
  modalAutoInsuranceGrade: number | null = null;

  scheduledLeaveInfo: ScheduledLeaveInfo | null = null;
  scheduledEmploymentContractInfo: ScheduledEmploymentContractInfo | null = null;
  gradeApplicationLabel: string | null = null;
  pendingAdHocRevisionLabel: string | null = null;
  pendingInsuranceSchedules: Partial<Record<InsuranceName, PendingInsuranceSchedule>> = {};

  workStatusForm = this.fb.nonNullable.group({
    workStatus: ['通常勤務', [Validators.required]],
    leaveTypes: [''],
    leaveStartDate: [''],
    leaveEndDate: [''],
    switchDate: [''],
    childBirthDate: [''],
    isMultipleBirth: [false],
    childName: [''],
  }, { validators: [this.workStatusMaternityValidator.bind(this)] });

  employmentContractForm = this.fb.nonNullable.group({
    effectiveDate: ['', [Validators.required]],
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
    insuranceEffectiveDate: [''],
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

    this.setupWorkStatusFormValidation();
    this.setupEmploymentContractFormValidation();
    this.setupInsuranceFormValidation();
    this.setupEmploymentWorkStyleAutoSelection();

    const employeeId = this.route.snapshot.queryParamMap.get('employeeId');
    if (employeeId) {
      this.selectedEmployeeId = employeeId;
      await this.selectEmployee(false);
    }
  }

  private setupEmploymentWorkStyleAutoSelection() {
    const employmentContract = this.employmentContractForm.controls.employmentContract;

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
      this.eventListItems = [];
      this.insuranceHistoryRows = [];
      this.scheduledSystemRunNotices = [];
      this.pendingSystemCalculationItems = [];
      this.insuranceChangeHistoryRows = [];
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
      this.eventListItems = [];
      this.insuranceHistoryRows = [];
      this.scheduledLeaveInfo = null;
      this.scheduledEmploymentContractInfo = null;
      this.gradeApplicationLabel = null;
      this.pendingAdHocRevisionLabel = null;
      this.pendingInsuranceSchedules = {};
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

  editWorkStatus() {
    if (this.isRetiredEmployee()) return;
    if (!this.selectedEmployee) return;

    this.closeOtherEditModals('workStatus');
    this.workStatusModalError = '';

    const currentStatus = this.selectedEmployee.workStatus === '休職中' ? '休職中' : '通常勤務';
    this.workStatusForm.reset({
      workStatus: currentStatus,
      leaveTypes: this.selectedEmployee.leaveTypes ?? '',
      leaveStartDate: currentStatus === '休職中'
        ? this.formatDateForInput(this.selectedEmployee.leaveStartDate)
        : '',
      leaveEndDate: currentStatus === '休職中'
        ? this.formatDateForInput(this.selectedEmployee.leaveEndDate)
        : '',
      switchDate: '',
      childBirthDate: '',
      isMultipleBirth: false,
      childName: '',
    });
    this.updateWorkStatusFieldValidation();
    this.workStatusModalOpen = true;
  }

  closeWorkStatusModal() {
    this.workStatusModalOpen = false;
    this.workStatusModalError = '';
    this.workStatusForm.reset();
  }

  editEmploymentContractInfo() {
    if (this.isRetiredEmployee()) return;
    if (!this.selectedEmployee) return;

    this.closeOtherEditModals('employment');
    this.employmentContractModalError = '';

    this.employmentContractForm.reset({
      effectiveDate: '',
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
    this.updateTransportationExpensesValidation();
    this.employmentContractModalOpen = true;
  }

  closeEmploymentContractModal() {
    this.employmentContractModalOpen = false;
    this.employmentContractModalError = '';
    this.employmentContractForm.reset();
  }

  private closeOtherEditModals(except: 'workStatus' | 'employment' | 'insurance' | 'dependent') {
    if (except !== 'workStatus') {
      this.workStatusModalOpen = false;
      this.workStatusModalError = '';
    }
    if (except !== 'employment') {
      this.employmentContractModalOpen = false;
      this.employmentContractModalError = '';
    }
    if (except !== 'insurance') {
      this.insuranceModalOpen = false;
      this.insuranceModalError = '';
    }
    if (except !== 'dependent') {
      this.dependentModalOpen = false;
      this.dependentModalError = '';
    }
  }

  async submitWorkStatusModal() {
    this.workStatusModalError = '';
    this.updateWorkStatusFieldValidation();
    if (this.workStatusForm.invalid) {
      this.workStatusForm.markAllAsTouched();
      this.workStatusModalError = '入力内容を確認してください';
      return;
    }

    const previousEmployee: Employee = { ...this.selectedEmployee! };
    const targetStatus = this.workStatusForm.controls.workStatus.value as WorkStatus;
    const currentStatus = previousEmployee.workStatus === '休職中' ? '休職中' : '通常勤務';
    const input = this.buildWorkStatusChangeInput(currentStatus, targetStatus);
    if (!input) {
      this.workStatusModalError = '変更内容がありません';
      return;
    }

    if (input.scenario === 'leaveModify' && currentStatus === '休職中') {
      const currentStart = this.formatDateForInput(this.selectedEmployee?.leaveStartDate);
      const newStart = this.workStatusForm.controls.leaveStartDate.value;
      if (newStart && newStart !== currentStart) {
        this.workStatusModalError = '休職中は休職開始日を変更できません';
        return;
      }
    }

    const dateError = await this.validateWorkStatusDates(input);
    if (dateError) {
      this.workStatusModalError = dateError;
      return;
    }

    const replacesCurrentLeaveEnd = currentStatus === '休職中'
      && (input.scenario === 'leaveModify' || input.scenario === 'leaveEnd');
    if (replacesCurrentLeaveEnd) {
      const replaceableEndEvents = this.employeeDetailEventService.getReplaceableLeaveEndEventsForCurrentLeave(
        this.employeeEvents,
        this.selectedEmployee?.leaveStartDate,
      );
      if (replaceableEndEvents.length > 0) {
        const confirmed = window.confirm(
          'すでに休職終了予定のイベントがあります。変更すると却下され、新しい終了予定で申請されます。変更しますか？',
        );
        if (!confirmed) return;
        const rejected = await this.employeeDetailEventService.rejectPendingEvents(
          this.selectedEmployeeId,
          replaceableEndEvents,
          this.loginEmployeeId,
        );
        if (!rejected) {
          this.showMessage(UPDATE_MESSAGES.FAILED);
          return;
        }
      }
    } else {
      const pendingEvents = await this.employeeDetailEventService.getPendingWorkStatusLeaveEvents(this.selectedEmployeeId);
      if (pendingEvents.length > 0) {
        const confirmed = window.confirm(
          '現在申請中の休職イベントがあります。変更すると申請中のイベントは却下されます。変更しますか？',
        );
        if (!confirmed) return;
        const rejected = await this.employeeDetailEventService.rejectPendingEvents(
          this.selectedEmployeeId,
          pendingEvents,
          this.loginEmployeeId,
        );
        if (!rejected) {
          this.showMessage(UPDATE_MESSAGES.FAILED);
          return;
        }
      }
    }

    if (!window.confirm('勤務状況を変更しますか？')) return;

    const { createdIds } = await this.employeeDetailEventService.createEventsFromWorkStatusChange(
      this.selectedEmployeeId,
      previousEmployee,
      input,
      this.loginEmployeeId,
    );
    if (createdIds.length === 0) {
      this.showMessage(UPDATE_MESSAGES.FAILED);
      return;
    }

    await this.handleCreatedEvents(createdIds, `勤務状況を${UPDATE_MESSAGES.SUCCESS}`);
    await this.employeeService.getAllEmployees(true);
    this.closeWorkStatusModal();
    await this.selectEmployee(false);
  }

  async submitEmploymentContractModal() {
    this.employmentContractModalError = '';
    if (this.employmentContractForm.invalid) {
      this.employmentContractForm.markAllAsTouched();
      this.employmentContractModalError = '入力内容を確認してください';
      return;
    }

    const effectiveDateStr = this.employmentContractForm.controls.effectiveDate.value;

    const previousEmployee: Employee = {
      ...this.selectedEmployee!,
      employmentContract: this.selectedEmployee!.employmentContract
        ? { ...this.selectedEmployee!.employmentContract }
        : undefined,
    };

    const contractControls = this.employmentContractForm.controls.employmentContract.controls;
    const transportationExpenses = this.toNumberOrUndefined(contractControls.transportationExpenses.value);
    const employmentContract: Partial<EmploymentContract> = {
      employmentCategory: contractControls.employmentCategory.value as EmploymentCategory,
      workStyle: contractControls.workStyle.value as WorkStyle,
      officeId: contractControls.officeId.value,
      contractedWorkingHoursPerWeek: Number(contractControls.contractedWorkingHoursPerWeek.value),
      contractedWorkingDaysPerMonth: Number(contractControls.contractedWorkingDaysPerMonth.value),
      fixedSalary: Number(contractControls.fixedSalary.value),
      ...(this.showEmploymentTransportationExpensesField()
        ? { transportationExpenses: transportationExpenses ?? 0 }
        : {}),
    };

    const updatedEmployee: Employee = {
      ...previousEmployee,
      employmentContract: {
        ...previousEmployee.employmentContract,
        ...employmentContract,
      },
    } as Employee;

    const effectiveDateError = isFixedSalaryChanged(previousEmployee, updatedEmployee)
      && !isEmploymentContractShapeChanged(previousEmployee, updatedEmployee)
      ? this.validateFixedSalaryChangeEffectiveDate(effectiveDateStr)
      : await this.validateEffectiveDateAtOrAfterCurrentPeriod(effectiveDateStr);
    if (effectiveDateError) {
      this.employmentContractModalError = effectiveDateError;
      this.employmentContractForm.controls.effectiveDate.markAsTouched();
      return;
    }

    const hasChange = JSON.stringify(previousEmployee.employmentContract) !== JSON.stringify(updatedEmployee.employmentContract);
    if (!hasChange) {
      this.employmentContractModalError = '変更内容がありません';
      return;
    }

    const pendingEvents = await this.employeeDetailEventService.getPendingEmploymentContractEvents(this.selectedEmployeeId);
    if (pendingEvents.length > 0) {
      const confirmed = window.confirm(
        '現在申請中の雇用契約変更があります。変更すると申請中のイベントは却下されます。変更しますか？',
      );
      if (!confirmed) return;
      const rejected = await this.employeeDetailEventService.rejectPendingEvents(
        this.selectedEmployeeId,
        pendingEvents,
        this.loginEmployeeId,
      );
      if (!rejected) {
        this.showMessage(UPDATE_MESSAGES.FAILED);
        return;
      }
    }

    if (!window.confirm('雇用契約情報を変更しますか？')) return;

    const effectiveDate = timestampFromDateInput(effectiveDateStr);
    const { createdIds } = await this.employeeDetailEventService.createEventsFromEmploymentContractChange(
      this.selectedEmployeeId,
      previousEmployee,
      updatedEmployee,
      effectiveDate,
      this.loginEmployeeId,
    );
    if (createdIds.length === 0) {
      this.showMessage(UPDATE_MESSAGES.FAILED);
      return;
    }

    await this.handleCreatedEvents(createdIds, `雇用契約情報を${UPDATE_MESSAGES.SUCCESS}`);
    await this.employeeService.getAllEmployees(true);
    this.closeEmploymentContractModal();
    await this.selectEmployee(false);
  }

  editInsuranceInfo() {
    if (this.isRetiredEmployee()) return;
    if (!this.selectedEmployee) return;

    this.closeOtherEditModals('insurance');
    this.insuranceModalError = '';

    const insurance = this.selectedEmployee.insurance;
    this.insuranceForm.reset({
      currentGrade: insurance?.currentGrade ?? 0,
      insuranceEffectiveDate: '',
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
    this.updateInsuranceEffectiveDateValidation();

    void this.updateModalAutoCalculation();
    this.insuranceModalOpen = true;
  }

  closeInsuranceModal() {
    this.insuranceModalOpen = false;
    this.insuranceModalError = '';
    this.insuranceForm.reset();
    this.modalAutoInsuranceJudgement = null;
    this.modalAutoInsuranceGrade = null;
  }

  /** 保険情報を送信 */
  async submitInsuranceModal() {
    this.insuranceModalError = '';
    this.insuranceFormService.syncSharedInsuranceNumbers(this.insuranceForm);
    this.updateInsuranceEffectiveDateValidation();
    this.insuranceForm.updateValueAndValidity({ emitEvent: false });

    if (this.insuranceForm.invalid) {
      this.insuranceForm.markAllAsTouched();
      this.insuranceModalError = '保険情報の入力内容を確認してください';
      return;
    }

    const joinLossError = this.validateInsuranceJoinLossConflict();
    if (joinLossError) {
      this.insuranceModalError = joinLossError;
      return;
    }

    const qualificationDateError = this.validateInsuranceQualificationDatesInModal();
    if (qualificationDateError) {
      this.insuranceModalError = qualificationDateError;
      return;
    }

    if (this.isInsuranceGradeChanged()) {
      const effectiveDate = this.insuranceForm.controls.insuranceEffectiveDate.value;
      const dateError = this.validateInsuranceEffectiveDateInCurrentPeriod(effectiveDate);
      if (dateError) {
        this.insuranceModalError = dateError;
        this.insuranceForm.controls.insuranceEffectiveDate.markAsTouched();
        return;
      }
    }

    const insuranceInfo = this.insuranceFormService.createEmployeeInsuranceForSave(this.insuranceForm, {
      currentGrade: this.getCurrentGradeForSave(),
      basicPensionNumber: this.insuranceForm.controls.basicPensionNumber.value,
    });

    const beforeInsurance = this.selectedEmployee?.insurance;
    const gradeChanged = this.isInsuranceGradeChanged();
    const qualChanged = this.employeeDetailEventService.hasInsuranceQualificationChange(beforeInsurance, insuranceInfo);
    const changedInsuranceKeys = this.employeeDetailEventService.getChangedInsuranceKeys(beforeInsurance, insuranceInfo);

    if (changedInsuranceKeys.length > 0) {
      const rejected = await this.employeeDetailEventService.confirmAndRejectPendingInsuranceChanges(
        this.selectedEmployeeId,
        beforeInsurance,
        insuranceInfo,
        this.loginEmployeeId,
      );
      if (!rejected) {
        return;
      }
    }

    let gradeChangeRunId: string | null | undefined;
    if (gradeChanged) {
      await this.companyService.getCompany();
      const targetPeriodStart = this.companyService.company()?.settings?.targetPeriod[0] ?? 1;
      const applicationDate = timestampFromDateInput(this.insuranceForm.controls.insuranceEffectiveDate.value).toDate();
      gradeChangeRunId = await this.employeeDetailEventService.resolveGradeChangeRunId(
        this.selectedEmployeeId,
        applicationDate,
        targetPeriodStart,
      );
      if (gradeChangeRunId === null) {
        return;
      }
    }

    if (!window.confirm('保険情報を更新しますか？')) {
      return;
    }

    if (qualChanged || gradeChanged) {
      const gradeChange = gradeChanged
        ? {
          beforeGrade: beforeInsurance?.currentGrade ?? 0,
          afterGrade: insuranceInfo.currentGrade ?? 0,
          applicationDate: timestampFromDateInput(this.insuranceForm.controls.insuranceEffectiveDate.value),
        }
        : null;
      const runResult = await this.employeeDetailEventService.createInsuranceChangeRuns(
        this.selectedEmployeeId,
        beforeInsurance,
        insuranceInfo,
        gradeChange,
        this.loginEmployeeId,
        gradeChangeRunId,
        this.employeeService.currentWorkPeriodBounds(),
      );
      if (!runResult.success) {
        this.showMessage(UPDATE_MESSAGES.FAILED);
        return;
      }
      if (runResult.runIds.length > 0) {
        await this.employeeDetailEventService.createAnnouncementsForInsuranceChangeRuns(runResult.runIds);
      }
    }

    const gradeApplicationDate = gradeChanged
      ? timestampFromDateInput(this.insuranceForm.controls.insuranceEffectiveDate.value).toDate()
      : null;
    const insuranceToSave = this.employeeDetailEventService.buildInsuranceForImmediateSave(
      beforeInsurance,
      insuranceInfo,
      gradeApplicationDate,
      this.employeeService.currentWorkPeriodBounds(),
    );

    const result = await this.employeeService.updateEmployeeInsurance(this.selectedEmployeeId, insuranceToSave);
    if (!result) {
      this.showMessage(UPDATE_MESSAGES.FAILED);
      return;
    }

    if (!insuranceToSave.healthInsurance?.joined) {
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

    this.closeOtherEditModals('dependent');
    this.dependentModalError = '';

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
    this.dependentModalError = '';
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
    this.dependentModalError = '';
    this.syncNewDependentAppliedDates();

    if (!this.validateAllDependentAppliedDates()) {
      this.dependentForm.markAllAsTouched();
      this.showMessage('適用日の入力内容を確認してください');
      return;
    }

    if (!this.validateAllDependentPeriodsInModal()) {
      this.showMessage('扶養期間の入力内容を確認してください');
      return;
    }

    if (this.dependentForm.invalid) {
      this.dependentForm.markAllAsTouched();
      this.showMessage('扶養情報の入力内容を確認してください');
      return;
    }

    const changes = this.collectDependentChangesFromForm();
    if (changes.length === 0) {
      this.dependentModalError = '変更情報がありません';
      return;
    }

    if (changes.some(change => this.isChangingToDependent(change)) && !this.canRegisterDependent()) {
      this.showMessage('健康保険に加入していないため、扶養の登録はできません。');
      return;
    }

    const inputs = this.dependentChangeEventService.buildChangeInputs(changes);
    const requiredError = this.dependentChangeEventService.validateDependentChangeInputs(inputs);
    if (requiredError) {
      this.showMessage(requiredError);
      return;
    }

    for (const input of inputs) {
      const dateInput = getDependentChangeEffectiveDateInput(
        input.changeType,
        input.after,
        input.appliedDateInput,
      );
      const dateError = await this.dependentChangeEventService.validateDependentChangeDate(dateInput);
      if (dateError) {
        this.showMessage(dateError);
        return;
      }
    }

    const dependentIds = changes
      .map(change => String(change.after.dependentId ?? ''))
      .filter(id => !!id);
    const pendingDependentEvents = await this.dependentChangeEventService
      .getPendingAdminDependentChangeEventsForDependentIds(this.selectedEmployeeId, dependentIds);
    if (pendingDependentEvents.length > 0) {
      const confirmed = window.confirm(
        '同一の扶養者で申請中のものがあります。申請中のものを却下して新規作成しますか？',
      );
      if (!confirmed) return;
      const rejected = await this.employeeDetailEventService.rejectPendingEvents(
        this.selectedEmployeeId,
        pendingDependentEvents,
        this.loginEmployeeId,
      );
      if (!rejected) {
        this.showMessage(UPDATE_MESSAGES.FAILED);
        return;
      }
    }

    const createdEventIds = await this.employeeDetailEventService.createEventFromDependentChange(
      this.selectedEmployeeId,
      changes,
      this.loginEmployeeId,
    );
    if (createdEventIds.length !== changes.length) {
      this.showMessage(UPDATE_MESSAGES.FAILED);
      return;
    }

    this.dependents = await this.dependentService.getDependents(this.selectedEmployeeId);
    await this.handleCreatedEvents(createdEventIds, `扶養情報を${UPDATE_MESSAGES.SUCCESS}`);
    await this.employeeService.getAllEmployees(true);
    this.closeDependentModal();
  }

  private syncNewDependentAppliedDates(): void {
    for (const control of this.dependentsArray.controls) {
      const group = control as FormGroup;
      const value = group.getRawValue();
      if (value.isExisting === true) continue;
      if (!value.name && !value.birthDate && !value.relationship) continue;
      if (!value.dependentStartDate || value.appliedDate) continue;
      group.patchValue({ appliedDate: value.dependentStartDate }, { emitEvent: false });
    }
  }

  private collectDependentChangesFromForm(): {
    before: Dependent | null;
    after: Partial<Dependent>;
    appliedDateInput?: string;
  }[] {
    const results: {
      before: Dependent | null;
      after: Partial<Dependent>;
      appliedDateInput?: string;
    }[] = [];
    let nextId = this.getNextDependentId();

    for (const control of this.dependentsArray.controls) {
      const value = control.getRawValue();
      const before = value.isExisting
        ? this.dependents.find(dependent => dependent.dependentId === value.dependentId) ?? null
        : null;

      if (!value.isExisting && !value.name && !value.birthDate && !value.relationship) {
        continue;
      }
      if (before && !this.hasDependentFormValueChanged(value, before)) {
        continue;
      }

      const after: Partial<Dependent> = {
        dependentId: before?.dependentId ?? String(nextId++),
        name: value.name,
        birthDate: timestampFromDateInput(value.birthDate),
        relationship: value.relationship as Relationship,
        ...mapDependentPeriodFromForm(value),
        ...this.mapDependentExtraFields(value),
      };
      if (!before) {
        after.isDependent = true;
      }
      if (before?.isDependent === false && after.isDependent !== false) {
        after.dependentEndDate = null as unknown as Dependent['dependentEndDate'];
      }

      const appliedDateInput = value.appliedDate || value.dependentStartDate || undefined;

      results.push({
        before,
        after,
        appliedDateInput,
      });
    }

    return results;
  }

  private hasDependentFormValueChanged(value: Record<string, unknown>, before: Dependent): boolean {
    const disabilityStudent = mapDependentDisabilityStudentFromForm(value);
    const afterPayload = {
      name: String(value['name'] ?? '').trim(),
      relationship: value['relationship'] ?? '',
      birthDate: String(value['birthDate'] ?? ''),
      isDependent: value['isDependentStatus'] === 'dependent',
      dependentStartDate: String(value['dependentStartDate'] ?? ''),
      dependentEndDate: String(value['dependentEndDate'] ?? ''),
      cohabitationType: String(value['cohabitationType'] ?? '').trim(),
      annualIncome: this.normalizeDependentAnnualIncome(value['annualIncome']),
      occupation: String(value['occupation'] ?? '').trim(),
      hasDisability: disabilityStudent.hasDisability ?? false,
      disabilityType: disabilityStudent.disabilityType ?? '',
      isStudent: disabilityStudent.isStudent ?? false,
      studentType: disabilityStudent.studentType ?? '',
    };
    const beforePayload = {
      name: String(before.name ?? '').trim(),
      relationship: before.relationship ?? '',
      birthDate: before.birthDate ? this.formatDateForInput(before.birthDate) : '',
      isDependent: before.isDependent !== false,
      dependentStartDate: getDependentStartDateFormDefault(before),
      dependentEndDate: getDependentEndDateFormDefault(before),
      cohabitationType: String(before.cohabitationType ?? '').trim(),
      annualIncome: this.normalizeDependentAnnualIncome(before.annualIncome),
      occupation: String(before.occupation ?? '').trim(),
      hasDisability: before.hasDisability ?? false,
      disabilityType: before.hasDisability ? (before.disabilityType ?? '') : '',
      isStudent: before.isStudent ?? false,
      studentType: before.isStudent ? (before.studentType ?? '') : '',
    };
    return JSON.stringify(beforePayload) !== JSON.stringify(afterPayload);
  }

  private normalizeDependentAnnualIncome(value: unknown): number | null {
    if (value === '' || value == null) return null;
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  }

  async loadEmployeeEvents() {
    if (!this.selectedEmployeeId) {
      this.employeeEvents = [];
      this.employeeSystemRuns = [];
      this.scheduledSystemRunNotices = [];
      this.pendingSystemCalculationItems = [];
      this.insuranceChangeHistoryRows = [];
      this.eventListItems = [];
      return;
    }
    try {
      this.employeeEvents = await this.eventService.getEmployeeEventsByAppliedDateDesc(this.selectedEmployeeId);

      const [
        futureRuns,
        hireRuns,
        retireRuns,
        qualificationRuns,
        scheduledRuns,
        insuranceHistory,
        pendingAdHocRevisionRuns,
      ] = await Promise.all([
        this.calculationRunService.getFuturePendingSystemRunsForEmployee(this.selectedEmployeeId),
        this.calculationRunService.getPendingHireQualificationRunsForEmployee(this.selectedEmployeeId),
        this.calculationRunService.getPendingRetireQualificationRunsForEmployee(this.selectedEmployeeId),
        this.calculationRunService.getPendingEmploymentChangeRunsForEmployeeUpToWorkingMonth(this.selectedEmployeeId),
        this.calculationRunService.getPendingScheduledSystemRunsForEmployee(this.selectedEmployeeId),
        this.calculationRunService.getInsuranceChangeHistoryForEmployee(this.selectedEmployeeId),
        this.calculationRunService.getPendingSystemRunsForEmployee(this.selectedEmployeeId)
          .then(runs => runs.filter(run => run.type === '随時改定')),
      ]);

      this.scheduledSystemRunNotices = futureRuns
        .filter(run => !this.calculationRunService.isInsuranceInfoChangeRun(run))
        .map(run => this.buildScheduledSystemRunNotice(run));
      this.pendingSystemCalculationItems = this.buildPendingSystemCalculationItems(
        qualificationRuns,
        scheduledRuns,
        hireRuns,
        retireRuns,
        pendingAdHocRevisionRuns,
      );
      this.employeeSystemRuns = [
        ...qualificationRuns,
        ...scheduledRuns,
      ];
      this.insuranceChangeHistoryRows = insuranceHistory.map(run => ({
        run,
        employeeId: run.employeeId,
        employeeName: this.commonService.getEmployeeName(run.employeeId)
          ?? `${this.selectedEmployee?.firstName ?? ''} ${this.selectedEmployee?.lastName ?? ''}`.trim()
          ?? run.employeeId,
        typeLabel: this.employeeEventApprovalService.getInsuranceChangeTypeLabel(run),
        reasonLabel: this.employeeEventApprovalService.getInsuranceChangeReasonLabel(run),
        insuranceLabel: this.getInsuranceHistoryInsuranceLabelWithSchedule(run),
        appliedMonth: this.getInsuranceHistoryAppliedMonth(run),
        detectedDate: this.getInsuranceChangeSubmittedDateLabel(run),
        approvalStatus: run.approval?.approvalStatus ?? '',
        approverName: this.commonService.getEmployeeName(run.approval?.approvedBy ?? '') || '—',
        approvalDate: run.approval?.approvedDate
          ? this.commonService.formatDateTime(run.approval.approvedDate)
          : '—',
      }));

      this.eventListItems = this.buildEventListItems();
      this.scheduledLeaveInfo = this.employeeDetailEventService.getScheduledLeaveInfo(
        this.employeeEvents,
        this.selectedEmployee?.workStatus,
      );
      this.scheduledEmploymentContractInfo = this.employeeDetailEventService.getScheduledEmploymentContractInfo(this.employeeEvents);
      this.gradeApplicationLabel = await this.calculationRunService.getLatestGradeApplicationDisplayForEmployee(this.selectedEmployeeId);
      this.pendingAdHocRevisionLabel = await this.employeeEventApprovalService.getPendingGradeRevisionDisplayLabel(this.selectedEmployeeId);
      this.pendingInsuranceSchedules = await this.employeeDetailEventService.getPendingInsuranceSchedules(this.selectedEmployeeId);
    } catch (error) {
      console.error(error);
      this.employeeEvents = [];
      this.employeeSystemRuns = [];
      this.eventListItems = [];
      this.scheduledSystemRunNotices = [];
      this.pendingSystemCalculationItems = [];
      this.insuranceChangeHistoryRows = [];
      this.scheduledLeaveInfo = null;
      this.scheduledEmploymentContractInfo = null;
      this.gradeApplicationLabel = null;
      this.pendingAdHocRevisionLabel = null;
      this.pendingInsuranceSchedules = {};
      this.showMessage('イベント一覧の取得に失敗しました');
    }
  }

  private buildPendingSystemCalculationItems(
    qualificationRuns: SystemCalculationRunItem[],
    scheduledRuns: SystemCalculationRunItem[],
    hireRuns: SystemCalculationRunItem[],
    retireRuns: SystemCalculationRunItem[],
    adHocRevisionRuns: SystemCalculationRunItem[] = [],
  ): PendingSystemCalculationItem[] {
    const runs = [...hireRuns, ...retireRuns, ...qualificationRuns, ...scheduledRuns, ...adHocRevisionRuns]
      .filter(run => !this.calculationRunService.isInsuranceInfoChangeRun(run));
    return runs.map(run => ({
      label: this.getPendingSystemCalculationLabel(run),
      run,
    }));
  }

  private getPendingSystemCalculationLabel(run: SystemCalculationRunItem): string {
    if (this.isHireQualificationRun(run)) return '入社時保険情報登録';
    if (this.isRetireQualificationRun(run)) return '退社時保険喪失登録';
    if (this.isEmploymentChangeRun(run)) return '雇用形態変更';
    if (this.isInsuranceChangeRun(run)) return '保険情報変更';
    if (run.type === '随時改定' || run.eventType === '固定給変更') return '随時改定';
    return run.eventType ?? run.type ?? 'システム計算';
  }

  hasPendingSystemCalculationItems(): boolean {
    return this.pendingSystemCalculationItems.length > 0;
  }

  openPendingSystemCalculationItem(item: PendingSystemCalculationItem): void {
    const run = item.run;
    if (this.isHireQualificationRun(run)) {
      void this.openHireDetail(run);
      return;
    }
    if (this.isRetireQualificationRun(run)) {
      void this.openRetireDetail(run);
      return;
    }
    if (this.isQualificationReviewRun(run)) {
      this.openQualificationReview(run);
      return;
    }
    if (run.type === 'イベント') {
      this.openScheduledSystemRunReview(run);
      return;
    }
    void this.onApproveSystemRun(run);
  }

  private buildScheduledSystemRunNotice(run: SystemCalculationRunItem): string {
    const working = getWorkingYearMonth();
    const parsed = run.runId ? parseEventYearMonth(run.runId, working.year, working.month) : null;
    const monthLabel = parsed ? `${parsed.month}月` : '';

    if (isEmploymentChangeSystemRun(run)) {
      const hasLoss = this.hasEmploymentInsuranceLoss(run);
      return `${monthLabel}に資格${hasLoss ? '喪失' : '取得'}予定です`;
    }
    if (run.eventType === '固定給変更' || run.type === '随時改定') {
      return `${monthLabel}に随時改定予定です`;
    }
    if (run.payload?.['source'] === '保険情報変更') {
      return run.eventType === '退社'
        ? `${monthLabel}に資格喪失予定です`
        : `${monthLabel}に資格取得予定です`;
    }
    if (run.type === '資格喪失' || run.payload?.['source'] === '退社') {
      return `${monthLabel}に資格喪失予定です`;
    }
    if (run.type === '資格取得' && run.payload?.['source'] === '入社') {
      return `${monthLabel}に資格取得予定です`;
    }
    return `${monthLabel}に${run.eventType ?? run.type}予定です`;
  }

  private getInsuranceHistoryInsuranceLabelWithSchedule(run: SystemCalculationRunItem): string {
    const scheduled = this.getEmploymentChangeScheduledLabel(run);
    if (scheduled) return scheduled;
    return this.getInsuranceHistoryInsuranceLabel(run);
  }

  private getEmploymentChangeScheduledLabel(run: SystemCalculationRunItem): string | null {
    if (!this.isEmploymentChangeRun(run) || run.approval?.approvalStatus !== '申請中') return null;
    const working = getWorkingYearMonth();
    if (!run.runId || isEventAtOrBeforeWorkingMonth(run.runId, working.year, working.month)) return null;
    const parsed = parseEventYearMonth(run.runId, working.year, working.month);
    const monthLabel = parsed ? `${parsed.month}月` : '';
    const hasLoss = this.hasEmploymentInsuranceLoss(run);
    return `${monthLabel}に資格${hasLoss ? '喪失' : '取得'}予定です`;
  }

  private hasEmploymentInsuranceLoss(run: SystemCalculationRunItem): boolean {
    const before = run.payload?.['before'] as { healthInsurance?: { joined?: boolean }; nursingCareInsurance?: { joined?: boolean }; employeePensionInsurance?: { joined?: boolean } } | undefined;
    const after = run.payload?.['after'] as { healthInsurance?: { joined?: boolean; lostDate?: unknown }; nursingCareInsurance?: { joined?: boolean; lostDate?: unknown }; employeePensionInsurance?: { joined?: boolean; lostDate?: unknown } } | undefined;
    const keys = ['healthInsurance', 'nursingCareInsurance', 'employeePensionInsurance'] as const;
    return keys.some(key => before?.[key]?.joined === true && after?.[key]?.joined !== true);
  }

  isEmploymentChangeRun(run: SystemCalculationRunItem): boolean {
    return isEmploymentChangeSystemRun(run);
  }

  isQualificationReviewRun(run: SystemCalculationRunItem): boolean {
    return this.isInsuranceChangeRun(run) || this.isEmploymentChangeRun(run);
  }

  isInsuranceHistoryDetailReadOnly(): boolean {
    const run = this.reviewingInsuranceHistoryRun;
    if (!run || run.approval?.approvalStatus !== '申請中') return true;
    if (this.isHireQualificationRun(run) || this.isRetireQualificationRun(run)) return true;
    const working = getWorkingYearMonth();
    return !!run.runId && !isEventAtOrBeforeWorkingMonth(run.runId, working.year, working.month);
  }

  isApprovalModalReadOnly(): boolean {
    return this.insuranceHistoryDetailModalOpen && this.isInsuranceHistoryDetailReadOnly();
  }

  getApprovalModalTypeLabel(): string {
    if (this.approvingSystemRun && this.isEmploymentChangeRun(this.approvingSystemRun)) {
      return '雇用形態変更';
    }
    if (this.reviewingInsuranceHistoryRun) {
      return this.employeeEventApprovalService.getInsuranceChangeReasonLabel(this.reviewingInsuranceHistoryRun);
    }
    return '保険情報変更';
  }

  getInsuranceChangeDetectedDateLabel(run: SystemCalculationRunItem): string {
    const date = this.employeeEventApprovalService.getInsuranceChangeDetectedDate(run);
    return date ? this.commonService.formatDate(date) : '—';
  }

  /** 保険情報変更履歴の申請日（保険情報編集由来は申請時刻、それ以外は検出日） */
  getInsuranceChangeSubmittedDateLabel(run: SystemCalculationRunItem): string {
    if (this.calculationRunService.isInsuranceInfoChangeRun(run)) {
      const submittedAt = run.createdAt as Timestamp | undefined;
      return submittedAt ? this.commonService.formatDateTime(submittedAt) : '—';
    }
    return this.getInsuranceChangeDetectedDateLabel(run);
  }

  getInsuranceChangeDetailItems(run: SystemCalculationRunItem, draft: InsuranceApprovalDraft) {
    return this.employeeEventApprovalService.getInsuranceChangeDetailItems(run, draft);
  }

  getInsuranceHistoryTypeLabelForRun(run: SystemCalculationRunItem): string {
    return this.employeeEventApprovalService.getInsuranceChangeTypeLabel(run);
  }

  getApprovalModalDetectedDate(): string {
    const run = this.approvingSystemRun ?? this.reviewingInsuranceHistoryRun;
    return run ? this.getInsuranceChangeDetectedDateLabel(run) : '';
  }

  private getInsuranceHistoryInsuranceLabel(run: SystemCalculationRunItem): string {
    if (run.runId?.startsWith('等級変更_')) return '等級';
    return this.employeeEventApprovalService.getInsuranceChangeLabel(run);
  }

  private getInsuranceHistoryAppliedMonth(run: SystemCalculationRunItem): string {
    const appliedFromMonth = run.approval?.appliedFromMonth;
    if (appliedFromMonth == null) return '—';
    const { year, month } = decodeAppliedFromMonth(appliedFromMonth);
    return `${year}年${month}月`;
  }

  private buildEventListItems(): EmployeeDetailEventListItem[] {
    const runIds = new Set<string>();
    const items: EmployeeDetailEventListItem[] = [
      ...this.employeeEvents.map(event => ({
        kind: 'event' as const,
        data: event,
        sortTime: this.getEventOccurredMillis(event),
      })),
      ...this.employeeSystemRuns
        .filter(run => !runIds.has(run.runId))
        .map(run => ({
          kind: 'run' as const,
          data: run,
          sortTime: this.getRunOccurredMillis(run),
        })),
    ];
    return items.sort((left, right) => right.sortTime - left.sortTime);
  }

  private getEventOccurredMillis(event: EmployeeEvent): number {
    const occurredDate = event.occurredDate as { toMillis?: () => number; seconds?: number } | undefined;
    if (occurredDate) {
      if (typeof occurredDate.toMillis === 'function') return occurredDate.toMillis();
      if (typeof occurredDate.seconds === 'number') return occurredDate.seconds * 1000;
    }
    return this.getEventAppliedMillis(event);
  }

  private getRunOccurredMillis(run: SystemCalculationRunItem): number {
    const occurredDate = run.payload?.['occurredDate'] as { toMillis?: () => number; seconds?: number } | undefined;
    if (occurredDate) {
      if (typeof occurredDate.toMillis === 'function') return occurredDate.toMillis();
      if (typeof occurredDate.seconds === 'number') return occurredDate.seconds * 1000;
    }
    return run.detectedDate?.toMillis() ?? 0;
  }

  private getListItemId(item: EmployeeDetailEventListItem): string {
    return item.kind === 'run' ? item.data.runId : (item.data.eventId ?? '');
  }

  isListItemAtOrBeforeWorkingMonth(item: EmployeeDetailEventListItem): boolean {
    const { year, month } = getWorkingYearMonth();
    if (!year || !month) return true;
    const id = this.getListItemId(item);
    if (!id) {
      const appliedDate = item.kind === 'run' ? item.data.detectedDate : item.data.appliedDate;
      return isEventAtOrBeforeWorkingMonth('', year, month, appliedDate);
    }
    const appliedDate = item.kind === 'run' ? item.data.detectedDate : item.data.appliedDate;
    return isEventAtOrBeforeWorkingMonth(id, year, month, appliedDate);
  }

  isScheduledEvent(event: EmployeeEvent): boolean {
    return SCHEDULED_EVENT_TYPES.includes(event.eventType as typeof SCHEDULED_EVENT_TYPES[number])
      && event.applicantType !== '社員'
      && !(event.eventType === '扶養情報変更' && (event.lifeEventType === '入社' || event.lifeEventType === '退社'));
  }

  private isAdminWorkStatusLeaveEvent(event: EmployeeEvent): boolean {
    return event.eventType === '勤務状況変更'
      && event.applicantType === '管理者'
      && (event.changeType === '休職開始' || event.changeType === '休職終了' || event.changeType === '変更');
  }

  isHireQualificationRun(run: SystemCalculationRunItem): boolean {
    return run.type === '資格取得' && run.payload?.['source'] === '入社';
  }

  isRetireQualificationRun(run: SystemCalculationRunItem): boolean {
    return run.type === '資格喪失' && run.payload?.['source'] === '退社';
  }

  isInsuranceChangeRun(run: SystemCalculationRunItem): boolean {
    return this.calculationRunService.isInsuranceInfoChangeRun(run);
  }

  isDependentLifeEvent(event: EmployeeEvent): boolean {
    return event.eventType === '扶養情報変更'
      && (event.lifeEventType === '入社' || event.lifeEventType === '退社');
  }

  private getEventAppliedMillis(event: EmployeeEvent): number {
    const appliedDate = event.appliedDate as { toMillis?: () => number; seconds?: number } | undefined;
    if (!appliedDate) return 0;
    if (typeof appliedDate.toMillis === 'function') return appliedDate.toMillis();
    if (typeof appliedDate.seconds === 'number') return appliedDate.seconds * 1000;
    return 0;
  }

  getEventListItemType(item: EmployeeDetailEventListItem): string {
    if (item.kind === 'run') {
      if (this.isHireQualificationRun(item.data)) return '入社時保険情報登録';
      if (this.isRetireQualificationRun(item.data)) return '退社時保険喪失登録';
      if (this.isInsuranceChangeRun(item.data)) return `資格${item.data.type === '資格喪失' ? '喪失' : '取得'}（保険情報変更）`;
      if (this.isEmploymentChangeRun(item.data)) return '雇用形態変更（保険）';
      if (item.data.type === 'イベント') return item.data.eventType ?? '予定登録';
      return '随時改定（固定給変更）';
    }
    return item.data.eventType ?? '—';
  }

  getEventListItemChangeType(item: EmployeeDetailEventListItem): string {
    if (item.kind === 'event') return item.data.changeType ?? '—';
    return '—';
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
      if (this.isEmploymentChangeRun(item.data)) {
        return this.commonService.formatDate(item.data.detectedDate);
      }
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

  isRejectedListItem(item: EmployeeDetailEventListItem): boolean {
    return item.data.approval?.approvalStatus === '却下';
  }

  isRejectedHistoryRow(row: InsuranceChangeHistoryRow): boolean {
    return row.approvalStatus === '却下';
  }

  canShowApproveReject(item: EmployeeDetailEventListItem): boolean {
    if (this.isRetiredEmployee() || !this.isPendingListItem(item)) return false;

    if (item.kind === 'event') {
      if (this.isDependentLifeEvent(item.data)) return false;
      if (item.data.eventType === '退社' && item.data.applicantType === 'システム') return false;
      if (item.data.eventType === '一定年齢到達') return true;
      return this.employeeEventApprovalService.canApproveEvent(item.data);
    }

    if (this.isRetireQualificationRun(item.data)) return false;
    return this.employeeEventApprovalService.canApproveSystemRun(item.data);
  }

  canShowApply(item: EmployeeDetailEventListItem): boolean {
    if (this.isRetiredEmployee()) return false;
    if (item.data.approval?.approvalStatus !== '承認済み') return false;
    if (item.kind === 'event' && item.data.eventType === '一定年齢到達') return false;
    if (item.kind === 'event' && item.data.eventType === '入社') return false;
    if (item.kind === 'run' && this.isHireQualificationRun(item.data)) {
      return this.employeeEventApprovalService.canApplyHireInsuranceRun(item.data);
    }
    if (item.kind === 'run' && this.isRetireQualificationRun(item.data)) {
      return this.employeeEventApprovalService.canApplyRetireInsuranceRun(item.data);
    }

    if (item.kind === 'event') {
      if (this.isAdminWorkStatusLeaveEvent(item.data)) {
        return this.employeeEventApprovalService.canApplyAdminWorkStatusEventByEffectiveDate(item.data);
      }
      return this.employeeEventApprovalService.canApplyEventInWorkingPeriod(item.data);
    }
    return this.employeeEventApprovalService.canApplyRunInWorkingPeriod(item.data);
  }

  async onApplyListItem(item: EmployeeDetailEventListItem) {
    if (item.kind === 'run') {
      await this.onApplySystemRun(item.data);
      return;
    }
    await this.onApplyEvent(item.data);
  }

  canShowReject(item: EmployeeDetailEventListItem): boolean {
    if (!this.canShowApproveReject(item)) return false;

    if (item.kind === 'run') {
      if (this.isInsuranceChangeRun(item.data)) return false;
      if (item.data.type === 'イベント') return false;
    }

    if (item.kind === 'event' && this.isScheduledEvent(item.data)) return false;
    return true;
  }

  canShowEventDetail(item: EmployeeDetailEventListItem): boolean {
    if (this.canShowApproveReject(item)) return false;

    if (item.kind === 'run') {
      if (this.isPendingListItem(item) && this.isRetireQualificationRun(item.data)) return true;
      if (this.isPendingListItem(item) && !this.isListItemAtOrBeforeWorkingMonth(item)) return true;
      if (!this.isPendingListItem(item)) return true;
      return false;
    }

    if (this.isPendingListItem(item)) {
      if (this.isAdminWorkStatusLeaveEvent(item.data)
        && !this.employeeEventApprovalService.canApproveEvent(item.data)) return true;
      if (!this.isListItemAtOrBeforeWorkingMonth(item)) return true;
      if (this.isDependentLifeEvent(item.data)) return true;
      return false;
    }

    const status = item.data.approval?.approvalStatus;
    if (status === '承認済み' || status === '適用済み') return true;
    if (this.isDependentLifeEvent(item.data)) return true;
    return item.data.eventType !== '退社' && item.data.eventType !== '一定年齢到達';
  }

  async showListItemDetail(item: EmployeeDetailEventListItem) {
    if (item.kind === 'run') {
      if (this.isRetireQualificationRun(item.data)) {
        await this.openRetireDetail(item.data);
        return;
      }
      if (this.isInsuranceChangeRun(item.data)) {
        await this.openInsuranceHistoryDetail(item.data);
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
      return;
    }

    if (this.isPendingListItem(item) && this.isScheduledEvent(item.data)) {
      this.openScheduledEventReview(item.data);
      return;
    }
    if (this.isPendingListItem(item) && item.data.applicantType === '社員') {
      this.openEmployeeReview(item.data);
      return;
    }
    this.showDetail(item.data);
  }

  async onApproveListItem(item: EmployeeDetailEventListItem) {
    if (item.kind === 'run') {
      const run = item.data;
      if (this.isHireQualificationRun(run)) {
        await this.openHireDetail(run);
        return;
      }
      if (this.isRetireQualificationRun(run)) {
        await this.openRetireDetail(run);
        return;
      }
      if (this.isQualificationReviewRun(run)) {
        this.openQualificationReview(run);
        return;
      }
      if (run.type === 'イベント') {
        this.openScheduledSystemRunReview(run);
        return;
      }
      await this.onApproveSystemRun(run);
      return;
    }

    const event = item.data;
    if (event.applicantType === '社員') {
      this.openEmployeeReview(event);
      return;
    }
    if (this.isScheduledEvent(event)) {
      this.openScheduledEventReview(event);
      return;
    }
    await this.onApproveEvent(event);
  }

  async onRejectListItem(item: EmployeeDetailEventListItem) {
    if (item.kind === 'run') {
      const run = item.data;
      if (this.isHireQualificationRun(run)) {
        await this.rejectHireRun(run);
        return;
      }
      if (this.isRetireQualificationRun(run)) {
        if (!window.confirm('退社処理を却下しますか？')) return;
        const rejected = await this.employeeEventApprovalService.rejectRetireQualificationRun(run, this.loginEmployeeId);
        if (rejected) {
          this.showMessage('退社処理を却下しました');
          await this.loadEmployeeEvents();
        } else {
          this.showMessage('却下に失敗しました');
        }
        return;
      }
      if (!window.confirm('システム計算結果を却下しますか？')) return;
      const rejected = run.type === '資格喪失' || run.payload?.['source'] === '退社'
        ? await this.employeeEventApprovalService.rejectRetireQualificationRun(run, this.loginEmployeeId)
        : await this.employeeEventApprovalService.rejectSystemRun(run.runId, this.loginEmployeeId);
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
    const breakdown = this.insuranceDisplayService.getEmployeeHistoryBreakdown(
      snapshot,
      adjustmentRuns,
      employeeId,
      payrollId,
    );
    const grade = String(
      this.insuranceDisplayService.getEmployeeHistoryGrade(snapshot, adjustmentRuns, employeeId, payrollId)
      || snapshot.grade
      || '',
    );

    return this.buildInsuranceHistoryRow(
      payrollId,
      payroll,
      grade,
      breakdown,
      snapshot.insuranceEnrollmentStatuses,
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
      healthStatus: this.getHistoryInsuranceStatus(draft.healthInsurance, this.selectedEmployee?.insurance?.healthInsurance),
      nursingStatus: this.getHistoryInsuranceStatus(draft.nursingCareInsurance, this.selectedEmployee?.insurance?.nursingCareInsurance),
      pensionStatus: this.getHistoryInsuranceStatus(draft.pensionInsurance, this.selectedEmployee?.insurance?.employeePensionInsurance),
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
    enrollmentStatuses?: InsuranceEnrollmentStatuses,
    insurance?: Employee['insurance'],
  ): InsuranceHistoryRow {
    const targetMonth = payrollId.replace('_bonus', '');
    return {
      payrollId,
      targetMonth,
      paymentDate: payroll?.paymentDate ? this.commonService.formatDate(payroll.paymentDate) : '',
      grade,
      healthStatus: this.getHistoryInsuranceStatusLabel(
        enrollmentStatuses?.healthInsurance,
        breakdown.healthInsurance,
        insurance?.healthInsurance,
      ),
      nursingStatus: this.getHistoryInsuranceStatusLabel(
        enrollmentStatuses?.nursingCareInsurance,
        breakdown.nursingCareInsurance,
        insurance?.nursingCareInsurance,
      ),
      pensionStatus: this.getHistoryInsuranceStatusLabel(
        enrollmentStatuses?.employeePensionInsurance,
        breakdown.pensionInsurance,
        insurance?.employeePensionInsurance,
      ),
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

  private getHistoryInsuranceStatusLabel(
    snapshotStatus: InsuranceEnrollmentStatuses['healthInsurance'],
    amount: number,
    detail?: InsuranceDetail,
  ): string {
    if (snapshotStatus) {
      return this.insuranceFormService.getEnrollmentStatusLabel(snapshotStatus);
    }
    return this.getHistoryInsuranceStatus(amount, detail);
  }

  private getHistoryInsuranceStatus(amount: number, detail?: InsuranceDetail): string {
    if (detail?.lostDate) return '喪失';
    if (detail?.joined) return '加入';
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
      '扶養開始日',
      '扶養終了日',
      '同居・別居区分（同居/別居）',
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
      dependent.dependentStartDate ? this.commonService.formatDate(dependent.dependentStartDate) : '',
      dependent.dependentEndDate ? this.commonService.formatDate(dependent.dependentEndDate) : '',
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

  hasScheduledSystemRunNotices(): boolean {
    return this.scheduledSystemRunNotices.length > 0;
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

    if (run.type === '資格喪失' || (run.eventType === '退社' && run.payload?.['source'] === '退社')) {
      if (!(await this.employeeEventApprovalService.canApproveRetireInsuranceRun(run))) {
        this.showMessage('退社承認後に保険喪失を承認できます');
        return;
      }
      if (!window.confirm('退社処理の保険・扶養情報を承認しますか？')) {
        return;
      }
      const approved = await this.employeeEventApprovalService.approveRetireQualificationRun(
        run, this.loginEmployeeId,
      );
      if (approved) {
        this.showMessage('退社処理を承認しました（反映は作業期間内に行ってください）');
        await this.selectEmployee(false);
      } else {
        this.showMessage('承認に失敗しました');
      }
      return;
    }

    if (run.eventType === '退社') {
      if (!window.confirm('退社イベントを承認しますか？')) {
        return;
      }
      const approved = await this.employeeEventApprovalService.approveRetireEvent(
        this.selectedEmployeeId, eventView, this.loginEmployeeId, run.runId,
      );
      if (approved) {
        this.showMessage('退社イベントを承認しました（反映は作業期間内に行ってください）');
        await this.selectEmployee(false);
      } else {
        this.showMessage('承認に失敗しました');
      }
    }
  }

  async onApplySystemRun(run: SystemCalculationRunItem) {
    if (this.isRetiredEmployee()) return;
    if (!window.confirm('承認済みの内容を従業員情報に反映しますか？')) return;

    let applied = false;
    if (run.type === '随時改定') {
      const { appliedCount } = await this.employeeEventApprovalService.applySelectedAdHocRevisions(
        [run.runId],
        this.loginEmployeeId,
      );
      applied = appliedCount > 0;
    } else {
      applied = await this.employeeEventApprovalService.applySystemRun(run, this.loginEmployeeId);
    }

    if (applied) {
      await this.employeeService.getAllEmployees(true);
      this.showMessage('従業員情報に反映しました');
      await this.selectEmployee(false);
    } else {
      this.showMessage('反映に失敗しました');
    }
  }

  async onApplyEvent(event: EmployeeEvent) {
    if (this.isRetiredEmployee()) return;
    if (!window.confirm('承認済みの内容を従業員情報に反映しますか？')) return;

    let applied = false;
    if (event.eventType === '退社') {
      applied = await this.employeeEventApprovalService.applyRetireEvent(
        this.selectedEmployeeId,
        event,
        this.loginEmployeeId,
      );
    } else if (event.applicantType === '社員') {
      applied = await this.employeeEventApprovalService.applyApprovedEmployeeApplicationEvent(
        this.selectedEmployeeId,
        event,
        this.loginEmployeeId,
      );
    } else {
      applied = await this.employeeEventApprovalService.applySimpleEvent(
        this.selectedEmployeeId,
        event,
        this.loginEmployeeId,
      );
    }

    if (applied) {
      await this.employeeService.getAllEmployees(true);
      this.showMessage('従業員情報に反映しました');
      await this.selectEmployee(false);
    } else {
      this.showMessage('反映に失敗しました');
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
    if (!this.employeeEventApprovalService.canApproveEvent(event)) {
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
    } else if (
      event.eventType === '勤務状況変更'
      && event.applicantType === '管理者'
      && event.approval?.approvalStatus === '申請中'
    ) {
      approved = await this.employeeEventApprovalService.approveAdminWorkStatusEvent(
        this.selectedEmployeeId,
        event,
        this.loginEmployeeId,
      );
    } else if (
      (event.eventType === '固定給変更' || event.eventType === '雇用形態変更')
      && event.applicantType === '管理者'
      && event.approval?.approvalStatus === '申請中'
    ) {
      approved = await this.employeeEventApprovalService.approveSimpleEvent(
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
      this.showMessage(event.eventType === '一定年齢到達'
        ? '一定年齢到達イベントを承認しました'
        : 'イベントを承認しました（反映は作業期間内に行ってください）');
      if (event.eventType === '一定年齢到達') {
        await this.employeeService.getAllEmployees(true);
      }
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
    const approved = await this.employeeEventApprovalService.approveEmployeeApplicationOnly(
      this.selectedEmployeeId,
      this.reviewingEmployeeEvent,
      this.loginEmployeeId,
    );
    if (approved) {
      this.showMessage('申請を承認しました');
      this.closeEmployeeReview();
      await this.loadEmployeeEvents();
    } else {
      this.showMessage('承認に失敗しました');
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
      let rejected = false;
      if (this.approvalModalType === 'fixedSalary' && this.fixedSalaryDraft) {
        rejected = await this.employeeEventApprovalService.rejectFixedSalaryRun(
          this.approvingSystemRun.runId,
          this.fixedSalaryDraft,
          this.loginEmployeeId,
        );
      } else {
        rejected = await this.employeeEventApprovalService.rejectSystemRun(
          this.approvingSystemRun.runId,
          this.loginEmployeeId,
        );
      }
      if (rejected) {
        this.showMessage('システム計算結果を却下しました');
        await this.loadEmployeeEvents();
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
    const isExcludedFixedSalaryConfirmation = this.approvalModalType === 'fixedSalary'
      && !!this.fixedSalaryDraft
      && !this.fixedSalaryDraft.canRevise
      && !!this.approvingSystemRun;
    if (!window.confirm(isExcludedFixedSalaryConfirmation
      ? '随時改定の結果を確定しますか？'
      : 'システム計算結果を承認しますか？')) {
      return;
    }

    const eventView = this.approvingSystemRun
      ? this.employeeEventApprovalService.buildEventViewFromRun(this.approvingSystemRun)
      : this.approvingEvent!;
    const runId = this.approvingSystemRun?.runId;
    const isInsuranceChangeRun = this.approvingSystemRun?.payload?.['source'] === '保険情報変更';
    const isEmploymentChangeRun = this.approvingSystemRun
      ? this.isEmploymentChangeRun(this.approvingSystemRun)
      : false;

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
          this.selectedEmployeeId, eventView, this.insuranceDraft, this.loginEmployeeId, runId,
        );
      }
    }

    if (approved) {
      this.showMessage(isExcludedFixedSalaryConfirmation
        ? '随時改定を確定しました'
        : 'イベントを承認しました（反映は作業期間内に行ってください）');
      await this.selectEmployee(false);
    } else {
      this.showMessage('イベントの承認に失敗しました');
    }
    this.cancelApprovalModal();
  }

  openQualificationReview(run: SystemCalculationRunItem) {
    void this.openQualificationReviewAsync(run);
  }

  private async openQualificationReviewAsync(run: SystemCalculationRunItem) {
    if (run.type === 'その他' && run.runId?.startsWith('等級変更_')) {
      if (!this.employeeEventApprovalService.canApproveSystemRun(run)) {
        this.showMessage('適用日以降、または作業対象期間内になってから承認できます');
        return;
      }
      if (!window.confirm('等級変更を承認しますか？')) return;
      const approved = await this.employeeEventApprovalService.approveGradeChangeRun(run, this.loginEmployeeId);
      if (approved) {
        this.showMessage('イベントを承認しました（反映は作業期間内に行ってください）');
        await this.selectEmployee(false);
      } else {
        this.showMessage('イベントの承認に失敗しました');
      }
      return;
    }

    this.approvingSystemRun = run;
    this.insuranceDraft = await this.employeeEventApprovalService.buildInsuranceChangeApprovalDraft(run);
    this.approvalModalType = 'insurance';
    this.insuranceApprovalChangeDate = this.formatDateForInput(run.detectedDate as Timestamp)
      || this.formatDateForInput(Timestamp.fromDate(new Date()));
    this.insuranceApprovalValidationError = '';
    this.approvalModalOpen = true;
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
    if (!this.employeeEventApprovalService.canApproveHireInsuranceRun(this.reviewingHireRun)) {
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
      await this.selectEmployee(false);
    } else {
      this.showMessage('承認に失敗しました');
    }
  }

  async rejectHireRun(run: SystemCalculationRunItem) {
    if (!window.confirm('入社処理を却下しますか？')) return;

    const rejected = await this.employeeEventApprovalService.rejectHireQualificationRun(run, this.loginEmployeeId);
    if (rejected) {
      this.showMessage('入社処理を却下しました');
      if (this.reviewingHireRun?.runId === run.runId) {
        this.closeHireDetail();
      }
      await this.loadEmployeeEvents();
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
    if (!(await this.employeeEventApprovalService.canApproveRetireInsuranceRun(this.reviewingRetireRun))) {
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
      await this.selectEmployee(false);
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
      await this.loadEmployeeEvents();
    } else {
      this.showMessage('却下に失敗しました');
    }
  }

  openScheduledEventReview(event: EmployeeEvent) {
    this.reviewingScheduledEvent = event;
    this.reviewingScheduledSystemRun = null;
    this.scheduledReviewModalOpen = true;
  }

  openScheduledSystemRunReview(run: SystemCalculationRunItem) {
    this.reviewingScheduledSystemRun = run;
    this.reviewingScheduledEvent = null;
    this.scheduledReviewModalOpen = true;
  }

  closeScheduledReview() {
    this.scheduledReviewModalOpen = false;
    this.reviewingScheduledEvent = null;
    this.reviewingScheduledSystemRun = null;
  }

  canApproveScheduledReview(): boolean {
    if (this.reviewingScheduledSystemRun) {
      return this.employeeEventApprovalService.canApproveSystemRun(this.reviewingScheduledSystemRun);
    }
    if (this.reviewingScheduledEvent) {
      return this.employeeEventApprovalService.canApproveEvent(this.reviewingScheduledEvent);
    }
    return false;
  }

  async approveScheduledReview() {
    if (this.reviewingScheduledSystemRun) {
      await this.onApproveSystemRun(this.reviewingScheduledSystemRun);
      this.closeScheduledReview();
      return;
    }
    if (!this.reviewingScheduledEvent) return;

    const event = this.reviewingScheduledEvent;
    let approved = false;
    if (event.eventType === '固定給変更') {
      approved = await this.employeeEventApprovalService.approveAdminFixedSalaryEvent(
        this.selectedEmployeeId, event, this.loginEmployeeId,
      );
    } else if (event.eventType === '雇用形態変更') {
      approved = await this.employeeEventApprovalService.approveAdminEmploymentChangeEvent(
        this.selectedEmployeeId, event, this.loginEmployeeId,
      );
    } else if (event.eventType === '勤務状況変更') {
      approved = await this.employeeEventApprovalService.approveAdminWorkStatusEvent(
        this.selectedEmployeeId, event, this.loginEmployeeId,
      );
    } else if (event.eventType === '扶養情報変更') {
      approved = await this.employeeEventApprovalService.approveAdminDependentChangeEvent(
        this.selectedEmployeeId, event, this.loginEmployeeId,
      );
    }

    if (approved) {
      await this.employeeService.getAllEmployees(true);
      this.showMessage('予定登録イベントを承認しました');
      this.closeScheduledReview();
      await this.selectEmployee(false);
    } else {
      this.showMessage('承認に失敗しました');
    }
  }

  async rejectScheduledReview() {
    if (this.reviewingScheduledSystemRun) {
      await this.onRejectListItem({ kind: 'run', data: this.reviewingScheduledSystemRun, sortTime: 0 });
      this.closeScheduledReview();
      return;
    }
    if (!this.reviewingScheduledEvent) return;
    await this.onRejectEvent(this.reviewingScheduledEvent);
    this.closeScheduledReview();
  }

  async openInsuranceHistoryDetail(run: SystemCalculationRunItem) {
    if (run.type === '随時改定') {
      let eventView = this.calculationRunService.toEventView(run);
      if (!run.payload?.['revisionSummary']) {
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

  async rejectInsuranceHistoryDetail() {
    const run = this.reviewingInsuranceHistoryRun;
    if (!run || run.approval?.approvalStatus !== '申請中') return;
    if (!window.confirm('システム計算結果を却下しますか？')) return;

    const rejected = await this.employeeEventApprovalService.rejectSystemRun(run.runId, this.loginEmployeeId);
    if (rejected) {
      this.showMessage('システム計算結果を却下しました');
      this.closeInsuranceHistoryDetail();
      await this.loadEmployeeEvents();
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

  showWorkStatusLeaveTypesField(): boolean {
    return this.workStatusForm.controls.workStatus.value === '休職中';
  }

  showWorkStatusLeaveStartField(): boolean {
    const current = this.selectedEmployee?.workStatus === '休職中' ? '休職中' : '通常勤務';
    const target = this.workStatusForm.controls.workStatus.value;
    return current === '通常勤務' && target === '休職中';
  }

  showWorkStatusLeaveEndModifyField(): boolean {
    const current = this.selectedEmployee?.workStatus === '休職中' ? '休職中' : '通常勤務';
    const target = this.workStatusForm.controls.workStatus.value;
    return current === '休職中' && target === '休職中';
  }

  isWorkStatusLeaveStartReadOnly(): boolean {
    return this.selectedEmployee?.workStatus === '休職中';
  }

  isWorkStatusLeaveEndReadOnly(): boolean {
    return false;
  }

  showWorkStatusLeaveEndField(): boolean {
    const current = this.selectedEmployee?.workStatus === '休職中' ? '休職中' : '通常勤務';
    return current === '休職中' && this.workStatusForm.controls.workStatus.value === '通常勤務';
  }

  showWorkStatusMaternityFields(): boolean {
    const current = this.selectedEmployee?.workStatus === '休職中' ? '休職中' : '通常勤務';
    const target = this.workStatusForm.controls.workStatus.value;
    const leaveType = this.workStatusForm.controls.leaveTypes.value;
    return current === '通常勤務'
      && target === '休職中'
      && (leaveType === '産前産後' || leaveType === '育児');
  }

  showWorkStatusMultipleBirthField(): boolean {
    return this.showWorkStatusMaternityFields()
      && this.workStatusForm.controls.leaveTypes.value === '産前産後';
  }

  showWorkStatusChildNameField(): boolean {
    return this.showWorkStatusMaternityFields()
      && this.workStatusForm.controls.leaveTypes.value === '育児';
  }

  workStatusChildBirthDateLabel(): string {
    return this.workStatusForm.controls.leaveTypes.value === '育児'
      ? '子どもの生年月日'
      : '出産予定日';
  }

  showWorkStatusSwitchDateField(): boolean {
    const current = this.selectedEmployee?.workStatus === '休職中' ? '休職中' : '通常勤務';
    const target = this.workStatusForm.controls.workStatus.value;
    const newLeaveType = this.workStatusForm.controls.leaveTypes.value;
    return current === '休職中'
      && target === '休職中'
      && !!newLeaveType
      && newLeaveType !== (this.selectedEmployee?.leaveTypes ?? '');
  }

  showEmploymentTransportationExpensesField(): boolean {
    const employmentContract = this.employmentContractForm.controls.employmentContract;
    return this.isTransportationExpensesRequired(
      employmentContract.controls.employmentCategory.value as EmploymentCategory,
      employmentContract.controls.workStyle.value as WorkStyle,
    );
  }

  isInsuranceGradeChanged(): boolean {
    const registered = this.selectedEmployee?.insurance?.currentGrade ?? 0;
    return this.getCurrentGradeForSave() !== registered;
  }

  showInsuranceEffectiveDateField(): boolean {
    return this.isInsuranceGradeChanged();
  }

  formatScheduledLeave(info: ScheduledLeaveInfo): string {
    const start = this.formatScheduledLeaveMonthDay(info.leaveStartDate);
    if (info.leaveEndDate) {
      const end = this.formatScheduledLeaveMonthDay(info.leaveEndDate);
      return `${start}～${end}まで予定`;
    }
    return `${start}～予定`;
  }

  formatScheduledLeavePeriod(info: ScheduledLeaveInfo): string {
    const start = this.commonService.formatDate(info.leaveStartDate);
    const end = info.leaveEndDate ? this.commonService.formatDate(info.leaveEndDate) : '';
    return end ? `${start}～${end}` : `${start}～`;
  }

  private formatScheduledLeaveMonthDay(date: Timestamp): string {
    const value = date.toDate();
    return `${value.getMonth() + 1}月${value.getDate()}日`;
  }

  formatScheduledEmploymentContract(info: ScheduledEmploymentContractInfo): string {
    const date = info.effectiveDate.toDate();
    return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}変更予定あり`;
  }

  formatPendingInsuranceSchedule(insuranceName: InsuranceName): string | null {
    const schedule = this.pendingInsuranceSchedules[insuranceName];
    if (!schedule) return null;
    return `${this.commonService.formatDate(schedule.date)} ${schedule.label}`;
  }

  showLeaveTypesField(): boolean {
    return this.showWorkStatusLeaveTypesField();
  }

  showResignationDateField(): boolean {
    return false;
  }

  showResignationDateDisplay(): boolean {
    const status = this.selectedEmployee?.workStatus;
    return status === '退社済み' || status === '退社予定';
  }

  showTransportationExpensesField(): boolean {
    return this.showEmploymentTransportationExpensesField();
  }

  isExistingDependentRow(index: number): boolean {
    return this.dependentsArray.at(index).controls['isExisting'].value === true;
  }

  private setupWorkStatusFormValidation() {
    this.updateWorkStatusFieldValidation();
    this.workStatusForm.controls.workStatus.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.updateWorkStatusFieldValidation());
    this.workStatusForm.controls.leaveTypes.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.updateWorkStatusFieldValidation());
    this.workStatusForm.controls.leaveStartDate.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.workStatusForm.controls.leaveEndDate.updateValueAndValidity({ emitEvent: false });
        this.workStatusForm.updateValueAndValidity({ emitEvent: false });
      });
    this.workStatusForm.controls.childBirthDate.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.workStatusForm.updateValueAndValidity({ emitEvent: false }));
  }

  private workStatusMaternityValidator(control: AbstractControl): ValidationErrors | null {
    if (!this.selectedEmployee) return null;
    const current = this.selectedEmployee.workStatus === '休職中' ? '休職中' : '通常勤務';
    const target = control.get('workStatus')?.value;
    const leaveType = control.get('leaveTypes')?.value;
    if (current !== '通常勤務' || target !== '休職中' || (leaveType !== '産前産後' && leaveType !== '育児')) {
      return null;
    }

    const childBirthDate = control.get('childBirthDate')?.value as string;
    if (!childBirthDate) {
      return {
        requiredChildBirthDate: leaveType === '育児'
          ? '子どもの生年月日は必須です'
          : '出産予定日は必須です',
      };
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const targetDate = parseDateInputValue(childBirthDate);
    if (leaveType === '産前産後' && targetDate < today) {
      return { invalidBirthDate: '出産予定日は今日以降を入力してください' };
    }
    if (leaveType === '育児' && targetDate >= today) {
      return { invalidBirthDate: '子どもの誕生日は今日以前を入力してください' };
    }

    const leaveStartDate = control.get('leaveStartDate')?.value as string;
    if (!childBirthDate || !leaveStartDate) return null;
    const birthDate = parseDateInputValue(childBirthDate);
    const startDate = parseDateInputValue(leaveStartDate);
    if (leaveType === '育児' && startDate < birthDate) {
      return { invalidLeaveStartDate: '育児休業開始日は出生日以降を入力してください' };
    }
    if (leaveType === '育児') {
      const childName = control.get('childName')?.value as string;
      if (!childName?.trim()) {
        return { requiredChildName: '子どもの名前は必須です' };
      }
    }
    if (leaveType === '産前産後') {
      const isMultipleBirth = control.get('isMultipleBirth')?.value ?? false;
      const days = isMultipleBirth ? 98 : 42;
      const minStartDate = new Date(birthDate);
      minStartDate.setDate(minStartDate.getDate() - days);
      if (startDate < minStartDate) {
        return {
          invalidLeaveStartDate: `産前産後休業開始日は出産予定日の${days}日前以降を入力してください`,
        };
      }
    }
    return null;
  }

  private leaveEndAfterStartValidator = (control: AbstractControl): ValidationErrors | null => {
    const end = control.value as string;
    if (!end) return null;

    const form = this.workStatusForm;
    const current = this.selectedEmployee?.workStatus === '休職中' ? '休職中' : '通常勤務';
    const target = form.controls.workStatus.value;

    let start = '';
    if (current === '休職中' && (target === '通常勤務' || target === '休職中')) {
      start = this.formatDateForInput(this.selectedEmployee?.leaveStartDate);
    } else {
      start = form.controls.leaveStartDate.value;
    }

    if (!start) return null;
    return end >= start ? null : { leaveEndBeforeStart: true };
  };

  private setupEmploymentContractFormValidation() {
    this.updateTransportationExpensesValidation();
    const employmentContract = this.employmentContractForm.controls.employmentContract;
    employmentContract.controls.employmentCategory.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.updateTransportationExpensesValidation());
    employmentContract.controls.workStyle.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.updateTransportationExpensesValidation());
  }

  private updateWorkStatusFieldValidation() {
    const form = this.workStatusForm;
    const current = this.selectedEmployee?.workStatus === '休職中' ? '休職中' : '通常勤務';
    const target = form.controls.workStatus.value;
    const isMaternityLeaveStart = this.showWorkStatusMaternityFields();

    const leaveTypesRequired = target === '休職中';
    form.controls.leaveTypes.setValidators(leaveTypesRequired ? [Validators.required] : null);
    if (!leaveTypesRequired) form.controls.leaveTypes.setValue('', { emitEvent: false });

    const leaveStartRequired = current === '通常勤務' && target === '休職中';
    form.controls.leaveStartDate.setValidators(leaveStartRequired ? [Validators.required] : null);
    if (!leaveStartRequired) form.controls.leaveStartDate.setValue('', { emitEvent: false });

    const leaveEndRequired = (current === '休職中' && target === '通常勤務')
      || isMaternityLeaveStart;
    const showOptionalLeaveEnd = (current === '通常勤務' && target === '休職中' && !isMaternityLeaveStart)
      || (current === '休職中' && target === '休職中');
    const leaveEndValidators = [];
    if (leaveEndRequired) leaveEndValidators.push(Validators.required);
    if (leaveStartRequired || leaveEndRequired || showOptionalLeaveEnd) {
      leaveEndValidators.push(this.leaveEndAfterStartValidator);
    }
    form.controls.leaveEndDate.setValidators(leaveEndValidators.length ? leaveEndValidators : null);
    if (!leaveEndRequired && !showOptionalLeaveEnd && !(current === '休職中' && target === '休職中')) {
      form.controls.leaveEndDate.setValue('', { emitEvent: false });
    }

    form.controls.childBirthDate.setValidators(isMaternityLeaveStart ? [Validators.required] : null);
    form.controls.childName.setValidators(
      isMaternityLeaveStart && form.controls.leaveTypes.value === '育児' ? [Validators.required] : null,
    );
    if (!isMaternityLeaveStart) {
      form.controls.childBirthDate.setValue('', { emitEvent: false });
      form.controls.isMultipleBirth.setValue(false, { emitEvent: false });
      form.controls.childName.setValue('', { emitEvent: false });
    }

    const switchRequired = this.showWorkStatusSwitchDateField();
    form.controls.switchDate.setValidators(switchRequired ? [Validators.required] : null);
    if (!switchRequired) form.controls.switchDate.setValue('', { emitEvent: false });

    form.controls.leaveTypes.updateValueAndValidity({ emitEvent: false });
    form.controls.leaveStartDate.updateValueAndValidity({ emitEvent: false });
    form.controls.leaveEndDate.updateValueAndValidity({ emitEvent: false });
    form.controls.childBirthDate.updateValueAndValidity({ emitEvent: false });
    form.controls.childName.updateValueAndValidity({ emitEvent: false });
    form.controls.switchDate.updateValueAndValidity({ emitEvent: false });
    form.updateValueAndValidity({ emitEvent: false });
  }

  private updateInsuranceEffectiveDateValidation() {
    const control = this.insuranceForm.controls.insuranceEffectiveDate;
    control.setValidators(this.isInsuranceGradeChanged() ? [Validators.required] : null);
    if (!this.isInsuranceGradeChanged()) control.setValue('', { emitEvent: false });
    control.updateValueAndValidity({ emitEvent: false });
  }

  private buildWorkStatusChangeInput(
    currentStatus: WorkStatus,
    targetStatus: WorkStatus,
  ): WorkStatusChangeInput | null {
    const form = this.workStatusForm;
    if (currentStatus === '通常勤務' && targetStatus === '休職中') {
      const leaveTypes = form.controls.leaveTypes.value as LeaveType;
      const isMaternity = leaveTypes === '産前産後' || leaveTypes === '育児';
      return {
        scenario: 'leaveStart',
        leaveTypes,
        leaveStartDate: timestampFromDateInput(form.controls.leaveStartDate.value),
        ...(form.controls.leaveEndDate.value
          ? { leaveEndDate: timestampFromDateInput(form.controls.leaveEndDate.value) }
          : {}),
        ...(isMaternity
          ? {
            lifeEventType: (leaveTypes === '産前産後' ? '出産' : '育児') as LifeEventType,
            expectedBirthDate: timestampFromDateInput(form.controls.childBirthDate.value),
            ...(leaveTypes === '産前産後'
              ? { isMultipleBirth: form.controls.isMultipleBirth.value ?? false }
              : {}),
            ...(leaveTypes === '育児'
              ? { childName: form.controls.childName.value.trim() }
              : {}),
          }
          : {}),
      };
    }
    if (currentStatus === '休職中' && targetStatus === '通常勤務') {
      const leaveTypes = this.selectedEmployee?.leaveTypes;
      return {
        scenario: 'leaveEnd',
        leaveEndDate: timestampFromDateInput(form.controls.leaveEndDate.value),
        ...(leaveTypes === '産前産後' || leaveTypes === '育児'
          ? { lifeEventType: (leaveTypes === '産前産後' ? '出産' : '育児') as LifeEventType }
          : {}),
      };
    }
    if (currentStatus === '休職中' && targetStatus === '休職中') {
      const newType = form.controls.leaveTypes.value as LeaveType;
      if (newType && newType !== this.selectedEmployee?.leaveTypes) {
        return {
          scenario: 'leaveSwitch',
          leaveTypes: newType,
          switchDate: timestampFromDateInput(form.controls.switchDate.value),
        };
      }

      const currentStart = this.formatDateForInput(this.selectedEmployee?.leaveStartDate);
      const currentEnd = this.formatDateForInput(this.selectedEmployee?.leaveEndDate);
      const newStart = form.controls.leaveStartDate.value;
      const newEnd = form.controls.leaveEndDate.value;
      const startChanged = !!newStart && newStart !== currentStart;
      const endChanged = newEnd !== currentEnd;
      if (!startChanged && !endChanged) return null;
      if (startChanged) return null;

      return {
        scenario: 'leaveModify',
        leaveTypes: this.selectedEmployee?.leaveTypes ?? undefined,
        leaveStartDate: timestampFromDateInput(currentStart),
        ...(newEnd ? { leaveEndDate: timestampFromDateInput(newEnd) } : {}),
      };
    }
    return null;
  }

  private async validateWorkStatusDates(input: WorkStatusChangeInput): Promise<string | null> {
    if (input.scenario === 'leaveModify') {
      if (input.leaveStartDate && input.leaveEndDate
        && input.leaveEndDate.toMillis() < input.leaveStartDate.toMillis()) {
        return '終了予定日は休職開始日以降にしてください';
      }
      return null;
    }

    if (input.scenario === 'leaveStart' && input.leaveStartDate && input.leaveEndDate) {
      if (input.leaveEndDate.toMillis() < input.leaveStartDate.toMillis()) {
        return '終了予定日は休職開始日以降にしてください';
      }
    }
    if (input.scenario === 'leaveEnd' && input.leaveEndDate) {
      const leaveStart = this.selectedEmployee?.leaveStartDate;
      if (leaveStart && input.leaveEndDate.toMillis() < leaveStart.toMillis()) {
        return '休職終了日は休職開始日以降にしてください';
      }
    }

    return null;
  }

  private async validateEffectiveDateAtOrAfterCurrentPeriod(dateStr: string): Promise<string | null> {
    if (!dateStr) return '適用日は必須です';
    return this.validateDatesAtOrAfterCurrentPeriod([dateStr]);
  }

  /** 固定給のみ変更：作業対象期間を過ぎた過去日も可（未来日は申請中として別処理） */
  private validateFixedSalaryChangeEffectiveDate(dateStr: string): string | null {
    if (!dateStr) return '適用日は必須です';
    return null;
  }

  private async validateDatesAtOrAfterCurrentPeriod(dateStrings: string[]): Promise<string | null> {
    await this.companyService.getCompany();
    const targetPeriodStart = this.companyService.company()?.settings?.targetPeriod[0] ?? 1;
    const bounds = this.employeeService.currentWorkPeriodBounds();
    for (const dateStr of dateStrings) {
      if (!dateStr) continue;
      const date = parseDateInputValue(dateStr);
      if (bounds && date < bounds.periodStart) {
        return '日付は現在の作業対象期間以降で指定してください';
      }
      if (!isWorkMonthAtOrAfterCurrent(date, targetPeriodStart)) {
        return '日付は現在の作業対象期間以降で指定してください';
      }
    }
    return null;
  }

  private validateInsuranceEffectiveDateInCurrentPeriod(dateStr: string): string | null {
    if (!dateStr) return '適用日は必須です';
    const bounds = this.employeeService.currentWorkPeriodBounds();
    if (!bounds) return null;
    const date = parseDateInputValue(dateStr);
    if (isDateBeforeWorkPeriod(date, bounds.periodStart)) {
      return '適用日は現在の作業対象期間以降で指定してください';
    }
    return null;
  }

  private validateInsuranceQualificationDatesInModal(): string | null {
    if (!this.selectedEmployee?.insurance) return null;
    const bounds = this.employeeService.currentWorkPeriodBounds();
    if (!bounds) return null;

    const before = this.selectedEmployee.insurance;
    const checks: {
      label: string;
      beforeDetail?: InsuranceDetail;
      form: FormGroup;
    }[] = [
      {
        label: '健康保険',
        beforeDetail: before.healthInsurance,
        form: this.insuranceForm.controls.healthInsurance,
      },
      {
        label: '介護保険',
        beforeDetail: before.nursingCareInsurance,
        form: this.insuranceForm.controls.nursingCareInsurance,
      },
      {
        label: '厚生年金',
        beforeDetail: before.employeePensionInsurance,
        form: this.insuranceForm.controls.employeePensionInsurance,
      },
    ];

    for (const { label, beforeDetail, form } of checks) {
      const beforeStatus = this.getInsuranceStatusValue(beforeDetail);
      const afterStatus = form.controls['joined'].value as InsuranceStatus;
      const isJoining = beforeStatus !== 'joined' && afterStatus === 'joined';
      const isLosing = beforeStatus === 'joined' && (afterStatus === 'lost' || afterStatus === 'notJoined');

      if (isJoining) {
        const dateStr = form.controls['acquiredDate'].value;
        if (!dateStr) continue;
        const date = parseDateInputValue(dateStr);
        if (isDateBeforeWorkPeriod(date, bounds.periodStart)) {
          return `${label}取得日は現在の作業対象期間内で指定してください`;
        }
      }

      if (isLosing) {
        const dateStr = form.controls['lostDate'].value;
        if (!dateStr) continue;
        const date = parseDateInputValue(dateStr);
        if (isDateBeforeWorkPeriod(date, bounds.periodStart)) {
          return `${label}喪失日は現在の作業対象期間内で指定してください`;
        }
      }
    }

    return null;
  }

  private validateInsuranceJoinLossConflict(): string | null {
    if (!this.selectedEmployee?.insurance) return null;

    const before = this.selectedEmployee.insurance;
    const afterForm = this.insuranceForm;
    const checks = [
      {
        before: this.getInsuranceStatusValue(before.healthInsurance),
        after: afterForm.controls.healthInsurance.controls.joined.value,
      },
      {
        before: this.getInsuranceStatusValue(before.nursingCareInsurance),
        after: afterForm.controls.nursingCareInsurance.controls.joined.value,
      },
      {
        before: this.getInsuranceStatusValue(before.employeePensionInsurance),
        after: afterForm.controls.employeePensionInsurance.controls.joined.value,
      },
    ];

    let hasJoin = false;
    let hasLoss = false;
    for (const check of checks) {
      const wasJoined = check.before === 'joined';
      const isJoining = !wasJoined && check.after === 'joined';
      const isLosing = wasJoined && (check.after === 'lost' || check.after === 'notJoined');
      if (isJoining) hasJoin = true;
      if (isLosing) hasLoss = true;
    }

    if (hasJoin && hasLoss) {
      return '加入と喪失（もしくは未加入）の処理は同時にできません';
    }
    return null;
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

    this.insuranceForm.controls.currentGrade.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.updateInsuranceEffectiveDateValidation());
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
    const healthStatus = this.insuranceForm.controls.healthInsurance.controls.joined.value;
    this.insuranceFormService.updateCurrentGradeValidators(
      this.insuranceForm.controls.currentGrade,
      healthStatus,
    );
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

  private isChangingToDependent(change: {
    before: Dependent | null;
    after: Partial<Dependent>;
  }): boolean {
    if (change.after.isDependent === false) return false;
    if (!change.before) return true;
    return change.before.isDependent === false;
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

  private updateTransportationExpensesValidation() {
    const employmentContract = this.employmentContractForm.controls.employmentContract;
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
      initialDependentStatus: [(dependent.isDependent !== false ? 'dependent' : 'notDependent') as DependentCoverageStatus],
      dependentStartDate: [getDependentStartDateFormDefault(dependent), [Validators.required]],
      dependentEndDate: [getDependentEndDateFormDefault(dependent)],
      appliedDate: [''],
    });
    setupDependentDisabilityStudentValidators(group, this.destroyRef);
    this.setupDependentRestoreToDependentHandling(group);
    setupDependentPeriodValidators(group, this.destroyRef, this.validationService, () => this.selectedEmployee);
    this.setupDependentHealthInsuranceValidator(
      group,
      dependent.isDependent !== false ? 'dependent' : 'notDependent',
    );
    this.setupDependentAppliedDateValidators(group);
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
      initialDependentStatus: ['notDependent' as DependentCoverageStatus],
      dependentStartDate: ['', [this.validationService.requiredIfAnyDependentFieldEntered]],
      dependentEndDate: [''],
      appliedDate: [''],
    });
    this.setupDependentRowValidation(group);
    setupDependentDisabilityStudentValidators(group, this.destroyRef);
    setupDependentPeriodValidators(group, this.destroyRef, this.validationService, () => this.selectedEmployee, {
      enableEndDateField: false,
    });
    this.setupDependentHealthInsuranceValidator(group, 'notDependent');
    this.setupDependentAppliedDateValidators(group);
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
    (['name', 'birthDate', 'relationship', 'dependentStartDate'] as const).forEach(fieldName => {
      group.get(fieldName)?.valueChanges
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe(() => this.validationService.refreshDependentRowValidation(group));
    });
  }

  private setupDependentRestoreToDependentHandling(group: FormGroup): void {
    const statusControl = group.get('isDependentStatus');
    if (!statusControl) return;

    statusControl.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((currentStatus: DependentCoverageStatus) => {
        const initialStatus = group.get('initialDependentStatus')?.value as DependentCoverageStatus;
        if (initialStatus !== 'notDependent' || currentStatus !== 'dependent') return;
        const endControl = group.get('dependentEndDate');
        if (!endControl?.value) return;
        endControl.setValue('', { emitEvent: true });
      });
  }

  private validateAllDependentPeriodsInModal(): boolean {
    let valid = true;
    for (const control of this.dependentsArray.controls) {
      const group = control as FormGroup;
      const startDate = group.get('dependentStartDate')?.value;
      if (!startDate) continue;
      if (!this.selectedEmployee) continue;
      const value = group.getRawValue();
      const isRestoringToDependent =
        value.initialDependentStatus === 'notDependent'
        && value.isDependentStatus === 'dependent';
      const periodError = this.validationService.validateDependentPeriod(
        this.selectedEmployee.insurance?.healthInsurance,
        {
          isDependent: value.isDependentStatus !== 'notDependent',
          startDate: value.dependentStartDate,
          endDate: isRestoringToDependent ? undefined : (value.dependentEndDate || undefined),
        },
      );
      if (periodError) {
        group.setErrors({ ...(group.errors ?? {}), dependentPeriod: periodError });
        group.markAllAsTouched();
        valid = false;
      }
    }
    return valid;
  }

  private setupDependentHealthInsuranceValidator(
    group: FormGroup,
    initialStatus: DependentCoverageStatus,
  ): void {
    const control = group.get('isDependentStatus');
    if (!control) return;

    const clearHealthInsuranceError = () => {
      const errors = control.errors;
      if (!errors?.['healthInsuranceRequired']) return;
      const { healthInsuranceRequired, ...rest } = errors;
      control.setErrors(Object.keys(rest).length ? rest : null);
    };

    const validate = () => {
      const value = control.value as DependentCoverageStatus;
      if (value !== 'dependent') {
        clearHealthInsuranceError();
        return;
      }

      const isNewRow = group.get('isExisting')?.value !== true;
      const isChangingToDependent = isNewRow || initialStatus === 'notDependent';
      if (isChangingToDependent && !this.canRegisterDependent()) {
        control.setErrors({ ...(control.errors ?? {}), healthInsuranceRequired: true });
        control.markAsTouched();
        return;
      }
      clearHealthInsuranceError();
    };

    control.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => validate());
  }

  private setupDependentAppliedDateValidators(group: FormGroup): void {
    const appliedControl = group.get('appliedDate');
    if (!appliedControl) return;

    const setFieldError = (errorKey: string, message: string | null) => {
      if (!message) {
        if (!appliedControl.errors?.[errorKey]) return;
        const { [errorKey]: _, ...rest } = appliedControl.errors ?? {};
        appliedControl.setErrors(Object.keys(rest).length ? rest : null);
        return;
      }
      appliedControl.setErrors({ ...(appliedControl.errors ?? {}), [errorKey]: message });
    };

    const validate = () => {
      const value = group.getRawValue();
      const isNewRow = value.isExisting !== true;
      if (isNewRow && !value.name && !value.birthDate && !value.relationship) {
        setFieldError('appliedDateMatch', null);
        setFieldError('appliedDateInsurancePeriod', null);
        return;
      }
      const initialStatus = value.initialDependentStatus as DependentCoverageStatus;
      const currentStatus = value.isDependentStatus as DependentCoverageStatus;
      const appliedDate = String(value.appliedDate ?? '');
      const startDate = String(value.dependentStartDate ?? '');
      const endDate = String(value.dependentEndDate ?? '');

      const matchError = this.validationService.validateDependentAppliedDateMatch({
        initialStatus,
        currentStatus,
        appliedDate,
        startDate,
        endDate: endDate || undefined,
      });
      setFieldError('appliedDateMatch', matchError);

      const isRegisteringAsDependent =
        (isNewRow && currentStatus === 'dependent')
        || (initialStatus === 'notDependent' && currentStatus === 'dependent');
      const insuranceError = isRegisteringAsDependent && appliedDate
        ? this.validationService.validateDependentAppliedDateInInsurancePeriod(
          this.selectedEmployee?.insurance?.healthInsurance,
          appliedDate,
        )
        : null;
      setFieldError('appliedDateInsurancePeriod', insuranceError);
    };

    (['appliedDate', 'dependentStartDate', 'dependentEndDate', 'isDependentStatus'] as const).forEach(fieldName => {
      group.get(fieldName)?.valueChanges
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe(() => validate());
    });
  }

  private validateAllDependentAppliedDates(): boolean {
    let valid = true;
    for (const control of this.dependentsArray.controls) {
      const group = control as FormGroup;
      const value = group.getRawValue();
      const initialStatus = value.initialDependentStatus as DependentCoverageStatus;
      const currentStatus = value.isDependentStatus as DependentCoverageStatus;
      const isNewRow = value.isExisting !== true;
      if (isNewRow && !value.name && !value.birthDate && !value.relationship) continue;
      const appliedDate = String(value.appliedDate ?? '');
      const startDate = String(value.dependentStartDate ?? '');
      const endDate = String(value.dependentEndDate ?? '');
      const appliedControl = group.get('appliedDate');
      if (!appliedControl) continue;

      const clearAndSet = (errorKey: string, message: string | null) => {
        if (message) {
          appliedControl.setErrors({ ...(appliedControl.errors ?? {}), [errorKey]: message });
          appliedControl.markAsTouched();
          valid = false;
          return;
        }
        if (appliedControl.errors?.[errorKey]) {
          const { [errorKey]: _, ...rest } = appliedControl.errors ?? {};
          appliedControl.setErrors(Object.keys(rest).length ? rest : null);
        }
      };

      clearAndSet('appliedDateMatch', this.validationService.validateDependentAppliedDateMatch({
        initialStatus,
        currentStatus,
        appliedDate,
        startDate,
        endDate: endDate || undefined,
      }));

      const isRegisteringAsDependent =
        (isNewRow && currentStatus === 'dependent')
        || (initialStatus === 'notDependent' && currentStatus === 'dependent');
      const insuranceError = isRegisteringAsDependent && appliedDate
        ? this.validationService.validateDependentAppliedDateInInsurancePeriod(
          this.selectedEmployee?.insurance?.healthInsurance,
          appliedDate,
        )
        : null;
      clearAndSet('appliedDateInsurancePeriod', insuranceError);
    }
    return valid;
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
