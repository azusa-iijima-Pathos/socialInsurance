import { Injectable, inject } from '@angular/core';
import { CrudService } from '../common/crud-service';
import { StandardMonthlyRemuneration, InsuranceRate } from '../../model/insuranceRate';

/**
 * 標準報酬月額マスタ
 * PATH: standardMonthlyRemunerations/{year} と standardMonthlyRemunerations/{year}/grades/{docId}
 *
 * 保険料率
 * PATH: insuranceRates/{year} と insuranceRates/{year}/prefectures/{docId}
 */

@Injectable({
  providedIn: 'root',
})
export class InsuranceRates {

  private crudService = inject(CrudService);

  get year() {
    return sessionStorage.getItem('workingYear');
  }

  private remunerationPath(year: string) {
    return `standardMonthlyRemunerations/${year}/grades`;
  }

  private ratePath(year: string) {
    return `insuranceRates/${year}/prefectures`;
  }

  /** 今年の標準報酬月額マスタ */
  remunerationData: Record<string, StandardMonthlyRemuneration[]> = {};
  remunerationPeriod: Record<string, { effectiveFrom?: string; effectiveTo?: string }> = {};
  isRemunerationDataLoaded: Record<string, boolean> = {};
  async getRemunerationData(year: string) {
    const resolvedYear = await this.resolveRemunerationYear(year);
    if (year !== resolvedYear) {
      this.remunerationData[year] = this.remunerationData[resolvedYear] ?? [];
      this.remunerationPeriod[year] = this.remunerationPeriod[resolvedYear] ?? {};
      this.isRemunerationDataLoaded[year] = true;
    }
  }

  /** 今年の保険料率 */
  rateData: Record<string, InsuranceRate[]> = {};
  ratePeriod: Record<string, { effectiveFrom?: string; effectiveTo?: string }> = {};
  isRateDataLoaded: Record<string, boolean> = {};
  async getRateData(year: string) {
    const resolvedYear = await this.resolveRateYear(year);
    if (year !== resolvedYear) {
      this.rateData[year] = this.rateData[resolvedYear] ?? [];
      this.ratePeriod[year] = this.ratePeriod[resolvedYear] ?? {};
      this.isRateDataLoaded[year] = true;
    }
  }

  /** 等級から標準報酬月額を取得（targetYearMonth の適用期間に合うマスタ年を自動選択） */
  async getStandardMonthlyAmount(_year: string, grade: number, targetYearMonth: string): Promise<number | undefined> {
    const masterYear = await this.resolveRemunerationYearForMonth(targetYearMonth);
    return (this.remunerationData[masterYear] ?? [])
      .find(item => Number(item.grade) === grade)?.standardMonthlyAmount;
  }

  /** 対象年月に適用される標準報酬月額マスタの年（例: 2026-01 → 2025） */
  async resolveRemunerationMasterYearForMonth(targetYearMonth: string): Promise<string> {
    return this.resolveRemunerationYearForMonth(targetYearMonth);
  }

  /** 対象年月に適用される保険料率マスタの年 */
  async resolveRateMasterYearForMonth(targetYearMonth: string): Promise<string> {
    return this.resolveRateYearForMonth(targetYearMonth);
  }

  getApplicableRemunerationData(year: string, targetYearMonth: string): StandardMonthlyRemuneration[] {
    return this.isApplicable(this.remunerationPeriod[year], targetYearMonth)
      ? (this.remunerationData[year] ?? [])
      : [];
  }

  getApplicableRateData(year: string, targetYearMonth: string): InsuranceRate[] {
    return this.isApplicable(this.ratePeriod[year], targetYearMonth)
      ? (this.rateData[year] ?? [])
      : [];
  }

  private async resolveRemunerationYearForMonth(targetYearMonth: string): Promise<string> {
    const calendarYear = Number(targetYearMonth.split('-')[0]);
    // 協会けんぽの改定は3月始まりのため、対象年と前年の適用期間を確認
    for (let year = calendarYear; year >= calendarYear - 1; year--) {
      const yearStr = String(year);
      await this.loadRemunerationData(yearStr);
      if ((this.remunerationData[yearStr]?.length ?? 0) > 0
        && this.isApplicable(this.remunerationPeriod[yearStr], targetYearMonth)) {
        return yearStr;
      }
    }
    return this.resolveRemunerationYear(String(calendarYear));
  }

  private async resolveRateYearForMonth(targetYearMonth: string): Promise<string> {
    const calendarYear = Number(targetYearMonth.split('-')[0]);
    for (let year = calendarYear; year >= calendarYear - 1; year--) {
      const yearStr = String(year);
      await this.loadRateData(yearStr);
      if ((this.rateData[yearStr]?.length ?? 0) > 0
        && this.isApplicable(this.ratePeriod[yearStr], targetYearMonth)) {
        return yearStr;
      }
    }
    return this.resolveRateYear(String(calendarYear));
  }

  private async resolveRemunerationYear(requestedYear: string): Promise<string> {
    for (let year = Number(requestedYear); year >= 2000; year--) {
      const yearStr = String(year);
      await this.loadRemunerationData(yearStr);
      if ((this.remunerationData[yearStr]?.length ?? 0) > 0) {
        return yearStr;
      }
    }
    return requestedYear;
  }

  private async resolveRateYear(requestedYear: string): Promise<string> {
    for (let year = Number(requestedYear); year >= 2000; year--) {
      const yearStr = String(year);
      await this.loadRateData(yearStr);
      if ((this.rateData[yearStr]?.length ?? 0) > 0) {
        return yearStr;
      }
    }
    return requestedYear;
  }

  private async loadRemunerationData(year: string) {
    if (this.isRemunerationDataLoaded[year]) return;
    const period = await this.crudService.getById<Record<string, unknown>>(this.remunerationParentPath(year));
    const remunerationData = await this.crudService.getAll<Record<string, unknown>>(this.remunerationPath(year), 'id');
    this.remunerationPeriod[year] = this.normalizePeriod(period ?? {});
    this.remunerationData[year] = remunerationData.map(item => this.normalizeRemunerationData(item));
    this.isRemunerationDataLoaded[year] = true;
  }

  private async loadRateData(year: string) {
    if (this.isRateDataLoaded[year]) return;
    const period = await this.crudService.getById<Record<string, unknown>>(this.rateParentPath(year));
    const rateData = await this.crudService.getAll<Record<string, unknown>>(this.ratePath(year), 'id');
    this.ratePeriod[year] = this.normalizePeriod(period ?? {});
    this.rateData[year] = rateData.map(item => this.normalizeRateData(item));
    this.isRateDataLoaded[year] = true;
  }

  private normalizeRemunerationData(item: Record<string, unknown>): StandardMonthlyRemuneration {
    return {
      id: String(item['id'] ?? ''),
      grade: Number(item['grade'] ?? item['Grade']),
      monthlyMin: Number(item['monthlyMin'] ?? item['MonthlyMin']),
      monthlyMax: Number(item['monthlyMax'] ?? item['MonthlyMax']),
      standardMonthlyAmount: Number(item['standardMonthlyAmount'] ?? item['StandardMonthlyAmount']),
    };
  }

  private normalizeRateData(item: Record<string, unknown>): InsuranceRate {
    return {
      id: String(item['id'] ?? ''),
      prefectureJa: String(item['prefectureJa'] ?? item['PrefectureJa'] ?? ''),
      prefecture: String(item['prefecture'] ?? item['Prefecture'] ?? ''),
      healthInsuranceRate: Number(item['healthInsuranceRate'] ?? item['HealthInsuranceRate']),
      nursingCareRate: Number(item['nursingCareRate'] ?? item['NursingCareRate']),
      pensionRate: Number(item['pensionRate'] ?? item['PensionRate']),
    };
  }

  private remunerationParentPath(year: string) {
    return `standardMonthlyRemunerations/${year}`;
  }

  private rateParentPath(year: string) {
    return `insuranceRates/${year}`;
  }

  private normalizePeriod(item: Record<string, unknown>): { effectiveFrom?: string; effectiveTo?: string } {
    return {
      effectiveFrom: this.toYearMonth(item['effectiveFrom'] ?? item['EffectiveFrom']),
      effectiveTo: this.toYearMonth(item['effectiveTo'] ?? item['EffectiveTo']),
    };
  }

  private isApplicable(period: { effectiveFrom?: string; effectiveTo?: string } | undefined, targetYearMonth: string): boolean {
    if (!period?.effectiveFrom && !period?.effectiveTo) return true;
    if (period.effectiveFrom && targetYearMonth < period.effectiveFrom) return false;
    if (period.effectiveTo && targetYearMonth > period.effectiveTo) return false;
    return true;
  }

  private toYearMonth(value: unknown): string | undefined {
    const text = String(value ?? '').trim();
    return text || undefined;
  }

}
