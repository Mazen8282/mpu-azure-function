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
        res.end(JSON.stringify({ success: true, message: 'MPU Proxy Running!' }));
        return;
    }

    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
        try {
            const data = JSON.parse(body);
            
            if (data.test) {
                sendToGrafana(`mpu_test,source=render value=1 ${Date.now()}000000`, (ok, err) => {
                    res.writeHead(ok ? 200 : 500);
                    res.end(JSON.stringify(ok ? { success: true, message: 'Connected!' } : { success: false, error: err }));
                });
                return;
            }

            const s = v => String(v || 'unknown').replace(/\s+/g, '_').replace(/[,=]/g, '');
            const ts = data.timestamp || Date.now() * 1000000;
            let line = `mpu_activity,mpu=${s(data.mpu)},site=${s(data.site)},operator=${s(data.operator)},shift=${s(data.shift)},date=${s(data.date)},slot=${s(data.slot)},activity_code=${s(data.activityCode)} value=${parseInt(data.activityCode)||0}i`;
            if (data.lat && data.lon) line += `,lat=${data.lat},lon=${data.lon}`;
            line += ` ${ts}`;

            sendToGrafana(line, (ok, err) => {
                res.writeHead(ok ? 200 : 500);
                res.end(JSON.stringify(ok ? { success: true } : { success: false, error: err }));
            });
        } catch (e) {
            res.writeHead(400);
            res.end(JSON.stringify({ success: false, error: e.message }));
        }
    });
}).listen(PORT, () => console.log(`Server running on port ${PORT}`));

function sendToGrafana(body, callback) {
    const u = new URL(GRAFANA_URL);
    const opts = {
        hostname: u.hostname, port: 443, path: u.pathname, method: 'POST',
        headers: {
            'Content-Type': 'text/plain',
            'Authorization': 'Basic ' + Buffer.from(GRAFANA_USER + ':' + GRAFANA_API_KEY).toString('base64')
        }
    };
    const r = https.request(opts, res => {
        res.on('data', () => {});
        res.on('end', () => callback(res.statusCode === 200 || res.statusCode === 204, `Error ${res.statusCode}`));
    });
    r.on('error', e => callback(false, e.message));
    r.write(body);
    r.end();
}
