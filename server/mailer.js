// Sends the order notification to ORDER_NOTIFY_TO (German, for the shop owner).
const nodemailer = require('nodemailer');

const port = Number(process.env.SMTP_PORT) || 465;
const transport = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port,
  secure: port === 465,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});

const money = (cents, cur = 'chf') =>
  new Intl.NumberFormat('de-CH', { style: 'currency', currency: cur.toUpperCase() }).format((cents || 0) / 100);

function formatAddress(name, a) {
  if (!a) return '(keine Adresse)';
  return [name, a.line1, a.line2, `${a.postal_code || ''} ${a.city || ''}`.trim(), a.state, a.country]
    .filter(Boolean).join('\n');
}

async function sendOrderMail(order) {
  const dash = `https://dashboard.stripe.com/${order.livemode ? '' : 'test/'}payments/${order.paymentIntent}`;
  const lines = order.items.map((i) => `${i.qty} × ${i.name}${i.sku ? ` (${i.sku})` : ''}  ${money(i.amount, order.currency)}`);
  const intl = order.region !== 'ch';

  const text = [
    `${order.livemode ? '' : '[TESTMODUS] '}Neue bezahlte Bestellung`,
    '',
    'Artikel:',
    ...lines,
    `Versand (${order.carrier}): ${money(order.shippingCost, order.currency)}`,
    `Total bezahlt: ${money(order.total, order.currency)}`,
    '',
    'Lieferadresse:',
    formatAddress(order.shipping.name, order.shipping.address),
    '',
    'Kunde:',
    `${order.customer.name || ''}`,
    `E-Mail: ${order.customer.email || ''}`,
    `Telefon: ${order.customer.phone || ''}`,
    '',
    'Rechnungsadresse:',
    formatAddress(order.customer.name, order.billingAddress),
    '',
    intl ? 'Hinweis: Lieferung ins Ausland, Zolldokumente (CN23 / Handelsrechnung) beilegen.' : '',
    `Zahlung in Stripe: ${dash}`,
    `Bestell-ID: ${order.id}`,
  ].join('\n');

  await transport.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to: process.env.ORDER_NOTIFY_TO || 'info@hoferaytee.ch',
    replyTo: order.customer.email || undefined,
    subject: `${order.livemode ? '' : '[TEST] '}Neue Bestellung: ${order.items.map((i) => `${i.qty}× ${i.name}`).join(', ')} – ${order.shipping.address?.country || ''}`,
    text,
  });
}

module.exports = { sendOrderMail };
