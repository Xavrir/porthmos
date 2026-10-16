(() => {
  const calm = matchMedia('(prefers-reduced-motion: reduce)');

  const header = document.querySelector('.top');
  const chapters = document.querySelectorAll('[data-field]');
  let chapterObserver;
  const watchChapters = () => {
    if (!('IntersectionObserver' in window)) return;
    chapterObserver?.disconnect();
    const line = Math.round(header.offsetHeight / 2);
    chapterObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) if (entry.isIntersecting) header.dataset.on = entry.target.dataset.field;
    }, { rootMargin: `-${line}px 0px -${Math.max(0, innerHeight - line - 1)}px 0px`, threshold: 0 });
    chapters.forEach((el) => chapterObserver.observe(el));
  };
  watchChapters();
  let resizeTimer;
  addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(watchChapters, 150); });

  const reveals = document.querySelectorAll('[data-reveal]');
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('is-in');
        io.unobserve(entry.target);
      }
    }, { rootMargin: '0px 0px -10% 0px', threshold: 0.08 });
    reveals.forEach((el) => io.observe(el));
    addEventListener('load', () => setTimeout(() => {
      reveals.forEach((el) => { const r = el.getBoundingClientRect(); if (r.top < innerHeight && r.bottom > 0) el.classList.add('is-in'); });
    }, 2500));
  } else {
    reveals.forEach((el) => el.classList.add('is-in'));
  }

  for (const v of document.querySelectorAll('video[autoplay]')) {
    const sync = () => {
      if (calm.matches) { v.pause(); v.currentTime = 0; }
      else v.play().catch(() => {});
    };
    sync();
    calm.addEventListener('change', sync);
  }

  const toggle = document.querySelector('.menu-toggle');
  const sheet = document.getElementById('menu');
  const setMenu = (open) => {
    sheet.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    document.body.style.overflow = open ? 'hidden' : '';
    if (open) sheet.querySelector('a').focus(); else toggle.focus();
  };
  toggle.addEventListener('click', () => setMenu(sheet.hidden));
  sheet.querySelector('.menu-close').addEventListener('click', () => setMenu(false));
  sheet.addEventListener('click', (e) => { if (e.target.closest('a')) setMenu(false); });
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && !sheet.hidden) setMenu(false); });

  const sentence = document.querySelector('.proof-sentence');
  const names = [...document.querySelectorAll('.proof .name')];
  let lit = 0, paused = false, visible = false;
  const light = (i) => names.forEach((n, j) => n.classList.toggle('is-lit', i === j));
  light(0);
  sentence.addEventListener('pointerenter', () => { paused = true; });
  sentence.addEventListener('pointerleave', () => { paused = false; });
  sentence.addEventListener('focusin', () => { paused = true; });
  sentence.addEventListener('focusout', () => { paused = false; });
  if ('IntersectionObserver' in window) new IntersectionObserver(([e]) => { visible = e.isIntersecting; }).observe(sentence);
  setInterval(() => {
    if (paused || !visible || document.hidden) return;
    lit = (lit + 1) % names.length;
    light(lit);
  }, 2000);

  const tx = (hash) => `https://sepolia.basescan.org/tx/${hash}`;
  const RECORDS = {
    E4a: { hash: '0xdac68e9309a186f0cb6420ec21e3556b9b3efb64c2a3c483500079df595cc3d6', block: '48158282' },
    E4b: { hash: '0x431c79c39fceaabacc3eb4c635be663dbe61001d5d9a542faf7a7f069ea3c5c7', block: '48158278' },
    E4d: { hash: '0x53939b6089bc14ab92a6b7b32d08fc2a539d105e34199c2d86f03609e327acba', block: '48158288' },
  };
  const minedRef = (id, what) => `${what} was tried on Base Sepolia as ${id} and refused: <a href="${tx(RECORDS[id].hash)}">block ${RECORDS[id].block}</a>.`;

  const read = (raw) => {
    const t = raw.toLowerCase().replace(/\s+/g, ' ').trim();
    if (!t) return { head: 'Type a proof.', body: 'An eBL, a reefer log or a quality report. Nothing else moves money.' };
    const asksToRedirect = /\b(pay|send|transfer|wire|route|move|release)\b/.test(t) &&
      (/0x[0-9a-f…]/.test(t) || /\b(instead|another|elsewhere|new (account|address|wallet|bank)|my (account|address|wallet)|changed (bank|banks|account))\b/.test(t));
    if (asksToRedirect) return {
      head: 'Not representable.',
      body: 'The receiver is locked to the registered supplier. The agent has typed actions only, and none of them takes a new address.',
      ref: 'The same request was sent to the agent on Base Sepolia as E4c. It was held and logged; <a href="#e4c">no transaction exists</a>.',
    };
    if (/tamper|\b(amount|invoice|total)\b.*\b(chang|edit|now|raised|to \d)|\b120,?000\b/.test(t)) return {
      head: 'Refused: BadSignature.',
      body: 'The signed amount was 100,000. A changed figure breaks the signature, so the contract will not pay it.',
      ref: minedRef('E4a', 'An amount changed after signing'),
    };
    if (/\b(again|replay|resend|re-send|second time|duplicate|same (proof|signature|authori[sz]ation))\b/.test(t)) return {
      head: 'Refused: NonceUsed.',
      body: 'Each authorisation can be used once. The same one sent twice pays nothing the second time.',
      ref: minedRef('E4b', 'A replayed authorisation'),
    };
    if (/\b(price|peg|oracle)\b/.test(t) && /(0\.9\d+|mov|drop|fell|stale|old)/.test(t)) return {
      head: 'Refused: PriceOutOfBand.',
      body: 'An authorisation carries the price band it was signed in and lives 120 seconds. When the price leaves the band, the contract refuses.',
      ref: minedRef('E4d', 'A price moved to 0.97 after signing'),
    };
    const temp = t.match(/(-?\d+(?:[.,]\d+)?)\s*°\s*c?|(-?\d+(?:[.,]\d+)?)\s*(?:deg(?:rees)?|c\b)/);
    if (/reefer|temperature|cold chain|cold-chain|°/.test(t) || temp) {
      if (!temp) return { head: 'Leg 2 waits.', body: 'The reefer log needs its readings from arrival at Pasir Panjang before leg 2 can be checked.' };
      const c = parseFloat((temp[1] || temp[2]).replace(',', '.'));
      if (c > 4 || c < 0) return {
        head: 'Leg 2 held.',
        body: `40,000.00 USDC stays locked. The set range is 0 to 4 °C${c > 4 ? `, and ${c.toLocaleString('en', { maximumFractionDigits: 1 })} °C is above it` : `, and ${c} °C is below it`}. A cargo survey is requested.`,
      };
      return { head: 'Leg 2 released.', body: '40,000.00 USDC to the registered supplier. The reefer held inside 0 to 4 °C.' };
    }
    if (/\bebl\b|bill of lading|carrier|cat lai|on board|shipped/.test(t)) {
      if (/\b(unsigned|not signed|missing|forged|invalid|wrong signature)\b/.test(t)) return { head: 'Leg 1 held.', body: 'The carrier’s signature does not verify, so 20,000.00 USDC stays locked.' };
      return { head: 'Leg 1 released.', body: '20,000.00 USDC to the registered supplier. The carrier’s signature on the eBL is valid.' };
    }
    if (/quality|survey|surveyor|inspection|inspected/.test(t)) {
      if (/\b(reject|rejected|failed|fails|spoiled|damaged)\b/.test(t)) return { head: 'Leg 3 held.', body: '40,000.00 USDC stays locked. The quality report rejects the cargo.' };
      return { head: 'Leg 3 waits.', body: 'The quality report checks out, but leg 2 is held. A leg after a held leg stays locked until that one is settled.' };
    }
    return { head: 'No rule matches.', body: 'A proof here is a document: an eBL, a reefer log or a quality report. Anything else moves no money.' };
  };

  const input = document.getElementById('proof-input');
  const mirror = document.querySelector('.probe-mirror');
  const line = document.querySelector('.probe-line');
  const head = document.querySelector('.answer-head');
  const body = document.querySelector('.answer-body');
  const ref = document.querySelector('.answer-ref');
  const examples = [...document.querySelectorAll('.example')];

  const placeCaret = () => {
    mirror.textContent = input.value;
    const end = document.createElement('span');
    end.textContent = '\u200b';
    mirror.append(end);
    line.style.setProperty('--caret-x', `${Math.min(end.offsetLeft + 4, input.clientWidth - 6)}px`);
    line.style.setProperty('--caret-y', `${end.offsetTop}px`);
    input.style.height = 'auto';
    input.style.height = `${input.scrollHeight}px`;
  };
  const answer = () => {
    const a = read(input.value);
    head.textContent = a.head;
    body.textContent = a.body;
    ref.innerHTML = a.ref || '';
    examples.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.proof === input.value)));
    placeCaret();
  };
  input.addEventListener('input', answer);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); input.blur(); } });
  document.getElementById('probe').addEventListener('submit', (e) => { e.preventDefault(); answer(); });
  examples.forEach((b) => b.addEventListener('click', () => { input.value = b.dataset.proof; answer(); }));
  if (document.fonts) document.fonts.ready.then(placeCaret);
  addEventListener('resize', placeCaret);
  answer();

  const amount = document.getElementById('amount');
  amount.addEventListener('blur', () => {
    const n = parseInt(amount.value.replace(/\D/g, ''), 10);
    amount.value = Number.isFinite(n) && n > 0 ? Math.min(n, 100000).toLocaleString('en') : '100,000';
  });
})();
