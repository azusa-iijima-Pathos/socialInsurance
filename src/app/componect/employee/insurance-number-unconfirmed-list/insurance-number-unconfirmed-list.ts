import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { Employee, InsuranceDetail } from '../../../model/employee';
import { EmployeeService } from '../../../service/Firestore/employee-service';
import { CommonService } from '../../../service/common/common-service';
import { InsuranceFormService } from '../../../service/logic/insurance-form.service';

type UnconfirmedInsuranceItem = {
  label: string;
  acquiredDate: string;
};

export type InsuranceNumberUnconfirmedRow = {
  employeeId: string;
  name: string;
  acquiredDates: string;
  unconfirmedInsuranceNames: string;
};

@Component({
  selector: 'app-insurance-number-unconfirmed-list',
  imports: [CommonModule, RouterLink],
  templateUrl: './insurance-number-unconfirmed-list.html',
  styleUrls: ['./insurance-number-unconfirmed-list.css', '../employee-detail/employee-detail.css'],
})
export class InsuranceNumberUnconfirmedList implements OnInit {
  private employeeService = inject(EmployeeService);
  private insuranceFormService = inject(InsuranceFormService);
  commonService = inject(CommonService);

  rows: InsuranceNumberUnconfirmedRow[] = [];

  async ngOnInit() {
    await this.loadRows();
  }

  private async loadRows() {
    await this.employeeService.getAllEmployees();
    const employees = this.employeeService.allEmployees();
    this.rows = employees
      .map(employee => this.buildRow(employee))
      .filter((row): row is InsuranceNumberUnconfirmedRow => row !== null)
      .sort((left, right) => left.employeeId.localeCompare(right.employeeId));
  }

  private buildRow(employee: Employee): InsuranceNumberUnconfirmedRow | null {
    const items = this.collectUnconfirmedInsurances(employee);
    if (items.length === 0) return null;

    const employeeId = employee.employeeId;
    const name = this.commonService.getEmployeeName(employeeId)
      ?? `${employee.firstName ?? ''} ${employee.lastName ?? ''}`.trim()
      ?? employeeId;

    return {
      employeeId,
      name,
      acquiredDates: items.map(item => item.acquiredDate).join('、'),
      unconfirmedInsuranceNames: items.map(item => item.label).join('、'),
    };
  }

  private collectUnconfirmedInsurances(employee: Employee): UnconfirmedInsuranceItem[] {
    const insurance = employee.insurance;
    const healthNumber = insurance?.healthInsurance?.number;
    const items: UnconfirmedInsuranceItem[] = [];

    const pushIfMissing = (
      label: string,
      detail: InsuranceDetail | undefined,
      sharedNumber?: string,
    ) => {
      if (!this.insuranceFormService.isInsuranceNumberMissing(detail, sharedNumber)) return;
      items.push({
        label,
        acquiredDate: this.commonService.formatDate(detail?.acquiredDate) || '—',
      });
    };

    pushIfMissing('健康保険', insurance?.healthInsurance);
    pushIfMissing('介護保険', insurance?.nursingCareInsurance, healthNumber);
    pushIfMissing('厚生年金', insurance?.employeePensionInsurance);

    return items;
  }
}
