// Прогрессивные улучшения: подтверждение опасных действий, закрытие уведомлений, плавное появление.
// Без скрипта сайт полностью работает: формы отправляются обычным способом.
(() => {
  document.documentElement.classList.add('js');

  // Подтверждение действий, помеченных data-confirm
  document.addEventListener('submit', (e) => {
    const msg = e.target.dataset?.confirm;
    if (msg && !window.confirm(msg)) e.preventDefault();
  });

  // Закрытие уведомлений; успешные скрываются сами
  document.querySelectorAll('.flash').forEach((box) => {
    box.querySelector('[data-dismiss]')?.addEventListener('click', () => { box.hidden = true; });
    if (box.classList.contains('flash--ok')) setTimeout(() => { box.hidden = true; }, 9000);
  });

  // Фильтры каталога применяются сразу при смене списка, даты или периода
  const filters = document.querySelector('.filters');
  if (filters) {
    filters.querySelectorAll('select, input[type=radio], input[type=checkbox], input[type=date]')
      .forEach((el) => el.addEventListener('change', () => filters.requestSubmit()));
  }

  // Плавное появление блоков при прокрутке
  const targets = document.querySelectorAll('.card, .cat, .steps li, .section__head, .stats, .cta, .catbig__item, .reg-row, .feat');
  if ('IntersectionObserver' in window && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => { if (en.isIntersecting) { en.target.classList.add('is-in'); io.unobserve(en.target); } });
    }, { rootMargin: '0px 0px -8% 0px' });
    targets.forEach((t) => { t.classList.add('reveal'); io.observe(t); });
  }
})();
