import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { consumeGuardMessage } from '../../../service/common/guard-message.util';

@Component({
  selector: 'app-top-for-employee',
  imports: [CommonModule, RouterLink],
  templateUrl: './top-for-employee.html',
  styleUrl: './top-for-employee.css',
})
export class TopForEmployee {

  workingMonth = sessionStorage.getItem('workingMonth') ?? '';

  permission = sessionStorage.getItem('permission') ?? '';

  guardMessage = '';

  private route = inject(ActivatedRoute);
  private router = inject(Router);

  ngOnInit() {
    this.guardMessage = consumeGuardMessage(this.route, this.router);
  }

}
