import { Component, DestroyRef, inject } from '@angular/core';
import { FormArray, FormBuilder, Validators, ReactiveFormsModule, FormGroup } from '@angular/forms';
import { DependentService } from '../../../service/Firestore/dependent-service';
import { CommonService, MessageTimer } from '../../../service/common/common-service';
import { ValidationService } from '../../../service/common/validation-service';
import { EmployeeService } from '../../../service/Firestore/employee-service';
import { Dependent } from '../../../model/dependent';
import { Employee } from '../../../model/employee';
import { timestampFromDateInput } from '../../../service/common/date-input.util';
import { mapDependentDisabilityStudentFromForm } from '../../../service/common/dependent-field.util';
import { Relationship, CohabitationType } from '../../../constants/model-constants';
import { CommonModule } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { setupDependentDisabilityStudentValidators } from '../../../service/common/dependent-field.util';
import { RELATIONSHIPS, DISABILITY_TYPES, STUDENT_TYPES } from '../../../constants/model-constants';
import { InsuranceFormService } from '../../../service/logic/insurance-form.service';
import { AddDependentsCSV } from '../add-dependents-csv/add-dependents-csv';
import { ActivatedRoute, Router } from '@angular/router';

export type EmployeeDependentOverviewRow = {
  employeeId: string;
  employeeName: string;
  healthInsuranceStatus: string;
  dependentsSummary: string;
  dependents: Dependent[];
};

@Component({
  selector: 'app-add-dependents',
  imports: [CommonModule, ReactiveFormsModule, AddDependentsCSV],
  templateUrl: './add-dependents.html',
  styleUrl: './add-dependents.css',
})
export class AddDependents {

  private fb = inject(FormBuilder);
  private dependentService = inject(DependentService);
  commonService = inject(CommonService);
  private validationService = inject(ValidationService);
  private employeeService = inject(EmployeeService);
  private insuranceFormService = inject(InsuranceFormService);
  private destroyRef = inject(DestroyRef);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  mode = this.route.snapshot.queryParamMap.get('mode');

  message = '';
  messageTimer: MessageTimer | null = null;
  RELATIONSHIPS = RELATIONSHIPS;
  DISABILITY_TYPES = DISABILITY_TYPES;
  STUDENT_TYPES = STUDENT_TYPES;

  selectedEmployee: Employee | null = null;
  employeeOverviewRows: EmployeeDependentOverviewRow[] = [];
  overviewLoading = false;

  form = this.fb.nonNullable.group({
    employeeId: ['', [Validators.required, Validators.pattern('^[a-zA-Z0-9]+$')], [this.validationService.correctEmployeeId]],
    dependents: this.fb.array([])
  });

  private createDependentForm(): FormGroup {
    const dependentForm = this.fb.nonNullable.group({
      name: ['', [Validators.required]],
      birthDate: ['', [Validators.required, this.validationService.birthDateValidator]],
      relationship: ['', [Validators.required]],
      cohabitationType: ['', [Validators.required]],
      annualIncome: ['', [Validators.required]],
      occupation: ['', [Validators.required]],
      hasDisability: [false],
      disabilityType: ['', [Validators.required]],
      isStudent: [false],
      studentType: ['', [Validators.required]],
      isDependentStatus: ['dependent' as 'dependent' | 'notDependent'],
      dependentStartDate: ['', [Validators.required]],
      dependentEndDate: [''],
    });

    this.setupDependentRowValidation(dependentForm);
    this.setupDependentPeriodValidation(dependentForm);
    setupDependentDisabilityStudentValidators(dependentForm, this.destroyRef);

    return dependentForm;
  }

  async ngOnInit() {
    await this.employeeService.getAllEmployees();
    this.addDependent();
    await this.loadEmployeeOverviews();

    this.form.get('employeeId')?.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(async employeeId => {
        if (employeeId) {
          this.selectedEmployee = await this.employeeService.getEmployeeByEmployeeId(employeeId);
        } else {
          this.selectedEmployee = null;
        }
        this.refreshAllDependentPeriodValidation();
      });
  }

  get dependentsFormArray(): FormArray {
    return this.form.get('dependents') as FormArray;
  }

  addDependent() {
    this.dependentsFormArray.push(this.createDependentForm());
  }

  removeDependent(index: number) {
    this.dependentsFormArray.removeAt(index);
  }

  getDependentStatusLabel(isDependent?: boolean): string {
    return isDependent !== false ? '扶養対象' : '扶養対象外';
  }

  async onSubmit() {
    if (!this.selectedEmployee) {
      this.selectedEmployee = await this.employeeService.getEmployeeByEmployeeId(this.form.value.employeeId!);
    }

    this.refreshAllDependentPeriodValidation();

    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const existingDependents = await this.dependentService.getDependents(this.form.value.employeeId!);
    let nextId = existingDependents.length;

    const dependents: Partial<Dependent>[] = [];
    for (const dependentControl of this.dependentsFormArray.controls) {
      const value = dependentControl.value;
      if (!value.name && !value.birthDate && !value.relationship) continue;

      nextId++;
      dependents.push({
        dependentId: `${nextId}`,
        name: value.name!,
        birthDate: timestampFromDateInput(value.birthDate!),
        relationship: value.relationship! as Relationship,
        isDependent: value.isDependentStatus === 'dependent',
        dependentStartDate: timestampFromDateInput(value.dependentStartDate!),
        ...(value.dependentEndDate ? { dependentEndDate: timestampFromDateInput(value.dependentEndDate) } : {}),
        ...(value.cohabitationType ? { cohabitationType: value.cohabitationType as CohabitationType } : {}),
        ...(value.annualIncome !== '' && value.annualIncome != null
          ? { annualIncome: Number(value.annualIncome) }
          : {}),
        ...(value.occupation?.trim() ? { occupation: value.occupation.trim() } : {}),
        ...mapDependentDisabilityStudentFromForm(value),
      });
    }

    if (dependents.length === 0) {
      this.message = '登録する扶養情報がありません';
      return;
    }

    const dependentsRegistered = await this.dependentService.registerDependents(this.form.value.employeeId!, dependents);
    if (!dependentsRegistered) {
      this.message = '扶養情報の登録に失敗しました';
      return;
    }

    this.message = '扶養情報の登録に成功しました';
    this.messageTimer = this.commonService.showTimedMessage(this.message, value => this.message = value, this.messageTimer);
    this.form.patchValue({ employeeId: this.form.value.employeeId });
    this.dependentsFormArray.clear();
    this.addDependent();
    await this.loadEmployeeOverviews();
  }

  async onCsvRegistered() {
    await this.loadEmployeeOverviews();
  }

  async loadEmployeeOverviews() {
    this.overviewLoading = true;
    try {
      await this.employeeService.getAllEmployees(true);
      const employees = this.employeeService.allEmployees();
      this.employeeOverviewRows = await Promise.all(
        employees.map(async employee => {
          const dependents = await this.dependentService.getDependents(employee.employeeId);
          return {
            employeeId: employee.employeeId,
            employeeName: `${employee.firstName ?? ''} ${employee.lastName ?? ''}`.trim() || '—',
            healthInsuranceStatus: this.insuranceFormService.getStatusForDisplay(employee.insurance?.healthInsurance),
            dependentsSummary: this.formatDependentsSummary(dependents),
            dependents,
          };
        }),
      );
    } finally {
      this.overviewLoading = false;
    }
  }

  formatDependentsSummary(dependents: Dependent[]): string {
    if (dependents.length === 0) return '未登録';
    return dependents
      .map(dependent => {
        const status = this.getDependentStatusLabel(dependent.isDependent);
        const start = dependent.dependentStartDate
          ? this.commonService.formatDate(dependent.dependentStartDate)
          : '—';
        const end = dependent.dependentEndDate
          ? this.commonService.formatDate(dependent.dependentEndDate)
          : '—';
        return `${dependent.name ?? '—'}（${status}／${start}〜${end}）`;
      })
      .join('、');
  }

  private setupDependentRowValidation(group: FormGroup) {
    (['name', 'birthDate', 'relationship'] as const).forEach(fieldName => {
      group.get(fieldName)?.valueChanges
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe(() => this.validationService.refreshDependentRowValidation(group));
    });
  }

  private setupDependentPeriodValidation(group: FormGroup) {
    const updateEndDateValidators = () => {
      const endControl = group.get('dependentEndDate');
      const isDependent = group.get('isDependentStatus')?.value === 'dependent';
      if (isDependent) {
        endControl?.clearValidators();
      } else {
        endControl?.setValidators([Validators.required]);
      }
      endControl?.updateValueAndValidity({ emitEvent: false });
      this.validateDependentPeriodForGroup(group);
    };

    group.get('isDependentStatus')?.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => updateEndDateValidators());

    (['dependentStartDate', 'dependentEndDate'] as const).forEach(fieldName => {
      group.get(fieldName)?.valueChanges
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe(() => this.validateDependentPeriodForGroup(group));
    });

    updateEndDateValidators();
  }

  private refreshAllDependentPeriodValidation() {
    for (const control of this.dependentsFormArray.controls) {
      this.validateDependentPeriodForGroup(control as FormGroup);
    }
  }

  private validateDependentPeriodForGroup(group: FormGroup) {
    const startDate = group.get('dependentStartDate')?.value;
    if (!startDate) {
      this.clearDependentPeriodError(group);
      return;
    }

    if (!this.selectedEmployee) {
      this.clearDependentPeriodError(group);
      return;
    }

    const value = group.value;
    const periodError = this.validationService.validateDependentPeriod(
      this.selectedEmployee.insurance?.healthInsurance,
      {
        isDependent: value.isDependentStatus === 'dependent',
        startDate: value.dependentStartDate,
        endDate: value.dependentEndDate || undefined,
      },
    );

    if (periodError) {
      group.setErrors({ ...(group.errors ?? {}), dependentPeriod: periodError });
      group.get('dependentStartDate')?.markAsTouched();
    } else if (group.errors?.['dependentPeriod']) {
      const { dependentPeriod, ...rest } = group.errors ?? {};
      group.setErrors(Object.keys(rest).length ? rest : null);
    }
  }

  private clearDependentPeriodError(group: FormGroup) {
    if (!group.errors?.['dependentPeriod']) return;
    const { dependentPeriod, ...rest } = group.errors ?? {};
    group.setErrors(Object.keys(rest).length ? rest : null);
  }

  toAddInsuranceInfo() {
    this.router.navigate(['/employee-addInsurance'], { queryParams: { mode: 'initial' } });
  }

  toWorkingMonthSetting() {
    this.router.navigate(['/employee-addInsurance'], { queryParams: { mode: 'initial', step: 'workingMonth' } });
  }
}

