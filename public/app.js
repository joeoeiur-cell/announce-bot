const state = {
  guilds: [],
  channels: [],
  roles: [],
  selectedGuild: null,
  selectedChannel: null,
  config: null,
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  if (res.status === 401) {
    showLogin();
    throw new Error('Not authenticated');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

// ---------- Auth ----------
function showLogin() {
  $('#login-screen').classList.remove('hidden');
  $('#app').classList.add('hidden');
}
function showApp() {
  $('#login-screen').classList.add('hidden');
  $('#app').classList.remove('hidden');
  boot();
}

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const password = $('#password-input').value;
  $('#login-error').textContent = '';
  try {
    await api('/api/login', { method: 'POST', body: JSON.stringify({ password }) });
    showApp();
  } catch (err) {
    $('#login-error').textContent = err.message;
  }
});

$('#logout-btn').addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST' });
  showLogin();
});

async function checkSession() {
  const { authed } = await api('/api/session');
  if (authed) showApp();
  else showLogin();
}

// ---------- Nav ----------
$$('.rail-item[data-view]').forEach((item) => {
  item.addEventListener('click', () => switchView(item.dataset.view));
});

function switchView(view) {
  $$('.rail-item[data-view]').forEach((i) => i.classList.toggle('active', i.dataset.view === view));
  $$('.view').forEach((v) => v.classList.remove('active'));
  $(`#view-${view}`).classList.add('active');
  if (view === 'permissions') loadRoleSelectOptions();
}

// ---------- Boot ----------
async function boot() {
  await Promise.all([refreshBotStatus(), loadConfig()]);
  await loadGuilds();
  bindComposeListeners();
  renderPreview();
  setInterval(refreshBotStatus, 15000);
}

async function refreshBotStatus() {
  try {
    const { ready, info } = await api('/api/bot/status');
    $('#bot-status-dot').classList.toggle('online', ready);
    $('#bot-ready-label').textContent = ready ? 'online' : 'connecting';
    if (info) {
      $('#bot-tag').textContent = info.tag;
      $('#bot-avatar').src = info.avatar;
      $('#prev-bot-avatar').src = info.avatar;
    }
  } catch (e) {}
}

async function loadConfig() {
  state.config = await api('/api/config');
  $('#prev-bot-name').textContent = state.config.botName;
  populatePresetDropdown();
  renderPresetsList();
  fillIdentityForm();
  fillPermissionsForm();
  renderPreview();
}

// ---------- Guilds / channels ----------
async function loadGuilds() {
  state.guilds = await api('/api/guilds');
  const sel = $('#guild-select');
  sel.innerHTML = state.guilds.map((g) => `<option value="${g.id}">${escapeHtml(g.name)}</option>`).join('');
  if (state.guilds.length) {
    state.selectedGuild = state.guilds[0].id;
    sel.value = state.selectedGuild;
    await loadChannelsAndRoles(state.selectedGuild);
  }
}

$('#guild-select').addEventListener('change', async (e) => {
  state.selectedGuild = e.target.value;
  await loadChannelsAndRoles(state.selectedGuild);
});

async function loadChannelsAndRoles(guildId) {
  const [channels, roles] = await Promise.all([
    api(`/api/guilds/${guildId}/channels`),
    api(`/api/guilds/${guildId}/roles`),
  ]);
  state.channels = channels;
  state.roles = roles;

  const chSel = $('#channel-select');
  chSel.innerHTML = channels.map((c) => `<option value="${c.id}">#${escapeHtml(c.name)}</option>`).join('');
  if (channels.length) {
    state.selectedChannel = channels[0].id;
    chSel.value = state.selectedChannel;
  }
  renderAllowedRolesChips();
  loadRoleSelectOptions();
}

$('#channel-select').addEventListener('change', (e) => {
  state.selectedChannel = e.target.value;
});

// ---------- Compose / preview ----------
function populatePresetDropdown() {
  const sel = $('#f-preset');
  const keys = Object.keys(state.config.presets);
  sel.innerHTML = '<option value="">No preset</option>' + keys.map((k) => `<option value="${k}">${escapeHtml(k)}</option>`).join('');
}

function bindComposeListeners() {
  ['f-message', 'f-title', 'f-image'].forEach((id) => $('#' + id).addEventListener('input', renderPreview));
  $('#f-preset').addEventListener('change', renderPreview);
  $('#f-ping-everyone').addEventListener('change', renderPreview);
  $('#f-color').addEventListener('input', (e) => {
    $('#f-color-text').value = e.target.value;
    renderPreview();
  });
  $('#f-color-text').addEventListener('input', (e) => {
    if (/^#[0-9a-fA-F]{6}$/.test(e.target.value)) $('#f-color').value = e.target.value;
    renderPreview();
  });

  $('#ping-disabled-note').classList.toggle('hidden', !!state.config.mentionOptions.everyone);
  $('#f-ping-everyone').disabled = !state.config.mentionOptions.everyone;
}

function currentColor() {
  const presetKey = $('#f-preset').value;
  const preset = presetKey ? state.config.presets[presetKey] : null;
  const custom = $('#f-color-text').value.trim();
  if (custom && /^#[0-9a-fA-F]{6}$/.test(custom)) return custom;
  if (preset) return preset.color;
  return state.config.defaultColor;
}

function renderPreview() {
  const message = $('#f-message').value;
  const title = $('#f-title').value.trim();
  const presetKey = $('#f-preset').value;
  const preset = presetKey ? state.config.presets[presetKey] : null;
  const image = $('#f-image').value.trim();
  const pingEveryone = $('#f-ping-everyone').checked && state.config.mentionOptions.everyone;

  const color = currentColor();
  $('.discord-embed').style.setProperty('--embed-color', color);

  const icon = preset && preset.emoji ? preset.emoji + ' ' : '';
  const displayTitle = title ? icon + title : icon + state.config.botName;
  $('#prev-embed-title').textContent = displayTitle;

  $('#prev-embed-desc').textContent = message || 'Your announcement text will appear here.';

  const imgEl = $('#prev-embed-image');
  if (image) {
    imgEl.src = image;
    imgEl.classList.remove('hidden');
    imgEl.onerror = () => imgEl.classList.add('hidden');
  } else imgEl.classList.add('hidden');

  const thumbEl = $('#prev-embed-thumb');
  if (state.config.thumbnailUrl) {
    thumbEl.src = state.config.thumbnailUrl;
    thumbEl.classList.remove('hidden');
    thumbEl.onerror = () => thumbEl.classList.add('hidden');
  } else thumbEl.classList.add('hidden');

  $('#prev-embed-footer').textContent = (state.config.footerText || '') + ' • Today at 12:00 PM';

  const contentEl = $('#prev-content');
  contentEl.classList.toggle('hidden', !pingEveryone);
}

$('#send-now-btn').addEventListener('click', async () => {
  const statusEl = $('#send-status');
  statusEl.className = 'send-status';

  const message = $('#f-message').value.trim();
  if (!message) {
    statusEl.textContent = 'Message is required.';
    statusEl.classList.add('err');
    return;
  }
  if (!state.selectedChannel) {
    statusEl.textContent = 'Pick a channel first.';
    statusEl.classList.add('err');
    return;
  }

  statusEl.textContent = 'Sending…';
  try {
    await api('/api/announce/send', {
      method: 'POST',
      body: JSON.stringify({
        channelId: state.selectedChannel,
        message,
        title: $('#f-title').value.trim(),
        presetKey: $('#f-preset').value,
        color: $('#f-color-text').value.trim(),
        image: $('#f-image').value.trim(),
        pingEveryone: $('#f-ping-everyone').checked,
      }),
    });
    statusEl.textContent = 'Sent.';
    statusEl.classList.add('ok');
  } catch (err) {
    statusEl.textContent = err.message;
    statusEl.classList.add('err');
  }
});

// ---------- Presets view ----------
function renderPresetsList() {
  const wrap = $('#presets-list');
  const keys = Object.keys(state.config.presets);
  if (!keys.length) {
    wrap.innerHTML = '<div class="empty-state">No presets yet. Add one below.</div>';
    return;
  }
  wrap.innerHTML = keys
    .map((key) => {
      const p = state.config.presets[key];
      return `
      <div class="list-card">
        <div class="preset-swatch" style="background:${escapeAttr(p.color)}"></div>
        <div class="list-card-title">${p.emoji ? escapeHtml(p.emoji) + ' ' : ''}${escapeHtml(key)}</div>
        <div class="list-card-meta">${escapeHtml(p.color)}</div>
        <div class="list-card-actions">
          <button class="btn-danger delete-preset-btn" data-key="${escapeAttr(key)}">Delete</button>
        </div>
      </div>`;
    })
    .join('');

  wrap.querySelectorAll('.delete-preset-btn').forEach((btn) =>
    btn.addEventListener('click', async () => {
      await api(`/api/config/presets/${encodeURIComponent(btn.dataset.key)}`, { method: 'DELETE' });
      await loadConfig();
    })
  );
}

$('#new-preset-color').addEventListener('input', (e) => {
  $('#new-preset-color-text').value = e.target.value;
});
$('#new-preset-color-text').addEventListener('input', (e) => {
  if (/^#[0-9a-fA-F]{6}$/.test(e.target.value)) $('#new-preset-color').value = e.target.value;
});

$('#add-preset-btn').addEventListener('click', async () => {
  const statusEl = $('#preset-add-status');
  const key = $('#new-preset-key').value.trim().toLowerCase().replace(/\s+/g, '-');
  const color = $('#new-preset-color-text').value.trim();
  const emoji = $('#new-preset-emoji').value.trim();

  if (!key) {
    statusEl.textContent = 'Key is required.';
    statusEl.className = 'send-status err';
    return;
  }
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) {
    statusEl.textContent = 'Enter a valid hex color.';
    statusEl.className = 'send-status err';
    return;
  }

  try {
    await api(`/api/config/presets/${encodeURIComponent(key)}`, {
      method: 'PUT',
      body: JSON.stringify({ color, emoji }),
    });
    statusEl.textContent = 'Preset added.';
    statusEl.className = 'send-status ok';
    $('#new-preset-key').value = '';
    $('#new-preset-emoji').value = '';
    await loadConfig();
  } catch (err) {
    statusEl.textContent = err.message;
    statusEl.className = 'send-status err';
  }
});

// ---------- Identity view ----------
function fillIdentityForm() {
  const c = state.config;
  $('#cfg-botName').value = c.botName || '';
  $('#cfg-defaultColor').value = c.defaultColor || '#5865f2';
  $('#cfg-defaultColor-text').value = c.defaultColor || '#5865f2';
  $('#cfg-footerText').value = c.footerText || '';
  $('#cfg-footerIconUrl').value = c.footerIconUrl || '';
  $('#cfg-thumbnailUrl').value = c.thumbnailUrl || '';
}

$('#cfg-defaultColor').addEventListener('input', (e) => {
  $('#cfg-defaultColor-text').value = e.target.value;
});
$('#cfg-defaultColor-text').addEventListener('input', (e) => {
  if (/^#[0-9a-fA-F]{6}$/.test(e.target.value)) $('#cfg-defaultColor').value = e.target.value;
});

$('#save-identity-btn').addEventListener('click', async () => {
  const statusEl = $('#identity-status');
  const next = {
    ...state.config,
    botName: $('#cfg-botName').value.trim() || 'Announcer',
    defaultColor: $('#cfg-defaultColor-text').value.trim(),
    footerText: $('#cfg-footerText').value.trim(),
    footerIconUrl: $('#cfg-footerIconUrl').value.trim(),
    thumbnailUrl: $('#cfg-thumbnailUrl').value.trim(),
  };
  try {
    await api('/api/config', { method: 'PUT', body: JSON.stringify(next) });
    statusEl.textContent = 'Saved.';
    statusEl.className = 'send-status ok';
    await loadConfig();
  } catch (err) {
    statusEl.textContent = err.message;
    statusEl.className = 'send-status err';
  }
});

// ---------- Permissions view ----------
function fillPermissionsForm() {
  $('#cfg-mention-everyone').checked = !!state.config.mentionOptions.everyone;
  $('#cfg-mention-here').checked = !!state.config.mentionOptions.here;
  renderAllowedRolesChips();
}

function renderAllowedRolesChips() {
  const wrap = $('#allowed-roles-list');
  const ids = state.config.allowedRoleIds || [];
  if (!ids.length) {
    wrap.innerHTML = '<div class="hint-text" style="margin:0">No roles added — anyone with Manage Messages can announce.</div>';
    return;
  }
  wrap.innerHTML = ids
    .map((id) => {
      const role = state.roles.find((r) => r.id === id);
      const label = role ? role.name : id;
      return `<span class="role-chip">${escapeHtml(label)}<button data-id="${escapeAttr(id)}" title="Remove">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>
      </button></span>`;
    })
    .join('');

  wrap.querySelectorAll('button[data-id]').forEach((btn) =>
    btn.addEventListener('click', () => {
      state.config.allowedRoleIds = state.config.allowedRoleIds.filter((id) => id !== btn.dataset.id);
      renderAllowedRolesChips();
    })
  );
}

function loadRoleSelectOptions() {
  const sel = $('#add-role-select');
  const already = new Set(state.config?.allowedRoleIds || []);
  sel.innerHTML = state.roles
    .filter((r) => !already.has(r.id))
    .map((r) => `<option value="${r.id}">${escapeHtml(r.name)}</option>`)
    .join('');
}

$('#add-role-btn').addEventListener('click', () => {
  const sel = $('#add-role-select');
  if (!sel.value) return;
  state.config.allowedRoleIds = [...(state.config.allowedRoleIds || []), sel.value];
  renderAllowedRolesChips();
  loadRoleSelectOptions();
});

$('#save-permissions-btn').addEventListener('click', async () => {
  const statusEl = $('#permissions-status');
  const next = {
    ...state.config,
    allowedRoleIds: state.config.allowedRoleIds || [],
    mentionOptions: {
      everyone: $('#cfg-mention-everyone').checked,
      here: $('#cfg-mention-here').checked,
    },
  };
  try {
    await api('/api/config', { method: 'PUT', body: JSON.stringify(next) });
    statusEl.textContent = 'Saved.';
    statusEl.className = 'send-status ok';
    await loadConfig();
  } catch (err) {
    statusEl.textContent = err.message;
    statusEl.className = 'send-status err';
  }
});

// ---------- Utils ----------
function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(str) {
  return escapeHtml(str || '');
}

checkSession();
