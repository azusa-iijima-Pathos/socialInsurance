import { DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormGroup, Validators } from '@angular/forms';
import {
  DisabilityStatus,
  DisabilityType,
  StudentStatus,
  StudentType,
} from '../../constants/model-constants';
import { Dependent } from '../../model/dependent';

type LegacyDependent = Dependent & { disabilityStudentType?: string };

export type DependentDisabilityStudentFormValue = {
  disabilityStatus: DisabilityStatus;
  disabilityType: DisabilityType | '';
  studentStatus: StudentStatus;
  studentType: StudentType | '';
};

export function getDependentDisabilityStudentFormDefaults(
  dependent?: Dependent,
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
