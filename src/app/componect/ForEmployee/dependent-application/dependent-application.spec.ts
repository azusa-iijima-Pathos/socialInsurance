import { ComponentFixture, TestBed } from '@angular/core/testing';

import { DependentApplication } from './dependent-application';

describe('DependentApplication', () => {
  let component: DependentApplication;
  let fixture: ComponentFixture<DependentApplication>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DependentApplication]
    })
    .compileComponents();

    fixture = TestBed.createComponent(DependentApplication);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
