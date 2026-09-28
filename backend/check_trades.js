const { Client } = require('pg');
(async () => {
  const c = new Client({
    host: '2.58.80.90',
    port: 55433,
    user: 'weymars',
    password: '##LosHijos162025?!##',
    database: 'bot',
  });
  await c.connect();
  const res = await c.query("SELECT * FROM trades WHERE symbol ILIKE '%600%' ORDER BY \"createdAt\" DESC LIMIT 20");
  console.log('600 trades count:', res.rows.length);
  console.table(res.rows.map(r => ({
    id: r.id,
    sym: r.symbol,
    dir: r.direction,
    status: r.status,
    ticket: r.mt5Ticket,
    entry: r.entryPrice,
    exit: r.exitPrice,
    pnl: r.pnlPoints,
    maxPnl: r.maxProfitPoints,
    created: r.createdAt
  })));
  await c.end();
})().catch(e => console.error(e));
