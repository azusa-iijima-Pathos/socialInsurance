import { inject, Injectable } from '@angular/core';
import { Timestamp } from '@angular/fire/firestore';
import { Announcement } from '../../model/announcement';
import { CrudService } from '../common/crud-service';

@Injectable({
  providedIn: 'root',
})
export class AnnouncementService {
  private crudService = inject(CrudService);

  private get path(): string {
    const companyId = sessionStorage.getItem('companyId');
    return `companies/${companyId}/announcements`;
  }

  async getAllAnnouncements(): Promise<Announcement[]> {
    const items = await this.crudService.getAll<Announcement>(this.path, 'announcementId');
    return items.sort((left, right) => (right.createdAt?.toMillis?.() ?? 0) - (left.createdAt?.toMillis?.() ?? 0));
  }

  async getById(announcementId: string): Promise<Announcement | null> {
    return this.crudService.getById<Announcement>(`${this.path}/${announcementId}`, 'announcementId');
  }

  async createAnnouncement(announcement: Omit<Announcement, 'createdAt' | 'updatedAt'>): Promise<boolean> {
    const existing = await this.getById(announcement.announcementId);
    if (existing) return true;
    return this.crudService.create<Announcement>(`${this.path}/${announcement.announcementId}`, announcement);
  }

  async markChecked(announcementId: string, loginEmployeeId: string): Promise<boolean> {
    return this.crudService.update<Announcement>(`${this.path}/${announcementId}`, {
      checked: true,
      checkedBy: loginEmployeeId,
      checkedAt: Timestamp.now(),
    });
  }
}
