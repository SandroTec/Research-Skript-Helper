import { Routes } from '@angular/router';
import { RouteMarkerComponent } from './route-marker.component';

// The application shell currently renders the editorial pages. Named routes establish
// stable URLs now and allow each area to move to a lazy feature route independently.
export const routes: Routes = [
  { path: '', pathMatch: 'full', component: RouteMarkerComponent, data: { view: 'dashboard' } },
  { path: 'analytics', component: RouteMarkerComponent, data: { view: 'analytics' } },
  { path: 'topics', component: RouteMarkerComponent, data: { view: 'topics' } },
  { path: 'research', component: RouteMarkerComponent, data: { view: 'research' } },
  { path: 'scripts', component: RouteMarkerComponent, data: { view: 'scripts' } },
  { path: 'settings', component: RouteMarkerComponent, data: { view: 'settings' } },
  { path: '**', redirectTo: '' },
];
