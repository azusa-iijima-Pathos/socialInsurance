import { inject, Injectable } from '@angular/core';
import { Timestamp } from '@angular/fire/firestore';
import { CalculationRun } from '../../model/calculation-run';
import { CrudService } from '../common/crud-service';
import { EmployeeService } from './employee-service';
import { EmployeeLogicService } from '../logic/employee-logic-service';

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

  private calculationBaseDocumentPath(year: number): string {
    return `${this.path}/calculationBase_${year}`;
  }

  private calculationBaseEmployeePath(year: number): string {
    return `${this.path}/calculationBase_${year}/employees`;
  }

}
