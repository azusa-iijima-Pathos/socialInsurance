import { Injectable, inject } from '@angular/core';
import { Employee } from '../../model/employee';
import { EMPLOYMENT_CATEGORIES, WORK_STYLES, EmploymentCategory, WorkStyle } from '../../constants/model-constants';
import { StandardMonthlyRemuneration } from '../../model/insuranceRate';
import { InsuranceRates } from '../Firestore/insurance-rates';
import { PayrollService } from '../Firestore/payroll-service';
import { Payroll } from '../../model/payroll';
import { CommonService } from '../common/common-service';
import { CompanyService } from '../Firestore/company-service';

export type CalculationBaseResult = {
  employeeId: string;
  currentGrade?: number;
  calculatedGrade?: number;
  averageSalary?: number;
  targetPayrolls: {
    payrollId: string;
    paymentYearMonth: string;
    actualWorkingDays?: number;
    actualPaymentAmount?: number;
  }[];
  status: '計算済み' | '従前等級' | '対象外' | '判定不能';
  reason?: string;
};

@Injectable({
  providedIn: 'root',
})
export class EmployeeLogicService {

  private insuranceRates = inject(InsuranceRates);
  private payrollService = inject(PayrollService);
  private commonService = inject(CommonService);
  private companyService = inject(CompanyService);

  get year() {
    return sessionStorage.getItem('workingYear')!;
  }

  //保険加入・等級判定

  /** 保険加入の判定 */
  isInsuranceRequired(employee: Employee, isSpecificApplicableOffice: boolean): { isHealthInsuranceRequired?: boolean, isNursingCareInsuranceRequired?: boolean, isPensionInsuranceRequired?: boolean } {
    const WorkingHours = employee.employmentContract?.contractedWorkingHoursPerWeek;
    const transportationExpenses: number | undefined = employee.employmentContract?.transportationExpenses;
    const fixedSalary: number | undefined = employee.employmentContract?.fixedSalary;

    const age = this.commonService.calculateAge(employee.birthDate!);

    let val: number | undefined;
    if (fixedSalary && transportationExpenses) {
      val = fixedSalary - transportationExpenses;
    } else if (fixedSalary) {
      //通勤手当が別で入っていない場合は暫定的に固定費で計算
      val = fixedSalary;
    }

    //正社員・フルタイム：加入
    if (employee.employmentContract?.employmentCategory === '正社員' && employee.employmentContract?.workStyle === 'フルタイム') {
      return this.isInsuranceRequiredByAge(age);
    }
    //それ以外：
    //「週30時間以上」の場合強制加入（給与などは関係ない）
    if (WorkingHours && WorkingHours >= 30) {
      return this.isInsuranceRequiredByAge(age);
      //「週20時間以上」の場合、所定内賃金が月額8.8万円以上であること
    } else if (WorkingHours && WorkingHours >= 20 && isSpecificApplicableOffice) {
      if (val && val >= 88000) {
        return this.isInsuranceRequiredByAge(age);
      } else {
        //加入しない
        return this.isInsuranceRequiredByAge();
      }
    }
    //それ以外：加入しない
    return this.isInsuranceRequiredByAge();
  }

  /** 年齢から保険加入の判定 */
  private isInsuranceRequiredByAge(age?: number): { isHealthInsuranceRequired: boolean, isNursingCareInsuranceRequired: boolean, isPensionInsuranceRequired: boolean } {

    //年齢が入っていない場合、加入しない
    if (!age) {
      return { isHealthInsuranceRequired: false, isNursingCareInsuranceRequired: false, isPensionInsuranceRequired: false };
    }

    if (age < 40) {
      return { isHealthInsuranceRequired: true, isNursingCareInsuranceRequired: false, isPensionInsuranceRequired: true };
    } else if (age < 65) {
      return { isHealthInsuranceRequired: true, isNursingCareInsuranceRequired: true, isPensionInsuranceRequired: true };
    } else if (age < 70) {
      return { isHealthInsuranceRequired: true, isNursingCareInsuranceRequired: false, isPensionInsuranceRequired: true };
    } else if (age < 75) {
      return { isHealthInsuranceRequired: true, isNursingCareInsuranceRequired: false, isPensionInsuranceRequired: false };
    } else {
      return { isHealthInsuranceRequired: false, isNursingCareInsuranceRequired: false, isPensionInsuranceRequired: false };
    }
  }

  StandardMonthlyRemuneration = this.insuranceRates.remunerationData;
  InsuranceRate = this.insuranceRates.rateData;

  /** 保険等級の判定 */
  /** 新規加入時 （等級を返し、判定不能のみundefinedを返す） */
  async getInsuranceGradeAtNewEntry(employee: Employee): Promise<number | undefined> {
    const year = this.year;
    await this.insuranceRates.getRemunerationData(year);
    const fixedSalary = employee.employmentContract?.fixedSalary;
    if (!fixedSalary) {
      console.log('固定給が入っていない');
      return undefined;
    }
    const remunerationData = this.StandardMonthlyRemuneration[year] ?? [];
    for (const remuneration of remunerationData) {
      if (fixedSalary >= remuneration.monthlyMin && fixedSalary <= remuneration.monthlyMax) {
        return remuneration.grade;
      }
    }
    return undefined;
  }

  /** 算定基礎  (対象の場合等級を返し、対象外の場合のみundefinedを返す)*/
  async getCalculationBase(employee: Employee): Promise<number | undefined> {
    const result = await this.getCalculationBaseResult(employee);
    return result.calculatedGrade;
  }

  /** 算定基礎の計算結果一覧に出すための明細つき計算 */
  async getCalculationBaseResult(employee: Employee, targetYear: number = Number(this.year)): Promise<CalculationBaseResult> {
    const year = targetYear.toString();
    await this.insuranceRates.getRemunerationData(year);

    const employeeId = employee.employeeId;
    const currentGrade = employee.insurance?.currentGrade;
    const healthInsuranceStartDate = employee.insurance?.healthInsurance?.acquiredDate?.toDate();
    const resignationDate: Date | undefined = employee.resignationDate?.toDate();

    const calculationRateTarget = this.isCalculationRateTarget(Number(year), healthInsuranceStartDate, resignationDate);
    // 算定税率対象外
    if (!calculationRateTarget) {
      console.log('算定税率対象外');
      return {
        employeeId,
        currentGrade,
        calculatedGrade: currentGrade,
        targetPayrolls: [],
        status: '対象外',
        reason: '算定基礎対象外です',
      };
    }
    // 算定基礎対象
    console.log('算定基礎対象');
    //算定基礎は対象期間ではなく、支払日が4月・5月・6月の給与を使う。
    //社員の給与データ全体から、算定基礎で使う「支払日が4〜6月」の給与だけを取り出す。
    const aprilToJuneSalaries: Payroll[] = await this.getAprilToJunePaymentSalaries(employeeId, Number(year));
    //通常・短時間就労者・特定適用の短時間労働者で、平均に使う月の条件が違うためここで振り分ける。
    const targetSalaries: Payroll[] = await this.getCalculationBaseTargetSalaries(employee, aprilToJuneSalaries);

    if (targetSalaries.length === 0) {
      //条件を満たす月がない場合は、従前の標準報酬等級を引き続き使う。
      console.log('条件を満たす月がない場合は、従前の標準報酬等級を引き続き使う。');
      return {
        employeeId,
        currentGrade,
        calculatedGrade: currentGrade,
        targetPayrolls: this.toCalculationBasePayrolls(targetSalaries),
        status: '従前等級',
        reason: '支払基礎日数の条件を満たす月がないため、従前等級を使います',
      };
    }

    const averageSalary = targetSalaries.reduce((total, payroll) => total + payroll.actualPaymentAmount!, 0) / targetSalaries.length;

    //平均した報酬月額が、どの標準報酬等級の範囲に入るかをマスタから探す。
    const remunerationData = this.StandardMonthlyRemuneration[year] ?? [];
    for (const remuneration of remunerationData) {
      if (averageSalary >= remuneration.monthlyMin && averageSalary <= remuneration.monthlyMax) {
        return {
          employeeId,
          currentGrade,
          calculatedGrade: remuneration.grade,
          averageSalary,
          targetPayrolls: this.toCalculationBasePayrolls(targetSalaries),
          status: '計算済み',
        };
      }
    }
    // 判定不能
    console.log('(該当等級なし)判定不能');
    return {
      employeeId,
      currentGrade,
      averageSalary,
      targetPayrolls: this.toCalculationBasePayrolls(targetSalaries),
      status: '判定不能',
      reason: '平均報酬月額に該当する標準報酬等級がありません',
    };
  }

  // 算定基礎対象の給与データを作る
  private toCalculationBasePayrolls(payrollList: Payroll[]): CalculationBaseResult['targetPayrolls'] {
    return payrollList.map(payroll => {
      const paymentDate = payroll.paymentDate?.toDate();
      const paymentYearMonth = paymentDate
        ? `${paymentDate.getFullYear()}-${String(paymentDate.getMonth() + 1).padStart(2, '0')}`
        : '';

      return {
        payrollId: payroll.payrollId,
        paymentYearMonth,
        actualWorkingDays: payroll.actualWorkingDays,
        actualPaymentAmount: payroll.actualPaymentAmount,
      };
    });
  }

  /** 4〜6月の給与データを取得 */
  private async getAprilToJunePaymentSalaries(employeeId: string, year: number): Promise<Payroll[]> {
    const payrollList = await this.payrollService.getPayrollListForEmployee(employeeId);
    return payrollList
      //算定基礎は毎月給与だけが対象。賞与は含めない。
      .filter(payroll => payroll.type === '毎月')
      .filter(payroll => {
        const paymentDate = payroll.paymentDate?.toDate();
        if (!paymentDate) return false;

        //対象期間ではなく、実際の支払日が対象年の4月・5月・6月に入っているかを見る。
        const paymentYear = paymentDate.getFullYear();
        const paymentMonth = paymentDate.getMonth() + 1;
        return paymentYear === year && 4 <= paymentMonth && paymentMonth <= 6;
      });
  }

  /** 算定基礎対象の給与データを取得(勤務日数でフィルター) */
  private async getCalculationBaseTargetSalaries(employee: Employee, payrollList: Payroll[]): Promise<Payroll[]> {
    const isSpecificApplicableOffice = await this.companyService.isSpecificApplicableOffice();
    //特定適用事業所の短時間労働者は、支払基礎日数11日以上の月だけで平均する。
    if (this.isSpecificApplicableShortTimeWorker(employee, isSpecificApplicableOffice)) {
      const targetSalaries = this.filterPayrollsByWorkingDays(payrollList, 11);
      return targetSalaries.length > 0 ? targetSalaries : [];
    }

    //短時間就労者はまず17日以上の月を見る。1か月以上あれば、その月だけで平均する。
    if (this.isShortTimeWorker(employee)) {
      const overSeventeenDays = this.filterPayrollsByWorkingDays(payrollList, 17);
      if (overSeventeenDays.length > 0) {
        return overSeventeenDays;
      }
      //17日以上の月がない場合は、15日以上17日未満の月だけで平均する。
      return payrollList.filter(payroll => {
        const workingDays = payroll.actualWorkingDays ?? 0;
        return 15 <= workingDays && workingDays < 17 && payroll.actualPaymentAmount !== undefined;
      });
    }

    //通常の従業員は、支払基礎日数17日以上の月だけで平均する。
    return this.filterPayrollsByWorkingDays(payrollList, 17);
  }

  /** 支払基礎日数でフィルター */
  private filterPayrollsByWorkingDays(payrollList: Payroll[], minWorkingDays: number): Payroll[] {
    return payrollList.filter(payroll => {
      //支払基礎日数の条件を満たし、報酬額が入っている月だけを平均対象にする。
      return (payroll.actualWorkingDays ?? 0) >= minWorkingDays
        && payroll.actualPaymentAmount !== undefined;
    });
  }

  /** 短時間就労者か */
  private isShortTimeWorker(employee: Employee): boolean {
    const weeklyWorkingHours = employee.employmentContract?.contractedWorkingHoursPerWeek ?? 0;
    //名称ではなく、勤務形態または週労働時間が通常より短いかで短時間就労者として扱う。
    return employee.employmentContract?.workStyle !== 'フルタイム'
      || (weeklyWorkingHours > 0 && weeklyWorkingHours < 30);
  }

  /** 特定適用事業所の短時間労働者か */
  private isSpecificApplicableShortTimeWorker(employee: Employee, isSpecificApplicableOffice: boolean): boolean {
    if (!isSpecificApplicableOffice || !this.isShortTimeWorker(employee)) {
      return false;
    }

    const weeklyWorkingHours = employee.employmentContract?.contractedWorkingHoursPerWeek ?? 0;
    const fixedSalary = employee.employmentContract?.fixedSalary ?? 0;
    const transportationExpenses = employee.employmentContract?.transportationExpenses ?? 0;
    const monthlyWage = fixedSalary ? fixedSalary - transportationExpenses : 0;

    //特定適用事業所で、週20時間以上30時間未満かつ所定内賃金8.8万円以上なら11日基準を使う。
    return weeklyWorkingHours >= 20 && weeklyWorkingHours < 30 && monthlyWage >= 88000;
  }

  /** 算定基礎対象か
 *同年6月1日以降に資格取得した方
 *同年6月30日以前に退職した方
 *同年7月改定の月額変更届を提出する方、
 *同年8月または9月に随時改定が予定されている旨の申し出を行った方は対象外
 */
  private isCalculationRateTarget(year: number, healthInsuranceStartDate?: Date, resignationDate?: Date): boolean {

    if (!healthInsuranceStartDate) return false;
    //今年の6月1日
    const juneFirst = new Date(year, 5, 1);
    //今年の6月30日
    const juneThirty = new Date(year, 5, 30);

    //今年の6月1日以降に資格取得した方は算定基礎対象外
    if (healthInsuranceStartDate >= juneFirst) {
      return false;
    }
    //今年の6月30日以前に退職した方は算定基礎対象外
    if (resignationDate && resignationDate <= juneThirty) {
      return false;
    }
    return true;
  }

  /** 随時改定（固定給が変わった場合）　*/






  /** 等級から保険料の算出 */
  async getInsuranceRate(prefecture: string, grade: number, targetYearMonth: string) {
    const targetYear = targetYearMonth.split('-')[0];
    await this.insuranceRates.getRateData(targetYear);
    await this.insuranceRates.getRemunerationData(targetYear);

    /** 等級から標準報酬月額を取得 */
    const standardMonthlyAmount = await this.insuranceRates.getStandardMonthlyAmount(targetYear, grade, targetYearMonth);
    if (!standardMonthlyAmount) {
      throw new Error('標準報酬月額が見つかりません');
    }

    /** 4等級の標準月額報酬 */
    const applicableRemunerationData = this.insuranceRates.getApplicableRemunerationData(targetYear, targetYearMonth);
    const standardMonthlyAmountForGrade4 = applicableRemunerationData.find(item => Number(item.grade) === 4)?.standardMonthlyAmount;
    /** 35等級の標準月額報酬 */
    const standardMonthlyAmountForGrade36 = applicableRemunerationData.find(item => Number(item.grade) === 35)?.standardMonthlyAmount;

    for (const rate of this.insuranceRates.getApplicableRateData(targetYear, targetYearMonth)) {
      if (rate.prefecture === prefecture) {

        const healthRate = rate.healthInsuranceRate / 100;
        const nursingCareRate = rate.nursingCareRate / 100;
        const pensionRate = rate.pensionRate / 100;

        /** 4等級以下の厚生年金は4等級の標準月額報酬にRateを付ける */
        const grade4UnderPension = standardMonthlyAmountForGrade4! * pensionRate;
        /** 35等級以上の厚生年金は35等級の標準月額報酬にRateを付ける */
        const grade36OverPension = standardMonthlyAmountForGrade36! * pensionRate;

        if (grade < 4) {
          return {
            healthInsurance: standardMonthlyAmount * healthRate,
            nursingCare: standardMonthlyAmount * nursingCareRate,
            pension: grade4UnderPension,
          };
        } else if (4 <= grade && grade <= 35) {
          return {
            healthInsurance: standardMonthlyAmount * healthRate,
            nursingCare: standardMonthlyAmount * nursingCareRate,
            pension: standardMonthlyAmount * pensionRate,
          };
        } else {
          return {
            healthInsurance: standardMonthlyAmount * healthRate,
            nursingCare: standardMonthlyAmount * nursingCareRate,
            pension: grade36OverPension,
          };
        }
      }
    }
    return undefined;
  }

}