import { Component, DestroyRef, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { EmployeeService } from '../../../service/Firestore/employee-service';
import { CommonService, MessageTimer } from '../../../service/common/common-service';
import { EmploymentContract, Employee } from '../../../model/employee';
import { DELETE_MESSAGES, UPDATE_MESSAGES } from '../../../constants/constants';
import { EMPLOYMENT_CATEGORIES, EmploymentCategory, LEAVE_TYPES, LeaveType, WORK_STATUSES, WORK_STYLES } from '../../../constants/model-constants';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { WorkStatus, WorkStyle } from '../../../constants/model-constants';
import { ValidationService } from '../../../service/common/validation-service';
import { Timestamp } from '@angular/fire/firestore';
import { OfficeService } from '../../../service/Firestore/office-service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

@Component({
  selector: 'app-employee-list',
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './employee-list.html',
  styleUrl: './employee-list.css',
})
export class EmployeeList {

  employeeService = inject(EmployeeService);
  commonService = inject(CommonService);
  officeService = inject(OfficeService);
  private fb = inject(FormBuilder);
  private validationService = inject(ValidationService);
  private destroyRef = inject(DestroyRef);

  allEmployees = this.employeeService.allEmployees;
  officeNameMap = this.officeService.allOfficeNameMap;
  WORK_STATUSES = WORK_STATUSES;
  LEAVE_TYPES = LEAVE_TYPES;
  EMPLOYMENT_CATEGORIES = EMPLOYMENT_CATEGORIES;
  WORK_STYLES = WORK_STYLES;

  message: string = '';
  private messageTimer: MessageTimer = null;

  async ngOnInit() {
    //全社員を取得
    await this.employeeService.getAllEmployees();
    await this.officeService.getAllOffice();
    this.setupLeaveTypesValidation();
  }

  /** 社員を削除 */
  async deleteEmployee(employee: Employee) {
    const result = await this.employeeService.deleteEmployee(employee);
    if (!result) {
      this.commonService.showTimedMessage(DELETE_MESSAGES.FAILED, value => this.message = value, this.messageTimer);
      return;
    }
    this.commonService.showTimedMessage(`社員ID：${employee.employeeId}　${employee.firstName} ${employee.lastName}さんを${DELETE_MESSAGES.SUCCESS}`, value => this.message = value, this.messageTimer);
    await this.employeeService.getAllEmployees(true);
    return;
  }




  editEmployeeModalOpen: boolean = false;
  form = this.fb.nonNullable.group({
    employeeId: [''],
    firstName: ['', [Validators.required]],
    lastName: ['', [Validators.required]],
    birthDate: ['', [Validators.required, this.validationService.birthDateValidator]],
    hireDate: ['', [Validators.required]],
    workStatus: ['通常勤務', [Validators.required]],
    leaveTypes: [''],
    employmentContract: this.fb.nonNullable.group({
      employmentCategory: ['正社員', [Validators.required]],
      workStyle: ['フルタイム', [Validators.required]],
      officeId: ['', [Validators.required]],
      contractedWorkingHoursPerWeek: ['40', [Validators.min(0)]],
      contractedWorkingDaysPerMonth: ['20', [Validators.min(0)]],
      fixedSalary: ['0', [Validators.min(0)]],
      transportationExpenses: ['', [Validators.min(0)]],
    }),
  });
  showTransportationExpensesInModal: boolean = false;

  /** 社員を編集 */
  /** 編集モーダルを開く */
  editEmployee(employee: Employee) {
    this.editEmployeeModalOpen = true;
    this.showTransportationExpensesInModal = employee.employmentContract?.transportationExpenses !== undefined;
    this.form.patchValue({
      ...employee,
      birthDate: this.formatDateForInput(employee.birthDate),
      hireDate: this.formatDateForInput(employee.hireDate),
      employmentContract: {
        ...employee.employmentContract,
        contractedWorkingHoursPerWeek: employee.employmentContract?.contractedWorkingHoursPerWeek?.toString(),
        contractedWorkingDaysPerMonth: employee.employmentContract?.contractedWorkingDaysPerMonth?.toString(),
        fixedSalary: employee.employmentContract?.fixedSalary?.toString(),
        transportationExpenses: employee.employmentContract?.transportationExpenses?.toString() ?? '',
      },
      leaveTypes: employee.leaveTypes ?? '',
    });
  }

  /** 編集モーダルを閉じる */
  closeEditEmployeeModal() {
    this.editEmployeeModalOpen = false;
    this.showTransportationExpensesInModal = false;
    this.form.reset();
  }

  /** 編集モーダルを送信 */
  async editEmployeeModalSubmit() {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const employmentContract: Partial<EmploymentContract> = {
      employmentCategory: this.form.value.employmentContract?.employmentCategory! as EmploymentCategory,
      workStyle: this.form.value.employmentContract?.workStyle! as WorkStyle,
      officeId: this.form.value.employmentContract?.officeId!,
      contractedWorkingHoursPerWeek: Number(this.form.value.employmentContract?.contractedWorkingHoursPerWeek),
      contractedWorkingDaysPerMonth: Number(this.form.value.employmentContract?.contractedWorkingDaysPerMonth),
      fixedSalary: Number(this.form.value.employmentContract?.fixedSalary),
      ...(this.showTransportationExpensesInModal
        ? { transportationExpenses: Number(this.form.value.employmentContract?.transportationExpenses) }
        : {}),
    };
    const employee: Partial<Employee> = {
      employeeId: this.form.value.employeeId!,
      firstName: this.form.value.firstName!,
      lastName: this.form.value.lastName!,
      birthDate: Timestamp.fromDate(new Date(this.form.value.birthDate!)),
      hireDate: Timestamp.fromDate(new Date(this.form.value.hireDate!)),
      workStatus: this.form.value.workStatus! as WorkStatus,
      ...(this.form.value.workStatus === '休職中'
        ? { leaveTypes: this.form.value.leaveTypes! as LeaveType }
        : {}),
      employmentContract: employmentContract,
    };
    const result = await this.employeeService.updateEmployee(employee);
    if (!result) {
      this.commonService.showTimedMessage(UPDATE_MESSAGES.FAILED, value => this.message = value, this.messageTimer);
      this.closeEditEmployeeModal();
      return;
    }
    this.commonService.showTimedMessage(`社員ID：${employee.employeeId}　${employee.firstName} ${employee.lastName}さんを${UPDATE_MESSAGES.SUCCESS}`, value => this.message = value, this.messageTimer);
    await this.employeeService.getAllEmployees(true);
    this.closeEditEmployeeModal();
    return;
  }

  private formatDateForInput(date: Timestamp | null | undefined): string {
    if (!date) return '';

    const dateValue = date.toDate();
    const year = dateValue.getFullYear();
    const month = String(dateValue.getMonth() + 1).padStart(2, '0');
    const day = String(dateValue.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private setupLeaveTypesValidation() {
    this.updateLeaveTypesValidation();
    this.form.controls.workStatus.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.updateLeaveTypesValidation());
  }

  private updateLeaveTypesValidation() {
    const leaveTypesControl = this.form.controls.leaveTypes;
    const isLeaveTypesRequired = this.form.controls.workStatus.value === '休職中';

    leaveTypesControl.setValidators(isLeaveTypesRequired ? [Validators.required] : null);
    if (!isLeaveTypesRequired) {
      leaveTypesControl.setValue('', { emitEvent: false });
    }
    leaveTypesControl.updateValueAndValidity({ emitEvent: false });
  }

  showLeaveTypesField() {
    return this.form.controls.workStatus.value === '休職中';
  }
}
