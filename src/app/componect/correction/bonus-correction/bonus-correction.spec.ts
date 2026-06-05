import { ComponentFixture, TestBed } from '@angular/core/testing';

import { BonusCorrection } from './bonus-correction';

describe('BonusCorrection', () => {
  let component: BonusCorrection;
  let fixture: ComponentFixture<BonusCorrection>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BonusCorrection]
    })
    .compileComponents();

    fixture = TestBed.createComponent(BonusCorrection);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
