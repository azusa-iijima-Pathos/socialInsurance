import { inject, Injectable } from '@angular/core';
import { Firestore, doc, getDoc, setDoc } from '@angular/fire/firestore';
import { Dependent } from '../../model/dependent';
import { CrudService } from '../common/crud-service';
import { stripUndefinedValues } from '../common/firestore-data.util';

@Injectable({
  providedIn: 'root',
})
export class DependentService {

  private crudService = inject(CrudService);
  private firestore = inject(Firestore);

  private get path() {
    const companyId = sessionStorage.getItem('companyId');
    return `companies/${companyId}/employees`;
  }

  /** 扶養情報を保存 */
  async registerDependents(employeeId: string, dependents: Partial<Dependent>[]): Promise<boolean> {
    const results = await Promise.all(
      dependents.map(dependent =>
        this.crudService.create<Dependent>(
          `${this.path}/${employeeId}/dependents/${dependent.dependentId}`,
          dependent,
        )
      )
    );
    return results.every(result => result);
  }

  /** 扶養者ドキュメントの有無で新規作成か更新かを判定して保存 */
  async saveDependent(employeeId: string, dependent: Partial<Dependent>): Promise<boolean> {
    const dependentId = String(dependent.dependentId ?? '').trim();
    if (!dependentId) return false;

    try {
      const path = `${this.path}/${employeeId}/dependents/${dependentId}`;
      const ref = doc(this.firestore, path);
      const snap = await getDoc(ref);
      const data = stripUndefinedValues({
        ...dependent,
        dependentId,
        updatedAt: new Date(),
        ...(snap.exists() ? {} : { createdAt: new Date() }),
      });
      await setDoc(ref, data, { merge: true });
      return true;
    } catch (e) {
      console.error(e);
      return false;
    }
  }

  /** 扶養情報を取得 */
  async getDependents(employeeId: string): Promise<Dependent[]> {
    const path = `${this.path}/${employeeId}/dependents`;
    return await this.crudService.getAll<Dependent>(path, 'dependentId');
  }

  /** 扶養情報を更新 */
  async updateDependent(employeeId: string, dependent: Partial<Dependent>): Promise<boolean> {
    return await this.crudService.update<Dependent>(
      `${this.path}/${employeeId}/dependents/${dependent.dependentId}`,
      dependent,
    );
  }

  /** 扶養情報を一括更新 */
  async updateDependents(employeeId: string, dependents: Partial<Dependent>[]): Promise<boolean> {
    const results = await Promise.all(
      dependents.map(dependent => this.updateDependent(employeeId, dependent)),
    );
    return results.every(result => result);
  }

}
