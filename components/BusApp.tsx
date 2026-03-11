'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { Search, MapPin, Navigation, Bus, Clock, RefreshCw, Star } from 'lucide-react';
import { getRoute, getRouteStops, getStopETA, getRouteETA, getAllStopETAs } from '@/lib/api';
import { Route, BusStop, ETA, Coordinates, RouteETAItem } from '@/lib/types';
import { getDistance } from 'geolib';
import { motion, AnimatePresence } from 'motion/react';

export default function BusApp() {
  const [routeInput, setRouteInput] = useState('');
  const [routes, setRoutes] = useState<Route[]>([]);
  const [selectedRoute, setSelectedRoute] = useState<Route | null>(null);
  const [stops, setStops] = useState<BusStop[]>([]);
  const [routeETAs, setRouteETAs] = useState<RouteETAItem[]>([]);
  // nearestStop is now a derived value using useMemo
  const [nearestStopETA, setNearestStopETA] = useState<ETA[]>([]);
  const [otherBusesETA, setOtherBusesETA] = useState<ETA[]>([]);
  const [userLocation, setUserLocation] = useState<Coordinates | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingStops, setLoadingStops] = useState(false);
  const [loadingETA, setLoadingETA] = useState(false);
  const [error, setError] = useState('');
  const [favoriteRoutes, setFavoriteRoutes] = useState<Route[]>([]);

  // Load favorites from localStorage
  useEffect(() => {
    const stored = localStorage.getItem('favoriteRoutes');
    if (stored) {
      try {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setFavoriteRoutes(JSON.parse(stored));
      } catch (e) {
        console.error('Failed to parse favorites', e);
      }
    }
  }, []);

  const toggleFavorite = (route: Route, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    
    const routeId = `${route.route}-${route.bound}-${route.service_type}-${route.company}`;
    const isFav = favoriteRoutes.some(r => `${r.route}-${r.bound}-${r.service_type}-${r.company}` === routeId);
    
    let newFavs;
    if (isFav) {
      newFavs = favoriteRoutes.filter(r => `${r.route}-${r.bound}-${r.service_type}-${r.company}` !== routeId);
    } else {
      newFavs = [...favoriteRoutes, route];
    }
    
    setFavoriteRoutes(newFavs);
    localStorage.setItem('favoriteRoutes', JSON.stringify(newFavs));
  };

  const isFavorite = (route: Route) => {
    const routeId = `${route.route}-${route.bound}-${route.service_type}-${route.company}`;
    return favoriteRoutes.some(r => `${r.route}-${r.bound}-${r.service_type}-${r.company}` === routeId);
  };

  // Get user location on mount
  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setUserLocation({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
          });
        },
        (err) => {
          console.error('Error getting location:', err);
          // Don't show error to user immediately, just fail silently or show "Location disabled"
        },
        { enableHighAccuracy: true }
      );
    }
  }, []);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!routeInput.trim()) return;

    setLoading(true);
    setError('');
    setRoutes([]);
    setSelectedRoute(null);
    setStops([]);
    setNearestStopETA([]);
    setOtherBusesETA([]);

    const result = await getRoute(routeInput.trim());
    setLoading(false);

    if (result && result.length > 0) {
      // Sort by company, then service type
      const sortedRoutes = result.sort((a, b) => {
        if (a.company !== b.company) return (a.company || '').localeCompare(b.company || '');
        return parseInt(a.service_type || '0') - parseInt(b.service_type || '0');
      });
      setRoutes(sortedRoutes);
    } else {
      setError('找不到此路線 (Route not found)');
    }
  };

  const handleSelectRoute = async (route: Route) => {
    setSelectedRoute(route);
    setLoadingStops(true);
    setStops([]);
    setNearestStopETA([]);
    setOtherBusesETA([]);
    setRouteETAs([]);

    let fetchedStops: BusStop[] = [];
    let fetchedETAs: RouteETAItem[] = [];

    const companies = route.companies || [route.company!];

    // If multiple companies, fetch stops from all and merge
    if (companies.length > 1) {
        // Fetch stops for each company
        const stopsPromises = companies.map(async (company) => {
            const bound = route.companyBounds?.[company] || route.bound;
            const companyRoute = { ...route, company, bound };
            const stops = await getRouteStops(companyRoute);
            return { company, stops };
        });
        
        const results = await Promise.all(stopsPromises);
        
        // Use the first company's stops as base
        // Or try to merge intelligently. For simplicity, use the one with most stops?
        // Or just the first one. Let's use the first one as base.
        // Actually, let's use the one with most stops to be safe, or just the first one.
        // Usually joint routes have same stops.
        const baseResult = results[0];
        if (!baseResult) return;

        fetchedStops = baseResult.stops.map(s => ({
            ...s,
            companyStops: { [baseResult.company!]: s }
        }));

        // Merge other companies' stops
        for (let i = 1; i < results.length; i++) {
            const { company, stops } = results[i];
            if (!company) continue;

            stops.forEach((s, idx) => {
                // Try to match by name (TC)
                let match = fetchedStops.find(fs => fs.name_tc === s.name_tc);
                
                // If no name match, try proximity match (within 100m)
                if (!match) {
                    match = fetchedStops.find(fs => {
                        // Skip if already matched to this company (to avoid double mapping)
                        if (fs.companyStops && fs.companyStops[company]) return false;
                        
                        const dist = getDistance(
                            { latitude: parseFloat(fs.lat), longitude: parseFloat(fs.long) },
                            { latitude: parseFloat(s.lat), longitude: parseFloat(s.long) }
                        );
                        return dist < 100;
                    });
                }

                if (match) {
                    if (!match.companyStops) match.companyStops = {};
                    match.companyStops[company] = s;
                } else {
                    // If still no match, it might be a stop unique to this company.
                    // Ideally we should insert it, but sequence is tricky.
                    // For now, we skip, which explains why some stops might be missing if they are unique to the non-base company.
                }
            });
        }
    } else {
        // Single company
        fetchedStops = await getRouteStops(route);
    }

    // Fetch ETAs
    // If KMB/LWB is involved, we can fetch route ETA for them
    // If CTB/NLB, we fetch per stop later (or here if we want to pre-fetch)
    // For joint routes, we might need to fetch route ETA for KMB part, and per-stop for CTB part.
    
    // Let's just fetch route ETA for KMB/LWB if present
    if (companies.includes('KMB') || companies.includes('LWB')) {
        // Find which company is KMB/LWB
        const kmbCo = companies.find(c => c === 'KMB' || c === 'LWB');
        if (kmbCo) {
            const etas = await getRouteETA({ ...route, company: kmbCo });
            fetchedETAs = etas.map(e => ({ ...e, co: kmbCo }));
        }
    }
    
    // For CTB/NLB, we usually fetch per stop. 
    // If we want to show ETAs in the list immediately for CTB, we need to fetch them.
    // Let's do what we did before: fetch all stop ETAs for CTB if it's the only company or if we want to support it.
    // But for joint routes, we might have mixed ETAs.
    // Let's fetch CTB ETAs here too if present.
    if (companies.includes('CTB')) {
        // We need to fetch ETAs for each stop that has a CTB mapping
        // This can be heavy. Maybe do it only if CTB is the *only* company?
        // Or do it for all.
        // Let's do it for all to be consistent.
        const ctbStops = fetchedStops.filter(s => s.companyStops && s.companyStops['CTB']);
        // If single company CTB, companyStops might be undefined, so handle that
        const stopsToFetch = companies.length > 1 ? ctbStops : fetchedStops;
        
        const etaPromises = stopsToFetch.map(async (stop) => {
            const stopId = companies.length > 1 ? stop.companyStops?.['CTB']?.stop : stop.stop;
            if (!stopId) return [];
            
            // Use the stop object that has the correct ID
            const stopObj = companies.length > 1 ? stop.companyStops!['CTB'] : stop;
            
            const bound = route.companyBounds?.['CTB'] || route.bound;
            const etas = await getStopETA(stopObj, { ...route, company: 'CTB', bound });
            return etas
                .filter(e => e.dir === bound)
                .map(e => ({
                    ...e,
                    service_type: parseInt(route.service_type),
                    seq: parseInt(stop.seq?.toString() || '0'),
                    co: 'CTB' // Ensure company is set
                } as any));
        });
        
        const ctbResults = await Promise.all(etaPromises);
        fetchedETAs = [...fetchedETAs, ...ctbResults.flat()];
    }

    setStops(fetchedStops);
    
    if (fetchedETAs && fetchedETAs.length > 0) {
      const filteredETAs = fetchedETAs.filter(eta => {
          const co = eta.co || route.company;
          const bound = route.companyBounds?.[co!] || route.bound;
          return !eta.dir || eta.dir === bound;
      });
      setRouteETAs(filteredETAs);
    }
    setLoadingStops(false);
  };

  // Find nearest stop when stops or userLocation changes
  const nearestStop: any = useMemo(() => {
    if (stops.length === 0 || !userLocation) return null;

    let minDistance = Infinity;
    let nearest: BusStop | null = null;

    stops.forEach((stop) => {
      const dist = getDistance(
        { latitude: userLocation.latitude, longitude: userLocation.longitude },
        { latitude: parseFloat(stop.lat), longitude: parseFloat(stop.long) }
      );
      if (dist < minDistance) {
        minDistance = dist;
        nearest = stop;
      }
    });

    return nearest;
  }, [stops, userLocation]);

  const fetchETA = useCallback(async (stop: BusStop) => {
    if (!selectedRoute) return;
    setLoadingETA(true);
    
    let etas: ETA[] = [];
    const companies = selectedRoute.companies || [selectedRoute.company!];

    // Fetch ETAs from all relevant companies for this stop
    const etaPromises = companies.map(async (company) => {
        // Find the stop object for this company
        let stopObj = stop;
        if (stop.companyStops && stop.companyStops[company]) {
            stopObj = stop.companyStops[company];
        } else if (company !== selectedRoute.company && companies.length > 1) {
            // If we don't have a mapping, and it's a joint route, we might not be able to fetch ETA for this company at this stop
            // unless we assume the stop ID is same (unlikely) or we skip.
            // However, if it's the base company (selectedRoute.company), we use 'stop'.
            return [];
        }

        const bound = selectedRoute.companyBounds?.[company] || selectedRoute.bound;
        const companyRoute = { ...selectedRoute, company, bound };
        const companyEtas = await getStopETA(stopObj, companyRoute);
        return companyEtas.map(e => ({ ...e, co: company }));
    });

    const results = await Promise.all(etaPromises);
    etas = results.flat();
    
    // Filter ETAs
    const filteredETAs = etas.filter(e => {
        const bound = selectedRoute.companyBounds?.[e.co!] || selectedRoute.bound;
        if (e.co === 'KMB' || e.co === 'LWB') {
            return e.dir === bound && e.service_type === parseInt(selectedRoute.service_type);
        }
        if (e.co === 'CTB') {
             return e.dir === bound;
        }
        return true;
    });
    
    // Sort by time
    filteredETAs.sort((a, b) => {
        const timeA = a.eta ? new Date(a.eta).getTime() : Number.MAX_SAFE_INTEGER;
        const timeB = b.eta ? new Date(b.eta).getTime() : Number.MAX_SAFE_INTEGER;
        return timeA - timeB;
    });
    
    setNearestStopETA(filteredETAs);

    // Fetch all ETAs for other buses
    try {
        const allEtas = await getAllStopETAs(stop);
        // Filter out the currently selected route
        const others = allEtas.filter(e => e.route !== selectedRoute.route);
        
        // Group by route and direction, then pick the nearest one for each
        const groupedOthers: Record<string, ETA> = {};
        others.forEach(e => {
            const key = `${e.co}-${e.route}-${e.dir}`;
            if (!e.eta) return;
            const time = new Date(e.eta).getTime();
            if (!groupedOthers[key] || time < new Date(groupedOthers[key].eta!).getTime()) {
                groupedOthers[key] = e;
            }
        });

        const sortedOthers = Object.values(groupedOthers).sort((a, b) => {
            const timeA = new Date(a.eta!).getTime();
            const timeB = new Date(b.eta!).getTime();
            return timeA - timeB;
        });

        setOtherBusesETA(sortedOthers);
    } catch (err) {
        console.error('Error fetching other buses ETAs:', err);
    }

    setLoadingETA(false);
  }, [selectedRoute]);

  // Fetch ETA for nearest stop
  useEffect(() => {
    if (nearestStop && selectedRoute) {
      // Use setTimeout to avoid synchronous state update warning
      const timer = setTimeout(() => {
        fetchETA(nearestStop);
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [nearestStop, selectedRoute, fetchETA]);

  const formatTime = (timestamp: string | null) => {
    if (!timestamp) return '---';
    const date = new Date(timestamp);
    const now = new Date();
    const diff = Math.floor((date.getTime() - now.getTime()) / 60000);
    if (diff <= 0) return '即將到達 (Arriving)';
    return `${diff} 分鐘 (min)`;
  };

  const getCompanyColor = (company?: string) => {
    switch (company) {
      case 'KMB': return 'bg-red-600';
      case 'LWB': return 'bg-orange-500';
      case 'CTB': return 'bg-yellow-500'; // Citybus yellow
      case 'NLB': return 'bg-green-600'; // Lantau green
      default: return 'bg-gray-600';
    }
  };

  const getCompanyName = (company?: string) => {
    switch (company) {
      case 'KMB': return '九巴';
      case 'LWB': return '龍運';
      case 'CTB': return '城巴';
      case 'NLB': return '嶼巴';
      default: return company;
    }
  };

  return (
    <div className="max-w-md mx-auto min-h-screen bg-gray-50 flex flex-col font-sans">
      {/* Header */}
      <header className="bg-slate-800 text-white p-4 shadow-md sticky top-0 z-10">
        <h1 className="text-xl font-bold flex items-center gap-2">
          <Bus className="w-6 h-6" />
          HK Bus ETA
        </h1>
      </header>

      <main className="flex-1 p-4 space-y-6">
        {/* Search */}
        <form onSubmit={handleSearch} className="relative">
          <input
            type="text"
            value={routeInput}
            onChange={(e) => setRouteInput(e.target.value)}
            placeholder="輸入路線號碼 (e.g. 1A, 968, E33)"
            className="w-full p-4 pr-12 rounded-xl border border-gray-200 shadow-sm text-lg focus:outline-none focus:ring-2 focus:ring-slate-500"
          />
          <button
            type="submit"
            className="absolute right-2 top-2 bottom-2 bg-slate-800 text-white p-2 rounded-lg hover:bg-slate-700 transition-colors"
            disabled={loading}
          >
            {loading ? <RefreshCw className="w-6 h-6 animate-spin" /> : <Search className="w-6 h-6" />}
          </button>
        </form>

        {error && (
          <div className="p-4 bg-red-50 text-red-600 rounded-xl border border-red-100">
            {error}
          </div>
        )}

        {/* Favorite Routes */}
        {!selectedRoute && routes.length === 0 && !loading && !error && favoriteRoutes.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-2">
                <Star className="w-4 h-4 fill-yellow-400 text-yellow-400" />
                收藏路線 (Favorites)
            </h2>
            <div className="grid gap-3">
              {favoriteRoutes.map((route, index) => (
                <motion.button
                  key={`fav-${route.company}-${route.route}-${route.bound}-${route.service_type}-${index}`}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => handleSelectRoute(route)}
                  className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 text-left hover:border-yellow-200 transition-colors relative group"
                >
                  <div className="absolute top-4 right-4 z-10" onClick={(e) => toggleFavorite(route, e)}>
                    <Star className="w-6 h-6 fill-yellow-400 text-yellow-400" />
                  </div>
                  <div className="flex justify-between items-center pr-8">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        {route.companies && route.companies.length > 0 ? (
                            route.companies.map(co => (
                                <span key={co} className={`text-xs font-bold text-white px-2 py-0.5 rounded ${getCompanyColor(co)}`}>
                                    {co}
                                </span>
                            ))
                        ) : (
                            <span className={`text-xs font-bold text-white px-2 py-0.5 rounded ${getCompanyColor(route.company)}`}>
                                {route.company}
                            </span>
                        )}
                        <div className="text-2xl font-bold text-gray-900">{route.route}</div>
                      </div>
                      <div className="text-gray-600">往 {route.dest_tc}</div>
                      <div className="text-xs text-gray-400 mt-1">To {route.dest_en}</div>
                    </div>
                  </div>
                </motion.button>
              ))}
            </div>
          </div>
        )}

        {/* Route Selection */}
        {!selectedRoute && routes.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">選擇方向 (Select Direction)</h2>
            <div className="grid gap-3">
              {routes.map((route, index) => (
                <motion.button
                  key={`${route.company}-${route.route}-${route.bound}-${route.service_type}-${index}`}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => handleSelectRoute(route)}
                  className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 text-left hover:border-slate-200 transition-colors relative"
                >
                  <div className="absolute top-4 right-12 z-10" onClick={(e) => toggleFavorite(route, e)}>
                    <Star className={`w-6 h-6 ${isFavorite(route) ? 'fill-yellow-400 text-yellow-400' : 'text-gray-300 hover:text-yellow-400'}`} />
                  </div>
                  <div className="flex justify-between items-center">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        {route.companies && route.companies.length > 0 ? (
                            route.companies.map(co => (
                                <span key={co} className={`text-xs font-bold text-white px-2 py-0.5 rounded ${getCompanyColor(co)}`}>
                                    {co}
                                </span>
                            ))
                        ) : (
                            <span className={`text-xs font-bold text-white px-2 py-0.5 rounded ${getCompanyColor(route.company)}`}>
                                {route.company}
                            </span>
                        )}
                        <div className="text-2xl font-bold text-gray-900">{route.route}</div>
                      </div>
                      <div className="text-gray-600">往 {route.dest_tc}</div>
                      <div className="text-xs text-gray-400 mt-1">To {route.dest_en}</div>
                    </div>
                    <Navigation className="w-5 h-5 text-gray-400" />
                  </div>
                  {route.service_type !== '1' && (
                    <div className="mt-2 inline-block px-2 py-1 bg-yellow-100 text-yellow-800 text-xs rounded-full">
                      特別班次 (Special)
                    </div>
                  )}
                </motion.button>
              ))}
            </div>
          </div>
        )}

        {/* Selected Route Info & Nearest Stop */}
        {selectedRoute && (
          <div className="space-y-6">
            <button
              onClick={() => {
                setSelectedRoute(null);
                setStops([]);
                setNearestStopETA([]);
                setOtherBusesETA([]);
              }}
              className="text-sm text-gray-500 flex items-center gap-1 hover:text-gray-900"
            >
              ← 返回路線選擇 (Back)
            </button>

            <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-200">
              <div className="flex justify-between items-center">
                  <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                    <div className="flex gap-1">
                        {selectedRoute.companies && selectedRoute.companies.length > 0 ? (
                            selectedRoute.companies.map(co => (
                                <span key={co} className={`${getCompanyColor(co)} text-white px-2 py-1 rounded-md text-lg`}>{selectedRoute.route}</span>
                            ))
                        ) : (
                            <span className={`${getCompanyColor(selectedRoute.company)} text-white px-2 py-1 rounded-md text-lg`}>{selectedRoute.route}</span>
                        )}
                    </div>
                    <span>往 {selectedRoute.dest_tc}</span>
                  </h2>
                  <button onClick={(e) => toggleFavorite(selectedRoute, e)} className="p-2">
                    <Star className={`w-6 h-6 ${isFavorite(selectedRoute) ? 'fill-yellow-400 text-yellow-400' : 'text-gray-300 hover:text-yellow-400'}`} />
                  </button>
              </div>
            </div>

            {loadingStops ? (
              <div className="flex justify-center py-8">
                <RefreshCw className="w-8 h-8 text-gray-400 animate-spin" />
              </div>
            ) : (
              <>
                {/* Nearest Stop Card */}
                {nearestStop ? (
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-slate-900 text-white p-6 rounded-2xl shadow-lg relative overflow-hidden"
                  >
                    <div className="absolute top-0 right-0 p-4 opacity-10">
                      <MapPin className="w-32 h-32" />
                    </div>
                    
                    <div className="relative z-10">
                      <div className="flex items-center gap-2 text-slate-400 mb-2">
                        <MapPin className="w-5 h-5" />
                        <span className="font-bold tracking-wide uppercase text-xs">最近車站 (Nearest Stop)</span>
                      </div>
                      
                      <h3 className="text-2xl font-bold mb-1">{nearestStop.name_tc}</h3>
                      <p className="text-slate-400 text-sm mb-6">{nearestStop.name_en}</p>

                      <div className="space-y-4">
                        {loadingETA ? (
                          <div className="animate-pulse h-8 bg-slate-700 rounded w-1/2"></div>
                        ) : nearestStopETA.length > 0 ? (
                          nearestStopETA.map((eta, idx) => (
                            <div key={idx} className="flex justify-between items-end border-b border-slate-700 pb-2 last:border-0">
                              <div>
                                <div className="text-3xl font-mono font-bold text-white flex items-baseline gap-2">
                                  {formatTime(eta.eta)}
                                  <span className="text-3xl font-normal text-gray-400">
                                    {getCompanyName(eta.co)}
                                  </span>
                                </div>
                                <div className="text-xs text-slate-500 mt-1">
                                  {eta.eta ? new Date(eta.eta).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : ''}
                                </div>
                              </div>
                              {eta.rmk_tc && (
                                <div className="text-sm text-yellow-400">{eta.rmk_tc}</div>
                              )}
                            </div>
                          ))
                        ) : (
                          <div className="text-slate-400">暫時沒有班次資料 (No ETA data)</div>
                        )}
                      </div>

                      {/* Other Buses Section */}
                      {otherBusesETA.length > 0 && (
                        <div className="mt-8 pt-6 border-t border-slate-700">
                          <div className="flex items-center gap-2 text-slate-400 mb-4">
                            <Bus className="w-4 h-4" />
                            <span className="font-bold tracking-wide uppercase text-[10px]">其他路線 (Other Routes)</span>
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            {otherBusesETA.slice(0, 6).map((eta, idx) => (
                              <div key={idx} className="bg-white/5 rounded-lg p-3 border border-white/10">
                                <div className="flex items-center justify-between mb-1">
                                  <span className="text-lg font-bold text-white">{eta.route}</span>
                                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold text-white ${getCompanyColor(eta.co)}`}>
                                    {eta.co}
                                  </span>
                                </div>
                                <div className="text-blue-400 font-mono font-bold text-sm">
                                  {formatTime(eta.eta)}
                                </div>
                                <div className="text-[10px] text-slate-500 truncate">
                                  往 {eta.dest_tc || '---'}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      <button 
                        onClick={() => fetchETA(nearestStop!)}
                        className="mt-6 w-full py-3 bg-white/10 hover:bg-white/20 rounded-xl flex items-center justify-center gap-2 transition-colors text-sm font-medium"
                      >
                        <RefreshCw className={`w-4 h-4 ${loadingETA ? 'animate-spin' : ''}`} />
                        更新時間 (Refresh)
                      </button>
                    </div>
                  </motion.div>
                ) : (
                  !userLocation && (
                    <div className="p-4 bg-yellow-50 text-yellow-800 rounded-xl text-sm">
                      請允許定位權限以顯示最近車站 (Please enable location)
                    </div>
                  )
                )}

                {/* All Stops List */}
                <div className="space-y-4">
                  <h3 className="font-bold text-gray-900 px-2 text-lg">所有車站 (All Stops)</h3>
                  <div className="space-y-3">
                    {stops.map((stop, index) => {
                      // Filter route ETAs for this stop
                      let stopETAs: RouteETAItem[] = [];
                      if (['KMB', 'LWB', 'CTB'].includes(selectedRoute.company || '')) {
                          stopETAs = routeETAs
                            .filter(eta => eta.seq === parseInt(stop.seq?.toString() || '-1'))
                            .sort((a, b) => {
                                const timeA = a.eta ? new Date(a.eta).getTime() : Number.MAX_SAFE_INTEGER;
                                const timeB = b.eta ? new Date(b.eta).getTime() : Number.MAX_SAFE_INTEGER;
                                return timeA - timeB;
                            })
                            .slice(0, 3);
                      }

                      return (
                        <div 
                          key={`${stop.stop}-${index}`} 
                          className={`bg-white p-4 rounded-xl shadow-sm border border-gray-200 ${nearestStop?.stop === stop.stop ? 'ring-2 ring-slate-500 ring-offset-2' : ''}`}
                        >
                          <div className="flex items-start gap-3 mb-3">
                            <div className="w-8 h-8 rounded-full bg-gray-100 border border-gray-200 flex items-center justify-center text-sm font-mono font-bold text-gray-600 shrink-0">
                              {index + 1}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="font-bold text-gray-900 text-lg leading-tight">{stop.name_tc}</div>
                              <div className="text-sm text-gray-500 truncate">{stop.name_en}</div>
                            </div>
                            {nearestStop?.stop === stop.stop && (
                              <div className="text-slate-500 shrink-0 bg-slate-50 p-1.5 rounded-lg">
                                <MapPin className="w-5 h-5" />
                              </div>
                            )}
                          </div>

                          {/* ETAs Grid */}
                          {(['KMB', 'LWB', 'CTB'].includes(selectedRoute.company || '')) && (
                              <div className="grid grid-cols-3 gap-2 pl-11">
                                {stopETAs.length > 0 ? (
                                  stopETAs.map((eta, i) => (
                                    <div key={i} className="bg-gray-50 p-2 rounded-lg text-center border border-gray-100">
                                      <div className="text-blue-600 font-bold font-mono text-sm flex flex-col items-center">
                                        <span>{formatTime(eta.eta)}</span>
                                        <span className="text-sm font-normal text-gray-400 mt-1">
                                          {getCompanyName(eta.co)}
                                        </span>
                                      </div>
                                      <div className="text-[10px] text-gray-400 mt-0.5">
                                        {eta.eta ? new Date(eta.eta).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : ''}
                                      </div>
                                    </div>
                                  ))
                                ) : (
                                  <div className="col-span-3 text-sm text-gray-400 italic py-2 bg-gray-50 rounded-lg text-center">
                                    暫時沒有班次資訊 (No ETA)
                                  </div>
                                )}
                              </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
