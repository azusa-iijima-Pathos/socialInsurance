import { ComponentFixture, TestBed } from '@angular/core/testing';

import { OfficeDetail } from './office-detail';

describe('OfficeDetail', () => {
  let component: OfficeDetail;
  let fixture: ComponentFixture<OfficeDetail>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [OfficeDetail]
    })
    .compileComponents();

    fixture = TestBed.createComponent(OfficeDetail);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
