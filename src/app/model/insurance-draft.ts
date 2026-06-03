import { Timestamp } from '@angular/fire/firestore';

/**
 * 保険料の一時保存データ
 * PATH: companies/{companyId}/insuranceDrafts/{payrollId}/employees/{employeeId}
 */
export type InsuranceDraft = {
    employeeId: string;
    payrollId: string;
    grade: number;
    actualPaymentAmount?: number;
    healthInsurance: number;
    nursingCareInsurance: number;
    pensionInsurance: number;
    healthInsuranceForEmployee: number;
    nursingCareInsuranceForEmployee: number;
    pensionInsuranceForEmployee: number;
    healthInsuranceForCompany: number;
    nursingCareInsuranceForCompany: number;
    pensionInsuranceForCompany: number;
    createdAt?: Timestamp;
    updatedAt?: Timestamp;
};
