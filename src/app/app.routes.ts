import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./landing/landing').then(m => m.LandingComponent),
  },
  {
    path: 'room/:code',
    loadComponent: () => import('./room/room').then(m => m.RoomComponent),
  },
];
