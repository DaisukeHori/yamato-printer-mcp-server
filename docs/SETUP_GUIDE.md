# 🎒 超詳細セットアップガイド

このガイドは **「プログラミングもLinuxもやったことない人」** を対象に書かれています。書いてある通りに順番にコピペしていけば、誰でもAIから送り状が印刷できる環境が完成します。

**所要時間**: 最初のセットアップで約2〜3時間。慣れれば30分。

---

## 📖 目次

1. [最初に知っておくこと](#1-最初に知っておくこと)
2. [用意するもの(買い物リスト)](#2-用意するもの買い物リスト)
3. [STEP 1: microSDカードに OS を書き込む](#step-1-microsdカードに-os-を書き込む)
4. [STEP 2: 電源を入れて接続確認する](#step-2-電源を入れて接続確認する)
5. [STEP 3: Raspberry Pi に SSH で接続する](#step-3-raspberry-pi-に-ssh-で接続する)
6. [STEP 4: このプロジェクトをインストールする](#step-4-このプロジェクトをインストールする)
7. [STEP 5: プリンタを接続してテスト印刷する](#step-5-プリンタを接続してテスト印刷する)
8. [STEP 6: インターネット越しに使えるように設定する](#step-6-インターネット越しに使えるように設定する)
9. [STEP 7: Claude.ai と繋げる](#step-7-claudeai-と繋げる)
10. [STEP 8: 実際に送り状を印刷してみる](#step-8-実際に送り状を印刷してみる)
11. [トラブル発生時の解決法](#トラブル発生時の解決法)
12. [用語集](#用語集)

---

## 1. 最初に知っておくこと

### これは何を作るの?

このプロジェクトを完成させると、**Claude(AI)に「この送り状PDFを印刷して」と頼むだけで、手元の小さなプリンタから送り状ラベルが出てくる**ようになります。

### なぜ普通にPCで印刷しないの?

普通のPCは電気を食うし、うるさいし、大きいからです。このプロジェクトで使う「Raspberry Pi Zero 2 W」は **10円玉くらいのサイズでわずか10グラム、電気代は1ヶ月で数十円** しかかかりません。机の上に置きっぱなしで、電源を入れたままにしておけます。

### どんな流れで印刷されるの?

```
① 君が Claude に「この送り状を印刷して」と頼む
        ↓
② Claude は PDF をインターネット経由で Raspberry Pi に送る
        ↓
③ Raspberry Pi が PDF を "プリンタが読める形" に変換する
        ↓
④ プリンタが紙に印字する
```

### 大事な注意

このプロジェクトは **ヤマト運輸とは無関係の個人プロジェクト** です。"ヤマト"や"宅急便"はヤマトホールディングスの商標なので、**業務で使うときは契約内容を自分で確認してください**。

---

## 2. 用意するもの(買い物リスト)

### 絶対に必要なもの

| 名前 | 値段 | どこで買える | 何に使う |
|---|---|---|---|
| **Raspberry Pi Zero 2 W** | 2,500〜3,500円 | [スイッチサイエンス](https://www.switch-science.com/) / [秋月電子](https://akizukidenshi.com/) | コンピュータ本体 |
| **microSDカード (32GB、防犯カメラ用が推奨)** | 1,500〜2,000円 | Amazon、家電量販店 | OS(パソコンの中身)を入れる |
| **Micro USB 電源アダプタ (5V/2.5A)** | 500〜1,000円 | 100円ショップ、Amazon | 電気をあげるため |
| **Micro USB ⇔ USB-A の OTG ケーブル (L字タイプ推奨)** | 300〜800円 | 100円ショップ、Amazon | プリンタと繋げるため |
| **WS-420B サーマルラベルプリンタ** | 8,000〜12,000円 | Amazon、楽天 | 紙に印字する装置 |
| **送り状ロール紙** | 無料(ヤマトから) | ヤマトビジネスメンバーズに申し込む | 印刷する紙 |

### あると便利なもの

| 名前 | 値段 | 何に使う |
|---|---|---|
| **microSDカードリーダー** | 500円 | パソコンにSDカードを挿すため (PCに直接挿せないとき) |
| **USBハブ (電源付き)** | 1,000円 | 他のUSBデバイスも繋げたいとき |

### パソコンも必要

macOS、Windows、または Linuxのパソコン。**WiFiに繋がっていればOK**。

---

## STEP 1: microSDカードに OS を書き込む

microSDカードを、**Raspberry Pi が動く状態**にします。"OSを書き込む"と言います。OSは「オペレーティングシステム」の略で、**コンピュータを動かす土台のソフト** のことです。

### 1-1. Raspberry Pi Imager をダウンロード

**Raspberry Pi Imager** という、OS書き込み専用アプリを使います。公式サイトからダウンロードします。

🌐 https://www.raspberrypi.com/software/

ページを開いたら、あなたのPCに合わせて選びます:

- **Mac** の人 → "Download for macOS"
- **Windows** の人 → "Download for Windows"
- **Linux** の人 → apt か dnf でインストール

ダウンロードしたファイルをダブルクリックして**インストール** します。これは普通のアプリと同じです。

### 1-2. microSDカードをPCに挿す

microSDカードをカードリーダー経由でPCに挿します。中身に大事なものがある場合は**先にバックアップを取ってください**。書き込むとカードの中身は**全部消えます**。

### 1-3. Raspberry Pi Imager を起動

インストールしたアプリを起動すると、こんな画面が出ます:

```
┌─────────────────────────────────────┐
│  Raspberry Pi Imager                │
│                                     │
│  [CHOOSE DEVICE]                    │
│     ↓ デバイス(機種)を選ぶ          │
│                                     │
│  [CHOOSE OS]                        │
│     ↓ OSを選ぶ                      │
│                                     │
│  [CHOOSE STORAGE]                   │
│     ↓ 書き込む先(SDカード)を選ぶ    │
│                                     │
│  [NEXT] → 書き込む                  │
└─────────────────────────────────────┘
```

**順番に設定していきます**。

### 1-4. デバイスを選ぶ

1. 「**CHOOSE DEVICE**」(デバイスを選ぶ)をクリック
2. 「**Raspberry Pi Zero 2 W**」をクリック

### 1-5. OS を選ぶ

1. 「**CHOOSE OS**」(OSを選ぶ)をクリック
2. 「**Raspberry Pi OS (other)**」をクリック
3. 「**Raspberry Pi OS Lite (64-bit)**」を選ぶ ← **これ重要! "Lite" の方を選ぶ**

> 💡 **なぜ "Lite"?**  
> "Lite"は画面(デスクトップ)がない、軽量版のOSです。Raspberry Pi Zero 2 W はメモリが少ないので、Liteでないと重くて動きません。

### 1-6. 書き込み先 (SDカード) を選ぶ

1. 「**CHOOSE STORAGE**」(ストレージを選ぶ)をクリック
2. 挿した microSDカード を選ぶ

> ⚠️ **必ず microSDカードを選ぶこと**  
> PCの内蔵ディスク (Macintosh HD など) を選んでしまうと、PC自体のデータが消えます。**サイズが32GBなど小さいやつがSDカード**です。

### 1-7. 「NEXT」をクリック → カスタマイズする

「NEXT」を押すと「**Would you like to apply OS customisation settings?**」と聞かれます。これは「**設定を事前にやっておく?**」という意味です。

必ず「**EDIT SETTINGS**」をクリック します。

### 1-8. 設定画面で以下を入力

「GENERAL」タブで:

| 項目 | 入力するもの | 例 |
|---|---|---|
| **Set hostname** | チェックを入れる。`yamato-printer` | `yamato-printer` |
| **Set username and password** | チェックを入れる | |
| &nbsp;&nbsp;&nbsp;Username | `pi` | `pi` |
| &nbsp;&nbsp;&nbsp;Password | 覚えやすいパスワード(8文字以上) | `myPassword123` |
| **Configure wireless LAN** | チェックを入れる | |
| &nbsp;&nbsp;&nbsp;SSID | **家のWiFiの名前** | `MyHomeWiFi` |
| &nbsp;&nbsp;&nbsp;Password | **家のWiFiのパスワード** | `yourwifipassword` |
| &nbsp;&nbsp;&nbsp;Wireless LAN country | **JP** | JP |
| **Set locale settings** | チェックを入れる | |
| &nbsp;&nbsp;&nbsp;Time zone | `Asia/Tokyo` | |
| &nbsp;&nbsp;&nbsp;Keyboard layout | `jp` (または `us` でもOK) | |

次に「SERVICES」タブで:

| 項目 | 設定 |
|---|---|
| **Enable SSH** | チェックを入れる |
| &nbsp;&nbsp;&nbsp;SSH認証方法 | 「**Use password authentication**」を選ぶ |

「REMOTE ACCESS」タブがあれば、そこは何もしなくてOK。

全部入力したら「**SAVE**」をクリック。

> 💡 **"SSH"って何?**  
> SSH (エスエスエイチ) は「離れた場所にあるコンピュータに遠隔ログインする仕組み」です。Raspberry Pi には画面もキーボードも繋げないので、自分のPCから SSH で操作します。

### 1-9. いよいよ書き込み

「**Would you like to apply OS customisation settings?**」の画面で「**YES**」を押します。

次に「**Warning: All existing data on 'SDカード' will be erased**」と警告が出ます。**SDカードの中身が全部消えます**が、問題なければ「**YES**」。

あとは書き込みが終わるのを待ちます。**約5〜10分** かかります。途中でSDカードを抜かないでください。

終わると「**Write Successful**」と出るので、PCからSDカードを取り出します。

---

## STEP 2: 電源を入れて接続確認する

### 2-1. Raspberry Pi に microSDカードを挿す

Raspberry Pi Zero 2 W の**裏側**に microSDカードのスロットがあります。ちょっと固いかもしれないけど、**金属の端子が見える側を上** にして、カチッと音がするまで押し込みます。

### 2-2. 電源を繋ぐ

Raspberry Pi Zero 2 W には **Micro USB ポートが2つ** あります:

```
        [HDMI]   [USB データ]   [USB 電源]
          ↑           ↑             ↑
     使わない    あとでプリンタ    電源をここに挿す
                 を繋ぐ
```

**右側の「USB電源」と書かれた方** に Micro USB ケーブルを挿して電源アダプタをコンセントに挿します。

### 2-3. 起動を待つ

電源が入ると、本体の **緑色のLEDが点滅** します。この点滅が「僕、起動中だよ」のサインです。

**初回起動は3〜5分** かかります。気長に待ちましょう。

点滅が安定したら起動完了です。

---

## STEP 3: Raspberry Pi に SSH で接続する

### 3-1. Raspberry Pi のIPアドレスを調べる

Raspberry Pi は家のWiFiに繋がったはずなので、PCから「おーい、どこにいるー?」と呼びかけて返事を待ちます。

**Mac / Linuxの場合**、ターミナルを開いて:

```bash
ping yamato-printer.local
```

**Windowsの場合**、コマンドプロンプトを開いて:

```cmd
ping yamato-printer.local
```

> 💡 **yamato-printer.local の意味**  
> STEP 1 でホスト名を `yamato-printer` にしましたね。これに `.local` を付けると、家のWiFiの中で「yamato-printer」という名前のマシンを探してくれます。

こんな感じに返事が来ればOK:

```
PING yamato-printer.local (192.168.1.123): 56 data bytes
64 bytes from 192.168.1.123: icmp_seq=0 ttl=64 time=45.123 ms
64 bytes from 192.168.1.123: icmp_seq=1 ttl=64 time=44.567 ms
```

`192.168.1.123` の部分(IPアドレス)をメモしておきます。

**Ctrl + C** を押してpingを止めます。

### 3-2. SSH で接続する

ターミナルで以下を入力:

```bash
ssh pi@yamato-printer.local
```

(あるいは `ssh pi@192.168.1.123` のようにIPアドレス指定でもOK)

初回は「The authenticity of host 'yamato-printer.local' can't be established.」と聞かれるので `yes` と入力します。

次にパスワードを聞かれるので、**STEP 1-8 で決めたパスワード** を入力します。打ち込んでいる文字は画面に**表示されません** が、打てています。

成功すると:

```
pi@yamato-printer:~ $
```

こんな画面になります。**これがLinuxのコマンド画面です**。ここから先は全部この画面で作業します。

---

## STEP 4: このプロジェクトをインストールする

### 4-1. 必要な道具を入れる

まずは **Git** という、プログラムをダウンロードする道具を入れます。

```bash
sudo apt update
sudo apt install -y git
```

> 💡 **`sudo` ってなに?**  
> 「管理者権限でこのコマンドを実行する」という意味です。強いコマンドを使うときに必要です。はじめて `sudo` を使うとき、パスワードを聞かれます(さっき決めたパスワード)。

### 4-2. プロジェクトをダウンロード

```bash
cd ~
git clone https://github.com/DaisukeHori/yamato-printer-mcp-server.git
cd yamato-printer-mcp-server
```

> 💡 **各コマンドの意味**  
> - `cd ~` : ホームディレクトリ(自分の家フォルダ)に移動  
> - `git clone URL` : インターネットからプロジェクトをダウンロード  
> - `cd yamato-printer-mcp-server` : ダウンロードしたフォルダに入る

### 4-3. セットアップスクリプトを実行

このプロジェクトには、**「これ1個実行すれば必要なもの全部インストールしてくれる魔法のスクリプト」** が入っています。

```bash
sudo ./scripts/setup-pi.sh --longevity
```

> 💡 **`--longevity` ってなに?**  
> 「microSDカードが長持ちするように設定も一緒にやってね」というオプションです。Raspberry Pi は24時間動かすとSDカードが壊れやすいので、これを付けるのがおすすめ。

**20〜30分** かかります。コーヒーでも飲んで待ちましょう。

途中で表示される緑色の `[SETUP]` とか `[OK]` は正常な進捗です。赤色の `[ERROR]` が出たら何か問題が起きています。

**最後に以下のようなメッセージが出たらOK**:

```
[SETUP] ========================================================
[SETUP] セットアップ完了
[SETUP] ========================================================
[SETUP] 次のステップ:
[SETUP]   1. プリンタをUSB接続し dmesg | grep usblp で認識確認
...
[SETUP]   MCP_API_KEY を自動生成しました: abc123... ← これ大事!
```

### 4-4. MCP_API_KEY をメモする

上のメッセージの中に **`MCP_API_KEY を自動生成しました: ...`** という行があります。**この `...` の部分をメモしてください**。あとでClaude.ai に設定するときに使います。

見逃したら、以下のコマンドで再確認できます:

```bash
grep MCP_API_KEY ~/yamato-printer-mcp-server/.env
```

### 4-5. 再起動する

設定を反映させるために再起動します。

```bash
sudo reboot
```

再起動すると、SSH接続が切れます。**1〜2分待ってから再度SSH接続**します:

```bash
ssh pi@yamato-printer.local
```

---

## STEP 5: プリンタを接続してテスト印刷する

### 5-1. プリンタを準備

WS-420B の電源ケーブルをコンセントに挿して、電源ボタンを入れます。LEDが点灯します。

送り状ロール紙をプリンタにセットします(プリンタ付属の説明書に従ってください)。

### 5-2. プリンタと Raspberry Pi を繋ぐ

**OTGケーブル** を使います:

- プリンタのUSBケーブル(USB-A) → OTGケーブルのメス端子
- OTGケーブルのMicro USB端子 → Raspberry Pi の **左側 "USB データ"** ポート

> ⚠️ **間違えないで!**  
> Raspberry Pi の **右側は電源専用** です。左の「USB DATA」と書かれている方に繋いでください。

### 5-3. プリンタが認識されたか確認

SSH画面で:

```bash
dmesg | tail -10
```

以下のような行が出ていればOK:

```
[XXX.XXX] usb X-X: new full-speed USB device number X using ...
[XXX.XXX] usblp0: USB Bidirectional printer dev X if 0 alt 0 proto 2 vid 0x... pid 0x...
```

「**usblp0**」という文字が見えたら成功です。

もう一つ確認:

```bash
ls -la /dev/usb/lp0
```

```
crw-rw---- 1 root lp 180, 0 Apr 16 09:00 /dev/usb/lp0
```

こんな感じに見えればOK。

### 5-4. テスト印刷してみる

ドキドキの初印刷です:

```bash
cd ~/yamato-printer-mcp-server
npm run print-sample:test
```

**プリンタからラベルが1枚出てきたら大成功!** そこに「HELLO WS-420B」と印字されているはずです。

うまくいかない場合は [トラブル発生時の解決法](#トラブル発生時の解決法) を見てください。

### 5-5. PDF印刷もテスト

```bash
npm run print-sample:pdf
```

今度は小さいテストPDFがラベルに印刷されます。PDF→TSPLの変換パイプライン全体の動作確認です。

---

## STEP 6: インターネット越しに使えるように設定する

ここまでは「**家のWiFiの中からしか使えない**」状態です。Claude.ai から使えるようにするには、**Cloudflare Tunnel** という仕組みを使って、Raspberry Pi をインターネットから見えるようにします。

### 6-1. Cloudflare アカウントを作る

まずCloudflareの無料アカウントを作ります。

🌐 https://dash.cloudflare.com/sign-up

メールアドレスとパスワードを入力して登録。登録確認メールが届くので、メール内のリンクをクリックして認証します。

### 6-2. 独自ドメインを取得する

Cloudflare Tunnelを使うには **独自ドメイン(xxx.comなど)** が必要です。まだ持ってなければ、どこかで取得します:

- [Cloudflare Registrar](https://www.cloudflare.com/products/registrar/) (おすすめ、年間1,500円くらい)
- [お名前.com](https://www.onamae.com/) (年間1,000〜2,000円)
- [Google Domains](https://domains.google/) (年間2,000円くらい)

取得したら、Cloudflareのダッシュボードでドメインを登録します(設定手順はCloudflareのガイドに従ってください)。

### 6-3. Zero Trust ダッシュボードでトンネルを作る

1. [Cloudflare Zero Trust](https://one.dash.cloudflare.com/) にログイン
2. 左メニューの「**Networks**」→「**Tunnels**」をクリック
3. 「**Create a tunnel**」をクリック
4. Tunnel type: 「**Cloudflared**」を選択
5. Tunnel name: `yamato-printer` と入力
6. 「**Save tunnel**」をクリック

### 6-4. cloudflared をインストール (Pi側)

すでに `setup-pi.sh` でインストール済みなので、トークン認証するだけ。

Cloudflareの画面に表示される、以下のようなコマンドをコピーしてSSH画面で実行:

```bash
sudo cloudflared service install eyJhIjoiXXX...
```

**`eyJh...` の部分はCloudflare画面に表示された実際のトークンに置き換え** てください。

### 6-5. ドメインとトンネルを紐付ける

Cloudflare Zero Trustの画面に戻って「**Next**」をクリックすると「Public Hostname」設定画面が出ます:

| 項目 | 入力 |
|---|---|
| Subdomain | `yamato-printer` |
| Domain | (取得した自分のドメインを選ぶ) |
| Type | `HTTP` |
| URL | `localhost:8719` |

> 💡 **8719 は?**  
> このMCPサーバーが動いているポート番号です。`.env` で変更もできますが、デフォルトは8719です。

「**Save hostname**」をクリック。

### 6-6. 動作確認

ブラウザで以下のURLを開いてみます(ドメイン名はあなたのに置き換え):

```
https://yamato-printer.あなたのドメイン/health
```

JSONが表示されればOK:

```json
{
  "status": "ok",
  "version": "0.1.0",
  "printer": { "available": true, "device": "/dev/usb/lp0" },
  "timestamp": "2026-04-16T..."
}
```

**`"available": true` になっていれば完璧**。

---

## STEP 7: Claude.ai と繋げる

### 7-1. Claude.ai にログイン

🌐 https://claude.ai/

### 7-2. 設定画面を開く

画面右下の自分のアイコン → 「**Settings**」→「**Connectors**」(コネクタ)→「**Add custom connector**」をクリック。

### 7-3. コネクタ情報を入力

| 項目 | 入力 |
|---|---|
| Name | `YamatoPrinter` (好きな名前でOK) |
| URL | `https://yamato-printer.あなたのドメイン/mcp?key=XXXXX` |

**URLの `key=XXXXX` の部分** は、STEP 4-4 でメモした **MCP_API_KEY** に置き換えてください。

例:
```
https://yamato-printer.example.com/mcp?key=a1b2c3d4e5f6g7h8i9j0...
```

「**Add**」または「**Save**」をクリック。

### 7-4. 動作確認

Claude.aiの新しいチャットで「**利用可能なMCPツールを教えて**」と聞いてみます。`print_uploaded`、`print_url`、`list_slip_types` などの名前が出てきたら成功です!

---

## STEP 8: 実際に送り状を印刷してみる

### 8-1. ヤマトB2クラウドで送り状PDFを作る

🌐 https://bmypage.kuronekoyamato.co.jp/

B2クラウドで送り状を作成し、PDFをダウンロードします。

### 8-2. Claude.ai にPDFをアップロード

Claude.aiでチャット画面を開き、**クリップボタン** からPDFをアップロードします。

### 8-3. 印刷指示

```
この送り状PDFを印刷してください。宅急便の用紙を使います。
```

と送信します。Claudeが自動的に `print_uploaded` を呼び出し、数秒後にプリンタからラベルが出てきます。

🎉 **お疲れ様でした!** 完成です。

---

## トラブル発生時の解決法

### ❌ ping yamato-printer.local が通らない

**症状**: `ping: cannot resolve yamato-printer.local`

**解決策**:
1. Raspberry Pi の電源LEDが点滅しているか確認
2. 家のWiFiパスワードが正しいか確認 (STEP 1-8 で入力したもの)
3. 5GHz帯のWiFiに繋ごうとしていないか確認 (Pi Zero 2 W は **2.4GHzのみ対応**)
4. ルーターの「同一ネットワーク内で機器が見えるか」設定を確認 (ゲストネットワークでは見えないことも)

解決しない場合、以下のコマンドでルーターの管理画面からRaspberry Pi のIPアドレスを調べて、IPアドレス直接でpingします:

```bash
ping 192.168.1.XXX
```

### ❌ SSH接続でパスワードを何度入れても弾かれる

**症状**: `Permission denied, please try again.`

**解決策**:
1. **パスワードの打ち間違い**。画面に表示されないので、慎重にゆっくり打つ
2. **日本語入力がONになっている**。英語入力にする
3. どうしてもダメなら、STEP 1 からやり直して **microSDカードに書き込み直す**

### ❌ setup-pi.sh がエラーで止まった

**症状**: `[ERROR] ...`

**解決策**:

赤い`[ERROR]` のメッセージをよく読みます。

- `E: Unable to locate package` → インターネット接続を確認、`sudo apt update` を再実行
- `No space left on device` → microSDカードが小さすぎ。32GB以上を使う
- その他 → [GitHub Issues](https://github.com/DaisukeHori/yamato-printer-mcp-server/issues) にエラーメッセージを貼って質問

### ❌ dmesg にusblp が出ない

**症状**: プリンタを繋いでも認識しない

**解決策**:
1. プリンタの**電源が入っているか** 確認
2. OTGケーブルが **Raspberry Pi の左側(USB DATA)** に繋がっているか確認
3. プリンタのUSBケーブルを一度抜いて、数秒後にもう一度差し直す
4. モジュールを手動ロード:
   ```bash
   sudo modprobe usblp
   ls /dev/usb/lp0
   ```
5. **USBケーブルを変える**。ダイソーのOTGケーブルは粗悪なことがある

### ❌ 印刷は始まるがテキストが真っ黒 / 真っ白

**症状**: プリンタは動くけど印字がおかしい

**解決策**:
1. ディザしきい値を調整:
   ```bash
   nano ~/yamato-printer-mcp-server/.env
   ```
   `DITHER_THRESHOLD=128` の数字を `100` や `180` に変えて試す
2. プリンタのロール紙の裏表が逆になっている可能性 (サーマル紙は**熱で黒くなる面**が表)

### ❌ Cloudflare Tunnel が繋がらない

**症状**: ブラウザで /health を開くとタイムアウト

**解決策**:
1. `cloudflared` サービスが動いているか確認:
   ```bash
   sudo systemctl status cloudflared
   ```
   `active (running)` になっていればOK。
2. `yamato-printer-mcp` サービスも動いているか確認:
   ```bash
   sudo systemctl status yamato-printer-mcp
   ```
3. ログを見る:
   ```bash
   journalctl -u yamato-printer-mcp -n 50
   journalctl -u cloudflared -n 50
   ```

### ❌ Claude.ai で「コネクタが見つかりません」と出る

**症状**: MCP ツールが Claude から呼べない

**解決策**:
1. ブラウザで `/health` を開いて接続可能か再確認
2. コネクタURLの `?key=XXXX` の部分が、Pi の `.env` にある `MCP_API_KEY` と完全一致しているか確認
3. Claude.ai のコネクタを一度削除して、再度登録してみる

### ❌ Raspberry Pi が勝手に再起動する

**症状**: しばらく使っていると勝手に再起動してしまう

**解決策**:
1. **電源アダプタが非力**。**5V / 2.5A以上** を確実に満たすものを使う (スマホの古い充電器はNG)
2. microSDカードの寿命。新しいものに入れ替える

---

## 用語集

| 用語 | 意味 |
|---|---|
| **SSH** | エスエスエイチ。離れたコンピュータをネットワーク越しに操作する仕組み |
| **OS** | オーエス。Operating System。コンピュータを動かす土台のソフト |
| **ターミナル** | コマンドを入力してコンピュータに指示する、文字だけの画面 |
| **sudo** | スードゥー。「管理者権限でコマンドを実行する」 |
| **apt** | Debian/Ubuntu でソフトをインストールするコマンド |
| **git clone** | GitHub からプロジェクトをダウンロードするコマンド |
| **systemd** | サービスを自動起動させるLinuxの仕組み |
| **TSPL** | ティーエスピーエル。サーマルラベルプリンタ用の命令言語 |
| **Cloudflare Tunnel** | 家のPCを外から見えるようにする、Cloudflareの無料サービス |
| **MCP** | Model Context Protocol。AI (Claude) が外部ツールを使うための規格 |
| **microSD** | Raspberry Pi の「記憶装置」。パソコンのSSDやハードディスクに相当 |
| **IP アドレス** | ネットワーク上のコンピュータの住所。例: `192.168.1.123` |
| **ホスト名** | 覚えやすい名前。`.local` を付けると家のLAN内で機器を見つけられる |

---

## 次のステップ

無事に動作したら、次は:

- 📖 [README.md](../README.md) で全機能を読む
- 🎨 [DESIGN.md](../DESIGN.md) で仕組みを理解する
- 🐛 [Issues](https://github.com/DaisukeHori/yamato-printer-mcp-server/issues) でバグ報告や質問
- ⭐ [GitHubリポジトリ](https://github.com/DaisukeHori/yamato-printer-mcp-server) にスターを!

---

**それでも分からない時は**、質問を [GitHub Issues](https://github.com/DaisukeHori/yamato-printer-mcp-server/issues) に投げてください。日本語OK、初心者歓迎。
