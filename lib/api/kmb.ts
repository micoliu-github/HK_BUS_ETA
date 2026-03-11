import { Route, BusStop, ETA, RouteETAItem } from '../types';

const BASE_URL = 'https://data.etabus.gov.hk/v1/transport/kmb';

export async function getKMBRoutes(routeNumber: string): Promise<Route[]> {
  try {
    const upperRoute = routeNumber.toUpperCase();
    // Try specific endpoint first
    const response = await fetch(`${BASE_URL}/route/${upperRoute}`);
    if (response.ok) {
      const data = await response.json();
      if (data.data && data.data.length > 0) {
        return data.data.map((r: any) => ({ ...r, company: 'KMB' })) as Route[];
      }
    }

    // Fallback: Fetch all routes and filter
    console.warn(`KMB Route ${upperRoute} not found via direct endpoint, fetching all routes...`);
    const allResponse = await fetch(`${BASE_URL}/route/`);
    if (!allResponse.ok) return [];
    const allData = await allResponse.json();
    const allRoutes = allData.data as Route[];
    return allRoutes
      .filter(r => r.route === upperRoute)
      .map(r => ({ ...r, company: 'KMB' }));
  } catch (error) {
    console.error('Error fetching KMB route:', error);
    return [];
  }
}

export async function getKMBRouteStops(route: string, direction: string, serviceType: string) {
  try {
    const bound = direction === 'O' ? 'outbound' : direction === 'I' ? 'inbound' : direction;
    // 1. Get the list of stop IDs for the route
    const response = await fetch(`${BASE_URL}/route-stop/${route}/${bound}/${serviceType}`);
    if (!response.ok) return [];
    const data = await response.json();
    const stopsList = data.data;

    // 2. Fetch details for each stop
    const stopDetailsPromises = stopsList.map(async (s: any) => {
      try {
        const detailResponse = await fetch(`${BASE_URL}/stop/${s.stop}`);
        const detailData = await detailResponse.json();
        return { ...s, ...detailData.data };
      } catch (e) {
        console.error(`Error fetching stop detail for ${s.stop}`, e);
        return s;
      }
    });

    const stops = await Promise.all(stopDetailsPromises);
    return stops as BusStop[];
  } catch (error) {
    console.error('Error fetching KMB route stops:', error);
    return [];
  }
}

export async function getKMBRouteETA(route: string, serviceType: string) {
  try {
    const response = await fetch(`${BASE_URL}/route-eta/${route}/${serviceType}`);
    if (!response.ok) return [];
    const data = await response.json();
    return data.data as RouteETAItem[];
  } catch (error) {
    console.error('Error fetching KMB route ETA:', error);
    return [];
  }
}

export async function getKMBStopETA(stopId: string, route: string, serviceType: string) {
  try {
    const response = await fetch(`${BASE_URL}/eta/${stopId}/${route}/${serviceType}`);
    if (!response.ok) return [];
    const data = await response.json();
    return data.data as ETA[];
  } catch (error) {
    console.error('Error fetching KMB ETA:', error);
    return [];
  }
}

export async function getAllKMBStopETA(stopId: string) {
  try {
    const response = await fetch(`${BASE_URL}/stop-eta/${stopId}`);
    if (!response.ok) return [];
    const data = await response.json();
    return data.data as ETA[];
  } catch (error) {
    console.error('Error fetching all KMB ETAs for stop:', error);
    return [];
  }
}
