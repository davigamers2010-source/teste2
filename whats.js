// Conexão com o WhatsApp Web por QR Code (sem a API oficial). Usa a biblioteca Baileys (npm install).
// A sessão fica salva na pasta "whats-sessao" ao lado do servidor: depois de escanear uma vez, reconecta sozinho.
const fs = require("fs"), path = require("path");
const PASTA = path.join(__dirname, "whats-sessao"), ARQ_HIST = path.join(__dirname, "whats-historico.json");
const esperar = ms => new Promise(r => setTimeout(r, ms));
const MUDO = { level: "silent", child() { return MUDO; }, trace() {}, debug() {}, info() {}, warn() {}, error() {}, fatal() {} };

const W = { estado: "desligado", qr: null, qrImg: null, numero: "", nome: "", erro: "", sock: null, tentativas: 0, fila: [], rodando: false, hist: [], ultimoEnvio: 0, ultimoId: 0, bib: null };
try { W.hist = JSON.parse(fs.readFileSync(ARQ_HIST, "utf8")); } catch (_) {}
if (!Array.isArray(W.hist)) W.hist = [];
const grava = () => { try { fs.writeFileSync(ARQ_HIST, JSON.stringify(W.hist.slice(-200))); } catch (_) {} };

// Alertas dos agentes: quando a Central encontra um erro, manda uma mensagem para o número definido (padrão: o próprio número conectado).
const ARQ_CFG = path.join(__dirname, "whats-config.json");
const NUMERO_PADRAO = "5551995782084";   // número que recebe os avisos dos agentes (DDI 55 + DDD 51)
const CFG = { alertas: true, numero: NUMERO_PADRAO, agentes: true, v: 0 };
try { Object.assign(CFG, JSON.parse(fs.readFileSync(ARQ_CFG, "utf8"))); } catch (_) {}
const gravaCfg = () => { try { fs.writeFileSync(ARQ_CFG, JSON.stringify(CFG)); } catch (_) {} };
if (CFG.v < 2) { CFG.alertas = true; CFG.numero = NUMERO_PADRAO; CFG.agentes = true; CFG.v = 2; gravaCfg(); }   // migração única: liga os alertas e define o número
const ALERTA_IGNORA = new Set([101, 301, 311, 312, 313, 314, 315, 401, 402, 403, 501]);   // erros de uso/validação e do próprio WhatsApp não geram alerta
const alertasVistos = new Map(), alertasHora = [];   // anti-repetição: mesmo erro só 1 vez a cada 30 min; no máximo 10 alertas por hora

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
        let jid = it.jid || null;
        if (!jid) { const r = await W.sock.onWhatsApp(it.numero); jid = r && r[0] && r[0].exists ? r[0].jid : null; }
        if (!jid) { it.status = "sem_whatsapp"; it.erro = "Este número não tem WhatsApp."; }
        else { await W.sock.sendMessage(jid, { text: it.texto }); it.status = "enviado"; }
      } catch (e) { it.status = "erro"; it.erro = String(e && e.message || e).slice(0, 200); }
      it.hora = new Date().toISOString(); W.ultimoEnvio = Date.now(); W.fila.shift(); W.hist.push({ id: it.id, numero: it.jid ? (it.nome || "grupo") : it.numero, grupo: !!it.jid, texto: it.texto.slice(0, 200), status: it.status, erro: it.erro || "", hora: it.hora, nome: it.nome || "" }); grava();
    }
  } finally { W.rodando = false; }
}

function enfileirar(lista) {
  if (W.estado !== "conectado" || !W.sock) { const x = new Error("O WhatsApp não está conectado. Escaneie o QR na aba Whats."); x.codigo = 313; throw x; }
  const ok = [], ruins = [];
  for (const m of lista) {
    const t = String(m.texto || "").trim(), jid = /^\d+(-\d+)?@g\.us$/.test(String(m.jid || "")) ? String(m.jid) : "";
    const n = jid ? jid : numeroValido(m.numero);
    if (!n || !t) { ruins.push({ numero: m.numero || m.jid, motivo: !n ? (m.jid ? "grupo inválido" : "número inválido") : "mensagem vazia" }); continue; }
    ok.push({ id: Date.now().toString(36) + "-" + (++W.ultimoId).toString(36), numero: n, jid, texto: t.slice(0, 4000), nome: String(m.nome || "").slice(0, 80), status: "fila" });
  }
  if (!ok.length) { const x = new Error("Nenhuma mensagem válida: " + (ruins[0] ? ruins[0].motivo : "informe número e texto") + "."); x.codigo = 314; throw x; }
  if (W.fila.length + ok.length > 100) { const x = new Error("Fila cheia (máximo 100 mensagens de cada vez). Aguarde enviar."); x.codigo = 314; throw x; }
  W.fila.push(...ok); bombear();
  return { enfileiradas: ok.length, ids: ok.map(m => m.id), ignoradas: ruins };
}

async function listarGrupos() {
  if (W.estado !== "conectado" || !W.sock) { const x = new Error("O WhatsApp não está conectado. Escaneie o QR na aba Whats."); x.codigo = 313; throw x; }
  let g; try { g = await W.sock.groupFetchAllParticipating(); } catch (e) { const x = new Error("Não consegui ler os grupos: " + (e && e.message || e)); x.codigo = 315; throw x; }
  return Object.values(g || {}).map(x => ({ jid: x.id, nome: String(x.subject || "(sem nome)"), membros: (x.participants || []).length || x.size || 0 })).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

function configurar(b) {
  if (b.alertas !== undefined) CFG.alertas = !!b.alertas;
  if (b.agentes !== undefined) CFG.agentes = !!b.agentes;
  if (b.numero !== undefined) { const t = String(b.numero || "").trim(), n = t ? numeroValido(t) : ""; if (t && !n) { const x = new Error("Número de alerta inválido: use DDD + telefone (ex.: 17 99999-9999)."); x.codigo = 314; throw x; } CFG.numero = n; }
  if (b.grupo !== undefined) {
    const grupo = String(b.grupo || "").trim();
    if (grupo && !/^\d+(-\d+)?@g\.us$/.test(grupo)) { const x = new Error("Grupo de alerta inválido. Atualize a lista e escolha um grupo do WhatsApp."); x.codigo = 314; throw x; }
    CFG.grupo = grupo;
    CFG.grupoNome = grupo ? String(b.grupoNome || "").trim().slice(0, 100) : "";
  }
  gravaCfg(); return configAtual();
}
const destinoAlerta = () => CFG.grupo ? { jid: CFG.grupo, nome: CFG.grupoNome || "Grupo de alertas" } : { numero: CFG.numero || W.numero, nome: "Alerta" };
const configAtual = () => ({ alertas: CFG.alertas, agentes: CFG.agentes, numero: CFG.numero, grupo: CFG.grupo || "", grupoNome: CFG.grupoNome || "", destino: CFG.grupo ? CFG.grupoNome || "grupo selecionado" : CFG.numero || W.numero || "", destinoGrupo: !!CFG.grupo });

// Chamada pela Central quando um agente/servidor encontra um erro. Nunca lança erro (não pode gerar mais erros).
function alertar(codigo, msg, origem, teste) {
  try {
    codigo = Number(codigo) || 0;
    if (!CFG.alertas && !teste) return { enviado: false, motivo: "alertas desligados" };
    if (!teste && ALERTA_IGNORA.has(codigo)) return { enviado: false, motivo: "código ignorado" };
    if (W.estado !== "conectado" || !W.sock) return { enviado: false, motivo: "WhatsApp não conectado" };
    const dest = destinoAlerta(); if (!dest.jid && !dest.numero) return { enviado: false, motivo: "sem número ou grupo de destino" };
    const agora = Date.now(), chave = codigo + "|" + String(msg).slice(0, 80);
    if (!teste) {
      if (alertasVistos.has(chave) && agora - alertasVistos.get(chave) < 30 * 60000) return { enviado: false, motivo: "repetido (já avisado há menos de 30 min)" };
      while (alertasHora.length && agora - alertasHora[0] > 3600e3) alertasHora.shift();
      if (alertasHora.length >= 10) return { enviado: false, motivo: "limite de 10 alertas por hora" };
      alertasVistos.set(chave, agora); alertasHora.push(agora);
      if (alertasVistos.size > 200) for (const [k, t] of alertasVistos) if (agora - t > 30 * 60000) alertasVistos.delete(k);
    }
    const hora = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    const texto = teste ? "✅ Central de Agentes: teste de alerta. Se você recebeu isto, os avisos de erro chegam neste número."
      : `⚠️ Central de Agentes · erro E${codigo}\n${origem ? "Origem: " + String(origem).slice(0, 80) + "\n" : ""}${String(msg).slice(0, 400)}\nHora: ${hora}`;
    const r = enfileirar([{ ...dest, texto }]);
    return { enviado: true, ...r };
  } catch (e) { return { enviado: false, motivo: String(e && e.message || e) }; }
}


// ---------- Agentes → WhatsApp ----------
// A cada 2 min consulta o Cérebro IA da própria Central (http://localhost:3100/api/cerebro) e manda UMA mensagem agrupada
// com o que os agentes acharam de novo: ⚠️ erros, 🚨 problemas, ❓ perguntas e 💡 melhorias. Cada item é avisado uma vez
// (lembrete só depois de 12 h, no máximo 1 vez). Limite de 12 mensagens por hora. Desligue com "agentes": false em whats-config.json.
const ARQ_AG = path.join(__dirname, "whats-agentes.json"), PORTA = process.env.PORT || 3100;
const AG = { vistos: {}, evento: 0, ultimo: 0, motivo: "", enviadas: [] };
try { const x = JSON.parse(fs.readFileSync(ARQ_AG, "utf8")); AG.vistos = x.vistos || {}; AG.evento = x.evento || 0; } catch (_) {}
const gravaAg = () => { try { fs.writeFileSync(ARQ_AG, JSON.stringify({ vistos: AG.vistos, evento: AG.evento })); } catch (_) {} };
const corta = (t, n) => { t = String(t || "").replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n - 1) + "…" : t; };
const CAT = { erro: ["⚠️", "Erros"], problema: ["🚨", "Problemas"], pergunta: ["❓", "Perguntas"], melhoria: ["💡", "Melhorias"] };

async function apiLocal(rota) {
  const r = await fetch("http://localhost:" + PORTA + rota, { signal: AbortSignal.timeout(20000) });
  if (!r.ok) return null;
  try { const j = await r.json(); return j && !j.erro ? j : null; } catch (_) { return null; }
}

function coletar(C) {   // transforma o que o Cérebro achou em itens classificados
  const agora = Date.now(), nome = id => ((C.agentes || []).find(a => a.id === id) || {}).nome || "", out = [];
  for (const d of C.fila || []) {
    const k = "d:" + d.id, v = AG.vistos[k];
    if (v && (v.n >= 2 || agora - v.t < 12 * 3600e3)) continue;
    const cat = d.tipo === "pergunta" ? "pergunta" : d.tipo === "promocao" ? "melhoria" : d.tipo === "conexao" ? "erro" : "problema";
    const det = d.tipo === "pergunta" ? "Cliente: " + corta(d.pergunta, 150) + (d.texto ? "\n   Resposta pronta: " + corta(d.texto, 150) : "")
      : d.texto ? (d.tipo === "promocao" ? "" : "Sugestão: ") + corta(d.texto, 180) : "";
    out.push({ k, cat, ag: nome(d.agente), titulo: corta(d.titulo, 90), det, lembrete: !!v });
  }
  for (const e of C.eventos || []) if (e.tipo === "erro" && e.t > Math.max(AG.evento, agora - 3600e3)) out.push({ k: "e:" + e.t, cat: "erro", ag: nome(e.de), titulo: corta(e.texto, 140), det: "", t: e.t });
  if (C.ultimoErro) { const k = "u:" + corta(C.ultimoErro, 60), v = AG.vistos[k]; if (!v || agora - v.t >= 2 * 3600e3) out.push({ k, cat: "erro", ag: "Cérebro IA", titulo: corta(C.ultimoErro, 160), det: "", u: true }); }
  const ordem = ["erro", "problema", "pergunta", "melhoria"];
  return out.sort((a, b) => ordem.indexOf(a.cat) - ordem.indexOf(b.cat));
}

function montarMsg(itens, total) {
  const hora = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }), L = ["🤖 *Central · os agentes encontraram " + total + " item(ns)* · " + hora];
  for (const c of Object.keys(CAT)) {
    const g = itens.filter(i => i.cat === c); if (!g.length) continue;
    L.push("\n" + CAT[c][0] + " *" + CAT[c][1] + " (" + g.length + ")*");
    for (const i of g) L.push("• " + (i.ag ? "[" + i.ag.split(" · ")[0] + "] " : "") + (i.lembrete ? "(lembrete) " : "") + i.titulo + (i.det ? "\n   " + i.det : ""));
  }
  if (total > itens.length) L.push("\n+" + (total - itens.length) + " item(ns) no próximo aviso.");
  L.push("\n👉 Abra a Central > Cérebro IA para aprovar ou resolver.");
  return L.join("\n").slice(0, 3800);
}

let monRodando = false;
async function monitorar() {   // nunca lança erro
  if (monRodando) return { enviado: false, motivo: "já em andamento" };
  monRodando = true;
  try {
    if (!CFG.alertas || !CFG.agentes) return (AG.motivo = "avisos dos agentes desligados", { enviado: false, motivo: AG.motivo });
    if (W.estado !== "conectado" || !W.sock) return (AG.motivo = "WhatsApp não conectado", { enviado: false, motivo: AG.motivo });
    const dest = destinoAlerta(); if (!dest.jid && !dest.numero) return (AG.motivo = "sem número ou grupo de destino", { enviado: false, motivo: AG.motivo });
    let C = null; try { C = await apiLocal("/api/cerebro"); } catch (_) {}
    AG.ultimo = Date.now();
    if (!C) return (AG.motivo = "Cérebro IA indisponível nesta versão do servidor", { enviado: false, motivo: AG.motivo });
    const itens = coletar(C); if (!itens.length) return (AG.motivo = "nada novo", { enviado: false, motivo: AG.motivo });
    const agora = Date.now(); AG.enviadas = AG.enviadas.filter(t => agora - t < 3600e3);
    if (AG.enviadas.length >= 12) return (AG.motivo = "limite de 12 avisos por hora", { enviado: false, motivo: AG.motivo });
    const lote = itens.slice(0, 12), r = enfileirar([{ ...dest, nome: dest.jid ? dest.nome : "Agentes", texto: montarMsg(lote, itens.length) }]);
    AG.enviadas.push(agora);
    for (const i of lote) { if (i.t) AG.evento = Math.max(AG.evento, i.t); const v = AG.vistos[i.k]; AG.vistos[i.k] = { t: agora, n: (v ? v.n : 0) + 1 }; }
    for (const k of Object.keys(AG.vistos)) if (agora - AG.vistos[k].t > 7 * 864e5) delete AG.vistos[k];
    gravaAg(); AG.motivo = "enviado (" + lote.length + " item(ns))";
    return { enviado: true, itens: lote.length, ...r };
  } catch (e) { AG.motivo = String(e && e.message || e); return { enviado: false, motivo: AG.motivo }; }
  finally { monRodando = false; }
}
setTimeout(() => monitorar(), 60000).unref();
setInterval(() => monitorar(), 120000).unref();

const status = () => ({ config: configAtual(), agentes: { ultimo: AG.ultimo, motivo: AG.motivo }, estado: W.estado, qr: W.qr, qrImg: W.qrImg, numero: W.numero, nome: W.nome, erro: W.erro, fila: W.fila.length, historico: W.hist.slice(-30).reverse(), instalada: (() => { try { require.resolve("@whiskeysockets/baileys"); return true; } catch (_) { try { return fs.existsSync(path.join(__dirname, "node_modules", "@whiskeysockets")); } catch (__) { return false; } } })() });

// reconecta sozinho ao abrir a Central, se já houver sessão salva
const retomar = () => { try { if (fs.existsSync(path.join(PASTA, "creds.json"))) iniciar().catch(() => {}); } catch (_) {} };

module.exports = { monitorar, _interno: { W, AG, CFG }, iniciar, desconectar, enfileirar, status, retomar, numeroValido, listarGrupos, configurar, alertar };
