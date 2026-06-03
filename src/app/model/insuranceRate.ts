/**
 * 標準報酬月額マスタ
 */

export type StandardMonthlyRemuneration = {

    id: string;

    grade: number;

    monthlyMin: number;

    monthlyMax: number;

    standardMonthlyAmount: number;
};

/**
 * 保険料率
 */
export type InsuranceRate = {

    id: string;

    prefectureJa: string;

    prefecture: string;

    healthInsuranceRate: number;

    nursingCareRate: number;

    pensionRate: number;
};
