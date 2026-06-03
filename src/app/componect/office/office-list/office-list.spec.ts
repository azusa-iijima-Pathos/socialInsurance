import { ComponentFixture, TestBed } from '@angular/core/testing';

import { OfficeList } from './office-list';

describe('OfficeList', () => {
  let component: OfficeList;
  let fixture: ComponentFixture<OfficeList>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [OfficeList]
    })
    .compileComponents();

    fixture = TestBed.createComponent(OfficeList);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
