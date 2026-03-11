import { Route, BusStop, ETA, RouteETAItem } from '../types';

const BASE_URL = 'https://rt.data.gov.hk/v1/transport/citybus-nwfb';

export async function getCTBRoutes(routeNumber: string): Promise<Route[]> {
  try {
    const upperRoute = routeNumber.toUpperCase();
    // Fetch specific route
    const response = await fetch(`${BASE_URL}/route/ctb/${upperRoute}`);
    if (response.ok) {
      const data = await response.json();
      if (data.data) {
        const rawData = data.data;
        // Check if data is empty object or null
        if (!rawData || (typeof rawData === 'object' && !Array.isArray(rawData) && Object.keys(rawData).length === 0)) {
            return [];
        }

        const routes = Array.isArray(rawData) ? rawData : [rawData];
        
        // Filter out invalid routes (must have route number)
        const validRoutes = routes.filter((r: any) => r && r.route);
        
        if (validRoutes.length === 0) return [];
        
        // Generate Outbound and Inbound variants for each route
        const variants: Route[] = [];
        validRoutes.forEach((r: any) => {
            // Outbound
            variants.push({
                ...r,
                bound: 'O',
                service_type: '1',
                company: 'CTB',
                orig_en: r.orig_en,
                orig_tc: r.orig_tc,
                orig_sc: r.orig_sc,
                dest_en: r.dest_en,
                dest_tc: r.dest_tc,
                dest_sc: r.dest_sc,
            });
            // Inbound (swap orig/dest for display, though API uses same route object)
            variants.push({
                ...r,
                bound: 'I',
                service_type: '1',
                company: 'CTB',
                orig_en: r.dest_en, // Swap for display
                orig_tc: r.dest_tc,
                orig_sc: r.dest_sc,
                dest_en: r.orig_en,
                dest_tc: r.orig_tc,
                dest_sc: r.orig_sc,
            });
        });
        return variants;
      }
    }
    return [];
  } catch (error) {
    console.error('Error fetching CTB route:', error);
    return [];
  }
}

export async function getCTBRouteStops(route: string, direction: string, serviceType: string) {
  try {
    const dir = direction === 'O' ? 'outbound' : 'inbound';
    // 1. Get stop IDs
    const response = await fetch(`${BASE_URL}/route-stop/ctb/${route}/${dir}`);
    if (!response.ok) return [];
    const data = await response.json();
    const stopsList = data.data;

    if (!stopsList || stopsList.length === 0) return [];

    // 2. Fetch details
    const stopDetailsPromises = stopsList.map(async (s: any) => {
      try {
        const detailResponse = await fetch(`${BASE_URL}/stop/${s.stop}`);
        const detailData = await detailResponse.json();
        return { 
            ...s, 
            ...detailData.data,
            // Map Citybus stop detail fields to BusStop interface
            name_en: detailData.data.name_en,
            name_tc: detailData.data.name_tc,
            name_sc: detailData.data.name_sc,
            lat: detailData.data.lat,
            long: detailData.data.long,
        };
      } catch (e) {
        console.error(`Error fetching CTB stop detail for ${s.stop}`, e);
        return s;
      }
    });

    const stops = await Promise.all(stopDetailsPromises);
    return stops as BusStop[];
  } catch (error) {
    console.error('Error fetching CTB route stops:', error);
    return [];
  }
}

export async function getCTBRouteETA(route: string, serviceType: string) {
    // Citybus doesn't have a route-eta endpoint that returns all ETAs for a route in one go easily?
    // Or maybe it does? The documentation mentions /eta/ctb/{stop_id}/{route}.
    // It doesn't seem to have a "get all ETAs for route" endpoint.
    // So we might return empty and let the individual stop ETA fetching handle it.
    return [];
}

export async function getCTBStopETA(stopId: string, route: string, serviceType: string) {
  try {
    const response = await fetch(`${BASE_URL}/eta/ctb/${stopId}/${route}`);
    if (!response.ok) return [];
    const data = await response.json();
    // Filter by direction if needed? The response includes 'dir'.
    // We can return all and let the UI filter, or filter here.
    // The UI expects ETA[] which has 'dir'.
    return data.data as ETA[];
  } catch (error) {
    console.error('Error fetching CTB ETA:', error);
    return [];
  }
}

export async function getAllCTBStopETA(stopId: string) {
  try {
    const response = await fetch(`${BASE_URL}/eta/ctb/${stopId}`);
    if (!response.ok) return [];
    const data = await response.json();
    return data.data as ETA[];
  } catch (error) {
    console.error('Error fetching all CTB ETAs for stop:', error);
    return [];
  }
}
