import { inject, Injectable, signal, computed } from '@angular/core';
import { CrudService } from '../common/crud-service';
import { Employee, EmployeeInsurance } from '../../model/employee';
import { deleteField } from '@angular/fire/firestore';
import { CompanyService } from './company-service';
import {
  buildBonusEligibilityPeriodBounds,
  buildPayrollPeriodBounds,
  parseMonthlyPayrollId,
  wasEmployedInPeriod,
} from '../logic/employee-enrollment.util';

/**
 * 社員情報サービス
 */

//PATH: companies/{companyId}/employees/{employeeId}

export type UpdateEmployeeInput = Omit<Partial<Employee>, 'resignationDate'> & {
  resignationDate?: Employee['resignationDate'] | null;
};

@Injectable({
  providedIn: 'root',
})
export class EmployeeService {

  private crudService = inject(CrudService);
  private companyService = inject(CompanyService);

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

  /** 現在の作業対象期間の境界 */
  currentWorkPeriodBounds = computed(() => {
    const company = this.companyService.company();
    if (!company) return null;
    const year = Number(sessionStorage.getItem('workingYear'));
    const month = Number(sessionStorage.getItem('workingMonth'));
    if (!year || !month) return null;
    const targetPeriod = company.settings?.targetPeriod ?? [1, 31];
    return buildPayrollPeriodBounds(year, month, targetPeriod as [number, number]);
  });

  /** 退社済みかつ現在の作業対象期間に1日でも在籍していた社員 */
  allRetiredEmployeesInCurrentWorkPeriod = computed(() => {
    const bounds = this.currentWorkPeriodBounds();
    if (!bounds) return [];
    return this.allEmployees().filter(employee =>
      employee.workStatus === '退社済み'
      && wasEmployedInPeriod(employee, bounds.periodStart, bounds.periodEnd),
    );
  });

  /** 月額給与・保険料算出（当月）の入力・表示対象社員 */
  employeesEligibleForCurrentWorkPeriod = computed(() => {
    const bounds = this.currentWorkPeriodBounds();
    if (!bounds) return this.allActiveEmployees();
    return this.allEmployees().filter(employee =>
      wasEmployedInPeriod(employee, bounds.periodStart, bounds.periodEnd),
    );
  });

  getCurrentPayrollId(): string {
    const year = Number(sessionStorage.getItem('workingYear'));
    const month = Number(sessionStorage.getItem('workingMonth'));
    return `${year}-${String(month).padStart(2, '0')}`;
  }

  getPayrollPeriodBounds(payrollId: string): { periodStart: Date; periodEnd: Date } | null {
    const parsed = parseMonthlyPayrollId(payrollId);
    const company = this.companyService.company();
    if (!parsed || !company) return null;
    const targetPeriod = company.settings?.targetPeriod ?? [1, 31];
    return buildPayrollPeriodBounds(parsed.year, parsed.month, targetPeriod as [number, number]);
  }

  employeesEligibleForPayrollPeriod(payrollId: string): Employee[] {
    const bounds = this.getPayrollPeriodBounds(payrollId);
    if (!bounds) return this.allActiveEmployees();
    return this.allEmployees().filter(employee =>
      wasEmployedInPeriod(employee, bounds.periodStart, bounds.periodEnd),
    );
  }

  /** 賞与支給月の入力・表示対象社員（支給月またはその3か月前まで在籍） */
  employeesEligibleForBonusPeriod(payrollId: string): Employee[] {
    const parsed = parseMonthlyPayrollId(payrollId);
    if (!parsed) return [];
    const bounds = buildBonusEligibilityPeriodBounds(parsed.year, parsed.month);
    return this.allEmployees().filter(employee =>
      wasEmployedInPeriod(employee, bounds.periodStart, bounds.periodEnd),
    );
  }

  getBonusEligibleEmployeeIdSet(payrollId: string): Set<string> {
    return new Set(this.employeesEligibleForBonusPeriod(payrollId).map(employee => employee.employeeId));
  }

  getPayrollEligibleEmployeeIdSet(payrollId: string): Set<string> {
    return new Set(this.employeesEligibleForPayrollPeriod(payrollId).map(employee => employee.employeeId));
  }

  wasEmployedInPayrollPeriod(employee: Employee, payrollId: string): boolean {
    const bounds = this.getPayrollPeriodBounds(payrollId);
    if (!bounds) return employee.workStatus !== '退社済み';
    return wasEmployedInPeriod(employee, bounds.periodStart, bounds.periodEnd);
  }

  /** 退社済み社員 */
  retiredEmployees = computed(() => this.allEmployees().filter(employee => employee.workStatus === '退社済み'));

  retiredEmployeeIdSet = computed(() => new Set(this.retiredEmployees().map(employee => employee.employeeId)));

  isRetired(employee?: Employee | null): boolean {
    return employee?.workStatus === '退社済み';
  }

  isPayrollInputEligible(employee: Employee | null | undefined, payrollId: string): boolean {
    if (!employee) return false;
    return this.wasEmployedInPayrollPeriod(employee, payrollId);
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
  async updateEmployee(employee: UpdateEmployeeInput): Promise<boolean> {
    const data: Record<string, unknown> = { ...employee };
    if (employee.leaveTypes === null) {
      data['leaveTypes'] = deleteField();
    }
    if (employee.resignationDate === null) {
      data['resignationDate'] = deleteField();
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
