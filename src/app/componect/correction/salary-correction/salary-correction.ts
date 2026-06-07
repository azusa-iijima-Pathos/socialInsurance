import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
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

  monthOptions = this.buildMonthOptions();
  selectedPayrollId = '';

  ngOnInit() {
    const previous = this.correctionLogicService.getPreviousWorkMonth();
    this.selectedPayrollId = this.correctionLogicService.getPayrollId(previous.year, previous.month);
  }

  private buildMonthOptions() {
    const working = getWorkingYearMonth();
    const workingKey = working.year * 12 + working.month;
    return this.correctionLogicService.getPastYearMonthOptions(12)
      .filter(option => option.year * 12 + option.month < workingKey);
  }

  onMonthChange() {
    // payrollId binding updates SalaryList via ngOnChanges
  }
}
