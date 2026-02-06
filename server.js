const https = require('https');
const http = require('http');

const PORT = process.env.PORT || 3000;
const GRAFANA_URL = process.env.GRAFANA_URL;
const GRAFANA_USER = process.env.GRAFANA_USER;
const GRAFANA_API_KEY = process.env.GRAFANA_API_KEY;

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
        res.end(JSON.stringify({ success: true, message: 'MPU Proxy v3.0 Running!', version: '3.0' }));
        return;
    }

    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
        try {
            const data = JSON.parse(body);
            
            // Test connection
            if (data.test) {
                sendToGrafana(`mpu_test,source=proxy,version=3 value=1 ${Date.now()}000000`, (ok, err) => {
                    res.writeHead(ok ? 200 : 500);
                    res.end(JSON.stringify(ok ? { success: true, message: 'Connected!' } : { success: false, error: err }));
                });
                return;
            }

            // Sanitize - no spaces, commas, equals, or special chars
            const s = v => String(v || 'unknown').replace(/[\s,=]/g, '_').replace(/[^a-zA-Z0-9_\-:.]/g, '');
            
            // The slot is already in HH:MM format from app v3
            const timeSlot = s(data.slot);
            
            const ts = data.timestamp || Date.now() * 1000000;
            
            // Build tags
            const tags = [
                `mpu=${s(data.mpu)}`,
                `site=${s(data.site)}`,
                `operator=${s(data.operator)}`,
                `shift=${s(data.shift)}`,
                `date=${s(data.date)}`,
                `time_slot=${timeSlot}`,
                `activity_code=${s(data.activityCode)}`,
                `activity_type=${s(data.activityType)}`,
                `device=${s(data.deviceId)}`
            ].join(',');
            
            // Build fields
            let fields = `value=${parseInt(data.activityCode) || 0}i`;
            
            // Add GPS if available
            if (data.lat && data.lon && !isNaN(parseFloat(data.lat)) && !isNaN(parseFloat(data.lon))) {
                fields += `,lat=${parseFloat(data.lat)},lon=${parseFloat(data.lon)}`;
            }
            
            // Add docket if present
            if (data.docket) {
                fields += `,docket="${s(data.docket)}"`;
            }
            
            const line = `mpu_activity,${tags} ${fields} ${ts}`;
            
            console.log('Sending:', line);

            sendToGrafana(line, (ok, err) => {
                res.writeHead(ok ? 200 : 500);
                res.end(JSON.stringify(ok ? { success: true } : { success: false, error: err }));
            });
            
        } catch (e) {
            console.error('Parse error:', e);
            res.writeHead(400);
            res.end(JSON.stringify({ success: false, error: e.message }));
        }
    });
}).listen(PORT, () => console.log(`MPU Proxy v3.0 running on port ${PORT}`));

function sendToGrafana(body, callback) {
    if (!GRAFANA_URL || !GRAFANA_USER || !GRAFANA_API_KEY) {
        callback(false, 'Grafana credentials not configured');
        return;
    }
    
    const u = new URL(GRAFANA_URL);
    const auth = Buffer.from(GRAFANA_USER + ':' + GRAFANA_API_KEY).toString('base64');
    
    const opts = {
        hostname: u.hostname, 
        port: 443, 
        path: u.pathname, 
        method: 'POST',
        headers: {
            'Content-Type': 'text/plain',
            'Authorization': 'Basic ' + auth,
            'Content-Length': Buffer.byteLength(body)
        }
    };
    
    const req = https.request(opts, response => {
        let responseData = '';
        response.on('data', c => responseData += c);
        response.on('end', () => {
            console.log('Grafana response:', response.statusCode);
            if (response.statusCode === 200 || response.statusCode === 204) {
                callback(true, null);
            } else {
                callback(false, `Grafana error ${response.statusCode}: ${responseData.substring(0, 200)}`);
            }
        });
    });
    
    req.on('error', e => {
        console.error('Request error:', e);
        callback(false, e.message);
    });
    
    req.write(body);
    req.end();
}
