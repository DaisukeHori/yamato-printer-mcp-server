#!/usr/bin/env bash
# =============================================================
# yamato-printer-mcp-server セットアップスクリプト
#
# Raspberry Pi Zero 2 W (Raspberry Pi OS Lite 64-bit) 向け
#
# 実行手順:
#   git clone https://github.com/DaisukeHori/yamato-printer-mcp-server.git
#   cd yamato-printer-mcp-server
#   sudo ./scripts/setup-pi.sh
#
# オプション:
#   --longevity   microSD 延命設定も併せて適用
#   --no-service  systemd サービスの有効化をスキップ
# =============================================================

set -e  # エラー時即終了
set -u  # 未定義変数エラー

# =============================================================
# 設定
# =============================================================

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALL_USER="${SUDO_USER:-pi}"
NODE_MAJOR_VERSION=20

APPLY_LONGEVITY=false
SKIP_SERVICE=false

# 引数解析
for arg in "$@"; do
  case "$arg" in
    --longevity) APPLY_LONGEVITY=true ;;
    --no-service) SKIP_SERVICE=true ;;
    *) echo "Unknown option: $arg"; exit 1 ;;
  esac
done

# =============================================================
# ヘルパー
# =============================================================

log() {
  echo -e "\033[1;32m[SETUP]\033[0m $*"
}

warn() {
  echo -e "\033[1;33m[WARN]\033[0m $*" >&2
}

err() {
  echo -e "\033[1;31m[ERROR]\033[0m $*" >&2
  exit 1
}

# root実行チェック
if [[ $EUID -ne 0 ]]; then
  err "このスクリプトは sudo で実行してください: sudo $0"
fi

# =============================================================
# 1. 前提ソフトのインストール
# =============================================================

log "APT パッケージ更新・基本ツールインストール"
apt-get update
apt-get install -y \
  curl \
  ca-certificates \
  gnupg \
  build-essential \
  python3 \
  git \
  sqlite3 \
  libvips-dev \
  libsqlite3-dev \
  dbus

# =============================================================
# 2. Node.js v20 LTS インストール (NodeSource)
# =============================================================

if ! command -v node >/dev/null 2>&1 || [[ "$(node -v)" != v${NODE_MAJOR_VERSION}* ]]; then
  log "Node.js v${NODE_MAJOR_VERSION} LTS をインストール"
  curl -fsSL https://deb.nodesource.com/setup_${NODE_MAJOR_VERSION}.x | bash -
  apt-get install -y nodejs
else
  log "Node.js v${NODE_MAJOR_VERSION} 既にインストール済み: $(node -v)"
fi

# =============================================================
# 3. usblp カーネルモジュールの自動ロード設定
# =============================================================

log "usblp カーネルモジュールを自動ロード設定"

# /etc/modules に追記 (重複回避)
if ! grep -q "^usblp$" /etc/modules; then
  echo "usblp" >> /etc/modules
  log "  /etc/modules に usblp を追記"
else
  log "  /etc/modules に usblp は既に設定済み"
fi

# 即時ロード
modprobe usblp || warn "usblp のロードに失敗 (プリンタ未接続でも後で動作します)"

# =============================================================
# 4. lp グループに実行ユーザーを追加
# =============================================================

log "ユーザー '${INSTALL_USER}' を 'lp' グループに追加"
usermod -aG lp "${INSTALL_USER}" || warn "グループ追加失敗"

# =============================================================
# 5. CUPS との競合回避
# =============================================================

if systemctl is-active --quiet cups; then
  warn "CUPS が起動中です。/dev/usb/lp0 が掴まれる可能性があります。"
  warn "  → 競合する場合は: sudo systemctl disable --now cups"
fi

# =============================================================
# 6. 依存パッケージのインストール (npm)
# =============================================================

log "npm 依存関係をインストール (作業ディレクトリ: ${REPO_DIR})"
cd "${REPO_DIR}"

# Pi Zero 2 W のRAMを節約するためスワップを一時増加 (sharp のネイティブビルド用)
CURRENT_SWAP_MB=$(free -m | awk '/^Swap:/ {print $2}')
if [[ ${CURRENT_SWAP_MB} -lt 1024 ]]; then
  log "  ビルド時のメモリ不足回避のため一時的にスワップ拡張 (既存: ${CURRENT_SWAP_MB}MB → 1024MB)"
  if [[ -f /etc/dphys-swapfile ]]; then
    sed -i 's/^CONF_SWAPSIZE=.*/CONF_SWAPSIZE=1024/' /etc/dphys-swapfile
    dphys-swapfile swapoff || true
    dphys-swapfile setup || true
    dphys-swapfile swapon || true
  fi
fi

# 権限切り替えて install & build
sudo -u "${INSTALL_USER}" bash <<EOF
cd "${REPO_DIR}"
npm ci
npm run build
EOF

# =============================================================
# 7. 環境変数ファイル
# =============================================================

if [[ ! -f "${REPO_DIR}/.env" ]]; then
  log ".env が存在しないため .env.example からコピー"
  sudo -u "${INSTALL_USER}" cp "${REPO_DIR}/.env.example" "${REPO_DIR}/.env"

  # MCP_API_KEY を自動生成
  if command -v openssl >/dev/null 2>&1; then
    NEW_KEY=$(openssl rand -hex 32)
    sudo -u "${INSTALL_USER}" sed -i "s|^MCP_API_KEY=.*|MCP_API_KEY=${NEW_KEY}|" "${REPO_DIR}/.env"
    log "  MCP_API_KEY を自動生成しました: ${NEW_KEY}"
    log "  (このキーは .env に保存済み、Claude.ai のコネクタ設定に使用してください)"
  else
    warn "  openssl が無いため MCP_API_KEY を自動生成できませんでした"
    warn "  .env を編集して MCP_API_KEY を設定してください"
  fi
else
  log ".env は既に存在"
fi

# =============================================================
# 8. ジョブDBディレクトリ作成
# =============================================================

log "ジョブDBディレクトリを作成"
mkdir -p /var/lib/yamato-printer-mcp
chown "${INSTALL_USER}":"${INSTALL_USER}" /var/lib/yamato-printer-mcp

# =============================================================
# 9. cloudflared インストール
# =============================================================

if ! command -v cloudflared >/dev/null 2>&1; then
  log "cloudflared をインストール"
  ARCH=$(dpkg --print-architecture)
  TMPDEB=/tmp/cloudflared.deb
  curl -fsSL "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${ARCH}.deb" -o "${TMPDEB}"
  dpkg -i "${TMPDEB}"
  rm -f "${TMPDEB}"
else
  log "cloudflared 既にインストール済み: $(cloudflared --version 2>&1 | head -1)"
fi

# =============================================================
# 10. systemd サービスの登録
# =============================================================

if [[ "${SKIP_SERVICE}" != "true" ]]; then
  log "systemd ユニットをインストール"

  # WorkingDirectory と実行パスを現在のREPO_DIRに合わせて書き換え
  sed \
    -e "s|/home/pi/yamato-printer-mcp-server|${REPO_DIR}|g" \
    -e "s|^User=pi|User=${INSTALL_USER}|g" \
    "${REPO_DIR}/systemd/yamato-printer-mcp.service" \
    > /etc/systemd/system/yamato-printer-mcp.service

  systemctl daemon-reload
  systemctl enable yamato-printer-mcp.service

  log "  サービス有効化完了"
  log "  起動するには: sudo systemctl start yamato-printer-mcp"
  log "  ログ確認は  : journalctl -u yamato-printer-mcp -f"
else
  log "--no-service 指定のため systemd サービス登録をスキップ"
fi

# =============================================================
# 11. microSD 延命設定 (オプション)
# =============================================================

if [[ "${APPLY_LONGEVITY}" == "true" ]]; then
  log "microSD 延命設定を適用"
  bash "${REPO_DIR}/scripts/microsd-longevity.sh"
fi

# =============================================================
# 完了メッセージ
# =============================================================

echo ""
log "========================================================"
log "セットアップ完了"
log "========================================================"
log "次のステップ:"
log "  1. プリンタをUSB接続し dmesg | grep usblp で認識確認"
log "  2. 素のTSPLで動作確認:"
log "     echo -e 'SIZE 100 mm,150 mm\\r\\nCLS\\r\\nTEXT 50,50,\"3\",0,1,1,\"HELLO\"\\r\\nPRINT 1,1\\r\\n' | sudo tee /dev/usb/lp0"
log "  3. Cloudflare Tunnel 設定:"
log "     cloudflared tunnel login"
log "     cloudflared tunnel create yamato-printer"
log "     cp cloudflared/config.yml.example ~/.cloudflared/config.yml"
log "     (config.yml を編集)"
log "     cloudflared tunnel route dns yamato-printer yamato-printer.appserver.tokyo"
log "     sudo systemctl enable --now cloudflared"
log "  4. サービス起動:"
log "     sudo systemctl start yamato-printer-mcp"
log "  5. Claude.ai にMCPコネクタとして追加 (READMEの手順参照)"
log ""
log "重要: グループ変更を反映するため、一度ログアウト/ログインしてください"
log "========================================================"
