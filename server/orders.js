// Every paid order is appended to data/orders.jsonl (one JSON object per line),
// so nothing is lost even if the notification mail fails.
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, 'data');
const ORDERS = path.join(DIR, 'orders.jsonl');
const MAILED = path.join(DIR, 'mailed.txt');
fs.mkdirSync(DIR, { recursive: true });

const readLines = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean) : []);

function save(order) {
  const known = readLines(ORDERS).some((line) => line.includes(`"id":"${order.id}"`));
  if (!known) fs.appendFileSync(ORDERS, JSON.stringify(order) + '\n');
}
const isMailed = (id) => readLines(MAILED).includes(id);
const markMailed = (id) => fs.appendFileSync(MAILED, id + '\n');

module.exports = { save, isMailed, markMailed };
