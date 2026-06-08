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

  mode = this.route.snapshot.queryParamMap.get('mode');

  messageTimer: MessageTimer = null;
  
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
      return;
    }

    const insuranceInfo:Partial<EmployeeInsurance> = {
      currentGrade: this.form.value.currentGrade!,
      healthInsurance: this.createInsuranceDetailFromForm('healthInsurance'),
      nursingCareInsurance: this.createInsuranceDetailFromForm('nursingCareInsurance'),
      employeePensionInsurance: this.createInsuranceDetailFromForm('employeePensionInsurance'),
    };

    const result = await this.employeeService.updateEmployeeInsurance(this.form.value.employeeId!, insuranceInfo);

    if (!result) {
      this.commonService.showTimedMessage(UPDATE_MESSAGES.FAILED, value => this.message = value, this.messageTimer);
      return;
    }
    this.commonService.showTimedMessage(`社員ID：${this.form.value.employeeId}　${this.commonService.getEmployeeName(this.form.value.employeeId!)}さんの保険情報を${UPDATE_MESSAGES.SUCCESS}`, value => this.message = value, this.messageTimer);
    await this.employeeService.getAllEmployees(true);
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

  toPermissionSetting() {
    this.router.navigate(['/permission-setting'], { queryParams: { mode: 'initial' } });
  }

  toStartStart() {
    this.router.navigate(['/top-for-manage']);
  }

}
