// Conexão com o WhatsApp Web por QR Code (sem a API oficial). Usa a biblioteca Baileys (npm install).
// A sessão fica salva na pasta "whats-sessao" ao lado do servidor: depois de escanear uma vez, reconecta sozinho.
const fs = require("fs"), path = require("path");
const PASTA = path.join(__dirname, "whats-sessao"), ARQ_HIST = path.join(__dirname, "whats-historico.json");
const esperar = ms => new Promise(r => setTimeout(r, ms));
const MUDO = { level: "silent", child() { return MUDO; }, trace() {}, debug() {}, info() {}, warn() {}, error() {}, fatal() {} };

const W = { estado: "desligado", qr: null, qrImg: null, numero: "", nome: "", erro: "", sock: null, tentativas: 0, fila: [], rodando: false, hist: [], ultimoEnvio: 0, bib: null };
try { W.hist = JSON.parse(fs.readFileSync(ARQ_HIST, "utf8")); } catch (_) {}
if (!Array.isArray(W.hist)) W.hist = [];
const grava = () => { try { fs.writeFileSync(ARQ_HIST, JSON.stringify(W.hist.slice(-200))); } catch (_) {} };

async function carregarBib() {
  if (W.bib) return W.bib;
  let m;
  try { m = await import("@whiskeysockets/baileys"); }
  catch (e) { const x = new Error("A biblioteca do WhatsApp ainda não foi instalada. Dê dois cliques em instalar-whats.bat (precisa de internet) e abra a Central de novo."); x.codigo = 312; x.tec = { causa: String(e && e.message || e) }; throw x; }
  W.bib = {
    makeWASocket: m.default && m.default.default || m.default || m.makeWASocket,
    useMultiFileAuthState: m.useMultiFileAuthState || (m.default && m.default.useMultiFileAuthState),
    DisconnectReason: m.DisconnectReason || (m.default && m.default.DisconnectReason) || { loggedOut: 401 },
    fetchLatestBaileysVersion: m.fetchLatestBaileysVersion || (m.default && m.default.fetchLatestBaileysVersion),
    Browsers: m.Browsers || (m.default && m.default.Browsers),
  };
  if (typeof W.bib.makeWASocket !== "function" || typeof W.bib.useMultiFileAuthState !== "function") { W.bib = null; const x = new Error("A versão instalada da biblioteca do WhatsApp não é compatível. Rode instalar-whats.bat de novo."); x.codigo = 312; throw x; }
  return W.bib;
}

async function qrParaImagem(texto) {
  try { const Q = require("qrcode"); return await Q.toDataURL(texto, { margin: 1, width: 320 }); }
  catch (_) { return null; }   // sem o pacote qrcode: o painel mostra o texto do QR
}

async function iniciar() {
  if (W.estado === "conectado" || W.estado === "iniciando" || W.estado === "qr") return;
  W.erro = ""; W.estado = "iniciando";
  let b;
  try { b = await carregarBib(); } catch (e) { W.estado = "desligado"; W.erro = e.message; throw e; }
  try {
    fs.mkdirSync(PASTA, { recursive: true });
    const { state, saveCreds } = await b.useMultiFileAuthState(PASTA);
    let version; try { if (b.fetchLatestBaileysVersion) version = (await b.fetchLatestBaileysVersion()).version; } catch (_) {}
    const sock = b.makeWASocket({ auth: state, logger: MUDO, printQRInTerminal: false, markOnlineOnConnect: false, syncFullHistory: false, ...(version ? { version } : {}), browser: b.Browsers && b.Browsers.macOS ? b.Browsers.macOS("Desktop") : ["Central de Agentes", "Desktop", "1.0"] });
    W.sock = sock;
    sock.ev.on("creds.update", saveCreds);
    sock.ev.on("connection.update", async u => {
      if (W.sock !== sock) return;
      if (u.qr) { W.estado = "qr"; W.qr = u.qr; W.qrImg = await qrParaImagem(u.qr); }
      if (u.connection === "open") {
        W.estado = "conectado"; W.qr = null; W.qrImg = null; W.tentativas = 0; W.erro = "";
        const id = sock.user && sock.user.id || ""; W.numero = id.split(":")[0].split("@")[0]; W.nome = sock.user && (sock.user.name || sock.user.verifiedName) || "";
        bombear();
      }
      if (u.connection === "close") {
        const code = u.lastDisconnect && u.lastDisconnect.error && u.lastDisconnect.error.output && u.lastDisconnect.error.output.statusCode;
        W.sock = null; W.qr = null; W.qrImg = null;
        if (code === (b.DisconnectReason.loggedOut || 401)) { W.estado = "desligado"; W.numero = ""; W.nome = ""; W.erro = "O WhatsApp foi desconectado pelo celular. Escaneie o QR de novo."; try { fs.rmSync(PASTA, { recursive: true, force: true }); } catch (_) {} return; }
        if (W.tentativas < 8) { W.tentativas++; W.estado = "iniciando"; await esperar(Math.min(3000 * W.tentativas, 20000)); if (W.estado === "iniciando" && !W.sock) { W.estado = "desligado"; iniciar().catch(() => {}); } }
        else { W.estado = "desligado"; W.erro = "Não consegui reconectar (código " + (code || "?") + "). Clique em Conectar de novo."; }
      }
    });
  } catch (e) { W.estado = "desligado"; W.erro = "Falha ao iniciar o WhatsApp: " + (e && e.message || e); const x = new Error(W.erro); x.codigo = 315; throw x; }
}

async function desconectar(apagar) {
  const s = W.sock; W.sock = null; W.estado = "desligado"; W.qr = null; W.qrImg = null; W.fila = [];
  try { if (s) { if (apagar) await s.logout(); else s.end && s.end(undefined); } } catch (_) {}
  if (apagar) { W.numero = ""; W.nome = ""; try { fs.rmSync(PASTA, { recursive: true, force: true }); } catch (_) {} }
}

const numeroValido = t => { let d = String(t || "").replace(/\D/g, ""); if (d.length === 10 || d.length === 11) d = "55" + d; return d.length >= 12 && d.length <= 15 ? d : ""; };

async function bombear() {   // envia a fila um por vez, com pausa aleatória entre mensagens (reduz o risco de bloqueio)
  if (W.rodando) return; W.rodando = true;
  try {
    while (W.fila.length && W.estado === "conectado" && W.sock) {
      const it = W.fila[0], falta = 6000 + Math.random() * 6000 - (Date.now() - W.ultimoEnvio);
      if (falta > 0 && W.ultimoEnvio) await esperar(falta);
      if (!W.fila.length || W.fila[0] !== it) continue;
      try {
        const r = await W.sock.onWhatsApp(it.numero);
        const jid = r && r[0] && r[0].exists ? r[0].jid : null;
        if (!jid) { it.status = "sem_whatsapp"; it.erro = "Este número não tem WhatsApp."; }
        else { await W.sock.sendMessage(jid, { text: it.texto }); it.status = "enviado"; }
      } catch (e) { it.status = "erro"; it.erro = String(e && e.message || e).slice(0, 200); }
      it.hora = new Date().toISOString(); W.ultimoEnvio = Date.now(); W.fila.shift(); W.hist.push({ numero: it.numero, texto: it.texto.slice(0, 200), status: it.status, erro: it.erro || "", hora: it.hora, nome: it.nome || "" }); grava();
    }
  } finally { W.rodando = false; }
}

function enfileirar(lista) {
  if (W.estado !== "conectado" || !W.sock) { const x = new Error("O WhatsApp não está conectado. Escaneie o QR na aba Whats."); x.codigo = 313; throw x; }
  const ok = [], ruins = [];
  for (const m of lista) {
    const n = numeroValido(m.numero), t = String(m.texto || "").trim();
    if (!n || !t) { ruins.push({ numero: m.numero, motivo: !n ? "número inválido" : "mensagem vazia" }); continue; }
    ok.push({ numero: n, texto: t.slice(0, 4000), nome: String(m.nome || "").slice(0, 80), status: "fila" });
  }
  if (!ok.length) { const x = new Error("Nenhuma mensagem válida: " + (ruins[0] ? ruins[0].motivo : "informe número e texto") + "."); x.codigo = 314; throw x; }
  if (W.fila.length + ok.length > 100) { const x = new Error("Fila cheia (máximo 100 mensagens de cada vez). Aguarde enviar."); x.codigo = 314; throw x; }
  W.fila.push(...ok); bombear();
  return { enfileiradas: ok.length, ignoradas: ruins };
}

const status = () => ({ estado: W.estado, qr: W.qr, qrImg: W.qrImg, numero: W.numero, nome: W.nome, erro: W.erro, fila: W.fila.length, historico: W.hist.slice(-30).reverse(), instalada: (() => { try { require.resolve("@whiskeysockets/baileys"); return true; } catch (_) { try { return fs.existsSync(path.join(__dirname, "node_modules", "@whiskeysockets")); } catch (__) { return false; } } })() });

// reconecta sozinho ao abrir a Central, se já houver sessão salva
const retomar = () => { try { if (fs.existsSync(path.join(PASTA, "creds.json"))) iniciar().catch(() => {}); } catch (_) {} };

module.exports = { iniciar, desconectar, enfileirar, status, retomar, numeroValido };
