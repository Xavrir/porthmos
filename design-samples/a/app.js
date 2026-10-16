(() => {
  const count = document.getElementById('approval-count');
  const flag = document.getElementById('needs-you-flag');
  const legNext = document.getElementById('leg-2-next');

  const RESULTS = {
    survey: {
      approve: '<strong>Approved.</strong> A survey is requested at Pasir Panjang and leg 2 stays locked. In the live module this is your signed Approval; this sample sent nothing.',
      deny: '<strong>Denied.</strong> No survey is requested. Leg 2 stays locked until a new proof arrives or you settle it with the supplier.',
    },
    deposit: {
      approve: '<strong>Approved.</strong> In the live app the Authorizer signs a 120-second authorisation and the contract checks it again before 1,000.00 moves. This sample sent nothing.',
      deny: '<strong>Denied.</strong> Nothing moves. Free cash stays at 67,770.00 in the Safe.',
    },
  };
  const NEXT = {
    approve: '<strong>Next: the surveyor.</strong> A cargo survey is requested at Pasir Panjang. The 40,000.00 stays locked until its report arrives.',
    deny: '<strong>Next: you, with the supplier.</strong> No survey is coming. The 40,000.00 stays locked.',
  };

  let open = document.querySelectorAll('.proposal').length;
  document.querySelectorAll('.proposal').forEach((card) => {
    const result = card.querySelector('.p-result');
    card.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-act]');
      if (!btn || card.classList.contains('is-done')) return;
      const act = btn.dataset.act;
      result.innerHTML = RESULTS[card.dataset.id][act];
      card.classList.add('is-done');
      open -= 1;
      count.textContent = String(open);
      if (!open) count.hidden = true;
      if (card.dataset.id === 'survey') {
        legNext.innerHTML = NEXT[act];
        flag.textContent = act === 'approve' ? 'Survey requested' : 'Survey denied';
        flag.classList.add('is-settled');
      }
      result.setAttribute('tabindex', '-1');
      result.focus({ preventScroll: true });
    });
  });
})();
