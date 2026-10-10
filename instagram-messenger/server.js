import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT) || 3000;
const API_VERSION = process.env.GRAPH_API_VERSION || 'v23.0';
const GRAPH_URL = `https://graph.instagram.com/${API_VERSION}`;
const SEND_DELAY_MS = Number(process.env.SEND_DELAY_MS) || 1500;
const DEMO_MODE = process.env.DEMO_MODE === 'true' || !process.env.INSTAGRAM_ACCESS_TOKEN;
const TOKEN = process.env.INSTAGRAM_ACCESS_TOKEN;

// A Meta só permite responder dentro de 24h após a última mensagem do contato.
const MESSAGING_WINDOW_MS = 24 * 60 * 60 * 1000;

const app = express();
app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(__dirname, 'public')));

async function graph(pathname, { method = 'GET', params = {}, body } = {}) {
  const url = new URL(`${GRAPH_URL}${pathname}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    const err = new Error(data.error?.message || `Erro HTTP ${res.status}`);
    err.status = res.status;
    err.code = data.error?.code;
    throw err;
  }
  return data;
}

let cachedAccount = null;
async function getAccount() {
  if (!cachedAccount) {
    cachedAccount = await graph('/me', { params: { fields: 'user_id,username,name,profile_picture_url' } });
  }
  return cachedAccount;
}

function withWindow(contact) {
  const last = contact.lastIncomingAt ? new Date(contact.lastIncomingAt).getTime() : 0;
  const expiresAt = last ? last + MESSAGING_WINDOW_MS : null;
  return {
    ...contact,
    canMessage: Boolean(expiresAt && expiresAt > Date.now()),
    windowExpiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
  };
}

// ---------- Modo demonstração ----------
const demoNames = [
  'ana.souza', 'bruno_lima', 'carla.mendes', 'diego.rocha', 'eduarda_f',
  'felipe.alves', 'gabi.costa', 'henrique_s', 'isabela.ramos', 'joao.pedro',
  'karina.melo', 'lucas.tavares',
];
const demoContacts = demoNames.map((username, i) => ({
  id: `demo-${i + 1}`,
  username,
  name: username.replace(/[._]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
  lastMessage: ['Vocês abrem domingo?', 'Qual o cardápio de hoje?', 'Obrigado!', 'Fazem entrega?'][i % 4],
  // Alguns contatos ficam fora da janela de 24h para demonstrar o bloqueio.
  lastIncomingAt: new Date(Date.now() - (i % 5 === 4 ? 30 : i + 1) * 60 * 60 * 1000).toISOString(),
}));

// ---------- Rotas ----------
app.get('/api/config', (_req, res) => {
  res.json({ demoMode: DEMO_MODE, sendDelayMs: SEND_DELAY_MS });
});

app.get('/api/account', async (_req, res) => {
  if (DEMO_MODE) return res.json({ username: 'meu_restaurante', name: 'Conta de demonstração' });
  try {
    res.json(await getAccount());
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.get('/api/contacts', async (_req, res) => {
  if (DEMO_MODE) return res.json({ contacts: demoContacts.map(withWindow) });

  try {
    const account = await getAccount();
    const myIds = new Set([account.user_id, account.id].filter(Boolean).map(String));
    const contacts = [];
    let next = null;
    let pages = 0;

    do {
      const data = next
        ? await fetch(next, { headers: { Authorization: `Bearer ${TOKEN}` } }).then((r) => r.json())
        : await graph('/me/conversations', {
            params: {
              platform: 'instagram',
              fields: 'id,updated_time,participants,messages.limit(10){from,created_time,message}',
              limit: '50',
            },
          });
      if (data.error) throw new Error(data.error.message);

      for (const convo of data.data || []) {
        const other = (convo.participants?.data || []).find((p) => !myIds.has(String(p.id)) && p.username !== account.username);
        if (!other) continue;
        const messages = convo.messages?.data || [];
        const lastIncoming = messages.find((m) => String(m.from?.id) === String(other.id));
        contacts.push({
          id: other.id,
          username: other.username,
          name: other.name || other.username,
          conversationId: convo.id,
          lastMessage: messages[0]?.message || '',
          lastIncomingAt: lastIncoming?.created_time || null,
        });
      }
      next = data.paging?.next;
      pages += 1;
    } while (next && pages < 20);

    res.json({ contacts: contacts.map(withWindow) });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.post('/api/send', async (req, res) => {
  const { recipientId, text } = req.body || {};
  if (!recipientId || typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: 'recipientId e text são obrigatórios.' });
  }
  if (text.length > 1000) {
    return res.status(400).json({ error: 'A mensagem pode ter no máximo 1000 caracteres.' });
  }

  if (DEMO_MODE) {
    await new Promise((r) => setTimeout(r, 300));
    const contact = demoContacts.find((c) => c.id === recipientId);
    if (contact && !withWindow(contact).canMessage) {
      return res.status(400).json({ error: 'Fora da janela de 24h (simulado).' });
    }
    return res.json({ ok: true, demo: true, messageId: `demo-msg-${Date.now()}` });
  }

  try {
    const data = await graph('/me/messages', {
      method: 'POST',
      body: { recipient: { id: recipientId }, message: { text } },
    });
    res.json({ ok: true, messageId: data.message_id });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message, code: err.code });
  }
});

app.listen(PORT, () => {
  console.log(`Instagram Messenger rodando em http://localhost:${PORT}`);
  if (DEMO_MODE) console.log('Modo DEMONSTRAÇÃO ativo: nenhuma mensagem real será enviada.');
});
