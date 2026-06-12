import { inject, Injectable, signal } from '@angular/core';
import { CrudService } from '../common/crud-service';
import { Company, CompanySettings } from '../../model/company';
import { CompanyLogicService } from '../logic/company-logic-service';

/**
 * 会社情報サービス
 */
//PATH: companies/{companyId}

@Injectable({
  providedIn: 'root',
})
export class CompanyService {

  private crudService = inject(CrudService);
  private companyLogicService = inject(CompanyLogicService);

  private get companyId() {
    const companyId = sessionStorage.getItem('companyId');
    return companyId;
  }

  /**　ログイン中の会社情報を取得 */
  company = signal<Company | null>(null);
  isCompanyLoaded = false;
  private cachedCompanyId = '';

  resetCache(): void {
    this.company.set(null);
    this.isCompanyLoaded = false;
    this.cachedCompanyId = '';
  }

  async getCompany(forceReload: boolean = false) {
    const companyId = this.companyId ?? '';
    if (this.cachedCompanyId !== companyId) {
      forceReload = true;
    }
    if (this.isCompanyLoaded && !forceReload) return;
    const company = companyId
      ? await this.crudService.getById<Company>(`companies/${companyId}`, 'companyId')
      : null;
    this.company.set(company);
    this.isCompanyLoaded = true;
    this.cachedCompanyId = companyId;
  }

  /** 全会社IDの取得 */
  async getAllCompanyID(): Promise<string[]> {
    const allCompanyIds = await this.crudService.getAll<Company>('companies', 'companyId').then(companies => companies.map(company => company.companyId));
    return allCompanyIds;
  }

  /** 全会社名の取得 */
  async getAllCompanyName(): Promise<string[]> {
    const allCompanyNames = await this.crudService.getAll<Company>('companies', 'companyId').then(companies => companies.map(company => company.name));
    return allCompanyNames;
  }

  /** 会社IDから1つの会社情報を取得 */
  async getOneCompany(companyId: string): Promise<Company | null> {
    const company = await this.crudService.getById<Company>(`companies/${companyId}`, 'companyId');
    return company;
  }

  /** 新規会社IDを作成 */
  async createCompanyID(): Promise<string> {
    const all = await this.crudService.getAll<Company>('companies', 'companyId');
    const newId = all.length + 1;
    return newId.toString();
  }

  /** 新規会社を作成 */
  async registerCompany(company: Partial<Company>): Promise<Company | null> {
    const newId = await this.createCompanyID();
    company.companyId = newId;
    const result = await this.crudService.create(`companies/${newId}`, company);
    if (!result) {
      return null;
    }
    return company as Company;
  }

  /** 会社設定を更新 */
  async updateCompanySettings(companyId: string, settings: Partial<CompanySettings>): Promise<boolean> {
    const updateData: Record<string, unknown> = {};
    Object.entries(settings).forEach(([key, value]) => {
      if (value !== undefined) {
        updateData[`settings.${key}`] = value;
      }
    });

    const result = await this.crudService.update(`companies/${companyId}`, updateData);
    const company = this.company();
    if (result && company) {
      this.company.set({
        ...company,
        settings: {
          ...company.settings,
          ...settings,
        } as CompanySettings,
      });
    }
    return result;
  }


  /** 会社が特定適用または任意特定適用か（保険加入判定用） */
  async isSpecificApplicableOffice(): Promise<boolean> {
    await this.getCompany();
    const company = this.company();
    if (!company) {
      throw new Error('会社情報が見つかりませんでした');
    }
    return this.companyLogicService.isSpecificApplicableOfficeForInsurance(company);
  }




  /** 会社情報を更新 */
  async updateCompany(company: Partial<Company>): Promise<boolean> {
    const result = await this.crudService.update(`companies/${this.companyId}`, company);
    return result;
  }





  
}
