import { inject, Injectable } from '@angular/core';
import { Dependent } from '../../model/dependent';
import { CrudService } from '../common/crud-service';

@Injectable({
  providedIn: 'root',
})
export class DependentService {

  private crudService = inject(CrudService);

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

  /** 扶養情報を取得 */
  async getDependents(employeeId: string): Promise<Dependent[]> {
    const path = `${this.path}/${employeeId}/dependents`;
    return await this.crudService.getAll<Dependent>(path, 'dependentId');
  }

}
