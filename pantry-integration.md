# 食材・道具画面と調理 API の接続

食材・道具画面は確定した食材と道具を調理画面へ渡します。盛り付け後は「使った食材を確認する」から、実際の使用量を入力して在庫を更新できます。

通常モードの調理 API はベーコンと玉ねぎのパスタを鍋とフライパンで作る手順に対応します。ツナやワンパンの選択は画面確認用デモに引き継げます。画面確認用デモは従来の固定応答を使います。

## A と B の受け渡し

`cooking-logic.js` は画面と調理 API の間をつなぐブラウザ用モジュールです。画面は返された `state` を次の呼び出しに渡します。

| Export | 入力 | 戻り値 |
| --- | --- | --- |
| `startCooking` | 調理の選択と任意の `signal` | `{ state, message, timer, done }` |
| `handleUtterance` | 文字起こしまたは手入力の発話、前回の `state`、任意の `signal` | 同上 |
| `handleTimerElapsed` | 最新の `state`、任意の `signal` | 同上 |

`message` は画面表示と日本語読み上げに使います。`timer` は開始時に `{ action: 'start', durationSeconds, endsAt }`、解除時に `{ action: 'cancel' }`、変更がない場合は `null` です。`endsAt` は UNIX 時刻のミリ秒です。`done` が真になると盛り付けが完了です。

- `POST /api/transcribe` はブラウザの録音を受け取り、Aqua Voice の文字起こしを `{ text }` で返します。
- `GET /api/cooking` は初期案内と進捗を返します。`POST /api/cooking` は `{ utterance, progress }` または `{ event: 'timerElapsed', progress }` を受け取り、`{ progress, guidance, timer, finished }` を返します。
- Gemini は発話を判定し、次の案内は固定レシピの進捗に従って調理 API が選びます。

## 画面確認用デモでの在庫の確認

1. `/?demo=1` の「食材・道具を確認する」からツナを２缶、パスタと玉ねぎを「ある」にします。ベーコンと鍋を「ない」、深めのフライパンを「ある」にします。
2. ツナ缶と玉ねぎのワンパンパスタの提案から調理を開始し、画面の案内に沿って盛り付けまで進めます。
3. 完成後にツナを１缶使ったと入力し、残量が１缶になることを確認します。
