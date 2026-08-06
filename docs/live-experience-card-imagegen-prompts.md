# 直播体验卡 ImageGen 提示词与资产处理记录

## 输出

| 资源名 | 尺寸 | 文件大小 | SHA-256 |
| --- | ---: | ---: | --- |
| `prop_live_experience_card_5m` | 384×384 RGBA | 156,196 B | `1005f1b153210da1f4a3f2ec78eaeebe7a937a54038454c8e5dfd82490128619` |
| `prop_live_experience_card_10m` | 384×384 RGBA | 164,298 B | `5737d4fa48d82d1b1a10df9e0443ee629212f38fc1ac97cb9c45d6c04f269005` |
| `prop_live_experience_card_15m` | 384×384 RGBA | 171,482 B | `1a0a7f1e9afe45a3f1bfe1bdbde003e3409872f70241768c9cfa95e105e712c6` |

最终 PNG 位于 `BWChat/Assets.xcassets/<资源名>.imageset/`。卡面本身不含文字或数字；客户端 `LiveExperienceCardArtwork` 使用 SwiftUI 叠加精确的 `5min`、`10min`、`15min` 徽标，保证小尺寸清晰、无错字且可无障碍朗读。

## 生成方式

- 模式：内置 ImageGen，先生成 10 分钟主造型，再基于主造型派生 5/15 分钟协调变体。
- 风格参考：项目已有 `prop_image_unlock_card`、`prop_video_unlock_card`、`prop_game_entry_card`，只参考紫金色 3D 道具语言，不复制原物件。
- 10 分钟主提示词：

```text
Use case: stylized-concept
Asset type: square iOS inventory icon for the coordinated LIVE EXPERIENCE CARD family
Input images: Images 1–3 are style references only. Create a new sibling asset; do not edit or copy them.
Primary request: Create the master 10-minute LIVE EXPERIENCE CARD, instantly readable at 48–96 pt. It means a limited-duration one-to-one live voice/video connection.
Subject: one premium rounded magical admission ticket in a slight three-quarter front view, featuring one bold raised video-camera silhouette merged with a clear clock/hourglass motif, plus one subtle purple cat-paw seal. The clock must have no digits or text.
Style/medium: polished high-end 3D mobile-game collectible, rounded toy-like proportions, glossy enamel and satin gold, matching the rendering polish and purple-gold family of the references.
Composition/framing: one isolated object centered, occupying about 72% of a square canvas, generous clean padding, strong simple silhouette, no floor.
Lighting/mood: soft studio rim light, luminous and friendly, magical but uncluttered.
Color palette: royal violet and lavender base, vivid purple-pink and icy-cyan time glow, pearl highlights, restrained warm gold trim. Do not use green in the object.
Materials/textures: compact glossy enamel, satin gold, broad clean highlights, no tiny filigree.
Scene/backdrop: perfectly flat solid #00ff00 chroma-key background for background removal; uniform color with no shadow, gradient, texture, reflection, floor plane, or lighting variation.
Constraints: no words, no letters, no numbers, no watermark, no canvas border, no cast/contact shadow, no reflection; crisp separated edges; the live-video plus time-limited meaning must remain clear when downscaled.
Avoid: extra cards, people, hands, scenery, coins, currency symbols, padlocks, game controllers, photo frames, film strips, green spill, clutter.
```

- 5 分钟变体附加提示词：

```text
Variant: 5-minute sibling. Make it feel like the lightest/shortest tier using an icy cyan and periwinkle time glow, lavender base, restrained warm-gold trim, and a compact single-ring clock/hourglass emblem. Do not add any numeric tier indicator.
```

- 15 分钟变体附加提示词：

```text
Variant: 15-minute sibling. Make it feel like the richest/longest tier using warm gold and rose-magenta time glow, deep royal-violet base, pearl highlights, and a fuller double-ring clock/hourglass emblem. Do not add any numeric tier indicator.
```

## 处理流程

1. 使用 ImageGen 绿幕模式输出候选图。
2. 使用技能自带 `remove_chroma_key.py`：`--auto-key border --soft-matte --transparent-threshold 12 --opaque-threshold 220 --despill`，完成去背、软边缘与去绿色溢出。
3. 使用 `sips -z 384 384` 输出 384×384 RGBA PNG。
4. 检查透明通道、边缘、主体留白和浅/深背景可读性；三张均通过 48–96 pt 视觉检查。
5. 检查单张不超过约 180 KB，并记录尺寸、大小和 SHA-256，便于后续重做与回归对比。

若重做同系列，不要让生成模型绘制分钟数字；继续由 SwiftUI 徽标承担 `5min / 10min / 15min` 的展示。
