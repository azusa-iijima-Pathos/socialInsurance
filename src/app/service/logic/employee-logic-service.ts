import { Injectable, inject } from '@angular/core';
import { Employee } from '../../model/employee';
import { EMPLOYMENT_CATEGORIES, WORK_STYLES, EmploymentCategory, WorkStyle } from '../../constants/model-constants';
import { StandardMonthlyRemuneration } from '../../model/insuranceRate';
import { InsuranceRates } from '../Firestore/insurance-rates';
import { PayrollService } from '../Firestore/payroll-service';
import { Payroll } from '../../model/payroll';
import { CommonService } from '../common/common-service';
import { CompanyService } from '../Firestore/company-service';
import { addMonths, parseEventYearMonth, YearMonth } from './event-id-service';
import { CrudService } from '../common/crud-service';
import { CalculationRun } from '../../model/calculation-run';
import { calculateCalculationBaseBonusMonthlyAmount } from './calculation-base-bonus.util';

export type CalculationBaseOptions = {
  /** 年4回以上賞与会社向け：対象期間の賞与総額 */
  annualBonusTotal?: number;
  /** 年4回以上賞与の月割加算を適用するか */
  applyFourOrMoreBonus?: boolean;
};

export type AdHocRevisionResult = {
  status: '改定あり' | '変更なし' | '判定不可';
  currentGrade: number;
  calculatedGrade?: number;
  averageSalary?: number;
  reason?: string;
  targetPayrolls?: {
    payrollId: string;
    actualWorkingDays?: number;
    actualPaymentAmount?: number;
  }[];
};

export type CalculationBaseResult = {
  employeeId: string;
  currentGrade?: number;
  calculatedGrade?: number;
  averageSalary?: number;
  /** 賞与加算前の平均報酬月額（年4回以上賞与時のみ） */
  baseAverageSalary?: number;
  /** 入力された賞与総額（年4回以上賞与時のみ） */
  bonusAnnualTotal?: number;
  /** 賞与月割額（年4回以上賞与時のみ） */
  bonusMonthlyAmount?: number;
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

  private static readonly CALCULATION_BASE_AD_HOC_REVISION_NOTE = '８・９月に随時改定の可能性があります。';

  private insuranceRates = inject(InsuranceRates);
  private payrollService = inject(PayrollService);
  private commonService = inject(CommonService);
  private companyService = inject(CompanyService);
  private crudService = inject(CrudService);

  private get calculationRunPath() {
    const companyId = sessionStorage.getItem('companyId');
    return `companies/${companyId}/calculationRuns`;
  }

  get year() {
    return sessionStorage.getItem('workingYear')!;
  }

  //保険加入・等級判定

  /** 保険加入の判定
   * @param isSpecificApplicableOffice 特定適用事業所または任意特定適用事業所のいずれかが該当する場合 true
   */
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
    const monthlyAmount = this.resolveRemunerationMonthlyAmount(employee);
    if (monthlyAmount === undefined) {
      return undefined;
    }

    const targetYearMonth = this.resolveNewEntryTargetYearMonth(employee);
    const masterYear = await this.insuranceRates.resolveRemunerationMasterYearForMonth(targetYearMonth);
    await this.insuranceRates.getRemunerationData(masterYear);
    const remunerationData = this.insuranceRates.getRemunerationDataForCalculation(masterYear, targetYearMonth);
    if (remunerationData.length === 0) {
      return undefined;
    }

    for (const remuneration of remunerationData) {
      if (monthlyAmount >= remuneration.monthlyMin && monthlyAmount <= remuneration.monthlyMax) {
        return remuneration.grade;
      }
    }
    return undefined;
  }

  /** 等級判定に使う報酬月額（通勤手当は除く） */
  private resolveRemunerationMonthlyAmount(employee: Employee): number | undefined {
    const fixedSalary = employee.employmentContract?.fixedSalary;
    if (fixedSalary === undefined || fixedSalary === null) {
      return undefined;
    }
    const transportationExpenses = employee.employmentContract?.transportationExpenses;
    if (transportationExpenses !== undefined && transportationExpenses !== null) {
      return fixedSalary - transportationExpenses;
    }
    return fixedSalary;
  }

  private resolveNewEntryTargetYearMonth(employee: Employee): string {
    const hireDate = employee.hireDate?.toDate();
    if (hireDate) {
      return `${hireDate.getFullYear()}-${String(hireDate.getMonth() + 1).padStart(2, '0')}`;
    }

    const workingYear = sessionStorage.getItem('workingYear');
    const workingMonth = sessionStorage.getItem('workingMonth');
    if (workingYear && workingMonth) {
      return `${workingYear}-${String(workingMonth).padStart(2, '0')}`;
    }

    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }

  /** 算定基礎  (対象の場合等級を返し、対象外の場合のみundefinedを返す)*/
  async getCalculationBase(employee: Employee): Promise<number | undefined> {
    const result = await this.getCalculationBaseResult(employee);
    return result.calculatedGrade;
  }

  /** 算定基礎の計算結果一覧に出すための明細つき計算 */
  async getCalculationBaseResult(
    employee: Employee,
    targetYear: number = Number(this.year),
    options?: CalculationBaseOptions,
  ): Promise<CalculationBaseResult> {
    const result = await this.computeCalculationBaseResult(employee, targetYear, options);
    return this.applyCalculationBaseAdHocRevisionNote(result, employee.employeeId, targetYear);
  }

  private async computeCalculationBaseResult(
    employee: Employee,
    targetYear: number,
    options?: CalculationBaseOptions,
  ): Promise<CalculationBaseResult> {
    const year = targetYear.toString();

    const employeeId = employee.employeeId;
    const currentGrade = employee.insurance?.currentGrade;
    const healthInsuranceStartDate = employee.insurance?.healthInsurance?.acquiredDate?.toDate();
    const resignationDate: Date | undefined = employee.resignationDate?.toDate();

    const calculationRateTargetReason = this.getCalculationRateTargetExclusionReason(Number(year), healthInsuranceStartDate, resignationDate);
    // 算定税率対象外
    if (calculationRateTargetReason) {
      console.log('算定税率対象外');
      return {
        employeeId,
        currentGrade,
        calculatedGrade: currentGrade,
        targetPayrolls: [],
        status: '対象外',
        reason: calculationRateTargetReason,
      };
    }
    // 算定基礎対象
    console.log('算定基礎対象');
    //算定基礎は対象期間ではなく、支払日が4月・5月・6月の給与を使う。
    //社員の給与データ全体から、算定基礎で使う「支払日が4〜6月」の給与だけを取り出す。
    const aprilToJuneSalaries: Payroll[] = await this.getAprilToJunePaymentSalaries(employeeId, Number(year));
    if (aprilToJuneSalaries.length === 0) {
      return {
        employeeId,
        currentGrade,
        calculatedGrade: currentGrade,
        targetPayrolls: [],
        status: '判定不能',
        reason: '4月〜6月支払いの給与データがありません',
      };
    }
    //フルタイム/特定適用/一般で、平均に使う月の支払基礎日数条件が異なるためここで振り分ける。
    const targetSalaries: Payroll[] = await this.getCalculationBaseTargetSalaries(employee, aprilToJuneSalaries);

    if (targetSalaries.length === 0) {
      //条件を満たす月がない場合は、従前の標準報酬等級を引き続き使う。
      console.log('条件を満たす月がない場合は、従前の標準報酬等級を引き続き使う。');
      return {
        employeeId,
        currentGrade,
        calculatedGrade: currentGrade,
        targetPayrolls: this.toCalculationBasePayrolls(aprilToJuneSalaries),
        status: '従前等級',
        reason: this.getCalculationBaseNoTargetReason(aprilToJuneSalaries),
      };
    }

    const averageSalary = this.applyCalculationBaseBonusIfNeeded(
      targetSalaries.reduce((total, payroll) => total + payroll.actualPaymentAmount!, 0) / targetSalaries.length,
      options,
    );

    //平均した報酬月額が、どの標準報酬等級の範囲に入るかをマスタから探す（9月適用の等級表）。
    const calculationBaseTargetYearMonth = `${targetYear}-09`;
    const masterYear = await this.insuranceRates.resolveRemunerationMasterYearForMonth(calculationBaseTargetYearMonth);
    await this.insuranceRates.getRemunerationData(masterYear);
    const remunerationData = this.insuranceRates.getRemunerationDataForCalculation(masterYear, calculationBaseTargetYearMonth);
    const adjustedAverage = Math.round(averageSalary.adjustedAverage);
    for (const remuneration of remunerationData) {
      if (adjustedAverage >= remuneration.monthlyMin && adjustedAverage <= remuneration.monthlyMax) {
        return {
          employeeId,
          currentGrade,
          calculatedGrade: remuneration.grade,
          averageSalary: adjustedAverage,
          baseAverageSalary: averageSalary.baseAverageSalary,
          bonusAnnualTotal: averageSalary.bonusAnnualTotal,
          bonusMonthlyAmount: averageSalary.bonusMonthlyAmount,
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
      averageSalary: adjustedAverage,
      baseAverageSalary: averageSalary.baseAverageSalary,
      bonusAnnualTotal: averageSalary.bonusAnnualTotal,
      bonusMonthlyAmount: averageSalary.bonusMonthlyAmount,
      targetPayrolls: this.toCalculationBasePayrolls(targetSalaries),
      status: '判定不能',
      reason: remunerationData.length === 0
        ? `${masterYear}年度の標準報酬月額マスタが登録されていません`
        : '平均報酬月額に該当する標準報酬等級がありません',
    };
  }

  private applyCalculationBaseBonusIfNeeded(
    baseAverage: number,
    options?: CalculationBaseOptions,
  ): {
    adjustedAverage: number;
    baseAverageSalary?: number;
    bonusAnnualTotal?: number;
    bonusMonthlyAmount?: number;
  } {
    if (!options?.applyFourOrMoreBonus || options.annualBonusTotal === undefined) {
      return { adjustedAverage: baseAverage };
    }

    const bonusMonthlyAmount = calculateCalculationBaseBonusMonthlyAmount(options.annualBonusTotal);
    return {
      adjustedAverage: baseAverage + bonusMonthlyAmount,
      baseAverageSalary: baseAverage,
      bonusAnnualTotal: options.annualBonusTotal,
      bonusMonthlyAmount,
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
    const payrollList = await this.getPayrollListWithAdjustedAmounts(employeeId);
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

    if (!this.isNonFullTimeWorker(employee)) {
      // フルタイム: 支払基礎日数17日以上の月で平均
      return this.filterPayrollsByWorkingDays(payrollList, 17);
    }

    if (isSpecificApplicableOffice) {
      // フルタイム以外 + 特定適用/任意特定適用: 11日以上の月のみ
      return this.filterPayrollsByWorkingDays(payrollList, 11);
    }

    // フルタイム以外 + 特定適用でも任意特定でもない: 17日以上の月を優先
    const overSeventeenDays = this.filterPayrollsByWorkingDays(payrollList, 17);
    if (overSeventeenDays.length > 0) {
      return overSeventeenDays;
    }

    // 17日以上がなければ15〜16日の月で平均
    return payrollList.filter(payroll => {
      const workingDays = payroll.actualWorkingDays ?? 0;
      return workingDays >= 15 && workingDays <= 16 && payroll.actualPaymentAmount !== undefined;
    });
  }

  /** 支払基礎日数でフィルター */
  private filterPayrollsByWorkingDays(payrollList: Payroll[], minWorkingDays: number): Payroll[] {
    return payrollList.filter(payroll => {
      //支払基礎日数の条件を満たし、報酬額が入っている月だけを平均対象にする。
      return (payroll.actualWorkingDays ?? 0) >= minWorkingDays
        && payroll.actualPaymentAmount !== undefined;
    });
  }

  private getCalculationBaseNoTargetReason(payrollList: Payroll[]): string {
    if (payrollList.some(payroll => payroll.actualPaymentAmount === undefined)) {
      return '総支給額が未入力の月があるため、従前等級を使います';
    }

    return '支払基礎日数の条件を満たす月がないため、従前等級を使います';
  }

  /** フルタイム以外か（算定基礎の日数基準の判定用） */
  private isNonFullTimeWorker(employee: Employee): boolean {
    return employee.employmentContract?.workStyle !== 'フルタイム';
  }

  /** 対象年の8月または9月にシステム計算の随時改定が存在するか */
  private async hasAdHocRevisionScheduledForAugustOrSeptember(employeeId: string, year: number): Promise<boolean> {
    const runs = await this.crudService.getAll<CalculationRun>(this.calculationRunPath, 'runId');
    return runs.some(run => {
      if (run.type !== '随時改定') return false;
      const runEmployeeId = String(run.targetEmployeeIds ?? run.payload?.['employeeId'] ?? '');
      if (runEmployeeId !== employeeId) return false;
      if (run.approval?.approvalStatus === '却下') return false;
      if (!run.runId) return false;

      const parsed = parseEventYearMonth(run.runId, year, 8);
      return parsed?.year === year && (parsed.month === 8 || parsed.month === 9);
    });
  }

  private async applyCalculationBaseAdHocRevisionNote(
    result: CalculationBaseResult,
    employeeId: string,
    year: number,
  ): Promise<CalculationBaseResult> {
    if (result.status === '対象外') return result;
    if (!await this.hasAdHocRevisionScheduledForAugustOrSeptember(employeeId, year)) return result;

    const note = EmployeeLogicService.CALCULATION_BASE_AD_HOC_REVISION_NOTE;
    return {
      ...result,
      reason: result.reason ? `${result.reason} ${note}` : note,
    };
  }

  /** 算定基礎対象外の判定
 * 同年6月1日以降に資格取得した方
 * 同年6月30日以前に退職した方
 * 同年7月改定の月額変更届を提出する方
 *（8・9月の随時改定予定がある場合は計算は行い、理由欄に注記）
 */
  private getCalculationRateTargetExclusionReason(year: number, healthInsuranceStartDate?: Date, resignationDate?: Date): string | null {

    if (!healthInsuranceStartDate) return '健康保険の資格取得日がないため、算定基礎対象外です';
    //今年の6月1日
    const juneFirst = new Date(year, 5, 1);
    //今年の6月30日
    const juneThirty = new Date(year, 5, 30);

    //今年の6月1日以降に資格取得した方は算定基礎対象外
    if (healthInsuranceStartDate >= juneFirst) {
      return '同年6月1日以降に資格取得しているため、算定基礎対象外です';
    }
    //今年の6月30日以前に退職した方は算定基礎対象外
    if (resignationDate && resignationDate <= juneThirty) {
      return '同年6月30日以前に退職しているため、算定基礎対象外です';
    }
    return null;
  }

  /** 随時改定（固定給が変わった場合） */
  async getAdHocRevisionResult(employee: Employee, changeMonth: YearMonth): Promise<AdHocRevisionResult> {
    const currentGrade = employee.insurance?.currentGrade ?? 0;
    if (!currentGrade) {
      return { status: '判定不可', currentGrade, reason: '現在等級が未設定のため判定できません', targetPayrolls: [] };
    }

    const targetYearMonth = `${changeMonth.year}-${String(changeMonth.month).padStart(2, '0')}`;
    const masterYear = await this.insuranceRates.resolveRemunerationMasterYearForMonth(targetYearMonth);
    await this.insuranceRates.getRemunerationData(masterYear);
    const remunerationData = this.insuranceRates.getRemunerationDataForCalculation(masterYear, targetYearMonth);

    const targetMonths: YearMonth[] = [
      changeMonth,
      addMonths(changeMonth.year, changeMonth.month, 1),
      addMonths(changeMonth.year, changeMonth.month, 2),
    ];

    const payrollList = await this.getPayrollListWithAdjustedAmounts(employee.employeeId);
    const monthlyPayrolls = payrollList.filter(payroll => payroll.type === '毎月');
    const matchedPayrolls: Payroll[] = [];

    for (const targetMonth of targetMonths) {
      const payrollId = `${targetMonth.year}-${String(targetMonth.month).padStart(2, '0')}`;
      const payroll = monthlyPayrolls.find(item => item.payrollId === payrollId);
      if (!payroll) {
        return { status: '判定不可', currentGrade, reason: `${payrollId}の給与データがありません`, targetPayrolls: this.toAdHocRevisionPayrolls(matchedPayrolls) };
      }
      if (payroll.actualPaymentAmount === undefined) {
        return { status: '判定不可', currentGrade, reason: `${payrollId}の総支給額が未入力です`, targetPayrolls: this.toAdHocRevisionPayrolls([...matchedPayrolls, payroll]) };
      }
      matchedPayrolls.push(payroll);
    }




    // ★既存の日数判定ロジックに3か月分の給与を放り込む
    const validPayrolls = await this.getCalculationBaseTargetSalaries(employee, matchedPayrolls);

    // ★随時改定は「3か月すべて」条件をクリアしていないとNG
    if (validPayrolls.length !== 3) {
      return {
        status: '判定不可',
        currentGrade,
        reason: '対象の3か月間に、支払基礎日数が基準を満たさない月が含まれています。',
        targetPayrolls: this.toAdHocRevisionPayrolls(matchedPayrolls),
      };
    }





    const averageSalary = matchedPayrolls.reduce((total, payroll) => total + payroll.actualPaymentAmount!, 0) / 3;

    if (remunerationData.length === 0) {
      return {
        status: '判定不可',
        currentGrade,
        averageSalary,
        reason: `${masterYear}年の標準報酬月額マスタが登録されていません`,
        targetPayrolls: this.toAdHocRevisionPayrolls(matchedPayrolls),
      };
    }

    let calculatedGrade: number | undefined;

    for (const remuneration of remunerationData) {
      if (averageSalary >= remuneration.monthlyMin && averageSalary <= remuneration.monthlyMax) {
        calculatedGrade = remuneration.grade;
        break;
      }
    }

    if (calculatedGrade === undefined) {
      return {
        status: '判定不可',
        currentGrade,
        averageSalary,
        reason: '3か月平均の報酬月額に該当する標準報酬等級がありません',
        targetPayrolls: this.toAdHocRevisionPayrolls(matchedPayrolls),
      };
    }

    if (Math.abs(calculatedGrade - currentGrade) >= 2) {
      return { status: '改定あり', currentGrade, calculatedGrade, averageSalary, targetPayrolls: this.toAdHocRevisionPayrolls(matchedPayrolls) };
    }

    return { status: '変更なし', currentGrade, calculatedGrade, averageSalary, targetPayrolls: this.toAdHocRevisionPayrolls(matchedPayrolls) };
  }

  /** 随時改定の給与データを作る */
  private toAdHocRevisionPayrolls(payrolls: Payroll[]): AdHocRevisionResult['targetPayrolls'] {
    return payrolls.map(payroll => ({
      payrollId: payroll.payrollId,
      actualWorkingDays: payroll.actualWorkingDays,
      actualPaymentAmount: payroll.actualPaymentAmount,
    }));
  }

  /** 給与データを取得（差額調整を含む） */
  private async getPayrollListWithAdjustedAmounts(employeeId: string): Promise<Payroll[]> {
    const payrollList = await this.payrollService.getPayrollListForEmployee(employeeId);
    const adjustmentRuns = await this.getDifferenceAdjustmentRuns();

    return payrollList.map(payroll => {
      if (!payroll.payrollId) return payroll;

      const latestAdjustment = adjustmentRuns
        .filter(run => String(run.payload?.['employeeId'] ?? run.targetEmployeeIds ?? '') === employeeId)
        .filter(run => String(run.payload?.['payrollId'] ?? '') === payroll.payrollId)
        .filter(run => run.payload?.['afterAmount'] !== undefined)
        .sort((left, right) => String(right.runId ?? '').localeCompare(String(left.runId ?? '')))[0];

      if (!latestAdjustment) return payroll;

      return {
        ...payroll,
        actualPaymentAmount: Number(latestAdjustment.payload?.['afterAmount'] ?? payroll.actualPaymentAmount),
      };
    });
  }

  /** 差額調整一覧を取得 */
  private async getDifferenceAdjustmentRuns(): Promise<CalculationRun[]> {
    return (await this.crudService.getAll<CalculationRun>(this.calculationRunPath, 'runId'))
      .filter(run => run.type === '差額調整');
  }

  /** 随時改定の等級を取得 */
  async getAdHocRevisionGrade(employee: Employee, changeMonth: YearMonth): Promise<number | undefined> {
    const result = await this.getAdHocRevisionResult(employee, changeMonth);
    return result.status === '改定あり' ? result.calculatedGrade : undefined;
  }

  /** 等級から保険料の算出 */
  async getInsuranceRate(prefecture: string, grade: number, targetYearMonth: string) {
    const normalizedGrade = Number(grade);
    if (!Number.isFinite(normalizedGrade) || normalizedGrade <= 0) {
      throw new Error('等級が不正です');
    }

    const remunerationMasterYear = await this.insuranceRates.resolveRemunerationMasterYearForMonth(targetYearMonth);
    const rateMasterYear = await this.insuranceRates.resolveRateMasterYearForMonth(targetYearMonth);

    /** 等級から標準報酬月額を取得 */
    const standardMonthlyAmount = await this.insuranceRates.getStandardMonthlyAmount(remunerationMasterYear, normalizedGrade, targetYearMonth);
    if (!standardMonthlyAmount) {
      throw new Error('標準報酬月額が見つかりません');
    }

    /** 4等級の標準月額報酬 */
    const applicableRemunerationData = this.insuranceRates.getRemunerationDataForCalculation(remunerationMasterYear, targetYearMonth);
    const standardMonthlyAmountForGrade4 = applicableRemunerationData.find(item => Number(item.grade) === 4)?.standardMonthlyAmount;
    /** 35等級の標準月額報酬 */
    const standardMonthlyAmountForGrade36 = applicableRemunerationData.find(item => Number(item.grade) === 35)?.standardMonthlyAmount;

    const rateList = this.insuranceRates.getRateDataForCalculation(rateMasterYear, targetYearMonth);
    if (!rateList.length) {
      throw new Error(`保険料率マスタが取得できません（${rateMasterYear}年度）`);
    }

    for (const rate of rateList) {
      if (rate.prefecture === prefecture || rate.prefectureJa === prefecture) {

        const healthRate = rate.healthInsuranceRate / 100;
        const nursingCareRate = rate.nursingCareRate / 100;
        const pensionRate = rate.pensionRate / 100;

        /** 4等級以下の厚生年金は4等級の標準月額報酬にRateを付ける */
        const grade4UnderPension = (standardMonthlyAmountForGrade4 ?? 0) * pensionRate;
        /** 35等級以上の厚生年金は35等級の標準月額報酬にRateを付ける */
        const grade36OverPension = (standardMonthlyAmountForGrade36 ?? 0) * pensionRate;

        if (normalizedGrade < 4) {
          return {
            healthInsurance: standardMonthlyAmount * healthRate,
            nursingCare: standardMonthlyAmount * nursingCareRate,
            pension: grade4UnderPension,
          };
        } else if (normalizedGrade <= 35) {
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
    throw new Error(`保険料率が見つかりません（${prefecture}）`);
  }

}