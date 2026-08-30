(() => {
  const suggestionsPanel = document.getElementById('suggestionsPanel');
  const mediaPanel = document.getElementById('mediaPanel');
  const suggestionForm = document.getElementById('suggestionForm');
  const mediaForm = document.getElementById('mediaForm');
  const steamInput = document.getElementById('suggestionSteamUrl');
  const previewButton = document.getElementById('suggestionPreviewButton');
  const mediaInput = document.getElementById('mediaFileInput');
  const mediaTitleInput = document.getElementById('mediaSubmissionTitle');
  const suggestionSubmitButton = document.getElementById('suggestionSubmitButton');
  const mediaSubmitButton = document.getElementById('mediaSubmitButton');
  const dropzone = document.getElementById('mediaDropzone');
  if (!suggestionsPanel || !mediaPanel) return;

  function setLabelText(label, text) {
    if (!label) return;
    const textNode = [...label.childNodes].find(node => node.nodeType === Node.TEXT_NODE);
    if (textNode) textNode.nodeValue = text;
    else label.prepend(document.createTextNode(text));
  }

  suggestionsPanel.classList.add('is-figma-proposal');
  mediaPanel.classList.add('is-figma-proposal');

  if (suggestionForm && !suggestionForm.querySelector('.figma-duration-field')) {
    const label = suggestionForm.querySelector('label[for="suggestionComment"]');
    const field = document.createElement('div');
    field.className = 'figma-duration-field';
    field.innerHTML = `
      <span class="figma-field-label">Количество игроков (опционально)</span>
      <div class="figma-duration-row">
        <input aria-label="Минимальное количество игроков" id="suggestionPlayersMin" min="1" placeholder="Мин" type="number">
        <span>—</span>
        <input aria-label="Максимальное количество игроков" id="suggestionPlayersMax" min="1" placeholder="Макс" type="number">
      </div>`;
    label?.before(field);
  }

  setLabelText(suggestionForm?.querySelector('label[for="suggestionSteamUrl"]'), 'Ссылка на игру в Steam');
  setLabelText(suggestionForm?.querySelector('label[for="suggestionComment"]'), 'Комментарий');
  if (steamInput) steamInput.placeholder = 'Вставить ссылку';
  const suggestionComment = document.getElementById('suggestionComment');
  if (suggestionComment) suggestionComment.placeholder = 'Добавить комментарий';
  if (suggestionSubmitButton) suggestionSubmitButton.textContent = 'Отправить';

  function keepSuggestionSubmitLabel() {
    if (!suggestionSubmitButton) return;
    if (
      suggestionSubmitButton.childElementCount === 1
      && suggestionSubmitButton.firstElementChild?.classList.contains('figma-submit-label')
    ) return;
    const label = document.createElement('span');
    label.className = 'figma-submit-label';
    label.textContent = (suggestionSubmitButton.textContent || '').trim();
    suggestionSubmitButton.replaceChildren(label);
  }

  keepSuggestionSubmitLabel();
  if (suggestionSubmitButton) {
    new MutationObserver(keepSuggestionSubmitLabel).observe(suggestionSubmitButton, { childList: true });
  }

  if (mediaForm && !mediaForm.querySelector('.figma-proposal-title')) {
    const title = document.createElement('h3');
    title.className = 'figma-proposal-title';
    title.textContent = 'Предложить фото/видео';
    mediaForm.prepend(title);
  }

  if (dropzone) {
    const strong = dropzone.querySelector('strong');
    const hint = dropzone.querySelector('span');
    if (strong) {
      const actionLabel = document.createElement('span');
      actionLabel.className = 'figma-file-action-label';
      actionLabel.textContent = 'Выбрать файл';
      strong.replaceChildren(actionLabel);
    }
    if (hint) hint.textContent = 'Не выбрано';
  }

  if (dropzone && !mediaForm?.querySelector('.figma-file-label')) {
    const fileLabel = document.createElement('span');
    fileLabel.className = 'figma-field-label figma-file-label';
    fileLabel.textContent = 'Прикрепить файл';
    dropzone.before(fileLabel);
  }

  if (mediaForm && !mediaForm.querySelector('.figma-media-category-field')) {
    const category = document.createElement('div');
    category.className = 'figma-media-category-field';
    category.innerHTML = `
      <span class="figma-field-label">Выберите категорию</span>
      <div class="figma-media-categories" role="group" aria-label="Категория материала">
        <button class="active" data-category="personal" type="button">Личное</button>
        <button data-category="creative" type="button">Творчество</button>
        <button data-category="internet" type="button">Интернет</button>
      </div>`;
    dropzone?.after(category);
    category.addEventListener('click', event => {
      const button = event.target.closest('button[data-category]');
      if (!button) return;
      category.querySelectorAll('button').forEach(item => item.classList.toggle('active', item === button));
      mediaForm.dataset.category = button.dataset.category || 'personal';
    });
    mediaForm.dataset.category = 'personal';
  }

  const mediaComment = document.getElementById('mediaSubmissionComment');
  setLabelText(mediaForm?.querySelector('label[for="mediaSubmissionComment"]'), 'Комментарий');
  if (mediaComment) mediaComment.placeholder = 'Добавить комментарий';
  if (mediaSubmitButton) mediaSubmitButton.textContent = 'Отправить';

  function keepMediaSubmitLabel() {
    if (!mediaSubmitButton) return;
    if (
      mediaSubmitButton.childElementCount === 1
      && mediaSubmitButton.firstElementChild?.classList.contains('figma-submit-label')
    ) return;
    const label = document.createElement('span');
    label.className = 'figma-submit-label';
    label.textContent = (mediaSubmitButton.textContent || '').trim();
    mediaSubmitButton.replaceChildren(label);
  }

  keepMediaSubmitLabel();
  if (mediaSubmitButton) {
    new MutationObserver(keepMediaSubmitLabel).observe(mediaSubmitButton, { childList: true });
  }

  function fillMediaTitleFromFile() {
    if (!mediaTitleInput || mediaTitleInput.value.trim()) return;
    const file = mediaInput?.files?.[0];
    if (!file) return;
    mediaTitleInput.value = file.name.replace(/\.[^.]+$/, '').slice(0, 120) || 'Материал для стрима';
    mediaTitleInput.dispatchEvent(new Event('input', { bubbles: true }));
  }

  mediaInput?.addEventListener('change', () => window.setTimeout(fillMediaTitleFromFile, 0));
  dropzone?.addEventListener('drop', () => window.setTimeout(fillMediaTitleFromFile, 30));

  function openSuggestions() {
    suggestionsPanel.hidden = false;
    suggestionsPanel.setAttribute('aria-hidden', 'false');
    suggestionsPanel.querySelector('[data-suggestions-panel="rating"]')?.setAttribute('hidden', '');
    suggestionsPanel.querySelector('[data-suggestions-panel="submit"]')?.removeAttribute('hidden');
    document.documentElement.classList.add('suggestions-open');
  }

  function closeSuggestions() {
    suggestionsPanel.hidden = true;
    suggestionsPanel.setAttribute('aria-hidden', 'true');
    document.documentElement.classList.remove('suggestions-open');
  }

  function openMedia() {
    mediaPanel.hidden = false;
    mediaPanel.setAttribute('aria-hidden', 'false');
    mediaPanel.querySelector('[data-media-view="published"]')?.setAttribute('hidden', '');
    mediaPanel.querySelector('[data-media-view="upload"]')?.removeAttribute('hidden');
    document.documentElement.classList.add('media-open');
  }

  function closeMedia() {
    mediaPanel.hidden = true;
    mediaPanel.setAttribute('aria-hidden', 'true');
    document.documentElement.classList.remove('media-open');
  }

  document.querySelectorAll('.proposal-desk-trigger').forEach(trigger => {
    trigger.addEventListener('click', event => {
      event.preventDefault();
      if (trigger.dataset.proposalTab === 'media') openMedia();
      else openSuggestions();
    });
  });

  suggestionsPanel.querySelector('[data-suggestions-close]')?.addEventListener('click', closeSuggestions);
  mediaPanel.querySelector('[data-media-close]')?.addEventListener('click', closeMedia);

  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    if (!mediaPanel.hidden) closeMedia();
    else if (!suggestionsPanel.hidden) closeSuggestions();
  });

  let timer = 0;
  steamInput?.addEventListener('input', () => {
    clearTimeout(timer);
    if (!/store\.steampowered\.com\/app\/\d+/i.test(steamInput.value)) return;
    timer = window.setTimeout(() => previewButton?.click(), 450);
  });
})();
