import { Injectable } from '@angular/core';
import { Company } from '../../model/company';
import { SOCIAL_INSURANCE_REQUIRED } from '../../insuranceData/forCompany';

@Injectable({
  providedIn: 'root',
})
export class CompanyLogicService {

  /** 社会保険加入義務の判定 */
  isSocialInsuranceRequired(company: Partial<Company>): boolean {
    //法人の場合
    if (company.isCorporation) {
      if (company.employeeCount! >= SOCIAL_INSURANCE_REQUIRED.CORPORATION_REQUIRED_EMPLOYEE_COUNT) {
        return true;
      }
      return false;

    //個人事業の場合
    } else {
      //5人以上の場合
      if (company.employeeCount! >= SOCIAL_INSURANCE_REQUIRED.PERSONAL_BUSINESS_REQUIRED_EMPLOYEE_COUNT) {
        //対象外の業種の場合
        if (SOCIAL_INSURANCE_REQUIRED.EXCLUDED_BUSINESS_TYPES_FOR_PERSONAL_BUSINESS.includes(company.businessType!)) {
          return false;
        }
        //対象外の業種でない場合
        return true;
      //5人未満の場合
      } else {
        return false;
      }
    }
  }

  /** 特定適用事業所の自動判定（従業員51人以上など） */
  isSpecificApplicableOffice(company: Partial<Company>): boolean {
    //社会保険加入していないかつ任意適用事業所に該当しない場合
    if(!company.socialInsuranceRequired && !company.optionalApplicableOffice) {
      return false;
    }
    //社会保険加入している場合
    //51人以上の場合
    if (company.employeeCount && company.employeeCount >= SOCIAL_INSURANCE_REQUIRED.SPECIFIC_APPLICABLE_OFFICE_REQUIRED_EMPLOYEE_COUNT) {
      return true;
    }
    return false;
  }

  /** 保険加入判定用（特定適用・任意特定適用のいずれかが有効なら true） */
  isSpecificApplicableOfficeForInsurance(company: Partial<Company>): boolean {
    return !!(company.specificApplicableOffice || company.optionalSpecificApplicableOffice);
  }

}
