import { Component, DestroyRef, inject } from '@angular/core';
import { EmployeeService } from '../../../service/Firestore/employee-service';
import { AbstractControl, FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { ValidationService } from '../../../service/common/validation-service';
import { CommonService, MessageTimer } from '../../../service/common/common-service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { EmployeeInsurance } from '../../../model/employee';
import { UPDATE_MESSAGES } from '../../../constants/constants';
import { AddInsuranceCsv } from '../add-insurance-csv/add-insurance-csv';
import { Router, ActivatedRoute } from '@angular/router';
import { CompanyService } from '../../../service/Firestore/company-service';
import { DependentService } from '../../../service/Firestore/dependent-service';
import { Dependent } from '../../../model/dependent';
import { InsuranceFormService, InsuranceName, InsuranceStatus } from '../../../service/logic/insurance-form.service';

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
  private insuranceFormService = inject(InsuranceFormService);

  mode = this.route.snapshot.queryParamMap.get('mode');

  messageTimer: MessageTimer = null;

  workingMonthForm = this.fb.nonNullable.group({
    workingYear: [new Date().getFullYear(), [Validators.required, Validators.min(1900), Validators.max(9999)]],
    workingMonth: [new Date().getMonth() + 1, [Validators.required, Validators.min(1), Validators.max(12)]],
  });
  
  form = this.fb.nonNullable.group({
    employeeId: ['', [Validators.required, Validators.pattern('^[a-zA-Z0-9]+$')], [this.validationService.correctEmployeeId]],
    currentGrade: [0, [Validators.required, Validators.min(0), Validators.max(50)]],
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

  message: string = '';

  async ngOnInit() { 
    await this.employeeService.getAllEmployees();
    this.setupInsuranceDetailControls('healthInsurance');
    this.setupInsuranceDetailControls('nursingCareInsurance');
    this.setupInsuranceDetailControls('employeePensionInsurance');
    this.setupInsuranceDependencyRules();
    this.insuranceFormService.setupSharedInsuranceNumberSync(this.form, this.destroyRef);
  }

  private setupInsuranceDependencyRules() {
    this.form.setValidators(control => this.insuranceFormService.healthInsuranceDependencyValidator(control));
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
    this.insuranceFormService.updateInsuranceDetailControls(this.form.controls[insuranceName], status);
    this.form.updateValueAndValidity({ emitEvent: false });
  }

  getInsuranceControlError(controlPath: string, label: string): string | null {
    return this.insuranceFormService.getControlErrorMessage(this.form.get(controlPath), label);
  }

  private syncSubInsuranceStatusesWithHealth(healthStatus: InsuranceStatus) {
    this.insuranceFormService.syncSubInsuranceStatusesWithHealth(this.form, healthStatus);
  }

  isSubInsuranceJoinedDisabled(): boolean {
    return this.insuranceFormService.isSubInsuranceJoinedDisabled(
      this.form.controls.healthInsurance.controls.joined.value,
    );
  }

  async onSubmit() {
    this.insuranceFormService.syncSharedInsuranceNumbers(this.form);
    this.form.updateValueAndValidity({ emitEvent: false });

    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.commonService.showTimedMessage('保険情報の入力内容を確認してください', value => this.message = value, this.messageTimer);
      return;
    }

    const insuranceInfo = this.insuranceFormService.createEmployeeInsuranceForSave(this.form, {
      currentGrade: this.getCurrentGradeForSave(),
      basicPensionNumber: this.form.controls.basicPensionNumber.value,
    });

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

  isShowModal: boolean = false;
  isComplete: boolean = false;
  companyId = sessionStorage.getItem('companyId')!;
  // トップ画面へ進む
  async toStartStart() {
    this.isShowModal = true;
   await this.companyService.getCompany();
   const companySettings = this.companyService.company()?.settings;
   if (companySettings) {
    this.isComplete = true;
   }
  }

  toSetting() {
    this.router.navigate(['/company-setting'], { queryParams: { mode: 'initial' } });
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

}
