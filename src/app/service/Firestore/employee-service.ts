import { inject, Injectable, signal, computed } from '@angular/core';
import { CrudService } from '../common/crud-service';
import { Employee, EmployeeInsurance } from '../../model/employee';
import { deleteField } from '@angular/fire/firestore';

/**
 * 社員情報サービス
 */

//PATH: companies/{companyId}/employees/{employeeId}

@Injectable({
  providedIn: 'root',
})
export class EmployeeService {

  private crudService = inject(CrudService);

  private get path() {
    const companyId = sessionStorage.getItem('companyId');
    return `companies/${companyId}/employees`;
  }


  /** 該当会社の全社員情報を取得 */
  allEmployees = signal<Employee[]>([]);
  isallEmployeesLoaded = false;
  private cachedCompanyId = '';

  resetCache(): void {
    this.allEmployees.set([]);
    this.isallEmployeesLoaded = false;
    this.cachedCompanyId = '';
  }

  async getAllEmployees(forceReload: boolean = false) {
    const companyId = sessionStorage.getItem('companyId') ?? '';
    if (this.cachedCompanyId !== companyId) {
      forceReload = true;
    }
    if (this.isallEmployeesLoaded && !forceReload) return;

    const allEmployees = companyId
      ? await this.crudService.getAll<Employee>(`${this.path}`, 'employeeId')
      : [];
    this.allEmployees.set(allEmployees);
    this.isallEmployeesLoaded = true;
    this.cachedCompanyId = companyId;
    return;
  }

  /** 社員名一覧のマップを作成 */
  allEmployeeNameMap = computed(() => Object.fromEntries(this.allEmployees().map(employee => [employee.employeeId, `${employee.firstName} ${employee.lastName}`])));

  /** 全社員IDを取得 */
  allEmployeeIDs = computed(() => this.allEmployees().map(employee => employee.employeeId));
  
  /** 未退社の全社員 */
  allActiveEmployees = computed(() => this.allEmployees().filter(employee => employee.workStatus !== '退社済み'));

  /** 退社済み社員 */
  retiredEmployees = computed(() => this.allEmployees().filter(employee => employee.workStatus === '退社済み'));

  retiredEmployeeIdSet = computed(() => new Set(this.retiredEmployees().map(employee => employee.employeeId)));

  isRetired(employee?: Employee | null): boolean {
    return employee?.workStatus === '退社済み';
  }

  /** 該当社員情報を社員IDをもとに取得 */
  async getEmployeeByEmployeeId(employeeId: string): Promise<Employee | null> {
    return await this.crudService.getById<Employee>(`${this.path}/${employeeId}`, 'employeeId');
  }

  /** 該当会社の社員情報を会社IDと社員IDをもとに取得 （ユーザ連携登録用）*/
  async getEmployeeByCompanyIdAndEmployeeId(companyId: string, employeeId: string): Promise<Employee | null> {
    return await this.crudService.getById<Employee>(`companies/${companyId}/employees/${employeeId}`, 'employeeId');
  }

  /** 新規社員を作成(管理者側のみ可能) */
  async registerEmployee(employee: Partial<Employee>): Promise<boolean> {
    const created = await this.crudService.create(`${this.path}/${employee.employeeId}`, employee);
    if (created) {
      await this.getAllEmployees(true);
    }
    return created;
  }

  /** 社員を削除 */
  async deleteEmployee(employee: Employee): Promise<boolean> {
    const deleted = await this.crudService.delete(`${this.path}/${employee.employeeId}`);
    if (deleted) {
      await this.getAllEmployees(true);
    }
    return deleted;
  }

  /** 社員を更新 */
  async updateEmployee(employee: Partial<Employee>): Promise<boolean> {
    const data: Record<string, unknown> = { ...employee };
    if (employee.leaveTypes === null) {
      data['leaveTypes'] = deleteField();
    }
    const result = await this.crudService.update(`${this.path}/${employee.employeeId}`, data);
    if (result) {
      await this.getAllEmployees(true);
    }
    return result;
  }

  /** 社員の保険情報を更新 */
  async updateEmployeeInsurance(employeeId: string, insurance: Partial<EmployeeInsurance>): Promise<boolean> {
    const updated = await this.crudService.update(`${this.path}/${employeeId}`, { insurance });
    if (updated) {
      await this.getAllEmployees(true);
    }
    return updated;
  }
}
