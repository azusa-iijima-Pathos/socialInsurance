/**
 * 会社情報初期登録画面(代表者が新規登録)
 */

import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { Validators } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { Company } from '../../../../model/company';
import { CompanyService } from '../../../../service/Firestore/company-service';
import { Router } from '@angular/router';
import { CREATE_MESSAGES, COMPANY_FORM_MESSAGES } from '../../../../constants/constants';
import { ValidationService } from '../../../../service/common/validation-service';
import { BUSINESS_TYPES, BusinessType } from '../../../../constants/model-constants';
import { CompanyLogicService } from '../../../../service/logic/company-logic-service';
import { startWith } from 'rxjs';
import { UserService } from '../../../../service/Firestore/user-service';
import { User } from '../../../../model/user';
import { Office } from '../../../../model/office';
import { OfficeService } from '../../../../service/Firestore/office-service';
import { PREFECTURES, Prefecture } from '../../../../constants/model-constants';

@Component({
  selector: 'app-company-form',
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './company-form.html',
  styleUrl: './company-form.css',
})
export class CompanyForm {

  BUSINESS_TYPES = BUSINESS_TYPES;
  specificApplicableOfficeSpecialcase = COMPANY_FORM_MESSAGES.SPECIFIC_APPLICABLE_OFFICE_SPECIALCASE;
  specificApplicableOfficeDescription = COMPANY_FORM_MESSAGES.SPECIFIC_APPLICABLE_OFFICE_DESCRIPTION;
  PREFECTURES = PREFECTURES;

  isOpenDescription = signal(false);

  private fb = inject(FormBuilder);
  private companyService = inject(CompanyService);
  private router = inject(Router);
  private validationService = inject(ValidationService);
  private companyLogicService = inject(CompanyLogicService);
  private userService = inject(UserService);
  private officeService = inject(OfficeService);

  form = this.fb.nonNullable.group({
    isCorporation: [true, [Validators.required]],
    name: ['', [Validators.required], [this.validationService.validateCompanyName]],
    businessType: ['', [Validators.required]],
    employeeCount: ['', [Validators.required, Validators.pattern('^[0-9]+$')]],
    headOfficePrefecture: ['', [Validators.required]],
    //社会保険加入義務(手動用)
    socialInsuranceRequired: [false, [Validators.required]],
    optionalApplicableOffice: [false, [Validators.required]],
    //特定適用事業所(手動用)
    specificApplicableOffice: [false, [Validators.required]],
    optionalSpecificApplicableOffice: [false, [Validators.required]],
  });

  message: string = '';

  socialInsuranceByManual: boolean = false;
  specificApplicableOfficeByManual: boolean = false;

  //自動判定用
  socialInsuranceRequiredByAuto = signal(false);
  specificApplicableOfficeByAuto = signal(false);

  ngOnInit() {
    this.form.valueChanges
      .pipe(startWith(this.form.getRawValue()))
      .subscribe(() => this.applyInsuranceJudgement());
  }

  //自動判定
  private applyInsuranceJudgement(): void {
    const company: Partial<Company> = this.toCompanyForJudgement();

    if (company.isCorporation === null || company.isCorporation === undefined || !company.employeeCount || !company.businessType || !company.name || !company.headOfficePrefecture) {
      //未入力がある場合はどちらもFalse
      this.socialInsuranceRequiredByAuto.set(false);
      this.specificApplicableOfficeByAuto.set(false);
    } else {
      //自動判定
      const socialInsuranceRequired = this.companyLogicService.isSocialInsuranceRequired(company);
      this.socialInsuranceRequiredByAuto.set(socialInsuranceRequired);
      this.specificApplicableOfficeByAuto.set(this.companyLogicService.isSpecificApplicableOffice({
        ...company,
        socialInsuranceRequired,
      }));
    }
  }

  /** 任意適用事業所の無効化判定 */
  isOptionalApplicableOfficeDisabled(): boolean {
    if (this.socialInsuranceByManual) {
      return this.form.get('socialInsuranceRequired')?.value ?? false;
    }
    return this.socialInsuranceRequiredByAuto();
  }

  /** 特定適用事業所の無効化判定 */
  isSpecificApplicableOfficeDisabled(): boolean {
    let socialInsuranceRequired = false;
    if (this.socialInsuranceByManual) {
      socialInsuranceRequired = this.form.get('socialInsuranceRequired')?.value ?? false;
    } else {
      socialInsuranceRequired = this.socialInsuranceRequiredByAuto();
    }
    return !socialInsuranceRequired && !this.form.get('optionalApplicableOffice')?.value;
  }

  /** 任意特定適用事業所の無効化判定 */
  isOptionalSpecificApplicableOfficeDisabled(): boolean {
    let specificApplicableOffice = false;
    if (this.specificApplicableOfficeByManual) {
      specificApplicableOffice = this.form.get('specificApplicableOffice')?.value ?? false;
    } else {
      specificApplicableOffice = this.specificApplicableOfficeByAuto();
    }
    return this.isSpecificApplicableOfficeDisabled() || specificApplicableOffice;
  }

  //会社情報を判定用に変換
  private toCompanyForJudgement(): Partial<Company> {
    const value = this.form.getRawValue();
    let socialInsuranceRequired = false;
    if (this.socialInsuranceByManual) {
      socialInsuranceRequired = value.socialInsuranceRequired;
    } else {
      socialInsuranceRequired = this.socialInsuranceRequiredByAuto();
    }
    return {
      name: value.name,
      isCorporation: value.isCorporation,
      businessType: value.businessType as BusinessType,
      employeeCount: Number(value.employeeCount || 0),
      headOfficePrefecture: value.headOfficePrefecture as Prefecture,
      socialInsuranceRequired,
      optionalApplicableOffice: value.optionalApplicableOffice,
    };
  }

  /** 会社情報を登録 */
  async register() {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const confirmResult = await window.confirm('会社情報を登録します。よろしいですか？');
    if (!confirmResult) {
      return;
    }

    //社会保険加入義務(自動か手動かで判定結果をセット)
    if (!this.socialInsuranceByManual) {
      this.form.patchValue({
        socialInsuranceRequired: this.socialInsuranceRequiredByAuto(),
      });
    }

    //特定適用事業所(自動か手動かで判定結果をセット)
    if (!this.specificApplicableOfficeByManual) {
      this.form.patchValue({
        specificApplicableOffice: this.specificApplicableOfficeByAuto(),
      });
    }

    //会社情報を登録用に変換
    const company: Partial<Company> = {
      ...this.form.value,
      businessType: this.form.value.businessType! as BusinessType,
      headOfficePrefecture: this.form.value.headOfficePrefecture! as Prefecture,
      employeeCount: Number(this.form.value.employeeCount!),
    };

    //会社情報を登録
    const result = await this.companyService.registerCompany(company);
    if (!result) {
      this.message = CREATE_MESSAGES.FAILED;
      return;
    }
    //会社IDをセッションストレージに保存
    const companyId = result.companyId!;
    sessionStorage.setItem('companyId', companyId);

    //登録した人のアカウントに会社情報とトップ権限を付与する（UIDをセッションストレージから取得）
    const uid = sessionStorage.getItem('loginUserUID');
    const updateUser: Partial<User> = {
      uid: uid!,
      permission: '管理',
      companyId: companyId,
    };
    const userUpdateResult = await this.userService.updateUser(updateUser);
    if (!userUpdateResult) {
      throw new Error('アカウント権限更新失敗');
    }
    
    sessionStorage.setItem('permission', '管理');

    //本社を1事業所として登録
    const office: Partial<Office> = {
      officeId: '1',
      companyId: company.companyId!,
      name: '本社',
      prefecture: company.headOfficePrefecture!,
    };
    const officeResult = await this.officeService.registerOffice(office);
    if (!officeResult) {
      console.log('事業所登録失敗');
    }

    this.router.navigate([`/initial-setting/${company.companyId}/company-confirm`]);
  }

}
