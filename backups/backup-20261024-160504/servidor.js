// Servidor local da Automação IA MS importadora (http://localhost:3100). Node.js 18 ou mais novo.
// - Serve o painel; faz buscas na internet; guarda credenciais dos marketplaces e puxa dados reais.
// - Credenciais ficam em conectores.json, só neste computador (nunca vão para o navegador).
// v1.1: User-Agent próprio, retentativas, detecção de bloqueio CloudFront/WAF, renovação de token
//       sem corrida, Redirect URI configurável (HTTPS/túnel), diagnóstico de rede e proteção do painel.
const http = require("http"), fs = require("fs"), path = require("path"), crypto = require("crypto"), os = require("os"), { spawn, spawnSync } = require("child_process");
const VERSAO = "abas-15-acoes";
const PORTA = 3100, BASE = "http://localhost:" + PORTA, ARQ = path.join(__dirname, "conectores.json");
const UA = "Mozilla/5.0 (compatible; CentralDeAgentes/1.1; uso local)";
const BLOQ = /cloudfront|request blocked|could not be satisfied/i;
const esperar = ms => new Promise(r => setTimeout(r, ms));
// Registro permanente de erros do servidor (arquivo logs-erros.json, na pasta da Central). A aba Logs lê este arquivo.
const ARQ_LOG = path.join(__dirname, "logs-erros.json");
let LOGSRV = []; try { LOGSRV = JSON.parse(fs.readFileSync(ARQ_LOG, "utf8")); } catch (_) {}
if (!Array.isArray(LOGSRV)) LOGSRV = [];
const logSrv = (codigo, msg, rota, tec) => { try {
  LOGSRV.push({ hora: (tec && tec.hora) || new Date().toISOString(), codigo: Number(codigo) || 901, msg: String(msg).slice(0, 600), rota: rota || "", tec: tec || null });
  if (LOGSRV.length > 300) LOGSRV.shift(); fs.writeFileSync(ARQ_LOG, JSON.stringify(LOGSRV));
} catch (_) {} };
process.on("unhandledRejection", r => logSrv(901, "Promessa rejeitada no servidor: " + (r && r.message || r), "processo", { hora: new Date().toISOString(), pilha: String(r && r.stack || "").split("\n").slice(0, 6).map(x => x.trim()) }));
process.on("uncaughtException", e => { logSrv(901, "Erro fatal no servidor: " + e.message, "processo", { hora: new Date().toISOString(), pilha: String(e.stack || "").split("\n").slice(0, 6).map(x => x.trim()) }); console.error(e); });   // não derruba a Central: registra e continua

const diag = m => { try { fs.appendFileSync(path.join(__dirname, "diagnostico-servidor.txt"), new Date().toISOString() + "  " + m + "\n"); } catch (_) {} };   // arquivo para descobrir por que o servidor parou
diag("iniciado " + VERSAO + " · pid " + process.pid + " · node " + process.version);
process.on("exit", c => diag("processo encerrou (código " + c + ")"));
["SIGTERM", "SIGHUP", "SIGBREAK"].forEach(sg => { try { process.on(sg, () => { diag("recebeu sinal " + sg + " (janela fechada ou processo finalizado)"); process.exit(0); }); } catch (_) {} });
process.on("uncaughtException", e => diag("ERRO NAO TRATADO: " + (e && e.stack || e)));
process.on("unhandledRejection", r => diag("PROMESSA REJEITADA: " + (r && r.stack || r)));

/* ---------- busca na internet ---------- */
const limpar = q => q.replace(/[?¿]/g, "").replace(/^\s*(me diga|pesquise|busque|procure)\s+/i, "")
  .replace(/^\s*(quem|o que|qual|quais|como|quando|onde|por que|porque)\s+(é|e|são|sao|foi|era|eram)?\s*/i, "")
  .replace(/^\s*(a|o|as|os|um|uma)\s+/i, "").trim() || q;
const opc = () => ({ signal: AbortSignal.timeout(7000), headers: { "User-Agent": UA } });
const corta = t => { t = t.replace(/\s+/g, " ").trim(); const m = t.match(/^(.+?[.!?])\s+(.+?[.!?])/); const r = m ? m[1] + " " + m[2] : t; return r.length > 420 ? r.slice(0, 417) + "…" : r; };
async function wikipedia(q) {
  const b = await (await fetch("https://pt.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=1&srsearch=" + encodeURIComponent(q), opc())).json();
  const h = b.query && b.query.search[0]; if (!h) return null;
  const s = await (await fetch("https://pt.wikipedia.org/api/rest_v1/page/summary/" + encodeURIComponent(h.title), opc())).json();
  if (!s.extract || s.type === "disambiguation") return null;
  return { texto: corta(s.extract), fonte: "Wikipédia", url: s.content_urls && s.content_urls.desktop.page };
}
async function duck(q) {
  const j = await (await fetch("https://api.duckduckgo.com/?format=json&no_html=1&skip_disambig=1&q=" + encodeURIComponent(q), opc())).json();
  return j.AbstractText ? { texto: corta(j.AbstractText), fonte: "DuckDuckGo", url: j.AbstractURL } : null;
}

/* ---------- conexões ---------- */
// campos: [chave, rótulo, secreto?]. oauth: true = botão "Autorizar" (fluxo por navegador).
const CAT = {
  mercadolivre: { nome: "Mercado Livre", oauth: 1, campos: [["client_id", "App ID"], ["client_secret", "Secret Key", 1], ["redirect_uri", "Redirect URI (opcional, HTTPS igual ao cadastrado no app)"]] },
  bling: { nome: "Bling (ERP)", oauth: 1, campos: [["client_id", "Client ID"], ["client_secret", "Client Secret", 1]] },
  shopee: { nome: "Shopee", campos: [["partner_id", "Partner ID"], ["partner_key", "Partner Key", 1], ["shop_id", "Shop ID"]] },
  tiktok: { nome: "TikTok Shop", campos: [["app_key", "App Key"], ["app_secret", "App Secret", 1], ["access_token", "Access Token", 1]] },
  amazon: { nome: "Amazon (SP-API)", campos: [["client_id", "LWA Client ID"], ["client_secret", "LWA Client Secret", 1], ["refresh_token", "Refresh Token", 1]] },
  temu: { nome: "Temu", campos: [["app_key", "App Key"], ["app_secret", "App Secret", 1], ["access_token", "Access Token", 1]] },
  shein: { nome: "Shein", campos: [["app_id", "App ID"], ["app_secret", "App Secret", 1]] },
  kwai: { nome: "Kwai", campos: [["app_id", "App ID"], ["app_secret", "App Secret", 1]] },
  upseller: { nome: "UpSeller", campos: [["api_key", "Chave de API", 1]] }
};
class Erro extends Error { constructor(c, m, tec) { super(m); this.codigo = c; if (tec) this.tec = tec; } }
const lerDB = () => { try { return JSON.parse(fs.readFileSync(ARQ, "utf8")); } catch (_) { return {}; } };
const gravarDB = d => { const tmp = ARQ + ".tmp"; fs.writeFileSync(tmp, JSON.stringify(d, null, 2), { mode: 0o600 }); fs.renameSync(tmp, ARQ); };
const redirDe = (id, c) => (c && c.redirect_uri) || `${BASE}/oauth/${id}`;

// Requisição com User-Agent, timeout, retentativas e leitura segura do corpo.
// POST só repete quando o pedido foi barrado antes de chegar ao app (códigos de autorização são de uso único).
async function J(url, o = {}, tentativas = 3) {
  const get = !o.method || o.method === "GET", host = new URL(url).host;
  let ultimo;
  for (let i = 0; i < tentativas; i++) {
    if (i) await esperar(700 * 2 ** (i - 1));
    let r, txt;
    const T = (x = {}) => ({ url: url.split("?")[0], metodo: o.method || "GET", tentativa: i + 1, ...x });
    try {
      r = await fetch(url, { ...o, signal: AbortSignal.timeout(12000), headers: { "User-Agent": UA, Accept: "application/json", ...(o.headers || {}) } });
      txt = await r.text();
    } catch (e) { ultimo = new Erro(102, `Sem resposta de ${host}: ${e.message}`, T({ erro: e.message })); if (get) continue; throw ultimo; }
    if (r.status === 403 && BLOQ.test(txt)) {
      ultimo = new Erro(304, `Bloqueio de rede (CloudFront/WAF) em ${host}. Desative VPN/proxy/antivírus HTTPS, confira o Redirect URI cadastrado e rode /api/diagnostico. ID: ${r.headers.get("x-amz-cf-id") || "n/d"}`, T({ status: r.status, cf_id: r.headers.get("x-amz-cf-id") || "n/d" }));
      continue;
    }
    if (r.status === 429) { ultimo = new Erro(303, "Limite de requisições atingido", T({ status: 429 })); if (get) continue; throw ultimo; }
    if (r.status >= 500) { ultimo = new Erro(302, `Plataforma indisponível (${r.status})`, T({ status: r.status, resposta: txt.slice(0, 300) })); if (get) continue; throw ultimo; }
    let j; try { j = JSON.parse(txt); } catch (_) { throw new Erro(302, `Resposta inesperada de ${host} (${r.status})`, T({ status: r.status, resposta: txt.slice(0, 300) })); }
    const det = String(j.message || j.error_description || j.error || "").slice(0, 200);
    if (r.status === 401 || r.status === 403) throw new Erro(204, `Acesso negado por ${host} (${r.status})${det ? ": " + det : ""}`, T({ status: r.status, resposta: txt.slice(0, 300) }));
    if (!r.ok) throw new Erro(302, `${host} respondeu ${r.status}: ${det || JSON.stringify(j).slice(0, 200)}`, T({ status: r.status, resposta: txt.slice(0, 300) }));
    return j;
  }
  throw ultimo;
}
const form = o => ({ method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body: new URLSearchParams(o) });

// Faixa de datas no horário de Brasília (UTC-3, sem horário de verão).
function faixa(per) {
  const dia = d => d.toISOString().slice(0, 10), br = new Date(Date.now() - 3 * 3600e3), mover = (d, n) => new Date(d.getTime() + n * 864e5);
  const dm = d => dia(d).slice(8, 10) + "/" + dia(d).slice(5, 7);
  let ini = br, fim = br, rot = "hoje (" + dm(br) + ")";
  if (per === "ontem") { ini = fim = mover(br, -1); rot = "ontem (" + dm(ini) + ")"; }
  else if (per === "semana") { ini = mover(br, -6); rot = "nos últimos 7 dias (" + dm(ini) + " a " + dm(br) + ")"; }
  else if (per === "mes") { ini = new Date(Date.UTC(br.getUTCFullYear(), br.getUTCMonth(), 1)); rot = "neste mês (" + dm(ini) + " a " + dm(br) + ")"; }
  return { de: dia(ini) + "T00:00:00.000-03:00", ate: dia(fim) + "T23:59:59.999-03:00", rot };
}

/* ---------- utilitários de anúncios ---------- */
const STOP = new Set("de da do das dos para com e a o as os em um uma por sem kit un und cm mm kg g ml l pcs pc".split(" "));
const tokens = s => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").split(/[^a-z0-9]+/).filter(w => w.length > 1 && !STOP.has(w));
const mediana = a => { a = a.filter(x => typeof x === "number" && !isNaN(x)).sort((x, y) => x - y); if (!a.length) return null; return a.length % 2 ? a[a.length >> 1] : (a[(a.length >> 1) - 1] + a[a.length >> 1]) / 2; };
const idML = x => /^MLB\d+$/.test(String(x || ""));
// ZIP simples (sem compressão, as fotos já são comprimidas). Sem dependências.
const CRCT = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = b => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRCT[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
function zipar(arqs) {
  const partes = [], cen = []; let off = 0;
  for (const a of arqs) {
    const nome = Buffer.from(a.nome, "utf8"), crc = crc32(a.dados), n = a.dados.length;
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(0x21, 12);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(n, 18); lh.writeUInt32LE(n, 22); lh.writeUInt16LE(nome.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(0x21, 14);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(n, 20); ch.writeUInt32LE(n, 24); ch.writeUInt16LE(nome.length, 28); ch.writeUInt32LE(off, 42);
    partes.push(lh, nome, a.dados); cen.push(ch, nome); off += 30 + nome.length + n;
  }
  const cd = Buffer.concat(cen), fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0); fim.writeUInt16LE(arqs.length, 8); fim.writeUInt16LE(arqs.length, 10); fim.writeUInt32LE(cd.length, 12); fim.writeUInt32LE(off, 16);
  return Buffer.concat([...partes, cd, fim]);
}
const brl = v => "R$ " + v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Soma de vendas de um período (usada pelo status geral da conta).
async function somaVendas(get, uid, per) {
  const f = faixa(per); let off = 0, total = Infinity, n = 0, itens = 0, fat = 0, canc = 0;
  while (off < total && off < 2000) {
    const j = await get(`/orders/search?seller=${uid}&order.date_created.from=${encodeURIComponent(f.de)}&order.date_created.to=${encodeURIComponent(f.ate)}&sort=date_desc&limit=50&offset=${off}`);
    total = j.paging.total; if (!j.results.length) break;
    for (const o of j.results) {
      if (/cancel|invalid/.test(o.status)) { canc++; continue; }
      n++; fat += o.total_amount || 0; itens += (o.order_items || []).reduce((a, i) => a + (i.quantity || 0), 0);
    }
    off += 50;
  }
  return { n, itens, fat, canc, rot: f.rot };
}

// Adaptadores reais. Para ligar outra plataforma, crie um adaptador aqui com auth/token/api/conta/dados/teste.
const ADAPT = {
  mercadolivre: {
    pkce: 1,   // envia code_challenge (S256); exigido quando o app tem PKCE ativo no painel, ignorado quando não
    auth: (c, redir, st, ch) => `https://auth.mercadolivre.com.br/authorization?response_type=code&client_id=${c.client_id}&redirect_uri=${encodeURIComponent(redir)}&state=${st}` + (ch ? `&code_challenge=${ch}&code_challenge_method=S256` : ""),
    token: (c, b) => J("https://api.mercadolibre.com/oauth/token", form({ client_id: c.client_id, client_secret: c.client_secret, ...b })),
    api: "https://api.mercadolibre.com",
    teste: (c) => [
      { nome: "API pública", url: "https://api.mercadolibre.com/sites/MLB" },
      { nome: "Tela de autorização", url: `https://auth.mercadolivre.com.br/authorization?response_type=code&client_id=${c.client_id || ""}&redirect_uri=${encodeURIComponent(redirDe("mercadolivre", c))}` }
    ],
    conta: async (get) => (await get("/users/me")).nickname,
    // Consultas pontuais para os agentes: tipo = vendas | perguntas | anuncios; periodo = hoje | ontem | semana | mes
    consulta: async (get, t, tipo, periodo) => {
      if (tipo === "vendas") {
        const f = faixa(periodo); let off = 0, total = Infinity, n = 0, itens = 0, fat = 0, canc = 0;
        while (off < total && off < 2000) {
          const j = await get(`/orders/search?seller=${t.uid}&order.date_created.from=${encodeURIComponent(f.de)}&order.date_created.to=${encodeURIComponent(f.ate)}&sort=date_desc&limit=50&offset=${off}`);
          total = j.paging.total; if (!j.results.length) break;
          for (const o of j.results) {
            if (/cancel|invalid/.test(o.status)) { canc++; continue; }
            n++; fat += o.total_amount || 0; itens += (o.order_items || []).reduce((a, i) => a + (i.quantity || 0), 0);
          }
          off += 50;
        }
        if (!n) return `Mercado Livre, ${f.rot}: nenhuma venda registrada` + (canc ? ` (${canc} cancelada(s) não contadas).` : ".");
        return `Mercado Livre, ${f.rot}: ${n} venda(s) com ${itens} item(ns) e valor bruto de ${brl(fat)}` + (canc ? `; ${canc} cancelada(s) não contadas.` : ".");
      }
      if (tipo === "perguntas") { const q = await get(`/questions/search?seller_id=${t.uid}&status=UNANSWERED&limit=1`); return `Mercado Livre: ${q.total} pergunta(s) sem resposta.`; }
      if (tipo === "anuncios") {
        const [a, p] = await Promise.all([get(`/users/${t.uid}/items/search?status=active&limit=1`), get(`/users/${t.uid}/items/search?status=paused&limit=1`)]);
        return `Mercado Livre: ${a.paging.total} anúncio(s) ativo(s) e ${p.paging.total} pausado(s).`;
      }
      throw new Erro(301, "Tipo de consulta desconhecido: " + tipo);
    },
    // Meus anúncios (ativos ou pausados), até 300, com os dados que a lista mostra.
    anuncios: async (get, t, status) => {
      const ids = []; let off = 0, total = Infinity;
      while (off < total && off < 300) {
        const j = await get(`/users/${t.uid}/items/search?status=${status}&limit=50&offset=${off}`);
        total = j.paging.total; if (!j.results.length) break; ids.push(...j.results); off += 50;
      }
      const out = [];
      for (let i = 0; i < ids.length; i += 20) {
        const L = await get(`/items?ids=${ids.slice(i, i + 20).join(",")}&attributes=id,title,price,thumbnail,permalink,sold_quantity,available_quantity,status,listing_type_id,category_id,catalog_product_id`);
        for (const x of L) if (x.code === 200 && x.body) out.push(x.body);
      }
      return out;
    },
    // Compara o seu anúncio com os anúncios do MESMO PRODUTO DE CATÁLOGO. O Mercado Livre bloqueia (403) a busca pública
    // e os dados de anúncios de outros vendedores; o catálogo (/products) continua liberado e é o que usamos.
    analise: async (get, t, id, raw) => {
      const CAMPOS = "id,title,price,original_price,thumbnail,permalink,sold_quantity,status,listing_type_id,category_id,catalog_product_id,catalog_listing,video_id,pictures,attributes,shipping,warranty,sale_terms,official_store_id";
      const meu = await get(`/items/${id}?attributes=${CAMPOS}`);
      const tk = tokens(meu.title), setM = new Set(tk);
      const jac = ttl => { const x = new Set(tokens(ttl)); let i = 0; for (const w of x) if (setM.has(w)) i++; const u = x.size + setM.size - i; return u ? i / u : 0; };
      const dm = await (async () => { try { return ((await get(`/items/${id}/description`)).plain_text || "").length; } catch (_) { return null; } })();
      const sh = meu.shipping || {}, attrM = (meu.attributes || []).filter(x => x.value_name && x.id !== "SELLER_SKU");
      const fm = { id: meu.id, titulo: meu.title, link: meu.permalink, thumb: meu.thumbnail, preco: meu.price, original: meu.original_price || null,
        promo: meu.original_price && meu.original_price > meu.price ? Math.round((1 - meu.price / meu.original_price) * 100) : 0,
        vendidos: meu.sold_quantity || 0, fotos: (meu.pictures || []).length, video: meu.video_id || "", tipo: meu.listing_type_id || "", frete: !!sh.free_shipping,
        logistica: sh.logistic_type || "", garantia: !!(meu.warranty || (meu.sale_terms || []).some(x => x.id === "WARRANTY_TYPE")), catalogo: !!meu.catalog_listing,
        nAttrs: attrM.length, desc: dm };

      const conc = await (async () => { try {
        let pid = meu.catalog_product_id, origem = "anuncio";
        if (!pid) {
          const j = await get(`/products/search?status=active&site_id=MLB&q=${encodeURIComponent(tk.slice(0, 8).join(" "))}`);
          const L = (j.results || []).map(p => ({ p, sim: jac(p.name || p.title || "") })).sort((x, y) => y.sim - x.sim);
          if (!L.length || L[0].sim < 0.25) throw new Error("Não achei no catálogo do Mercado Livre um produto parecido com este anúncio. Sem produto de catálogo, a API não deixa comparar com outros vendedores.");
          pid = L[0].p.id; origem = "busca";
        }
        const prod = await get(`/products/${pid}`);
        let ij; try { ij = await get(`/products/${pid}/items?limit=50`); } catch (_) { ij = await get(`/products/${pid}/items`); }
        const bb = prod.buy_box_winner || null, bbId = bb && (bb.item_id || bb.id);
        const todos = (Array.isArray(ij) ? ij : ij.results || ij.items || []).map(x => { const s2 = x.shipping || {}, iid = String(x.item_id || x.id || ""), dig = iid.replace(/\D/g, "");
          return { id: iid, link: x.permalink || (dig ? "https://produto.mercadolivre.com.br/MLB-" + dig : ""), preco: x.price, tipo: x.listing_type_id || "", condicao: x.condition || "",
            frete: !!s2.free_shipping, logistica: s2.logistic_type || "", loja: !!x.official_store_id, garantia: !!(x.warranty || (x.sale_terms || []).some(y => y.id === "WARRANTY_TYPE")),
            vendedor: x.seller_id || (x.seller && x.seller.id) || "", vendidos: x.sold_quantity == null ? null : x.sold_quantity, buybox: !!bbId && iid === String(bbId) }; })
          .filter(x => x.id && typeof x.preco === "number");
        const outros = todos.filter(x => x.id !== meu.id), N = outros.length;
        if (!N) throw new Error("O catálogo não trouxe outros anúncios para este produto.");
        outros.sort((x, y) => (y.buybox - x.buybox) || (x.preco - y.preco) || (y.frete - x.frete));
        const top = outros.slice(0, 10), n = f => outros.filter(f).length, precos = outros.map(x => x.preco), mPreco = mediana(precos), minP = Math.min(...precos), maxP = Math.max(...precos);
        const posicao = 1 + outros.filter(x => x.preco < fm.preco).length;
        const rec = [], add = (g, tx) => rec.push({ g, t: tx });
        if (!fm.catalogo) add("alta", `Catálogo: seu anúncio não está ligado ao produto de catálogo "${prod.name || pid}". Anúncios de catálogo disputam a buy box (o botão de compra em destaque). Se o produto for o mesmo, vincule ou republique pelo catálogo.`);
        if (bb && bbId && bbId !== meu.id) { const d = bb.price ? (fm.preco - bb.price) / bb.price : 0, bs = bb.shipping || {};
          add(d > 0.03 ? "alta" : "media", `Buy box: o vencedor está a ${brl(bb.price)}${bs.free_shipping ? " com frete grátis" : ""}${bs.logistic_type === "fulfillment" ? " e Full" : ""}${bb.listing_type_id ? " (" + bb.listing_type_id + ")" : ""}. Seu preço: ${brl(fm.preco)} (${d >= 0 ? "+" : ""}${Math.round(d * 100)}%).`); }
        else if (bbId && bbId === meu.id) add("info", "Buy box: seu anúncio é o vencedor atual deste produto no catálogo.");
        if (mPreco) { const d = (fm.preco - mPreco) / mPreco; add(d > 0.1 ? "alta" : d < -0.15 ? "info" : "info", `Preço: ${brl(fm.preco)} é o ${posicao}º mais barato entre ${N + 1} anúncios deste produto. Mediana ${brl(mPreco)}, faixa ${brl(minP)} a ${brl(maxP)}${d > 0.1 ? ". Está " + Math.round(d * 100) + "% acima da mediana." : d < -0.15 ? ". Está " + Math.round(-d * 100) + "% abaixo da mediana: pode haver espaço para subir a margem." : "."}`); }
        const nF = n(x => x.frete); if (!fm.frete && nF >= Math.ceil(N * 0.5)) add("alta", `Frete grátis: ${nF} de ${N} anúncios deste produto oferecem e o seu não.`);
        const nFull = n(x => x.logistica === "fulfillment"); if (fm.logistica !== "fulfillment" && nFull >= Math.max(2, Math.ceil(N * 0.25))) add("media", `Mercado Envios Full: ${nFull} de ${N} usam Full e o seu não.`);
        const tipos = Object.entries(outros.reduce((o, x) => (x.tipo && (o[x.tipo] = (o[x.tipo] || 0) + 1), o), {})).sort((x, y) => y[1] - x[1])[0];
        if (tipos && fm.tipo !== tipos[0] && ["gold_pro", "gold_special"].includes(tipos[0])) add("media", `Tipo de anúncio: a maioria usa "${tipos[0]}" (${tipos[1]} de ${N}) e o seu é "${fm.tipo}".`);
        const nG = n(x => x.garantia); if (!fm.garantia && nG >= Math.ceil(N * 0.5)) add("media", `Garantia: ${nG} de ${N} informam garantia e o seu não.`);
        const faltaT = tokens(prod.name || "").filter((w, i, a) => a.indexOf(w) === i && !setM.has(w) && !/^\d+$/.test(w)).slice(0, 8);
        if (faltaT.length) add("media", `Título: palavras do nome oficial do produto no catálogo que faltam no seu título: ${faltaT.join(", ")}.`);
        const meusA = new Set(attrM.map(x => x.id)), faltaA = (prod.attributes || []).filter(x => (x.value_name || (x.values && x.values.length)) && !meusA.has(x.id) && x.id !== "SELLER_SKU").map(x => x.name || x.id).slice(0, 12);
        if (faltaA.length) add("alta", `Ficha técnica: atributos que o catálogo tem e o seu anúncio não preencheu: ${faltaA.join(", ")}.`);
        const nPic = (prod.pictures || []).length; if (nPic && fm.fotos < nPic) add("media", `Fotos: seu anúncio tem ${fm.fotos}; o produto no catálogo tem ${nPic}. Baixe as do catálogo como referência e complete as suas.`);
        const ord = { alta: 0, media: 1, info: 2 }; rec.sort((x, y) => ord[x.g] - ord[y.g]);
        return { produto: { id: pid, nome: prod.name || pid, link: "https://www.mercadolivre.com.br/p/" + pid, fotos: nPic, origem, atributos: (prod.attributes || []).length }, total: N, top, rec,
          resumo: { posicao, mPreco, minP, maxP, frete: nF, full: nFull, bb: bb ? { preco: bb.price, id: bbId } : null } };
      } catch (e) { return { erro: e.message, produto: null }; } })();

      // Promoções do SEU anúncio e campanha de Product Ads. Cada parte falha sozinha.
      const json = async (p, h) => { const r = await raw(p, h), tx = await r.text(); let j = {}; try { j = JSON.parse(tx); } catch (_) {} if (!r.ok) throw new Error(r.status + (j.message ? ": " + j.message : "")); return j; };
      const promocoes = await (async () => { try { const j = await json(`/seller-promotions/items/${id}?app_version=v2`); const L = Array.isArray(j) ? j : j.results || [];
        return { itens: L.map(p => ({ tipo: p.type || "", status: p.status || "", nome: p.name || p.id || "", preco: p.price || p.new_price || p.deal_price || null, ini: p.start_date || "", fim: p.finish_date || "" })) }; } catch (e) { return { erro: e.message }; } })();
      const ads = await (async () => { try {
        const adv = await json("/advertising/advertisers?product_id=PADS", { "Api-Version": "1" }), a = (adv.advertisers || [])[0];
        if (!a) return { ativo: false, msg: "Esta conta não tem Product Ads habilitado (Meu perfil > Publicidade)." };
        const site = a.site_id || "MLB", d = await json(`/advertising/${site}/product_ads/ads/${id}`, { "Api-Version": "2" });
        const r = { ativo: true, anunciante: a.advertiser_name || a.account_name || String(a.advertiser_id), status: d.status || "", campanha: d.campaign_id || null };
        if (d.campaign_id) { const fim = new Date(Date.now() - 3 * 3600e3), ini = new Date(fim.getTime() - 29 * 864e5), dia = x => x.toISOString().slice(0, 10);
          try { const m = await json(`/advertising/advertisers/${a.advertiser_id}/product_ads/campaigns/${d.campaign_id}?date_from=${dia(ini)}&date_to=${dia(fim)}&metrics=clicks,prints,ctr,cost,cpc,acos,roas,units_quantity,total_amount`);
            r.campanhaNome = m.name || ""; r.campanhaStatus = m.status || ""; r.metricas = m.metrics || null; r.periodo = dia(ini) + " a " + dia(fim); } catch (e) { r.metricasErro = e.message; } }
        return r; } catch (e) { return { erro: e.message }; } })();
      return { meu: fm, conc, recomendacoes: conc.rec || [], promocoes, ads };
    },
    // Etiquetas de envio: últimos pedidos (até 150) agrupados por envio, com o status real de cada envio.
    // prontas = ready_to_ship/ready_to_print · impressas = ready_to_ship/printed · canceladas = pedido ou envio cancelado.
    etiquetas: async (get, t, raw) => {
      const ped = new Map(); let off = 0, total = Infinity;
      while (off < total && off < 150) {
        const j = await get(`/orders/search?seller=${t.uid}&sort=date_desc&limit=50&offset=${off}`);
        total = j.paging.total; if (!j.results.length) break;
        for (const o of j.results) {
          const sid = o.shipping && o.shipping.id; if (!sid) continue;
          const e = ped.get(sid) || { id: String(sid), pedidos: [], data: o.date_created, produtos: [], comprador: (o.buyer && o.buyer.nickname) || "", cancelado: true };
          e.pedidos.push(String(o.id));
          if (!/cancel|invalid/.test(o.status)) e.cancelado = false;
          for (const i of o.order_items || []) e.produtos.push(`${i.quantity || 1}x ${(i.item && i.item.title) || "item"}`);
          ped.set(sid, e);
        }
        off += 50;
      }
      const L = [...ped.values()];
      for (let i = 0; i < L.length; i += 8) await Promise.all(L.slice(i, i + 8).map(async e => {
        try {
          const r = await raw(`/shipments/${e.id}`, { "x-format-new": "true" });
          if (!r.ok) throw new Error(r.status);
          const s = await r.json();
          e.status = s.status; e.sub = s.substatus; e.tipo = s.logistic_type || (s.logistic && s.logistic.type) || "";
          const end = (s.destination && s.destination.shipping_address) || s.receiver_address || {};
          e.cidade = [end.city && end.city.name, end.state && (end.state.name || end.state.id)].filter(Boolean).join("/");
        } catch (_) { e.falhou = true; }
      }));
      return L.map(e => {
        const cancel = e.cancelado || e.status === "cancelled", pronto = e.status === "ready_to_ship";
        const cat = cancel ? "canceladas" : pronto && e.sub === "ready_to_print" ? "prontas" : pronto && e.sub === "printed" ? "impressas" : "outras";
        return { id: e.id, pedidos: e.pedidos.join(", "), data: e.data, produtos: e.produtos.join(" · "), comprador: e.comprador, cidade: e.cidade || "",
          tipo: e.tipo || "", status: e.status || "", sub: e.sub || "", cat, imprimivel: pronto && !cancel && e.tipo !== "fulfillment" };
      });
    },

    // Status geral da conta. Cada agente lê a sua parte (uma falha não derruba as outras), depois eles
    // "conversam" (regras que cruzam os dados reais de um setor com outro) e o Gerente fecha o resumo.
    status: async (get, t, raw) => {
      const uid = t.uid, A = ADAPT.mercadolivre, agora = Date.now();
      const tenta = async f => { try { return { ok: true, v: await f() }; } catch (e) { return { ok: false, erro: e.message }; } };
      const json = async (p, h) => { const r = await raw(p, h), tx = await r.text(); let j = {}; try { j = JSON.parse(tx); } catch (_) {} if (!r.ok) throw new Error(r.status + (j.message ? ": " + j.message : "")); return j; };
      const pct = x => typeof x === "number" ? (x * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + "%" : "n/d";
      const NIVEL = { "1_red": "vermelho (1/5)", "2_orange": "laranja (2/5)", "3_yellow": "amarelo (3/5)", "4_light_green": "verde claro (4/5)", "5_green": "verde (5/5)" };
      const [u, vH, vO, vS, vM, saldo, etq, perg, claims, aAt, aPa, aRev, aIna, anu, promo, ads] = await Promise.all([
        tenta(() => get(`/users/${uid}`)),
        tenta(() => somaVendas(get, uid, "hoje")), tenta(() => somaVendas(get, uid, "ontem")),
        tenta(() => somaVendas(get, uid, "semana")), tenta(() => somaVendas(get, uid, "mes")),
        tenta(() => json(`/users/${uid}/mercadopago_account/balance`)),
        tenta(() => A.etiquetas(get, t, raw)),
        tenta(() => get(`/questions/search?seller_id=${uid}&status=UNANSWERED&limit=50&sort_fields=date_created&sort_types=ASC`)),
        tenta(() => json(`/post-purchase/v1/claims/search?status=opened&limit=1`)),
        tenta(() => get(`/users/${uid}/items/search?status=active&limit=1`)), tenta(() => get(`/users/${uid}/items/search?status=paused&limit=1`)),
        tenta(() => get(`/users/${uid}/items/search?status=under_review&limit=1`)), tenta(() => get(`/users/${uid}/items/search?status=inactive&limit=1`)),
        tenta(() => A.anuncios(get, t, "active")),
        tenta(() => json(`/seller-promotions/users/${uid}?app_version=v2`)),
        tenta(() => json("/advertising/advertisers?product_id=PADS", { "Api-Version": "1" }))
      ]);
      const novo = titulo => ({ titulo, linhas: [], alertas: [], erros: [] });
      const G = novo("Gerente · conta e reputação"), F = novo("Financeiro"), P = novo("Pedidos e logística"), T = novo("Atendimento"), C = novo("Catálogo"), M = novo("Marketing e anúncios");
      const falha = (ag, nome, r, dica) => { if (!r.ok) ag.erros.push(`${nome}: ${r.erro}${dica ? " (" + dica + ")" : ""}`); };
      const br = new Date(agora - 3 * 3600e3), quando = br.toISOString().slice(8, 10) + "/" + br.toISOString().slice(5, 7) + " " + br.toISOString().slice(11, 16);

      // Gerente: conta e reputação
      let nick = "sua conta", nivelFala = "";
      if (u.ok) {
        const x = u.v, rp = x.seller_reputation || {}, m = rp.metrics || {}, tr = rp.transactions || {}, rt = tr.ratings || {};
        nick = x.nickname || nick;
        const nivel = NIVEL[rp.level_id] || "ainda sem nível (poucas vendas no período)", ativa = !x.status || !x.status.site_status || x.status.site_status === "active";
        nivelFala = `reputação ${nivel}. `;
        G.linhas.push(`Conta ${nick}: ${ativa ? "ativa" : "situação " + x.status.site_status}. Reputação ${nivel}${rp.power_seller_status ? ", MercadoLíder " + rp.power_seller_status : ""}.`);
        G.linhas.push(`Vendas concluídas: ${tr.completed ?? 0}; canceladas: ${tr.canceled ?? 0} (${tr.period === "historic" ? "histórico" : tr.period || "período"}). Avaliações: ${pct(rt.positive)} positivas, ${pct(rt.neutral)} neutras, ${pct(rt.negative)} negativas.`);
        G.linhas.push(`Indicadores (${(m.sales && m.sales.period) || "60 dias"}): reclamações ${pct(m.claims && m.claims.rate)}, atraso no envio ${pct(m.delayed_handling_time && m.delayed_handling_time.rate)}, cancelamentos ${pct(m.cancellations && m.cancellations.rate)}.`);
        if (["1_red", "2_orange", "3_yellow"].includes(rp.level_id)) G.alertas.push(`Reputação abaixo do verde (${nivel}): priorize prazo de envio, reclamações e cancelamentos.`);
        if (!ativa) G.alertas.push(`A conta não está com situação normal (${x.status.site_status}).`);
      } else falha(G, "Dados da conta", u);

      // Financeiro
      const v = r => r.ok ? brl(r.v.fat) : "n/d";
      if (vH.ok || vO.ok || vS.ok || vM.ok) {
        const d = br.getUTCDate(), dm = new Date(Date.UTC(br.getUTCFullYear(), br.getUTCMonth() + 1, 0)).getUTCDate();
        F.linhas.push(`Faturamento bruto: hoje ${v(vH)}, ontem ${v(vO)}, últimos 7 dias ${v(vS)}, mês ${v(vM)}.`);
        if (vM.ok && vM.v.n) F.linhas.push(`Ticket médio no mês: ${brl(vM.v.fat / vM.v.n)}. Projeção do mês no ritmo atual: ${brl(vM.v.fat / d * dm)}.`);
        if (vM.ok && vS.ok && d >= 8 && vM.v.fat > 0 && vS.v.fat / 7 < 0.7 * (vM.v.fat / d)) F.alertas.push(`O ritmo dos últimos 7 dias (${brl(vS.v.fat / 7)}/dia) está abaixo da média do mês (${brl(vM.v.fat / d)}/dia).`);
      }
      [["Vendas de hoje", vH], ["Vendas de ontem", vO], ["Vendas dos 7 dias", vS], ["Vendas do mês", vM]].forEach(([n, r]) => falha(F, n, r));
      if (saldo.ok) F.linhas.push(`Saldo no Mercado Pago: ${brl(saldo.v.available_balance || 0)} disponível e ${brl(saldo.v.unavailable_balance || 0)} a liberar.`);
      else F.erros.push("Saldo do Mercado Pago: este app não tem permissão para ler (" + saldo.erro + ")");

      // Pedidos e logística
      if (vH.ok && vO.ok && vS.ok && vM.ok) P.linhas.push(`Vendas: hoje ${vH.v.n} (${vH.v.itens} item(ns)), ontem ${vO.v.n}, 7 dias ${vS.v.n}, mês ${vM.v.n}. Canceladas no mês: ${vM.v.canc}.`);
      let atras = 0;
      if (etq.ok) {
        const L = etq.v, c = k => L.filter(e => e.cat === k).length;
        atras = L.filter(e => e.cat === "prontas" && agora - Date.parse(e.data) > 48 * 3600e3).length;
        P.linhas.push(`Envios (últimos pedidos): ${c("prontas")} etiqueta(s) pronta(s) para imprimir, ${c("impressas")} impressa(s) aguardando coleta/postagem, ${c("canceladas")} cancelada(s), ${c("outras")} já enviado(s) ou em andamento.`);
        if (atras) P.alertas.push(`${atras} envio(s) com etiqueta pronta há mais de 48h sem sair.`);
      } else falha(P, "Etiquetas e envios", etq);

      // Atendimento
      let topo = null, velha = false;
      if (perg.ok) {
        const q = perg.v.questions || [], total = perg.v.total ?? q.length;
        let linha = `Perguntas sem resposta: ${total}.`;
        if (q.length) { const h = (agora - Date.parse(q[0].date_created)) / 3600e3; linha += ` A mais antiga espera há ${h >= 48 ? Math.round(h / 24) + " dia(s)" : Math.round(h) + "h"}.`; if (h > 24) { T.alertas.push(`Há pergunta sem resposta há mais de 24h (${total} no total).`); velha = true; } }
        T.linhas.push(linha);
        const cont = q.reduce((o, x) => (o[x.item_id] = (o[x.item_id] || 0) + 1, o), {}), mx = Object.entries(cont).sort((a, b) => b[1] - a[1])[0];
        if (mx && mx[1] >= 2) { const tt = await tenta(() => get(`/items/${mx[0]}?attributes=id,title`)); topo = { id: mx[0], n: mx[1], titulo: tt.ok ? tt.v.title : mx[0] }; }
        if (total > 0 && !velha) T.alertas.push(`${total} pergunta(s) esperando resposta.`);
      } else falha(T, "Perguntas", perg);
      if (claims.ok) { const nc = (claims.v.paging && claims.v.paging.total) ?? (claims.v.data || []).length; T.linhas.push(`Reclamações abertas: ${nc}.`); if (nc) T.alertas.push(`${nc} reclamação(ões) aberta(s): responda dentro do prazo para proteger a reputação.`); }
      else T.erros.push("Reclamações: não consegui ler (" + claims.erro + ")");

      // Catálogo
      const n = r => r.ok ? r.v.paging.total : null;
      if (aAt.ok && aPa.ok) C.linhas.push(`Anúncios: ${n(aAt)} ativo(s) e ${n(aPa)} pausado(s)${n(aRev) ? `, ${n(aRev)} em revisão` : ""}${n(aIna) ? `, ${n(aIna)} inativo(s)` : ""}.`);
      else { falha(C, "Contagem de anúncios", aAt.ok ? aPa : aAt); }
      let baixo = [], semVenda = 0, semCat = 0;
      if (anu.ok) {
        const L = anu.v; baixo = L.filter(x => (x.available_quantity ?? 99) <= 3); semVenda = L.filter(x => !x.sold_quantity).length; semCat = L.filter(x => !x.catalog_product_id).length;
        C.linhas.push(`Entre ${L.length} ativo(s) analisado(s): ${baixo.length} com estoque até 3, ${semVenda} sem nenhuma venda, ${semCat} fora de produto de catálogo.`);
        if (baixo.length) C.alertas.push(`Estoque baixo: ${baixo.slice(0, 3).map(x => `${x.title.slice(0, 40)} (${x.available_quantity})`).join("; ")}${baixo.length > 3 ? " e mais " + (baixo.length - 3) : ""}.`);
      } else falha(C, "Análise dos anúncios", anu);

      // Marketing
      let cand = 0;
      if (promo.ok) {
        const L = Array.isArray(promo.v) ? promo.v : promo.v.results || [], st = x => String(x.status || "").toLowerCase();
        const ativas = L.filter(x => st(x) === "started").length; cand = L.filter(x => st(x) === "candidate" || st(x) === "pending").length;
        M.linhas.push(`Promoções: ${ativas} em andamento e ${cand} disponível(is) para participar.`);
        if (cand) M.alertas.push(`${cand} promoção(ões) disponível(is) aguardando decisão.`);
      } else M.erros.push("Promoções: não consegui ler (" + promo.erro + ")");
      if (ads.ok) { const a1 = (ads.v.advertisers || [])[0]; M.linhas.push(a1 ? `Product Ads habilitado (${a1.advertiser_name || a1.account_name || "anunciante " + a1.advertiser_id}).` : "Product Ads não habilitado nesta conta."); }

      // Conversa entre os agentes (cada fala nasce de um dado real lido acima)
      const conv = [], dizer = (de, para, texto) => conv.push({ de, para, texto });
      dizer("ger", "todos", `Time, o Maicon quer o status geral da conta ${nick}. Cada um traga o que conseguiu ler do seu setor.`);
      dizer("ped", "ger", P.linhas[0] ? P.linhas[0] : "Não consegui ler os pedidos agora.");
      if (atras) dizer("ped", "ate", `Tenho ${atras} envio(s) com etiqueta pronta há mais de 48h. Se chegarem perguntas ou reclamações desses pedidos, já sabem a causa.`);
      dizer("ate", "ger", T.linhas.length ? T.linhas.join(" ") : "Não consegui ler perguntas e reclamações.");
      if (topo) dizer("ate", "cat", `O anúncio “${topo.titulo.slice(0, 60)}” (${topo.id}) concentra ${topo.n} perguntas sem resposta. Vale revisar título, ficha técnica e descrição.`);
      dizer("cat", "ger", C.linhas.length ? C.linhas.join(" ") : "Não consegui analisar os anúncios agora.");
      if (baixo.length) dizer("cat", "ped", `${baixo.length} anúncio(s) ativo(s) com estoque até 3. Fiquem de olho na reposição para não pausar vendas.`);
      if (semVenda || n(aPa)) dizer("cat", "mkt", `${semVenda} anúncio(s) ativo(s) sem venda e ${n(aPa) ?? 0} pausado(s): candidatos a promoção ou ajuste de título.`);
      if (cand) { dizer("mkt", "fin", `Há ${cand} promoção(ões) disponível(is). Qual margem posso aceitar?`);
        dizer("fin", "mkt", vS.ok ? `Só as que mantiverem margem. O ritmo dos últimos 7 dias é ${brl(vS.v.fat / 7)}/dia; promoção não pode comer o lucro.` : "Só as que mantiverem a margem; não consegui ler o ritmo de vendas agora."); }
      dizer("mkt", "ger", M.linhas.length ? M.linhas.join(" ") : "Não consegui ler promoções agora.");
      dizer("fin", "ger", F.linhas[0] || "Não consegui ler o faturamento agora.");
      dizer("ger", "todos", "Obrigado. Vou consolidar o resumo para o Maicon.");

      // Resumo final do Gerente
      const sec = (tit, a) => (a.linhas.length || a.erros.length) ? `${tit}\n${a.linhas.map(l => "• " + l).join("\n")}` : "";
      const atencao = [G, F, P, T, C, M].flatMap(a => a.alertas.map(x => x)), erros = [G, F, P, T, C, M].flatMap(a => a.erros);
      const texto = [`Status da conta ${nick} no Mercado Livre — ${quando}`, sec("CONTA E REPUTAÇÃO", G), sec("VENDAS E FINANCEIRO", { linhas: [...P.linhas.slice(0, 1), ...F.linhas], erros: [] }),
        sec("ENVIOS", { linhas: P.linhas.slice(1), erros: [] }), sec("ATENDIMENTO", T), sec("ANÚNCIOS", C), sec("PROMOÇÕES E PUBLICIDADE", M),
        atencao.length ? "PONTOS DE ATENÇÃO\n" + atencao.map(x => "⚠ " + x).join("\n") : "PONTOS DE ATENÇÃO\n• Nenhum ponto crítico nos dados que consegui ler.",
        erros.length ? "NÃO CONSEGUI LER\n" + erros.map(x => "• " + x).join("\n") : ""].filter(Boolean).join("\n\n");
      const fala = `Conta ${nick}, ${nivelFala}${vH.ok ? vH.v.n + " venda(s) hoje. " : ""}${perg.ok ? (perg.v.total ?? 0) + " pergunta(s) sem resposta. " : ""}${atencao.length ? atencao.length + " ponto(s) de atenção." : "Sem pontos críticos."} O relatório completo está na tela.`;
      return { nick, quando, texto, fala, conversa: conv, falhas: erros.length, agentes: { ger: G, fin: F, ped: P, ate: T, cat: C, mkt: M } };
    },
    dados: async (get, t) => {
      const [p, i, q] = await Promise.all([get(`/orders/search?seller=${t.uid}&sort=date_desc&limit=1`), get(`/users/${t.uid}/items/search?status=active&limit=1`), get(`/questions/search?seller_id=${t.uid}&status=UNANSWERED&limit=1`)]);
      return `${p.paging.total} pedidos, ${i.paging.total} anúncios ativos e ${q.total} perguntas sem resposta no Mercado Livre.`;
    }
  },
  bling: {
    auth: (c, redir, st) => `https://www.bling.com.br/Api/v3/oauth/authorize?response_type=code&client_id=${c.client_id}&state=${st}`,
    token: (c, b) => { const f = form(b); f.headers.Authorization = "Basic " + Buffer.from(c.client_id + ":" + c.client_secret).toString("base64"); f.headers.Accept = "1.0"; return J("https://www.bling.com.br/Api/v3/oauth/token", f); },
    api: "https://api.bling.com.br/Api/v3",
    teste: (c) => [
      { nome: "API", url: "https://api.bling.com.br/Api/v3" },
      { nome: "Tela de autorização", url: `https://www.bling.com.br/Api/v3/oauth/authorize?response_type=code&client_id=${c.client_id || ""}&state=teste` }
    ],
    conta: async (get) => { const j = await get("/empresas/me/dados-basicos"); return j.data.nome || j.data.fantasia || "Conta Bling"; },
    dados: async (get) => {
      const [p, pr] = await Promise.all([get("/pedidos/vendas?limite=100"), get("/produtos?limite=100")]);
      return `${p.data.length} pedidos de venda recentes e ${pr.data.length} produtos listados no Bling.`;
    }
  }
};
const tokDe = (t, velho = {}) => ({ access: t.access_token, refresh: t.refresh_token || velho.refresh, exp: Date.now() + (t.expires_in || 3600) * 1000, uid: t.user_id || velho.uid });

// Refresh token do Mercado Livre é de uso único: duas renovações simultâneas invalidam a conexão.
// Por isso, só uma renovação por plataforma acontece de cada vez.
const renovando = new Map(), CACHE_ETQ = {}, CACHE_ANU = {}, CACHE_STA = {};
async function acessar(id) {
  const a = ADAPT[id], d = lerDB(), r = d[id];
  if (!CAT[id]) throw new Erro(301, "Plataforma desconhecida");
  if (!a) throw new Erro(301, CAT[id].nome + ": integração real ainda não disponível nesta versão");
  if (!r || !r.cred || !r.tok) throw new Erro(201, "Conta não autorizada. Salve as credenciais e clique em Autorizar");
  if (r.tok.exp < Date.now() + 60000) {
    if (!renovando.has(id)) renovando.set(id, (async () => {
      const novo = tokDe(await a.token(r.cred, { grant_type: "refresh_token", refresh_token: r.tok.refresh }), r.tok);
      const d2 = lerDB(); if (d2[id]) { d2[id].tok = novo; gravarDB(d2); } return novo;
    })().finally(() => renovando.delete(id)));
    try { r.tok = await renovando.get(id); }
    catch (e) { throw new Erro(203, "Não foi possível renovar o acesso: " + e.message); }
  }
  const get = p => J(a.api + p, { headers: { Authorization: "Bearer " + r.tok.access } });
  const post = (p, b) => J(a.api + p, { method: "POST", headers: { Authorization: "Bearer " + r.tok.access, "Content-Type": "application/json" }, body: JSON.stringify(b) }, 1);
  const raw = (p, h = {}) => fetch(a.api + p, { signal: AbortSignal.timeout(25000), headers: { "User-Agent": UA, Authorization: "Bearer " + r.tok.access, ...h } });
  return { a, r, get, raw, post };
}

/* ---------- pendências que pedem ação (perguntas, reclamações, promoções) e execução após aprovação ---------- */
async function pendenciasML(get, raw, t) {
  const uid = t.uid, itens = [], avisos = [];
  const tenta = async (nome, f) => { try { await f(); } catch (e) { avisos.push(nome + ": " + e.message); } };
  const json = async p => { const r = await raw(p), tx = await r.text(); let j = {}; try { j = JSON.parse(tx); } catch (_) {} if (!r.ok) throw new Error(r.status + (j.message ? ": " + j.message : "")); return j; };
  await tenta("Perguntas", async () => {
    const q = (await get(`/questions/search?seller_id=${uid}&status=UNANSWERED&limit=50&sort_fields=date_created&sort_types=ASC`)).questions || [];
    const ids = [...new Set(q.map(x => x.item_id))], tit = {};
    for (let i = 0; i < ids.length; i += 20) for (const x of await get(`/items?ids=${ids.slice(i, i + 20).join(",")}&attributes=id,title`)) if (x.code === 200 && x.body) tit[x.body.id] = x.body.title;
    for (const x of q) itens.push({ id: "q" + x.id, tipo: "pergunta", ag: "ate", qid: String(x.id), item: x.item_id, anuncio: tit[x.item_id] || x.item_id, texto: x.text, data: x.date_created, precisaTexto: true,
      titulo: `Pergunta em “${(tit[x.item_id] || x.item_id).slice(0, 60)}”: ${String(x.text).slice(0, 140)}` });
  });
  await tenta("Reclamações", async () => {
    const c = (await json(`/post-purchase/v1/claims/search?status=opened&limit=50`)).data || [];
    for (const x of c) itens.push({ id: "r" + x.id, tipo: "reclamacao", ag: "ate", cid: String(x.id), pedido: x.resource_id, motivo: x.reason_id, etapa: x.stage, data: x.date_created, precisaTexto: true,
      titulo: `Reclamação ${x.id} aberta (pedido ${x.resource_id || "?"}, ${x.stage || "etapa n/d"}, motivo ${x.reason_id || "n/d"})` });
  });
  await tenta("Promoções", async () => {
    const P = await json(`/seller-promotions/users/${uid}?app_version=v2`), L = (Array.isArray(P) ? P : P.results || []).filter(x => /candidate|pending/i.test(x.status || ""));
    for (const pr of L.slice(0, 10)) {
      let its = []; try { const j = await json(`/seller-promotions/promotions/${pr.id}/items?promotion_type=${encodeURIComponent(pr.type)}&app_version=v2&status=candidate&limit=20`); its = j.results || []; } catch (_) {}
      for (const it of its) itens.push({ id: "p" + pr.id + "-" + it.id, tipo: "promocao", ag: "mkt", promo: pr.id, ptipo: pr.type, item: it.id, preco: it.suggested_discounted_price || it.new_price || null,
        titulo: `Promoção “${pr.name || pr.id}” (${pr.type}): aderir com o anúncio ${it.id}${it.suggested_discounted_price ? " por " + brl(it.suggested_discounted_price) : ""}` });
    }
  });
  return { itens, avisos };
}
async function executarML(post, a) {
  if (a.tipo === "pergunta") {
    const txt = String(a.texto || "").trim(); if (txt.length < 5) throw new Erro(301, "Escreva a resposta antes de aprovar (mínimo 5 caracteres)");
    await post("/answers", { question_id: Number(a.qid), text: txt.slice(0, 2000) }); return "Pergunta " + a.qid + " respondida no Mercado Livre.";
  }
  if (a.tipo === "reclamacao") {
    const txt = String(a.texto || "").trim(); if (txt.length < 5) throw new Erro(301, "Escreva a mensagem antes de aprovar (mínimo 5 caracteres)");
    await post(`/post-purchase/v1/claims/${encodeURIComponent(a.cid)}/actions/send-message`, { receiver_role: "complainant", message: txt.slice(0, 2000) }); return "Mensagem enviada na reclamação " + a.cid + ".";
  }
  if (a.tipo === "promocao") {
    if (!idML(a.item)) throw new Erro(301, "Anúncio inválido");
    const b = { promotion_id: a.promo, promotion_type: a.ptipo }; if (a.preco) b.deal_price = a.preco;
    await post(`/seller-promotions/items/${a.item}?app_version=v2`, b); return "Anúncio " + a.item + " incluído na promoção " + a.promo + ".";
  }
  throw new Erro(301, "Tipo de ação desconhecido");
}

// Testa cada endereço que o fluxo usa e mostra qual deles está sendo bloqueado.
async function diagnostico(id) {
  const a = ADAPT[id]; if (!a) throw new Erro(301, "Sem diagnóstico para esta plataforma");
  const c = (lerDB()[id] || {}).cred || {}, resultados = [];
  for (const t of a.teste(c)) {
    const ini = Date.now(), x = { nome: t.nome, host: new URL(t.url).host };
    try {
      const r = await fetch(t.url, { redirect: "manual", signal: AbortSignal.timeout(8000), headers: { "User-Agent": UA } });
      const txt = (await r.text()).slice(0, 3000);
      x.status = r.status; x.bloqueado = r.status === 403 && BLOQ.test(txt); x.cloudfront_id = r.headers.get("x-amz-cf-id") || undefined;
    } catch (e) { x.erro = e.message; }
    x.ms = Date.now() - ini; resultados.push(x);
  }
  const dicas = [];
  if (resultados.some(x => x.bloqueado)) dicas.push("Há bloqueio CloudFront/WAF: desative VPN/proxy, tente outra rede (ex.: 4G do celular) e evite abrir a autorização por abas anônimas com extensões de bloqueio.");
  if (resultados.some(x => x.erro)) dicas.push("Falha de conexão: verifique internet, firewall e antivírus com inspeção HTTPS.");
  if (!c.client_id) dicas.push("App ID ainda não salvo.");
  if (CAT[id].oauth && redirDe(id, c).startsWith("http://")) dicas.push("O Redirect URI atual é HTTP (" + redirDe(id, c) + "). Se a plataforma exigir HTTPS, use um túnel (ex.: cloudflared/ngrok) apontando para localhost:" + PORTA + ", cadastre essa URL no app e informe-a no campo Redirect URI.");
  if (!OAUTH_HITS.length) dicas.push("Nenhum retorno do login chegou a este servidor desde que ele iniciou: o Mercado Livre não redirecionou, ou o túnel (ngrok) não encaminhou para localhost:" + PORTA + ".");
  else if (!OAUTH_HITS[0].tem_code) dicas.push("O último retorno chegou SEM code (parâmetros: " + (OAUTH_HITS[0].parametros.join(", ") || "nenhum") + "). Isso acontece quando o endereço do túnel é aberto direto, a página é recarregada, ou o Mercado Livre cancelou a autorização.");
  return { versao: VERSAO, redirect_uri: redirDe(id, c), retornos_oauth: OAUTH_HITS, resultados, dicas };
}

// Pedidos de autorização ficam em arquivo: reiniciar a Central não derruba um login em andamento.
const ARQ_EST = path.join(__dirname, "estados.json"), OAUTH_HITS = [];   // últimos retornos do login (para diagnóstico)
const lerEst = () => { try { return JSON.parse(fs.readFileSync(ARQ_EST, "utf8")); } catch (_) { return {}; } };
const gravarEst = e => { const n = Date.now(); for (const k in e) if (e[k].exp < n) delete e[k]; fs.writeFileSync(ARQ_EST, JSON.stringify(e), { mode: 0o600 }); };
// Troca o código de autorização por acesso. Usada pelo retorno automático e pela página /colar.
async function concluir(id, code, state, recusa) {
  const d = lerDB(), r = d[id] || (d[id] = {});
  let etapa = "validar o retorno";
  const ctx = () => ({ etapa, recebeu_code: !!code, tamanho_code: code ? String(code).length : 0, recebeu_state: !!state, redirect_uri_usado: redirDe(id, r.cred || {}),
    client_id_final: String((r.cred || {}).client_id || "").slice(-4), recusa: recusa || undefined, retornos_recentes: OAUTH_HITS.slice(0, 3) });
  try {
    if (recusa) throw new Erro(202, "Autorização recusada pela plataforma: " + recusa);
    if (!code) throw new Erro(202, "O endereço não traz o código de autorização (code=...). Cole o endereço completo");
    etapa = "conferir o pedido de autorização (state)";
    const e = lerEst(), s = e[state];
    if (!s || s.id !== id || s.exp < Date.now()) throw new Erro(202, "Pedido de autorização desconhecido ou expirado. Clique em Autorizar novamente e use o endereço novo");
    if (!r.cred || !r.cred.client_id) throw new Erro(201, "Credenciais não salvas");
    etapa = "trocar o código pelo acesso (POST /oauth/token)";
    r.tok = tokDe(await ADAPT[id].token(r.cred, { grant_type: "authorization_code", code, redirect_uri: redirDe(id, r.cred), ...(s.v ? { code_verifier: s.v } : {}) }));
    delete e[state]; gravarEst(e);
    etapa = "ler os dados da conta";
    gravarDB(d); const { get } = await acessar(id); r.conta = await ADAPT[id].conta(get); delete r.erro;
  } catch (e) {
    const tec = { hora: new Date().toISOString(), ...ctx(), ...(e.tec || {}) }; if (!e.codigo) tec.pilha = String(e.stack || "").split("\n").slice(0, 4).map(x => x.trim());
    r.erro = { codigo: e.codigo || 202, msg: e.message, hora: Date.now(), tec }; logSrv(r.erro.codigo, r.erro.msg, "OAuth · " + etapa, tec); if (!(e.codigo === 202 && r.tok)) delete r.tok;
  }
  gravarDB(d); return r;
}
const PAG_COLAR = `<!doctype html><meta charset="utf-8"><title>Automação IA MS importadora</title>
<body style="font-family:system-ui;max-width:720px;margin:40px auto;padding:0 16px">
<h2>Automação IA MS importadora</h2>
<h3>Concluir autorização</h3>
<p>Depois de autorizar no Mercado Livre, copie o endereço <b>completo</b> da barra do navegador (mesmo que a página mostre erro) — ou só o código que começa com <b>TG-</b> — e cole aqui:</p>
<textarea id="u" rows="4" style="width:100%" placeholder="https://....trycloudflare.com/oauth/mercadolivre?code=TG-...&state=..."></textarea>
<p><button id="b" style="padding:8px 18px">Concluir</button> <span id="m"></span></p>
<script>b.onclick=async()=>{m.textContent="Processando...";try{const r=await(await fetch("/api/oauth/colar",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({url:u.value})})).json();
if(r.ok){m.textContent="Conectado: "+(r.conta||"ok")+". Voltando...";setTimeout(()=>location.href="/?voltar=conexoes",1200)}else m.textContent="E"+r.erro.codigo+": "+r.erro.msg+(r.erro.tec&&r.erro.tec.etapa?" [etapa: "+r.erro.tec.etapa+"]":"")}catch(e){m.textContent="Erro: "+e.message}}</script>
<p style="margin-top:40px;text-align:center;font-size:12px;color:#667">Automação IA MS importadora · Desenvolvido por <b>Maicon da Rosa Gonçalves</b></p>`;
function lista() {
  const d = lerDB();
  return Object.entries(CAT).map(([id, c]) => {
    const r = d[id] || {}, cred = r.cred || {};
    return { id, nome: c.nome, oauth: !!c.oauth, real: !!ADAPT[id], redirect: c.oauth ? redirDe(id, cred) : null,
      estado: r.tok ? "conectado" : r.cred ? "credenciais" : "desconectado", conta: r.conta || null, erro: r.erro || null,
      campos: c.campos.map(([k, rot, sec]) => ({ k, rot, secreto: !!sec, salvo: !!cred[k], valor: sec ? "" : cred[k] || "" })) };
  });
}
function falha(res, e, rota) {
  const tec = { rota: rota || undefined, hora: new Date().toISOString(), servidor: VERSAO, node: process.version, ...(e.tec || {}) };
  if (!e.codigo) tec.pilha = String(e.stack || "").split("\n").slice(0, 5).map(x => x.trim());
  logSrv(e.codigo || 901, e.message, rota, tec);
  res.end(JSON.stringify({ erro: { codigo: e.codigo || 901, msg: e.message, tec } }));
}
const corpo = req => new Promise(ok => { let b = ""; req.on("data", c => { b += c; if (b.length > 1e5) req.destroy(); }); req.on("end", () => { try { ok(JSON.parse(b || "{}")); } catch (_) { ok({}); } }); });


/* ---------- impressão direta das etiquetas (sem abrir o PDF no navegador) ----------
   Usa o SumatraPDF (leve, grátis): winget install SumatraPDF.SumatraPDF
   Impressora: a padrão do Windows, ou o nome escrito em impressora.txt (um nome só, na pasta da Central). */
const achaSumatra = () => {
  const L = process.env.LOCALAPPDATA || "", P = process.env.ProgramFiles || "C:\\Program Files", P86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
  const c = ["SumatraPDF", path.join(L, "SumatraPDF", "SumatraPDF.exe"), path.join(P, "SumatraPDF", "SumatraPDF.exe"), path.join(P86, "SumatraPDF", "SumatraPDF.exe")];
  const w = spawnSync("where", ["SumatraPDF"], { encoding: "utf8" });
  if (w.status === 0) { const x = String(w.stdout).split(/\r?\n/)[0].trim(); if (x) return x; }
  return c.slice(1).find(x => fs.existsSync(x));
};

// Impressoras instaladas no Windows (para escolher na aba Etiquetas). A escolhida fica em impressora.txt.
const ARQ_IMP = path.join(__dirname, "impressora.txt");
const impAtual = () => { try { return fs.readFileSync(ARQ_IMP, "utf8").trim(); } catch (_) { return ""; } };
const listarImpressoras = () => {
  const r = spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", "[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-CimInstance Win32_Printer | ForEach-Object { $_.Name + '|' + $_.Default }"], { encoding: "utf8", timeout: 15000, windowsHide: true });
  if (r.error || r.status !== 0) throw new Erro(304, "Não consegui listar as impressoras do Windows" + (r.error ? ": " + r.error.message : ""));
  return String(r.stdout).split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(l => { const i = l.lastIndexOf("|"); return { nome: l.slice(0, i), padrao: /true/i.test(l.slice(i + 1)) }; });
};
const imprimirPdf = buf => new Promise((ok, no) => {
  const exe = achaSumatra();
  if (!exe) return no(new Erro(303, "Impressão direta indisponível: SumatraPDF não encontrado. Instale com: winget install SumatraPDF.SumatraPDF"));
  const nome = impAtual();
  const arq = path.join(os.tmpdir(), "etiquetas-" + Date.now() + ".pdf"); fs.writeFileSync(arq, buf);
  const args = nome ? ["-print-to", nome, "-silent", arq] : ["-print-to-default", "-silent", arq];
  const t = spawn(exe, args, { windowsHide: true });
  const lixo = () => setTimeout(() => fs.unlink(arq, () => {}), 60000);
  t.on("error", e => { lixo(); no(new Erro(303, "Não consegui chamar o SumatraPDF: " + e.message)); });
  t.on("exit", c => { lixo(); c === 0 ? ok(nome || "impressora padrão") : no(new Erro(303, "O SumatraPDF não conseguiu imprimir (código " + c + "). Confira o nome em impressora.txt ou a impressora padrão do Windows.")); });
});

/* ---------- cadastro de clientes (aba Clientes) ----------
   Fica em clientes.json, só neste computador. "Buscar no Mercado Livre" traz os compradores dos pedidos recentes
   (nome, apelido, telefone, endereço, CPF/CNPJ quando o Mercado Livre libera) e NUNCA apaga o que você digitou à mão. */
const ARQ_CLI = path.join(__dirname, "clientes.json");
const lerCli = () => { try { const j = JSON.parse(fs.readFileSync(ARQ_CLI, "utf8")); return Array.isArray(j) ? j : []; } catch (_) { return []; } };
const gravarCli = l => { const tmp = ARQ_CLI + ".tmp"; fs.writeFileSync(tmp, JSON.stringify(l, null, 2)); fs.renameSync(tmp, ARQ_CLI); };
const CAMPOS_CLI = ["nome", "apelido", "documento", "telefone", "telefone2", "email", "cep", "endereco", "cidade", "uf", "obs"];
const limpaCli = b => { const o = {}; for (const k of CAMPOS_CLI) o[k] = String(b[k] == null ? "" : b[k]).trim().slice(0, k === "obs" ? 1000 : 200); return o; };
const novoIdCli = () => "c" + Date.now().toString(36) + crypto.randomBytes(3).toString("hex");
const fone = t => t && typeof t === "object" ? [t.area_code, t.number].filter(Boolean).join("").replace(/\s+/g, "") : String(t || "");

async function sincronizarClientes(limite) {
  const { r, get, raw } = await acessar("mercadolivre");
  const ped = []; let off = 0, total = Infinity;
  while (off < total && off < limite) {
    const j = await get(`/orders/search?seller=${r.tok.uid}&sort=date_desc&limit=50&offset=${off}`);
    total = j.paging.total; if (!j.results.length) break; ped.push(...j.results); off += 50;
  }
  const mapa = new Map();   // um registro por comprador
  for (const o of ped) {
    const b = o.buyer || {}; if (!b.id) continue;
    const c = mapa.get(String(b.id)) || { mlId: String(b.id), apelido: b.nickname || "", nome: [b.first_name, b.last_name].filter(Boolean).join(" "),
      email: b.email || "", telefone: fone(b.phone), telefone2: fone(b.alternative_phone), pedidos: [], sid: "", oid: String(o.id) };
    c.pedidos.push({ id: String(o.id), data: o.date_created, total: o.total_amount || 0, cancelado: /cancel|invalid/.test(o.status) });
    if (!c.sid && o.shipping && o.shipping.id && !/cancel|invalid/.test(o.status)) { c.sid = String(o.shipping.id); c.oid = String(o.id); }
    mapa.set(String(b.id), c);
  }
  const L = [...mapa.values()];
  // Endereço, telefone do destinatário e CPF/CNPJ: uma consulta por comprador (se o Mercado Livre não liberar, segue sem).
  for (let i = 0; i < L.length; i += 8) await Promise.all(L.slice(i, i + 8).map(async c => {
    if (c.sid) try {
      const x = await raw(`/shipments/${c.sid}`, { "x-format-new": "true" });
      if (x.ok) {
        const s = await x.json(), d = s.destination || {}, e = d.shipping_address || s.receiver_address || {};
        if (!c.nome && d.receiver_name) c.nome = String(d.receiver_name);
        const tel = fone(d.receiver_phone || s.receiver_address && s.receiver_address.receiver_phone);
        if (tel && !c.telefone) c.telefone = tel; else if (tel && tel !== c.telefone && !c.telefone2) c.telefone2 = tel;
        c.cep = String(e.zip_code || ""); c.cidade = String((e.city && e.city.name) || ""); c.uf = String(e.state && (e.state.id || e.state.name) || "").replace(/^BR-/, "");
        c.endereco = [e.street_name, e.street_number, e.neighborhood && e.neighborhood.name, e.comment].filter(Boolean).join(", ");
      }
    } catch (_) {}
    try {
      const x = await raw(`/orders/${c.oid}/billing_info`);
      if (x.ok) { const j = await x.json(), bi = j.billing_info || j; if (bi && bi.doc_number) c.documento = String(bi.doc_number); }
    } catch (_) {}
  }));
  const lista = lerCli(); let novos = 0, atualizados = 0;
  for (const c of L) {
    let reg = lista.find(x => x.mlId === c.mlId);
    if (!reg) { reg = { id: novoIdCli(), mlId: c.mlId, criado: new Date().toISOString(), pedidos: [] }; for (const k of CAMPOS_CLI) reg[k] = ""; lista.push(reg); novos++; } else atualizados++;
    for (const k of CAMPOS_CLI) if (!reg[k] && c[k]) reg[k] = String(c[k]).slice(0, 200);   // só preenche o que está vazio
    reg.apelido = c.apelido || reg.apelido;
    const ids = new Set(reg.pedidos.map(p => p.id)); for (const p of c.pedidos) if (!ids.has(p.id)) reg.pedidos.push(p);
    reg.pedidos.sort((a, b) => String(b.data).localeCompare(String(a.data))); reg.pedidos = reg.pedidos.slice(0, 500);
  }
  gravarCli(lista);
  const semFone = lista.filter(x => !x.telefone && !x.telefone2).length;
  return { ok: true, pedidosLidos: ped.length, novos, atualizados, total: lista.length, semTelefone: semFone };
}

/* ---------- Estúdio de fotos: todas as fotos dos anúncios (ativos e pausados) ---------- */
const CACHE_FTS = {};
async function listarFotos(get, uid) {
  const itens = [];
  for (const st of ["active", "paused"]) {
    const ids = []; let off = 0, total = Infinity;
    while (off < total && off < 300) {
      const j = await get(`/users/${uid}/items/search?status=${st}&limit=50&offset=${off}`);
      total = j.paging.total; if (!j.results.length) break; ids.push(...j.results); off += 50;
    }
    for (let i = 0; i < ids.length; i += 20) {
      const L = await get(`/items?ids=${ids.slice(i, i + 20).join(",")}&attributes=id,title,status,permalink,pictures`);
      for (const x of L) if (x.code === 200 && x.body) itens.push({ id: x.body.id, titulo: x.body.title, status: x.body.status, link: x.body.permalink,
        fotos: (x.body.pictures || []).map(f => ({ id: f.id, url: f.secure_url || f.url, tam: f.max_size || f.size || "" })).filter(f => f.url) });
    }
  }
  return itens;
}

// Vozes do Windows (System.Speech): funcionam sem internet. Só aparecem as instaladas em português do Brasil.
let CACHE_VOZES = null;
const psAsync = (script, env, ms) => new Promise((ok, no) => {
  const c = spawn("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], { env: { ...process.env, ...env }, windowsHide: true });
  let o = "", e = ""; const tm = setTimeout(() => { try { c.kill(); } catch (_) {} no(new Error("o Windows demorou demais para gerar a voz")); }, ms || 30000);
  c.stdout.on("data", d => o += d); c.stderr.on("data", d => e += d);
  c.on("error", x => { clearTimeout(tm); no(x); }); c.on("exit", k => { clearTimeout(tm); k === 0 ? ok(o) : no(new Error((e || "falha no PowerShell").trim().slice(0, 200))); });
});
async function listarVozes() {
  if (CACHE_VOZES) return CACHE_VOZES;
  const L = [];
  if (process.platform === "win32") {
    try {
      const o = await psAsync("[Console]::OutputEncoding=[Text.Encoding]::UTF8; Add-Type -AssemblyName System.Speech; $s=New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.GetInstalledVoices() | Where-Object { $_.Enabled -and $_.VoiceInfo.Culture.Name -eq 'pt-BR' } | ForEach-Object { $_.VoiceInfo.Name + '|' + $_.VoiceInfo.Gender }", {}, 20000);
      o.split(/\r?\n/).map(x => x.trim()).filter(Boolean).forEach(x => { const [n, g] = x.split("|"); L.push({ id: "win:" + n, nome: `${n.replace(/^Microsoft\s+/, "").replace(/\s+Desktop$/, "")} · ${/female/i.test(g) ? "feminina" : "masculina"} · Windows (offline)`, grupo: "windows" }); });
    } catch (_) {}
  }
  L.push({ id: "google", nome: "Padrão · feminina · Google (online, rápida)", grupo: "online" });
  [["nova", "feminina, calorosa"], ["shimmer", "feminina, suave"], ["coral", "feminina, animada"], ["alloy", "neutra, clara"], ["echo", "masculina, firme"], ["onyx", "masculina, grave"], ["fable", "masculina, expressiva"], ["ash", "masculina, amigável"]]
    .forEach(([v, d]) => L.push({ id: "ia:" + v, nome: `IA natural · ${v[0].toUpperCase() + v.slice(1)} · ${d} (experimental)`, grupo: "ia" }));
  return (CACHE_VOZES = L);
}
async function sintetizarWin(nome, texto) {
  if (process.platform !== "win32") throw new Erro(308, "As vozes do Windows só funcionam no Windows");
  const voz = (await listarVozes()).find(v => v.id === "win:" + nome); if (!voz) throw new Erro(308, "Essa voz não está instalada neste computador");
  const t = path.join(os.tmpdir(), "central-voz-" + crypto.randomBytes(5).toString("hex")), txt = t + ".txt", wav = t + ".wav";
  fs.writeFileSync(txt, texto, "utf8");
  try {
    await psAsync("Add-Type -AssemblyName System.Speech; $s=New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.SelectVoice($env:VOZ_NOME); $s.Rate=0; $s.SetOutputToWaveFile($env:VOZ_WAV); $s.Speak([IO.File]::ReadAllText($env:VOZ_TXT,[Text.Encoding]::UTF8)); $s.Dispose()", { VOZ_NOME: nome, VOZ_TXT: txt, VOZ_WAV: wav }, 40000);
    const b = fs.readFileSync(wav); if (b.length < 800) throw new Error("áudio vazio"); return b;
  } catch (e) { throw new Erro(308, "A voz do Windows falhou: " + e.message); }
  finally { for (const f of [txt, wav]) try { fs.unlinkSync(f); } catch (_) {} }
}
let FOTOIA_ATE = 0;   // até quando a IA gratuita está em pausa por limite (aba Fotos IA)
const srv = http.createServer(async (req, res) => {
  const u = new URL(req.url, BASE), p = u.pathname.split("/").filter(Boolean);
  try {
    // Protege o painel contra outros sites (CSRF / DNS rebinding). Por um túnel HTTPS (ngrok/cloudflared)
    // só o retorno do login (/oauth/...) é permitido; painel e /api ficam restritos a este computador.
    const hosts = ["localhost:" + PORTA, "127.0.0.1:" + PORTA], o = req.headers.origin, local = hosts.includes(req.headers.host);
    if (!local ? p[0] !== "oauth" : (p[0] === "api" && o && !hosts.some(h => o === "http://" + h))) { res.writeHead(403, { "Content-Type": "text/plain" }); return res.end("Acesso negado"); }
    if (p[0] === "colar") { res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); return res.end(PAG_COLAR); }
    if (p[0] === "api" && p[1] === "oauth" && p[2] === "colar" && req.method === "POST") {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      const bruto = String((await corpo(req)).url || "").trim();
      if (/^TG-[\w-]+$/.test(bruto)) {   // só o código: usa o pedido de autorização mais recente
        const e0 = lerEst(), pend = Object.entries(e0).filter(([, v]) => v.id === "mercadolivre" && v.exp > Date.now()).sort((a, b) => b[1].exp - a[1].exp)[0];
        if (!pend) throw new Erro(202, "Não há pedido de autorização em andamento. Clique em Autorizar na Central e cole o código logo em seguida");
        const r0 = await concluir("mercadolivre", bruto, pend[0], null);
        return res.end(JSON.stringify(r0.erro ? { erro: { codigo: r0.erro.codigo, msg: r0.erro.msg, tec: r0.erro.tec } } : { ok: true, conta: r0.conta }));
      }
      let x; try { x = new URL(bruto); } catch (_) { throw new Erro(202, "Endereço inválido. Cole o endereço completo da barra do navegador (ou só o código TG-...)"); }
      const id = x.pathname.split("/").filter(Boolean)[1];
      if (/mercadoli[vb]re\.com/.test(x.host)) throw new Erro(202, "Esse é o endereço do Mercado Livre (tela de autorização ou de erro), não o de retorno. Depois de aceitar a autorização, copie o endereço que começa com o SEU domínio do túnel e termina com ?code=TG-...&state=...", { etapa: "colar endereço", host: x.host, caminho: x.pathname, parametros: [...x.searchParams.keys()] });
      if (!ADAPT[id]) throw new Erro(202, "Endereço não reconhecido (esperado .../oauth/mercadolivre?code=...)");
      if (!x.searchParams.get("code") && !x.searchParams.get("error") && !x.searchParams.get("error_description"))
        throw new Erro(202, "O endereço colado (" + x.host + x.pathname + ") não tem code=. Ele é o endereço de retorno ANTES de o Mercado Livre devolver o código. Clique em Autorizar, aceite no Mercado Livre e copie o endereço que aparecer DEPOIS (com ?code=TG-...), ou cole só o código TG-...", { etapa: "colar endereço", host: x.host, caminho: x.pathname, parametros: [...x.searchParams.keys()] });
      const r = await concluir(id, x.searchParams.get("code"), x.searchParams.get("state"), x.searchParams.get("error_description") || x.searchParams.get("error"));
      return res.end(JSON.stringify(r.erro ? { erro: { codigo: r.erro.codigo, msg: r.erro.msg, tec: r.erro.tec } } : { ok: true, conta: r.conta }));
    }
    if (p[0] === "api" && p[1] === "logs") {   // erros registrados pelo servidor (arquivo logs-erros.json)
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      if (p[2] === "teste") throw new Erro(999, "Erro de teste gerado pelo botão da aba Logs. Se você vê este registro, os logs do servidor estão funcionando.", { etapa: "teste manual", hora: new Date().toISOString() });
      if (req.method === "DELETE") { LOGSRV = []; try { fs.writeFileSync(ARQ_LOG, "[]"); } catch (_) {} return res.end(JSON.stringify({ ok: true })); }
      return res.end(JSON.stringify({ itens: LOGSRV.slice(-200) }));
    }
    if (p[0] === "api" && p[1] === "ping") { res.writeHead(200, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ ok: true, node: process.version, versao: VERSAO, pasta: __dirname, index_html: (() => { try { return fs.statSync(path.join(__dirname, "index.html")).mtime.toISOString(); } catch (_) { return "nao encontrado"; } })() })); }
    if (p[0] === "api" && p[1] === "diagnostico" && p[2]) {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      return res.end(JSON.stringify(await diagnostico(p[2]), null, 2));
    }
    if (p[0] === "api" && p[1] === "buscar") {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      try {
        if (typeof fetch !== "function") throw new Error("Atualize o Node.js para a versão 18 ou mais nova");
        const q = limpar(u.searchParams.get("q") || ""); let r = null;
        for (const f of [wikipedia, duck]) { try { r = await f(q); if (r) break; } catch (_) {} }
        return res.end(JSON.stringify(r || { texto: null }));
      } catch (e) { return res.end(JSON.stringify({ texto: null, erro: e.message })); }
    }
    if (p[0] === "api" && p[1] === "oauth" && p[3] === "iniciar") {
      const id = p[2], c = (lerDB()[id] || {}).cred;
      if (!ADAPT[id] || !c || !c.client_id) { res.writeHead(302, { Location: BASE + "/?voltar=conexoes" }); return res.end(); }
      const st = crypto.randomBytes(12).toString("hex"), e = lerEst();
      const v = ADAPT[id].pkce ? crypto.randomBytes(32).toString("base64url") : null, ch = v && crypto.createHash("sha256").update(v).digest("base64url");
      e[st] = { id, exp: Date.now() + 30 * 60 * 1000, v }; gravarEst(e);
      res.writeHead(302, { Location: ADAPT[id].auth(c, redirDe(id, c), st, ch) }); return res.end();
    }
    if (p[0] === "oauth" && p[1]) {                       // retorno do login na plataforma
      if (ADAPT[p[1]]) {
        OAUTH_HITS.unshift({ hora: new Date().toISOString(), metodo: req.method, host: req.headers.host, caminho: u.pathname, parametros: [...u.searchParams.keys()], tem_code: !!u.searchParams.get("code"), tem_state: !!u.searchParams.get("state"), origem: req.headers.referer || "", navegador: String(req.headers["user-agent"] || "").slice(0, 70) });
        if (OAUTH_HITS.length > 10) OAUTH_HITS.pop();
        const cod = u.searchParams.get("code"), rec = u.searchParams.get("error_description") || u.searchParams.get("error");
        console.log("[oauth] retorno em /oauth/" + p[1] + " · parâmetros: " + ([...u.searchParams.keys()].join(", ") || "nenhum"));
        if (cod || rec) await concluir(p[1], cod, u.searchParams.get("state"), rec);
        else console.log("[oauth] acesso sem código ignorado (nada foi alterado). Use o botão Autorizar na Central.");
      }
      res.writeHead(302, { Location: BASE + "/?voltar=conexoes" }); return res.end();
    }
    if (p[0] === "api" && p[1] === "status" && p[2]) {   // status geral da conta: os agentes coletam, conversam e o Gerente resume
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      const id = p[2]; if (!CAT[id]) throw new Erro(301, "Plataforma desconhecida");
      const { a, r, get, raw } = await acessar(id);
      if (!a.status) throw new Erro(301, `${CAT[id].nome}: o status geral ainda não está disponível nesta versão`);
      if (!u.searchParams.get("forcar") && CACHE_STA[id] && Date.now() - CACHE_STA[id].t < 30000) return res.end(JSON.stringify(CACHE_STA[id].j));
      const j = await a.status(get, r.tok, raw); CACHE_STA[id] = { t: Date.now(), j };
      return res.end(JSON.stringify(j));
    }
    if (p[0] === "api" && p[1] === "consulta" && p[2]) {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      const id = p[2], tipo = u.searchParams.get("tipo") || "vendas";
      if (!CAT[id]) throw new Erro(301, "Plataforma desconhecida");
      const { a, r, get } = await acessar(id);
      if (!a.consulta) throw new Erro(301, `${CAT[id].nome}: a consulta de ${tipo} ainda não está disponível nesta versão`);
      return res.end(JSON.stringify({ texto: await a.consulta(get, r.tok, tipo, u.searchParams.get("periodo") || "hoje") }));
    }
    if (p[0] === "api" && p[1] === "anuncios" && p[2]) {   // meus anúncios, análise dos concorrentes e fotos (Mercado Livre)
      const id = p[2]; if (id !== "mercadolivre") throw new Erro(301, "Anúncios: só o Mercado Livre está disponível nesta versão");
      const { a, r, get, raw } = await acessar(id);
      if (p[3] === "diag") {   // mostra o que o Mercado Livre libera para este app (para eu ajustar a análise)
        const mid = u.searchParams.get("id"); if (!idML(mid)) throw new Erro(301, "Use /api/anuncios/mercadolivre/diag?id=MLB123...");
        const meu = await get(`/items/${mid}?attributes=id,title,category_id,catalog_product_id`), out = [];
        const sonda = async (nome, p2) => { try { const r2 = await raw(p2), tx = await r2.text(); out.push({ nome, status: r2.status, amostra: tx.slice(0, 350) }); return r2.ok ? JSON.parse(tx) : null; } catch (e) { out.push({ nome, erro: e.message }); return null; } };
        await sonda("busca pública", `/sites/MLB/search?q=${encodeURIComponent(meu.title.split(" ").slice(0, 3).join(" "))}&limit=1`);
        let pid = meu.catalog_product_id; const ps = await sonda("catálogo: buscar produto", `/products/search?status=active&site_id=MLB&q=${encodeURIComponent(meu.title.split(" ").slice(0, 6).join(" "))}`);
        if (!pid && ps && ps.results && ps.results[0]) pid = ps.results[0].id;
        if (pid) { await sonda("catálogo: produto " + pid, `/products/${pid}`); const it = await sonda("catálogo: anúncios do produto", `/products/${pid}/items`);
          const L = it && (Array.isArray(it) ? it : it.results || it.items || []), o = L && L[0], oid = o && (o.item_id || o.id);
          if (oid) { await sonda("item de outro vendedor " + oid, `/items/${oid}`); await sonda("descrição de outro vendedor", `/items/${oid}/description`); } }
        await sonda("highlights da categoria", `/highlights/MLB/category/${meu.category_id}`);
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" }); return res.end(JSON.stringify({ anuncio: meu, sondas: out }, null, 2));
      }
      const corpoPost = req.method === "POST" ? await corpo(req) : {};
      if (p[3] === "fotos" && idML(corpoPost.produto)) {   // fotos do produto no catálogo (as fotos de outros vendedores a API não libera)
        const pr = await get(`/products/${corpoPost.produto}`), arqs = []; let n = 0;
        for (const pic of pr.pictures || []) { const url = pic.url || pic.secure_url; let h; try { h = new URL(url); } catch (_) { continue; }
          if (h.protocol !== "https:" || !/(^|\.)mlstatic\.com$/.test(h.hostname)) continue;
          try { const f = await fetch(url, { signal: AbortSignal.timeout(20000), headers: { "User-Agent": UA } }); if (!f.ok) continue;
            const ext = (h.pathname.match(/\.(jpe?g|png|webp|gif)$/i) || [, (f.headers.get("content-type") || "").split("/")[1] || "jpg"])[1].toLowerCase();
            arqs.push({ nome: `catalogo_${corpoPost.produto}/foto-${String(++n).padStart(2, "0")}.${ext}`, dados: Buffer.from(await f.arrayBuffer()) }); } catch (_) {} }
        if (!arqs.length) throw new Erro(302, "O catálogo não trouxe fotos baixáveis para este produto");
        arqs.push({ nome: "links.txt", dados: Buffer.from(`${pr.name || ""}\nhttps://www.mercadolivre.com.br/p/${corpoPost.produto}\n`, "utf8") });
        res.writeHead(200, { "Content-Type": "application/zip", "Content-Disposition": 'attachment; filename="fotos-catalogo.zip"' }); return res.end(zipar(arqs));
      }
      if (p[3] === "fotos" && req.method === "POST") {
        const ids = [...new Set((corpoPost.ids || []).map(String).filter(idML))].slice(0, 10);
        if (!ids.length) throw new Erro(301, "Nenhum anúncio informado");
        const arqs = [], links = [];
        for (let i = 0; i < ids.length; i += 4) await Promise.all(ids.slice(i, i + 4).map(async (mid, k) => {
          const b = await get(`/items/${mid}?attributes=id,title,permalink,video_id,pictures`), pasta = String(i + k + 1).padStart(2, "0") + "_" + mid;
          links.push(`${pasta}\n${b.title}\n${b.permalink}\n` + (b.video_id ? "Vídeo (YouTube): https://www.youtube.com/watch?v=" + b.video_id + "\n" : "Sem vídeo\n"));
          let n = 0;
          for (const pic of b.pictures || []) {
            const url = pic.secure_url || pic.url; let h; try { h = new URL(url); } catch (_) { continue; }
            if (h.protocol !== "https:" || !/(^|\.)mlstatic\.com$/.test(h.hostname)) continue;   // só imagens do Mercado Livre
            try { const f = await fetch(url, { signal: AbortSignal.timeout(20000), headers: { "User-Agent": UA } }); if (!f.ok) continue;
              const ext = (h.pathname.match(/\.(jpe?g|png|webp|gif)$/i) || [, (f.headers.get("content-type") || "").split("/")[1] || "jpg"])[1].toLowerCase();
              arqs.push({ nome: `${pasta}/foto-${String(++n).padStart(2, "0")}.${ext}`, dados: Buffer.from(await f.arrayBuffer()) }); } catch (_) {}
          }
        }));
        if (!arqs.length) throw new Erro(302, "Não consegui baixar nenhuma foto desses anúncios");
        arqs.sort((x, y) => x.nome.localeCompare(y.nome)); arqs.push({ nome: "links.txt", dados: Buffer.from(links.sort().join("\n"), "utf8") });
        res.writeHead(200, { "Content-Type": "application/zip", "Content-Disposition": 'attachment; filename="fotos-anuncios.zip"' }); return res.end(zipar(arqs));
      }
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      if (p[3] === "analise") { const mid = u.searchParams.get("id"); if (!idML(mid)) throw new Erro(301, "Anúncio inválido"); return res.end(JSON.stringify(await a.analise(get, r.tok, mid, raw))); }
      const st = u.searchParams.get("status") === "paused" ? "paused" : "active";
      if (!u.searchParams.get("forcar") && CACHE_ANU[st] && Date.now() - CACHE_ANU[st].t < 60000) return res.end(JSON.stringify({ itens: CACHE_ANU[st].itens }));
      const itens = await a.anuncios(get, r.tok, st); CACHE_ANU[st] = { t: Date.now(), itens };
      return res.end(JSON.stringify({ itens }));
    }
    if (p[0] === "api" && p[1] === "fotoia") {   // aba Gerador de fotos: dados do anúncio, proxy de imagem do ML e IA gratuita
      if (p[2] === "img") {   // foto do Mercado Livre pela mesma origem (o navegador precisa disso para editar no canvas)
        let h; try { h = new URL(u.searchParams.get("u") || ""); } catch (_) { throw new Erro(301, "Endereço de imagem inválido"); }
        if (h.protocol !== "https:" || !/(^|\.)mlstatic\.com$/.test(h.hostname)) throw new Erro(301, "Só imagens do Mercado Livre");
        const f = await fetch(h.href, { signal: AbortSignal.timeout(20000), headers: { "User-Agent": UA } });
        if (!f.ok) throw new Erro(302, "Não consegui baixar a foto (" + f.status + ")");
        res.writeHead(200, { "Content-Type": f.headers.get("content-type") || "image/jpeg", "Cache-Control": "max-age=3600" }); return res.end(Buffer.from(await f.arrayBuffer()));
      }
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      if (p[2] === "status") return res.end(JSON.stringify({ restante: Math.max(0, Math.ceil((FOTOIA_ATE - Date.now()) / 1000)) }));
      if (p[2] === "anuncio") {
        const mid = u.searchParams.get("id"); if (!idML(mid)) throw new Erro(301, "Anúncio inválido");
        const { get } = await acessar("mercadolivre");
        const b = await get(`/items/${mid}?attributes=id,title,price,original_price,sold_quantity,available_quantity,pictures,attributes,shipping,warranty,permalink`);
        return res.end(JSON.stringify({ id: b.id, titulo: b.title, preco: b.price, original: b.original_price, vendidos: b.sold_quantity, estoque: b.available_quantity, link: b.permalink,
          fotos: (b.pictures || []).map(x => x.secure_url || x.url).filter(Boolean),
          attrs: (b.attributes || []).filter(x => x.value_name && !/^(ITEM_CONDITION|GTIN|SELLER_SKU|PACKAGE_|ALPHANUMERIC_MODEL)/.test(x.id)).slice(0, 14).map(x => ({ nome: x.name, valor: x.value_name })),
          frete: !!(b.shipping && b.shipping.free_shipping), logistica: (b.shipping && b.shipping.logistic_type) || "", garantia: b.warranty || "" }));
      }
      if (p[2] === "gerar" && req.method === "POST") {   // IA gratuita (Pollinations, sem chave). Se atingir o limite, avisa e guarda o prazo.
        const prompt = String((await corpo(req)).prompt || "").trim().slice(0, 600); if (!prompt) throw new Erro(301, "Descreva a cena");
        const falt = Math.ceil((FOTOIA_ATE - Date.now()) / 1000);
        if (falt > 0) throw new Erro(305, `Limite atingido. Aguarde novo prazo: ${falt}s.`, { restante: falt });
        const seed = Math.floor(Math.random() * 1e6);
        let f; try { f = await fetch(`https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&seed=${seed}&nologo=true&model=flux`, { signal: AbortSignal.timeout(40000), headers: { "User-Agent": UA } }); }
        catch (e) { throw new Erro(306, "A IA gratuita não respondeu a tempo: " + e.message); }
        const tipo = f.headers.get("content-type") || "";
        let txt = ""; if (!f.ok) { try { txt = (await f.text()).slice(0, 300); } catch (_) {} }
        if ([429, 402, 403, 503].includes(f.status) || /rate.?limit|too many|queue|quota/i.test(txt)) {
          const seg = Math.min(Math.max(Number(f.headers.get("retry-after")) || 60, 10), 900); FOTOIA_ATE = Date.now() + seg * 1000;
          throw new Erro(305, `Limite atingido. Aguarde novo prazo: ${seg}s.`, { restante: seg });
        }
        if (!f.ok || !tipo.startsWith("image/")) throw new Erro(306, "A IA gratuita não devolveu imagem (" + f.status + ")");
        return res.end(JSON.stringify({ img: `data:${tipo};base64,` + Buffer.from(await f.arrayBuffer()).toString("base64") }));
      }
    }
    if (p[0] === "api" && p[1] === "video") {   // aba Vídeos IA: roteiro persuasivo (IA gratuita) e voz da narração
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      if (p[2] === "vozes") return res.end(JSON.stringify({ vozes: await listarVozes() }));
      if (req.method !== "POST") throw new Erro(301, "Use POST em /api/video/" + (p[2] || ""));
      const b = await corpo(req);
      if (p[2] === "roteiro") {
        const d = b.d || {}, n = Math.min(Math.max(Number(b.cenas) || 6, 3), 10);
        const TOM = { amigavel: "amigável e próximo, como um vendedor de confiança", energico: "animado e cheio de energia", premium: "elegante, calmo e confiável" }[b.tom] || "amigável e próximo";
        const R = v => "R$ " + Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const fatos = ["Título do anúncio: " + String(d.titulo || "").slice(0, 160),
          d.preco > 0 ? "Preço atual: " + R(d.preco) : "", d.original > d.preco ? "Preço anterior (de): " + R(d.original) : "",
          d.vendidos > 0 ? "Unidades vendidas: " + d.vendidos : "", d.estoque > 0 && d.estoque <= 30 ? "Unidades em estoque: " + d.estoque : "",
          d.frete ? "Frete grátis: sim" : "", d.logistica === "fulfillment" ? "Envio rápido pelo Full: sim" : "", d.garantia ? "Garantia: " + String(d.garantia).slice(0, 80) : "",
          ...(Array.isArray(d.attrs) ? d.attrs.slice(0, 14).map(a => String(a.nome).slice(0, 40) + ": " + String(a.valor).slice(0, 60)) : [])].filter(Boolean).join("\n");
        const SYS = `Você é um roteirista de vídeos curtos de venda para marketplaces brasileiros. Escreva em português do Brasil claro e falado, com frases curtas (até 18 palavras) e linguagem simples. Tom: ${TOM}. Use técnicas éticas de persuasão e PNL: gancho de interrupção de padrão, ritmo e condução (afirmações verdadeiras seguidas da sugestão), linguagem sensorial, pressuposição ("quando você começar a usar..."), projeção no futuro, prova social (somente com o número real fornecido), reversão de risco (garantia, Compra Garantida, frete), contraste de preço (somente se houver preço anterior) e escassez (somente se o estoque informado for baixo), terminando com uma chamada clara para comprar. REGRAS: use SOMENTE os fatos fornecidos; nunca invente números, medidas, materiais, certificações, resultados, prazos ou promessas; não faça alegações de saúde; não use palavras em inglês; escreva preços como "R$ 49,90". Responda APENAS com JSON válido, sem texto antes ou depois, no formato {"cenas":[{"fala":"...","tecnica":"nome da técnica e uma explicação curta"}]} com exatamente ${n} cenas.`;
        let f; try {
          f = await fetch("https://text.pollinations.ai/openai", { method: "POST", signal: AbortSignal.timeout(45000), headers: { "Content-Type": "application/json", "User-Agent": UA },
            body: JSON.stringify({ model: "openai", seed: Math.floor(Math.random() * 1e6), messages: [{ role: "system", content: SYS }, { role: "user", content: `Fatos do anúncio:\n${fatos}\n\nCrie o roteiro com ${n} cenas.` }] }) });
        } catch (e) { throw new Erro(307, "A IA gratuita não respondeu a tempo: " + e.message); }
        if (!f.ok) throw new Erro(307, "A IA gratuita recusou o pedido (" + f.status + ")");
        let txt = ""; try { const j = await f.json(); txt = String((j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || ""); } catch (_) {}
        let cenas = null; try { const m = txt.match(/\{[\s\S]*\}/); cenas = JSON.parse(m ? m[0] : "{}").cenas; } catch (_) {}
        cenas = (Array.isArray(cenas) ? cenas : []).map(c => ({ fala: String((c && c.fala) || "").replace(/\s+/g, " ").trim().slice(0, 260), tecnica: String((c && c.tecnica) || "").trim().slice(0, 160) })).filter(c => c.fala.length > 4).slice(0, n);
        if (cenas.length < 2) throw new Erro(307, "A IA devolveu um roteiro fora do formato. Tente de novo ou use o roteiro rápido.");
        return res.end(JSON.stringify({ cenas }));
      }
      if (p[2] === "voz") {   // devolve o áudio de um trecho curto; o navegador junta tudo no vídeo. voz = "win:Nome" | "ia:nova" | "google"
        const voz = String(b.voz || (b.motor === "ia" ? "ia:nova" : "google")), tipoV = voz.split(":")[0], nomeV = voz.slice(tipoV.length + 1);
        const texto = String(b.texto || "").replace(/\s+/g, " ").trim().slice(0, tipoV === "google" ? 190 : 400);
        if (!texto) throw new Erro(301, "Sem texto para narrar");
        if (tipoV === "win") { const wav = await sintetizarWin(nomeV, texto); return res.end(JSON.stringify({ audio: wav.toString("base64"), tipo: "audio/wav" })); }
        const url = tipoV === "ia" ? `https://text.pollinations.ai/${encodeURIComponent("Leia em voz alta, exatamente, em português do Brasil, com sotaque brasileiro, sem acrescentar nada: " + texto)}?model=openai-audio&voice=${encodeURIComponent(/^[a-z]+$/.test(nomeV) ? nomeV : "nova")}`
          : `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=pt-BR&q=${encodeURIComponent(texto)}`;
        let f; try { f = await fetch(url, { signal: AbortSignal.timeout(40000), headers: { "User-Agent": "Mozilla/5.0", "Referer": "https://translate.google.com/" } }); }
        catch (e) { throw new Erro(308, "A voz online não respondeu: " + e.message); }
        const tipo = f.headers.get("content-type") || "", buf = Buffer.from(await f.arrayBuffer());
        if (!f.ok || !/audio|mpeg|octet/i.test(tipo) || buf.length < 800) throw new Erro(308, "A voz online não devolveu áudio (" + f.status + ")");
        return res.end(JSON.stringify({ audio: buf.toString("base64"), tipo: tipo.split(";")[0] }));
      }
    }
    if (p[0] === "api" && p[1] === "impressoras") {   // GET lista + escolhida · POST {nome} grava ("" = padrão do Windows)
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      if (req.method === "POST") {
        const nome = String((await corpo(req)).nome || "").trim();
        if (nome && !listarImpressoras().some(x => x.nome === nome)) throw new Erro(304, "Essa impressora não está instalada neste computador");
        fs.writeFileSync(ARQ_IMP, nome); return res.end(JSON.stringify({ ok: true, escolhida: nome }));
      }
      return res.end(JSON.stringify({ escolhida: impAtual(), impressoras: listarImpressoras() }));
    }
    if (p[0] === "api" && p[1] === "pendencias" && p[2] === "mercadolivre") {   // o que os agentes encontraram e precisa de decisão
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      const { r, get, raw } = await acessar("mercadolivre"); return res.end(JSON.stringify(await pendenciasML(get, raw, r.tok)));
    }
    if (p[0] === "api" && p[1] === "executar" && p[2] === "mercadolivre" && req.method === "POST") {   // só roda depois do "Aprovar" no painel
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      const { post } = await acessar("mercadolivre"); const msg = await executarML(post, await corpo(req));
      diag("ação aprovada e executada: " + msg);
      return res.end(JSON.stringify({ ok: true, msg }));
    }
    if (p[0] === "api" && p[1] === "etiquetas" && p[2]) {   // lista e PDF das etiquetas de envio (Mercado Livre)
      const id = p[2]; if (id !== "mercadolivre") throw new Erro(301, "Etiquetas: só o Mercado Livre está disponível nesta versão");
      const { a, r, get, raw } = await acessar(id);
      if ((p[3] === "pdf" || p[3] === "imprimir") && req.method === "POST") {
        const ids = ((await corpo(req)).ids || []).map(String).filter(x => /^\d+$/.test(x)).slice(0, 50);
        if (!ids.length) throw new Erro(301, "Nenhuma etiqueta selecionada");
        const rr = await raw(`/shipment_labels?shipment_ids=${ids.join(",")}&response_type=pdf`);
        const buf = Buffer.from(await rr.arrayBuffer());
        if (rr.ok && buf.subarray(0, 4).toString() === "%PDF") {
          if (p[3] === "imprimir") { const quem = await imprimirPdf(buf); res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" }); return res.end(JSON.stringify({ ok: true, impressora: quem, qtd: ids.length })); }
          res.writeHead(200, { "Content-Type": "application/pdf", "Content-Disposition": 'inline; filename="etiquetas.pdf"' }); return res.end(buf);
        }
        let det = ""; try { const j = JSON.parse(buf.toString()); det = String(j.message || j.error || JSON.stringify(j)).slice(0, 200); } catch (_) {}
        throw new Erro(rr.status === 401 || rr.status === 403 ? 204 : 302, `O Mercado Livre não gerou a etiqueta (${rr.status})${det ? ": " + det : ""}`);
      }
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      if (!u.searchParams.get("forcar") && CACHE_ETQ.itens && Date.now() - CACHE_ETQ.t < 45000) return res.end(JSON.stringify({ itens: CACHE_ETQ.itens }));
      const itens = await a.etiquetas(get, r.tok, raw); CACHE_ETQ.itens = itens; CACHE_ETQ.t = Date.now();
      return res.end(JSON.stringify({ itens }));
    }
    if (p[0] === "api" && p[1] === "fotos" && p[2] === "lista") {   // aba Estúdio de fotos
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      if (!u.searchParams.get("forcar") && CACHE_FTS.itens && Date.now() - CACHE_FTS.t < 60000) return res.end(JSON.stringify({ itens: CACHE_FTS.itens }));
      const { r, get } = await acessar("mercadolivre");
      CACHE_FTS.itens = await listarFotos(get, r.tok.uid); CACHE_FTS.t = Date.now();
      return res.end(JSON.stringify({ itens: CACHE_FTS.itens }));
    }
    if (p[0] === "api" && p[1] === "clientes") {   // cadastro de clientes (aba Clientes)
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      if (p[2] === "sincronizar" && req.method === "POST") return res.end(JSON.stringify(await sincronizarClientes(Math.min(Number(u.searchParams.get("limite")) || 300, 1000))));
      if (!p[2] && req.method === "GET") return res.end(JSON.stringify({ clientes: lerCli() }));
      if (!p[2] && req.method === "POST") {
        const b = await corpo(req), d = limpaCli(b), lista = lerCli();
        if (!d.nome && !d.apelido) throw new Erro(301, "Informe pelo menos o nome ou o apelido do cliente.");
        let reg = b.id && lista.find(x => x.id === String(b.id));
        if (reg) Object.assign(reg, d, { atualizado: new Date().toISOString() });
        else { reg = { id: novoIdCli(), mlId: "", criado: new Date().toISOString(), pedidos: [], ...d }; lista.push(reg); }
        gravarCli(lista); return res.end(JSON.stringify({ ok: true, cliente: reg }));
      }
      if (p[2] && req.method === "DELETE") { gravarCli(lerCli().filter(x => x.id !== p[2])); return res.end(JSON.stringify({ ok: true })); }
    }
    if (p[0] === "api" && (p[1] === "conexoes" || p[1] === "dados")) {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      if (p[1] === "conexoes" && !p[2]) return res.end(JSON.stringify(lista()));
      const id = p[2];
      if (!CAT[id]) throw new Erro(301, "Plataforma desconhecida");
      if (p[1] === "conexoes" && req.method === "POST" && !p[3]) {
        const b = await corpo(req), d = lerDB(), r = d[id] || (d[id] = {}); r.cred = r.cred || {};
        for (const [k] of CAT[id].campos) if (b[k]) r.cred[k] = String(b[k]).trim();
        gravarDB(d); return res.end(JSON.stringify({ ok: true }));
      }
      if (p[1] === "conexoes" && req.method === "DELETE") { const d = lerDB(); delete d[id]; gravarDB(d); return res.end(JSON.stringify({ ok: true })); }
      if (p[1] === "conexoes" && p[3] === "testar") { const { a, get } = await acessar(id); const d = lerDB(); d[id].conta = await a.conta(get); delete d[id].erro; gravarDB(d); return res.end(JSON.stringify({ ok: true, conta: d[id].conta })); }
      if (p[1] === "dados") { const { a, r, get } = await acessar(id); return res.end(JSON.stringify({ resumo: await a.dados(get, r.tok) })); }
    }
    if (p[0] === "api") throw new Erro(301, "Rota desconhecida: /" + p.join("/"));   // /api/* nunca devolve a página
  } catch (e) { if (!res.headersSent) res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" }); return falha(res, e, req.method + " " + String(req.url || "").split("?")[0]); }
  fs.readFile(path.join(__dirname, "index.html"), (erro, dados) => {
    if (erro) { res.writeHead(500); return res.end("index.html não encontrado"); }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }); res.end(dados);
  });
});
srv.on("error", e => { if (e.code === "EADDRINUSE") { console.log("A Central já está aberta (porta " + PORTA + " em uso)."); process.exit(2); } throw e; });
srv.listen(PORTA, "127.0.0.1", () => console.log("Automação IA MS importadora em " + BASE + "  [versão " + VERSAO + "]  (deixe esta janela aberta)"));
