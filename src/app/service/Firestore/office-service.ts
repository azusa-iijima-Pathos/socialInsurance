import { Injectable, inject, signal, computed } from '@angular/core';
import { CrudService } from '../common/crud-service';
import { Office } from '../../model/office';
import { EmployeeService } from './employee-service';
import { DELETE_MESSAGES } from '../../constants/constants';

/**
 * 事業所情報サービス
 */
//PATH: companies/{companyId}/offices/{officeId}

@Injectable({
  providedIn: 'root',
})
export class OfficeService {

  private crudService = inject(CrudService);
  private employeeService = inject(EmployeeService);

  private get path() {
    const companyId = sessionStorage.getItem('companyId');
    return `companies/${companyId}/offices`;
  }

  /** 全事業所を取得 */
  allOfficeWithDeleted = signal<Office[]>([]);
  allOffices = signal<Office[]>([]);
  isallOfficesLoaded = false;
  async getAllOffice(forceReload: boolean = false) {
    if (this.isallOfficesLoaded && !forceReload) return;
    const allOfficesWithDeleted = await this.crudService.getAll<Office>(`${this.path}`, 'officeId');
    this.allOfficeWithDeleted.set(allOfficesWithDeleted);
    this.allOffices.set(allOfficesWithDeleted.filter(office => !office.isDeleted));
    this.isallOfficesLoaded = true;
    return;
  }
  /** 事業所名一覧のマップを作成（削除済みは含まない） */
  allOfficeNameMap = computed(() => Object.fromEntries(this.allOffices().map(office => [office.officeId, office.name!])));
  /** 全事業所IDを取得（削除済みも含む） */
  allOfficeIDs = computed(() => this.allOfficeWithDeleted().map(office => office.officeId));

  /** 新規事業所IDを作成 */
  createOfficeID(): string {
    const all = this.allOfficeIDs();
    const newId = all.length + 1;
    return newId.toString();
  }

  /** 新規事業所を作成 */
  async registerOffice(office: Partial<Office>): Promise<Office | null> {
    let officeId = office.officeId;
    if (!officeId) {
      //新規事業所IDを作成
      officeId = this.createOfficeID();
      office.officeId = officeId;
    }
    const result = await this.crudService.create(`${this.path}/${officeId}`, office);
    if (!result) {
      return null;
    }
    return office as Office;
  }

  /** 事業所を削除 */
  async deleteOffice(office: Office): Promise<{ success: boolean, message: string }> {
    //事業所に紐づく社員がいる場合は削除できない
    await this.employeeService.getAllEmployees();
    let isEmployeeExists = false;
    this.employeeService.allEmployees().forEach(employee => {
      if (employee.employmentContract?.officeId === office.officeId) {
        isEmployeeExists = true;
        return;
      }
    });
    if (isEmployeeExists) {
      return { success: false, message: '事業所に紐づく社員がいるため削除できません' };
    }
    //事業所を（削除済み）にする
    office.name = `（削除済み）${office.name}`;
    office.isDeleted = true;
    const result = await this.crudService.update(`${this.path}/${office.officeId}`, office);
    if (!result) {
      return { success: false, message: DELETE_MESSAGES.FAILED };
    }
    return { success: true, message: DELETE_MESSAGES.SUCCESS };
  }

  /** 事業所を更新 */
  async updateOffice(office: Partial<Office>): Promise<boolean> {
    const result = await this.crudService.update(`${this.path}/${office.officeId}`, office);
    return result;
  }


  /** 事業所の所在地を取得 */
  async getOfficeLocation(officeId: string): Promise<string | null> {
    await this.getAllOffice();
    const office = this.allOffices().find(office => office.officeId === officeId);
    if (!office) {
      return null;
    }
    return office.prefecture ?? null;
  }

  /** 事業所を1つ取得 */
  async getOneOffice(officeId: string): Promise<Office | null> {
    const office = await this.crudService.getById<Office>(`${this.path}/${officeId}`, 'officeId');
    return office;
  }


}
