import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CompanyDetail } from './company-detail';

describe('CompanyDetail', () => {
  let component: CompanyDetail;
  let fixture: ComponentFixture<CompanyDetail>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CompanyDetail]
    })
    .compileComponents();

    fixture = TestBed.createComponent(CompanyDetail);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
