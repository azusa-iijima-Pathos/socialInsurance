import { Injectable } from '@angular/core';
import { AbstractControl, FormGroup, ValidationErrors, Validators } from '@angular/forms';
import { Timestamp } from '@angular/fire/firestore';
import { InsuranceDetail } from '../../model/employee';

export type InsuranceStatus = 'joined' | 'notJoined' | 'lost';
export type InsuranceName = 'healthInsurance' | 'nursingCareInsurance' | 'employeePensionInsurance';

export type InsuranceFormValue = {
  joined: InsuranceStatus;
  number: string;
  acquiredDate: string;
  lostDate: string;
  companyBurdenRate: number;
};

@Injectable({
  providedIn: 'root',
})
export class InsuranceFormService {

  getStatusForDisplay(detail?: InsuranceDetail): string {
    if (!detail) return '未加入';
    if (detail.joined) return '加入';
    if (detail.lostDate) return '喪失';
    return '未加入';
  }

  getStatusValue(detail?: InsuranceDetail): InsuranceStatus {
    if (!detail) return 'notJoined';
    if (detail.joined) return 'joined';
    if (detail.lostDate) return 'lost';
    return 'notJoined';
  }

  toFormValue(detail?: InsuranceDetail): InsuranceFormValue {
    return {
      joined: this.getStatusValue(detail),
      number: detail?.number ?? '',
      acquiredDate: this.formatDateInput(detail?.acquiredDate?.toDate()),
      lostDate: this.formatDateInput(detail?.lostDate?.toDate()),
      companyBurdenRate: detail?.companyBurdenRate ?? 50,
    };
  }

  createDetailFromForm(value: InsuranceFormValue): InsuranceDetail {
    if (value.joined === 'notJoined') {
      return { joined: false };
    }

    if (value.joined === 'joined') {
      return {
        joined: true,
        number: value.number,
        acquiredDate: Timestamp.fromDate(new Date(value.acquiredDate)),
        companyBurdenRate: value.companyBurdenRate,
      };
    }

    return {
      joined: false,
      number: value.number,
      acquiredDate: Timestamp.fromDate(new Date(value.acquiredDate)),
      lostDate: Timestamp.fromDate(new Date(value.lostDate)),
      companyBurdenRate: value.companyBurdenRate,
    };
  }

  getDateText(detail: InsuranceDetail | undefined, formatDate: (value?: Timestamp) => string): string {
    if (!detail) return '';
    if (detail.joined && detail.acquiredDate) {
      return `（取得日：${formatDate(detail.acquiredDate)}）`;
    }
    if (!detail.joined && detail.lostDate) {
      return `（喪失日：${formatDate(detail.lostDate)}）`;
    }
    return '';
  }

  isSubInsuranceJoinedDisabled(healthStatus: InsuranceStatus): boolean {
    return healthStatus !== 'joined';
  }

  areSubInsuranceOptionsLimited(healthStatus: InsuranceStatus): boolean {
    return healthStatus === 'notJoined' || healthStatus === 'lost';
  }

  healthInsuranceDependencyValidator = (control: AbstractControl): ValidationErrors | null => {
    const healthStatus = control.get('healthInsurance.joined')?.value as InsuranceStatus | undefined;
    const nursingStatus = control.get('nursingCareInsurance.joined')?.value as InsuranceStatus | undefined;
    const pensionStatus = control.get('employeePensionInsurance.joined')?.value as InsuranceStatus | undefined;
    if (healthStatus === 'joined') return null;
    if (nursingStatus === 'joined' || pensionStatus === 'joined') {
      return { healthInsuranceDependency: true };
    }
    return null;
  };

  syncSubInsuranceStatusesWithHealth(
    form: FormGroup,
    healthStatus: InsuranceStatus,
    insuranceNames: readonly InsuranceName[] = ['nursingCareInsurance', 'employeePensionInsurance'],
  ) {
    if (healthStatus === 'joined') {
      form.updateValueAndValidity({ emitEvent: false });
      return;
    }

    for (const name of insuranceNames) {
      const control = form.get(`${name}.joined`);
      if (control?.value === 'joined') {
        control.setValue(healthStatus, { emitEvent: true });
      }
    }
    form.updateValueAndValidity({ emitEvent: false });
  }

  updateInsuranceDetailControls(
    insuranceGroup: AbstractControl,
    status: InsuranceStatus,
    applyDate?: string,
  ) {
    const needsInsuranceDetail = status === 'joined' || status === 'lost';
    const needsLostDate = status === 'lost';
    const forbidsLostDate = status === 'joined' || status === 'notJoined';

    const numberControl = insuranceGroup.get('number');
    const acquiredDateControl = insuranceGroup.get('acquiredDate');
    const lostDateControl = insuranceGroup.get('lostDate');
    const companyBurdenRateControl = insuranceGroup.get('companyBurdenRate');
    if (!numberControl || !acquiredDateControl || !lostDateControl || !companyBurdenRateControl) return;

    numberControl.setValidators(
      needsInsuranceDetail
        ? [Validators.required, Validators.pattern('^[a-zA-Z0-9]+$')]
        : [Validators.pattern('^[a-zA-Z0-9]+$')],
    );
    acquiredDateControl.setValidators(
      needsInsuranceDetail
        ? [Validators.required, ...(applyDate ? [this.matchApplyDateValidator(applyDate, 'acquiredDate')] : [])]
        : null,
    );
    lostDateControl.setValidators(
      needsInsuranceDetail
        ? [
          needsLostDate ? Validators.required : null,
          forbidsLostDate ? this.forbidLostDateValidator : null,
          this.lostDateAfterAcquiredDateValidator,
          ...(applyDate && needsLostDate ? [this.matchApplyDateValidator(applyDate, 'lostDate')] : []),
        ].filter(validator => validator !== null)
        : null,
    );
    companyBurdenRateControl.setValidators(
      needsInsuranceDetail
        ? [Validators.required, Validators.min(0), Validators.max(100)]
        : [Validators.min(0), Validators.max(100)],
    );

    if (forbidsLostDate && lostDateControl.value) {
      lostDateControl.setValue('', { emitEvent: false });
    }

    for (const control of [numberControl, acquiredDateControl, lostDateControl, companyBurdenRateControl]) {
      if (needsInsuranceDetail) {
        control.enable({ emitEvent: false });
      } else {
        control.disable({ emitEvent: false });
      }
      control.updateValueAndValidity({ emitEvent: false });
    }
  }

  getControlErrorMessage(control: AbstractControl | null | undefined, label: string): string | null {
    if (!control || !control.errors || !(control.touched || control.dirty)) return null;
    const errors = control.errors;

    if (errors['required']) return `${label}は必須です`;
    if (errors['min']) return `${label}は${errors['min'].min}以上で入力してください`;
    if (errors['max']) return `${label}は${errors['max'].max}以下で入力してください`;
    if (errors['pattern']) return `${label}は半角英数字で入力してください`;
    if (errors['lostDateBeforeAcquiredDate']) return `${label}は取得日より後の日付で入力してください`;
    if (errors['lostDateNotAllowed']) return `${label}は加入・未加入の場合は入力できません`;
    if (errors['applyDateMismatch']) return `${label}は適用日と同じ日付で入力してください`;

    return `${label}の入力内容を確認してください`;
  }

  private lostDateAfterAcquiredDateValidator = (control: AbstractControl): ValidationErrors | null => {
    const lostDate = control.value;
    const acquiredDate = control.parent?.get('acquiredDate')?.value;
    if (!lostDate || !acquiredDate) return null;
    return lostDate > acquiredDate ? null : { lostDateBeforeAcquiredDate: true };
  };

  private forbidLostDateValidator = (control: AbstractControl): ValidationErrors | null => {
    return control.value ? { lostDateNotAllowed: true } : null;
  };

  private matchApplyDateValidator(applyDate: string, field: 'acquiredDate' | 'lostDate') {
    return (control: AbstractControl): ValidationErrors | null => {
      if (!control.value) return null;
      return control.value === applyDate ? null : { applyDateMismatch: true };
    };
  }

  private formatDateInput(date?: Date): string {
    if (!date) return '';
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
}
