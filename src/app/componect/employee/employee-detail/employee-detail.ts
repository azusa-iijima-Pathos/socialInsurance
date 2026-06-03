import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { EmployeeService } from '../../../service/Firestore/employee-service';
import { CommonService } from '../../../service/common/common-service';
import { FormsModule } from '@angular/forms';
import { Employee, InsuranceDetail } from '../../../model/employee';
import { OfficeService } from '../../../service/Firestore/office-service';
import { EmployeeLogicService } from '../../../service/logic/employee-logic-service';
import { CompanyService } from '../../../service/Firestore/company-service';
import { ActivatedRoute } from '@angular/router';
import { DependentService } from '../../../service/Firestore/dependent-service';
import { Dependent } from '../../../model/dependent';

@Component({
  selector: 'app-employee-detail',
  imports: [CommonModule, FormsModule],
  templateUrl: './employee-detail.html',
  styleUrl: './employee-detail.css',
})
export class EmployeeDetail {

  commonService = inject(CommonService);
  private employeeService = inject(EmployeeService);
  private officeService = inject(OfficeService);
  private employeeLogicService = inject(EmployeeLogicService);
  private companyService = inject(CompanyService);
  private route = inject(ActivatedRoute);
  private dependentService = inject(DependentService);

  employeeMap = this.employeeService.allEmployeeNameMap;

  selectedEmployeeId: string = '';
  selectedEmployee: Employee | null = null;

  dependents: Dependent[] = [];
  
  message: string = '';

  async ngOnInit() {
    await this.employeeService.getAllEmployees();
    await this.officeService.getAllOffice();

    const employeeId = this.route.snapshot.queryParamMap.get('employeeId');
    if (employeeId) {
      this.selectedEmployeeId = employeeId;
      await this.selectEmployee();
      this.dependents = await this.dependentService.getDependents(this.selectedEmployeeId);
    }
  }

  //従業員情報を表示
  async selectEmployee() {
    this.message = '';
    const employee = await this.employeeService.getEmployeeByEmployeeId(this.selectedEmployeeId);
    if (employee) {
      this.selectedEmployee = employee;
      await this.getAutoCalculationResult();
    } else {
      this.selectedEmployee = null;
      this.resetAutoCalculationResult();
      this.message = '従業員情報が見つかりませんでした';
    }
  }

  autoHealthInsuranceRequired: boolean = false;
  autoNursingCareInsuranceRequired: boolean = false;
  autoPensionInsuranceRequired: boolean = false;
  autoInsuranceGrade: number | undefined;
  //加入・等級の自動計算結果
  private async getAutoCalculationResult() {
    if (!this.selectedEmployee) {
      this.resetAutoCalculationResult();
      return;
    }

    //会社が特定適用か
    const isSpecificApplicableOffice = await this.companyService.isSpecificApplicableOffice();
    //保険加入の判定
    const insuranceRequired = this.employeeLogicService.isInsuranceRequired(this.selectedEmployee, isSpecificApplicableOffice);
    this.autoHealthInsuranceRequired = insuranceRequired.isHealthInsuranceRequired!;
    this.autoNursingCareInsuranceRequired = insuranceRequired.isNursingCareInsuranceRequired!;
    this.autoPensionInsuranceRequired = insuranceRequired.isPensionInsuranceRequired!;
    this.autoInsuranceGrade = undefined;
    //保険加入がある場合等級判定
    if (this.selectedEmployee.insurance?.healthInsurance?.joined) {

      let insuranceGrade: number | undefined;

      //取得した年と今が同一年で、現在が6月30日前の場合、算定基礎未計算のため対象外（入社字判定を適用）
      const year = new Date().getFullYear();
      const today = new Date();
      //今年の6月30日
      const juneThirty = new Date(year, 5, 30);
      if (this.selectedEmployee.insurance?.healthInsurance?.acquiredDate?.toDate().getFullYear() === year && today <= juneThirty) {
        insuranceGrade = await this.employeeLogicService.getInsuranceGradeAtNewEntry(this.selectedEmployee);
      } else {
        //固定費変更のペイロールあれば随時改定



        //固定費変更のペイロールなければこないだの算定基礎判定（これ下のやつだと年度違う！！！！）
        insuranceGrade = await this.employeeLogicService.getCalculationBase(this.selectedEmployee);
      }
      this.autoInsuranceGrade = insuranceGrade;
    }
  }

  private resetAutoCalculationResult() {
    this.autoHealthInsuranceRequired = false;
    this.autoNursingCareInsuranceRequired = false;
    this.autoPensionInsuranceRequired = false;
    this.autoInsuranceGrade = undefined;
  }

  getInsuranceStatus(insuranceDetail?: InsuranceDetail): string {
    if (!insuranceDetail) {
      return '未登録';
    }
    if (insuranceDetail.lostDate) {
      return '喪失';
    }
    return insuranceDetail.joined ? '加入' : '未加入';
  }

  editContractInfo() {
    console.log('editContractInfo');
  }

  editInsuranceInfo() {
    console.log('editInsuranceInfo');
  }

  editDependentInfo() {
    console.log('editDependentInfo');
  }

}