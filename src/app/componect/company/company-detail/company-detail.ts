import { Component, inject } from '@angular/core';
import { CompanyService } from '../../../service/Firestore/company-service';
import { Company } from '../../../model/company';
import { CommonService, MessageTimer } from '../../../service/common/common-service';
import { CompanyLogicService } from '../../../service/logic/company-logic-service';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { BUSINESS_TYPES, PREFECTURES, BusinessType, Prefecture } from '../../../constants/model-constants';
import { UPDATE_MESSAGES } from '../../../constants/constants';
import { OfficeService } from '../../../service/Firestore/office-service';
import { Office } from '../../../model/office';

@Component({
  selector: 'app-company-detail',
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './company-detail.html',
  styleUrl: './company-detail.css',
})
export class CompanyDetail {

  private companyService = inject(CompanyService);
  commonService = inject(CommonService);
  private companyLogicService = inject(CompanyLogicService);
  private officeService = inject(OfficeService);

  message: string = '';
  messageTimer: MessageTimer = null;

  company: Company | null = null;
  isSocialInsuranceRequired: boolean = false;
  isSpecificApplicableOffice: boolean = false;

  permission = sessionStorage.getItem('permission') ?? '';

  async ngOnInit() {
    await this.companyService.getCompany();
    this.company = this.companyService.company();

    if (this.company) {
      console.log(this.company);
      this.isSocialInsuranceRequired = this.companyLogicService.isSocialInsuranceRequired(this.company);
      this.isSpecificApplicableOffice = this.companyLogicService.isSpecificApplicableOffice(this.company);
    }

  }

  private fb = inject(FormBuilder);
  form = this.fb.group({
    name: ['', [Validators.required]],
    isCorporation: [false, [Validators.required]],
    businessType: ['', [Validators.required]],
    employeeCount: [1, [Validators.required, Validators.min(1)]],
    headOfficePrefecture: ['', [Validators.required]],
    socialInsuranceRequired: [false],
    optionalApplicableOffice: [false],
    specificApplicableOffice: [false],
    optionalSpecificApplicableOffice: [false],
  });

  BUSINESS_TYPES = BUSINESS_TYPES;
  PREFECTURES = PREFECTURES;

  isOpenModal: boolean = false;
  editCompany() {
    if (this.company) {
      this.form.patchValue({
        name: this.company?.name,
        isCorporation: this.company?.isCorporation,
        businessType: this.company?.businessType,
        employeeCount: this.company?.employeeCount,
        headOfficePrefecture: this.company?.headOfficePrefecture,
        socialInsuranceRequired: this.company?.socialInsuranceRequired,
        optionalApplicableOffice: this.company?.optionalApplicableOffice,
        specificApplicableOffice: this.company?.specificApplicableOffice,
        optionalSpecificApplicableOffice: this.company?.optionalSpecificApplicableOffice,
      });
    }
    this.isOpenModal = true;
  }

  async submitForm() {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const confirm = window.confirm('保険情報を変更した場合、保険加入判定や保険料自動計算結果が変更される可能性があります。\n確認の上、「OK」ボタンをクリックしてください。');
    if (!confirm) {
      this.closeModal();
      return;
    }

    const company: Partial<Company> = {
      companyId: this.company?.companyId!,
      name: this.form.value.name!,
      isCorporation: this.form.value.isCorporation!,
      businessType: this.form.value.businessType! as BusinessType,
      headOfficePrefecture: this.form.value.headOfficePrefecture! as Prefecture,
      employeeCount: Number(this.form.value.employeeCount!),
      socialInsuranceRequired: this.form.value.socialInsuranceRequired!,
      optionalApplicableOffice: this.form.value.optionalApplicableOffice!,
      specificApplicableOffice: this.form.value.specificApplicableOffice!,
      optionalSpecificApplicableOffice: this.form.value.optionalSpecificApplicableOffice!,
    };

    //会社情報を更新
    const result = await this.companyService.updateCompany(company);
    if (!result) {
      this.commonService.showTimedMessage(UPDATE_MESSAGES.FAILED, value => this.message = value, this.messageTimer);
      this.closeModal();
      return;
    }

    //本社が変わっている場合は、本社の事業所を更新
    if (this.company?.headOfficePrefecture !== company.headOfficePrefecture) {
      const office: Office | null = await this.officeService.getOneOffice('1');
      if (office) {
        const updateOffice: Partial<Office> = {
          ...office,
          prefecture: company.headOfficePrefecture!,
        };
        const result = await this.officeService.updateOffice(updateOffice);
        if (!result) {
          const message = "会社情報を変更しました。本社の所在地が変更されているため、事業所情報ページより本社の所在地を更新してください。"
          this.commonService.showTimedMessage(message, value => this.message = value, this.messageTimer);
        }
        this.commonService.showTimedMessage(UPDATE_MESSAGES.SUCCESS, value => this.message = value, this.messageTimer);
      } else {
        const message = "会社情報を変更しました。本社の所在地が変更されているため、事業所情報ページより本社の所在地を更新してください。"
        this.commonService.showTimedMessage(message, value => this.message = value, this.messageTimer);
      }
    //本社の住所は変わっていない場合
    } else {
      this.commonService.showTimedMessage(UPDATE_MESSAGES.SUCCESS, value => this.message = value, this.messageTimer);
    }

    await this.companyService.getCompany(true);
    this.company = this.companyService.company();

    if (this.company) {
      this.isSocialInsuranceRequired = this.companyLogicService.isSocialInsuranceRequired(this.company);
      this.isSpecificApplicableOffice = this.companyLogicService.isSpecificApplicableOffice(this.company);
    }

    this.closeModal();
    return;
  }

  closeModal() {
    this.isOpenModal = false;
    this.form.reset();
  }

}
