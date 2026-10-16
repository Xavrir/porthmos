(() => {
  const reveals = document.querySelectorAll('[data-reveal]');
  if (!('IntersectionObserver' in window)) {
    reveals.forEach((el) => el.classList.add('is-in'));
  } else {
    // A shutter is fully clipped while closed, so the observer would never see it; watch its parent.
    const owner = new Map();
    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        (owner.get(entry.target) || entry.target).classList.add('is-in');
        io.unobserve(entry.target);
      }
    }, { rootMargin: '0px 0px -10% 0px', threshold: 0.08 });
    reveals.forEach((el) => {
      const watched = el.classList.contains('shutter') && el.parentElement ? el.parentElement : el;
      if (watched !== el) owner.set(watched, el);
      io.observe(watched);
    });
    addEventListener('load', () => setTimeout(() => {
      reveals.forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.top < innerHeight && r.bottom > 0) el.classList.add('is-in');
      });
    }, 2500));
  }
})();

(() => {
  const chapters = [...document.querySelectorAll('[data-chapter]')];
  const hero = document.querySelector('.hero');
  if (!chapters.length) return;
  const root = document.documentElement;
  // The corner marks sit in the top band of the viewport; take the ink of whichever chapter is under that band.
  const update = () => {
    const probe = Math.min(40, innerHeight * 0.05);
    const under = chapters.find((el) => { const r = el.getBoundingClientRect(); return r.top <= probe && r.bottom > probe; });
    if (under && root.dataset.under !== under.dataset.chapter) root.dataset.under = under.dataset.chapter;
    if (hero) root.classList.toggle('past-hero', hero.getBoundingClientRect().bottom < innerHeight * 0.6);
  };
  addEventListener('scroll', update, { passive: true });
  addEventListener('resize', update);
  update();
})();

(() => {
  const calm = matchMedia('(prefers-reduced-motion: reduce)');
  for (const v of document.querySelectorAll('video[autoplay]')) {
    const start = Number(v.dataset.loopStart || 0);
    const end = Number(v.dataset.loopEnd || 0);
    if (end > start) {
      v.addEventListener('timeupdate', () => { if (v.currentTime >= end || v.currentTime < start - 0.5) v.currentTime = start; });
    }
    const sync = () => {
      if (calm.matches) { v.pause(); return; }
      v.play().catch(() => {});
    };
    if (calm.matches) { v.removeAttribute('autoplay'); v.pause(); }
    calm.addEventListener('change', sync);
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(([e]) => { if (e.isIntersecting) sync(); else v.pause(); }).observe(v);
    }
    document.addEventListener('visibilitychange', () => { if (document.hidden) v.pause(); else sync(); });
  }
})();

(() => {
  const form = document.getElementById('ask-form');
  const box = document.getElementById('verdict');
  if (!form || !box) return;
  const text = form.querySelector('textarea');

  const evidence = '<p class="src">These answers come from a small matcher in this page that applies the published rules. The live agent runs in the app.</p>';
  const answers = {
    elsewhere: {
      word: 'Not representable.',
      body: '<p>Today the contract has two actions: deposit into an approved vault, and redeem to your Safe. TradeFlow adds a third: release a leg to the supplier you registered for this order. None of them takes a new receiver.</p><p>This exact attack was tried on Base Sepolia (E4c). It was held and logged as ledger row 1, and no transaction exists.</p>',
    },
    override: {
      word: 'Held and logged.',
      body: '<p>The agent can only propose, and it can only make a plan more careful, never loosen a limit. A message that asks it to drop its rules is flagged, held and written to the ledger the bank desk reads.</p><p>Even a signed bad action fails on-chain: the receiver is locked to your Safe or your registered supplier.</p>',
    },
    free: {
      word: 'Free cash: 67,770.00 USDC.',
      body: '<p>That is 210,000.00 in the Safe minus a reserve of 142,230.00 (sample treasury). The reserve covers what you owe in the next 30 days, 129,300.00, plus a 10% buffer. Only free cash may go to an approved vault.</p>',
    },
    release: {
      word: 'Leg 2 stays held.',
      body: '<p>The reefer log shows 6.8 °C at its highest, and 3 h 10 min above the 4 °C limit. A leg is released only when its proof checks out, so 40,000.00 USDC waits for the cargo survey. You can approve the survey; you cannot skip the proof.</p>',
    },
    reserve: {
      word: 'Reserve: 142,230.00 USDC.',
      body: '<p>Bills in the next 30 days come to 129,300.00: legs 2 and 3 of this order, payroll on 31 Oct and a forwarder invoice. The buffer is the larger of 500.00 or 10%, here 12,930.00. The floor lives in the contract, so the agent cannot invest it.</p>',
    },
    other: {
      word: 'I can propose, not pay.',
      body: '<p>I can suggest a deposit of free cash into an approved vault, a redeem back to your Safe, or, with TradeFlow, the release of a leg whose proof checks out. Ask me what is free, what is reserved, or about leg 2.</p>',
    },
  };

  const classify = (q) => {
    const s = q.toLowerCase();
    if (/ignore|override|admin|system prompt|previous instructions|you are now|jailbreak|developer mode/.test(s)) return 'override';
    const pays = /\b(send|pay|transfer|wire|move|forward|withdraw|give)\b/.test(s);
    const target = /0x[0-9a-f…]{2,}|wallet|address|account|bank|instead|elsewhere|\bme\b|\bmy\b/.test(s);
    if (pays && target) return 'elsewhere';
    if (/0x[0-9a-f]{6,}/.test(s)) return 'elsewhere';
    if (/release|leg 2|leg two|fish|survey|hold/.test(s)) return 'release';
    if (/free|spare|available|idle|how much|balance/.test(s)) return 'free';
    if (/reserve|owe|bills?|obligation|payroll|floor/.test(s)) return 'reserve';
    return 'other';
  };

  const show = (key) => {
    const a = answers[key];
    box.innerHTML = `<span class="word">${a.word}</span>${a.body}${evidence}`;
    box.classList.remove('is-new');
    void box.offsetWidth;
    box.classList.add('is-new');
  };

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    show(classify(text.value));
  });
  form.querySelectorAll('[data-try]').forEach((b) => b.addEventListener('click', () => {
    text.value = b.dataset.try;
    show(classify(text.value));
  }));
})();

(() => {
  const items = [...document.querySelectorAll('.proof .names li')];
  const key = document.getElementById('proof-key');
  if (!items.length || !key) return;
  let i = 0; let paused = false;
  const light = (n) => {
    items.forEach((li, k) => li.classList.toggle('is-lit', k === n));
    key.innerHTML = items[n].dataset.note;
  };
  light(0);
  items.forEach((li, n) => {
    const a = li.querySelector('a');
    const hold = () => { paused = true; i = n; light(n); };
    a.addEventListener('mouseenter', hold);
    a.addEventListener('focus', hold);
    a.addEventListener('mouseleave', () => { paused = false; });
    a.addEventListener('blur', () => { paused = false; });
  });
  setInterval(() => {
    if (paused || document.hidden) return;
    i = (i + 1) % items.length;
    light(i);
  }, 2000);
})();

(() => {
  const form = document.getElementById('pilot');
  const out = document.getElementById('pilot-result');
  if (!form || !out) return;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = form.company.value.trim();
    out.textContent = name
      ? `Not sent. In the finished page this opens an email with the subject “Pilot: ${name}”.`
      : 'Type your company name first. Nothing is sent from this sample.';
  });
})();
