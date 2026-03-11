import { Route, BusStop, ETA, RouteETAItem } from './types';
import * as KMB from './api/kmb';
import * as LWB from './api/lwb';
import * as CTB from './api/citybus';
import * as NLB from './api/nlb';

function normalizePlaceName(name: string) {
    return name.replace(/[()（）\s]/g, '').substring(0, 2);
}

export async function getRoute(routeNumber: string): Promise<Route[]> {
  const [kmbRoutes, lwbRoutes, ctbRoutes, nlbRoutes] = await Promise.all([
    KMB.getKMBRoutes(routeNumber),
    LWB.getLWBRoutes(routeNumber),
    CTB.getCTBRoutes(routeNumber),
    NLB.getNLBRoutes(routeNumber),
  ]);

  const allRoutes = [...kmbRoutes, ...lwbRoutes, ...ctbRoutes, ...nlbRoutes];
  const mergedRoutes: Route[] = [];

  for (const r of allRoutes) {
    // Try to find a matching route to merge
    // Match by route number and service type
    // And check if origin/destination match (fuzzy match)
    const existing = mergedRoutes.find(m => 
        m.route === r.route && 
        m.service_type === r.service_type &&
        (
            (normalizePlaceName(m.orig_tc) === normalizePlaceName(r.orig_tc) && 
             normalizePlaceName(m.dest_tc) === normalizePlaceName(r.dest_tc))
        )
    );

    if (existing) {
        if (!existing.companies) existing.companies = [existing.company!];
        if (!existing.companyBounds) existing.companyBounds = { [existing.company!]: existing.bound };
        
        if (r.company && !existing.companies.includes(r.company)) {
            existing.companies.push(r.company);
            existing.companyBounds[r.company] = r.bound;
        }
    } else {
        mergedRoutes.push({ 
            ...r, 
            companies: [r.company!],
            companyBounds: { [r.company!]: r.bound }
        });
    }
  }

  return mergedRoutes;
}

export async function getRouteStops(route: Route): Promise<BusStop[]> {
  switch (route.company) {
    case 'KMB':
      return KMB.getKMBRouteStops(route.route, route.bound, route.service_type);
    case 'LWB':
      return LWB.getLWBRouteStops(route.route, route.bound, route.service_type);
    case 'CTB':
      return CTB.getCTBRouteStops(route.route, route.bound, route.service_type);
    case 'NLB':
      return NLB.getNLBRouteStops(route.route, route.bound, route.service_type, route.routeId);
    default:
      return [];
  }
}

export async function getRouteETA(route: Route): Promise<RouteETAItem[]> {
  switch (route.company) {
    case 'KMB':
      return KMB.getKMBRouteETA(route.route, route.service_type);
    case 'LWB':
      return LWB.getLWBRouteETA(route.route, route.service_type);
    case 'CTB':
      return CTB.getCTBRouteETA(route.route, route.service_type);
    case 'NLB':
      return NLB.getNLBRouteETA(route.route, route.service_type);
    default:
      return [];
  }
}

export async function getStopETA(stop: BusStop, route: Route): Promise<ETA[]> {
  switch (route.company) {
    case 'KMB':
      return KMB.getKMBStopETA(stop.stop, route.route, route.service_type);
    case 'LWB':
      return LWB.getLWBStopETA(stop.stop, route.route, route.service_type);
    case 'CTB':
      return CTB.getCTBStopETA(stop.stop, route.route, route.service_type);
    case 'NLB':
      return NLB.getNLBStopETA(stop.stop, route.route, route.service_type, route.routeId);
    default:
      return [];
  }
}

export async function getAllStopETAs(stop: BusStop): Promise<ETA[]> {
  // We try to fetch from all major companies if we have a mapping or if we want to be thorough.
  // For joint routes, we have companyStops mapping.
  const companies = stop.companyStops ? Object.keys(stop.companyStops) : ['KMB', 'LWB', 'CTB'];
  
  const promises = companies.map(async (co) => {
    const stopId = stop.companyStops?.[co]?.stop || stop.stop;
    switch (co) {
      case 'KMB':
        return KMB.getAllKMBStopETA(stopId);
      case 'LWB':
        return LWB.getAllLWBStopETA(stopId);
      case 'CTB':
        return CTB.getAllCTBStopETA(stopId);
      default:
        return [];
    }
  });

  const results = await Promise.all(promises);
  return results.flat();
}
