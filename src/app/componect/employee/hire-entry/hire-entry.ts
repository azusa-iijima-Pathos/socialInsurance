import { CommonModule } from '@angular/common';
import { Component, DestroyRef, computed, inject } from '@angular/core';
import { AbstractControl, FormArray, FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { timestampFromDateInput } from '../../../service/common/date-input.util';
import { Timestamp } from '@angular/fire/firestore';
import { CREATE_MESSAGES } from '../../../constants/constants';
import { EMPLOYMENT_CATEGORIES, EmploymentCategory, LEAVE_TYPES, LeaveType, RELATIONSHIPS, Relationship, WORK_STATUSES, WORK_STYLES, WorkStatus, WorkStyle } from '../../../constants/model-constants';
import { Dependent } from '../../../model/dependent';
import { Employee, EmployeeInsurance, EmploymentContract, InsuranceDetail } from '../../../model/employee';
import { CommonService, MessageTimer } from '../../../service/common/common-service';
import { ValidationService } from '../../../service/common/validation-service';
import { CompanyService } from '../../../service/Firestore/company-service';
import { DependentService } from '../../../service/Firestore/dependent-service';
import { EmployeeService } from '../../../service/Firestore/employee-service';
import { EventService } from '../../../service/Firestore/event-service';
import { OfficeService } from '../../../service/Firestore/office-service';
import { EmployeeLogicService } from '../../../service/logic/employee-logic-service';

type InsuranceName = 'healthInsurance' | 'nursingCareInsurance' | 'employeePensionInsurance';
type InsuranceStatus = 'joined' | 'notJoined';
type InsuranceJudgement = { isHealthInsuranceRequired?: boolean, isNursingCareInsuranceRequired?: boolean, isPensionInsuranceRequired?: boolean };

@Component({
  selector: 'app-hire-entry',
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './hire-entry.html',
  styleUrl: './hire-entry.css',
})
export class HireEntry {

  private fb = inject(FormBuilder);
  private destroyRef = inject(DestroyRef);
  private commonService = inject(CommonService);
  private employeeService = inject(EmployeeService);
  private eventService = inject(EventService);
  private dependentService = inject(DependentService);
  private officeService = inject(OfficeService);
  private companyService = inject(CompanyService);
  private employeeLogicService = inject(EmployeeLogicService);
  private validationService = inject(ValidationService);

  WORK_STATUSES = WORK_STATUSES;
  LEAVE_TYPES = LEAVE_TYPES;
  EMPLOYMENT_CATEGORIES = EMPLOYMENT_CATEGORIES;
  WORK_STYLES = WORK_STYLES;
  RELATIONSHIPS = RELATIONSHIPS;
  officeNameMap = computed(() => this.officeService.allOfficeNameMap());

  message = '';
  isSpecificApplicableOffice = false;

  // 表示用の加入判定
  autoInsuranceJudgement: InsuranceJudgement | null = null;
  autoGradeJudgement: number| null = null;
  
  private messageTimer: MessageTimer = null;

  loginEmployeeId = sessionStorage.getItem('loginEmployeeId') ?? '';
  workingYear = sessionStorage.getItem('workingYear') ?? '';
  workingMonth = sessionStorage.getItem('workingMonth') ?? '';

  form = this.fb.nonNullable.group({
    employeeId: ['', [Validators.required, Validators.pattern('^[a-zA-Z0-9]+$')], [this.validationService.validateEmployeeId]],
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
      contractedWorkingHoursPerWeek: ['40', [Validators.required, Validators.min(0)]],
      contractedWorkingDaysPerMonth: ['20', [Validators.required, Validators.min(0)]],
      fixedSalary: ['', [Validators.required, Validators.min(0)]],
      transportationExpenses: ['', [Validators.min(0)]],
    }),
    insurance: this.fb.nonNullable.group({
      currentGrade: [0, [Validators.required, Validators.min(0), Validators.max(50)]],
      healthInsurance: this.fb.nonNullable.group({
        joined: ['notJoined' as InsuranceStatus, [Validators.required]],
        acquiredDate: [''],
        companyBurdenRate: [50],
      }),
      nursingCareInsurance: this.fb.nonNullable.group({
        joined: ['notJoined' as InsuranceStatus, [Validators.required]],
        acquiredDate: [''],
        companyBurdenRate: [50],
      }),
      employeePensionInsurance: this.fb.nonNullable.group({
        joined: ['notJoined' as InsuranceStatus, [Validators.required]],
        acquiredDate: [''],
        companyBurdenRate: [50],
      }),
    }),
    dependents: this.fb.array<FormGroup>([]),
  });

  async ngOnInit() {
    // プルダウン表示と社員ID重複チェックに使うマスタを読み込む
    await this.officeService.getAllOffice();
    await this.employeeService.getAllEmployees(true);

    if (this.dependents.length === 0) {
      this.addDependent();
    }

    // 加入判定では会社が特定適用事業所かどうかを使う
    this.isSpecificApplicableOffice = await this.companyService.isSpecificApplicableOffice();

    // 入力内容に応じて、必須/任意/disabled を切り替える
    this.setupTransportationExpensesValidation();
    this.setupLeaveTypesValidation();
    this.setupInsuranceDetailControls('healthInsurance');
    this.setupInsuranceDetailControls('nursingCareInsurance');
    this.setupInsuranceDetailControls('employeePensionInsurance');

    // フォーム変更時に「表示用」の自動判定だけ更新する。入力値には反映しない。
    this.form.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.updateAutoInsuranceJudgement();
        void this.updateAutoGradeJudgement();
      });
    this.updateAutoInsuranceJudgement();
    await this.updateAutoGradeJudgement();
  }

  // 入社処理
  async registerHireEntry() {
    this.clearMessage();
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    // 従業員情報を作成
    const employee = this.createEmployee();
    const employeeRegistered = await this.employeeService.registerEmployee(employee);
    if (!employeeRegistered) {
      this.showMessage(CREATE_MESSAGES.FAILED);
      return;
    }

    // 扶養情報を作成
    const dependents = this.createDependents(employee.employeeId!);
    if (dependents.length > 0) {
      const dependentsRegistered = await this.dependentService.registerDependents(employee.employeeId!, dependents);
      if (!dependentsRegistered) {
        this.showMessage('従業員は登録されましたが、扶養情報の作成に失敗しました');
        return;
      }
    }

    // イベントを作成
    const eventCreated = await this.eventService.createEvent(employee.employeeId!, this.createHireEventPayload(employee, dependents));
    if (!eventCreated) {
      this.showMessage('従業員は登録されましたが、入社イベントの作成に失敗しました');
      return;
    }

    this.showMessage(`社員ID：${employee.employeeId} ${employee.firstName} ${employee.lastName}さんの入社処理を${CREATE_MESSAGES.SUCCESS}`);
    this.form.reset();
    this.resetDependents();
    await this.employeeService.getAllEmployees(true);
  }

  // リセット
  resetForm() {
    this.form.reset();
    this.clearMessage();
    this.updateTransportationExpensesValidation();
    this.updateLeaveTypesValidation();
    this.updateInsuranceDetailControls('notJoined', 'healthInsurance');
    this.updateInsuranceDetailControls('notJoined', 'nursingCareInsurance');
    this.updateInsuranceDetailControls('notJoined', 'employeePensionInsurance');
    this.resetDependents();
  }

  // 休職種別の表示/非表示
  showLeaveTypesField() {
    return this.form.controls.workStatus.value === '休職中';
  }

  // 通勤手当の表示/非表示
  showTransportationExpensesField() {
    const employmentContract = this.form.controls.employmentContract;
    return this.isTransportationExpensesRequired(
      employmentContract.controls.employmentCategory.value as EmploymentCategory,
      employmentContract.controls.workStyle.value as WorkStyle,
    );
  }

  // 扶養情報のFormArray
  get dependents(): FormArray {
    return this.form.controls.dependents;
  }

  // 扶養情報の追加
  addDependent() {
    this.dependents.push(this.createDependentForm());
  }

  // 扶養情報の削除
  removeDependent(index: number) {
    this.dependents.removeAt(index);
    if (this.dependents.length === 0) {
      this.addDependent();
    }
  }

  getDependentControl(index: number, fieldName: string): AbstractControl | null {
    return this.dependents.at(index).get(fieldName);
  }

  // 従業員データを作る
  private createEmployee(): Partial<Employee> {
    // 登録保存用の従業員データを作る
    return {
      employeeId: this.form.value.employeeId!,
      firstName: this.form.value.firstName!,
      lastName: this.form.value.lastName!,
      birthDate: timestampFromDateInput(this.form.value.birthDate!),
      hireDate: timestampFromDateInput(this.form.value.hireDate!),
      workStatus: this.form.value.workStatus! as WorkStatus,
      ...(this.form.value.workStatus === '休職中'
        ? { leaveTypes: this.form.value.leaveTypes! as LeaveType }
        : {}),
      employmentContract: this.createEmploymentContractFromForm(),
      insurance: this.createInsuranceInfo(),
    };
  }

  //イベントに渡すデータを作る
  private createHireEventPayload(employee: Partial<Employee>, dependents: Partial<Dependent>[]): Record<string, unknown> {
    // 入社イベントに、登録時点の変更内容をそのまま残す
    return {
      occurredDate: employee.hireDate!,
      eventType: '入社',
      appliedDate: Timestamp.now(),
      applicantType: '管理者',
      approval: {
        approvalStatus: '承認済み',
        approvedDate: Timestamp.now(),
        approvedBy: this.loginEmployeeId,
      },
      payload: {
        employee: employee,
        dependents: dependents,
      },
    };
  }

  // 従業員保険情報を作る
  private createInsuranceInfo(): EmployeeInsurance {
    // 従業員ドキュメントへ保存する保険情報を作る
    const insurance = this.form.controls.insurance;
    return {
      currentGrade: insurance.controls.currentGrade.value,
      healthInsurance: this.createInsuranceDetailFromForm('healthInsurance'),
      nursingCareInsurance: this.createInsuranceDetailFromForm('nursingCareInsurance'),
      employeePensionInsurance: this.createInsuranceDetailFromForm('employeePensionInsurance'),
    };
  }

  // 保険情報を作る
  private createInsuranceDetailFromForm(insuranceName: InsuranceName): InsuranceDetail {
    // 未加入の場合は付属情報を保存しない
    const value = this.form.controls.insurance.controls[insuranceName].getRawValue();
    if (value.joined === 'notJoined') {
      return { joined: false };
    }

    return {
      joined: true,
      acquiredDate: timestampFromDateInput(value.acquiredDate),
      companyBurdenRate: value.companyBurdenRate,
    };
  }

  // 扶養情報を作る
  private createDependents(employeeId: string): Partial<Dependent>[] {
    // 入力された扶養情報だけ、dependents サブコレクション用に変換する
    const dependents: Partial<Dependent>[] = [];
    this.dependents.controls.forEach((control, index) => {
      const value = control.value;
      if (!value.name && !value.birthDate && !value.relationship) return;

      dependents.push({
        dependentId: `${index + 1}`,
        name: value.name!,
        birthDate: timestampFromDateInput(value.birthDate!),
        relationship: value.relationship! as Relationship,
        isDependent: true,
      });
    });
    return dependents;
  }

  // 扶養情報のFormGroupを作る
  private createDependentForm() {
    const group = this.fb.nonNullable.group({
      name: ['', [this.validationService.requiredIfAnyDependentFieldEntered]],
      birthDate: ['', [this.validationService.requiredIfAnyDependentFieldEntered]],
      relationship: ['' as Relationship | '', [this.validationService.requiredIfAnyDependentFieldEntered]],
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

  // 通勤手当の入力可否を切り替える
  private setupTransportationExpensesValidation() {
    // 契約社員の時短・パートだけ、通勤手当を入力対象にする
    const employmentContract = this.form.controls.employmentContract;
    this.updateTransportationExpensesValidation();
    employmentContract.controls.employmentCategory.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.updateTransportationExpensesValidation());
    employmentContract.controls.workStyle.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.updateTransportationExpensesValidation());
  }

  // 休職種別の入力可否を切り替える
  private setupLeaveTypesValidation() {
    // 勤務状況が休職中のときだけ、休職種別を必須にする
    this.updateLeaveTypesValidation();
    this.form.controls.workStatus.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.updateLeaveTypesValidation());
    this.form.controls.hireDate.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.setAcquiredDateFromHireDate());
  }

  // 休職種別の必須チェックを切り替える
  private updateLeaveTypesValidation() {
    // 勤務状況に応じて休職種別の必須チェックを切り替える
    const leaveTypesControl = this.form.controls.leaveTypes;
    const isLeaveTypesRequired = this.form.controls.workStatus.value === '休職中';
    leaveTypesControl.setValidators(isLeaveTypesRequired ? [Validators.required] : null);
    if (!isLeaveTypesRequired) {
      leaveTypesControl.setValue('', { emitEvent: false });
    }
    leaveTypesControl.updateValueAndValidity({ emitEvent: false });
  }

  // 通勤手当の入力可否を切り替える
  private updateTransportationExpensesValidation() {
    // 雇用区分・勤務形態に応じて通勤手当の入力可否を切り替える
    const employmentContract = this.form.controls.employmentContract;
    const transportationExpensesControl = employmentContract.controls.transportationExpenses;
    const isTransportationExpensesRequired = this.isTransportationExpensesRequired(
      employmentContract.controls.employmentCategory.value as EmploymentCategory,
      employmentContract.controls.workStyle.value as WorkStyle,
    );

    transportationExpensesControl.setValidators(
      isTransportationExpensesRequired ? [Validators.required, Validators.min(0)] : [Validators.min(0)]
    );
    if (!isTransportationExpensesRequired) {
      transportationExpensesControl.setValue('', { emitEvent: false });
    }
    transportationExpensesControl.updateValueAndValidity({ emitEvent: false });
  }

  // 保険情報の入力可否を切り替える
  private setupInsuranceDetailControls(insuranceName: InsuranceName) {
    // 加入/未加入の選択に応じて取得日・会社負担率を切り替える
    const insuranceGroup = this.form.controls.insurance.controls[insuranceName];
    this.updateInsuranceDetailControls(insuranceGroup.controls.joined.value, insuranceName);
    insuranceGroup.controls.joined.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(status => this.updateInsuranceDetailControls(status, insuranceName));
  }

  // 保険情報の入力可否を切り替える
  private updateInsuranceDetailControls(status: InsuranceStatus, insuranceName: InsuranceName) {
    // 加入の場合だけ取得日・会社負担率を必須入力にする
    const insuranceGroup = this.form.controls.insurance.controls[insuranceName];
    const needsInsuranceDetail = status === 'joined';
    const acquiredDateControl = insuranceGroup.controls.acquiredDate;
    const companyBurdenRateControl = insuranceGroup.controls.companyBurdenRate;

    acquiredDateControl.setValidators(needsInsuranceDetail ? [Validators.required] : null);
    companyBurdenRateControl.setValidators(
      needsInsuranceDetail ? [Validators.required, Validators.min(0), Validators.max(100)] : [Validators.min(0), Validators.max(100)]
    );

    for (const control of [acquiredDateControl, companyBurdenRateControl]) {
      if (needsInsuranceDetail) {
        control.enable({ emitEvent: false });
      } else {
        control.disable({ emitEvent: false });
      }
      control.updateValueAndValidity({ emitEvent: false });
    }
    if (needsInsuranceDetail && !acquiredDateControl.value && this.form.controls.hireDate.value) {
      acquiredDateControl.setValue(this.form.controls.hireDate.value, { emitEvent: false });
    }
    this.form.updateValueAndValidity({ emitEvent: false });
  }

  // 加入中の保険の取得日が空なら入社日を入れる
  private setAcquiredDateFromHireDate() {
    // 仮運用として、加入中の保険の取得日が空なら入社日を入れる
    const hireDate = this.form.controls.hireDate.value;
    if (!hireDate) return;

    (['healthInsurance', 'nursingCareInsurance', 'employeePensionInsurance'] as InsuranceName[]).forEach(insuranceName => {
      const insuranceGroup = this.form.controls.insurance.controls[insuranceName];
      if (insuranceGroup.controls.joined.value === 'joined' && !insuranceGroup.controls.acquiredDate.value) {
        insuranceGroup.controls.acquiredDate.setValue(hireDate, { emitEvent: false });
      }
    });
  }

  // 表示用の加入判定を更新する
  private updateAutoInsuranceJudgement() {
    // 表示用の加入判定。フォームの加入/未加入ラジオには反映しない。
    const employee = this.createEmployee();
    console.log(employee);
    // if (!employee.birthDate) {
    //   this.autoInsuranceJudgement = null;
    //   return;
    // }
    this.autoInsuranceJudgement = this.employeeLogicService.isInsuranceRequired(employee as Employee, this.isSpecificApplicableOffice);
    console.log(this.autoInsuranceJudgement);
  }

  // 表示用の等級判定を更新する
  private async updateAutoGradeJudgement() {
    // 表示用の等級判定。フォームの等級入力欄には反映しない。
    const employee = this.createEmployee();
    // if (!employee.employmentContract?.fixedSalary) {
    //   this.autoGradeJudgement = null;
    //   return;
    // }

    const grade = await this.employeeLogicService.getInsuranceGradeAtNewEntry(employee as Employee);
    this.autoGradeJudgement = grade ?? null;
  }

  // 雇用契約情報を作る
  private createEmploymentContractFromForm(): Partial<EmploymentContract> {
    // 保存・判定の両方で使う雇用契約情報。通勤手当の要否は既存の表示/validationルールに従う。
    const controls = this.form.controls.employmentContract.controls;
    const transportationExpenses = this.toNumberOrUndefined(controls.transportationExpenses.value);

    return {
      employmentCategory: controls.employmentCategory.value as EmploymentCategory,
      workStyle: controls.workStyle.value as WorkStyle,
      officeId: controls.officeId.value,
      contractedWorkingHoursPerWeek: this.toNumberOrUndefined(controls.contractedWorkingHoursPerWeek.value),
      contractedWorkingDaysPerMonth: this.toNumberOrUndefined(controls.contractedWorkingDaysPerMonth.value),
      fixedSalary: this.toNumberOrUndefined(controls.fixedSalary.value),
      ...(transportationExpenses !== undefined ? { transportationExpenses } : {}),
    };
  }

  // 生年月日をTimestampに変換する
  private createBirthDateTimestamp(): Timestamp | undefined {
    // 生年月日が未入力/不正な場合は、未加入ではなく判定不能にするため undefined を返す
    const value = this.form.controls.birthDate.value;
    if (!value || this.form.controls.birthDate.invalid) return undefined;

    const date = new Date(`${value}T00:00:00`);
    return Number.isNaN(date.getTime()) ? undefined : Timestamp.fromDate(date);
  }

  // 数値に変換する
  private toNumberOrUndefined(value: unknown): number | undefined {
    // 空文字や不正値は 0 に丸めず undefined として扱う
    if (value === '' || value === null || value === undefined) return undefined;
    const numberValue = Number(value);
    return Number.isFinite(numberValue) ? numberValue : undefined;
  }

  // 扶養情報をリセットする
  private resetDependents() {
    // リセット時も扶養入力行は1行だけ残す
    while (this.dependents.length > 0) {
      this.dependents.removeAt(0);
    }
    this.addDependent();
  }

  // 通勤手当の入力可否を判定する
  private isTransportationExpensesRequired(employmentCategory: EmploymentCategory, workStyle: WorkStyle) {
    return (employmentCategory === '契約社員' && workStyle === '時短') || employmentCategory === 'パート';
  }

  // メッセージを表示する
  private showMessage(message: string) {
    this.messageTimer = this.commonService.showTimedMessage(message, value => this.message = value, this.messageTimer);
  }

  // メッセージをクリアする
  private clearMessage() {
    this.messageTimer = this.commonService.clearTimedMessage(value => this.message = value, this.messageTimer);
  }

}
