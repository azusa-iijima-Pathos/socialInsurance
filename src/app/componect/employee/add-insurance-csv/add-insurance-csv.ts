import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
// CSVの解析や登録を行うバックエンドサービスと、プレビュー行の型定義をインポート
import { AddInsuranceCsv as AddInsuranceCsvService, CsvInsurancePreviewRow } from '../../../service/CSV/add-insurance-csv';
// 共通処理サービス（メッセージタイマーの型など）をインポート
import { CommonService, MessageTimer } from '../../../service/common/common-service';

@Component({
  selector: 'app-add-insurance-csv', // HTMLで呼び出す際のコンケープタグ名を定義
  imports: [CommonModule],            // テンプレート内で Angular の共通ディレクティブ（*ngIfなど）を使えるように指定
  templateUrl: './add-insurance-csv.html', // 紐づくHTMLファイルのパス
  styleUrl: './add-insurance-csv.css',     // 紐づくCSSファイルのパス
})
export class AddInsuranceCsv {

  // 依存するCSVインポート処理用のサービスを注入（インジェクション）
  private addInsuranceCsvService = inject(AddInsuranceCsvService);
  // 依存する共通ユーティリティサービスを注入
  private commonService = inject(CommonService);

  // ユーザーが選択した生のCSVファイルオブジェクトを保持（未選択時はnull）
  selectedCsvFile: File | null = null;
  // 選択されたCSVファイルのファイル名を画面表示用に保持
  selectedCsvFileName = '';
  // 画面に表示するインポート処理の進捗ステータスや結果のメッセージ
  csvImportMessage = '';
  // メッセージを一定時間後に自動消去するためのタイマー管理オブジェクト
  csvMessageTimer: MessageTimer = null;
  // CSVを解析した結果、画面のモーダル内に一覧表示する行データの配列
  csvPreviewRows: CsvInsurancePreviewRow[] = [];
  // プレビュー確認用のポップアップ（モーダル）を開くかどうかの制御フラグ
  csvPreviewModalOpen = false;

  // 登録用のテンプレートCSVファイルを生成し、ブラウザにダウンロードさせる処理
  downloadCsvTemplate() {
    // サービス側からCSVのヘッダー文字列データを取得
    const csv = this.addInsuranceCsvService.createCsvTemplate();
    // Excelでの日本語文字化けを防ぐため、BOM（\uFEFF）を付与してBlob（バイナリ）オブジェクトを生成
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    // Blobに対する一時的なダウンロード用URLを発行
    const url = URL.createObjectURL(blob);
    // 擬似的にインラインの <a> タグ（リンク要素）を作成
    const link = document.createElement('a');
    // 作成した <a> タグの遷移先にBlobのURLを設定
    link.href = url;
    // ダウンロードされる際のデフォルトファイル名を指定
    link.download = 'insurance-info-template.csv';
    // <a> タグをプログラムから擬似的にクリックしてダウンロードを実行
    link.click();
    // 使用が終わったメモリ上のBlob用URLを解放
    URL.revokeObjectURL(url);
  }

  //古いデータをきれいに片付け、新しく選ばれたファイルが正常なものかチェックして、次のステップ（解析）へ引き渡す準備をする
  onCsvFileSelected(event: Event) {
    // イベントが発生したHTML要素を input要素の型としてキャスト
    const input = event.target as HTMLInputElement;
    // 選択されたファイルの一覧から先頭の1件を取得（選択がない場合はnull）
    const file = input.files?.[0] ?? null;
    // 同じファイルを再度選択し直してもイベントが検知できるよう、要素の選択値をリセット
    input.value = '';
    // 新しいファイルが選ばれたため、古いプレビュー用データをクリア
    this.csvPreviewRows = [];
    // 新しいファイルが選ばれたため、確認モーダルを一旦閉じる
    this.csvPreviewModalOpen = false;

    // もしファイルが正しく選択されていなかった場合のガード処理
    if (!file) {
      // 保持していたファイル名をクリア
      this.selectedCsvFileName = '';
      // 保持していたファイルオブジェクトをクリア
      this.selectedCsvFile = null;
      // 画面のステータスメッセージに警告文を設定して処理を終了
      this.setCsvImportStatus('CSVファイルが選択されていません');
      return;
    }

    // 選択されたファイルの名称を変数に保存
    this.selectedCsvFileName = file.name;
    // 選択されたファイルオブジェクトを後続処理のために変数に保存
    this.selectedCsvFile = file;
    // エラーメッセージをクリア
    this.setCsvImportStatus('');
  }

  // 「取り込み」ボタンを押した際、CSVを解析してプレビューを表示する処理
  async importCsv() {
    // ファイルがまだ選択されていない場合の防衛処理
    if (!this.selectedCsvFile) {
      // 画面にファイル選択を促す警告メッセージを設定して終了
      this.setCsvImportStatus('CSVファイルを選択してください');
      return;
    }

    // 以前のプレビュー配列をリセット
    this.csvPreviewRows = [];
    // 以前のモーダル表示状態をリセット
    this.csvPreviewModalOpen = false;
    // 画面のステータス表示を「確認中」に変更
    this.setCsvImportStatus('CSV内容を確認中です');
    try {
      // サービスを呼び出してCSVファイルのパースとデータバリデーション（検証）を非同期実行
      const result = await this.addInsuranceCsvService.previewCsv(this.selectedCsvFile);
      // 解析・検証された行データをプレビュー用の配列に格納
      this.csvPreviewRows = result.rows;
      // エラーが無く、有効なデータ行が1件以上存在する場合にのみプレビューモーダルを開く
      this.csvPreviewModalOpen = result.rows.length > 0;
      // サービスから返ってきた処理結果メッセージ（「○件チェック完了」など）を画面に表示
      this.setCsvImportStatus(result.message);
    } catch (error) {
      // エラーが発生した場合は開発者コンソールにログを出力
      console.error(error);
      // 画面上のメッセージに検証失敗の旨を表示
      this.setCsvImportStatus('CSV内容の確認に失敗しました');
    }
  }

  // プレビュー画面で、個々の行のチェックボックスが操作された時の状態同期処理
  setCsvPreviewRowSelected(row: CsvInsurancePreviewRow, checked: boolean) {
    // 対象行データの「selected（選択中）」フラグをチェック状態（true/false）に書き換え
    row.selected = checked;
  }

  // プレビュー画面でチェックを入れたデータを最終確定し、DBへ登録する処理
  async registerSelectedCsvRows() {
    // 画面上のステータス表示を「登録中」に変更
    this.setCsvImportStatus('選択された保険情報を登録中です');
    try {
      // チェックがついた有効な行データのみをDB（Firestore等）へ一括登録する処理をサービス経由で実行
      const result = await this.addInsuranceCsvService.registerPreviewRows(this.csvPreviewRows);
      // 登録作業が終わったため、プレビューモーダルを閉じる
      this.csvPreviewModalOpen = false;
      // サービスから返ってきた最終的な登録完了メッセージを画面に表示
      this.setCsvImportStatus(result.message);
    } catch (error) {
      // 例外が発生した場合はコンソールにエラー詳細を出力
      console.error(error);
      // 画面上のメッセージに登録失敗の旨を表示
      this.setCsvImportStatus('チェックした保険情報の登録に失敗しました');
    }
  }

  // 現在プレビューモーダル内で「チェックが入っている」かつ「システム登録が可能な状態」のデータ件数をカウントする関数
  selectedCsvPreviewCount() {
    // 配列から「selected が true」かつ「canRegister が true」のデータ行のみを絞り込んでその総数を返す
    return this.csvPreviewRows.filter(row => row.selected && row.canRegister).length;
  }

  // プレビュー画面で、登録可能なデータ行すべてに一括でチェックを入れる（全選択）処理
  selectAllCsvPreviewRows() {
    // プレビュー配列の全行をループ処理
    this.csvPreviewRows.forEach(row => {
      // データに不備がなく、登録許可（canRegister）が出ている行のみを対象にする
      if (row.canRegister) {
        // 対象行を選択状態（true）にする
        row.selected = true;
      }
    });
  }

  // プレビュー画面で、すべての行のチェックボックスを外す（全解除）処理
  clearAllCsvPreviewRows() {
    // プレビュー配列の全行の selected フラグを一律で false に書き換える
    this.csvPreviewRows.forEach(row => {
      row.selected = false;
    });
  }

  // プレビューモーダルを閉じるためのイベント関数
  closeCsvPreviewModal() {
    // モーダルの開閉フラグを false にして画面上から非表示にする
    this.csvPreviewModalOpen = false;
  }

  // 画面にメッセージを表示しつつ、古いタイマーを消して新しく時間差消去を設定する共通管理メソッド
  private setCsvImportStatus(message: string) {
    // 共通サービスを呼び出し、数秒後に自動で文字が消えるタイマー処理をセットして、タイマーの参照を更新
    this.csvMessageTimer = this.commonService.showTimedMessage(message, value => this.csvImportMessage = value, this.csvMessageTimer);
  }
}