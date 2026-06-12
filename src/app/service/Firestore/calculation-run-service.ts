import { inject, Injectable } from '@angular/core';
import { Timestamp } from '@angular/fire/firestore';
import { CalculationRun } from '../../model/calculation-run';
import { CrudService } from '../common/crud-service';
import { EmployeeService } from './employee-service';
import { EmployeeLogicService } from '../logic/employee-logic-service';
import { EmployeeEventType } from '../../constants/model-constants';
import { Event } from '../../model/event';
import { addMonths, getWorkingYearMonth, isEventAtOrBeforeWorkingMonth, isEventInTargetMonth, buildAdHocRevisionRunId, parseEventYearMonth, YearMonth } from '../logic/event-id-service';
import { MonthlyInsuranceDiff, MonthlyInsuranceComparisonRow } from '../logic/correction-logic.service';

export type SystemCalculationRunItem = CalculationRun & {
  employeeId: string;
  eventType: EmployeeEventType;
  /** テンプレート互換 */
  eventId: string;
};

@Injectable({
  providedIn: 'root',
})
export class CalculationRunService {

  private crudService = inject(CrudService);
  private employeeService = inject(EmployeeService);
  private employeeLogicService = inject(EmployeeLogicService);

  private get path() {
    const companyId = sessionStorage.getItem('companyId');
    return `companies/${companyId}/calculationRuns`;
  }

  private get employeePath() {
    const companyId = sessionStorage.getItem('companyId');
    return `companies/${companyId}/employees`;
  }

  async calculateBaseForAllEmployees(year: number): Promise<boolean> {
    await this.employeeService.getAllEmployees(true);
    const employees = this.employeeService.allEmployees();
    const calculationBaseCreated = await this.crudService.create<CalculationRun>(
      this.calculationBaseDocumentPath(year),
      {
        runId: `calculationBase_${year}`,
        detectedDate: Timestamp.now(),
        type: '算定基礎',
        approval: {
          approvalStatus: '申請中',
        },
        payload: {
          year,
          status: '申請中',
        },
      },
    );
    if (!calculationBaseCreated) {
      return false;
    }

    for (const employee of employees) {
      const result = await this.employeeLogicService.getCalculationBaseResult(employee, year);
      const runId = employee.employeeId;
      const payload: Record<string, unknown> = {
        year,
        employeeId: employee.employeeId,
        employeeName: `${employee.firstName ?? ''} ${employee.lastName ?? ''}`.trim(),
        currentGrade: result.currentGrade ?? null,
        calculatedGrade: result.calculatedGrade ?? null,
        averageSalary: result.averageSalary ?? null,
        targetPayrolls: result.targetPayrolls,
        status: result.status,
        reason: result.reason ?? '',
      };
      const saved = await this.crudService.create<CalculationRun>(
        `${this.calculationBaseEmployeePath(year)}/${employee.employeeId}`,
        {
          runId,
          targetEmployeeIds: employee.employeeId,
          detectedDate: Timestamp.now(),
          type: '算定基礎',
          payload,
        },
      );

      if (!saved) {
        return false;
      }
    }

    return true;
  }

  async getPendingCalculationBaseRuns(year: number): Promise<CalculationRun[]> {
    const runs = await this.crudService.getAll<CalculationRun>(this.calculationBaseEmployeePath(year), 'runId');
    return runs
      .sort((a, b) => String(a.targetEmployeeIds ?? '').localeCompare(String(b.targetEmployeeIds ?? '')));
  }

  async getCalculationBaseRun(year: number): Promise<CalculationRun | null> {
    return await this.crudService.getById<CalculationRun>(this.calculationBaseDocumentPath(year), 'runId');
  }

  async saveCalculationBaseApprovedGrade(year: number, employeeId: string, grade: number, run: CalculationRun): Promise<boolean> {
    const calculatedGrade = Number(run.payload?.['calculatedGrade'] ?? 0);
    const currentStatus = String(run.payload?.['status'] ?? '');
    const status = grade !== calculatedGrade
      ? '修正済み'
      : (currentStatus === '修正済み' ? '計算済み' : currentStatus);

    return await this.crudService.update<CalculationRun>(
      `${this.calculationBaseEmployeePath(year)}/${employeeId}`,
      {
        payload: {
          ...run.payload,
          approvedGrade: grade,
          status,
        },
      },
    );
  }

  async approveCalculationBase(year: number): Promise<boolean> {
    const calculationBase = await this.getCalculationBaseRun(year);
    return await this.crudService.update<CalculationRun>(
      this.calculationBaseDocumentPath(year),
      {
        approval: {
          approvalStatus: '承認済み',
          approvedDate: Timestamp.now(),
          approvedBy: sessionStorage.getItem('loginEmployeeId') ?? '',
        },
        payload: {
          ...calculationBase?.payload,
          status: '社内承認済み',
        },
      },
    );
  }

  async applyApprovedCalculationBaseResults(year: number): Promise<boolean> {
    const calculationBase = await this.getCalculationBaseRun(year);
    if (calculationBase?.approval?.approvalStatus !== '承認済み') {
      return false;
    }

    const runs = await this.crudService.getAll<CalculationRun>(this.calculationBaseEmployeePath(year), 'runId');

    for (const run of runs) {
      const employeeId = String(run.payload?.['employeeId'] ?? run.targetEmployeeIds ?? '');
      const grade = Number(run.payload?.['approvedGrade'] ?? run.payload?.['calculatedGrade']);
      if (!employeeId || !Number.isFinite(grade)) {
        continue;
      }

      const employeeUpdated = await this.crudService.update(
        `${this.employeePath}/${employeeId}`,
        { 'insurance.currentGrade': grade },
      );
      if (!employeeUpdated) {
        return false;
      }

      const runUpdated = await this.crudService.update<CalculationRun>(
        `${this.calculationBaseEmployeePath(year)}/${employeeId}`,
        {
          payload: {
            ...run.payload,
            status: '反映済み',
            appliedGrade: grade,
            appliedAt: new Date(),
          },
        },
      );
      if (!runUpdated) {
        return false;
      }
    }

    const calculationBaseUpdated = await this.crudService.update<CalculationRun>(
      this.calculationBaseDocumentPath(year),
      {
        payload: {
          ...calculationBase.payload,
          status: '反映済み',
          appliedAt: new Date(),
        },
      },
    );
    if (!calculationBaseUpdated) {
      return false;
    }

    return true;
  }

  /** 随時改定の計算結果を作成（固定給変更等） */
  async createAdHocRevisionRun(
    employeeId: string,
    revisionMonth: YearMonth,
    payload: Record<string, unknown>,
    occurredDate?: Timestamp,
  ): Promise<string | null> {
    const baseRunId = buildAdHocRevisionRunId(revisionMonth);
    const runId = await this.allocateSequentialRunId(baseRunId);
    const run: Partial<CalculationRun> = {
      runId,
      targetEmployeeIds: employeeId,
      detectedDate: Timestamp.now(),
      type: '随時改定',
      approval: { approvalStatus: '申請中' },
      payload: {
        eventType: '固定給変更',
        applicantType: 'システム',
        employeeId,
        occurredDate,
        ...payload,
      },
    };

    const created = await this.crudService.create<CalculationRun>(`${this.path}/${runId}`, run);
    return created ? runId : null;
  }

  /** システムイベント相当の計算結果を作成（旧システムイベント） */
  async createSystemEventRun(
    employeeId: string,
    baseRunId: string,
    eventType: EmployeeEventType,
    payload: Record<string, unknown>,
    occurredDate?: Timestamp,
  ): Promise<string | null> {
    const runId = await this.allocateSequentialRunId(baseRunId);
    const run: Partial<CalculationRun> = {
      runId,
      targetEmployeeIds: employeeId,
      detectedDate: Timestamp.now(),
      type: 'イベント',
      approval: { approvalStatus: '申請中' },
      payload: {
        eventType,
        applicantType: 'システム',
        employeeId,
        occurredDate,
        ...payload,
      },
    };

    const created = await this.crudService.create<CalculationRun>(`${this.path}/${runId}`, run);
    return created ? runId : null;
  }

  /** 差額調整の計算結果を作成 */
  async createDifferenceAdjustmentRun(
    employeeId: string,
    sourceType: string,
    applyWorkMonth: { year: number; month: number },
    monthlyDiffs: MonthlyInsuranceDiff[],
    payload: Record<string, unknown>,
  ): Promise<string | null> {
    const baseId = `差額調整_${applyWorkMonth.year}_${String(applyWorkMonth.month).padStart(2, '0')}_${employeeId}`;
    const runId = await this.allocateSequentialRunId(baseId);
    const run: Partial<CalculationRun> = {
      runId,
      targetEmployeeIds: employeeId,
      detectedDate: Timestamp.now(),
      type: '差額調整',
      approval: {
        approvalStatus: '承認済み',
        approvedDate: Timestamp.now(),
        approvedBy: sessionStorage.getItem('loginEmployeeId') ?? '',
      },
      payload: {
        employeeId,
        sourceType,
        applyWorkMonth,
        monthlyDiffs,
        ...payload,
      },
    };
    const created = await this.crudService.create<CalculationRun>(`${this.path}/${runId}`, run);
    return created ? runId : null;
  }

  /** 対象月ごとに差額調整runを作成（申請月=現在作業月） */
  async createMonthlyDifferenceAdjustmentRuns(
    employeeId: string,
    sourceType: string,
    remark: string,
    targetMonth: { year: number; month: number },
    rows: MonthlyInsuranceComparisonRow[],
    extraPayload: Record<string, unknown> = {},
  ): Promise<number> {
    let count = 0;
    for (const row of rows) {
      const baseId = `差額調整_${targetMonth.year}_${String(targetMonth.month).padStart(2, '0')}_${employeeId}_${row.year}_${String(row.month).padStart(2, '0')}`;
      const runId = await this.allocateSequentialRunId(baseId);
      const run: Partial<CalculationRun> = {
        runId,
        targetEmployeeIds: employeeId,
        detectedDate: Timestamp.now(),
        type: '差額調整',
        approval: {
          approvalStatus: '承認済み',
          approvedDate: Timestamp.now(),
          approvedBy: sessionStorage.getItem('loginEmployeeId') ?? '',
        },
        payload: {
          employeeId,
          sourceType,
          remark,
          targetMonth,
          adjustMonth: { year: row.year, month: row.month },
          payrollId: row.payrollId,
          healthDiff: row.healthDiff,
          nursingDiff: row.nursingDiff,
          pensionDiff: row.pensionDiff,
          totalDiff: row.totalDiff,
          comparison: row,
          ...extraPayload,
        },
      };
      const created = await this.crudService.create<CalculationRun>(`${this.path}/${runId}`, run);
      if (created) count++;
    }
    return count;
  }

  /** 申請月（targetMonth）で差額調整を取得 */
  async getDifferenceAdjustmentsByTargetMonth(year: number, month: number): Promise<CalculationRun[]> {
    const runs = await this.getAllCalculationRuns();
    return runs
      .filter(run => run.type === '差額調整')
      .filter(run => {
        const target = run.payload?.['targetMonth'] as { year?: number; month?: number } | undefined;
        return target?.year === year && target?.month === month;
      })
      .sort((left, right) => String(left.runId).localeCompare(String(right.runId)));
  }

  /** 差額調整をCSV行に展開 */
  flattenDifferenceAdjustmentsForCsv(runs: CalculationRun[]): {
    employeeId: string;
    targetMonth: string;
    adjustMonth: string;
    healthDiff: number;
    pensionDiff: number;
    remark: string;
  }[] {
    return runs.map(run => {
      const target = run.payload?.['targetMonth'] as { year: number; month: number };
      const adjust = run.payload?.['adjustMonth'] as { year: number; month: number };
      return {
        employeeId: String(run.targetEmployeeIds ?? run.payload?.['employeeId'] ?? ''),
        targetMonth: `${target.year}-${String(target.month).padStart(2, '0')}`,
        adjustMonth: `${adjust.year}-${String(adjust.month).padStart(2, '0')}`,
        healthDiff: Number(run.payload?.['healthDiff'] ?? 0),
        pensionDiff: Number(run.payload?.['pensionDiff'] ?? 0),
        remark: String(run.payload?.['remark'] ?? run.payload?.['sourceType'] ?? ''),
      };
    });
  }

  async getAllCalculationRuns(): Promise<CalculationRun[]> {
    return await this.crudService.getAll<CalculationRun>(this.path, 'runId');
  }

  async getCalculationRunById(runId: string): Promise<CalculationRun | null> {
    return await this.crudService.getById<CalculationRun>(`${this.path}/${runId}`, 'runId');
  }

  async updateCalculationRun(runId: string, data: Partial<CalculationRun>): Promise<boolean> {
    return await this.crudService.update<CalculationRun>(`${this.path}/${runId}`, data);
  }

  /** 申請中のシステム計算結果（作業月以前・type=イベント/随時改定） */
  async getPendingSystemRunsUpToWorkingMonth(): Promise<SystemCalculationRunItem[]> {
    const { year, month } = getWorkingYearMonth();
    if (!year || !month) return [];

    const runs = await this.getAllCalculationRuns();
    return runs
      .filter(run =>
        (run.type === 'イベント' || run.type === '随時改定')
        && run.approval?.approvalStatus === '申請中',
      )
      .filter(run => run.runId && isEventAtOrBeforeWorkingMonth(run.runId, year, month))
      .map(run => this.toSystemItem(run))
      .filter((item): item is SystemCalculationRunItem => item !== null)
      .sort((left, right) => right.runId.localeCompare(left.runId));
  }

  /** 社員の随時改定計算結果（全承認状況） */
  async getAdHocRevisionRunsForEmployee(employeeId: string): Promise<SystemCalculationRunItem[]> {
    const runs = await this.getAllCalculationRuns();
    return runs
      .filter(run => run.type === '随時改定' && String(run.targetEmployeeIds ?? '') === employeeId)
      .map(run => this.toSystemItem(run))
      .filter((item): item is SystemCalculationRunItem => item !== null)
      .sort((left, right) => (right.detectedDate?.toMillis() ?? 0) - (left.detectedDate?.toMillis() ?? 0));
  }

  /** 社員の申請中システム計算結果 */
  async getPendingSystemRunsForEmployee(employeeId: string): Promise<SystemCalculationRunItem[]> {
    const { year, month } = getWorkingYearMonth();
    if (!year || !month) return [];

    const runs = await this.getAllCalculationRuns();
    return runs
      .filter(run =>
        (run.type === 'イベント' || run.type === '随時改定')
        && run.approval?.approvalStatus === '申請中'
        && run.targetEmployeeIds === employeeId,
      )
      .filter(run => run.runId && isEventAtOrBeforeWorkingMonth(run.runId, year, month))
      .map(run => this.toSystemItem(run))
      .filter((item): item is SystemCalculationRunItem => item !== null)
      .sort((left, right) => right.runId.localeCompare(left.runId));
  }

  /** 差額調整一覧（作業月以前） */
  async getPendingDifferenceAdjustmentsUpToWorkingMonth(): Promise<CalculationRun[]> {
    const { year, month } = getWorkingYearMonth();
    if (!year || !month) return [];

    const runs = await this.getAllCalculationRuns();
    return runs
      .filter(run => run.type === '差額調整' && run.approval?.approvalStatus === '申請中')
      .filter(run => run.runId && isEventAtOrBeforeWorkingMonth(run.runId, year, month))
      .sort((left, right) => right.runId.localeCompare(left.runId));
  }

  /** 指定作業月のシステム計算結果（全承認状況） */
  async getSystemRunsForTargetMonth(targetYear: number, targetMonth: number): Promise<SystemCalculationRunItem[]> {
    const working = getWorkingYearMonth();
    const runs = await this.getAllCalculationRuns();
    return runs
      .filter(run => run.type === 'イベント' || run.type === '随時改定')
      .filter(run =>
        run.runId
        && isEventInTargetMonth(
          run.runId,
          targetYear,
          targetMonth,
          working.year,
          working.month,
          run.detectedDate as { toDate?: () => Date; seconds?: number } | undefined,
        ),
      )
      .map(run => this.toSystemItem(run))
      .filter((item): item is SystemCalculationRunItem => item !== null)
      .sort((left, right) => (right.detectedDate?.toMillis() ?? 0) - (left.detectedDate?.toMillis() ?? 0));
  }

  async allocateSequentialRunId(baseId: string): Promise<string> {
    const runs = await this.getAllCalculationRuns();
    const escapedBase = baseId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`^${escapedBase}(?:_(\\d+))?$`);

    let maxSeq = 0;
    for (const run of runs) {
      const match = run.runId.match(pattern);
      if (match) {
        maxSeq = Math.max(maxSeq, match[1] ? Number(match[1]) : 0);
      }
    }

    return `${baseId}_${maxSeq + 1}`;
  }

  /** 作業月の前月までに改定月が到来した、未適用の承認済み随時改定 */
  async getApplicableApprovedAdHocRevisionRuns(employeeId?: string): Promise<SystemCalculationRunItem[]> {
    const working = getWorkingYearMonth();
    if (!working.year || !working.month) return [];

    const cutoff = addMonths(working.year, working.month, -1);
    const cutoffKey = cutoff.year * 12 + cutoff.month;

    const runs = await this.getAllCalculationRuns();
    return runs
      .filter(run => run.type === '随時改定')
      .filter(run => run.approval?.approvalStatus === '承認済み')
      .filter(run => {
        const empId = String(run.targetEmployeeIds ?? run.payload?.['employeeId'] ?? '');
        if (employeeId && empId !== employeeId) return false;
        const revisionMonth = run.runId
          ? parseEventYearMonth(run.runId, working.year, working.month)
          : null;
        if (!revisionMonth) return false;
        return revisionMonth.year * 12 + revisionMonth.month <= cutoffKey;
      })
      .map(run => this.toSystemItem(run))
      .filter((item): item is SystemCalculationRunItem => item !== null)
      .sort((left, right) => {
        const leftMonth = parseEventYearMonth(left.runId!, working.year, working.month)!;
        const rightMonth = parseEventYearMonth(right.runId!, working.year, working.month)!;
        return leftMonth.year * 12 + leftMonth.month - (rightMonth.year * 12 + rightMonth.month);
      });
  }

  async markRunApplied(runId: string, loginEmployeeId: string): Promise<boolean> {
    const existing = await this.getCalculationRunById(runId);
    return this.updateCalculationRun(runId, {
      approval: {
        approvalStatus: '適用済み',
        approvedDate: existing?.approval?.approvedDate ?? Timestamp.now(),
        approvedBy: existing?.approval?.approvedBy ?? loginEmployeeId,
      },
      payload: {
        ...existing?.payload,
        appliedDate: Timestamp.now(),
        appliedBy: loginEmployeeId,
      },
    });
  }

  async markRunApproved(
    runId: string,
    loginEmployeeId: string,
    payloadExtension?: Record<string, unknown>,
  ): Promise<boolean> {
    const update: Partial<CalculationRun> = {
      approval: {
        approvalStatus: '承認済み',
        approvedDate: Timestamp.now(),
        approvedBy: loginEmployeeId,
      },
    };

    if (payloadExtension) {
      const existing = await this.getCalculationRunById(runId);
      update.payload = {
        ...existing?.payload,
        ...payloadExtension,
      };
    }

    return this.updateCalculationRun(runId, update);
  }

  async markRunRejected(runId: string, loginEmployeeId: string): Promise<boolean> {
    return this.updateCalculationRun(runId, {
      approval: {
        approvalStatus: '却下',
        approvedDate: Timestamp.now(),
        approvedBy: loginEmployeeId,
      },
    });
  }

  /** CalculationRun を Event 互換ビューに変換（承認サービス用） */
  toEventView(run: SystemCalculationRunItem): Event {
    return {
      eventId: run.runId,
      companyId: sessionStorage.getItem('companyId') ?? '',
      occurredDate: run.payload?.['occurredDate'] as Timestamp | undefined,
      eventType: run.eventType,
      appliedDate: run.detectedDate,
      applicantType: 'システム',
      approval: run.approval,
      payload: {
        ...run.payload,
        before: run.payload?.['before'],
        after: run.payload?.['after'],
      },
    };
  }

  private toSystemItem(run: CalculationRun): SystemCalculationRunItem | null {
    const employeeId = String(run.targetEmployeeIds ?? run.payload?.['employeeId'] ?? '');
    const eventType = (run.payload?.['eventType'] as EmployeeEventType | undefined)
      ?? (run.type === '随時改定' ? '固定給変更' : undefined);
    if (!employeeId || !eventType || !run.runId) return null;

    return {
      ...run,
      employeeId,
      eventType,
      eventId: run.runId,
    };
  }

  private calculationBaseDocumentPath(year: number): string {
    return `${this.path}/calculationBase_${year}`;
  }

  private calculationBaseEmployeePath(year: number): string {
    return `${this.path}/calculationBase_${year}/employees`;
  }

}
