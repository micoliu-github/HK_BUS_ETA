const fetch = require('node-fetch');

async function getKMBStops(route, bound) {
  const url = `https://data.etabus.gov.hk/v1/transport/kmb/route-stop/${route}/${bound}/1`;
  const res = await fetch(url);
  const data = await res.json();
  return data.data;
}

async function getCTBStops(route, bound) {
    // CTB uses 'outbound'/'inbound' or similar?
    // My code uses `getCTBRoutes` to find the route, then fetches stops.
    // Let's just fetch the route first to get ID if needed, but CTB stop API uses route number + direction.
    // Actually CTB API: /v1/transport/citybus-nwfb/route-stop/ctb/{route}/{direction}
    // direction: outbound / inbound
    const dir = bound === 'O' ? 'outbound' : 'inbound';
    const url = `https://rt.data.gov.hk/v1/transport/citybus-nwfb/route-stop/ctb/${route}/${dir}`;
    const res = await fetch(url);
    const data = await res.json();
    return data.data;
}

async function getStopName(stopId) {
    // KMB stop name
    const url = `https://data.etabus.gov.hk/v1/transport/kmb/stop/${stopId}`;
    const res = await fetch(url);
    const data = await res.json();
    return data.data ? data.data.name_tc : 'Unknown';
}

async function getCTBStopName(stopId) {
    const url = `https://rt.data.gov.hk/v1/transport/citybus-nwfb/stop/${stopId}`;
    const res = await fetch(url);
    const data = await res.json();
    return data.data ? data.data.name_tc : 'Unknown';
}

async function debug() {
    const route = '113';
    const bound = 'O'; // Assuming O is one direction (e.g. to Kennedy Town)
    
    console.log('Fetching KMB stops...');
    const kmbStops = await getKMBStops(route, 'outbound'); // KMB uses outbound/inbound for route-stop API too? 
    // Wait, KMB API uses `outbound`/`inbound` strings or `1`/`2`?
    // My code uses `getRouteStops` which calls `https://data.etabus.gov.hk/v1/transport/kmb/route-stop/${route}/${direction}/${serviceType}`
    // direction in KMB is 'outbound' or 'inbound'.
    
    // Let's verify KMB API.
    // https://data.etabus.gov.hk/v1/transport/kmb/route-stop/113/outbound/1
    
    const kmbRes = await fetch(`https://data.etabus.gov.hk/v1/transport/kmb/route-stop/113/outbound/1`);
    const kmbData = await kmbRes.json();
    const kmbList = kmbData.data;
    
    console.log(`KMB Stops: ${kmbList.length}`);
    
    console.log('Fetching CTB stops...');
    const ctbRes = await fetch(`https://rt.data.gov.hk/v1/transport/citybus-nwfb/route-stop/ctb/113/outbound`);
    const ctbData = await ctbRes.json();
    const ctbList = ctbData.data;
    
    console.log(`CTB Stops: ${ctbList.length}`);

    // Fetch names for first few to compare
    console.log('Comparing first 5 stops...');
    for (let i = 0; i < Math.min(5, kmbList.length, ctbList.length); i++) {
        const kStop = kmbList[i];
        const cStop = ctbList[i];
        
        const kName = await getStopName(kStop.stop);
        const cName = await getCTBStopName(cStop.stop);
        
        console.log(`Stop ${i+1}: KMB(${kStop.stop})="${kName}" vs CTB(${cStop.stop})="${cName}"`);
        if (kName !== cName) console.log('   MISMATCH!');
    }
}

debug();
