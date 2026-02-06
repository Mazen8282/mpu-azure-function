const https = require('https');
const http = require('http');

const PORT = process.env.PORT || 3000;
const GRAFANA_URL = process.env.GRAFANA_URL;
const GRAFANA_USER = process.env.GRAFANA_USER;
const GRAFANA_API_KEY = process.env.GRAFANA_API_KEY;

http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Content-Type', 'application/json');

    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    if (req.method === 'GET') {
        res.writeHead(200);
        res.end(JSON.stringify({ success: true, message: 'MPU Proxy Running! v4.1' }));
        return;
    }

    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
        try {
            const data = JSON.parse(body);

            if (data.test) {
                const testLine = `mpu_test,source=proxy value=1 ${Date.now()}000000`;
                sendToGrafana(testLine, (ok, err) => {
                    res.writeHead(ok ? 200 : 500);
                    res.end(JSON.stringify(ok ? { success: true, message: 'Connected to Grafana!' } : { success: false, error: err }));
                });
                return;
            }

            if (!data.activityCode) {
                res.writeHead(400);
                res.end(JSON.stringify({ success: false, error: 'Missing activityCode' }));
                return;
            }

            const s = v => String(v || 'unknown').replace(/[\s,=]/g, '_').replace(/"/g, '');

            // ── METRIC 1: mpu_activity (main activity tracking) ──
            let tags = [
                `mpu=${s(data.mpu)}`,
                `site=${s(data.site)}`,
                `operator=${s(data.operator)}`,
                `shift=${s(data.shift)}`,
                `date=${s(data.date)}`,
                `slot=${s(data.slot)}`,
                `activity_code=${s(data.activityCode)}`,
                `activity_name=${s(data.activityName || 'unknown')}`,
                `activity_type=${s(data.activityType || 'unknown')}`,
                `device=${s(data.device || 'unknown')}`
            ];
            if (data.docket) tags.push(`docket=${s(data.docket)}`);

            let fields = [`value=${parseInt(data.activityCode) || 0}i`];
            const ts = data.timestamp || (Date.now() * 1000000);
            const line1 = `mpu_activity,${tags.join(',')} ${fields.join(',')} ${ts}`;

            // ── METRIC 2: mpu_gps (separate GPS metric for Geomap) ──
            let lines = [line1];
            if (data.lat && data.lon && parseFloat(data.lat) !== 0 && parseFloat(data.lon) !== 0) {
                const gpsTags = [
                    `mpu=${s(data.mpu)}`,
                    `site=${s(data.site)}`,
                    `operator=${s(data.operator)}`,
                    `slot=${s(data.slot)}`,
                    `activity_name=${s(data.activityName || 'unknown')}`,
                    `activity_code=${s(data.activityCode)}`,
                    `date=${s(data.date)}`
                ];
                const gpsLine = `mpu_gps,${gpsTags.join(',')} lat=${parseFloat(data.lat)},lon=${parseFloat(data.lon)} ${ts}`;
                lines.push(gpsLine);
            }

            const payload = lines.join('\n');
            console.log('Sending:', payload);

            sendToGrafana(payload, (ok, err) => {
                res.writeHead(ok ? 200 : 500);
                res.end(JSON.stringify(ok ? { success: true } : { success: false, error: err }));
            });
        } catch (e) {
            console.error('Parse error:', e.message);
            res.writeHead(400);
            res.end(JSON.stringify({ success: false, error: e.message }));
        }
    });
}).listen(PORT, () => console.log(`MPU Proxy v4.1 running on port ${PORT}`));

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
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => {
            if (res.statusCode === 200 || res.statusCode === 204) {
                callback(true);
            } else {
                console.error(`Grafana error ${res.statusCode}: ${d}`);
                callback(false, `Grafana returned ${res.statusCode}: ${d.substring(0, 200)}`);
            }
        });
    });
    r.on('error', e => {
        console.error('Request error:', e.message);
        callback(false, e.message);
    });
    r.write(body);
    r.end();
}
