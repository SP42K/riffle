# 地下城的層間分鏡與終章插圖

把圖檔直接丟進這個資料夾就會出現在遊戲裡，**不需要改任何程式碼**。
沒放的那幾張會自動退回純文字的讀本框，不會破版，所以可以一張一張慢慢補。

## 檔名

| 檔名 | 出現時機 |
|---|---|
| `b1.png` | 進入第一層 · 貪婪的地窖 |
| `b2.png` | 進入第二層 · 薩滿祭壇 |
| `b3.png` | 進入第三層 · 逃亡之路 |
| `b4.png` | 進入第四層 · 酋長王座 |
| `b5.png` | 進入第五層 · 邪神祭壇 |
| `b6.png` | 進入第六層 · 異世界大門 |
| `ending-win.png` | 通關 |
| `ending-lose.png` | 全隊覆滅 |

`.jpg` 與 `.png` 都吃（先找 `.jpg`，找不到再找 `.png`）。

## 規格

- **比例 16:10**，建議 1024×640 或 1280×800。比例不同不會壞，會等比縮放後上下留黑邊。
- 畫面**下緣三分之一**會被說明框壓到一點，重點物件不要放太低。
- 四個主角一律畫成**背影剪影、小、逆光** —— 這樣玩家自己的職業組合不會跟圖打架。

## 壓縮

生圖工具吐出來的通常是 2600px、每張 7MB 的 PNG —— 那是實際顯示寬度的三倍多，
六張就 40MB，會整包進 git，每個玩家每一層還要重新下載一次。

丟進來之後跑一次這段就好（原始大圖會被搬到 `client/story-src/`，那個資料夾在 .gitignore 裡）：

```python
from PIL import Image
import os
src = 'client/public/story'
os.makedirs('client/story-src', exist_ok=True)
for name in sorted(os.listdir(src)):
    if not name.lower().endswith('.png'):
        continue
    im = Image.open(os.path.join(src, name)).convert('RGB')
    w, h = im.size
    if w > 1600:
        im = im.resize((1600, round(h * 1600 / w)), Image.LANCZOS)
    im.save(os.path.join(src, name[:-4] + '.jpg'), 'JPEG', quality=82, optimize=True, progressive=True)
    os.replace(os.path.join(src, name), os.path.join('client/story-src', name))
```

1600px 寬、JPEG 82 —— 顯示寬度 820px，2 倍螢幕也夠銳利，一張大約 200KB。

## 為什麼放在 public

Vite 會把 `client/public/` 底下的東西原封不動搬到網站根目錄，
所以 `client/public/story/b1.png` 對應到的網址就是 `/story/b1.png`。
不經過打包，換圖不用重新編譯，重整就看得到。
