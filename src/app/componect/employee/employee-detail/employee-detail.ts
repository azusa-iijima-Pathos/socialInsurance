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
import { EmployeeEventApprovalService, FixedSalaryApprovalDraft, InsuranceApprovalDraft } from '../../../service/logic/employee-event-approval.service';
import { EventService } from '../../../service/Firestore/event-service';
import { CalculationRunService, SystemCalculationRunItem } from '../../../service/Firestore/calculation-run-service';
import { Event as EmployeeEvent } from '../../../model/event';
import { ValidationService } from '../../../service/common/validation-service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Timestamp } from '@angular/fire/firestore';
import { UPDATE_MESSAGES } from '../../../constants/constants';
import {
  EMPLOYMENT_CATEGORIES,
  EmploymentCategory,
  LEAVE_TYPES,
  LeaveType,
  RELATIONSHIPS,
  Relationship,
  WORK_STATUSES,
  WORK_STYLES,
  WorkStatus,
  WorkStyle,
} from '../../../constants/model-constants';

type InsuranceName = 'healthInsurance' | 'nursingCareInsurance' | 'employeePensionInsurance';
type InsuranceStatus = 'joined' | 'notJoined' | 'lost';
type InsuranceJudgement = {
  isHealthInsuranceRequired?: boolean;
  isNursingCareInsuranceRequired?: boolean;
  isPensionInsuranceRequired?: boolean;
};
type DependentCoverageStatus = 'dependent' | 'notDependent';

@Component({
  selector: 'app-employee-detail',
  imports: [CommonModule, FormsModule, ReactiveFormsModule],
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
  private employeeEventApprovalService = inject(EmployeeEventApprovalService);
  private eventService = inject(EventService);
  private calculationRunService = inject(CalculationRunService);
  private destroyRef = inject(DestroyRef);

  loginEmployeeId = sessionStorage.getItem('loginEmployeeId') ?? '';
  workingMonth = sessionStorage.getItem('workingMonth') ?? '';
  employeeEvents: EmployeeEvent[] = [];
  pendingSystemRuns: SystemCalculationRunItem[] = [];
  // showEventNotice = false;

  approvalModalOpen = false;
  approvalModalType: 'fixedSalary' | 'insurance' | null = null;
  approvingEvent: EmployeeEvent | null = null;
  approvingSystemRun: SystemCalculationRunItem | null = null;
  fixedSalaryDraft: FixedSalaryApprovalDraft | null = null;
  insuranceDraft: InsuranceApprovalDraft | null = null;

  WORK_STATUSES = WORK_STATUSES;
  LEAVE_TYPES = LEAVE_TYPES;
  EMPLOYMENT_CATEGORIES = EMPLOYMENT_CATEGORIES;
  WORK_STYLES = WORK_STYLES;
  RELATIONSHIPS = RELATIONSHIPS;

  employeeSearchText = '';

  employeeMap = this.employeeService.allEmployeeNameMap;
  officeNameMap = computed(() => this.officeService.allOfficeNameMap());

  selectedEmployeeId: string = '';
  selectedEmployee: Employee | null = null;

  dependents: Dependent[] = [];

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

    const employeeId = this.route.snapshot.queryParamMap.get('employeeId');
    if (employeeId) {
      this.selectedEmployeeId = employeeId;
      await this.selectEmployee();
    }
  }

  get dependentsArray(): FormArray<FormGroup> {
    return this.dependentForm.controls.dependents;
  }

  async selectEmployee() {
    this.message = '';
    const employee = await this.employeeService.getEmployeeByEmployeeId(this.selectedEmployeeId);
    if (employee) {
      this.selectedEmployee = employee;
      this.dependents = await this.dependentService.getDependents(this.selectedEmployeeId);
      await this.getAutoCalculationResult();
      await this.loadEmployeeEvents();
    } else {
      this.selectedEmployee = null;
      this.dependents = [];
      this.employeeEvents = [];
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
    if (insuranceDetail.lostDate) {
      return '喪失';
    }
    return insuranceDetail.joined ? '加入' : '未加入';
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
    const wasRetireStatus = previousEmployee.workStatus === '退社済み' || previousEmployee.workStatus === '退社予定';
    const isNewRetireStatus = newWorkStatus === '退社済み' || newWorkStatus === '退社予定';
    if (isNewRetireStatus && !wasRetireStatus) {
      const confirmed = window.confirm(
        '退社にした場合、情報変更ができなくなります。変更後、イベント一覧から退社イベントの承認のみ行ってください。',
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
        : {}),
      ...(this.showResignationDateField()
        ? { resignationDate: Timestamp.fromDate(new Date(this.contractForm.controls.resignationDate.value)) }
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
    await this.selectEmployee();
    this.closeContractModal();
  }


  editInsuranceInfo() {
    if (this.isRetiredEmployee()) return;
    if (!this.selectedEmployee) return;

    const insurance = this.selectedEmployee.insurance;
    this.insuranceForm.patchValue({
      currentGrade: insurance?.currentGrade ?? 0,
      healthInsurance: this.patchInsuranceGroup(insurance?.healthInsurance),
      nursingCareInsurance: this.patchInsuranceGroup(insurance?.nursingCareInsurance),
      employeePensionInsurance: this.patchInsuranceGroup(insurance?.employeePensionInsurance),
    });

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
    if (this.insuranceForm.invalid) {
      this.insuranceForm.markAllAsTouched();
      return;
    }

    const insuranceInfo: Partial<EmployeeInsurance> = {
      currentGrade: this.insuranceForm.controls.currentGrade.value,
      healthInsurance: this.createInsuranceDetailFromForm('healthInsurance'),
      nursingCareInsurance: this.createInsuranceDetailFromForm('nursingCareInsurance'),
      employeePensionInsurance: this.createInsuranceDetailFromForm('employeePensionInsurance'),
    };

    const result = await this.employeeService.updateEmployeeInsurance(this.selectedEmployeeId, insuranceInfo);
    if (!result) {
      this.showMessage(UPDATE_MESSAGES.FAILED);
      return;
    }

    this.showMessage(`保険情報を${UPDATE_MESSAGES.SUCCESS}`);
    await this.employeeService.getAllEmployees(true);
    await this.selectEmployee();
    this.closeInsuranceModal();
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
    this.addNewDependentRow();
    this.dependentModalOpen = true;
  }

  closeDependentModal() {
    this.dependentModalOpen = false;
    while (this.dependentsArray.length > 0) {
      this.dependentsArray.removeAt(0);
    }
  }

  addNewDependentRow() {
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
          birthDate: Timestamp.fromDate(new Date(value.birthDate)),
          relationship: value.relationship as Relationship,
          isDependent: value.isDependentStatus === 'dependent',
        });
        continue;
      }

      if (!value.name && !value.birthDate && !value.relationship) continue;

      newDependents.push({
        dependentId: `${nextId++}`,
        name: value.name,
        birthDate: Timestamp.fromDate(new Date(value.birthDate)),
        relationship: value.relationship as Relationship,
        isDependent: true,
      });
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
    const events = await this.eventService.getEmployeeEventsUpToWorkingMonth(this.selectedEmployeeId);
    this.employeeEvents = events.filter(event => event.applicantType !== 'システム');
    this.pendingSystemRuns = await this.calculationRunService.getPendingSystemRunsForEmployee(this.selectedEmployeeId);
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
      }
      this.approvingSystemRun = run;
      this.approvalModalOpen = true;
      return;
    }

    if (run.eventType === '退社') {
      const approved = await this.employeeEventApprovalService.approveRetireEvent(
        this.selectedEmployeeId, eventView, this.loginEmployeeId, run.runId,
      );
      if (approved) {
        this.showMessage('システム計算結果を承認しました');
        await this.employeeService.getAllEmployees(true);
        await this.selectEmployee();
      } else {
        this.showMessage('承認に失敗しました');
      }
    }
  }

  showInsuranceDetail(detail?: InsuranceDetail): boolean {
    if (!detail) return false;
    return detail.joined === true || !!detail.lostDate || !!detail.number || !!detail.acquiredDate;
  }

  isInsuranceNumberMissing(detail?: InsuranceDetail): boolean {
    if (!detail) return false;
    const status = this.getInsuranceStatus(detail);
    return (status === '加入' || status === '喪失') && !detail.number;
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
      }
      this.approvingEvent = event;
      this.approvalModalOpen = true;
      return;
    }

    let approved = false;
    if (event.eventType === '退社' && event.applicantType === 'システム') {
      return;
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
      await this.selectEmployee();
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
      await this.selectEmployee();
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
    const payload = event.payload ?? {};
    const before = payload['before'];
    const after = payload['after'];

    if (event.eventType === '氏名変更') {
      return [`姓：${before ?? '—'} → ${after ?? '—'}`];
    }

    if (event.eventType === '扶養情報変更') {
      const beforeDep = before as Record<string, unknown> | null;
      const afterDep = after as Record<string, unknown>;
      const lines = [
        `氏名：${beforeDep?.['name'] ?? '—'} → ${afterDep?.['name'] ?? '—'}`,
        `続柄：${beforeDep?.['relationship'] ?? '—'} → ${afterDep?.['relationship'] ?? '—'}`,
      ];
      return lines;
    }

    const beforeEmployee = before as Employee | undefined;
    const afterEmployee = after as Employee | undefined;
    return [
      `勤務状況：${beforeEmployee?.workStatus ?? '—'} → ${afterEmployee?.workStatus ?? '—'}`,
      `休職種別：${beforeEmployee?.leaveTypes ?? '—'} → ${afterEmployee?.leaveTypes ?? '—'}`,
    ];
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
  }

  async rejectApprovalModal() {
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
      approved = await this.employeeEventApprovalService.approveInsuranceEvent(
        this.selectedEmployeeId, eventView, this.insuranceDraft, this.loginEmployeeId, runId,
      );
    }

    if (approved) {
      this.showMessage('イベントを承認しました');
      await this.employeeService.getAllEmployees(true);
      await this.selectEmployee();
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
    this.insuranceForm.setValidators(this.healthInsuranceDependencyValidator);

    this.insuranceForm.controls.healthInsurance.controls.joined.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(status => this.syncSubInsuranceStatusesWithHealth(status));

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
    const insuranceGroup = this.insuranceForm.controls[insuranceName];
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
        ? [needsLostDate ? Validators.required : null, this.lostDateAfterAcquiredDateValidator].filter(v => v !== null)
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
    this.insuranceForm.updateValueAndValidity({ emitEvent: false });
  }

  private lostDateAfterAcquiredDateValidator = (control: AbstractControl): ValidationErrors | null => {
    const lostDate = control.value;
    const acquiredDate = control.parent?.get('acquiredDate')?.value;
    if (!lostDate || !acquiredDate) return null;
    return lostDate > acquiredDate ? null : { lostDateBeforeAcquiredDate: true };
  };

  private healthInsuranceDependencyValidator = (control: AbstractControl): ValidationErrors | null => {
    const healthStatus = control.get('healthInsurance.joined')?.value as InsuranceStatus | undefined;
    const nursingStatus = control.get('nursingCareInsurance.joined')?.value as InsuranceStatus | undefined;
    const pensionStatus = control.get('employeePensionInsurance.joined')?.value as InsuranceStatus | undefined;
    if (healthStatus === 'joined') return null;
    if (nursingStatus === 'joined' || pensionStatus === 'joined') {
      return { healthInsuranceDependency: true };
    }
    return null;
  };

  private syncSubInsuranceStatusesWithHealth(healthStatus: InsuranceStatus) {
    if (healthStatus === 'joined') {
      this.insuranceForm.updateValueAndValidity({ emitEvent: false });
      return;
    }

    for (const name of ['nursingCareInsurance', 'employeePensionInsurance'] as const) {
      const control = this.insuranceForm.controls[name].controls.joined;
      if (control.value === 'joined') {
        control.setValue(healthStatus, { emitEvent: true });
      }
    }
    this.insuranceForm.updateValueAndValidity({ emitEvent: false });
  }

  isSubInsuranceJoinedDisabled(): boolean {
    return this.insuranceForm.controls.healthInsurance.controls.joined.value !== 'joined';
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
    const insuranceInfo: Partial<EmployeeInsurance> = {
      currentGrade: this.insuranceForm.controls.currentGrade.value,
      healthInsurance: this.createInsuranceDetailFromForm('healthInsurance'),
      nursingCareInsurance: this.createInsuranceDetailFromForm('nursingCareInsurance'),
      employeePensionInsurance: this.createInsuranceDetailFromForm('employeePensionInsurance'),
    };

    return {
      ...this.selectedEmployee!,
      insurance: insuranceInfo as EmployeeInsurance,
    };
  }

  private createInsuranceDetailFromForm(insuranceName: InsuranceName): InsuranceDetail {
    const value = this.insuranceForm.controls[insuranceName].getRawValue();
    if (value.joined === 'notJoined') {
      return { joined: false };
    }

    return {
      joined: value.joined === 'joined',
      number: value.number,
      acquiredDate: value.acquiredDate ? Timestamp.fromDate(new Date(value.acquiredDate)) : undefined,
      ...(value.lostDate ? { lostDate: Timestamp.fromDate(new Date(value.lostDate)) } : {}),
      companyBurdenRate: value.companyBurdenRate,
    };
  }

  private patchInsuranceGroup(detail?: InsuranceDetail) {
    return {
      joined: this.getInsuranceStatusValue(detail),
      number: detail?.number ?? '',
      acquiredDate: this.formatDateForInput(detail?.acquiredDate),
      lostDate: this.formatDateForInput(detail?.lostDate),
      companyBurdenRate: detail?.companyBurdenRate ?? 50,
    };
  }

  private getInsuranceStatusValue(detail?: InsuranceDetail): InsuranceStatus {
    if (!detail) return 'notJoined';
    if (detail.lostDate) return 'lost';
    return detail.joined ? 'joined' : 'notJoined';
  }

  getDependentStatusLabel(isDependent?: boolean): string {
    return isDependent !== false ? '扶養対象' : '扶養対象外';
  }

  private createExistingDependentForm(dependent: Dependent) {
    return this.fb.nonNullable.group({
      dependentId: [dependent.dependentId],
      isExisting: [true],
      name: [dependent.name ?? '', [Validators.required]],
      birthDate: [this.formatDateForInput(dependent.birthDate), [Validators.required, this.dependentBirthDateNotFutureValidator]],
      relationship: [dependent.relationship ?? ('' as Relationship | ''), [Validators.required]],
      isDependentStatus: [(dependent.isDependent !== false ? 'dependent' : 'notDependent') as DependentCoverageStatus],
    });
  }

  private createNewDependentForm() {
    const group = this.fb.nonNullable.group({
      dependentId: [''],
      isExisting: [false],
      name: ['', [this.validationService.requiredIfAnyDependentFieldEntered]],
      birthDate: ['', [this.validationService.requiredIfAnyDependentFieldEntered, this.dependentBirthDateNotFutureValidator]],
      relationship: ['' as Relationship | '', [this.validationService.requiredIfAnyDependentFieldEntered]],
      isDependentStatus: ['dependent' as DependentCoverageStatus],
    });
    this.setupDependentRowValidation(group);
    return group;
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
    if (!date) return '';
    const dateValue = date.toDate();
    const year = dateValue.getFullYear();
    const month = String(dateValue.getMonth() + 1).padStart(2, '0');
    const day = String(dateValue.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
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

}
