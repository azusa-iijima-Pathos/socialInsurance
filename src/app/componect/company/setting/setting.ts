import { Component, DestroyRef, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Company, CompanySettings } from '../../../model/company';
import { CompanyService } from '../../../service/Firestore/company-service';
import { UPDATE_MESSAGES } from '../../../constants/constants';
import { CommonService, MessageTimer } from '../../../service/common/common-service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';

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

  companyId = sessionStorage.getItem('companyId');

  message: string = '';
  messageTimer: MessageTimer = null;


  form = this.fb.nonNullable.group({
    salaryInputFormat: [1],
    salaryOutputFormat: [1],
    paymentMonth: ['翌月' as '当月' | '翌月'],
    paymentDate: [25, [Validators.required, Validators.min(1), Validators.max(31)]],
    targetPeriodStart: [1, [Validators.required, Validators.min(1), Validators.max(31)]],
    // insuranceCloseingMonth: ['翌月' as '当月' | '翌月'],
    // insuranceCloseingDate: [15, [Validators.required, Validators.min(1), Validators.max(31)]],
    bonus: [true],
    bonusMonth1: [null as number | null, [Validators.min(1), Validators.max(12)]],
    bonusMonth2: [null as number | null, [Validators.min(1), Validators.max(12)]],
    bonusMonth3: [null as number | null, [Validators.min(1), Validators.max(12)]],
  });

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
      .subscribe(bonus => this.updateBonusMonthControls(bonus));
  }

  private updateBonusMonthControls(bonus: boolean) {
    const bonusMonthControls = [
      this.form.controls.bonusMonth1,
      this.form.controls.bonusMonth2,
      this.form.controls.bonusMonth3,
    ];

    this.form.controls.bonusMonth1.setValidators(
      bonus
        ? [Validators.required, Validators.min(1), Validators.max(12)]
        : [Validators.min(1), Validators.max(12)]
    );

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
    const setting: Partial<CompanySettings> = {
      salaryInputFormat: this.form.value.salaryInputFormat! as 1 | 2,
      salaryOutputFormat: this.form.value.salaryOutputFormat! as 1 | 2,
      paymentMonth: this.form.value.paymentMonth! as '当月' | '翌月',
      paymentDate: this.form.value.paymentDate!,
      targetPeriod: [
        this.form.value.targetPeriodStart! ,
        this.calculateTargetPeriodEnd(this.form.value.targetPeriodStart! ),
      ],
      // insuranceCloseingMonth: this.form.value.insuranceCloseingMonth! as '当月' | '翌月',
      // insuranceCloseingDate: this.form.value.insuranceCloseingDate!,
      bonus: this.form.value.bonus!,
      bonusMonths: this.form.value.bonus
        ? [
          this.form.value.bonusMonth1!,
          this.form.value.bonusMonth2!,
          this.form.value.bonusMonth3!,
        ].filter(month => month !== null && month !== undefined)
        : [],
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
    this.router.navigate(['/permission-setting']);
  }

}
