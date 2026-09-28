#!/usr/bin/env node
require('dotenv').config();
const https = require('https');

const appId = process.env.DERIV_APP_ID;
const token = process.env.DERIV_API_TOKEN;

if (!appId || !token) {
  console.error('Please set DERIV_APP_ID and DERIV_API_TOKEN in .env before running this script.');
  process.exit(1);
}

const options = {
  hostname: 'api.derivws.com',
  port: 443,
  path: '/trading/v1/options/accounts',
  method: 'GET',
  headers: {
    'Deriv-App-ID': appId,
    Authorization: `Bearer ${token}`,
  },
};

const req = https.request(options, (res) => {
  let data = '';
  res.on('data', (chunk) => (data += chunk));
  res.on('end', () => {
    try {
      const json = JSON.parse(data);
      console.log('HTTP', res.statusCode);
      console.log(JSON.stringify(json, null, 2));
    } catch (e) {
      console.error('Failed to parse response:', e.message);
      console.log('Raw response:', data);
    }
  });
});

req.on('error', (e) => {
  console.error('Request error:', e.message);
});

req.end();
