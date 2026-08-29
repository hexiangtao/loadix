// Terminal typewriter effect: reveal lines one by one.
(function () {
  const lines = document.querySelectorAll('.term-lines .tline');
  let delay = 300; // initial pause before first line
  lines.forEach((line, i) => {
    if (line.classList.contains('blank')) {
      // Blank lines appear instantly-ish, no animation needed.
      setTimeout(() => line.classList.add('visible'), delay);
      delay += 60;
      return;
    }
    setTimeout(() => line.classList.add('visible'), delay);
    delay += 220;
  });
})();

// Scroll-reveal for feature cards.
(function () {
  const targets = document.querySelectorAll('.feature');
  if (!('IntersectionObserver' in window)) {
    targets.forEach((t) => t.classList.add('visible'));
    return;
  }
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.15 },
  );
  targets.forEach((t) => observer.observe(t));
})();
