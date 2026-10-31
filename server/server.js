// Ravenyz shop API: product list, Stripe Checkout sessions and the order webhook.
// Products and shipping are read from ../products.json and ../shipping.json on every
// request, so edits there take effect without restarting the service.

const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const express = require('express');
const Stripe = require('stripe');
const { sendOrderMail } = require('./mailer');
const orders = require('./orders');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT) || 3001;
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const MAX_QTY = 20;

for (const key of ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'BASE_URL']) {
  if (!process.env[key]) console.warn(`[config] ${key} is not set in server/.env`);
}
const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
}
const loadProducts = () => readJson('products.json').filter((p) => p.active !== false);
const loadShipping = () => readJson('shipping.json');
const toCents = (chf) => Math.round(Number(chf) * 100);

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');

// Stripe needs the raw body to verify the signature, so this route comes before express.json().
app.post('/api/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!stripe) return res.status(500).send('Stripe not configured');
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.warn('[webhook] invalid signature:', err.message);
    return res.status(400).send('Invalid signature');
  }

  const relevant = ['checkout.session.completed', 'checkout.session.async_payment_succeeded'];
  if (!relevant.includes(event.type) || event.data.object.payment_status !== 'paid') {
    return res.json({ received: true });
  }

  try {
    await handlePaidSession(event.data.object.id);
    res.json({ received: true });
  } catch (err) {
    // A non-2xx answer makes Stripe retry the webhook later (for up to three days).
    console.error('[webhook] order handling failed:', err);
    res.status(500).send('Order handling failed');
  }
});

app.use(express.json({ limit: '20kb' }));

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.get('/api/products', (req, res) => {
  try {
    res.json(loadProducts());
  } catch (err) {
    console.error('[products] cannot read products.json:', err.message);
    res.status(500).json({ error: 'Product list unavailable.' });
  }
});

app.get('/api/shipping', (req, res) => {
  const { regions } = loadShipping();
  res.json(regions.map(({ id, label, carrier, amount, freeFrom, minDays, maxDays }) =>
    ({ id, label, carrier, amount, freeFrom, minDays, maxDays })));
});

app.post('/api/checkout', async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Checkout is not configured yet.' });

  const { items, region } = req.body || {};
  if (!Array.isArray(items) || items.length === 0 || items.length > 50) {
    return res.status(400).json({ error: 'Your cart is empty.' });
  }

  // Prices always come from products.json, never from the browser.
  const products = loadProducts();
  const merged = new Map();
  for (const item of items) {
    const product = products.find((p) => p.id === item?.id);
    const qty = Number(item?.qty);
    if (!product) return res.status(400).json({ error: 'A product in your cart is no longer available. Remove it and try again.' });
    if (!Number.isInteger(qty) || qty < 1) return res.status(400).json({ error: 'Invalid quantity.' });
    merged.set(product.id, Math.min(MAX_QTY, (merged.get(product.id) || 0) + qty));
  }

  const shipping = loadShipping();
  const reg = shipping.regions.find((r) => r.id === region);
  if (!reg) return res.status(400).json({ error: 'Choose a shipping destination.' });

  const currency = shipping.currency || 'chf';
  const line_items = [...merged].map(([id, qty]) => {
    const p = products.find((x) => x.id === id);
    const image = p.image ? [`${BASE_URL}/${p.image}`] : undefined;
    return {
      quantity: qty,
      price_data: {
        currency,
        unit_amount: toCents(p.price),
        product_data: {
          name: p.name,
          description: p.tagline || undefined,
          images: BASE_URL.startsWith('https://') ? image : undefined,
          metadata: { product_id: p.id, sku: p.sku || '' },
        },
      },
    };
  });

  const subtotal = [...merged].reduce((sum, [id, qty]) => sum + toCents(products.find((p) => p.id === id).price) * qty, 0);
  const free = reg.freeFrom != null && subtotal >= toCents(reg.freeFrom);

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items,
      billing_address_collection: 'required',
      shipping_address_collection: { allowed_countries: reg.countries },
      phone_number_collection: { enabled: true },
      shipping_options: [{
        shipping_rate_data: {
          type: 'fixed_amount',
          display_name: free ? `${reg.carrier} (free)` : reg.carrier,
          fixed_amount: { amount: free ? 0 : toCents(reg.amount), currency },
          delivery_estimate: {
            minimum: { unit: 'business_day', value: reg.minDays },
            maximum: { unit: 'business_day', value: reg.maxDays },
          },
        },
      }],
      metadata: { shipping_region: reg.id, carrier: reg.carrier },
      locale: 'auto',
      success_url: `${BASE_URL}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${BASE_URL}/cart.html`,
    });
    res.json({ url: session.url });
  } catch (err) {
    console.error('[checkout] Stripe error:', err.message);
    res.status(502).json({ error: 'The payment page could not be opened. Try again in a moment.' });
  }
});

async function handlePaidSession(sessionId) {
  if (orders.isMailed(sessionId)) return; // already handled (Stripe retry)

  const s = await stripe.checkout.sessions.retrieve(sessionId, {
    expand: ['line_items', 'line_items.data.price.product'],
  });
  const ship = s.collected_information?.shipping_details || s.shipping_details || {};
  const cust = s.customer_details || {};

  const order = {
    id: s.id,
    createdAt: new Date(s.created * 1000).toISOString(),
    livemode: s.livemode,
    paymentIntent: typeof s.payment_intent === 'string' ? s.payment_intent : s.payment_intent?.id,
    currency: s.currency,
    total: s.amount_total,
    shippingCost: s.shipping_cost?.amount_total ?? 0,
    region: s.metadata?.shipping_region,
    carrier: s.metadata?.carrier,
    customer: { name: cust.name, email: cust.email, phone: cust.phone },
    billingAddress: cust.address || null,
    shipping: { name: ship.name, address: ship.address || null },
    items: (s.line_items?.data || []).map((li) => ({
      name: li.description,
      sku: li.price?.product?.metadata?.sku || '',
      qty: li.quantity,
      amount: li.amount_total,
    })),
  };

  orders.save(order);
  await sendOrderMail(order);
  orders.markMailed(order.id);
  console.log(`[order] ${order.id} saved and mailed`);
}

// Serves the shop pages too, so the whole thing can be tested locally on http://localhost:3001.
// On the server nginx delivers these files directly.
app.use(express.static(path.join(ROOT, 'public'), { extensions: ['html'] }));

app.listen(PORT, '127.0.0.1', () => console.log(`Ravenyz shop API listening on 127.0.0.1:${PORT}`));
