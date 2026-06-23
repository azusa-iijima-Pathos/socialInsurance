import { Timestamp } from '@angular/fire/firestore';
import { AnnouncementReason, AnnouncementSubType, AnnouncementType } from '../constants/model-constants';

/** 届け出チェックリスト（アナウンス） */
export type Announcement = {
  announcementId: string;
  type: AnnouncementType;
  subType?: AnnouncementSubType;
  reason?: AnnouncementReason;
  occurredDate: Timestamp;
  checked: boolean;
  checkedBy?: string;
  checkedAt?: Timestamp;
  employeeId?: string;
  sourceKind?: string;
  sourceId?: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
};
