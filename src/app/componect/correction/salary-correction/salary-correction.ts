import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { CorrectionLogicService } from '../../../service/logic/correction-logic.service';
import { SalaryList } from '../../salary/salary-list/salary-list';
import { getWorkingYearMonth } from '../../../service/logic/event-id-service';

@Component({
  selector: 'app-salary-correction',
  imports: [CommonModule, FormsModule, SalaryList],
  templateUrl: './salary-correction.html',
  styleUrl: './salary-correction.css',
})
export class SalaryCorrection {

  private correctionLogicService = inject(CorrectionLogicService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  mode = this.route.snapshot.queryParamMap.get('mode');
  isInitialMode = this.mode === 'initial';

  monthOptions = this.buildMonthOptions();
  selectedPayrollId = '';

  ngOnInit() {
    if (this.isInitialMode) {
      this.selectedPayrollId = this.monthOptions[0]?.payrollId ?? '';
      return;
    }

    const previous = this.correctionLogicService.getPreviousWorkMonth();
    this.selectedPayrollId = this.correctionLogicService.getPayrollId(previous.year, previous.month);
  }

  private buildMonthOptions() {
    if (this.isInitialMode) {
      return this.correctionLogicService.getMonthsBeforeWorkMonth(6);
    }

    const working = getWorkingYearMonth();
    const workingKey = working.year * 12 + working.month;
    return this.correctionLogicService.getPastYearMonthOptions(12)
      .filter(option => option.year * 12 + option.month < workingKey);
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
