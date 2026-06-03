import { Injectable, inject } from '@angular/core';
import { Firestore, collection, collectionGroup, getDocs, doc, getDoc, setDoc, updateDoc, deleteDoc, collectionData, Timestamp, query, where, WithFieldValue, DocumentData } from '@angular/fire/firestore';


@Injectable({
  providedIn: 'root',
})
export class CrudService {

  private firestore = inject(Firestore);

  // 新規作成 成功はtrue、失敗はfalseを返す　（パスに自作Idを指定する）
  async create<T extends WithFieldValue<DocumentData>>(path: string, data: Partial<T>) {
    try {
      const ref = doc(this.firestore, path);
      await setDoc(ref, {
        ...data,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      return true;
    } catch (e) {
      console.error(e);
      return false;
    }
  }

  // 全件取得
  async getAll<T>(path: string, idField?: string): Promise<T[]> {
    try {
      const ref = collection(this.firestore, path);
      const snap = await getDocs(ref);

      return snap.docs.map(doc => ({
        ...doc.data(),
        ...(idField ? { [idField]: doc.id } : {}),
      } as T));

    } catch (e) {
      console.error(e);
      return []; //エラーでも空で返す
    }
  }

  // IDで1件取得
  async getById<T>(path: string, idField?: string): Promise<T | null> {
    try {
      const ref = doc(this.firestore, path);
      const snap = await getDoc(ref);

      if (!snap.exists()) return null;

      return {
        ...snap.data(),
        ...(idField ? { [idField]: snap.id } : {}),
      } as T;

    } catch (e) {
      console.error(e);
      return null;
    }
  }

  // フィールド検索
  async getByField<T>(path: string, field: string, value: any, idField?: string): Promise<T[]> {
    try {
      const ref = collection(this.firestore, path);
      const que = query(ref, where(field, '==', value));
      const snap = await getDocs(que);

      return snap.docs.map(doc => ({
        ...doc.data(),
        ...(idField ? { [idField]: doc.id } : {}),
      } as T));

    } catch (e) {
      console.error(e);
      return [];
    }
  }

  // collectionGroup検索（同名サブコレクションを横断して検索）
  async getByCollectionGroupFields<T>(
    collectionId: string,
    conditions: { field: string; value: any }[],
    idField?: string
  ): Promise<T[]> {
    try {
      const ref = collectionGroup(this.firestore, collectionId);
      const que = query(ref, ...conditions.map(condition => where(condition.field, '==', condition.value)));
      const snap = await getDocs(que);

      return snap.docs.map(doc => ({
        ...doc.data(),
        ...(idField ? { [idField]: doc.id } : {}),
      } as T));

    } catch (e) {
      console.error(e);
      return [];
    }
  }

  // フィールド検索 検索対象のフィールドが配列の場合
  async getByFieldArray<T>(path: string, field: string, value: any, idField?: string): Promise<T[]> {
    try {
      const ref = collection(this.firestore, path);
      const que = query(ref, where(field, 'array-contains', value));
      const snap = await getDocs(que);

      return snap.docs.map(doc => ({
        ...doc.data(),
        ...(idField ? { [idField]: doc.id } : {}),
      } as T));

    } catch (e) {
      console.error(e);
      return [];
    }
  }

  // 更新 成功はtrue、失敗はfalseを返す(updateDocはエラーを返す)
  async update<T>(path: string, data: Partial<T>): Promise<boolean> {
    try {
      const ref = doc(this.firestore, path);
      await updateDoc(ref, {
        ...data,
        updatedAt: new Date(),
      });
      return true;
    } catch (e) {
      console.error(e);
      return false;
    }
  }

  // //Firestoreのアクセス制御のため
  // async setMerge<T extends WithFieldValue<DocumentData>>(
  //   path: string,
  //   id: string,
  //   data: Partial<T>,
  // ): Promise<boolean> {
  //   try {
  //     const ref = doc(this.firestore, `${path}/${id}`);
  //     await setDoc(
  //       ref,
  //       {
  //         ...data,
  //         updatedAt: new Date(),
  //       } as WithFieldValue<DocumentData>,
  //       { merge: true },
  //     );
  //     return true;
  //   } catch (e) {
  //     console.error(e);
  //     return false;
  //   }
  // }

  // 削除
  async delete(path: string) {
    try {
      const ref = doc(this.firestore, path);
      await deleteDoc(ref);
      return true;
    } catch (e) {
      console.error(e);
      return false;
    }
  }

  // //フィールド検索を監視
  // watchByField<T>(path: string, field: string, value: any, idField?: string): Observable<T[]> {
  //   const ref = collection(this.firestore, path);
  //   const q = query(ref, where(field, '==', value));
  //   return (idField ? collectionData(q, { idField }) : collectionData(q)) as Observable<T[]>;
  // }

}
