import XCTest
@testable import BBchat

@MainActor
final class StickerPickerTests: XCTestCase {
    func testEmojiDefaultDecodesWithSnakeCaseAndEmptyStickers() throws {
        let pack = try decodePack(#"""
        {
          "pack_id": "emoji_default",
          "pack_type": "emoji",
          "input_mode": "insert_text",
          "title": {"zh-Hans": "表情", "en": "Emoji", "ja": "絵文字"},
          "cover_emoji": "😀",
          "inserts_into_text": true,
          "send_as_sticker": false,
          "emoji_count": 57,
          "emojis": [{
            "emoji_id": "grinning_face",
            "emoji": "😀",
            "value": "fallback",
            "name": {"zh-Hans": "开心", "en": "Grinning"},
            "sort_order": 10
          }]
        }
        """#)

        XCTAssertEqual(pack.id, "emoji_default")
        XCTAssertTrue(pack.isEmojiInput)
        XCTAssertEqual(pack.coverEmoji, "😀")
        XCTAssertEqual(pack.emojiCount, 57)
        XCTAssertEqual(pack.emojis.first?.insertionValue, "😀")
        XCTAssertTrue(pack.stickers.isEmpty)
    }

    func testEmojiPackWithEmptyStickersRemainsVisibleAndFirst() throws {
        let packs = try decodePacks(#"""
        [
          {"pack_id":"bbcat_default","stickers":[{"sticker_id":"cat","asset_key":"stickers/cat"}]},
          {"pack_id":"emoji_default","enabled":true,"cover_emoji":"😀","emojis":[{"emoji_id":"grinning","emoji":"😀"}],"stickers":[]},
          {"pack_id":"quick_reactions_lite","stickers":[{"sticker_id":"ok","asset_key":"stickers/ok"}]},
          {"pack_id":"daily_status_lite","stickers":[{"sticker_id":"busy","asset_key":"stickers/busy"}]}
        ]
        """#)
        let config = AppRemoteConfig(configVersion: "2026.07.12.1", stickerPacks: packs)

        XCTAssertEqual(
            config.effectiveStickerPacks.map(\.id),
            ["emoji_default", "bbcat_default", "quick_reactions_lite", "daily_status_lite"]
        )
        XCTAssertTrue(config.effectiveStickerPacks.first?.stickers.isEmpty == true)
        XCTAssertEqual(config.effectiveStickerPacks.first?.coverEmoji, "😀")
    }

    func testOldThreePackConfigReceivesLocalEmojiFallback() throws {
        let packs = try decodePacks(#"""
        [
          {"pack_id":"bbcat_default","stickers":[{"sticker_id":"cat","asset_key":"stickers/cat"}]},
          {"pack_id":"quick_reactions_lite","stickers":[{"sticker_id":"ok","asset_key":"stickers/ok"}]},
          {"pack_id":"daily_status_lite","stickers":[{"sticker_id":"busy","asset_key":"stickers/busy"}]}
        ]
        """#)
        let config = AppRemoteConfig(configVersion: "2026.07.11.2", stickerPacks: packs)

        XCTAssertEqual(config.effectiveStickerPacks.first?.id, "emoji_default")
        XCTAssertEqual(config.effectiveStickerPacks.first?.coverEmoji, "😀")
        XCTAssertFalse(config.effectiveStickerPacks.first?.emojis.isEmpty ?? true)
    }

    func testEmojiSelectionInsertsAtCursorWithoutStickerSend() throws {
        let pack = try decodePack(#"{"pack_id":"emoji_default","pack_type":"emoji","emojis":[{"emoji_id":"grinning","emoji":"😀"}]}"#)
        let emoji = try XCTUnwrap(pack.emojis.first)
        var text = "AB"
        var selection = NSRange(location: 1, length: 0)
        var sendCount = 0

        pack.performPickerSelection(
            pack.pickerSelection(for: emoji),
            onInsertEmoji: { ComposerTextInsertion.insert($0, into: &text, selectedRange: &selection) },
            onSendSticker: { _, _ in sendCount += 1 }
        )

        XCTAssertEqual(text, "A😀B")
        XCTAssertEqual(sendCount, 0)
    }

    func testConsecutiveEmojiTapsAppendAtUpdatedCursor() throws {
        let pack = try decodePack(#"{"pack_id":"emoji_default","input_mode":"insert_text","emojis":[{"emoji_id":"grinning","value":"😀"}]}"#)
        let emoji = try XCTUnwrap(pack.emojis.first)
        var text = "Hi"
        var selection = NSRange(location: 2, length: 0)

        for _ in 0..<2 {
            pack.performPickerSelection(
                pack.pickerSelection(for: emoji),
                onInsertEmoji: { ComposerTextInsertion.insert($0, into: &text, selectedRange: &selection) },
                onSendSticker: { _, _ in XCTFail("Emoji must not use the sticker sender") }
            )
        }

        XCTAssertEqual(text, "Hi😀😀")
    }

    func testImageStickerStillUsesStickerSender() throws {
        let pack = try decodePack(#"{"pack_id":"cats","stickers":[{"sticker_id":"cat_hi","asset_key":"stickers/cat_hi"}]}"#)
        let sticker = try XCTUnwrap(pack.stickers.first)
        var insertedText: String?
        var sentStickerID: String?

        pack.performPickerSelection(
            pack.pickerSelection(for: sticker),
            onInsertEmoji: { insertedText = $0 },
            onSendSticker: { _, sticker in sentStickerID = sticker.id }
        )

        XCTAssertNil(insertedText)
        XCTAssertEqual(sentStickerID, "cat_hi")
    }

    func testAllChatComposersUseIdenticalInsertionBehavior() {
        var directText = "Direct"
        var directRange = NSRange(location: 6, length: 0)
        var groupText = "Direct"
        var groupRange = NSRange(location: 6, length: 0)
        var botText = "Direct"
        var botRange = NSRange(location: 6, length: 0)

        ComposerTextInsertion.insert("😀", into: &directText, selectedRange: &directRange)
        ComposerTextInsertion.insert("😀", into: &groupText, selectedRange: &groupRange)
        ComposerTextInsertion.insert("😀", into: &botText, selectedRange: &botRange)

        XCTAssertEqual(directText, groupText)
        XCTAssertEqual(directRange, groupRange)
        XCTAssertEqual(directText, botText)
        XCTAssertEqual(directRange, botRange)
    }

    private func decodePack(_ json: String) throws -> StickerPack {
        try JSONDecoder().decode(StickerPack.self, from: Data(json.utf8))
    }

    private func decodePacks(_ json: String) throws -> [StickerPack] {
        try JSONDecoder().decode([StickerPack].self, from: Data(json.utf8))
    }
}
