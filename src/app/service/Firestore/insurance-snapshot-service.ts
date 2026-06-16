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
    const companyId = sessionStorage.getItem('companyId') ?? undefined;
    return await this.crudService.create(
      `${this.path}/${employeeId}/insuranceSnapshots/${snapshot.snapshotId}`,
      { ...snapshot, companyId },
    );
  }

  /** 当該会社に確定済み保険料スナップショットが1件でもあるか（companyId 付きデータのみ） */
  async hasAnyInsuranceSnapshotForCompany(): Promise<boolean> {
    const companyId = sessionStorage.getItem('companyId');
    if (!companyId) return false;

    const snapshots = await this.crudService.getByCollectionGroupFields<InsuranceSnapshot>(
      'insuranceSnapshots',
      [{ field: 'companyId', value: companyId }],
      'snapshotId',
    );
    return snapshots.length > 0;
  }

  /** 対象の給与・賞与IDで保険料が確定済みか確認 */
  async hasInsuranceSnapshot(payrollId: string): Promise<boolean> {
    const snapshots = await this.crudService.getByCollectionGroupFields<InsuranceSnapshot>(
      'insuranceSnapshots',
      [{ field: 'payrollId', value: payrollId }],
    );
    return snapshots.length > 0;
  }

  /** 社員の確定済み保険料スナップショット一覧 */
  async getSnapshotsForEmployee(employeeId: string): Promise<InsuranceSnapshot[]> {
    return await this.crudService.getAll<InsuranceSnapshot>(
      `${this.path}/${employeeId}/insuranceSnapshots`,
      'snapshotId',
    );
  }

  //保険料支払い情報を取得
  async getSnapshot(employeeId: string, payrollId: string): Promise<InsuranceSnapshot | null> {
    return await this.crudService.getById<InsuranceSnapshot>(
      `${this.path}/${employeeId}/insuranceSnapshots/${payrollId}`,
      'snapshotId',
    );
  }

}
