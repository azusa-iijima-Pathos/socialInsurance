import { Component, DestroyRef, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators, AbstractControl, ValidationErrors } from '@angular/forms';
import { Company, CompanySettings } from '../../../model/company';
import { CompanyService } from '../../../service/Firestore/company-service';
import { UPDATE_MESSAGES } from '../../../constants/constants';
import { CommonService, MessageTimer } from '../../../service/common/common-service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router, ActivatedRoute } from '@angular/router';

/**
 * 会社設定画面
 */

@Component({
  selector: 'app-setting',
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './setting.html',
  styleUrl: './setting.css',
})
export class Setting {

  private fb = inject(FormBuilder);
  private companyService = inject(CompanyService);
  private commonService = inject(CommonService);
  private destroyRef = inject(DestroyRef);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  companyId = sessionStorage.getItem('companyId');

  message: string = '';
  messageTimer: MessageTimer = null;

  mode = this.route.snapshot.queryParamMap.get('mode');

  form = this.fb.nonNullable.group({
    salaryInputFormat: [1],
    paymentMonth: ['翌月' as '当月' | '翌月'],
    paymentDate: [25, [Validators.required, Validators.min(1), Validators.max(31)]],
    targetPeriodStart: [1, [Validators.required, Validators.min(1), Validators.max(31)]],
    // insuranceCloseingMonth: ['翌月' as '当月' | '翌月'],
    // insuranceCloseingDate: [15, [Validators.required, Validators.min(1), Validators.max(31)]],
    bonus: [true],
    bonusMonth1: [null as number | null, [Validators.min(1), Validators.max(12)]],
    bonusMonth2: [null as number | null, [Validators.min(1), Validators.max(12)]],
    bonusMonth3: [null as number | null, [Validators.min(1), Validators.max(12)]],
  }, { validators: [group => this.bonusMonthsGroupValidator(group)] });

  ngOnInit() {
    this.companyService.getCompany();

    if (this.companyService.company()?.settings) {
      const settings = this.companyService.company()?.settings;
      this.form.patchValue({
        ...settings,
        targetPeriodStart: settings?.targetPeriod[0],
        bonusMonth1: settings?.bonusMonths?.[0] ?? null,
        bonusMonth2: settings?.bonusMonths?.[1] ?? null,
        bonusMonth3: settings?.bonusMonths?.[2] ?? null,
      });
    }

    this.updateBonusMonthControls(this.form.value.bonus!);
    this.form.controls.bonus.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(bonus => {
        this.updateBonusMonthControls(bonus);
        this.form.updateValueAndValidity();
      });

    for (const controlName of ['bonusMonth1', 'bonusMonth2', 'bonusMonth3'] as const) {
      this.form.controls[controlName].valueChanges
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe(() => this.form.updateValueAndValidity({ emitEvent: false }));
    }
  }

  private bonusMonthsGroupValidator(group: AbstractControl): ValidationErrors | null {
    if (!group.get('bonus')?.value) return null;

    const raw = group.getRawValue();
    const hasValidMonth = [raw.bonusMonth1, raw.bonusMonth2, raw.bonusMonth3].some(month => {
      if (month === null || month === undefined) return false;
      const numericMonth = Number(month);
      return Number.isFinite(numericMonth) && numericMonth >= 1 && numericMonth <= 12;
    });

    return hasValidMonth ? null : { bonusMonthsRequired: true };
  }

  private updateBonusMonthControls(bonus: boolean) {
    const bonusMonthControls = [
      this.form.controls.bonusMonth1,
      this.form.controls.bonusMonth2,
      this.form.controls.bonusMonth3,
    ];

    for (const control of bonusMonthControls) {
      if (bonus) {
        control.enable({ emitEvent: false });
      } else {
        control.disable({ emitEvent: false });
      }
      control.updateValueAndValidity({ emitEvent: false });
    }
  }

  private calculateTargetPeriodEnd(targetPeriodStart: number): number {
    return targetPeriodStart === 1 ? 31 : targetPeriodStart - 1;
  }

  /** 会社設定を更新 */
  async register() {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const raw = this.form.getRawValue();
    const bonusMonths = raw.bonus
      ? [raw.bonusMonth1, raw.bonusMonth2, raw.bonusMonth3]
        .filter((month): month is number => month !== null && month !== undefined)
        .map(month => Number(month))
        .filter(month => month >= 1 && month <= 12)
      : [];

    if (raw.bonus && bonusMonths.length === 0) {
      this.form.markAllAsTouched();
      this.message = 'ボーナスありの場合、ボーナス支払い月を1つ以上入力してください';
      this.commonService.showTimedMessage(this.message, value => this.message = value, this.messageTimer);
      return;
    }

    const setting: Partial<CompanySettings> = {
      salaryInputFormat: raw.salaryInputFormat as 1 | 2,
      paymentMonth: raw.paymentMonth as '当月' | '翌月',
      paymentDate: raw.paymentDate,
      targetPeriod: [
        raw.targetPeriodStart,
        this.calculateTargetPeriodEnd(raw.targetPeriodStart),
      ],
      // insuranceCloseingMonth: this.form.value.insuranceCloseingMonth! as '当月' | '翌月',
      // insuranceCloseingDate: this.form.value.insuranceCloseingDate!,
      bonus: raw.bonus,
      bonusMonths,
    };
    const result = await this.companyService.updateCompanySettings(this.companyId!, setting);
    if (!result) {
      this.message = UPDATE_MESSAGES.FAILED;
      return;
    }
    this.message = UPDATE_MESSAGES.SUCCESS;
    this.commonService.showTimedMessage(this.message, value => this.message = value, this.messageTimer);
    this.companyService.getCompany(true);
  }

  /** 従業員権限設定画面に遷移 */
  toEmployeePermissionSetting() {
    this.router.navigate(['/permission-setting'], { queryParams: { mode: 'initial' } });
  }

}
