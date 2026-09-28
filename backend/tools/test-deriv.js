#!/usr/bin/env node
require('dotenv').config();
const WebSocket = require('ws');

const appId = process.env.DERIV_APP_ID || '1089';
const baseUrl = process.env.DERIV_WS_URL || 'wss://ws.derivws.com/websockets/v3';
const url = `${baseUrl}?app_id=${appId}`;

console.log(`Connecting to: ${url}`);
const ws = new WebSocket(url);

ws.on('open', () => {
  console.log('WebSocket open');
  const token = process.env.DERIV_API_TOKEN;
  // Always request active_symbols first so we can list valid symbols
  console.log('Requesting active_symbols (brief) to get valid symbol codes');
  // Request active symbols without additional fields to avoid validation errors
  ws.send(JSON.stringify({ active_symbols: 'brief' }));

  if (token) {
    console.log('Sending authorize (masked):', `${token.slice(0,6)}... (len=${token.length})`);
    ws.send(JSON.stringify({ authorize: token }));
  } else {
    console.log('No DERIV_API_TOKEN in environment; skipping authorize');
  }
});

ws.on('message', (data) => {
  let msg;
  try {
    msg = JSON.parse(data.toString());
  } catch (e) {
    console.log('Non-JSON message:', data.toString());
    return;
  }

  console.log('<<', JSON.stringify(msg));

  // If authorize succeeded, request active symbols
  if (msg.msg_type === 'authorize' && msg.authorize) {
    console.log('Authorize response OK — requesting active_symbols');
    ws.send(JSON.stringify({ active_symbols: 'brief', product_type: 'basic' }));
    return;
  }

  // If authorize returned an error, print and exit
  if (msg.error && msg.error.code === 'InvalidToken') {
    console.error('Authorize failed:', JSON.stringify(msg.error));
    // don't close: continue to request/list active_symbols results
    return;
  }

  // Handle active_symbols response
  if (msg.msg_type === 'active_symbols' || msg.active_symbols) {
    const symbols = msg.active_symbols || msg.active_symbols;
    if (Array.isArray(symbols)) {
      console.log(`Received ${symbols.length} active symbols — showing first 30:`);
      symbols.slice(0, 30).forEach((s) => console.log('-', s.symbol));
    } else {
      console.log('active_symbols payload:', JSON.stringify(msg));
    }
    ws.close();
    return;
  }
});

ws.on('error', (err) => {
  console.error('WebSocket error:', err.message || err);
});

ws.on('close', () => {
  console.log('WebSocket closed');
  process.exit(0);
});
