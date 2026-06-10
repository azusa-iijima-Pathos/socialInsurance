import { inject, Injectable } from '@angular/core';
import { CrudService } from '../common/crud-service';
import { InsuranceDraft } from '../../model/insurance-draft';

/**
 * 保険料の一時保存サービス
 */
@Injectable({
  providedIn: 'root',
})
export class InsuranceDraftService {

  private crudService = inject(CrudService);

  private get path() {
    const companyId = sessionStorage.getItem('companyId');
    return `companies/${companyId}/insuranceDrafts`;
  }

  async getDrafts(payrollId: string): Promise<InsuranceDraft[]> {
    return await this.crudService.getAll<InsuranceDraft>(`${this.path}/${payrollId}/employees`, 'employeeId');
  }

  async getDraft(payrollId: string, employeeId: string): Promise<InsuranceDraft | null> {
    return await this.crudService.getById<InsuranceDraft>(
      `${this.path}/${payrollId}/employees/${employeeId}`,
      'employeeId',
    );
  }

  async saveDraft(payrollId: string, employeeId: string, draft: Partial<InsuranceDraft>): Promise<boolean> {
    return await this.crudService.create(
      `${this.path}/${payrollId}/employees/${employeeId}`,
      {
        ...draft,
        payrollId,
        employeeId,
      }
    );
  }
}
