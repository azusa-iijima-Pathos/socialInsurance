import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ReachAge } from './reach-age';

describe('ReachAge', () => {
  let component: ReachAge;
  let fixture: ComponentFixture<ReachAge>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ReachAge]
    })
    .compileComponents();

    fixture = TestBed.createComponent(ReachAge);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
