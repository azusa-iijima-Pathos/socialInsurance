import { Component, DestroyRef, inject } from '@angular/core';
import { EmployeeService } from '../../../service/Firestore/employee-service';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { ValidationService } from '../../../service/common/validation-service';
import { CommonService, MessageTimer } from '../../../service/common/common-service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { EmployeeInsurance, InsuranceDetail } from '../../../model/employee';
import { Timestamp } from '@angular/fire/firestore';
import { UPDATE_MESSAGES } from '../../../constants/constants';
import { AddInsuranceCsv } from '../add-insurance-csv/add-insurance-csv';
import { Router, ActivatedRoute } from '@angular/router';
import { CompanyService } from '../../../service/Firestore/company-service';
import { DependentService } from '../../../service/Firestore/dependent-service';
import { Dependent } from '../../../model/dependent';

type InsuranceName = 'healthInsurance' | 'nursingCareInsurance' | 'employeePensionInsurance';
type InsuranceStatus = 'joined' | 'notJoined' | 'lost';

@Component({
  selector: 'app-add-insurance-info',
  imports: [CommonModule, ReactiveFormsModule, AddInsuranceCsv],
  templateUrl: './add-insurance-info.html',
  styleUrl: './add-insurance-info.css',
})
export class AddInsuranceInfo {

  private employeeService = inject(EmployeeService);
  private fb = inject(FormBuilder);
  private validationService = inject(ValidationService);
  private destroyRef = inject(DestroyRef);
  commonService = inject(CommonService);
  private router = inject(Router);  
  private route = inject(ActivatedRoute);
  private companyService = inject(CompanyService);
  private dependentService = inject(DependentService);

  mode = this.route.snapshot.queryParamMap.get('mode');

  messageTimer: MessageTimer = null;
  showWorkingMonthSetting = false;

  workingMonthForm = this.fb.nonNullable.group({
    workingYear: [new Date().getFullYear(), [Validators.required, Validators.min(1900), Validators.max(9999)]],
    workingMonth: [new Date().getMonth() + 1, [Validators.required, Validators.min(1), Validators.max(12)]],
  });
  
  form = this.fb.nonNullable.group({
    employeeId: ['', [Validators.required, Validators.pattern('^[a-zA-Z0-9]+$')], [this.validationService.correctEmployeeId]],
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

  message: string = '';

  async ngOnInit() { 
    await this.employeeService.getAllEmployees();
    this.setupInsuranceDetailControls('healthInsurance');
    this.setupInsuranceDetailControls('nursingCareInsurance');
    this.setupInsuranceDetailControls('employeePensionInsurance');
    this.setupInsuranceDependencyRules();
    this.showWorkingMonthSetting = this.mode === 'initial' && !this.hasWorkingMonth();
  }

  private setupInsuranceDependencyRules() {
    this.form.setValidators(control => this.healthInsuranceDependencyValidator(control));
    this.form.controls.healthInsurance.controls.joined.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(status => {
        this.syncSubInsuranceStatusesWithHealth(status);
        this.applyCurrentGradeRule();
      });

    for (const name of ['nursingCareInsurance', 'employeePensionInsurance'] as const) {
      this.form.controls[name].controls.joined.valueChanges
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe(() => this.applyCurrentGradeRule());
    }
  }

  // 加入していない保険の付属情報は入力できないようにする
  private setupInsuranceDetailControls(insuranceName: InsuranceName) {
    const insuranceGroup = this.form.controls[insuranceName];
    this.updateInsuranceDetailControls(insuranceGroup.controls.joined.value, insuranceName);
    insuranceGroup.controls.joined.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(status => this.updateInsuranceDetailControls(status, insuranceName));
    insuranceGroup.controls.acquiredDate.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => insuranceGroup.controls.lostDate.updateValueAndValidity());
  }

  // 画面上の加入状態に合わせて、番号・取得日・喪失日・負担率の入力可否と必須チェックを切り替える
  private updateInsuranceDetailControls(status: InsuranceStatus, insuranceName: InsuranceName) {
    const insuranceGroup = this.form.controls[insuranceName];
    const needsInsuranceDetail = status === 'joined' || status === 'lost';
    const needsLostDate = status === 'lost';

    // 対象保険グループの付属情報controlを取り出す
    const numberControl = insuranceGroup.controls.number;
    const acquiredDateControl = insuranceGroup.controls.acquiredDate;
    const lostDateControl = insuranceGroup.controls.lostDate;
    const companyBurdenRateControl = insuranceGroup.controls.companyBurdenRate;

    // 加入・喪失の場合だけ、保険番号を必須にする
    // 未加入の場合は入力不可にするが、再選択時に半角チェックが戻るようpatternだけ残す
    numberControl.setValidators(
      needsInsuranceDetail
        ? [Validators.required, Validators.pattern('^[a-zA-Z0-9]+$')]
        : [Validators.pattern('^[a-zA-Z0-9]+$')]
    );

    // 加入・喪失の場合だけ、取得日を必須にする
    acquiredDateControl.setValidators(needsInsuranceDetail ? [Validators.required] : null);
    // 喪失の場合は喪失日も必須。加入中は任意だが、入力されたら取得日より後かチェックする
    lostDateControl.setValidators(
      needsInsuranceDetail
        ? [needsLostDate ? Validators.required : null, this.lostDateAfterAcquiredDateValidator].filter(validator => validator !== null)
        : null
    ); 

    // 加入・喪失の場合だけ、会社負担率を必須にする
    // 0〜100の範囲チェックは状態に関係なく同じルールとして持たせる
    companyBurdenRateControl.setValidators(
      needsInsuranceDetail
        ? [Validators.required, Validators.min(0), Validators.max(100)]
        : [Validators.min(0), Validators.max(100)]
    );

    // 付属情報はまとめて、加入・喪失なら入力可、未加入なら入力不可に切り替える
    const detailControls = [numberControl, acquiredDateControl, lostDateControl, companyBurdenRateControl];
    for (const control of detailControls) {
      if (needsInsuranceDetail) {
        control.enable({ emitEvent: false });
      } else {
        control.disable({ emitEvent: false });
      }
      // validatorを付け替えた直後に、現在の値でvalid/invalidを再判定する
      control.updateValueAndValidity({ emitEvent: false });
    }

    // フォーム全体の状態も、付属情報の切り替え後に再判定する
    this.form.updateValueAndValidity({ emitEvent: false });
  }

  // 喪失日が入力されている場合だけ、取得日より後の日付かを確認する
  private lostDateAfterAcquiredDateValidator = (control: AbstractControl): ValidationErrors | null => {
    const lostDate = control.value;
    const acquiredDate = control.parent?.get('acquiredDate')?.value;
    if (!lostDate || !acquiredDate) return null;
    return lostDate > acquiredDate ? null : { lostDateBeforeAcquiredDate: true };
  }

  // フォームの値を検証して、エラーがなければデータを保存する
  async onSubmit() {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.commonService.showTimedMessage('保険情報の入力内容を確認してください', value => this.message = value, this.messageTimer);
      return;
    }

    const insuranceInfo:Partial<EmployeeInsurance> = {
      currentGrade: this.getCurrentGradeForSave(),
      healthInsurance: this.createInsuranceDetailFromForm('healthInsurance'),
      nursingCareInsurance: this.createInsuranceDetailFromForm('nursingCareInsurance'),
      employeePensionInsurance: this.createInsuranceDetailFromForm('employeePensionInsurance'),
    };

    const result = await this.employeeService.updateEmployeeInsurance(this.form.value.employeeId!, insuranceInfo);

    if (!result) {
      this.commonService.showTimedMessage(UPDATE_MESSAGES.FAILED, value => this.message = value, this.messageTimer);
      return;
    }
    if (!insuranceInfo.healthInsurance?.joined) {
      const dependentsUpdated = await this.updateDependentsToNotDependent(this.form.value.employeeId!);
      if (!dependentsUpdated) {
        this.commonService.showTimedMessage('扶養情報の更新に失敗しました', value => this.message = value, this.messageTimer);
        return;
      }
    }
    this.commonService.showTimedMessage(`社員ID：${this.form.value.employeeId}　${this.commonService.getEmployeeName(this.form.value.employeeId!)}さんの保険情報を${UPDATE_MESSAGES.SUCCESS}`, value => this.message = value, this.messageTimer);
    await this.employeeService.getAllEmployees(true);
    this.showWorkingMonthSetting = this.mode === 'initial' && !this.hasWorkingMonth();
    return;
  }

  // disabledの項目も含めて値を取り出し、未加入や空の喪失日を無理にTimestampへ変換しない
  private createInsuranceDetailFromForm(insuranceName: InsuranceName): InsuranceDetail {
    const value = this.form.controls[insuranceName].getRawValue();
    if (value.joined === 'notJoined') {
      return { joined: false };
    }

    return {
      // Firestore上は加入/未加入のbooleanだけにする。喪失は未加入扱いで詳細情報だけ保存する。
      joined: value.joined === 'joined',
      number: value.number,
      acquiredDate: Timestamp.fromDate(new Date(value.acquiredDate)),
      ...(value.lostDate ? { lostDate: Timestamp.fromDate(new Date(value.lostDate)) } : {}),
      companyBurdenRate: value.companyBurdenRate,
    };
  }

  private healthInsuranceDependencyValidator = (control: AbstractControl): ValidationErrors | null => {
    const healthStatus = control.get('healthInsurance.joined')?.value as InsuranceStatus | undefined;
    const nursingStatus = control.get('nursingCareInsurance.joined')?.value as InsuranceStatus | undefined;
    const pensionStatus = control.get('employeePensionInsurance.joined')?.value as InsuranceStatus | undefined;
    if (healthStatus === 'joined') return null;
    return nursingStatus === 'joined' || pensionStatus === 'joined'
      ? { healthInsuranceDependency: true }
      : null;
  }

  private syncSubInsuranceStatusesWithHealth(healthStatus: InsuranceStatus) {
    if (healthStatus === 'joined') {
      this.form.updateValueAndValidity({ emitEvent: false });
      return;
    }

    for (const name of ['nursingCareInsurance', 'employeePensionInsurance'] as const) {
      const control = this.form.controls[name].controls.joined;
      if (control.value === 'joined') {
        control.setValue(healthStatus, { emitEvent: true });
      }
    }
    this.form.updateValueAndValidity({ emitEvent: false });
  }

  isSubInsuranceJoinedDisabled(): boolean {
    return this.form.controls.healthInsurance.controls.joined.value !== 'joined';
  }

  private applyCurrentGradeRule() {
    if (this.areAllInsuranceStatusesNotJoined()) {
      this.form.controls.currentGrade.setValue(0, { emitEvent: false });
    }
  }

  private getCurrentGradeForSave(): number {
    return this.areAllInsuranceStatusesNotJoined() ? 0 : Number(this.form.controls.currentGrade.value ?? 0);
  }

  private areAllInsuranceStatusesNotJoined(): boolean {
    return this.form.controls.healthInsurance.controls.joined.value === 'notJoined'
      && this.form.controls.nursingCareInsurance.controls.joined.value === 'notJoined'
      && this.form.controls.employeePensionInsurance.controls.joined.value === 'notJoined';
  }

  private async updateDependentsToNotDependent(employeeId: string): Promise<boolean> {
    const dependents = await this.dependentService.getDependents(employeeId);
    const activeDependents = dependents.filter(dependent => dependent.isDependent !== false);
    if (activeDependents.length === 0) return true;

    const updates: Partial<Dependent>[] = activeDependents.map(dependent => ({
      ...dependent,
      isDependent: false,
    }));
    return await this.dependentService.updateDependents(employeeId, updates);
  }

  toPermissionSetting() {
    this.router.navigate(['/permission-setting'], { queryParams: { mode: 'initial' } });
  }

  toStartStart() {
    if (!this.hasWorkingMonth()) {
      this.showWorkingMonthSetting = true;
      this.commonService.showTimedMessage('トップ画面へ進む前に作業月を設定してください', value => this.message = value, this.messageTimer);
      return;
    }
    this.router.navigate(['/top-for-manage']);
  }

  async setWorkingMonthAndGoTop() {
    if (this.workingMonthForm.invalid) {
      this.workingMonthForm.markAllAsTouched();
      return;
    }

    const workingYear = this.workingMonthForm.value.workingYear!;
    const workingMonth = this.workingMonthForm.value.workingMonth!;
    const companyId = sessionStorage.getItem('companyId');
    if (!companyId) {
      this.commonService.showTimedMessage('会社IDが取得できません', value => this.message = value, this.messageTimer);
      return;
    }

    const result = await this.companyService.updateCompanySettings(companyId, { workingYear, workingMonth });
    if (!result) {
      this.commonService.showTimedMessage(UPDATE_MESSAGES.FAILED, value => this.message = value, this.messageTimer);
      return;
    }

    sessionStorage.setItem('workingYear', workingYear.toString());
    sessionStorage.setItem('workingMonth', workingMonth.toString());
    this.router.navigate(['/top-for-manage']);
  }

  hasWorkingMonth() {
    return !!sessionStorage.getItem('workingYear') && !!sessionStorage.getItem('workingMonth');
  }

}
