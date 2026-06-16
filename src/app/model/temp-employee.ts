import { Employee, EmployeeInsurance } from './employee';
import { Dependent } from './dependent';

/** 入社予定者（Employee登録前の一時データ） */
export type TempEmployee = Employee & {
  insurance?: EmployeeInsurance;
  tempDependents?: Partial<Dependent>[];
};
