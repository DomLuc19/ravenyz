// Ravenyz shop front end: header/footer, cart (stored in the browser) and page rendering.
(() => {
  const CART_KEY = 'ravenyz-cart';
  const chf = new Intl.NumberFormat('de-CH', { style: 'currency', currency: 'CHF' });
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $ = (sel) => document.querySelector(sel);

  /* ---------- cart ---------- */
  const cart = {
    get() {
      try { return JSON.parse(localStorage.getItem(CART_KEY)) || []; } catch { return []; }
    },
    set(items) {
      try { localStorage.setItem(CART_KEY, JSON.stringify(items)); } catch { /* storage blocked */ }
      updateCount();
    },
    add(id, qty) {
      const items = cart.get();
      const line = items.find((i) => i.id === id);
      if (line) line.qty = Math.min(20, line.qty + qty); else items.push({ id, qty });
      cart.set(items);
    },
    update(id, qty) {
      cart.set(cart.get().map((i) => (i.id === id ? { ...i, qty } : i)).filter((i) => i.qty > 0));
    },
    clear() { cart.set([]); },
    count() { return cart.get().reduce((n, i) => n + i.qty, 0); },
  };

  /* ---------- layout ---------- */
  const LOGO = `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M4 22 L14 6 L28 10 L20 14 L24 26 Z" fill="var(--raven)"/><circle cx="16.5" cy="11" r="1.6" fill="var(--paper)"/></svg>`;

  function renderLayout() {
    const header = $('#site-header');
    if (header) {
      header.className = 'site-header';
      header.innerHTML = `<div class="wrap">
        <a class="brand" href="/">${LOGO}<span>ravenyz</span></a>
        <nav class="site-nav" aria-label="Main">
          <a href="/">Products</a>
          <a class="cart-link" href="/cart.html">Cart <span class="cart-count" id="cart-count">0</span></a>
        </nav></div>`;
    }
    const footer = $('#site-footer');
    if (footer) {
      footer.className = 'site-footer';
      footer.innerHTML = `<div class="wrap">
        <span>© ${new Date().getFullYear()} Ravenyz · Switzerland</span>
        <nav aria-label="Legal">
          <a href="/shipping.html">Shipping &amp; returns</a>
          <a href="/terms.html">Terms</a>
          <a href="/privacy.html">Privacy</a>
          <a href="/imprint.html">Imprint</a>
        </nav></div>`;
    }
    updateCount();
  }

  function updateCount() {
    const el = $('#cart-count');
    if (!el) return;
    const n = cart.count();
    el.textContent = n;
    el.toggleAttribute('data-empty', n === 0);
    el.setAttribute('aria-label', `${n} items in cart`);
  }

  /* ---------- data ---------- */
  let productCache;
  async function getProducts() {
    if (!productCache) {
      const res = await fetch('/api/products');
      if (!res.ok) throw new Error('products');
      productCache = await res.json();
    }
    return productCache;
  }

  /* ---------- pages ---------- */
  async function pageCatalog() {
    const list = $('#catalog');
    try {
      const products = await getProducts();
      if (!products.length) { list.innerHTML = '<p class="empty">New devices are on the way. Check back soon.</p>'; return; }
      list.innerHTML = products.map((p) => `
        <article class="row">
          <a class="row-img" href="/product.html?id=${encodeURIComponent(p.id)}" tabindex="-1" aria-hidden="true">
            <img src="/${esc(p.image)}" alt="" loading="lazy"></a>
          <div>
            ${p.sku ? `<p class="sku">${esc(p.sku)}</p>` : ''}
            <h2><a href="/product.html?id=${encodeURIComponent(p.id)}">${esc(p.name)}</a></h2>
            <p class="tagline">${esc(p.tagline)}</p>
            <ul class="highlights">${(p.highlights || []).map((h) => `<li>${esc(h)}</li>`).join('')}</ul>
          </div>
          <div class="row-buy">
            <span class="price">${chf.format(p.price)}</span>
            <a class="btn ghost" href="/product.html?id=${encodeURIComponent(p.id)}">Details</a>
            <button class="btn" data-add="${esc(p.id)}">Add to cart</button>
          </div>
        </article>`).join('');
      list.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-add]');
        if (!btn) return;
        cart.add(btn.dataset.add, 1);
        btn.textContent = 'Added';
        setTimeout(() => { btn.textContent = 'Add to cart'; }, 1500);
      });
    } catch {
      list.innerHTML = '<p class="error">The product list could not be loaded. Reload the page.</p>';
    }
  }

  async function pageProduct() {
    const box = $('#product');
    const id = new URLSearchParams(location.search).get('id');
    try {
      const p = (await getProducts()).find((x) => x.id === id);
      if (!p) { box.innerHTML = '<div class="empty"><h1 class="page-title">Product not found</h1><p>This product is not available. <a href="/">See all products</a>.</p></div>'; return; }
      document.title = `${p.name} – Ravenyz`;
      const specs = Object.entries(p.specs || {});
      box.innerHTML = `<div class="product">
        <div class="product-img"><img src="/${esc(p.image)}" alt="${esc(p.name)}"></div>
        <div>
          ${p.sku ? `<p class="sku">${esc(p.sku)}</p>` : ''}
          <h1>${esc(p.name)}</h1>
          <p class="lead">${esc(p.tagline)}</p>
          <div class="buybox">
            <span class="price">${chf.format(p.price)}</span>
            <label class="visually-hidden" for="qty">Quantity</label>
            <input class="qty" id="qty" type="number" min="1" max="20" value="1" aria-label="Quantity">
            <button class="btn" id="add">Add to cart</button>
          </div>
          <p class="added" id="added" role="status"></p>
          <p>${esc(p.description)}</p>
          ${specs.length ? `<table class="specs"><caption>Specifications</caption>
            ${specs.map(([k, v]) => `<tr><th scope="row">${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</table>` : ''}
        </div></div>`;
      $('#add').addEventListener('click', () => {
        const qty = Math.max(1, Math.min(20, parseInt($('#qty').value, 10) || 1));
        cart.add(p.id, qty);
        $('#added').innerHTML = `${qty} × ${esc(p.name)} added. <a href="/cart.html">Go to cart</a>`;
      });
    } catch {
      box.innerHTML = '<p class="error">The product could not be loaded. Reload the page.</p>';
    }
  }

  async function pageCart() {
    const box = $('#cart');
    let products, regions;
    try {
      [products, regions] = await Promise.all([getProducts(), fetch('/api/shipping').then((r) => r.json())]);
    } catch {
      box.innerHTML = '<p class="error">Your cart could not be loaded. Reload the page.</p>';
      return;
    }
    let region = regions[0]?.id;

    function render() {
      // Drop products that were removed from the shop.
      const items = cart.get().filter((i) => products.some((p) => p.id === i.id));
      if (!items.length) {
        box.innerHTML = '<div class="empty"><p>Your cart is empty.</p><a class="btn" href="/">Browse products</a></div>';
        return;
      }
      const lines = items.map((i) => ({ ...i, p: products.find((p) => p.id === i.id) }));
      const subtotal = lines.reduce((s, l) => s + l.p.price * l.qty, 0);
      const reg = regions.find((r) => r.id === region);
      const free = reg.freeFrom != null && subtotal >= reg.freeFrom;
      const shipCost = free ? 0 : reg.amount;

      box.innerHTML = `<div class="cart">
        <div>${lines.map((l) => `
          <div class="cart-line">
            <img class="thumb" src="/${esc(l.p.image)}" alt="">
            <div>
              <h2>${esc(l.p.name)}</h2>
              <div class="controls">
                <input class="qty" type="number" min="1" max="20" value="${l.qty}" data-qty="${esc(l.id)}" aria-label="Quantity of ${esc(l.p.name)}">
                <button class="link-btn" data-remove="${esc(l.id)}">Remove</button>
              </div>
            </div>
            <strong>${chf.format(l.p.price * l.qty)}</strong>
          </div>`).join('')}
        </div>
        <aside class="summary">
          <h2>Order summary</h2>
          <label for="region">Ship to</label>
          <select id="region">${regions.map((r) => `<option value="${esc(r.id)}" ${r.id === region ? 'selected' : ''}>${esc(r.label)}</option>`).join('')}</select>
          <p class="hint">${esc(reg.carrier)}, ${reg.minDays}–${reg.maxDays} business days${reg.freeFrom != null && !free ? `. Free from ${chf.format(reg.freeFrom)}` : ''}</p>
          <table class="totals">
            <tr><td>Subtotal</td><td>${chf.format(subtotal)}</td></tr>
            <tr><td>Shipping</td><td>${free ? 'Free' : chf.format(shipCost)}</td></tr>
            <tr class="total"><td>Total</td><td>${chf.format(subtotal + shipCost)}</td></tr>
          </table>
          <button class="btn block" id="checkout">Pay with card</button>
          <p class="pay-note">You enter your address and card details on the next page, secured by Stripe.</p>
          <p class="error" id="checkout-error" role="alert"></p>
        </aside></div>`;
    }

    box.addEventListener('change', (e) => {
      if (e.target.id === 'region') { region = e.target.value; render(); }
      if (e.target.dataset.qty) {
        const qty = Math.max(1, Math.min(20, parseInt(e.target.value, 10) || 1));
        cart.update(e.target.dataset.qty, qty); render();
      }
    });
    box.addEventListener('click', async (e) => {
      if (e.target.dataset.remove) { cart.update(e.target.dataset.remove, 0); render(); return; }
      if (e.target.id !== 'checkout') return;
      const btn = e.target;
      const err = $('#checkout-error');
      btn.disabled = true; btn.textContent = 'Opening payment page…'; err.textContent = '';
      try {
        const res = await fetch('/api/checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items: cart.get(), region }),
        });
        const data = await res.json();
        if (!res.ok || !data.url) throw new Error(data.error || 'The payment page could not be opened.');
        location.href = data.url;
      } catch (ex) {
        err.textContent = ex.message;
        btn.disabled = false; btn.textContent = 'Pay with card';
      }
    });
    render();
  }

  function pageSuccess() { cart.clear(); }

  /* ---------- boot ---------- */
  renderLayout();
  const pages = { catalog: pageCatalog, product: pageProduct, cart: pageCart, success: pageSuccess };
  pages[document.body.dataset.page]?.();
})();
