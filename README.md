# 岩原スキー場 Simulator

在瀏覽器裡模擬日本滑雪場的一天：從停車場出發、買纜車票、租雪具、換裝、搭纜車、滑雪、吃午餐，最後到飯店吃晚餐。地形是國土地理院的真實高程資料，雪道和纜車來自 OpenStreetMap。

## 開始

```bash
npm install
npm run dev        # http://localhost:5173/
```

畫質：`?quality=low|medium|high`（也可以在遊戲內按 O 切換）。

## 操作

| 模式 | 按鍵 |
|---|---|
| 步行 | WASD 走路 · Shift 跑 · Space 快速移動 · 滑鼠轉視角 · 滾輪縮放 · E 互動 · Q 穿上雪板 |
| 滑雪 | A/D 轉彎 · W 蹲低滑降／平地推進 · S 煞車 · V 第一人稱 · E 搭纜車 · Q 脫下雪板 |
| 纜車 | 按住 Space 快轉 · 滑鼠環視 |
| 共通 | G 路線引導 · O 設定（天氣、雪況、時間、傳送、畫質） · F 飛行鏡頭（R 加速） · M 雪道線 |

路線引導會依目前的目標指路：畫面上方的方向與距離、目的地的光柱、走路時地上的箭頭（沿著步道），以及右下角的小地圖。

## 一天的流程

1. センターハウス：售票處 → 雪具租借（雙板／單板、長度、雪鞋、雪衣）→ 更衣室
2. 到纜車站按 E 搭乘（需要有效票券、雪具和換裝），白天全部纜車運行，17:00 後只有中央クワッド夜間營運
3. 滑雪：完成落差 60 m 以上算一趟；撞樹、急轉或冰面打滑會跌倒
4. 11:00–15:00 吃午餐；體力、飽足、體溫太低時會有提示
5. 17:00 後到ホテルアルパイン吃晚餐，顯示一日總結

## 模擬內容

- **滑雪物理**（`src/player/SkiController.ts`）：坡面重力分量、邊刃抓地（刻滑）、動摩擦、空氣阻力（站姿／蹲低）、犁式煞車、靜摩擦
- **雪況**（`src/world/SnowConditions.ts`）：圧雪、パウダー、アイスバーン、ザラメ、荒れた雪；圧雪區外依新雪深度增加阻力
- **天氣**（`src/world/Weather.ts`）：晴、陰、降雪、暴風雪、濃霧，影響能見度、風、體溫與降雪粒子
- **晝夜**：太陽位置依 1 月的湯澤計算，夜間有照明
- **其他滑雪者**（`src/npc/NpcSkiers.ts`）：沿雪道 S 形滑行、搭乘真實纜車、閃避玩家

價格與營業時間是遊戲設定，並非雪場官方資訊。

## 資料管線

```bash
npm run data       # OSM 下載 → 高程 → 森林覆蓋 → resort.json
```

| 腳本 | 輸出 |
|---|---|
| `tools/terrain/fetch-osm.mjs` | 雪道、纜車（快取在 `tools/terrain/cache/`） |
| `tools/terrain/build-heightmap.mjs` | `heightmap.bin`（4 km、4 m 網格）、`outer.bin`（20 km、32 m 網格） |
| `tools/terrain/build-landcover.mjs` | `forest.bin`：從航照估計的森林密度 |
| `tools/terrain/build-resort.mjs` | `resort.json`：合併 OSM 與 `tools/terrain/facilities/<id>.json` 的手動標註 |

新增雪場：在 `tools/terrain/common.mjs` 加入中心座標、寫一份 facilities JSON，再依序執行上面四個腳本並帶上 id（例如 `node tools/terrain/build-heightmap.mjs naeba`），最後把 `src/main.ts` 的 `RESORT` 改成該 id。

## 測試

```bash
node tools/test/run-physics.mjs   # 斜面物理：v = g(sinθ − μcosθ)·t、終端速度、煞車、橫滑
node tools/test/e2e.mjs           # 需先 npm run dev；用本機 Chrome 走完一整天並截圖到 tools/test/out/
```

## 資料來源

- 高程、航照：出典：国土地理院（地理院タイル）
- 雪道、纜車、設施位置：© OpenStreetMap contributors（ODbL）
