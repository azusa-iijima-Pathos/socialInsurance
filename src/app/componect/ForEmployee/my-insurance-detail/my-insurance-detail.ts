import { Component, inject } from '@angular/core';
import { Employee } from '../../../model/employee';
import { Dependent } from '../../../model/dependent';
import { EmployeeService } from '../../../service/Firestore/employee-service';
import { DependentService } from '../../../service/Firestore/dependent-service';
import { Router } from '@angular/router';
import { CommonService } from '../../../service/common/common-service';
import { CommonModule } from '@angular/common';


@Component({
  selector: 'app-my-insurance-detail',
  imports: [CommonModule],
  templateUrl: './my-insurance-detail.html',
  styleUrl: './my-insurance-detail.css',
})
export class MyInsuranceDetail {

  private employeeService = inject(EmployeeService);
  private dependentService = inject(DependentService);
  private router = inject(Router);
  commonService = inject(CommonService);

loginEmployeeId = sessionStorage.getItem('loginEmployeeId') ?? '';
employee: Employee | null = null;
dependents: Dependent[] = [];

async ngOnInit() {
  this.employee = await this.employeeService.getEmployeeByEmployeeId(this.loginEmployeeId);
  this.dependents = await this.dependentService.getDependents(this.loginEmployeeId);
  
  if(!this.employee) {
    this.router.navigate(['/login']);
  }
}

showStatus(type: 'healthInsurance' | 'nursingCareInsurance' | 'employeePensionInsurance'): string {
  const insurance = this.employee?.insurance?.[type];
  if(insurance?.joined){
    return '加入';
  }else if(insurance?.lostDate){
    return '喪失';
  }
  return '未加入';
}

}
