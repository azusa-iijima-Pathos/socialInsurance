import { ComponentFixture, TestBed } from '@angular/core/testing';

import { LifeeventApplication } from './lifeevent-application';

describe('LifeeventApplication', () => {
  let component: LifeeventApplication;
  let fixture: ComponentFixture<LifeeventApplication>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LifeeventApplication]
    })
    .compileComponents();

    fixture = TestBed.createComponent(LifeeventApplication);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
