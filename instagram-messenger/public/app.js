const state = {
  contacts: [],
  selected: new Set(),
  status: {}, // id -> { type: 'ok' | 'err', text }
  sending: false,
  stopRequested: false,
  sendDelayMs: 1500,
};

const $ = (id) => document.getElementById(id);
const els = {
  account: $('account'), demoBadge: $('demo-badge'), list: $('list'), count: $('count'),
  search: $('search'), selectAll: $('select-all'), onlyEligible: $('only-eligible'),
  refresh: $('refresh'), message: $('message'), chars: $('chars'),
  selectedCount: $('selected-count'), send: $('send'), stop: $('stop'),
  progressWrap: $('progress-wrap'), progressBar: $('progress-bar'), progressText: $('progress-text'),
  log: $('log'),
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function escapeHtml(str = '') {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function personalize(text, contact) {
  const firstName = (contact.name || contact.username || '').split(' ')[0];
  return text.replaceAll('{nome}', firstName).replaceAll('{usuario}', `@${contact.username}`);
}

function timeLeft(iso) {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return null;
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h > 0 ? `${h}h ${m}min` : `${m}min`;
}

function visibleContacts() {
  const q = els.search.value.trim().toLowerCase();
  return state.contacts.filter((c) => {
    if (els.onlyEligible.checked && !c.canMessage) return false;
    if (!q) return true;
    return c.username?.toLowerCase().includes(q) || c.name?.toLowerCase().includes(q);
  });
}

function render() {
  const visible = visibleContacts();
  const eligibleVisible = visible.filter((c) => c.canMessage);
  els.count.textContent = `(${visible.length})`;

  if (!visible.length) {
    els.list.innerHTML = `<li class="empty">Nenhum contato encontrado.</li>`;
  } else {
    els.list.innerHTML = visible.map((c) => {
      const checked = state.selected.has(c.id);
      const left = c.windowExpiresAt && timeLeft(c.windowExpiresAt);
      const status = state.status[c.id];
      return `
        <li data-id="${escapeHtml(c.id)}" class="${c.canMessage ? '' : 'disabled'} ${checked ? 'selected' : ''}">
          <input type="checkbox" ${checked ? 'checked' : ''} ${c.canMessage ? '' : 'disabled'} aria-label="Selecionar ${escapeHtml(c.username)}" />
          <span class="avatar">${escapeHtml((c.name || c.username || '?')[0].toUpperCase())}</span>
          <div class="info">
            <div class="name">${escapeHtml(c.name)} <span class="muted">@${escapeHtml(c.username)}</span></div>
            <div class="sub">${c.canMessage ? `Janela aberta · expira em ${left}` : 'Fora da janela de 24h'}${c.lastMessage ? ` · “${escapeHtml(c.lastMessage)}”` : ''}</div>
          </div>
          <div class="row-actions">
            ${status ? `<span class="status ${status.type}">${escapeHtml(status.text)}</span>` : ''}
            <button class="small send-one" type="button" ${c.canMessage && !state.sending ? '' : 'disabled'}>Enviar</button>
          </div>
        </li>`;
    }).join('');
  }

  els.selectAll.checked = eligibleVisible.length > 0 && eligibleVisible.every((c) => state.selected.has(c.id));
  els.selectAll.indeterminate = !els.selectAll.checked && eligibleVisible.some((c) => state.selected.has(c.id));
  els.selectedCount.textContent = state.selected.size;
  els.chars.textContent = `${els.message.value.length}/1000`;
  els.send.disabled = state.sending || !state.selected.size || !els.message.value.trim();
  els.send.textContent = state.selected.size > 1
    ? `Enviar para ${state.selected.size} contatos`
    : 'Enviar para selecionados';
}

function addLog(contact, type, text) {
  const li = document.createElement('li');
  const time = new Date().toLocaleTimeString('pt-BR');
  li.innerHTML = `<span class="${type}">${type === 'ok' ? '✔' : '✖'}</span> ${time} · @${escapeHtml(contact.username)} — ${escapeHtml(text)}`;
  els.log.prepend(li);
}

async function api(url, options) {
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Erro ${res.status}`);
  return data;
}

async function sendTo(contact, template) {
  const text = personalize(template, contact);
  try {
    await api('/api/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipientId: contact.id, text }),
    });
    state.status[contact.id] = { type: 'ok', text: 'Enviada' };
    addLog(contact, 'ok', 'mensagem enviada');
    return true;
  } catch (err) {
    state.status[contact.id] = { type: 'err', text: 'Falhou' };
    addLog(contact, 'err', err.message);
    return false;
  }
}

async function sendMany(contacts) {
  const template = els.message.value.trim();
  if (!template || !contacts.length) return;
  if (contacts.length > 1 && !confirm(`Enviar a mensagem para ${contacts.length} contatos?`)) return;

  state.sending = true;
  state.stopRequested = false;
  els.stop.hidden = contacts.length < 2;
  els.progressWrap.hidden = false;
  let ok = 0;
  let fail = 0;

  for (let i = 0; i < contacts.length; i++) {
    if (state.stopRequested) break;
    els.progressText.textContent = `Enviando ${i + 1} de ${contacts.length} — @${contacts[i].username}`;
    render();
    (await sendTo(contacts[i], template)) ? ok++ : fail++;
    state.selected.delete(contacts[i].id);
    els.progressBar.style.width = `${((i + 1) / contacts.length) * 100}%`;
    if (i < contacts.length - 1 && !state.stopRequested) await sleep(state.sendDelayMs);
  }

  const stopped = state.stopRequested ? ' (interrompido)' : '';
  els.progressText.textContent = `Concluído${stopped}: ${ok} enviada(s), ${fail} falha(s).`;
  state.sending = false;
  els.stop.hidden = true;
  render();
}

async function loadContacts() {
  els.list.innerHTML = `<li class="empty">Carregando contatos…</li>`;
  try {
    const { contacts } = await api('/api/contacts');
    state.contacts = contacts;
    // Remove da seleção quem não pode mais receber mensagem.
    for (const id of [...state.selected]) {
      if (!contacts.find((c) => c.id === id && c.canMessage)) state.selected.delete(id);
    }
    render();
  } catch (err) {
    els.list.innerHTML = `<li class="empty">Erro ao carregar contatos: ${escapeHtml(err.message)}</li>`;
  }
}

async function init() {
  try {
    const config = await api('/api/config');
    state.sendDelayMs = config.sendDelayMs;
    els.demoBadge.hidden = !config.demoMode;
    const account = await api('/api/account');
    els.account.textContent = `@${account.username}`;
  } catch (err) {
    els.account.textContent = `Não foi possível conectar: ${err.message}`;
  }
  await loadContacts();
}

// ---------- Eventos ----------
els.list.addEventListener('click', (e) => {
  const li = e.target.closest('li[data-id]');
  if (!li) return;
  const contact = state.contacts.find((c) => c.id === li.dataset.id);
  if (!contact || !contact.canMessage) return;

  if (e.target.closest('.send-one')) {
    if (!els.message.value.trim()) {
      els.message.focus();
      return alert('Escreva a mensagem primeiro.');
    }
    sendMany([contact]);
    return;
  }
  if (state.sending) return;
  state.selected.has(contact.id) ? state.selected.delete(contact.id) : state.selected.add(contact.id);
  render();
});

els.selectAll.addEventListener('change', () => {
  for (const c of visibleContacts().filter((c) => c.canMessage)) {
    els.selectAll.checked ? state.selected.add(c.id) : state.selected.delete(c.id);
  }
  render();
});

els.search.addEventListener('input', render);
els.onlyEligible.addEventListener('change', render);
els.message.addEventListener('input', render);
els.refresh.addEventListener('click', loadContacts);
els.stop.addEventListener('click', () => { state.stopRequested = true; });
els.send.addEventListener('click', () => {
  sendMany(state.contacts.filter((c) => state.selected.has(c.id) && c.canMessage));
});

init();
