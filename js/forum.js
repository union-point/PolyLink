function applyTheme(theme) {
  const root = document.documentElement;
  // Remove existing theme classes
  root.classList.remove('theme-light', 'theme-dark', 'theme-auto');

  if (theme === 'dark') {
    root.classList.add('theme-dark');
  } else if (theme === 'light') {
    root.classList.add('theme-light');
  } else {
    // Auto: follow system preference
    root.classList.add('theme-auto');
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      root.classList.add('theme-dark');
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {

  // Load saved theme
  const savedTheme = localStorage.getItem('theme') || 'light';
  applyTheme(savedTheme);

  // Listen for system theme changes if auto
  if (savedTheme === 'auto') {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
      if (localStorage.getItem('theme') === 'auto') {
        applyTheme('auto');
      }
    });
  }
});
// Topic filtering functionality
function filterTopics() {
  const filterValue = document.getElementById('major-filter').value;
  const topics = document.querySelectorAll('.topic');

  topics.forEach(topic => {
    if (filterValue === 'all' || topic.dataset.major === filterValue) {
      topic.style.display = 'block';
    } else {
      topic.style.display = 'none';
    }
  });
}
// ============================================
// Topic page specific JS
// ============================================

// Like button functionality
document.querySelectorAll('.like-btn, .reply-action-btn').forEach(btn => {
  btn.addEventListener('click', function () {
    this.classList.toggle('active');
  });
});

// Reply button functionality
document.querySelectorAll('.reply-action-btn').forEach(btn => {
  if (btn.textContent.includes('Պատասխանել')) {
    btn.addEventListener('click', function () {
      document.querySelector('.reply-textarea').focus();
    });
  }
});
// format buttons functionality
document.querySelectorAll('.format-btn').forEach(btn => {
  btn.addEventListener('click', function () {
    this.classList.toggle('active');
  });
});
// Form submission
document.querySelector('.reply-form')?.addEventListener('submit', function (e) {
  e.preventDefault();
  const textarea = this.querySelector('.reply-textarea');
  if (textarea.value.trim()) {
    alert('Ձեր պատասխանը հրապարակվել է։');
    textarea.value = '';
  }
});


// ============================================
// new-topic page specific JS
// ============================================



