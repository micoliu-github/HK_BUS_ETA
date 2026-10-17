'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { Search, MapPin, Navigation, Bus, Clock, RefreshCw, Star, ChevronRight, Map as MapIcon } from 'lucide-react';
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
    <div className="max-w-md mx-auto min-h-screen bg-slate-950 flex flex-col font-sans selection:bg-blue-500/30 text-slate-200">
      {/* Header */}
      <header className="bg-slate-900/50 backdrop-blur-xl text-white p-5 sticky top-0 z-30 border-b border-white/10 overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-blue-500/50 to-transparent animate-pulse" />
        <div className="flex items-center justify-between relative z-10">
          <div className="flex items-center gap-3">
            <div className="bg-blue-600 p-2 rounded-xl shadow-lg shadow-blue-600/20 relative overflow-hidden group">
              <div className="absolute inset-0 bg-white/20 -translate-x-full group-hover:translate-x-full transition-transform duration-1000" />
              <Bus className="w-5 h-5 text-white" />
            </div>
            <div className="flex flex-col">
              <h1 className="text-lg font-black tracking-tighter leading-none">
                HK BUS <span className="text-blue-500">ETA</span>
              </h1>
              <span className="text-[9px] font-mono text-slate-500 uppercase tracking-widest mt-1">Real-time Telemetry v2.4</span>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="hidden sm:flex flex-col items-end">
              <span className="text-[8px] font-mono text-slate-600 uppercase tracking-widest">System Status</span>
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
                <span className="text-[10px] font-mono text-emerald-500 font-bold">STABLE</span>
              </div>
            </div>
            <div className="h-8 w-px bg-white/5" />
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
              <span className="text-[10px] font-mono text-slate-400 font-bold tracking-widest">LIVE</span>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 p-4 space-y-8 pb-24 relative">
        {/* Background Grid Pattern */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px] pointer-events-none" />

        {/* Search */}
        <motion.form 
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          onSubmit={handleSearch} 
          className="relative group z-10"
        >
          <div className="absolute inset-0 bg-blue-600/20 blur-xl group-focus-within:bg-blue-600/30 transition-all rounded-2xl" />
          <div className="relative flex items-center">
            <input
              type="text"
              value={routeInput}
              onChange={(e) => setRouteInput(e.target.value)}
              placeholder="ENTER ROUTE NUMBER..."
              className="w-full p-5 pr-16 rounded-2xl border border-white/10 bg-slate-900/80 backdrop-blur-md text-white font-mono placeholder:text-slate-600 focus:outline-none focus:border-blue-500/50 transition-all shadow-2xl"
            />
            <button
              type="submit"
              className="absolute right-2 p-3 bg-blue-600 text-white rounded-xl hover:bg-blue-500 transition-all active:scale-90 flex items-center justify-center shadow-lg shadow-blue-600/40"
              disabled={loading}
            >
              {loading ? <RefreshCw className="w-5 h-5 animate-spin" /> : <Search className="w-5 h-5" />}
            </button>
          </div>
        </motion.form>

        {error && (
          <div className="p-4 bg-red-50 text-red-600 rounded-xl border border-red-100">
            {error}
          </div>
        )}

        {/* Favorite Routes */}
        <AnimatePresence>
          {!selectedRoute && routes.length === 0 && !loading && !error && favoriteRoutes.length > 0 && (
            <motion.div 
              key="favorite-routes"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="space-y-4 overflow-hidden z-10 relative"
            >
              <div className="flex items-center justify-between px-1">
                <h2 className="text-[10px] font-mono font-black text-slate-500 uppercase tracking-[0.3em] flex items-center gap-2">
                    <Star className="w-3 h-3 fill-amber-500 text-amber-500" />
                    常用路線 (FAVORITE ROUTES)
                </h2>
                <div className="h-px flex-1 bg-white/5 ml-4" />
              </div>
              <div className="grid gap-3">
                {favoriteRoutes.map((route, index) => (
                  <motion.div
                    key={`fav-${route.company}-${route.route}-${route.bound}-${route.service_type}-${index}`}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: index * 0.05 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => handleSelectRoute(route)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => e.key === 'Enter' && handleSelectRoute(route)}
                    className="bg-slate-900/50 backdrop-blur-sm p-5 rounded-2xl border border-white/5 text-left hover:border-amber-500/50 transition-all relative group overflow-hidden cursor-pointer"
                  >
                    <div className="absolute top-0 left-0 w-1 h-full bg-amber-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                    <button 
                      className="absolute top-5 right-5 z-10 p-2 hover:bg-white/10 rounded-full transition-colors" 
                      onClick={(e) => toggleFavorite(route, e)}
                    >
                      <Star className="w-5 h-5 fill-amber-500 text-amber-500" />
                    </button>
                    <div className="flex justify-between items-center pr-8">
                      <div>
                        <div className="flex items-center gap-3 mb-3">
                          <div className="flex gap-1">
                            {route.companies && route.companies.length > 0 ? (
                                route.companies.map(co => (
                                    <span key={co} className={`text-[9px] font-mono font-black text-white px-2 py-0.5 rounded ${getCompanyColor(co)}`}>
                                        {co}
                                    </span>
                                ))
                            ) : (
                                <span className={`text-[9px] font-mono font-black text-white px-2 py-0.5 rounded ${getCompanyColor(route.company)}`}>
                                    {route.company}
                                </span>
                            )}
                          </div>
                          <div className="text-3xl font-mono font-black text-white tracking-tighter leading-none">{route.route}</div>
                        </div>
                        <div className="text-slate-200 font-bold text-lg">往 {route.dest_tc}</div>
                        <div className="text-[10px] font-mono text-slate-500 mt-1 uppercase tracking-wider">TO {route.dest_en}</div>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Route Selection */}
        <AnimatePresence>
          {!selectedRoute && routes.length > 0 && (
            <motion.div 
              key="route-selection"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="space-y-6 z-10 relative"
            >
              <button
                onClick={() => {
                  setRoutes([]);
                  setRouteInput('');
                  setError('');
                }}
                className="text-[10px] font-mono font-black text-slate-500 uppercase tracking-widest flex items-center gap-2 hover:text-white transition-colors"
              >
                <ChevronRight className="w-3 h-3 rotate-180" />
                取消搜尋 (CANCEL SEARCH)
              </button>
              
              <div className="flex items-center justify-between px-1">
                <h2 className="text-[10px] font-mono font-black text-slate-500 uppercase tracking-[0.3em]">選擇方向 (SELECT DIRECTION)</h2>
                <div className="h-px flex-1 bg-white/5 ml-4" />
              </div>

              <div className="grid gap-3">
                {routes.map((route, index) => (
                  <motion.div
                    key={`${route.company}-${route.route}-${route.bound}-${route.service_type}-${index}`}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.05 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => handleSelectRoute(route)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => e.key === 'Enter' && handleSelectRoute(route)}
                    className="bg-slate-900/50 backdrop-blur-sm p-6 rounded-2xl border border-white/5 text-left hover:border-blue-500/50 transition-all relative group overflow-hidden cursor-pointer"
                  >
                    <div className="absolute top-0 left-0 w-1.5 h-full bg-blue-600 opacity-0 group-hover:opacity-100 transition-opacity" />
                    <button 
                      className="absolute top-6 right-6 z-10 p-2 hover:bg-white/10 rounded-full transition-colors" 
                      onClick={(e) => toggleFavorite(route, e)}
                    >
                      <Star className={`w-5 h-5 ${isFavorite(route) ? 'fill-amber-500 text-amber-500' : 'text-slate-700 hover:text-amber-500'}`} />
                    </button>
                    <div className="flex justify-between items-center">
                      <div>
                        <div className="flex items-center gap-3 mb-3">
                          <div className="flex gap-1">
                            {route.companies && route.companies.length > 0 ? (
                                route.companies.map(co => (
                                    <span key={co} className={`text-[9px] font-mono font-black text-white px-2 py-0.5 rounded ${getCompanyColor(co)}`}>
                                        {co}
                                    </span>
                                ))
                            ) : (
                                <span className={`text-[9px] font-mono font-black text-white px-2 py-0.5 rounded ${getCompanyColor(route.company)}`}>
                                    {route.company}
                                </span>
                            )}
                          </div>
                          <div className="text-3xl font-mono font-black text-white tracking-tighter leading-none">{route.route}</div>
                        </div>
                        <div className="text-slate-200 font-bold text-lg">往 {route.dest_tc}</div>
                        <div className="text-[10px] font-mono text-slate-500 mt-1 uppercase tracking-wider">TO {route.dest_en}</div>
                      </div>
                      <div className="bg-white/5 p-3 rounded-xl group-hover:bg-blue-600/20 transition-colors">
                        <Navigation className="w-5 h-5 text-slate-500 group-hover:text-blue-400" />
                      </div>
                    </div>
                    {route.service_type !== '1' && (
                      <div className="mt-4 inline-flex items-center gap-2 px-3 py-1 bg-amber-500/10 text-amber-500 text-[9px] font-mono font-black rounded border border-amber-500/20 uppercase">
                        <Clock className="w-3 h-3" />
                        特別班次 (SPECIAL SERVICE)
                      </div>
                    )}
                  </motion.div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Selected Route Info & Nearest Stop */}
        <AnimatePresence>
          {selectedRoute && (
            <motion.div 
              key="selected-route-info"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-8 z-10 relative"
            >
              <button
                onClick={() => {
                  setSelectedRoute(null);
                  setStops([]);
                  setNearestStopETA([]);
                  setOtherBusesETA([]);
                }}
                className="text-[10px] font-mono font-black text-slate-500 uppercase tracking-widest flex items-center gap-2 hover:text-white transition-colors"
              >
                <ChevronRight className="w-3 h-3 rotate-180" />
                返回列表 (BACK TO LIST)
              </button>

              <div className="bg-slate-900/80 backdrop-blur-md p-6 rounded-3xl border border-white/10 shadow-2xl">
                <div className="flex justify-between items-center">
                    <div className="flex items-center gap-4">
                      <div className="flex gap-1.5">
                          {selectedRoute.companies && selectedRoute.companies.length > 0 ? (
                              selectedRoute.companies.map(co => (
                                  <div key={co} className={`${getCompanyColor(co)} text-white px-3 py-1.5 rounded-xl flex flex-col items-center justify-center min-w-[60px] shadow-lg`}>
                                    <span className="text-[8px] font-mono font-black opacity-80">{co}</span>
                                    <span className="text-2xl font-mono font-black tracking-tighter leading-none">{selectedRoute.route}</span>
                                  </div>
                              ))
                          ) : (
                              <div className={`${getCompanyColor(selectedRoute.company)} text-white px-3 py-1.5 rounded-xl flex flex-col items-center justify-center min-w-[60px] shadow-lg`}>
                                <span className="text-[8px] font-mono font-black opacity-80">{selectedRoute.company}</span>
                                <span className="text-2xl font-mono font-black tracking-tighter leading-none">{selectedRoute.route}</span>
                              </div>
                          )}
                      </div>
                      <div className="flex flex-col">
                        <span className="text-xl font-black text-white leading-none">往 {selectedRoute.dest_tc}</span>
                        <span className="text-[10px] font-mono text-slate-500 font-bold uppercase tracking-widest mt-1">TO {selectedRoute.dest_en}</span>
                      </div>
                    </div>
                    <button 
                      onClick={(e) => toggleFavorite(selectedRoute, e)} 
                      className="p-3 bg-white/5 rounded-2xl hover:bg-white/10 transition-colors border border-white/5"
                    >
                      <Star className={`w-6 h-6 ${isFavorite(selectedRoute) ? 'fill-amber-500 text-amber-500' : 'text-slate-700'}`} />
                    </button>
                </div>
              </div>

              {loadingStops ? (
                <div className="flex flex-col items-center justify-center py-20 gap-6">
                  <div className="relative">
                    <div className="w-16 h-16 border-4 border-blue-500/20 rounded-full" />
                    <div className="absolute inset-0 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
                  </div>
                  <div className="text-[10px] font-mono font-black text-slate-500 uppercase tracking-[0.4em]">正在初始化數據 (INITIALIZING DATA)...</div>
                </div>
              ) : (
                <div className="space-y-8">
                  {/* Nearest Stop Card */}
                  <AnimatePresence mode="wait">
                    {nearestStop ? (
                      <motion.div
                        key="nearest-stop"
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="bg-slate-900 text-white p-8 rounded-[2.5rem] shadow-[0_32px_64px_-16px_rgba(0,0,0,0.5)] relative overflow-hidden border border-white/10 group"
                      >
                        {/* Scanning Line Effect */}
                        <div className="absolute inset-0 bg-[linear-gradient(transparent_0%,rgba(37,99,235,0.05)_50%,transparent_100%)] bg-[length:100%_4px] animate-[scan_4s_linear_infinite] pointer-events-none opacity-30" />
                        
                        {/* Hardware Details */}
                        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-blue-500/50 to-transparent" />
                        <div className="absolute top-4 left-1/2 -translate-x-1/2 w-12 h-1 bg-white/10 rounded-full" />
                        
                        <div className="absolute top-0 right-0 p-6 opacity-[0.03] pointer-events-none group-hover:scale-110 transition-transform duration-1000">
                          <MapPin className="w-64 h-64 -mr-16 -mt-16" />
                        </div>
                        
                        <div className="relative z-10">
                          <div className="flex items-center justify-between mb-8">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 bg-blue-500/10 rounded-lg flex items-center justify-center border border-blue-500/20">
                                <MapPin className="w-4 h-4 text-blue-500" />
                              </div>
                              <div className="flex flex-col">
                                <span className="font-mono font-black tracking-[0.3em] uppercase text-[9px] text-blue-500">最近車站 (NEAREST STATION)</span>
                                <div className="flex items-center gap-2">
                                  <span className="text-[10px] font-mono text-slate-500 font-bold uppercase tracking-widest">
                                    LOC_ID: {nearestStop.stop.substring(0, 8)}
                                  </span>
                                  <span className="text-[8px] font-mono text-slate-700">|</span>
                                  <span className="text-[8px] font-mono text-slate-600 uppercase">Telemetry Active</span>
                                </div>
                              </div>
                            </div>
                            <div className="flex flex-col items-end">
                              <div className="bg-slate-800/50 backdrop-blur-md border border-white/5 text-slate-300 px-3 py-1.5 rounded-xl text-[10px] font-mono font-black flex items-center gap-2">
                                <Navigation className="w-3 h-3 text-blue-500" />
                                {getDistance(
                                  { latitude: userLocation?.latitude || 0, longitude: userLocation?.longitude || 0 },
                                  { latitude: parseFloat(nearestStop.lat), longitude: parseFloat(nearestStop.long) }
                                )}M
                              </div>
                              <span className="text-[7px] font-mono text-slate-700 mt-1 uppercase tracking-tighter">Distance Vector</span>
                            </div>
                          </div>
                          
                          <h3 className="text-3xl font-black mb-2 tracking-tighter">{nearestStop.name_tc}</h3>
                          <p className="text-slate-500 text-[11px] mb-10 font-mono font-bold uppercase tracking-widest">{nearestStop.name_en}</p>

                          <div className="space-y-4">
                            {loadingETA ? (
                              <div className="space-y-4">
                                <div className="animate-pulse h-20 bg-white/5 rounded-2xl w-full border border-white/5"></div>
                                <div className="animate-pulse h-20 bg-white/5 rounded-2xl w-full border border-white/5"></div>
                              </div>
                            ) : nearestStopETA.length > 0 ? (
                              nearestStopETA.map((eta, idx) => (
                                <motion.div 
                                  key={idx} 
                                  initial={{ opacity: 0, x: -10 }}
                                  animate={{ opacity: 1, x: 0 }}
                                  transition={{ delay: idx * 0.1 }}
                                  className="flex justify-between items-center bg-white/[0.03] p-6 rounded-3xl border border-white/5 hover:bg-white/[0.05] transition-all group/item"
                                >
                                  <div>
                                    <div className="flex items-center gap-3 mb-2">
                                      <span className={`text-[8px] font-mono font-black px-2 py-0.5 rounded text-white ${getCompanyColor(eta.co)}`}>
                                        {eta.co}
                                      </span>
                                      <div className="text-[10px] font-mono text-slate-500 font-bold uppercase tracking-widest">
                                        {eta.eta ? new Date(eta.eta).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', hour12: false}) : '---'}
                                      </div>
                                    </div>
                                    <div className="flex items-baseline gap-2">
                                      <span className="text-5xl font-mono font-black text-white tracking-tighter">
                                        {formatTime(eta.eta).split(' ')[0]}
                                      </span>
                                      <span className="text-xs font-mono font-black text-slate-500 uppercase tracking-[0.2em]">
                                        {formatTime(eta.eta).includes('Arriving') ? 'ARR' : 'MIN'}
                                      </span>
                                    </div>
                                  </div>
                                  {eta.rmk_tc && (
                                    <div className="bg-blue-500/10 text-blue-400 px-4 py-2 rounded-2xl text-[9px] font-mono font-black uppercase border border-blue-500/20 tracking-widest">
                                      {eta.rmk_tc}
                                    </div>
                                  )}
                                </motion.div>
                              ))
                            ) : (
                              <div className="text-slate-600 text-[10px] font-mono font-black uppercase tracking-[0.3em] bg-white/[0.02] p-10 rounded-3xl text-center border border-white/5 border-dashed">
                                暫無實時數據 (NO TELEMETRY DATA)
                              </div>
                            )}
                          </div>

                          {/* Other Buses Section */}
                          {otherBusesETA.length > 0 && (
                            <div className="mt-10 pt-10 border-t border-white/5">
                              <div className="flex items-center gap-3 text-slate-500 mb-6">
                                <Bus className="w-4 h-4" />
                                <span className="font-mono font-black tracking-[0.3em] uppercase text-[9px]">其他路線 (OTHER ROUTES)</span>
                              </div>
                              <div className="grid grid-cols-2 gap-4">
                                {otherBusesETA.slice(0, 4).map((eta, idx) => (
                                  <div key={idx} className="bg-white/[0.02] rounded-2xl p-4 border border-white/5 hover:bg-white/[0.05] transition-all group/other">
                                    <div className="flex items-center justify-between mb-3">
                                      <div className="flex items-center gap-2">
                                        <span className="text-xl font-mono font-black text-white tracking-tighter">{eta.route}</span>
                                        <div className="h-3 w-px bg-white/10" />
                                        <span className={`text-[7px] font-mono font-black px-1.5 py-0.5 rounded text-white ${getCompanyColor(eta.co)}`}>
                                          {eta.co}
                                        </span>
                                      </div>
                                    </div>
                                    <div className="flex items-baseline gap-1">
                                      <div className="text-blue-500 font-mono font-black text-sm tracking-tighter">
                                        {formatTime(eta.eta).split(' ')[0]}
                                      </div>
                                      <span className="text-[8px] font-mono font-black text-slate-600 uppercase">MIN</span>
                                    </div>
                                    <div className="text-[8px] font-mono text-slate-600 truncate font-bold uppercase tracking-widest">
                                      TO {eta.dest_en || '---'}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          <button 
                            onClick={() => fetchETA(nearestStop!)}
                            className="mt-10 w-full py-5 bg-blue-600 hover:bg-blue-500 text-white rounded-[1.5rem] flex items-center justify-center gap-3 transition-all active:scale-[0.98] shadow-[0_20px_40px_-12px_rgba(37,99,235,0.4)] font-mono font-black text-xs uppercase tracking-widest"
                          >
                            <RefreshCw className={`w-4 h-4 ${loadingETA ? 'animate-spin' : ''}`} />
                            同步數據 (SYNC DATA)
                          </button>
                        </div>
                      </motion.div>
                    ) : (
                      !userLocation && (
                        <motion.div 
                          key="location-error"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          className="p-8 bg-amber-500/10 text-amber-500 rounded-3xl text-sm border border-amber-500/20 flex items-center gap-6"
                        >
                          <div className="bg-amber-500/20 p-3 rounded-2xl">
                            <MapPin className="w-6 h-6" />
                          </div>
                          <div>
                            <div className="font-mono font-black uppercase tracking-widest">定位錯誤 (LOCATION ERROR)</div>
                            <div className="text-[10px] font-mono opacity-70 mt-1 uppercase tracking-wider">請開啟 GPS 定位以獲取最近車站數據 (ENABLE GPS)</div>
                          </div>
                        </motion.div>
                      )
                    )}
                  </AnimatePresence>

                  {/* All Stops List */}
                  <div className="space-y-6">
                    <div className="flex items-center justify-between px-2">
                      <div className="flex flex-col">
                        <h3 className="font-mono font-black text-slate-400 text-[10px] uppercase tracking-[0.4em] flex items-center gap-3">
                          <MapIcon className="w-4 h-4 text-blue-500" />
                          車站序列 (STATION SEQUENCE)
                        </h3>
                        <span className="text-[7px] font-mono text-slate-600 uppercase mt-1 tracking-widest">Node Path Telemetry</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="h-4 w-px bg-white/10" />
                        <span className="text-[9px] font-mono font-black text-slate-500 bg-white/5 border border-white/5 px-3 py-1 rounded-full uppercase tracking-widest">{stops.length} NODES</span>
                      </div>
                    </div>
                    
                    <div className="relative px-1">
                      {/* Vertical Line */}
                      <div className="absolute left-[31px] top-6 bottom-6 w-px bg-white/5 z-0" />
                      
                      <div className="space-y-4 relative z-10">
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

                          const isNearest = nearestStop?.stop === stop.stop;

                          return (
                            <motion.div 
                              key={`${stop.stop}-${index}`} 
                              initial={{ opacity: 0, x: -10 }}
                              whileInView={{ opacity: 1, x: 0 }}
                              viewport={{ once: true }}
                              className={`bg-slate-900/50 backdrop-blur-sm p-6 rounded-3xl border transition-all ${isNearest ? 'border-blue-500/50 bg-blue-500/5' : 'border-white/5'}`}
                            >
                              <div className="flex items-start gap-6 relative">
                                {isNearest && (
                                  <div className="absolute -left-8 top-1/2 -translate-y-1/2 w-4 h-[1px] bg-blue-500" />
                                )}
                                <div className={`w-8 h-8 rounded-xl flex items-center justify-center text-[10px] font-mono font-black shrink-0 z-10 border transition-all ${isNearest ? 'bg-blue-600 text-white border-blue-600 shadow-lg shadow-blue-600/20' : 'bg-slate-900 text-slate-600 border-white/10'}`}>
                                  {String(index + 1).padStart(2, '0')}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 mb-1">
                                    <div className="font-black text-white text-xl leading-tight tracking-tighter">{stop.name_tc}</div>
                                    {isNearest && (
                                      <div className="flex items-center gap-1 px-1.5 py-0.5 bg-blue-500/10 border border-blue-500/20 rounded text-[7px] font-mono font-black text-blue-500 uppercase tracking-tighter">
                                        <div className="w-1 h-1 bg-blue-500 rounded-full animate-pulse" />
                                        CURRENT
                                      </div>
                                    )}
                                  </div>
                                  <div className="text-[10px] font-mono text-slate-500 font-bold uppercase tracking-widest truncate">{stop.name_en}</div>
                                  
                                  {stopETAs.length > 0 && (
                                    <div className="mt-6 flex flex-wrap gap-2">
                                      {stopETAs.map((eta, idx) => (
                                        <div key={idx} className="bg-white/5 border border-white/5 px-3 py-2 rounded-xl flex flex-col items-center min-w-[70px]">
                                          <span className="text-[10px] font-mono font-black text-emerald-500 tracking-tighter">
                                            {formatTime(eta.eta).split(' ')[0]}
                                          </span>
                                          <span className="text-[7px] font-mono font-black text-slate-600 uppercase tracking-widest">
                                            {formatTime(eta.eta).includes('Arriving') ? 'ARR' : 'MIN'}
                                          </span>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                                {isNearest && (
                                  <div className="text-blue-500 shrink-0 bg-blue-500/10 p-3 rounded-2xl border border-blue-500/20">
                                    <MapPin className="w-5 h-5" />
                                  </div>
                                )}
                              </div>
                            </motion.div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
