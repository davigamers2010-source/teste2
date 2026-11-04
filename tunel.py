import json
import os
import re
import shutil
import socket
import subprocess
import sys
import time
from pathlib import Path


PASTA = Path(__file__).resolve().parent
PASTA_DADOS = Path(os.environ.get("ACCOUNT_DATA_DIR") or PASTA / "dados-contas").resolve()
ARQUIVO_CONECTORES = PASTA_DADOS / "maicon" / "conectores.json"
PORTA = 3100
PADROES_CLOUDFLARED = [
    Path(os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)")) / "cloudflared" / "cloudflared.exe",
    Path(os.environ.get("ProgramFiles", r"C:\Program Files")) / "cloudflared" / "cloudflared.exe",
    Path(os.environ.get("LOCALAPPDATA", "")) / "Microsoft" / "WinGet" / "Links" / "cloudflared.exe",
]


def localizar_cloudflared():
    encontrado = shutil.which("cloudflared")
    if encontrado:
        return encontrado
    for caminho in PADROES_CLOUDFLARED:
        if caminho.is_file():
            return str(caminho)
    raise RuntimeError(
        "Não encontrei o Cloudflare Tunnel. Execute iniciar-com-tunel.bat "
        "novamente para tentar instalar."
    )


def aguardar_central():
    limite = time.monotonic() + 30
    while time.monotonic() < limite:
        try:
            with socket.create_connection(("127.0.0.1", PORTA), timeout=1):
                return
        except OSError:
            time.sleep(1)
    raise RuntimeError(
        "A Central não respondeu na porta 3100. Confira a janela do iniciar.bat."
    )


def salvar_redirects(uri_mercadolivre):
    uri_shopee = uri_mercadolivre.rsplit("/", 1)[0] + "/shopee"
    ARQUIVO_CONECTORES.parent.mkdir(parents=True, exist_ok=True)
    if ARQUIVO_CONECTORES.exists():
        banco = json.loads(ARQUIVO_CONECTORES.read_text(encoding="utf-8-sig"))
    else:
        banco = {}

    mercado = banco.setdefault("mercadolivre", {}).setdefault("cred", {})
    shopee = banco.setdefault("shopee", {}).setdefault("cred", {})
    mercado["redirect_uri"] = uri_mercadolivre
    shopee["redirect_uri"] = uri_shopee

    temporario = ARQUIVO_CONECTORES.with_suffix(".json.tmp")
    temporario.write_text(
        json.dumps(banco, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    temporario.replace(ARQUIVO_CONECTORES)
    return uri_shopee


def copiar_enderecos(texto):
    clip = shutil.which("clip")
    if not clip:
        print("Não encontrei o comando clip; copie os endereços exibidos nesta janela.")
        return
    try:
        subprocess.run(
            [clip],
            input=texto,
            text=True,
            encoding="utf-8",
            check=True,
            timeout=5,
        )
    except (OSError, subprocess.SubprocessError) as erro:
        print(f"Não consegui copiar os endereços automaticamente: {erro}")


def main():
    aguardar_central()
    executavel = localizar_cloudflared()
    print("Iniciando Cloudflare Tunnel para a Central...")
    processo = subprocess.Popen(
        [executavel, "tunnel", "--url", f"http://localhost:{PORTA}", "--no-autoupdate"],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        bufsize=1,
    )
    pronto = False
    try:
        if processo.stdout is None:
            raise RuntimeError("Não foi possível ler as mensagens do Cloudflare Tunnel.")
        for linha in processo.stdout:
            print(linha, end="", flush=True)
            if pronto:
                continue
            resultado = re.search(
                r"https://[a-z0-9-]+\.trycloudflare\.com", linha, re.IGNORECASE
            )
            if resultado:
                uri_mercadolivre = resultado.group(0) + "/oauth/mercadolivre"
                uri_shopee = salvar_redirects(uri_mercadolivre)
                copiar_enderecos(uri_mercadolivre + "\r\n" + uri_shopee)
                print("\n==============================================")
                print("TÚNEL PRONTO. Redirect URIs:")
                print(f"Mercado Livre: {uri_mercadolivre}")
                print(f"Shopee:        {uri_shopee}")
                print("Cadastre cada endereço no aplicativo correspondente.")
                print("Depois clique em Autorizar na aba Conexões da Central.")
                print("Mantenha esta janela aberta durante a autorização.")
                print("==============================================\n")
                pronto = True

        codigo = processo.wait()
        if codigo:
            raise RuntimeError(f"O Cloudflare Tunnel foi encerrado com código {codigo}.")
        if not pronto:
            raise RuntimeError("O túnel encerrou antes de fornecer um endereço público.")
    except KeyboardInterrupt:
        print("\nEncerrando o Cloudflare Tunnel...")
        processo.terminate()
        processo.wait(timeout=10)
    finally:
        if processo.poll() is None:
            processo.terminate()
            processo.wait(timeout=10)


if __name__ == "__main__":
    try:
        main()
    except (OSError, RuntimeError, json.JSONDecodeError, subprocess.SubprocessError) as erro:
        print(f"\nERRO: {erro}", file=sys.stderr)
        sys.exit(1)
