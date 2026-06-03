import { inject, Injectable } from '@angular/core';
import { CrudService } from '../common/crud-service';
import { InsuranceSnapshot } from '../../model/insurance-snapshot';

/**
 * 保険料支払い情報サービス
 */
//PATH: companies/{companyId}/employees/{employeeId}/insuranceSnapshots/{snapshotId}

@Injectable({
  providedIn: 'root',
})
export class InsuranceSnapshotService {

  private crudService = inject(CrudService);

  private get path() {
    const companyId = sessionStorage.getItem('companyId');
    return `companies/${companyId}/employees`;
  }

  /** 保険料支払い情報を保存 */
  async saveInsuranceSnapshot(employeeId: string, snapshot: Partial<InsuranceSnapshot>): Promise<boolean> {
    return await this.crudService.create(
      `${this.path}/${employeeId}/insuranceSnapshots/${snapshot.snapshotId}`,
      snapshot
    );
  }

  /** 対象の給与・賞与IDで保険料が確定済みか確認 */
  async hasInsuranceSnapshot(payrollId: string): Promise<boolean> {
    const snapshots = await this.crudService.getByCollectionGroupFields<InsuranceSnapshot>(
      'insuranceSnapshots',
      [{ field: 'payrollId', value: payrollId }],
    );
    return snapshots.length > 0;
  }

}
