import { Routes } from '@angular/router';
import { Login } from './componect/account/login/login';
import { Register } from './componect/account/register/register';
import { ForgotPW } from './componect/account/forgot-pw/forgot-pw';
import { UserForm } from './componect/account/initial-setting/user-form/user-form';
import { CompanyForm } from './componect/account/initial-setting/company-form/company-form';
import { EmployeeForm } from './componect/account/initial-setting/employee-form/employee-form';
import { OfficeForm } from './componect/account/initial-setting/office-form/office-form';
import { CompanyConfirm } from './componect/account/initial-setting/company-confirm/company-confirm';
import { TopForManage } from './componect/top/topForManage';
import { Setting } from './componect/company/setting/setting';
import { MonthlySalary } from './componect/salary/monthly-salary/monthly-salary';
import { Bonus } from './componect/salary/bonus/bonus';
import { EmployeeDetail } from './componect/employee/employee-detail/employee-detail';
import { AddInsuranceInfo } from './componect/employee/add-insurance-info/add-insurance-info';
import { InsuranceConfirm } from './componect/insurance/insurance-confirm/insurance-confirm';
import { PermissionSetting } from './componect/company/permission-setting/permission-setting';
import { InsuranceForBonus } from './componect/insurance/insurance-for-bonus/insurance-for-bonus';
import { CalculationBasePendingList } from './componect/calculation/calculation-base-pending-list/calculation-base-pending-list';
import { HireEntry } from './componect/employee/hire-entry/hire-entry';
import { RetireEntry } from './componect/employee/retire-entry/retire-entry';
import { ReachAge } from './componect/employee/reach-age/reach-age';
import { SystemApplicationList } from './componect/employee/system-application-list/system-application-list';
import { TopForEmployee } from './componect/top/top-for-employee/top-for-employee';
import { CompanyDetail } from './componect/company/company-detail/company-detail';
import { OfficeDetail } from './componect/office/office-detail/office-detail';
import { LifeeventApplication } from './componect/ForEmployee/lifeevent-application/lifeevent-application';
import { MyInsuranceDetail } from './componect/ForEmployee/my-insurance-detail/my-insurance-detail';
import { MyApplication } from './componect/ForEmployee/my-application/my-application';
import { RetroactiveCorrection } from './componect/correction/retroactive-correction/retroactive-correction';
import { SalaryCorrection } from './componect/correction/salary-correction/salary-correction';
import { BonusCorrection } from './componect/correction/bonus-correction/bonus-correction';
import { CorrectionList } from './componect/correction/correction-list/correction-list';
import { authGuard, companyGuard, initialSettingGuard } from './service/common/guard/auth-guard';

export const routes: Routes = [
    { path: '', redirectTo: 'login', pathMatch: 'full' },
    { path: 'login', component: Login, title: 'ログイン ｜ 社会保険管理システム' },
    { path: 'register', component: Register, title: '新規登録 ｜ 社会保険管理システム' },
    { path: 'forgot-password', component: ForgotPW, title: 'パスワードリセット ｜ 社会保険管理システム' },

    //ログイン後のみ
    { path: 'initial-setting/user-form', component: UserForm, title: 'ユーザ情報初期登録 ｜ 社会保険管理システム', canActivate: [authGuard] },
    { path: 'initial-setting/company-form', component: CompanyForm, title: '会社情報初期登録 ｜ 社会保険管理システム', canActivate: [authGuard] },

    { path: 'top-for-employee', component: TopForEmployee, title: 'トップ ｜ 社会保険管理システム', canActivate: [authGuard] },
    { path: 'company-detail', component: CompanyDetail, title: '会社情報 ｜ 社会保険管理システム', canActivate: [authGuard] },
    { path: 'lifeevent-application', component: LifeeventApplication, title: 'ライフイベント申請 ｜ 社会保険管理システム', canActivate: [authGuard] },
    { path: 'my-insurance-detail', component: MyInsuranceDetail, title: '登録情報 ｜ 社会保険管理システム', canActivate: [authGuard] },
    { path: 'my-application', component: MyApplication, title: '申請内容一覧 ｜ 社会保険管理システム', canActivate: [authGuard] },

    //会社情報初期登録後 セッションにUIDがあるかとトップ権限か確認して遷移
    {
        path: 'initial-setting/:companyId/company-confirm', component: CompanyConfirm, title: '会社情報登録内容確認 ｜ 社会保険管理システム',
        canActivate: [initialSettingGuard, companyGuard], data: { permission: '管理' }
    },
    {
        path: 'initial-setting/:companyId/office-form', component: OfficeForm, title: '事業所情報初期登録 ｜ 社会保険管理システム',
        canActivate: [initialSettingGuard, companyGuard], data: { permission: '管理' }
    },
    {
        path: 'initial-setting/:companyId/employee-form', component: EmployeeForm, title: '社員情報初期登録 ｜ 社会保険管理システム',
        canActivate: [initialSettingGuard, companyGuard], data: { permission: '管理' }
    },

    //メイン機能 (権限：管理、承認)
    {
        path: 'top-for-manage', component: TopForManage, title: 'トップ ｜ 社会保険管理システム',
        canActivate: [authGuard, companyGuard], data: { permission: '承認' }
    },
    {
        path: 'monthly-salary/:workingYear/:workingMonth', component: MonthlySalary, title: '給与・勤務実績登録 ｜ 社会保険管理システム',
        canActivate: [authGuard, companyGuard], data: { permission: '承認' }
    },
    {
        path: 'bonus/:payrollId', component: Bonus, title: '賞与登録 ｜ 社会保険管理システム',
        canActivate: [authGuard, companyGuard], data: { permission: '承認' }
    },
    {
        path: 'office-detail', component: OfficeDetail, title: '事業所情報 ｜ 社会保険管理システム',
        canActivate: [authGuard, companyGuard], data: { permission: '承認' }
    },

    //権限：管理のみ
    { path: 'company-setting', component: Setting, title: '会社設定 ｜ 社会保険管理システム',
        canActivate: [authGuard, companyGuard], data: { permission: '管理' }
     },
    { path: 'permission-setting', component: PermissionSetting, title: '従業員権限設定 ｜ 社会保険管理システム' ,
        canActivate: [authGuard, companyGuard], data: { permission: '管理' }
    },

    //権限：承認と管理のみ
    { path: 'employee-detail', component: EmployeeDetail, title: '社員情報詳細 ｜ 社会保険管理システム' ,
        canActivate: [authGuard, companyGuard], data: { permission: '承認' }
    },
    { path: 'employee-addInsurance', component: AddInsuranceInfo, title: '社員保険情報追加 ｜ 社会保険管理システム' ,
        canActivate: [authGuard, companyGuard], data: { permission: '承認' }
    },
    { path: 'employee-hire-entry', component: HireEntry, title: '入社処理 ｜ 社会保険管理システム' ,
        canActivate: [authGuard, companyGuard], data: { permission: '承認' }
    },
    { path: 'employee-retire-entry', component: RetireEntry, title: '退社処理 ｜ 社会保険管理システム' ,
        canActivate: [authGuard, companyGuard], data: { permission: '承認' }
    },
    { path: 'insurance-confirm/:workingYear/:workingMonth', component: InsuranceConfirm, title: '作業月保険料確認 ｜ 社会保険管理システム' ,
        canActivate: [authGuard, companyGuard], data: { permission: '承認' }
    },
    { path: 'insurance-for-bonus/:payrollId', component: InsuranceForBonus, title: '賞与保険料確認 ｜ 社会保険管理システム' ,
        canActivate: [authGuard, companyGuard], data: { permission: '承認' }
    },
    { path: 'calculation-base-pending-list', component: CalculationBasePendingList, title: '算定基礎反映待ち一覧 ｜ 社会保険管理システム' ,
        canActivate: [authGuard, companyGuard], data: { permission: '承認' }
    },
    { path: 'reach-age', component: ReachAge, title: '年齢到達一括検索 ｜ 社会保険管理システム' ,
        canActivate: [authGuard, companyGuard], data: { permission: '承認' }
    },
    { path: 'system-application-list', component: SystemApplicationList, title: '今月の申請一覧（システム） ｜ 社会保険管理システム' ,
        canActivate: [authGuard, companyGuard], data: { permission: '承認' }
    },
    { path: 'retroactive-correction', component: RetroactiveCorrection, title: '遡及修正 ｜ 社会保険管理システム' ,
        canActivate: [authGuard, companyGuard], data: { permission: '承認' }
    },

    { path: '**', redirectTo: '/login' }
];
