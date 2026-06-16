import { Component, inject, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DependentsCsvService, CsvDependentPreviewRow } from '../../../service/logic/dependents-csv';
import { CommonService, MessageTimer } from '../../../service/common/common-service';

@Component({
  selector: 'app-add-dependents-csv',
  imports: [CommonModule],
  templateUrl: './add-dependents-csv.html',
  styleUrl: './add-dependents-csv.css',
})
export class AddDependentsCSV {

  registered = output<void>();

  private dependentsCsvService = inject(DependentsCsvService);
  private commonService = inject(CommonService);

  selectedCsvFile: File | null = null;
  selectedCsvFileName = '';
  csvImportMessage = '';
  csvMessageTimer: MessageTimer = null;
  csvPreviewRows: CsvDependentPreviewRow[] = [];
  csvPreviewModalOpen = false;

  downloadCsvTemplate() {
    const csv = this.dependentsCsvService.createCsvTemplate();
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'dependents-template.csv';
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
      const result = await this.dependentsCsvService.previewCsv(this.selectedCsvFile);
      this.csvPreviewRows = result.rows;
      this.csvPreviewModalOpen = result.rows.length > 0;
      this.setCsvImportStatus(result.message);
    } catch (error) {
      console.error(error);
      this.setCsvImportStatus('CSV内容の確認に失敗しました');
    }
  }

  setCsvPreviewRowSelected(row: CsvDependentPreviewRow, checked: boolean) {
    row.selected = checked;
  }

  async registerSelectedCsvRows() {
    this.setCsvImportStatus('選択された扶養情報を登録中です');
    try {
      const result = await this.dependentsCsvService.registerPreviewRows(this.csvPreviewRows);
      this.csvPreviewModalOpen = false;
      this.setCsvImportStatus(result.message);
      if (result.success) {
        this.registered.emit();
      }
    } catch (error) {
      console.error(error);
      this.setCsvImportStatus('チェックした扶養情報の登録に失敗しました');
    }
  }

  selectedCsvPreviewCount() {
    return this.csvPreviewRows.filter(row => row.selected && row.canRegister).length;
  }

  selectAllCsvPreviewRows() {
    this.csvPreviewRows.forEach(row => {
      if (row.canRegister) row.selected = true;
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
    this.csvMessageTimer = this.commonService.showTimedMessage(
      message,
      value => this.csvImportMessage = value,
      this.csvMessageTimer,
    );
  }
}
