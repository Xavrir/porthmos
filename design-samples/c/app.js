(() => {
  const reveals = document.querySelectorAll('[data-reveal]');
  if (!('IntersectionObserver' in window)) { reveals.forEach((el) => el.classList.add('is-in')); return; }
  const io = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add('is-in');
      io.unobserve(entry.target);
    }
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.05 });
  reveals.forEach((el) => io.observe(el));
  addEventListener('load', () => setTimeout(() => {
    reveals.forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.top < innerHeight && r.bottom > 0) el.classList.add('is-in');
    });
  }, 2500));
})();

(() => {
  const leg2Next = document.getElementById('leg2-next');
  const leg2Default = leg2Next ? leg2Next.innerHTML : '';
  const messages = {
    survey: {
      approve: 'Approved in this sample. The survey request would go to your surveyor; nothing was sent.',
      deny: 'Denied. Leg 2 stays held; the agent will wait for your next instruction.',
      next: { approve: '<strong>Who acts next</strong>The surveyor at Pasir Panjang: inspect the cargo and sign a report.', deny: '<strong>Who acts next</strong>You: choose another way to settle leg 2.' },
    },
    deposit: {
      approve: 'Approved in this sample. In the live app this signs an authorization and sends one Base Sepolia transaction; this page sends none.',
      deny: 'Denied. The 1,000.00 stays as free cash.',
    },
  };

  document.querySelectorAll('[data-prop]').forEach((card) => {
    const kind = card.dataset.prop;
    const state = card.querySelector('.state');
    const acts = card.querySelector('.acts');
    const buttons = acts.querySelectorAll('[data-act]');

    const reset = () => {
      card.classList.remove('done', 'denied');
      buttons.forEach((b) => { b.hidden = false; });
      state.textContent = '';
      card.querySelector('.undo')?.remove();
      if (kind === 'survey' && leg2Next) leg2Next.innerHTML = leg2Default;
    };

    buttons.forEach((btn) => btn.addEventListener('click', () => {
      const act = btn.dataset.act;
      card.classList.add(act === 'approve' ? 'done' : 'denied');
      buttons.forEach((b) => { b.hidden = true; });
      state.textContent = messages[kind][act];
      const undo = document.createElement('button');
      undo.type = 'button';
      undo.className = 'text-button undo';
      undo.textContent = 'Undo';
      undo.addEventListener('click', () => { reset(); acts.querySelector('[data-act="approve"]').focus(); });
      acts.appendChild(undo);
      if (kind === 'survey' && leg2Next) leg2Next.innerHTML = messages.survey.next[act];
    }));
  });
})();
