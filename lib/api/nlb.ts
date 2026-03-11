import { Route, BusStop, ETA, RouteETAItem } from '../types';

const BASE_URL = 'https://rt.data.gov.hk/v2/transport/nlb';

export async function getNLBRoutes(routeNumber: string): Promise<Route[]> {
  try {
    const upperRoute = routeNumber.toUpperCase();
    const response = await fetch(`${BASE_URL}/route.php?action=list`);
    if (!response.ok) return [];
    const data = await response.json();
    const allRoutes = data.routes;

    if (!Array.isArray(allRoutes)) return [];

    const matchedRoutes = allRoutes.filter((r: any) => r.routeNo === upperRoute);

    return matchedRoutes.map((r: any) => {
        // Parse routeName_c "Origin > Destination"
        const names = r.routeName_c.split('>');
        const orig_tc = names[0]?.trim() || r.routeName_c;
        const dest_tc = names[1]?.trim() || '';
        
        const namesEn = r.routeName_e.split('>');
        const orig_en = namesEn[0]?.trim() || r.routeName_e;
        const dest_en = namesEn[1]?.trim() || '';

        return {
            route: r.routeNo,
            bound: 'O', // NLB routes are usually specific IDs per direction, so we can just say 'O' for all and use routeId to distinguish
            service_type: '1',
            company: 'NLB',
            routeId: r.routeId,
            orig_tc,
            dest_tc,
            orig_en,
            dest_en,
            orig_sc: orig_tc, // Fallback
            dest_sc: dest_tc, // Fallback
        };
    });
  } catch (error) {
    console.error('Error fetching NLB route:', error);
    return [];
  }
}

export async function getNLBRouteStops(route: string, direction: string, serviceType: string, routeId?: string) {
  try {
    if (!routeId) return [];
    const response = await fetch(`${BASE_URL}/stop.php?action=list&routeId=${routeId}`);
    if (!response.ok) return [];
    const data = await response.json();
    const stops = data.stops;

    if (!Array.isArray(stops)) return [];

    return stops.map((s: any) => ({
        stop: s.stopId,
        name_en: s.stopName_e,
        name_tc: s.stopName_c,
        name_sc: s.stopName_s,
        lat: s.latitude,
        long: s.longitude,
        seq: s.stopLocationId, // Or some sequence field? API returns stops in order usually.
    })) as BusStop[];
  } catch (error) {
    console.error('Error fetching NLB route stops:', error);
    return [];
  }
}

export async function getNLBRouteETA(route: string, serviceType: string) {
    return [];
}

export async function getNLBStopETA(stopId: string, route: string, serviceType: string, routeId?: string) {
  try {
    if (!routeId) return [];
    const response = await fetch(`${BASE_URL}/stop.php?action=estimate&routeId=${routeId}&stopId=${stopId}`);
    if (!response.ok) return [];
    const data = await response.json();
    const estimates = data.estimatedArrivals;

    if (!Array.isArray(estimates)) return [];

    return estimates.map((e: any, index: number) => ({
        co: 'NLB',
        route: route,
        dir: 'O',
        service_type: 1,
        seq: 0,
        dest_tc: '', // NLB ETA might not return dest
        dest_en: '',
        dest_sc: '',
        eta: e.estimatedArrivalTime,
        eta_seq: index + 1,
        rmk_tc: '',
        rmk_en: '',
        rmk_sc: '',
        data_timestamp: e.generateTime,
    })) as ETA[];
  } catch (error) {
    console.error('Error fetching NLB ETA:', error);
    return [];
  }
}
