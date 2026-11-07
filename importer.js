(() => {
  'use strict';

  // Works only in Loneti's drawing editor, never on other pages.
  if (!/^\/draw(?:\/|$|\?)/.test(location.pathname + location.search)) return;
  if (window.__lonetiPngImporterInstalled) return;
  window.__lonetiPngImporterInstalled = true;

  const state = { app: null, status: null, button: null, preview: null, file: null, busy: false };

  // Loneti keeps its editor instance in a webpack-local variable. Capture it
  // during construction, without changing its JS bundle or touching the server.
  // The setter is removed immediately after detecting the correct instance.
  function captureEditorAtStartup() {
    if (window.lonetiApp?.users_canvas) {
      state.app = window.lonetiApp;
      return;
    }
    if (Object.getOwnPropertyDescriptor(Object.prototype, 'users_canvas')) return;
    Object.defineProperty(Object.prototype, 'users_canvas', {
      configurable: true,
      enumerable: false,
      get() { return undefined; },
      set(value) {
        // Preserve how normal assignments behave: create an own property.
        Object.defineProperty(this, 'users_canvas', {
          value, writable: true, configurable: true, enumerable: true
        });
        if (value &&
            typeof this.initWorkCanvas === 'function' &&
            typeof this.updateArtCanvas === 'function' &&
            typeof this.getSizeCanvas === 'function' &&
            typeof value.getMyUser === 'function') {
          state.app = this;
          delete Object.prototype.users_canvas;
          updateReadyState();
        }
      }
    });
  }

  function editorContext() {
    const app = state.app || window.lonetiApp;
    if (!app?.users_canvas?.getMyUser || !app?.layer_actions || !app?.updateArtCanvas) return null;
    const user = app.users_canvas.getMyUser();
    const layer = user?.user_layers?.getActiveLayer?.();
    if (!layer?.$layer || !layer?.ctx || !user?.user_events?.trigger) return null;
    return { app, user, layer };
  }

  function setStatus(message, error = false) {
    if (state.status) {
      state.status.textContent = message;
      state.status.style.color = error ? '#ffb1b7' : '#bdc9e1';
    }
  }

  function updateReadyState() {
    if (!state.button || state.busy) return;
    const ready = !!editorContext();
    state.button.disabled = !ready || !state.file;
    if (!ready) {
      setStatus(state.app
        ? 'Жду загрузки слоя Loneti…'
        : 'Редактор не обнаружен. Обнови вкладку Loneti (F5).');
    } else if (state.file) {
      setStatus(`Готово: ${state.file.name}. Можно переносить.`);
    } else {
      const { layer } = editorContext();
      setStatus(`Слой готов (${layer.$layer.width} × ${layer.$layer.height}). Выбери изображение.`);
    }
  }

  function layerHasContent(canvas) {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] > 0) return true;
    }
    return false;
  }

  async function importImage(file, fit, replace) {
    const context = editorContext();
    if (!context) throw new Error('Слой Loneti не готов. Обнови страницу.');
    const { app, user, layer } = context;
    if (layer.params?.is_lock) throw new Error('Выбранный слой заблокирован. Сними замок.');
    if (layer.params?.hide) throw new Error('Выбранный слой скрыт. Включи его видимость.');

    const canvas = layer.$layer;
    const ctx = layer.ctx;
    if (replace && layerHasContent(canvas) &&
        !confirm('В активном слое уже есть рисунок. Заменить его?')) {
      return false;
    }

    // Build the image offscreen first: if decode fails, layer stays untouched.
    const bitmap = await createImageBitmap(file);
    let w = canvas.width, h = canvas.height, x = 0, y = 0;
    if (fit === 'contain') {
      const scale = Math.min(canvas.width / bitmap.width, canvas.height / bitmap.height);
      w = bitmap.width * scale;
      h = bitmap.height * scale;
      x = (canvas.width - w) / 2;
      y = (canvas.height - h) / 2;
    } else if (fit === 'original') {
      w = bitmap.width;
      h = bitmap.height;
      x = Math.floor((canvas.width - w) / 2);
      y = Math.floor((canvas.height - h) / 2);
    }

    try {
      // Destination is the REAL Layer 1 bitmap, not the display canvas.
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      if (replace) ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bitmap, x, y, w, h);
      ctx.restore();

      // Native Loneti APIs for preview, compositing, history, and autosave.
      const id = app.users_canvas.getMyIdUser();
      app.layer_actions.savePreviewLayer(id, layer.index);
      app.updateArtCanvas(true);
      user.user_events.trigger('save_history');
    } finally {
      bitmap.close();
    }
    return true;
  }

  function mountUI() {
    if (!document.body || document.getElementById('loneti-png-importer-root')) return;
    const root = document.createElement('div');
    root.id = 'loneti-png-importer-root';
    document.body.appendChild(root);
    const shadow = root.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>
        * { box-sizing: border-box; }
        .launch { position:fixed; z-index:2147483645; right:16px; bottom:18px;
          border:1px solid #7194ff; background:#2344a2; color:white; font:600 13px Arial,sans-serif;
          border-radius:12px; padding:11px 15px; cursor:pointer; box-shadow:0 3px 18px #0005; }
        .launch:hover { background:#3155bd; }
        .panel { position:fixed; z-index:2147483646; right:16px; bottom:69px;
          width:min(320px,calc(100vw - 32px)); color:#f4f6ff; background:#1b2031;
          border:1px solid #41516f; border-radius:13px; box-shadow:0 12px 30px #0009;
          padding:16px; font:13px/1.5 Arial,sans-serif; }
        .hidden { display:none; }
        h2 { font-size:17px; margin:0 0 7px; }
        label { display:block; font-size:12px; color:#d3d9e8; margin-top:11px; }
        input[type=file], select { display:block; width:100%; margin-top:5px; padding:7px;
          border:1px solid #59647e; border-radius:7px; color:#e5e9f2; background:#292e42;
          font:inherit; }
        select { cursor:pointer; }
        .check { display:flex; align-items:center; gap:7px; }
        .check input { margin:0; }
        .primary { width:100%; margin-top:12px; padding:10px; cursor:pointer; border-radius:8px;
          color:#fff; border:0; background:#2662d3; font:600 13px Arial,sans-serif; }
        .primary:disabled { opacity:.5; cursor:not-allowed; }
        .note { font-size:11px; color:#b4bed1; margin-top:10px; }
        .status { min-height:34px; margin-top:9px; overflow-wrap:anywhere; color:#bdc9e1; }
        .preview { display:none; width:100%; max-height:140px; object-fit:contain;
          margin-top:8px; background:#303344; border-radius:6px; }
        .close { float:right; background:transparent; border:0; color:#c8d0e2;
          font-size:18px; cursor:pointer; }
      </style>
      <button class="launch" id="toggle" type="button">⬆ PNG → Loneti</button>
      <section class="panel hidden" id="panel" aria-label="Импорт изображения в Loneti">
        <button class="close" id="close" title="Свернуть" type="button">×</button>
        <h2>Импорт в Loneti</h2>
        <div>PNG, JPG, WebP прямо в активный слой.</div>
        <label>Файл <input id="file" type="file" accept="image/png,image/jpeg,image/webp"></label>
        <img id="preview" class="preview" alt="Предпросмотр">
        <label>Размещение
          <select id="fit">
            <option value="contain">Вписать целиком, без обрезки</option>
            <option value="stretch">Растянуть на весь холст</option>
            <option value="original">Исходный размер, по центру</option>
          </select>
        </label>
        <label class="check"><input id="replace" type="checkbox" checked> Заменить содержимое активного слоя</label>
        <button class="primary" id="import" type="button" disabled>Перенести изображение</button>
        <div class="status" id="status" role="status"></div>
        <div class="note">Работает только в твоём текущем слое. После переноса проверь рисунок и используй обычное сохранение Loneti.</div>
      </section>`;

    const $ = (selector) => shadow.querySelector(selector);
    const panel = $('#panel');
    const button = $('#import');
    const input = $('#file');
    const preview = $('#preview');
    state.status = $('#status');
    state.button = button;
    state.preview = preview;

    $('#toggle').addEventListener('click', () => {
      panel.classList.toggle('hidden');
      updateReadyState();
    });
    $('#close').addEventListener('click', () => panel.classList.add('hidden'));
    input.addEventListener('change', () => {
      state.file = input.files?.[0] || null;
      if (preview.dataset.url) URL.revokeObjectURL(preview.dataset.url);
      preview.dataset.url = '';
      if (state.file) {
        const objectUrl = URL.createObjectURL(state.file);
        preview.src = objectUrl;
        preview.dataset.url = objectUrl;
        preview.style.display = 'block';
      } else {
        preview.style.display = 'none';
      }
      updateReadyState();
    });
    button.addEventListener('click', async () => {
      if (!state.file || state.busy) return;
      state.busy = true;
      button.disabled = true;
      setStatus('Переношу изображение…');
      try {
        const done = await importImage(state.file, $('#fit').value, $('#replace').checked);
        if (done) setStatus('✓ Изображение в слое! Проверь и сохрани рисунок в Loneti.');
        else setStatus('Отменено, рисунок не изменён.');
      } catch (error) {
        console.error('[Loneti PNG Importer]', error);
        setStatus(`Ошибка: ${error.message || error}`, true);
      } finally {
        state.busy = false;
        button.disabled = !editorContext() || !state.file;
      }
    });

    // Don't accidentally trigger Loneti's painting shortcuts from our UI.
    shadow.addEventListener('keydown', (event) => event.stopPropagation());
    updateReadyState();
    const timer = setInterval(() => {
      if (!root.isConnected) { clearInterval(timer); return; }
      if (!state.busy && !editorContext() && panel.classList.contains('hidden') === false) updateReadyState();
    }, 1500);
  }

  captureEditorAtStartup();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountUI, { once: true });
  } else {
    mountUI();
  }
})();
