// MPU Utilization App - Azure Function
// Proxies requests from tablet to Grafana Cloud

const https = require('https');

module.exports = async function (context, req) {
    
    // CORS headers - allows your tablet to connect
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Content-Type': 'application/json'
    };

    // Handle OPTIONS request (CORS preflight)
    if (req.method === 'OPTIONS') {
        context.res = { status: 204, headers: headers };
        return;
    }

    // Get Grafana credentials from Environment Variables
    const GRAFANA_URL = process.env.GRAFANA_URL || 'https://prometheus-prod-41-prod-au-southeast-1.grafana.net/api/v1/push/influx/write';
    const GRAFANA_USER = process.env.GRAFANA_USER || '2618255';
    const GRAFANA_API_KEY = process.env.GRAFANA_API_KEY || '';

    // Check if API key is configured
    if (!GRAFANA_API_KEY) {
        context.res = {
            status: 500,
            headers: headers,
            body: { success: false, error: 'GRAFANA_API_KEY not configured. Add it in Environment variables.' }
        };
        return;
    }

    try {
        const data = req.body;
        
        // Handle test connection request
        if (data && data.test === true) {
            const testLine = `mpu_connection_test,source=azure_function value=1 ${Date.now()}000000`;
            const result = await sendToGrafana(GRAFANA_URL, GRAFANA_USER, GRAFANA_API_KEY, testLine, context);
            
            if (result.success) {
                context.res = {
                    status: 200,
                    headers: headers,
                    body: { success: true, message: 'Connected to Grafana Cloud!' }
                };
            } else {
                context.res = {
                    status: 500,
                    headers: headers,
                    body: { success: false, error: result.error }
                };
            }
            return;
        }

        // Handle GET request (for browser testing)
        if (req.method === 'GET') {
            context.res = {
                status: 200,
                headers: headers,
                body: { 
                    success: true, 
                    message: 'MPU Proxy is running!',
                    usage: 'POST JSON data to sync with Grafana',
                    grafana_configured: !!GRAFANA_API_KEY
                }
            };
            return;
        }

        // Validate incoming data
        if (!data || !data.activityCode) {
            context.res = {
                status: 400,
                headers: headers,
                body: { success: false, error: 'Missing activity data. Send POST with activityCode.' }
            };
            return;
        }

        // Build InfluxDB line protocol
        const lines = buildInfluxLines(data);
        
        // Send to Grafana Cloud
        const result = await sendToGrafana(GRAFANA_URL, GRAFANA_USER, GRAFANA_API_KEY, lines, context);

        if (result.success) {
            context.res = {
                status: 200,
                headers: headers,
                body: { success: true, message: 'Data sent to Grafana' }
            };
        } else {
            context.res = {
                status: 500,
                headers: headers,
                body: { success: false, error: result.error }
            };
        }

    } catch (error) {
        context.log.error('Function error:', error);
        context.res = {
            status: 500,
            headers: headers,
            body: { success: false, error: error.message }
        };
    }
};

// Build InfluxDB line protocol format
function buildInfluxLines(data) {
    const sanitize = (val) => String(val || 'unknown').replace(/\s+/g, '_').replace(/[,=]/g, '');
    
    const mpu = sanitize(data.mpu);
    const site = sanitize(data.site);
    const operator = sanitize(data.operator);
    const shift = sanitize(data.shift);
    const date = sanitize(data.date);
    const slot = sanitize(data.slot);
    const activityCode = sanitize(data.activityCode);
    
    const timestamp = data.timestamp || (Date.now() * 1000000);
    
    const lines = [];
    
    // Main activity measurement
    let activityLine = `mpu_activity,mpu=${mpu},site=${site},operator=${operator},shift=${shift},date=${date},slot=${slot},activity_code=${activityCode}`;
    activityLine += ` value=${parseInt(activityCode) || 0}i`;
    
    if (data.lat && data.lon) {
        activityLine += `,lat=${parseFloat(data.lat)},lon=${parseFloat(data.lon)}`;
    }
    
    activityLine += ` ${timestamp}`;
    lines.push(activityLine);
    
    // GPS measurement
    if (data.lat && data.lon) {
        lines.push(`mpu_gps,mpu=${mpu},site=${site},slot=${slot} lat=${parseFloat(data.lat)},lon=${parseFloat(data.lon)} ${timestamp}`);
    }
    
    // Selection time
    lines.push(`mpu_selection,mpu=${mpu},site=${site},slot=${slot} timestamp=${timestamp}i ${timestamp}`);
    
    return lines.join('\n');
}

// Send data to Grafana Cloud
function sendToGrafana(url, user, apiKey, body, context) {
    return new Promise((resolve) => {
        try {
            const urlObj = new URL(url);
            const auth = Buffer.from(user + ':' + apiKey).toString('base64');
            
            const options = {
                hostname: urlObj.hostname,
                port: 443,
                path: urlObj.pathname + urlObj.search,
                method: 'POST',
                headers: {
                    'Content-Type': 'text/plain',
                    'Authorization': 'Basic ' + auth,
                    'Content-Length': Buffer.byteLength(body)
                }
            };

            context.log('Sending to:', urlObj.hostname);

            const request = https.request(options, (response) => {
                let responseData = '';
                
                response.on('data', (chunk) => {
                    responseData += chunk;
                });
                
                response.on('end', () => {
                    context.log('Grafana status:', response.statusCode);
                    
                    if (response.statusCode === 200 || response.statusCode === 204) {
                        resolve({ success: true });
                    } else {
                        resolve({ 
                            success: false, 
                            error: `Grafana error ${response.statusCode}: ${responseData.substring(0, 200)}` 
                        });
                    }
                });
            });

            request.on('error', (error) => {
                context.log.error('Request error:', error);
                resolve({ success: false, error: error.message });
            });

            request.write(body);
            request.end();
            
        } catch (error) {
            context.log.error('Send error:', error);
            resolve({ success: false, error: error.message });
        }
    });
}
