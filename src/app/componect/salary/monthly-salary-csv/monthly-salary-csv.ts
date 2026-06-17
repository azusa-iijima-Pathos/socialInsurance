import { Component, EventEmitter, inject, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { createEmployeeCsvTemplateCsv } from '../../../CSVtemplate/monthlySalaryDate-import';
import { AddMonthlySalaryByCSVService, CsvMonthlySalaryPreviewRow } from '../../../service/CSV/addMonthlySalaryByCSV-service';
import { CommonService, MessageTimer } from '../../../service/common/common-service';
import { PayrollService } from '../../../service/Firestore/payroll-service';

@Component({
  selector: 'app-monthly-salary-csv',
  imports: [CommonModule],
  templateUrl: './monthly-salary-csv.html',
  styleUrl: './monthly-salary-csv.css',
})
export class MonthlySalaryCSV {

  @Input() payrollId = '';
  @Input() inputFormat: 1 | 2 = 2;
  @Input() fileInputId = 'monthlySalaryCsvFile';
  @Output() payrollRegistered = new EventEmitter<void>();
  selectedCsvFile: File | null = null;
  selectedCsvFileName = '';
  csvImportMessage = '';
  csvMessageTimer: MessageTimer = null;
  csvPreviewRows: CsvMonthlySalaryPreviewRow[] = [];
  csvPreviewModalOpen = false;

  private commonService = inject(CommonService);
  private addMonthlySalaryByCSVService = inject(AddMonthlySalaryByCSVService);
  private payrollService = inject(PayrollService);

  downloadCsvTemplate() {
    const csv = createEmployeeCsvTemplateCsv(this.inputFormat);
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'monthly-salary-template.csv';
    link.click();
    URL.revokeObjectURL(url);
  }

  onCsvFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    input.value = '';
    this.csvPreviewRows = [];
    this.csvPreviewModalOpen = false;

    if (!file) {
      this.selectedCsvFileName = '';
      this.selectedCsvFile = null;
      this.setCsvImportStatus('CSVファイルが選択されていません');
      return;
    }

    this.selectedCsvFileName = file.name;
    this.selectedCsvFile = file;
    this.setCsvImportStatus('');
  }

  async importCsv() {
    if (!this.selectedCsvFile) {
      this.setCsvImportStatus('CSVファイルを選択してください');
      return;
    }

    this.csvPreviewRows = [];
    this.csvPreviewModalOpen = false;
    this.setCsvImportStatus('CSV内容を確認中です');
    try {
      const result = await this.addMonthlySalaryByCSVService.previewCsv(this.selectedCsvFile, this.inputFormat, this.payrollId);
      this.csvPreviewRows = result.rows;
      this.csvPreviewModalOpen = result.rows.length > 0;
      this.setCsvImportStatus(result.message);
    } catch (error) {
      console.error(error);
      this.setCsvImportStatus('CSV内容の確認に失敗しました');
    }
  }

  setCsvPreviewRowSelected(row: CsvMonthlySalaryPreviewRow, checked: boolean) {
    row.selected = checked;
  }

  async registerSelectedCsvRows() {
    this.setCsvImportStatus('選択された給与・勤務実績を登録中です');
    try {
      const result = await this.addMonthlySalaryByCSVService.registerPreviewRows(this.csvPreviewRows);
      await this.payrollService.getAllPayrollListForMonth(this.payrollId, true);
      this.csvPreviewModalOpen = false;
      this.setCsvImportStatus(result.message);
      this.payrollRegistered.emit();
    } catch (error) {
      console.error(error);
      this.setCsvImportStatus('チェックした給与・勤務実績の登録に失敗しました');
    }
  }

  selectedCsvPreviewCount() {
    return this.csvPreviewRows.filter(row => row.selected && row.canRegister).length;
  }

  selectAllCsvPreviewRows() {
    this.csvPreviewRows.forEach(row => {
      if (row.canRegister) {
        row.selected = true;
      }
    });
  }

  clearAllCsvPreviewRows() {
    this.csvPreviewRows.forEach(row => {
      row.selected = false;
    });
  }

  closeCsvPreviewModal() {
    this.csvPreviewModalOpen = false;
  }

  private setCsvImportStatus(message: string) {
    this.csvMessageTimer = this.commonService.showTimedMessage(message, value => this.csvImportMessage = value, this.csvMessageTimer);
  }



}
