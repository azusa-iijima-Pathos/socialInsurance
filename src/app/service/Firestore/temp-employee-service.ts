import { inject, Injectable, signal } from '@angular/core';
import { CrudService } from '../common/crud-service';
import { TempEmployee } from '../../model/temp-employee';

/** PATH: companies/{companyId}/tempEmployees/{employeeId} */
@Injectable({
  providedIn: 'root',
})
export class TempEmployeeService {

  private crudService = inject(CrudService);

  allTempEmployees = signal<TempEmployee[]>([]);
  private isLoaded = false;
  private cachedCompanyId = '';

  private get path() {
    const companyId = sessionStorage.getItem('companyId');
    return `companies/${companyId}/tempEmployees`;
  }

  async getAllTempEmployees(forceReload = false): Promise<TempEmployee[]> {
    const companyId = sessionStorage.getItem('companyId') ?? '';
    if (this.cachedCompanyId !== companyId) {
      forceReload = true;
    }
    if (this.isLoaded && !forceReload) {
      return this.allTempEmployees();
    }

    const items = companyId
      ? await this.crudService.getAll<TempEmployee>(this.path, 'employeeId')
      : [];
    this.allTempEmployees.set(items);
    this.isLoaded = true;
    this.cachedCompanyId = companyId;
    return items;
  }

  allTempEmployeeIds(): string[] {
    return this.allTempEmployees().map(item => item.employeeId);
  }

  async getTempEmployee(employeeId: string): Promise<TempEmployee | null> {
    return await this.crudService.getById<TempEmployee>(`${this.path}/${employeeId}`, 'employeeId');
  }

  async registerTempEmployee(tempEmployee: Partial<TempEmployee>): Promise<boolean> {
    const created = await this.crudService.create(`${this.path}/${tempEmployee.employeeId}`, tempEmployee);
    if (created) {
      await this.getAllTempEmployees(true);
    }
    return created;
  }

  async updateTempEmployee(tempEmployee: Partial<TempEmployee>): Promise<boolean> {
    const updated = await this.crudService.update(`${this.path}/${tempEmployee.employeeId}`, tempEmployee);
    if (updated) {
      await this.getAllTempEmployees(true);
    }
    return updated;
  }

  async deleteTempEmployee(employeeId: string): Promise<boolean> {
    const deleted = await this.crudService.delete(`${this.path}/${employeeId}`);
    if (deleted) {
      await this.getAllTempEmployees(true);
    }
    return deleted;
  }
}
