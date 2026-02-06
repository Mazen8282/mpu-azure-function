const https = require('https');
const http = require('http');

const PORT = process.env.PORT || 3000;
const GRAFANA_URL = process.env.GRAFANA_URL;
const GRAFANA_USER = process.env.GRAFANA_USER;
const GRAFANA_API_KEY = process.env.GRAFANA_API_KEY;

// Activity code to name mapping
const ACTIVITY_NAMES = {
    '1': 'Loading', '2': 'Travel_Loaded', '3': 'Unloading', '4': 'Travel_Empty',
    '5': 'Pre_Start', '6': 'Crib', '7': 'Training', '8': 'Meeting',
    '9': 'Maintenance', '10': 'Standby', '11': 'Other', '12': 'End_Shift',
    '20': 'Wait_Blast', '21': 'Wait_Drill', '22': 'Wait_Survey',
    '23': 'Wait_Dozer', '24': 'Wait_Excavator', '25': 'Wait_Water',
    '26': 'Wet_Holes', '27': 'Bad_Ground', '28': 'No_Pattern',
    '50': 'Breakdown', '51': 'Sched_Maint', '52': 'Parts_Wait',
    '53': 'No_Operator', '54': 'No_Product', '80': 'Other_Delay'
};

http.createServer((req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Content-Type', 'application/json');

    if (req.method === 'OPTIONS') { 
        res.writeHead(204); 
        res.end(); 
        return; 
    }
    
    if (req.method === 'GET') {
        res.writeHead(200);
        res.end(JSON.stringify({ success: true, message: 'MPU Proxy Running!', version: '2.0' }));
        return;
    }

    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
        try {
            const data = JSON.parse(body);
            
            // Test connection
            if (data.test) {
                sendToGrafana(`mpu_test,source=render value=1 ${Date.now()}000000`, (ok, err) => {
                    res.writeHead(ok ? 200 : 500);
                    res.end(JSON.stringify(ok ? { success: true, message: 'Connected!' } : { success: false, error: err }));
                });
                return;
            }

            // Sanitize function - no spaces, commas, or equals
            const s = v => String(v || 'unknown').replace(/\s+/g, '_').replace(/[,=]/g, '');
            
            // Convert slot format: "s_6_30" -> "06:30"
            const formatSlot = (slot) => {
                if (!slot) return '00:00';
                // slot format: s_6_30 or s_14_20
                const match = slot.match(/s_(\d+)_(\d+)/);
                if (match) {
                    const hour = match[1].padStart(2, '0');
                    const min = match[2].padStart(2, '0');
                    return `${hour}:${min}`;
                }
                return slot;
            };
            
            // Get activity name
            const activityName = ACTIVITY_NAMES[data.activityCode] || 'Unknown';
            
            const ts = data.timestamp || Date.now() * 1000000;
            const timeSlot = formatSlot(data.slot);
            
            // Build line protocol with all fields
            let tags = [
                `mpu=${s(data.mpu)}`,
                `site=${s(data.site)}`,
                `operator=${s(data.operator)}`,
                `shift=${s(data.shift)}`,
                `date=${s(data.date)}`,
                `slot=${timeSlot}`,
                `activity_code=${s(data.activityCode)}`,
                `activity_name=${activityName}`
            ].join(',');
            
            // Fields (numeric values)
            let fields = `value=${parseInt(data.activityCode) || 0}i`;
            
            // Add GPS if available
            if (data.lat && data.lon && !isNaN(data.lat) && !isNaN(data.lon)) {
                fields += `,lat=${parseFloat(data.lat)},lon=${parseFloat(data.lon)}`;
            }
            
            const line = `mpu_activity,${tags} ${fields} ${ts}`;

            sendToGrafana(line, (ok, err) => {
                res.writeHead(ok ? 200 : 500);
                res.end(JSON.stringify(ok ? { success: true } : { success: false, error: err }));
            });
            
        } catch (e) {
            res.writeHead(400);
            res.end(JSON.stringify({ success: false, error: e.message }));
        }
    });
}).listen(PORT, () => console.log(`MPU Proxy v2.0 running on port ${PORT}`));

function sendToGrafana(body, callback) {
    if (!GRAFANA_URL || !GRAFANA_USER || !GRAFANA_API_KEY) {
        callback(false, 'Grafana credentials not configured');
        return;
    }
    
    const u = new URL(GRAFANA_URL);
    const opts = {
        hostname: u.hostname, 
        port: 443, 
        path: u.pathname, 
        method: 'POST',
        headers: {
            'Content-Type': 'text/plain',
            'Authorization': 'Basic ' + Buffer.from(GRAFANA_USER + ':' + GRAFANA_API_KEY).toString('base64')
        }
    };
    
    const r = https.request(opts, res => {
        let responseData = '';
        res.on('data', c => responseData += c);
        res.on('end', () => {
            if (res.statusCode === 200 || res.statusCode === 204) {
                callback(true, null);
            } else {
                callback(false, `Grafana error ${res.statusCode}: ${responseData.substring(0, 100)}`);
            }
        });
    });
    
    r.on('error', e => callback(false, e.message));
    r.write(body);
    r.end();
}
