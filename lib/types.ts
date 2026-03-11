export interface Route {
  route: string;
  bound: string;
  service_type: string;
  orig_en: string;
  orig_tc: string;
  orig_sc: string;
  dest_en: string;
  dest_tc: string;
  dest_sc: string;
  company?: 'KMB' | 'LWB' | 'CTB' | 'NLB';
  companies?: ('KMB' | 'LWB' | 'CTB' | 'NLB')[];
  companyBounds?: Record<string, string>; // Maps company to its bound ('O' or 'I') for this route variant
  routeId?: string;
}

export interface BusStop {
  stop: string;
  route?: string;
  bound?: string;
  service_type?: string;
  seq?: string | number;
  name_en: string;
  name_tc: string;
  name_sc: string;
  lat: string;
  long: string;
  companyStops?: Record<string, BusStop>;
}

export interface ETA {
  co: string;
  route: string;
  dir: string;
  service_type: number;
  seq: number;
  dest_tc: string;
  dest_en: string;
  dest_sc: string;
  eta_seq: number;
  eta: string | null;
  rmk_tc: string;
  rmk_en: string;
  rmk_sc: string;
  data_timestamp: string;
}

export interface RouteETAItem {
  co: string;
  route: string;
  dir: string;
  service_type: number;
  seq: number;
  dest_tc: string;
  dest_sc: string;
  dest_en: string;
  eta_seq: number;
  eta: string | null;
  rmk_tc: string;
  rmk_sc: string;
  rmk_en: string;
  data_timestamp: string;
}

export interface Coordinates {
  latitude: number;
  longitude: number;
}
