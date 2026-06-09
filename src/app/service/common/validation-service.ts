import { inject, Injectable } from '@angular/core';
import { AbstractControl, FormGroup, ValidationErrors } from '@angular/forms';
import { CompanyService } from '../Firestore/company-service';
import { EmployeeService } from '../Firestore/employee-service';
import { Employee } from '../../model/employee';
import { OfficeService } from '../Firestore/office-service';
import { UserService } from '../Firestore/user-service';
import { User } from '../../model/user';

@Injectable({
  providedIn: 'root',
})
export class ValidationService {

  private companyService = inject(CompanyService);
  private employeeService = inject(EmployeeService);
  private officeService = inject(OfficeService);
  private userService = inject(UserService);

  /** 会社名のバリデーション */
  validateCompanyName = async (control: AbstractControl): Promise<ValidationErrors | null> => {
    const companyName = control.value;
    if (!companyName || companyName === '') {
      return null;
    }
    const allCompanyNames: string[] = await this.companyService.getAllCompanyName();
    if (!allCompanyNames.includes(companyName)) {
      return null;
    } else {
      return { companyNameAlreadyExists: true };
    }
  }

  /** 入力された会社IDが登録されているか */
  correctCompanyId = async (control: AbstractControl): Promise<ValidationErrors | null> => {
    const companyId = control.value;
    if (!companyId || companyId === '') {
      return null;
    }
    const allCompanyIds: string[] = await this.companyService.getAllCompanyID();
    if (!allCompanyIds.includes(companyId)) {
      return { companyIncorrect: true };
    }
    return null;
  }

  /** 入力された社員IDが登録されているか */
  correctEmployeeId = async (control: AbstractControl): Promise<ValidationErrors | null> => {
    const employeeId = control.value;
    if (!employeeId || employeeId === '') {
      return null;
    }
    await this.employeeService.getAllEmployees();
    const allEmployeeIds: string[] = this.employeeService.allEmployeeIDs();
    if (!allEmployeeIds.includes(employeeId)) {
      return { employeeIdIncorrect: true };
    }
    return null;
  }

  /** 従業員IDの重複チェック */
  validateEmployeeId = async (control: AbstractControl): Promise<ValidationErrors | null> => {
    const employeeId = control.value;
    if (!employeeId || employeeId === '') {
      return null;
    }
    const allEmployeeIds: string[] = this.employeeService.allEmployeeIDs();
    if (!allEmployeeIds.includes(employeeId)) {
      return null;
    }
    return { employeeIdAlreadyExists: true };
  }


  /** 事業所名の重複チェック */
  validateOfficeName = async (control: AbstractControl): Promise<ValidationErrors | null> => {
    const officeName = control.value;
    if (!officeName || officeName === '') {
      return null;
    }
    const allOfficeNames: string[] = Object.values(this.officeService.allOfficeNameMap());

    if (!allOfficeNames.includes(officeName)) {
      return null;
    }
    return { officeNameAlreadyExists: true };
  }


  // /** 事業所IDの存在チェック（システムが付けるから不要） */
  // validateOfficeId = async (control: AbstractControl): Promise<ValidationErrors | null> => {
  //   const officeId = control.value;
  //   if (!officeId || officeId === '') {
  //     return null;
  //   }
  //   const allOfficeIds: string[] = this.officeService.allOfficeIDs();
  //   if (!allOfficeIds.includes(officeId)) {
  //     return { officeIdIncorrect: true };
  //   }
  //   return null;
  // }

  /** 社員連携登録バリデーション */
  validateEmployee = async (control: AbstractControl): Promise<ValidationErrors | null> => {
    const companyId = control.get('companyId')?.value;
    const employeeId = control.get('employeeId')?.value;
    const firstName = control.get('firstName')?.value;
    const lastName = control.get('lastName')?.value;
    const birthDate = control.get('birthDate')?.value;
    if (!companyId || companyId === '' || !employeeId || employeeId === '' || !firstName || firstName === '' || !lastName || lastName === '' || !birthDate || birthDate === '') {
      return null;
    }
    //会社IDと社員IDをもとに社員情報を取得
    const employee: Employee | null = await this.employeeService.getEmployeeByCompanyIdAndEmployeeId(companyId, employeeId);
    //社員情報が取得できない場合はエラー
    if (!employee) {
      console.log('社員情報が取得できない');
      return { employeeIncorrect: true };
    }

    //すでに他のユーザが該当の会社IDと社員IDを使用している場合はエラー
    const users: User[] = await this.userService.getUsersByCompanyId(companyId);
    const user = users.find(user => user.employeeId === employeeId);
    if (user) {
      console.log('すでに他のユーザが該当の会社IDと社員IDを使用している');
      return { employeeIncorrect: true };
    }

    //社員情報が取得できた場合は名前と生年月日が一致しているかチェック
    const date = employee.birthDate?.toDate();

    const employeeBirthDate =
      `${date!.getFullYear()}-${String(date!.getMonth() + 1).padStart(2, '0')}-${String(date!.getDate()).padStart(2, '0')}`;

    if (employee.firstName === firstName && employee.lastName === lastName && employeeBirthDate === birthDate) {
      return null;
    } else {
      console.log(employee.firstName, employee.lastName, employeeBirthDate, birthDate);
      console.log('名前と生年月日が一致していない');
      return { employeeIncorrect: true };
    }
  }

  /** 生年月日のバリデーション */
  birthDateValidator = (control: AbstractControl): ValidationErrors | null => {
    const value = control.value;
    if (!value) return null;

    const inputDate = new Date(`${value}T00:00:00`);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return inputDate >= today ? { invalidBirthDate: true } : null;
  };

  /** 扶養行の一部だけ入力された場合、残りの項目も必須にする */
  requiredIfAnyDependentFieldEntered = (control: AbstractControl): ValidationErrors | null => {
    const parent = control.parent;
    if (!parent) return null;

    const name = parent.get('name')?.value;
    const birthDate = parent.get('birthDate')?.value;
    const relationship = parent.get('relationship')?.value;
    const hasAnyValue = Boolean(name || birthDate || relationship);

    return hasAnyValue && !control.value ? { required: true } : null;
  };

  /** 扶養行の入力変更時に、同じ行の他項目も再検証する */
  refreshDependentRowValidation(group: FormGroup): void {
    (['name', 'birthDate', 'relationship'] as const).forEach(fieldName => {
      group.get(fieldName)?.updateValueAndValidity({ emitEvent: false });
    });
  }

  /** 勤務実績があるのに給与・支給額がない場合のバリデーション */
  validateSalaryNumber = (control: AbstractControl): ValidationErrors | null => {
    const workingDays = control.get('actualWorkingDays')?.value;
    const actualPaymentAmount = control.get('actualPaymentAmount')?.value;

    if (workingDays === null || workingDays === undefined || actualPaymentAmount === null || actualPaymentAmount === undefined) {
      return null;
    }

    if (workingDays > 0 && actualPaymentAmount === 0) {
      return { invalidSalary: true };
    }

    return null;
  }

  /** 勤務時間・日時 */
  validateWorkingHoursAndDays = (control: AbstractControl): ValidationErrors | null => {
    const workingHours = control.get('actualWorkingHours')?.value;
    const workingDays = control.get('actualWorkingDays')?.value;
    if (workingHours === null || workingHours === undefined || workingDays === null || workingDays === undefined) {
      return null;
    }

    /** 勤務時間があるのに勤務日数が0の場合 */
    if (workingHours > 0 && workingDays === 0) {
      return { invalidWorkingDays: true };
    }
    /** 勤務日数があるのに勤務時間が0の場合 */
    if (workingDays > 0 && workingHours === 0) {
      return { invalidWorkingHours: true };
    }
    return null;
  }

  /** 総支給額が固定給を下回らないようにバリデーション */
  validatePaymentAmount = (control: AbstractControl): ValidationErrors | null => {
    const fixedSalary = control.get('fixedSalary')?.value;
    const actualPaymentAmount = control.get('actualPaymentAmount')?.value;
    if (fixedSalary === null || fixedSalary === undefined || actualPaymentAmount === null || actualPaymentAmount === undefined) {
      return null;
    }
    if (actualPaymentAmount < fixedSalary) {
      return { invalidActualPaymentAmount: true };
    }
    return null;
  }

















}
