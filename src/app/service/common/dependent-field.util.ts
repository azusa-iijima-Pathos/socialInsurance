import { DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AbstractControl, FormArray, FormGroup, Validators } from '@angular/forms';
import {
  DisabilityStatus,
  DisabilityType,
  StudentStatus,
  StudentType,
} from '../../constants/model-constants';
import { Dependent } from '../../model/dependent';
import { Employee } from '../../model/employee';
import { formatTimestampForDateInput, timestampFromDateInput } from './date-input.util';
import { ValidationService } from './validation-service';

export type DependentCoverageStatus = 'dependent' | 'notDependent';

type LegacyDependent = Dependent & { disabilityStudentType?: string };

export type DependentDisabilityStudentFormValue = {
  disabilityStatus: DisabilityStatus;
  disabilityType: DisabilityType | '';
  studentStatus: StudentStatus;
  studentType: StudentType | '';
};

export function getDependentDisabilityStudentFormDefaults(
  dependent?: Partial<Dependent>,
): DependentDisabilityStudentFormValue {
  const legacy = dependent as LegacyDependent | undefined;

  if (dependent?.hasDisability !== undefined || dependent?.isStudent !== undefined) {
    return {
      disabilityStatus: dependent.hasDisability ? 'あり' : 'なし',
      disabilityType: dependent.hasDisability ? (dependent.disabilityType ?? '') : '',
      studentStatus: dependent.isStudent ? '学生' : '学生じゃない',
      studentType: dependent.isStudent ? (dependent.studentType ?? '') : '',
    };
  }

  if (legacy?.disabilityStudentType === '障害者') {
    return {
      disabilityStatus: 'あり',
      disabilityType: '',
      studentStatus: '学生じゃない',
      studentType: '',
    };
  }

  if (legacy?.disabilityStudentType === '学生') {
    return {
      disabilityStatus: 'なし',
      disabilityType: '',
      studentStatus: '学生',
      studentType: '',
    };
  }

  return {
    disabilityStatus: 'なし',
    disabilityType: '',
    studentStatus: '学生じゃない',
    studentType: '',
  };
}

export function mapDependentDisabilityStudentFromForm(
  raw: Record<string, unknown>,
): Pick<Dependent, 'hasDisability' | 'disabilityType' | 'isStudent' | 'studentType'> {
  const disabilityStatus = raw['disabilityStatus'];
  const studentStatus = raw['studentStatus'];
  return {
    hasDisability: disabilityStatus === 'あり',
    ...(disabilityStatus === 'あり' && raw['disabilityType']
      ? { disabilityType: raw['disabilityType'] as DisabilityType }
      : {}),
    isStudent: studentStatus === '学生',
    ...(studentStatus === '学生' && raw['studentType']
      ? { studentType: raw['studentType'] as StudentType }
      : {}),
  };
}

export function formatDisabilityForDisplay(dependent?: Dependent | null): string {
  if (!dependent) return '—';

  const legacy = dependent as LegacyDependent;
  if (dependent.hasDisability === true) {
    return dependent.disabilityType ? `あり（${dependent.disabilityType}）` : 'あり';
  }
  if (dependent.hasDisability === false) {
    return 'なし';
  }
  if (legacy.disabilityStudentType === '障害者') {
    return 'あり';
  }
  return 'なし';
}

export function formatStudentForDisplay(dependent?: Dependent | null): string {
  if (!dependent) return '—';

  const legacy = dependent as LegacyDependent;
  if (dependent.isStudent === true) {
    return dependent.studentType ? `学生（${dependent.studentType}）` : '学生';
  }
  if (dependent.isStudent === false) {
    return '学生じゃない';
  }
  if (legacy.disabilityStudentType === '学生') {
    return '学生';
  }
  return '学生じゃない';
}

export function setupDependentDisabilityStudentValidators(
  group: FormGroup,
  destroyRef?: DestroyRef,
): void {
  const applyValidators = () => {
    const disabilityStatus = group.get('disabilityStatus')?.value;
    const studentStatus = group.get('studentStatus')?.value;
    const disabilityTypeControl = group.get('disabilityType');
    const studentTypeControl = group.get('studentType');

    if (disabilityStatus === 'あり') {
      disabilityTypeControl?.setValidators([Validators.required]);
    } else {
      disabilityTypeControl?.clearValidators();
      disabilityTypeControl?.setValue('', { emitEvent: false });
    }

    if (studentStatus === '学生') {
      studentTypeControl?.setValidators([Validators.required]);
    } else {
      studentTypeControl?.clearValidators();
      studentTypeControl?.setValue('', { emitEvent: false });
    }

    disabilityTypeControl?.updateValueAndValidity({ emitEvent: false });
    studentTypeControl?.updateValueAndValidity({ emitEvent: false });
  };

  applyValidators();

  const subscribe = (fieldName: 'disabilityStatus' | 'studentStatus') => {
    const control = group.get(fieldName);
    if (!control) return;
    if (destroyRef) {
      control.valueChanges.pipe(takeUntilDestroyed(destroyRef)).subscribe(() => applyValidators());
      return;
    }
    control.valueChanges.subscribe(() => applyValidators());
  };

  subscribe('disabilityStatus');
  subscribe('studentStatus');
}

export function getDependentStartDateFormDefault(dependent?: Dependent): string {
  return formatTimestampForDateInput(dependent?.dependentStartDate);
}

export function getDependentEndDateFormDefault(dependent?: Dependent): string {
  return formatTimestampForDateInput(dependent?.dependentEndDate);
}

export function mapDependentPeriodFromForm(
  raw: Record<string, unknown>,
): Pick<Dependent, 'isDependent' | 'dependentStartDate' | 'dependentEndDate'> {
  const isDependent = raw['isDependentStatus'] !== 'notDependent';
  const startDate = String(raw['dependentStartDate'] ?? '');
  const endDate = String(raw['dependentEndDate'] ?? '');
  return {
    isDependent,
    ...(startDate ? { dependentStartDate: timestampFromDateInput(startDate) } : {}),
    ...(endDate ? { dependentEndDate: timestampFromDateInput(endDate) } : {}),
  };
}

export function canRegisterDependentByHealthInsurance(employee?: Employee | null): boolean {
  const healthInsurance = employee?.insurance?.healthInsurance;
  if (!healthInsurance) return false;
  if (healthInsurance.joined === true) return true;
  if (healthInsurance.lostDate && healthInsurance.acquiredDate) return true;
  return false;
}

export function setupDependentPeriodValidators(
  group: FormGroup,
  destroyRef: DestroyRef,
  validationService: ValidationService,
  getEmployee: () => Employee | null,
  options?: { enableEndDateField?: boolean },
): void {
  const enableEndDateField = options?.enableEndDateField !== false;

  const clearPeriodError = (target: FormGroup) => {
    if (!target.errors?.['dependentPeriod']) return;
    const { dependentPeriod, ...rest } = target.errors ?? {};
    target.setErrors(Object.keys(rest).length ? rest : null);
  };

  const validatePeriod = (target: FormGroup) => {
    const startDate = target.get('dependentStartDate')?.value;
    if (!startDate) {
      clearPeriodError(target);
      return;
    }
    const employee = getEmployee();
    if (!employee) {
      clearPeriodError(target);
      return;
    }
    const value = target.value;
    const periodError = validationService.validateDependentPeriod(
      employee.insurance?.healthInsurance,
      {
        isDependent: value.isDependentStatus !== 'notDependent',
        startDate: value.dependentStartDate,
        endDate: value.dependentEndDate || undefined,
      },
    );
    if (periodError) {
      target.setErrors({ ...(target.errors ?? {}), dependentPeriod: periodError });
      target.get('dependentStartDate')?.markAsTouched();
    } else {
      clearPeriodError(target);
    }
  };

  const updateEndDateValidators = () => {
    if (!enableEndDateField) {
      validatePeriod(group);
      return;
    }
    const endControl = group.get('dependentEndDate');
    const isDependent = group.get('isDependentStatus')?.value !== 'notDependent';
    if (isDependent) {
      endControl?.clearValidators();
    } else {
      endControl?.setValidators([Validators.required]);
    }
    endControl?.updateValueAndValidity({ emitEvent: false });
    validatePeriod(group);
  };

  if (enableEndDateField) {
    group.get('isDependentStatus')?.valueChanges
      .pipe(takeUntilDestroyed(destroyRef))
      .subscribe(() => updateEndDateValidators());
  }

  (['dependentStartDate', 'dependentEndDate'] as const).forEach(fieldName => {
    group.get(fieldName)?.valueChanges
      .pipe(takeUntilDestroyed(destroyRef))
      .subscribe(() => validatePeriod(group));
  });

  updateEndDateValidators();
}

export function validateAllDependentPeriods(
  formArray: FormArray,
  validationService: ValidationService,
  getEmployee: () => Employee | null,
): boolean {
  let valid = true;
  for (const control of formArray.controls) {
    const group = control as FormGroup;
    const startDate = group.get('dependentStartDate')?.value;
    if (!startDate) continue;
    const employee = getEmployee();
    if (!employee) continue;
    const value = group.value;
    const periodError = validationService.validateDependentPeriod(
      employee.insurance?.healthInsurance,
      {
        isDependent: value.isDependentStatus !== 'notDependent',
        startDate: value.dependentStartDate,
        endDate: value.dependentEndDate || undefined,
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
