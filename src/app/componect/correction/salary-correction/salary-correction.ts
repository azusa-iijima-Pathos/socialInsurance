import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { CorrectionLogicService } from '../../../service/logic/correction-logic.service';
import { SalaryList } from '../../salary/salary-list/salary-list';
import { getWorkingYearMonth } from '../../../service/logic/event-id-service';
import { PayrollLockService } from '../../../service/Firestore/payroll-lock-service';

type MonthOption = {
  label: string;
  year: number;
  month: number;
  payrollId: string;
};

@Component({
  selector: 'app-salary-correction',
  imports: [CommonModule, FormsModule, SalaryList],
  templateUrl: './salary-correction.html',
  styleUrl: './salary-correction.css',
})
export class SalaryCorrection {

  private correctionLogicService = inject(CorrectionLogicService);
  private payrollLockService = inject(PayrollLockService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  mode = this.route.snapshot.queryParamMap.get('mode');
  isInitialMode = this.mode === 'initial';

  monthOptions: MonthOption[] = [];
  selectedPayrollId = '';

  async ngOnInit() {
    this.monthOptions = await this.buildMonthOptions();

    if (this.isInitialMode) {
      this.selectedPayrollId = this.monthOptions[0]?.payrollId ?? '';
      return;
    }

    const previous = this.correctionLogicService.getPreviousWorkMonth();
    this.selectedPayrollId = this.correctionLogicService.getPayrollId(previous.year, previous.month);
  }

  private async buildMonthOptions(): Promise<MonthOption[]> {
    if (this.isInitialMode) {
      return this.correctionLogicService.getMonthsBeforeWorkMonth(6);
    }

    const working = getWorkingYearMonth();
    const workingKey = working.year * 12 + working.month;
    const workingPayrollId = this.correctionLogicService.getPayrollId(working.year, working.month);
    const isWorkingMonthLocked = await this.payrollLockService.isPayrollLocked(workingPayrollId);

    return this.correctionLogicService.getPastYearMonthOptions(12)
      .filter(option => {
        const optionKey = option.year * 12 + option.month;
        if (optionKey < workingKey) return true;
        return optionKey === workingKey && isWorkingMonthLocked;
      });
  }

  onMonthChange() {
    // payrollId binding updates SalaryList via ngOnChanges
  }

  toWorkingMonthSetting() {
    this.router.navigate(['/employee-addInsurance'], { queryParams: { mode: 'initial', step: 'workingMonth' } });
  }

  toTop() {
    const result = confirm('初期設定を完了しトップ画面に遷移します。よろしいですか？');
    if (!result) {
      return;
    }
    this.router.navigate(['/top-for-manage']);
  }
}
