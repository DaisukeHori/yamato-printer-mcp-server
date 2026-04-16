#!/usr/bin/env bash
# =============================================================
# microSD 延命設定スクリプト
#
# Raspberry Pi の microSD カードは書き込み回数の制限があり、
# 24時間365日稼働では数ヶ月で破損する可能性がある。
# このスクリプトは以下の対策を適用してSDへの書き込みを削減する:
#
#   1. /var/log を tmpfs (RAM) 化
#   2. /tmp も tmpfs化 (デフォルトで tmpfs の場合はスキップ)
#   3. swap 無効化
#   4. ファイルシステムの noatime, nodiratime マウント
#   5. journald のストレージを volatile に
#   6. apt の日次アップデートを無効化
#
# 実行:
#   sudo ./scripts/microsd-longevity.sh
# =============================================================

set -e
set -u

if [[ $EUID -ne 0 ]]; then
  echo "Error: sudo で実行してください"
  exit 1
fi

log() {
  echo -e "\033[1;32m[LONGEVITY]\033[0m $*"
}

warn() {
  echo -e "\033[1;33m[WARN]\033[0m $*" >&2
}

# =============================================================
# 1. /var/log を tmpfs 化
# =============================================================

log "/var/log を tmpfs 化 (RAM 40MB)"

if ! grep -q "^tmpfs /var/log" /etc/fstab; then
  cat >> /etc/fstab <<'EOF'

# microSD 延命: /var/log を tmpfs に (yamato-printer-mcp-server/microsd-longevity.sh)
tmpfs /var/log tmpfs defaults,noatime,nosuid,nodev,size=40m 0 0
EOF
  log "  /etc/fstab に追記"
else
  log "  /var/log tmpfs エントリは既に存在"
fi

# =============================================================
# 2. /tmp を tmpfs 化 (未設定の場合のみ)
# =============================================================

if ! mount | grep -q "on /tmp type tmpfs"; then
  if ! grep -q "^tmpfs /tmp" /etc/fstab; then
    cat >> /etc/fstab <<'EOF'

# microSD 延命: /tmp を tmpfs に
tmpfs /tmp tmpfs defaults,noatime,nosuid,nodev,size=100m 0 0
EOF
    log "  /tmp を tmpfs 化"
  fi
else
  log "  /tmp は既に tmpfs"
fi

# =============================================================
# 3. swap 無効化 (SDカードのスワップは最悪。RAM不足時はOOMキラー任せ)
# =============================================================

log "swap を無効化"
if systemctl is-enabled --quiet dphys-swapfile 2>/dev/null; then
  dphys-swapfile swapoff || true
  systemctl disable --now dphys-swapfile || true
  log "  dphys-swapfile を無効化"
fi

# /etc/dphys-swapfile の CONF_SWAPSIZE=0 化
if [[ -f /etc/dphys-swapfile ]]; then
  sed -i 's/^CONF_SWAPSIZE=.*/CONF_SWAPSIZE=0/' /etc/dphys-swapfile
fi

# =============================================================
# 4. noatime マウント (rootfs)
# =============================================================

log "rootfs の noatime オプション追加"
if grep -q "^PARTUUID=.*\s/\s" /etc/fstab && ! grep -q "^PARTUUID=.*\s/\s.*noatime" /etc/fstab; then
  sed -i '/^PARTUUID=.*\s\/\s/s/defaults/defaults,noatime,nodiratime,commit=60/' /etc/fstab
  log "  noatime,nodiratime,commit=60 を rootfs に追加"
else
  log "  rootfs は既にnoatime設定済み、または PARTUUID ルート行が見つからず"
fi

# =============================================================
# 5. journald を volatile に (ログをRAMだけに保持)
# =============================================================

log "systemd-journald を volatile モードに"
mkdir -p /etc/systemd/journald.conf.d
cat > /etc/systemd/journald.conf.d/longevity.conf <<'EOF'
[Journal]
Storage=volatile
RuntimeMaxUse=20M
ForwardToSyslog=no
EOF
log "  /etc/systemd/journald.conf.d/longevity.conf 作成"

# =============================================================
# 6. apt の自動アップデートを無効化
# =============================================================

if systemctl list-unit-files | grep -q "^apt-daily"; then
  log "apt-daily と apt-daily-upgrade を無効化 (手動更新に)"
  systemctl disable --now apt-daily.timer || true
  systemctl disable --now apt-daily-upgrade.timer || true
  log "  → 更新したいときは手動で: sudo apt-get update && sudo apt-get upgrade"
fi

# =============================================================
# 7. rsyslog を停止 (journald があるので二重ログ不要)
# =============================================================

if systemctl is-active --quiet rsyslog 2>/dev/null; then
  log "rsyslog を停止 (journald のみ使用)"
  systemctl disable --now rsyslog || true
fi

# =============================================================
# 8. logrotate の頻度を下げる (tmpfs化で不要だが念のため)
# =============================================================

if [[ -d /etc/logrotate.d ]]; then
  log "logrotate: 日次→週次化 (念のため)"
  # 既にtmpfsだから意味ないが、何らかの理由で永続ログがある場合に備える
  if [[ -f /etc/logrotate.conf ]]; then
    sed -i 's/^daily$/weekly/' /etc/logrotate.conf || true
  fi
fi

# =============================================================
# 完了
# =============================================================

echo ""
log "========================================================"
log "microSD 延命設定 完了"
log "========================================================"
log "適用された設定:"
log "  ✓ /var/log を tmpfs 化"
log "  ✓ /tmp を tmpfs 化"
log "  ✓ swap 無効化"
log "  ✓ rootfs に noatime,nodiratime,commit=60"
log "  ✓ systemd-journald を volatile に (RAM 20MB)"
log "  ✓ apt-daily, apt-daily-upgrade 無効化"
log "  ✓ rsyslog 停止"
log ""
log "⚠️  変更を反映するには再起動してください: sudo reboot"
log ""
log "注意:"
log "  - ログは再起動で消えます (journalctl でライブ確認してください)"
log "  - apt パッケージ更新は手動実行が必要になります"
log "  - swap 無効化によりメモリ不足時にOOM Kill される可能性があります"
log "========================================================"
