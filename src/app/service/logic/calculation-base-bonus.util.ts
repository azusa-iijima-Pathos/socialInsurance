import { Company } from '../../model/company';

/** 算定基礎（年4回以上賞与）の対象期間ラベル（前年7/1〜当年6/30） */
export function formatCalculationBaseBonusPeriodLabel(year: number): string {
  return `${year - 1}年7月1日 〜 ${year}年6月30日`;
}

export function isCalculationBaseFourOrMoreBonusCompany(company: Company | null | undefined): boolean {
  return company?.settings?.bonusFourOrMore === true;
}

/** 賞与総額の月割額（年4回以上賞与の算定基礎用：総額の1/4） */
export function calculateCalculationBaseBonusMonthlyAmount(annualBonusTotal: number): number {
  return annualBonusTotal / 4;
}
