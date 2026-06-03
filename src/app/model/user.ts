import { Timestamp } from "@angular/fire/firestore";
import { Permission } from "../constants/model-constants";
 
 /**
 * ユーザ情報
 */
export type User = {

    /** 認証ユーザID（DocIdとして使用） */
    uid: string;
  
    /** 社員ID */
    employeeId?: string;
  
    /** 会社ID */
    companyId?: string;
  
    /** 権限 */
    permission?: Permission;
  
    /** 作成日 */
    createdAt?: Timestamp;
  
    /** 更新日 */
    updatedAt?: Timestamp;
  };
  