import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { EmployeeService } from '../../../service/Firestore/employee-service';
import { CommonService, MessageTimer } from '../../../service/common/common-service';
import { FormsModule, FormBuilder, Validators, ReactiveFormsModule } from '@angular/forms';
import { Employee, InsuranceDetail } from '../../../model/employee';
import { OfficeService } from '../../../service/Firestore/office-service';
import { EmployeeLogicService } from '../../../service/logic/employee-logic-service';
import { CompanyService } from '../../../service/Firestore/company-service';
import { ActivatedRoute } from '@angular/router';
import { DependentService } from '../../../service/Firestore/dependent-service';
import { Dependent } from '../../../model/dependent';
import { EmploymentCategory, LeaveType, WorkStyle, WorkStatus, WORK_STATUSES, LEAVE_TYPES, EMPLOYMENT_CATEGORIES, WORK_STYLES } from '../../../constants/model-constants';
import { UPDATE_MESSAGES } from '../../../constants/constants';

@Component({
  selector: 'app-employee-detail',
  imports: [CommonModule, FormsModule, ReactiveFormsModule],
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
  private fb = inject(FormBuilder);

  employeeMap = this.employeeService.allEmployeeNameMap;
  officeMap = this.officeService.allOfficeNameMap;

  WORK_STATUSES = WORK_STATUSES;
  LEAVE_TYPES = LEAVE_TYPES;
  EMPLOYMENT_CATEGORIES = EMPLOYMENT_CATEGORIES;
  WORK_STYLES = WORK_STYLES;

  selectedEmployeeId: string = '';
  selectedEmployee: Employee | null = null;

  dependents: Dependent[] = [];

  message: string = '';

  updateMessage: string = '';
  messageTimer: MessageTimer = null;

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

  isOpenContractInfoModal: boolean = false;
  contractForm = this.fb.group({
    workStatus: ['通常勤務', [Validators.required]],
    leaveTypes: [''],
    employmentContract: this.fb.group({
      employmentCategory: ['正社員', [Validators.required]],
      workStyle: ['フルタイム', [Validators.required]],
      officeId: ['', [Validators.required]],
      contractedWorkingHoursPerWeek: ['40', [Validators.required, Validators.min(0)]],
      contractedWorkingDaysPerMonth: ['20', [Validators.required, Validators.min(0)]],
    }),
  });
  editContractInfo() {
    this.isOpenContractInfoModal = true;
    this.contractForm.patchValue({
      workStatus: this.selectedEmployee?.workStatus!,
      leaveTypes: this.selectedEmployee?.leaveTypes!,
      employmentContract: {
        employmentCategory: this.selectedEmployee?.employmentContract?.employmentCategory!,
        workStyle: this.selectedEmployee?.employmentContract?.workStyle!,
        officeId: this.selectedEmployee?.employmentContract?.officeId!,
        contractedWorkingHoursPerWeek: this.selectedEmployee?.employmentContract?.contractedWorkingHoursPerWeek?.toString() ?? '',
        contractedWorkingDaysPerMonth: this.selectedEmployee?.employmentContract?.contractedWorkingDaysPerMonth?.toString() ?? '',
      },
    });
  }

  async contractInfoModalSubmit() {
    if (this.contractForm.invalid) {
      this.contractForm.markAllAsTouched();
      return;
    }
    const contractInfo: Partial<Employee> = {
      ...this.selectedEmployee,
      workStatus: this.contractForm.value.workStatus! as WorkStatus,
      leaveTypes: this.contractForm.value.leaveTypes! as LeaveType,
      employmentContract: {
        employmentCategory: this.contractForm.value.employmentContract?.employmentCategory! as EmploymentCategory,
        workStyle: this.contractForm.value.employmentContract?.workStyle! as WorkStyle,
        officeId: this.contractForm.value.employmentContract?.officeId!,
        contractedWorkingHoursPerWeek: Number(this.contractForm.value.employmentContract?.contractedWorkingHoursPerWeek),
        contractedWorkingDaysPerMonth: Number(this.contractForm.value.employmentContract?.contractedWorkingDaysPerMonth),
      },
    };
    const result = await this.employeeService.updateEmployee(contractInfo);
    if (!result) {
      this.commonService.showTimedMessage(UPDATE_MESSAGES.FAILED, value => this.updateMessage = value, this.messageTimer);
      return;
    }

    this.commonService.showTimedMessage(`社員ID：${this.selectedEmployeeId}　${this.commonService.getEmployeeName(this.selectedEmployeeId!)}さんの勤務状況・雇用契約情報を${UPDATE_MESSAGES.SUCCESS}`, value => this.updateMessage = value, this.messageTimer);
    await this.selectEmployee();
    this.closeContractInfoModal();
    return;
  }

  closeContractInfoModal() {
    this.isOpenContractInfoModal = false;
    this.contractForm.reset();
  }






    isOpenInsuranceInfoModal: boolean = false;
    isOpenDependentInfoModal: boolean = false;



  editInsuranceInfo() {
      this.isOpenInsuranceInfoModal = true;
    }

  editDependentInfo() {
      this.isOpenDependentInfoModal = true;
    }

  }