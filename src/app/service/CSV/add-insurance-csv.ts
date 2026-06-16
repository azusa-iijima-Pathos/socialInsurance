import { inject, Injectable } from '@angular/core';
import { Timestamp } from '@angular/fire/firestore';
import Papa from 'papaparse'; // CSVを安全かつ高速にパース（解析）する外部ライブラリをインポート
import { EmployeeInsurance, InsuranceDetail } from '../../model/employee';
import { EmployeeService } from '../Firestore/employee-service';
import { UPDATE_MESSAGES } from '../../constants/constants';
import { DependentService } from '../Firestore/dependent-service';
import { Dependent } from '../../model/dependent';

// 保険の分類を定義（健康保険、介護保険、厚生年金）
type InsuranceName = 'healthInsurance' | 'nursingCareInsurance' | 'employeePensionInsurance';
// CSV上の加入ステータス（1:加入、0:未加入、2:喪失）に対応する型
type InsuranceCsvStatus = 'joined' | 'notJoined' | 'lost';
// PapaParseがパースした、CSVの「1行分のデータ（キーと値のペア）」を表す型
type CsvRow = Record<string, unknown>;

// CSVファイルに必要な「列（ヘッダー）」の全17項目の一覧を定義
type InsuranceCsvKey =
  | 'employeeId'
  | 'currentGrade'
  | 'basicPensionNumber'
  | 'healthInsuranceJoined'
  | 'healthInsuranceNumber'
  | 'healthInsuranceAcquiredDate'
  | 'healthInsuranceLostDate'
  | 'healthInsuranceCompanyBurdenRate'
  | 'nursingCareInsuranceJoined'
  | 'nursingCareInsuranceAcquiredDate'
  | 'nursingCareInsuranceLostDate'
  | 'nursingCareInsuranceCompanyBurdenRate'
  | 'employeePensionInsuranceJoined'
  | 'employeePensionInsuranceNumber'
  | 'employeePensionInsuranceAcquiredDate'
  | 'employeePensionInsuranceLostDate'
  | 'employeePensionInsuranceCompanyBurdenRate';

// 画面の確認用モーダルに引き渡す「検証済みデータ1行分」の型定義
export type CsvInsurancePreviewRow = {
  rowNumber: number;                     // CSV上の実際の行番号（2行目、3行目...）
  selected: boolean;                      // 画面でチェックがついているか（初期値はエラーなしならtrue）
  canRegister: boolean;                  // エラーが0件で、システムに登録可能か
  errors: string[];                      // この行で発生したエラーメッセージの配列
  employeeId: string;                    // 社員ID
  currentGrade?: number;                 // 標準報酬等級
  insurance?: Partial<EmployeeInsurance>; // エラーがない場合に組み立てる、Firestore保存用の保険データオブジェクト
  healthInsuranceJoined: string;         // CSVからそのまま読み取った健康保険の状態文字（1, 0, 2）
  nursingCareInsuranceJoined: string;    // CSVからそのまま読み取った介護保険の状態文字（1, 0, 2）
  employeePensionInsuranceJoined: string; // CSVからそのまま読み取った厚生年種の状態文字（1, 0, 2）
};

// CSV検証処理（previewCsv）全体の最終結果をまとめる型定義
export type CsvInsurancePreviewResult = {
  message: string;                  // 画面トップに出すまとめ文
  errors: string[];                 // ファイル全体の構造上のエラー（列の不一致など）
  rows: CsvInsurancePreviewRow[];   // 各行の検証結果リスト
};

// 最終登録処理（registerPreviewRows）の完了結果をまとめる型定義
export type CsvInsuranceImportResult = {
  message: string;  // 「○件登録成功」などのメッセージ
  errors: string[]; // 登録処理中にDB側等で失敗した行のエラー文
};

@Injectable({
  providedIn: 'root', // アプリ全体でこのサービスを1つだけ使い回す（シングルトン）
})
export class AddInsuranceCsv {

  // Firestoreから社員データの取得・更新を行うサービスを注入
  private employeeService = inject(EmployeeService);
  // 健保喪失時に扶養家族のデータを一括修正するため、扶養サービスを注入
  private dependentService = inject(DependentService);

  // CSVの各列の「正確な日本語項目名（ヘッダー文字列）」の定義マップ
  private readonly headers: Record<InsuranceCsvKey, string> = {
    employeeId: '社員ID（半角英数字）',
    currentGrade: '標準報酬等級',
    healthInsuranceJoined: '健康保険加入（1:加入 0:未加入 2:喪失）',
    healthInsuranceNumber: '健康保険番号',
    healthInsuranceAcquiredDate: '健康保険取得日（yyyy-mm-dd）',
    healthInsuranceLostDate: '健康保険喪失日（yyyy-mm-dd）',
    healthInsuranceCompanyBurdenRate: '健康保険会社負担率',
    nursingCareInsuranceJoined: '介護保険加入（1:加入 0:未加入 2:喪失）',
    nursingCareInsuranceAcquiredDate: '介護保険取得日（yyyy-mm-dd）',
    nursingCareInsuranceLostDate: '介護保険喪失日（yyyy-mm-dd）',
    nursingCareInsuranceCompanyBurdenRate: '介護保険会社負担率',
    employeePensionInsuranceJoined: '厚生年金加入（1:加入 0:未加入 2:喪失）',
    employeePensionInsuranceNumber: '厚生年金番号',
    employeePensionInsuranceAcquiredDate: '厚生年金取得日（yyyy-mm-dd）',
    employeePensionInsuranceLostDate: '厚生年金喪失日（yyyy-mm-dd）',
    employeePensionInsuranceCompanyBurdenRate: '厚生年金会社負担率',
    basicPensionNumber: '基礎年金番号',
  };

  // テンプレートCSVファイルの中身を文字列として動的に生成する関数
  createCsvTemplate() {
    // 定義されている正しい日本語ヘッダーの配列を取得
    const headers = Object.values(this.headers);
    return [
      headers.join(','), // 1行目：カンマ区切りのヘッダー
      'E001,10,1,H12345,2026-04-01,,50,0,,,,,1,H12345,2026-04-01,,50,B12345', // 2行目：ユーザーが迷わないための「入力サンプル行」
      '入力内容）', // 3行目：「ここから下に入力してください」と伝えるガイドテキストの開始文
      '',
    ].join('\r\n'); // WindowsでもExcelでも確実に改行されるように、改行コード（CRLF）で結合
  }

  // アップロードされたCSVを読み込んで、全行をバリデーションし画面用のプレビューを作るメイン処理
  async previewCsv(file: File): Promise<CsvInsurancePreviewResult> {
    // 1. PapaParseを使って、ファイルを「行・列」のオブジェクト形式に非同期パース
    /*
    * PapaParseとは
    *「CSVのただの長い文字列を、
    * プログラム（TypeScript）が扱いやすい『オブジェクト（部品）』の形に
    * 自動で分解してくれる翻訳ライブラリ」
    * */
    const result = await this.parseCsv(file);
    // パースされたCSVからヘッダー（1行目）を取り出し、BOM等のゴミを除去（ノーマライズ）して配列化
    const csvHeaders = (result.meta.fields ?? []).map(header => this.normalizeCsvHeader(String(header ?? '')));
    // システムが期待している正しいヘッダーの一覧を取得
    const expectedHeaders: string[] = Object.values(this.headers);
    // アップロードされたCSVに、期待する全てのヘッダー列が漏れなく含まれているか検証
    //　ArrayのEveryは「配列のすべての要素が、指定した条件を100%満たしているか？」をチェックして、
    // 全員合格なら true、1人でも不合格がいたら false を返す
    const hasAllHeaders = expectedHeaders.every(header => csvHeaders.includes(header));

    // 列の構成がひな形と違っていた場合は、その時点でエラーとして処理を打ち切る（ガード処理）
    if (!hasAllHeaders) {
      return {
        message: 'CSVの列がひな形と一致していません',
        errors: [`読み取った列：${csvHeaders.join('、')}`],
        rows: [],
      };
    }

    // 各行のデータを綺麗に成形し、CSV上の正確な行番号（0始まりのインデックスに、ヘッダーとExcelの仕様を合わせて +2 する）をセット
    const rowInfos = result.data.map((row, index) => ({ row: this.normalizeCsvRow(row), rowNumber: index + 2 }));
    // テンプレートに仕込んである説明行（「入力内容）」で始まる行）が、CSV全体の何番目にあるかを検出
    const inputStartIndex = rowInfos.findIndex(rowInfo => this.isInputGuideRow(rowInfo.row));
    // パース中に生じた文法エラー（カンマの数が足りない等）を行番号に紐付けたマップを作成（ガイド行より上は無視）
    const parseErrorMap = this.createParseErrorMap(result.errors, inputStartIndex);
    // ガイド行（説明行）より後の「本当のデータ入力行」だけを切り出し、かつ完全に空の行を除外して取り込み対象を確定
    const importRowInfos = (inputStartIndex >= 0 ? rowInfos.slice(inputStartIndex + 1) : rowInfos)
      .filter(rowInfo => !this.isInputGuideRow(rowInfo.row))
      .filter(rowInfo => this.getRowValues(rowInfo.row).some(value => String(value ?? '').trim()));

    // 有効なデータが1件も入っていなかった場合は、ここでメッセージを返して終了
    if (!importRowInfos.length) {
      return {
        message: 'CSVに取り込み対象のデータがありません',
        errors: [],
        rows: [],
      };
    }

    // 社員IDが本当に実在するかを検証するため、マスターデータを取得して「ID ➔ 名前」のマップを作る
    let employeeNameMap: Record<string, string> = {};
    try {
      await this.employeeService.getAllEmployees(); // 最新の社員一覧をFirestoreからロード
      employeeNameMap = this.employeeService.allEmployeeNameMap(); // 「"E001": "山田太郎"」のようなマップを取得
    } catch (error) {
      console.error(error); // 失敗時はログを出して続行
    }
    // 同一ファイル内で同じ社員IDが2回以上出てくる「二重登録バグ」を防ぐための追跡用セット（Set）
    const csvEmployeeIds = new Set<string>();
    // 1行ずつの検証結果を溜めていくための空配列
    const previewRows: CsvInsurancePreviewRow[] = [];



    //行エラーチェック
    // 抽出された「本当のデータ行」を1行ずつループで詳細チェックしていく
    for (const { row, rowNumber } of importRowInfos) {
      // 最初のパースエラー（文法エラー）があれば引き継ぎ、無ければ空の配列でエラーリストを初期化
      const errors: string[] = [...(parseErrorMap.get(rowNumber) ?? [])];
      let employeeId = '';
      let currentGrade: number | null = null;
      let insurance: Partial<EmployeeInsurance> | undefined;
      let healthInsuranceJoined = '';
      let nursingCareInsuranceJoined = '';
      let employeePensionInsuranceJoined = '';

      try {
        // 行全体をチェックし、もし全角文字（日本語など）が混入していたらエラー（保険番号や日付は半角指定のため）
        if (this.getRowValues(row).some(value => /[^\x00-\x7F]/.test(String(value ?? '')))) {
          errors.push(`${rowNumber}行目：半角で入力してください`);
        }
        // 列名マップを元に、この行の「社員ID」「標準報酬等級」などの文字列をピンポイントで取得
        employeeId = this.getCsvValue(row, 'employeeId');
        const currentGradeText = this.getCsvValue(row, 'currentGrade');
        healthInsuranceJoined = this.getCsvValue(row, 'healthInsuranceJoined');
        nursingCareInsuranceJoined = this.getCsvValue(row, 'nursingCareInsuranceJoined');
        employeePensionInsuranceJoined = this.getCsvValue(row, 'employeePensionInsuranceJoined');
        
        // 文字列で受け取った等級を、プログラム用の数値型（number）に変換
        currentGrade = this.toNumber(currentGradeText);
        // CSV上の「1, 0, 2」という入力を、プログラム用の英単語ステータス（joined / notJoined / lost）に変換
        const healthStatus = this.toInsuranceStatus(healthInsuranceJoined);
        const nursingStatus = this.toInsuranceStatus(nursingCareInsuranceJoined);
        const pensionStatus = this.toInsuranceStatus(employeePensionInsuranceJoined);

        // --- 社員ID（employeeId）に関するバリデーション ---
        if (!employeeId) errors.push(`${rowNumber}行目：社員IDが未入力です`);
        if (employeeId && !/^[a-zA-Z0-9]+$/.test(employeeId)) errors.push(`${rowNumber}行目：社員IDは半角英数字で入力してください`);
        if (employeeId && /^[a-zA-Z0-9]+$/.test(employeeId) && !employeeNameMap[employeeId]) errors.push(`${rowNumber}行目：社員IDが存在しません`);
        if (employeeId && csvEmployeeIds.has(employeeId)) errors.push(`${rowNumber}行目：社員ID ${employeeId} がCSV内で重複しています`);
        if (employeeId) csvEmployeeIds.add(employeeId); // 重複チェック用セットにこのIDを記憶

        // --- 標準報酬等級（currentGrade）に関するバリデーション ---
        if (!currentGradeText) errors.push(`${rowNumber}行目：標準報酬等級が未入力です`);
        if (currentGradeText && currentGrade === null) errors.push(`${rowNumber}行目：標準報酬等級は数値で入力してください`);
        if (currentGrade !== null && (currentGrade < 0 || currentGrade > 50)) errors.push(`${rowNumber}行目：標準報酬等級は0以上50以下で入力してください`);
        
        // --- 社会保険の制度上の組み合わせ整合性チェック（重要業務ルール） ---
        // 健康保険に未加入・喪失しているのに、おまけである「介護保険」や「厚生年金」だけにピンポイントで加入することは日本の法律・制度上あり得ないためエラーにする
        if (healthStatus !== 'joined' && (nursingStatus === 'joined' || pensionStatus === 'joined')) {
          errors.push(`${rowNumber}行目：健康保険が未加入または喪失の場合、介護保険と厚生年金は加入にできません`);
        }

        // ここまでの基本チェックをクリアし、等級が正しく取得できていれば、各保険の「取得日」「負担率」などの詳細オブジェクトをさらに細かく組み立てる（内部で別関数を実行）
        insurance = currentGrade === null
          ? undefined
          : this.toInsuranceFromCsvRow(row, rowNumber, this.getCurrentGradeForSave(currentGrade, healthStatus, nursingStatus, pensionStatus), errors);
      } catch (error) {
        console.error(error); // 予期せぬ重大なプログラムバグが発生した場合はログを出し、行エラーを追加
        errors.push(`${rowNumber}行目：CSV内容の確認に失敗しました`);
      }

      // チェックが終わった1行分のすべての検証データを、プレビュー用の大配列に追加
      previewRows.push({
        rowNumber,
        selected: errors.length === 0,    // エラーが1件も無ければ、画面の確定チェックボックスをはじめから「ON（true）」にする
        canRegister: errors.length === 0, // エラーが0件の場合のみ、システム登録許可フラグを「true」にする
        errors,
        employeeId,
        currentGrade: currentGrade ?? undefined,
        insurance: errors.length === 0 ? insurance : undefined, // エラーがある行は保存用データを無しにする
        healthInsuranceJoined,
        nursingCareInsuranceJoined,
        employeePensionInsuranceJoined,
      });
    }

    // ループ終了後、最終的にエラーが残ってしまった行の合計数をカウント
    const errorCount = previewRows.filter(row => row.errors.length > 0).length;
    return {
      // 画面のインポートステータス欄に表示する総合サマリーテキストを生成
      message: `CSV確認完了：登録可能 ${previewRows.length - errorCount} 件、エラー ${errorCount} 件`,
      errors: [],
      rows: previewRows, // 画面（コンポーネント）へ全行の結果を引き渡す
    };
  }

  // プレビュー画面でユーザーがチェックを入れた行を、Firestoreに1件ずつ非同期書き込みする確定処理
  async registerPreviewRows(rows: CsvInsurancePreviewRow[]): Promise<CsvInsuranceImportResult> {
    // 画面で「チェックON（selected）」かつ「エラーなし（canRegister）」かつ「保存用データが存在する」行だけを厳選
    const selectedRows = rows.filter(row => row.selected && row.canRegister && row.insurance);
    // 対象が1件もない場合はメッセージを出して登録を行わない
    if (!selectedRows.length) {
      return { message: '登録対象の行を選択してください', errors: [] };
    }

    const errors: string[] = []; // DB保存時に失敗したエラーを溜める配列
    let successCount = 0;        // 成功数を数えるカウンター

    // 選択された安全な行データだけをループでFirestoreへ保存していく
    for (const row of selectedRows) {
      try {
        // 社員サービスを呼び出し、該当社員の「employees/社員ID」ドキュメント配下にある保険情報を非同期で上書き保存
        const result = await this.employeeService.updateEmployeeInsurance(row.employeeId, row.insurance!);
        if (result) {
          // 💡 連動ビジネスロジック：もし「健康保険の加入（joined）」が外れた（未加入、または喪失になった）場合、その従業員に紐づいている「扶養家族全員」の扶養資格を一括で強制OFF（false）にする必要がある（社会保険のルール）
          if (!row.insurance!.healthInsurance?.joined) {
            // 扶養サービスを呼び出して、該当社員の全扶養家族の status を「非扶養」に一括書き換え
            const dependentsUpdated = await this.updateDependentsToNotDependent(row.employeeId);
            if (!dependentsUpdated) {
              errors.push(`${row.rowNumber}行目：社員ID ${row.employeeId} の扶養情報更新に失敗しました`);
              continue; // 扶養の連動更新に失敗した場合はエラーに追加して次の社員へ
            }
          }
          successCount++; // 保険も扶養もすべて問題なく保存できたら成功数を+1
        } else {
          errors.push(`${row.rowNumber}行目：社員ID ${row.employeeId} の保険情報登録に失敗しました`);
        }
      } catch (error) {
        console.error(error); // 通信エラー等の例外処理
        errors.push(`${row.rowNumber}行目：社員ID ${row.employeeId} の保険情報登録に失敗しました`);
      }
    }

    // 全員の登録が終わったら、システム全体の「全社員一覧データ（キャッシュ）」を強制的に最新版に再ロード（リフレッシュフラグ true）
    await this.employeeService.getAllEmployees(true);
    return {
      // 1件でも失敗があれば失敗数を出し、すべて綺麗にいけば「保険情報を更新しました：○件」と成功を出す
      message: errors.length
        ? `登録完了：${successCount} 件、失敗 ${errors.length} 件`
        : `保険情報を${UPDATE_MESSAGES.SUCCESS}：${successCount} 件`,
      errors,
    };
  }

  // 【内部処理】CSVの1つのデータ行から、健康保険・介護保険・厚生年金の3つそれぞれの「詳細データ」を個別に組み立てて1つに結合する関数
  private toInsuranceFromCsvRow(row: CsvRow, rowNumber: number, currentGrade: number, errors: string[]): Partial<EmployeeInsurance> {
    // 1. 健康保険のデータをパース・検証
    const healthInsurance = this.toInsuranceDetail(row, rowNumber, 'healthInsurance', '健康保険', errors);
    const healthInsuranceNumber = healthInsurance.number ?? ''; // 後続の介護・厚生年金で「番号の自動使い回し」をするために健保番号をキープ
    
    // 2. 介護保険のデータをパース・検証（健康保険の番号を一緒に引き渡す）
    const nursingCareInsurance = this.toInsuranceDetail(
      row,
      rowNumber,
      'nursingCareInsurance',
      '介護保険',
      errors,
      healthInsuranceNumber, // 健保番号を共有（介護保険は健保とセットになるため）
    );
    // 3. 厚生年金のデータをパース・検証（同じく健康保険の番号を引き渡す）
    const employeePensionInsurance = this.toInsuranceDetail(
      row,
      rowNumber,
      'employeePensionInsurance',
      '厚生年金',
      errors,
      healthInsuranceNumber, // 年金番号の入力が省かれていた場合、健保と同じ番号を自動セットするための優しさ設計
    );
    
    // 基礎年金番号（basicPensionNumber）を個別に取得して半角英数字チェック
    const basicPensionNumber = this.getCsvValue(row, 'basicPensionNumber');
    if (basicPensionNumber && !/^[a-zA-Z0-9]+$/.test(basicPensionNumber)) {
      errors.push(`${rowNumber}行目：基礎年金番号は半角英数字で入力してください`);
    }

    // 最終的にFirestoreの「insurance」ドキュメントにそのまま放り込めるオブジェクト構造にまとめて返す
    return {
      currentGrade,
      ...(basicPensionNumber ? { basicPensionNumber } : {}),
      healthInsurance,
      nursingCareInsurance,
      employeePensionInsurance,
    };
  }

  // 【内部処理】健康保険、介護保険、厚生年金それぞれの「加入・未加入・喪失」に応じた入力必須チェックや型変換をピンポイントで行う関数
  private toInsuranceDetail(
    row: CsvRow,
    rowNumber: number,
    insuranceName: InsuranceName, // どの保険を処理しているか（'healthInsurance'など）
    label: string,                 // エラー文表示用の日本語名（'健康保険'など）
    errors: string[],              // エラーを溜める配列の参照
    sharedHealthInsuranceNumber = '', // 共通利用するために渡されてきた健康保険番号
  ): InsuranceDetail {
    const joinedText = this.getCsvValue(row, `${insuranceName}Joined`); // CSVから加入有無（1, 0, 2）を取得
    const status = this.toInsuranceStatus(joinedText); // 英単語ステータスに変換
    // 「加入（joined）」または「喪失（lost）」の場合のみ、番号や取得日などの「詳細情報」の入力欄が必要になる
    const needsInsuranceDetail = status === 'joined' || status === 'lost';
    const needsLostDate = status === 'lost'; // 「喪失（2）」の場合のみ、喪失日の入力が必要になる

    // 介護保険や厚生年金において、番号欄が空欄だった場合は、引き渡された健康保険番号を自動適用（実務の入力簡略化のため）
    let number = insuranceName === 'nursingCareInsurance'
      ? sharedHealthInsuranceNumber
      : this.getCsvValue(row, `${insuranceName}Number`);
    if (insuranceName === 'employeePensionInsurance' && !number && sharedHealthInsuranceNumber) {
      number = sharedHealthInsuranceNumber;
    }
    // CSVから日付文字列と会社負担率を取得
    const acquiredDateText = this.getCsvValue(row, `${insuranceName}AcquiredDate`);
    const lostDateText = this.getCsvValue(row, `${insuranceName}LostDate`);
    const companyBurdenRateText = this.getCsvValue(row, `${insuranceName}CompanyBurdenRate`);
    
    // 文字列データをプログラムで計算・処理できる適切な型（数値や、Firebase用のTimestamp型）に厳密変換
    const companyBurdenRate = this.toNumber(companyBurdenRateText);
    const acquiredDate = this.toTimestamp(acquiredDateText);
    const lostDate = this.toTimestamp(lostDateText);

    // --- 各項目の詳細バリデーションチェック ---
    if (joinedText === '') errors.push(`${rowNumber}行目：${label}加入有無が未入力です`);
    // 入力値が「1, 0, 2」のいずれでもないデタラメな文字だった場合は、ここでエラーにして保険未加入（joined: false）として即時返却
    const isStatusValid = !joinedText || this.validateCsvChoice(rowNumber, `${label}加入有無`, joinedText, ['1', '0', '2'], errors);
    if (!isStatusValid) return { joined: false };

    // 「加入」または「喪失」のデータに詳細な不備がないかチェック
    if (needsInsuranceDetail) {
      // エラー文に出す項目ラベルを保険ごとに調整
      const numberLabel = insuranceName === 'nursingCareInsurance'
        ? '健康保険番号（介護保険と共通）'
        : `${label}番号`;
        
      if (status === 'lost' && !number) errors.push(`${rowNumber}行目：${numberLabel}が未入力です`);
      if (number && !/^[a-zA-Z0-9]+$/.test(number)) errors.push(`${rowNumber}行目：${numberLabel}は半角英数字で入力してください`);
      if (!acquiredDateText) errors.push(`${rowNumber}行目：${label}取得日が未入力です`);
      if (acquiredDateText && !acquiredDate) errors.push(`${rowNumber}行目：${label}取得日の日付形式が正しくありません（yyyy-mm-dd形式で入力してください）`);
      if (needsLostDate && !lostDateText) errors.push(`${rowNumber}行目：${label}喪失日が未入力です`);
      if (lostDateText && !lostDate) errors.push(`${rowNumber}行目：${label}喪失日の日付形式が正しくありません（yyyy-mm-dd形式で入力してください）`);
      // 「取得日（入社日など）」よりも「喪失日（退職日など）」の方が前の日付になっていたら日付矛盾エラー
      if (acquiredDateText && lostDateText && acquiredDateText >= lostDateText) errors.push(`${rowNumber}行目：${label}喪失日は取得日より後の日付で入力してください`);
      if (!companyBurdenRateText) errors.push(`${rowNumber}行目：${label}会社負担率が未入力です`);
      if (companyBurdenRateText && companyBurdenRate === null) errors.push(`${rowNumber}行目：${label}会社負担率は数値で入力してください`);
      if (companyBurdenRate !== null && (companyBurdenRate < 0 || companyBurdenRate > 100)) errors.push(`${rowNumber}行目：${label}会社負担率は0以上100以下で入力してください`);
    }

    // 「0:未加入」の場合は詳細情報は保存不要なので、加入フラグ false のみを即座に返す
    if (!needsInsuranceDetail) {
      return { joined: false };
    }

    // すべてのバリデーションを通過した綺麗なデータを、インターフェース「InsuranceDetail」の構造に合わせて整形して返す
    return {
      joined: status === 'joined', // statusが'joined'ならtrue、'lost'ならfalseになる
      number,
      ...(acquiredDate ? { acquiredDate } : {}), // 取得日が存在すればオブジェクトにマージ
      ...(lostDate ? { lostDate } : {}),         // 喪失日が存在すればオブジェクトにマージ
      companyBurdenRate: companyBurdenRate ?? 50, // 入力漏れがあれば標準の折半（50%）を補完
    };
  }

  // 【内部処理】保存用の標準報酬等級を計算する関数
  private getCurrentGradeForSave(
    currentGrade: number,
    healthStatus: InsuranceCsvStatus | null,
    nursingStatus: InsuranceCsvStatus | null,
    pensionStatus: InsuranceCsvStatus | null,
  ): number {
    // 3つの保険がすべて「未加入（notJoined）」の場合、等級は意味を持たないため、強制的に「0」にして保存する
    return healthStatus === 'notJoined' && nursingStatus === 'notJoined' && pensionStatus === 'notJoined'
      ? 0
      : currentGrade;
  }

  // 【内部処理】健康保険から脱退した社員の「全扶養家族」の扶養フラグを、Firestore側で一括「OFF（false）」に書き換える連動処理
  private async updateDependentsToNotDependent(employeeId: string): Promise<boolean> {
    // 扶養サービスを使って、対象社員に紐づいている全ての扶養家族リストをDBから取得
    const dependents = await this.dependentService.getDependents(employeeId);
    // すでに扶養から外れている人を除外し、「現在進行形で扶養に入っている（isDependent !== false）」人だけを抽出
    const activeDependents = dependents.filter(dependent => dependent.isDependent !== false);
    if (activeDependents.length === 0) return true; // 対象者が0人なら何もせず成功（true）を返す

    // 抽出された全員のデータに対して、「isDependent: false（扶養対象外）」という上書き用の変更データ配列を作成
    const updates: Partial<Dependent>[] = activeDependents.map(dependent => ({
      ...dependent,
      isDependent: false,
    }));
    // 扶養サービスを呼び出して、Firestore内の複数ドキュメントをまとめて更新し、成否を返す
    return await this.dependentService.updateDependents(employeeId, updates);
  }

  // 【内部処理】PapaParseライブラリを使って、CSVファイル（file）をJavaScriptのオブジェクト配列に解析（パース）する関数
  private parseCsv(file: File): Promise<Papa.ParseResult<CsvRow>> {
    return new Promise((resolve, reject) => {
      Papa.parse<CsvRow>(file, {
        header: true,          // 1行目を「列名（ヘッダー）」として自動で読み込み、各行をオブジェクト化する設定
        skipEmptyLines: true,  // CSVファイル内の不必要な「完全に空の行」を自動で無視する設定
        complete: result => resolve(result), // 解析が成功したら結果（result）を返してPromiseを完了
        error: error => reject(error),       // 解析自体に失敗した場合はエラーを投げてPromiseを失敗させる
      });
    });
  }

  // 【内部処理】PapaParseのパース中に発生した文法エラー（列数が合わない等）を検知し、該当する行番号と紐づけたエラーマップを作る関数
  private createParseErrorMap(errors: Papa.ParseError[], inputStartIndex: number) {
    const parseErrorMap = new Map<number, string[]>(); // 「行番号 ➔ エラーメッセージの配列」を入れるマップ
    for (const error of errors) {
      if (error.row === undefined) continue; // 行番号が特定できないシステムエラーはスルー

      const rowNumber = error.row + 2; // PapaParseの0始まりインデックスを行番号に変換
      const dataIndex = error.row;
      // エラーが起きた場所が、テンプレートの上部（説明・ガイド行エリア）だった場合は、実データとは無関係なので無視
      if (inputStartIndex >= 0 && dataIndex <= inputStartIndex) continue;

      // すでにその行で別のエラーが記録されていればそれを取り出し、無ければ新しい配列を用意
      const messages = parseErrorMap.get(rowNumber) ?? [];
      messages.push(`${rowNumber}行目：未入力の項目があります`); // エラーメッセージを追加
      parseErrorMap.set(rowNumber, messages); // マップを更新
    }
    return parseErrorMap; // 完成したエラーマップを返却
  }

  // 【内部処理】複雑にバラついたCSVの行データ（row）から、指定した定義キー（key）に対応する値をピンポイントで安全に引っこ抜く関数
  private getCsvValue(row: CsvRow, key: InsuranceCsvKey) {
    // 項目名の全角半角のブレやスペースを除去した上で、定義してある正しい日本語ヘッダーと一致する列の「値」を探し出す
    const value = Object.entries(this.normalizeCsvRow(row)).find(([header]) => this.normalizeCsvHeader(header) === this.headers[key])?.[1];
    return String(value ?? '').trim(); // 前後の余分な空白を綺麗にカットした文字列として返す
  }

  // 【内部処理】その行データが、テンプレートの3行目にあるような「入力内容）」で始まる案内用の説明行（ガイド行）かどうかを判定する関数
  private isInputGuideRow(row: CsvRow) {
    // 行の中のいずれかのマスの文字が、末尾のカンマを除去した状態で「入力内容」から始まっているかを調べて、true/falseを返す
    return this.getRowValues(row).some(value => String(value ?? '').trim().replace(/,+$/, '').startsWith('入力内容'));
  }

  // 【内部処理】渡ってきた行データが未定義（null等）だった場合に、プログラムがクラッシュしないよう、安全な空オブジェクト `{}` に変換する防衛関数
  private normalizeCsvRow(row: CsvRow | null | undefined): CsvRow {
    return row && typeof row === 'object' ? row : {};
  }

  // 【内部処理】オブジェクト形式になっている1行のデータから、「値（文字列などのデータ）」だけをすべて抽出してフラットな配列として返す関数
  private getRowValues(row: CsvRow) {
    return Object.values(this.normalizeCsvRow(row)).flatMap(value => Array.isArray(value) ? value : [value]);
  }

  // 【内部処理】CSVのヘッダー文字列から、文字化け防止用の記号（BOM: \uFEFF）や前後の余分なスペースを綺麗に消去（正規化）する関数
  private normalizeCsvHeader(header: string) {
    return header.replace(/^\uFEFF/, '').trim();
  }

  // 【内部処理】CSVに入力された「1」「0」「2」という選択肢を、プログラム用の分かりやすい英単語の加入ステータスへと翻訳する関数
  private toInsuranceStatus(value: string): InsuranceCsvStatus | null {
    if (value === '1') return 'joined';     // 「1」なら 加入(joined)
    if (value === '0') return 'notJoined';  // 「0」なら 未加入(notJoined)
    if (value === '2') return 'lost';       // 「2」なら 喪失(lost)
    return null;                            // それ以外（デタラメな入力）は null
  }

  // 【内部処理】入力されたステータス（1, 0, 2）が、決められた選択肢（options）の中にちゃんと入っているか検証する関数
  private validateCsvChoice(
    rowNumber: number,
    fieldName: string, // エラー文に出す項目名
    value: string,     // 入力された実際の値
    options: readonly string[], // 許容される選択肢の配列（['1', '0', '2']）
    errors: string[],  // エラー配列
  ) {
    if (options.includes(value)) {
      return true; // 選択肢の中に含まれていれば合格（true）
    }

    // 含まれていなければエラー配列に文を追加して不合格（false）
    errors.push(`${rowNumber}行目：${fieldName}が選択肢と一致していません`);
    return false;
  }

  // 【内部処理】CSVから読み取った文字列（負担率や等級など）を、安全に数値（number）に変換する関数
  private toNumber(value: string): number | null {
    if (!value) return null; // 空文字なら null
    const numberValue = Number(value);
    // 変換した結果が、ちゃんとした「有限の正常な数値」であれば数値を返し、文字が混じっていて NaN（Not a Number）になった場合は null を返す
    return Number.isFinite(numberValue) ? numberValue : null;
  }

  // 【内部処理】CSVに入力された「yyyy-mm-dd」形式の日付文字列を、Firestoreに保存できる「Timestamp型」のデータに安全に変換する関数
  private toTimestamp(value: string): Timestamp | null {
    if (!value) return null; // 空欄なら null
    const normalizedValue = value.replace(/\//g, '-'); // 万が一「yyyy/mm/dd」で入力されていても「-」に自動置換してあげる優しさ処理
    const match = normalizedValue.match(/^(\d{4})-(\d{2})-(\d{2})$/); // 正規表現を使って「数字4桁-数字2桁-数字2桁」の形に完全一致するかチェック
    if (!match) return null; // 形式がデタラメなら null（エラー）

    // マッチした文字列から、年・月・日をそれぞれ数値として切り出す
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    
    // JavaScriptの標準の Date オブジェクトを生成（※月だけは0始まりの仕様なので「month - 1」にする）
    const date = new Date(year, month - 1, day);
    
    // 存在しない架空の日付（例: 2026-02-31 など）が入力された場合、Dateオブジェクトが勝手に翌月に繰り越してしまう性質を利用して、入力された数値と生成された日付の数値が完全一致するか「実在チェック」を行う
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
      return null; // 日付の実在矛盾があれば null（エラー）
    }
    // すべての検証をパスした本物の日付データから、Firebase専用の「Timestamp」を作成して返却
    return Timestamp.fromDate(date);
  }
  
}