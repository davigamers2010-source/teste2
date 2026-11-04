// Abre um endereço HTTPS público que encaminha para a Central e grava o Redirect URI na conta Maicon.
// Se existir ngrok-dominio.txt, usa o domínio FIXO do ngrok; senão, usa um túnel temporário da Cloudflare.
const { spawn, spawnSync } = require("child_process"), fs = require("fs"), path = require("path");
const PASTA_DADOS = path.resolve(process.env.ACCOUNT_DATA_DIR || path.join(__dirname, "dados-contas"));
const ARQ = path.join(PASTA_DADOS, "maicon", "conectores.json"), DOM = path.join(__dirname, "ngrok-dominio.txt"), PORTA = 3100;
function achar(lista) {
  const pacotes = path.join(process.env.LOCALAPPDATA || "", "Microsoft", "WinGet", "Packages");
  try {
    for (const p of fs.readdirSync(pacotes)) if (/^Ngrok\.Ngrok_/i.test(p)) lista.push(path.join(pacotes, p, "ngrok.exe"));
  } catch (_) {}
  return lista.find(c => { try { return spawnSync(c, ["--version"], { stdio: "ignore" }).status === 0; } catch (_) { return false; } });
}

function gravarRedirect(uri) {
  let db = {};
  try { db = JSON.parse(fs.readFileSync(ARQ, "utf8")); } catch (e) { if (e.code !== "ENOENT") throw e; }
  const shopeeUri = new URL(uri); shopeeUri.pathname = "/oauth/shopee"; shopeeUri.search = ""; shopeeUri.hash = "";
  db.mercadolivre = db.mercadolivre || {}; db.mercadolivre.cred = db.mercadolivre.cred || {};
  db.mercadolivre.cred.redirect_uri = uri;
  db.shopee = db.shopee || {}; db.shopee.cred = db.shopee.cred || {};
  db.shopee.cred.redirect_uri = shopeeUri.toString();
  fs.mkdirSync(path.dirname(ARQ), { recursive: true });
  fs.writeFileSync(ARQ + ".tmp", JSON.stringify(db, null, 2)); fs.renameSync(ARQ + ".tmp", ARQ);
}
function aviso(uri, fixo) {
  const shopeeUri = new URL(uri); shopeeUri.pathname = "/oauth/shopee"; shopeeUri.search = ""; shopeeUri.hash = "";
  try { spawnSync("clip", { input: uri + "\r\n" + shopeeUri.toString() }); } catch (_) {}
  console.log("\n==================================================================");
  console.log(" TUNEL PRONTO. Redirect URIs (copiados para a area de transferencia):\n");
  console.log(" Mercado Livre: " + uri);
  console.log(" Shopee:       " + shopeeUri.toString() + "\n");
  console.log(" Cadastre cada endereco no app correspondente: o primeiro no Mercado Livre e o segundo na Shopee.");
  console.log(" Depois, na Central (http://localhost:3100), clique em Autorizar na conexao que deseja usar.");
  if (fixo) console.log(" Se o ngrok mostrar 'You are about to visit...', clique em 'Visit Site'.");
  console.log(" Deixe esta janela ABERTA durante a autorizacao.");
  console.log("==================================================================\n");
}

function ngrok(dominio, flag = "--domain") {
  const exe = achar(["ngrok", path.join(process.env.LOCALAPPDATA || "", "Microsoft", "WinGet", "Links", "ngrok.exe")]);
  if (!exe) { console.log("ngrok nao encontrado. Abra o configurar-ngrok.bat."); process.exit(1); }
  const uri = `https://${dominio}/oauth/mercadolivre`;
  const t = spawn(exe, ["http", flag + "=" + dominio, String(PORTA), "--log=stdout", "--log-format=logfmt"]);
  let buf = "", ok = false;
  const ler = d => { buf += String(d); if (buf.length > 20000) buf = buf.slice(-10000); };
  t.stdout.on("data", ler); t.stderr.on("data", ler);
  t.on("exit", c => {
    if (!ok && c !== 0 && flag === "--domain" && /unknown flag|unknown shorthand|flag provided but not defined/i.test(buf)) {
      console.log("Versao antiga do ngrok: tentando com --url..."); return ngrok(dominio, "--url");
    }
    if (c !== 0 || !ok) {
      console.log("\n[ngrok] Ultimas mensagens:\n" + buf.trim().split("\n").slice(-15).join("\n"));
      if (/ERR_NGROK_121|minimum supported agent version|version .* too old/i.test(buf)) console.log("\n=> O agente ngrok esta desatualizado. Execute `ngrok update` e abra este iniciador novamente.");
      else if (/ERR_NGROK_320\b|domain is reserved for another account/i.test(buf)) console.log("\n=> O token autenticado pertence a outra conta ngrok. O dominio " + dominio + " esta reservado em uma conta diferente.\n   Configure o authtoken da conta que reservou esse dominio: ngrok config add-authtoken TOKEN_DA_CONTA_CORRETA\n   Ou reserve um dominio na conta atual, atualize ngrok-dominio.txt e cadastre o novo Redirect URI no app do Mercado Livre.\n   Nao compartilhe seu authtoken.");
      else if (/ERR_NGROK_4018|not authenticated/i.test(buf)) console.log("\n=> Falta autenticar o ngrok neste computador. Abra o PowerShell e execute: ngrok config add-authtoken SEU_TOKEN\n   Obtenha o token em https://dashboard.ngrok.com/get-started/your-authtoken. Nao envie o token pelo chat.");
      else if (/authtoken|authentication|ERR_NGROK_10[0-9]/i.test(buf)) console.log("\n=> O token do ngrok e invalido ou expirou. Configure novamente com: ngrok config add-authtoken SEU_TOKEN.");
      if (/ERR_NGROK_334|already online|ERR_NGROK_108|limited to 1|simultaneous/i.test(buf)) console.log("\n=> Ja existe outro ngrok aberto (nesta ou em outra conta/maquina). Feche-o: Gerenciador de Tarefas > finalize ngrok.exe.");
      if (/ERR_NGROK_3200|ERR_NGROK_314|reserved domain/i.test(buf)) console.log("\n=> Confira se o dominio em ngrok-dominio.txt e o do seu painel (ngrok.com > Domains).");
      if (!/ERR_NGROK_121|minimum supported agent version|version .* too old/i.test(buf) && /update|too old|minimum/i.test(buf)) console.log("\n=> Tente atualizar o ngrok: ngrok update");
    }
    console.log("ngrok encerrado (codigo " + c + ").");
    process.exit(0);
  });
  let n = 0;
  const iv = setInterval(async () => {
    n++;
    try {
      const j = await (await fetch("http://127.0.0.1:4040/api/tunnels")).json();
      if ((j.tunnels || []).some(x => (x.public_url || "").includes(dominio))) { ok = true; clearInterval(iv); gravarRedirect(uri); aviso(uri, true); return; }
    } catch (_) {}
    if (n > 25) { clearInterval(iv); console.log("O ngrok nao confirmou o tunel em 25s. Ultimas mensagens:\n" + buf.trim().split("\n").slice(-10).join("\n")); }
  }, 1000);
}

function cloudflare() {
  const exe = achar(["cloudflared",
    (process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)") + "\\cloudflared\\cloudflared.exe",
    (process.env.ProgramFiles || "C:\\Program Files") + "\\cloudflared\\cloudflared.exe"]);
  if (!exe) { console.log("cloudflared nao encontrado. Feche esta janela e abra iniciar-com-tunel.bat novamente."); process.exit(1); }
  let pronto = false;
  const t = spawn(exe, ["tunnel", "--url", "http://localhost:" + PORTA, "--no-autoupdate"]);
  const ler = d => {
    const m = !pronto && String(d).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (!m) return;
    pronto = true; const uri = m[0] + "/oauth/mercadolivre"; gravarRedirect(uri); aviso(uri, false);
  };
  t.stdout.on("data", ler); t.stderr.on("data", ler);
  t.on("exit", () => { console.log("Tunel encerrado."); process.exit(0); });
  setTimeout(() => { if (!pronto) console.log("Ainda aguardando o tunel... verifique sua internet/antivirus."); }, 30000);
}

const dominio = fs.existsSync(DOM) ? fs.readFileSync(DOM, "utf8").trim() : "";
if (dominio) ngrok(dominio); else cloudflare();
