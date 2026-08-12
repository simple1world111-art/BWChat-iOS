export interface User {
  user_id: string;
  username: string;
  nickname: string;
  avatar_url: string;
  bio: string;
  gender: string;
  birthday: string;
  location: string;
  following_count: number;
  follower_count: number;
  posts_count?: number | undefined;
  moments_count?: number | undefined;
  followed_by_me: boolean;
  follows_me: boolean;
  is_friend: boolean;
}

export interface AuthSession {
  token: string;
  refresh_token: string;
  user: User;
}

export interface VerifyData {
  user: User;
}

export interface Contact {
  user_id: string;
  nickname: string;
  avatar_url: string;
  last_message?: string | undefined;
  last_message_time?: string | undefined;
  unread_count: number;
}

export interface FriendInfo {
  user_id: string;
  nickname: string;
  avatar_url: string;
  added_at: string;
}

export interface FriendRequest {
  request_id: number;
  user_id: string;
  nickname: string;
  avatar_url: string;
  created_at: string;
}

export interface SearchUser {
  user_id: string;
  nickname: string;
  avatar_url: string;
  relation: string;
  followed_by_me: boolean;
  follow_requested: boolean;
}

export interface FollowRelationship {
  user_id: string;
  followed_by_me: boolean;
  follows_me: boolean;
  is_friend: boolean;
  follow_requested?: boolean | undefined;
  following_count?: number | undefined;
  follower_count?: number | undefined;
}

export interface FollowUser {
  user_id: string;
  username: string;
  nickname: string;
  avatar_url: string;
  bio: string;
  following_count: number;
  follower_count: number;
  followed_by_me: boolean;
  follows_me: boolean;
  is_friend: boolean;
}

export interface FollowUsersPage {
  users: FollowUser[];
  has_more: boolean;
  next_page?: number | undefined;
}

export interface ProfileHighlight {
  id: string;
  title: string;
  cover_url: string;
  item_count?: number | undefined;
}

export interface PublicProfile {
  user_id: string;
  username: string;
  nickname: string;
  avatar_url: string;
  bio: string;
  gender: string;
  birthday: string;
  location: string;
  following_count: number;
  follower_count: number;
  followed_by_me: boolean;
  follows_me: boolean;
  is_friend: boolean;
  follow_requested: boolean;
  posts_count?: number | undefined;
  moments_count?: number | undefined;
  website_url?: string | undefined;
  contact_email?: string | undefined;
  contact_url?: string | undefined;
  is_verified: boolean;
  category: string;
  pronouns: string;
  is_private: boolean;
  can_view_moments: boolean;
  can_message: boolean;
  mutual_followers_count?: number | undefined;
  mutual_followers: FollowUser[];
  highlights: ProfileHighlight[];
  account_created_at?: string | undefined;
}

export interface MomentAuthor {
  user_id: string;
  nickname: string;
  avatar_url: string;
}

export interface MomentComment {
  id: number;
  content: string;
  created_at?: string | undefined;
  user_id: string;
  nickname: string;
  avatar_url: string;
  reply_to?: MomentAuthor | undefined;
  image_url?: string | undefined;
}

export interface MomentMedia {
  id: string;
  type: "image" | "video";
  url: string;
  thumbnail_url?: string | undefined;
  locked_preview_url?: string | undefined;
  is_locked: boolean;
}

export interface Moment {
  id: number;
  author: MomentAuthor;
  content: string;
  images: string[];
  media: MomentMedia[];
  unlock_price_gold_coins?: number | undefined;
  is_unlocked: boolean;
  location_name?: string | undefined;
  created_at: string;
  likes: MomentAuthor[];
  comments: MomentComment[];
  liked_by_me: boolean;
  client_request_id?: string | undefined;
}

export interface MomentFeedPage {
  moments: Moment[];
  has_more: boolean;
  snapshot_complete?: boolean | undefined;
}

export type MomentFeedTab = "recommended" | "following";

export interface MomentsUnreadInfo {
  unread_count: number;
  has_new_moments: boolean;
}

export interface MomentsNotification {
  type: string;
  id: string;
  moment_id: number;
  user_id: string;
  content?: string | undefined;
  moment_content?: string | undefined;
  moment_images?: string[] | undefined;
  created_at: string;
  user: MomentAuthor;
}

export interface MomentUploadAsset {
  kind: "image" | "video";
  uri: string;
  preview_uri?: string | undefined;
  filename: string;
  mime_type: string;
}

export interface WalletBalanceSnapshot {
  currency: "gold_coin";
  gold_coin_balance: number;
  activity_cat_food_balance: number;
  spendable_balance: number;
  recharge_gold_coin_balance: number;
  gift_income_gold_coin_balance: number;
  withdraw_frozen_gold_coin_balance: number;
  withdrawable_gold_coin_balance: number;
  chat_money_frozen_gold_coin_balance: number;
}

export interface WalletTransaction {
  id: string;
  type: string;
  currency: "gold_coin";
  gold_coin_amount?: number | undefined;
  gold_coin_balance_after?: number | undefined;
  title?: string | undefined;
  note?: string | undefined;
  gift_id?: string | undefined;
  gift_name?: string | undefined;
  product_id?: string | undefined;
  created_at?: string | undefined;
}

export interface WalletTransactionPage {
  transactions: WalletTransaction[];
  next_cursor?: string | undefined;
}

export interface ActivityCatFoodTransaction {
  id: string;
  delta: number;
  balance_after: number;
  source?: string | undefined;
  title?: string | undefined;
  created_at?: string | undefined;
}

export interface ActivityCatFoodTransactionPage {
  items: ActivityCatFoodTransaction[];
  next_cursor?: string | undefined;
}

export interface WalletWithdrawal {
  id: string;
  currency: "gold_coin";
  gold_coin_amount: number;
  payout_usd?: number | undefined;
  payout_cents?: number | undefined;
  provider?: string | undefined;
  payout_method?: string | undefined;
  payout_account?: string | undefined;
  network?: string | undefined;
  wallet_address?: string | undefined;
  status: string;
  can_cancel?: boolean | undefined;
  note?: string | undefined;
  created_at?: string | undefined;
  updated_at?: string | undefined;
}

export interface WalletAdRewardStatus {
  enabled: boolean;
  daily_limit: number;
  watched_count: number;
  remaining_count: number;
  next_reset_at: string;
}

export interface WalletAdRewardSession {
  session_id: string;
  ssv_custom_data: string;
  remaining_count: number;
  expires_at?: string | undefined;
  next_reset_at: string;
}

export interface WalletIapConfirmation {
  balance?: WalletBalanceSnapshot | undefined;
  gold_coin_amount?: number | undefined;
  transaction?: WalletTransaction | undefined;
}

export interface GiftCatalogItem {
  gift_id: string;
  name: string;
  localized_name?: Record<string, string> | undefined;
  price: number;
  asset_key: string;
  remote_asset_key?: string | undefined;
  image_url?: string | undefined;
  animation_asset_key?: string | undefined;
  sort_order?: number | undefined;
  active?: boolean | undefined;
  badge_i18n?: Record<string, string> | undefined;
  min_app_version?: string | undefined;
  receiver_currency: "gold_coin";
}

export interface GiftMessagePayload {
  gift_id: string;
  gift_name: string;
  asset_key: string;
  gold_coin_amount: number;
  receiver_currency: "gold_coin";
  recipient_id?: string | undefined;
  recipient_name?: string | undefined;
  recipient_avatar_url?: string | undefined;
  sender_id?: string | undefined;
  sender_name?: string | undefined;
}

export interface GiftRecipient {
  id: string;
  name: string;
  avatar_url: string;
}

export type ChatMoneyKind = "red_packet" | "transfer";
export type ChatMoneyScope = "dm" | "group";
export type ChatMoneyRedPacketMode = "direct" | "lucky" | "equal" | "exclusive";
export type ChatMoneyStatus =
  "pending" | "partial" | "completed" | "accepted" | "returned" | "expired_refunded";
export type ChatMoneyViewerState =
  | "claimable"
  | "claimed"
  | "empty"
  | "expired"
  | "not_designated"
  | "sender_view"
  | "transfer_receivable"
  | "transfer_sender_waiting"
  | "transfer_observer"
  | "accepted"
  | "returned"
  | "expired_refunded";
export type ChatMoneyUnavailableReason =
  | "red_packet_already_claimed"
  | "red_packet_empty"
  | "red_packet_expired"
  | "red_packet_recipient_only"
  | "not_conversation_member"
  | "transfer_recipient_only"
  | "transfer_already_finalized";

export interface ChatMoneyPayload {
  schema_version: number;
  asset_id: string;
  kind: ChatMoneyKind;
  scope: ChatMoneyScope;
  mode?: ChatMoneyRedPacketMode | undefined;
  sender_id: string;
  recipient_id?: string | undefined;
  recipient_name?: string | undefined;
  greeting?: string | undefined;
  note?: string | undefined;
  amount?: number | undefined;
  packet_count?: number | undefined;
  claimed_count?: number | undefined;
  status: ChatMoneyStatus;
  expires_at?: string | undefined;
  version: number;
}

export interface ChatMoneyClaimRecord {
  user_id: string;
  nickname: string;
  avatar_url?: string | undefined;
  amount: number;
  claimed_at: string;
  is_luckiest: boolean;
}

export interface ChatMoneyDetail extends ChatMoneyPayload {
  sender_name?: string | undefined;
  sender_avatar_url?: string | undefined;
  total_amount?: number | undefined;
  claimed_amount?: number | undefined;
  can_claim: boolean;
  can_accept: boolean;
  can_return: boolean;
  viewer_claim_amount?: number | undefined;
  claims: ChatMoneyClaimRecord[];
  created_at?: string | undefined;
  finalized_at?: string | undefined;
  viewer_state?: ChatMoneyViewerState | undefined;
  unavailable_reason?: ChatMoneyUnavailableReason | undefined;
  remaining_amount?: number | undefined;
  remaining_count?: number | undefined;
}

export interface ChatMoneyLimits {
  minimum_amount: number;
  maximum_amount: number;
  maximum_packet_count: number;
  expiry_seconds: number;
  red_packet_minimum_amount: number;
  red_packet_maximum_amount: number;
  transfer_minimum_amount: number;
  transfer_maximum_amount: number;
  maximum_greeting_length: number;
  maximum_transfer_note_length: number;
}

export interface ChatMoneyEligibility {
  eligible: boolean;
  reason_code?: string | undefined;
  message?: string | undefined;
  action_url?: string | undefined;
}

export interface ChatMoneyConfiguration {
  red_packet_enabled: boolean;
  transfer_enabled: boolean;
  limits: ChatMoneyLimits;
  eligibility: ChatMoneyEligibility;
}

export interface ChatMoneyRecipient {
  id: string;
  name: string;
  avatar_url: string;
}

export interface ChatMoneyCreationResult {
  direct_message?: Message | undefined;
  group_message?: GroupMessage | undefined;
  payload: ChatMoneyPayload;
  wallet_balance?: WalletBalanceSnapshot | undefined;
}

export interface ChatMoneyActionResult {
  detail: ChatMoneyDetail;
  payload: ChatMoneyPayload;
  wallet_balance?: WalletBalanceSnapshot | undefined;
  direct_receipt_message?: Message | undefined;
  group_receipt_message?: GroupMessage | undefined;
}

export type ChatMoneyReceiptEventType =
  "red_packet_claimed" | "transfer_accepted" | "transfer_returned" | "asset_expired_refunded";

export interface ChatMoneyReceiptPayload {
  event_id: string;
  asset_id: string;
  event_type: ChatMoneyReceiptEventType;
  kind?: ChatMoneyKind | undefined;
  scope?: ChatMoneyScope | undefined;
  actor_id?: string | undefined;
  actor_name?: string | undefined;
  sender_id?: string | undefined;
  sender_name?: string | undefined;
  recipient_id?: string | undefined;
  recipient_name?: string | undefined;
  amount?: number | undefined;
  created_at?: string | undefined;
}

export interface MixedAssetCharge {
  charged_activity_cat_food: number;
  charged_gold_coins: number;
  total_charged: number;
  wallet_balance: WalletBalanceSnapshot;
}

export interface PropConsumptionResult {
  inventory_id?: string | undefined;
  definition_id: string;
  remaining_quantity: number;
}

export interface MomentUnlockResult {
  moment?: Moment | undefined;
  charge?: MixedAssetCharge | undefined;
  consumed_prop?: PropConsumptionResult | undefined;
  already_unlocked: boolean;
}

export interface AgentProfile {
  name: string;
  tagline?: string | undefined;
  description?: string | undefined;
  tags?: string[] | undefined;
  language?: string | undefined;
  avatar_asset_id?: string | undefined;
}

export interface AgentGreeting {
  id: string;
  text: string;
}

export interface AgentCapabilities {
  paid_images: boolean;
  paid_videos: boolean;
  stickers?: boolean | undefined;
  platform_rewards?: boolean | undefined;
  proactive_messages?: boolean | undefined;
}

export interface AgentToneDefinition {
  style?: string | undefined;
  reply_length?: string | undefined;
}

export interface AgentRelationshipDefinition {
  type?: string | undefined;
  address_style?: string | undefined;
}

export interface AgentIntimacyDefinition {
  adult_enabled?: boolean | undefined;
  style?: string | undefined;
  initiative?: string | undefined;
}

export interface AgentDefinition {
  identity?: string | undefined;
  personality?: string[] | undefined;
  tone?: AgentToneDefinition | undefined;
  relationship?: AgentRelationshipDefinition | undefined;
  intimacy?: AgentIntimacyDefinition | undefined;
  greetings?: AgentGreeting[] | undefined;
  capabilities?: AgentCapabilities | undefined;
}

export interface AgentSummary {
  id: string;
  visibility?: string | undefined;
  status?: string | undefined;
  version_number?: number | undefined;
  revision?: number | undefined;
  is_owner?: boolean | undefined;
  profile?: AgentProfile | undefined;
  capabilities?: AgentCapabilities | undefined;
  greetings?: AgentGreeting[] | undefined;
  avatar_asset_id?: string | undefined;
  primary_reference_asset_id?: string | undefined;
  definition?: AgentDefinition | undefined;
}

export interface AgentReferenceUpload {
  primary_reference_asset_id: string;
  avatar_asset_id: string;
}

export interface AgentVersion {
  id?: string | undefined;
  agent_id?: string | undefined;
  version_number?: number | undefined;
  status?: string | undefined;
}

export interface AgentMediaUnlock {
  charge?: MixedAssetCharge | undefined;
  already_unlocked: boolean;
  content_url: string;
  download_url: string;
  consumed_prop?: PropConsumptionResult | undefined;
}

export interface AgentVisionConfig {
  max_images_per_turn: number;
}

export interface AgentRuntimeConfig {
  agents_enabled: boolean;
  image_input_enabled: boolean;
  paid_images_enabled: boolean;
  paid_videos_enabled: boolean;
  vision: AgentVisionConfig;
  image_price_points?: number | undefined;
}

export interface AgentSummaryPage {
  agents: AgentSummary[];
  has_more: boolean;
  next_cursor?: string | undefined;
}

export interface AgentActor {
  type: string;
  id: string;
}

export interface AgentPartMetadata {
  media_type?: string | undefined;
  generation_status?: string | undefined;
  price_points?: number | undefined;
  access?: string | undefined;
  preview_url?: string | undefined;
  content_url?: string | undefined;
  download_url?: string | undefined;
  width?: number | undefined;
  height?: number | undefined;
  error_code?: string | undefined;
}

export interface AgentMessagePart {
  id: string;
  ordinal: number;
  type: string;
  text: string;
  asset_id?: string | undefined;
  reference_id?: string | undefined;
  metadata: AgentPartMetadata;
}

export interface AgentMessage {
  id: string;
  conversation_id: string;
  sequence_no: number;
  sender: AgentActor;
  turn_id?: string | undefined;
  source: string;
  status: string;
  reply_to_id?: string | undefined;
  client_message_id?: string | undefined;
  created_at: string;
  updated_at: string;
  parts: AgentMessagePart[];
}

export interface AgentConversation {
  id: string;
  title: string;
  status: string;
  agent_id: string;
  agent_version_id: string;
  agent_profile: AgentProfile;
  agent_capabilities: AgentCapabilities;
  latest_message?: AgentMessage | undefined;
  created_at: string;
  updated_at: string;
}

export interface AgentMessagePage {
  messages: AgentMessage[];
  has_more: boolean;
}

export interface AgentTurn {
  id: string;
  conversation_id: string;
  trigger_message_id: string;
  response_message_id?: string | undefined;
  status: string;
  interaction_mode: string;
  chat_model: string;
  vision_model: string;
  error_code: string;
  error_detail: string;
  created_at: string;
  updated_at: string;
  completed_at?: string | undefined;
}

export interface AgentTurnAccepted {
  turn: AgentTurn;
  message: AgentMessage;
  events_url: string;
}

export interface AgentTurnResult {
  turn: AgentTurn;
  response_message?: AgentMessage | undefined;
}

export interface ShortDramaCreator {
  user_id: string;
  username: string;
  nickname: string;
  avatar_url: string;
  followed_by_me: boolean;
  follows_me: boolean;
  is_friend: boolean;
}

export type ShortDramaPublishStatus =
  "draft" | "processing" | "reviewing" | "published" | "rejected" | "failed" | "unknown";

export interface ShortDramaVideo {
  id: string;
  drama_id: string;
  creator: ShortDramaCreator;
  drama_title: string;
  title: string;
  intro: string;
  episode_number?: number | undefined;
  cover_url: string;
  play_url: string;
  hls_url?: string | undefined;
  mp4_url?: string | undefined;
  duration_seconds?: number | undefined;
  playback_position_seconds: number;
  like_count: number;
  comment_count: number;
  liked_by_me: boolean;
  publish_status?: ShortDramaPublishStatus | undefined;
  status_message?: string | undefined;
  unlock_price_gold_coins?: number | undefined;
  is_unlocked: boolean;
  is_owned_by_current_user: boolean;
}

export interface ShortDramaSeries {
  series_id: string;
  title: string;
  intro: string;
  cover_url: string;
  episode_count: number;
  status: ShortDramaPublishStatus;
  status_message?: string | undefined;
  updated_at: string;
  episodes: ShortDramaVideo[];
  creator: ShortDramaCreator;
  resume_episode_id?: string | undefined;
  resume_position_seconds: number;
  last_watched_at?: string | undefined;
}

export interface ShortDramaSeriesPage {
  series: ShortDramaSeries[];
  has_more: boolean;
  next_cursor?: string | undefined;
}

export type ShortDramaSeriesFilter = "recommended" | "watched";

export interface ShortDramaFeedPage {
  videos: ShortDramaVideo[];
  has_more: boolean;
  next_cursor?: string | undefined;
}

export interface ShortDramaUnlockResult {
  video?: ShortDramaVideo | undefined;
  charge?: MixedAssetCharge | undefined;
}

export interface ShortDramaEpisodeUploadResult {
  video?: ShortDramaVideo | undefined;
  status?: ShortDramaPublishStatus | undefined;
  status_message?: string | undefined;
}

export interface ShortDramaComment {
  id: string;
  video_id: string;
  user_id: string;
  nickname: string;
  avatar_url: string;
  content: string;
  created_at: string;
}

export interface ShortDramaCommentsPage {
  comments: ShortDramaComment[];
  has_more: boolean;
  next_cursor?: string | undefined;
}

export interface ShortDramaInteractionResult {
  liked?: boolean | undefined;
  like_count?: number | undefined;
}

export interface ChatGroup {
  group_id: number;
  name: string;
  avatar_url: string;
  creator_id: string;
  member_count: number;
  last_message?: string | undefined;
  last_message_time?: string | undefined;
  last_message_sender?: string | undefined;
  last_message_sender_id?: string | undefined;
  unread_count: number;
  is_public: boolean;
  is_muted: boolean;
}

export interface GroupMember {
  user_id: string;
  nickname: string;
  avatar_url: string;
  role: string;
  group_nickname?: string | undefined;
}

export interface GroupCapabilities {
  can_manage_members: boolean;
  can_edit_group: boolean;
  can_edit_announcement: boolean;
  can_create_invite: boolean;
  can_change_visibility: boolean;
  can_dismiss_group: boolean;
}

export interface GroupNotificationSettings {
  group_id: number;
  muted: boolean;
  notify_mentions_me: boolean;
  notify_mentions_all: boolean;
  important_member_ids: string[];
  revision: number;
  updated_at?: string | undefined;
}

export interface GroupViewerSettings {
  group_id: number;
  remark: string;
  show_member_nicknames: boolean;
  cleared_before_sequence?: number | undefined;
  revision: number;
  updated_at?: string | undefined;
}

export interface GroupAnnouncement {
  announcement_id: string;
  group_id: number;
  title: string;
  content: string;
  updated_by_id?: string | undefined;
  updated_by_nickname?: string | undefined;
  revision: number;
  updated_at?: string | undefined;
}

export interface GroupMemberUpdateEvent {
  group_id: number;
  member: GroupMember;
  revision: number;
}

export interface GroupDetail {
  group_id: number;
  name: string;
  avatar_url: string;
  creator_id: string;
  members: GroupMember[];
  is_public: boolean;
  notification_settings: GroupNotificationSettings;
  viewer_settings: GroupViewerSettings;
  announcement?: GroupAnnouncement | undefined;
  current_member?: GroupMember | undefined;
  capabilities: GroupCapabilities;
  display_name?: string | undefined;
}

export interface GroupHistoryClearReceipt {
  group_id: number;
  cleared_before_sequence: number;
  cleared_at?: string | undefined;
  revision: number;
}

export interface ConversationPreference {
  conversation_type: string;
  target_id: string;
  is_pinned: boolean;
  is_hidden: boolean;
  revision: number;
  updated_at?: string | undefined;
}

export interface GroupReplyPreview {
  id: number;
  sender_id: string;
  msg_type: string;
  content: string;
}

export type ScriptActorType = "user" | "ai";
export type ScriptRoomStatus = "active" | "ended";
export type ScriptTurnStatus = "queued" | "generating" | "completed" | "failed";

export interface GroupMessageScriptContext {
  room_id: string;
  role_id: string;
  actor_type: ScriptActorType;
  turn_id: string;
}

export interface GroupMessage {
  id: number;
  group_id: number;
  sender_id: string;
  msg_type: string;
  content: string;
  timestamp: string;
  sender_nickname: string;
  sender_avatar: string;
  reply_to_id?: number | undefined;
  reply_to?: GroupReplyPreview | undefined;
  mentions?: string[] | undefined;
  mention_all: boolean;
  client_message_id?: string | undefined;
  script_context?: GroupMessageScriptContext | undefined;
  history_sequence?: number | undefined;
  version: number;
  updated_at?: string | undefined;
  thumbnail_url?: string | undefined;
  media_width?: number | undefined;
  media_height?: number | undefined;
  delivery_status?: "sending" | "sent" | "failed" | undefined;
}

export interface GroupMessageLocator {
  message_id: number;
  history_sequence?: number | undefined;
}

export interface GroupMessageSearchResult {
  message: GroupMessage;
  locator: GroupMessageLocator;
  highlighted_text?: string | undefined;
}

export interface GroupMessageSearchPage {
  results: GroupMessageSearchResult[];
  next_cursor?: string | undefined;
  has_more: boolean;
}

export interface Conversation {
  type: string;
  id: string;
  name: string;
  avatar_url: string;
  last_message?: string | undefined;
  last_message_time?: string | undefined;
  last_message_sender_id?: string | undefined;
  unread_count: number;
  subtitle?: string | undefined;
  group_id?: number | undefined;
  member_count?: number | undefined;
  conversation_kind?: string | undefined;
  script_room_id?: string | undefined;
  script_id?: string | undefined;
  agent_conversation_id?: string | undefined;
  agent_id?: string | undefined;
  agent_avatar_asset_id?: string | undefined;
  agent_greeting_id?: string | undefined;
  last_message_id?: number | undefined;
  read_through_message_id?: number | undefined;
  revision?: number | undefined;
  is_muted: boolean;
  is_pinned?: boolean | undefined;
}

export interface ScriptRole {
  role_id: string;
  client_role_id?: string | undefined;
  name: string;
  gender: string;
  avatar_url: string;
  description: string;
  hidden_setting?: string | undefined;
  sort_order: number;
}

export type ScriptScope = "public" | "mine";
export type ScriptVisibility = "private" | "public";
export type ScriptStatus = "draft" | "ready" | "archived";

export interface ScriptCategory {
  id: string;
  name: string;
  icon_url?: string | undefined;
  sort_order: number;
}

export interface ScriptCreator {
  user_id: string;
  nickname: string;
  avatar_url: string;
}

export interface InteractiveScript {
  script_id: string;
  title: string;
  synopsis: string;
  cover_url: string;
  category_ids: string[];
  visibility: ScriptVisibility;
  status: ScriptStatus;
  creator: ScriptCreator;
  roles: ScriptRole[];
  world_setting?: string | undefined;
  is_admin_hidden: boolean;
  hidden_reason?: string | undefined;
  created_at?: string | undefined;
  updated_at?: string | undefined;
}

export interface ScriptPage {
  scripts: InteractiveScript[];
  has_more: boolean;
  next_cursor?: string | undefined;
}

export interface ScriptRoleAssignment {
  role_id: string;
  actor_type: ScriptActorType;
  user_id?: string | undefined;
}

export interface ScriptRoomSnapshot {
  title: string;
  synopsis: string;
  cover_url: string;
  roles: ScriptRole[];
}

export interface ScriptRoom {
  room_id: string;
  script_id: string;
  group_id: number;
  status: ScriptRoomStatus;
  player_role_id: string;
  assignments: ScriptRoleAssignment[];
  script_snapshot: ScriptRoomSnapshot;
}

export interface ScriptTurnResponse {
  turn_id: string;
  status: ScriptTurnStatus;
  user_message?: GroupMessage | undefined;
  ai_message?: GroupMessage | undefined;
}

export interface ScriptTurnState {
  room_id: string;
  turn_id: string;
  status: ScriptTurnStatus;
  error_code?: string | undefined;
  message?: string | undefined;
}

export interface ScriptRoomCreationData {
  room: ScriptRoom;
  conversation?: Conversation | undefined;
}

export interface ConversationSyncSnapshot {
  conversations: Conversation[];
  revision?: number | undefined;
  server_time?: string | undefined;
  total_unread_count?: number | undefined;
  snapshot_complete?: boolean | undefined;
}

export interface ConversationReadReceipt {
  conversation_type: string;
  conversation_id: string;
  read_through_message_id: number;
  unread_count: number;
  total_unread_count?: number | undefined;
  revision?: number | undefined;
  server_time?: string | undefined;
}

export type CallType = "voice" | "video";
export type CallState = "idle" | "outgoing" | "incoming" | "connecting" | "connected" | "ended";

export interface LiveBillingPolicy {
  currency: string;
  freeSeconds: number;
  unitSeconds: number;
  amountPerUnit: number;
  minimumStartingBalance: number;
  rounding: string;
}

export interface LiveExperienceSnapshot {
  definitionId: string;
  durationSeconds: number;
  status: "reserved" | "active" | "consumed" | "released" | "completed" | "unknown";
  startedAt?: string | undefined;
  endsAt?: string | undefined;
  remainingSeconds?: number | undefined;
  autoContinuePaymentMethod?: string | undefined;
  hostEarningEnabled: boolean;
  reservedProp?: PropConsumptionResult | undefined;
  consumedProp?: PropConsumptionResult | undefined;
  serverTime?: string | undefined;
  receivedAt: number;
}

export interface CallConnectionCredentials {
  call_id?: string | undefined;
  room_name: string;
  token: string;
  livekit_url: string;
  call_type?: CallType | undefined;
  participant_count?: number | undefined;
  billing_policy?: LiveBillingPolicy | undefined;
  live_experience?: LiveExperienceSnapshot | undefined;
}

/** Exact decoded shape of Swift `CallStartResponse` on the group-call route. */
export interface GroupCallStartCredentials {
  call_id?: string | undefined;
  room_name: string;
  token: string;
  livekit_url: string;
  call_type: string;
  participant_count?: number | undefined;
}

export interface GroupCallStatus {
  active: boolean;
  call_id?: string | undefined;
  room_name?: string | undefined;
  call_type?: string | undefined;
  participant_count?: number | undefined;
}

export interface CallSession {
  id: string;
  remote_user_id: string;
  remote_nickname: string;
  remote_avatar_url: string;
  call_type: CallType;
  is_outgoing: boolean;
  state: CallState;
  started_at: number;
  connected_at?: number | undefined;
  call_id?: string | undefined;
  room_name?: string | undefined;
  token?: string | undefined;
  livekit_url?: string | undefined;
  group_id?: number | undefined;
  group_name?: string | undefined;
  is_live_pair?: boolean | undefined;
  live_role_setting?: string | undefined;
  live_billing_policy?: LiveBillingPolicy | undefined;
  live_experience?: LiveExperienceSnapshot | undefined;
  confirmed_live_activity_cat_food_charge?: number | undefined;
  confirmed_live_gold_coin_charge?: number | undefined;
  confirmed_live_total_charge?: number | undefined;
  confirmed_live_earning_activity_cat_food?: number | undefined;
  confirmed_live_earning_gold_coins?: number | undefined;
  live_ending_message?: string | undefined;
  live_ending_detail?: string | undefined;
}

export interface CallQualityStreamReport {
  width?: number | undefined;
  height?: number | undefined;
  fps?: number | undefined;
  bitrateBps?: number | undefined;
  packetsLost?: number | undefined;
  nackCount?: number | undefined;
  pliCount?: number | undefined;
  firCount?: number | undefined;
  framesDropped?: number | undefined;
  freezeCount?: number | undefined;
  rttMs?: number | undefined;
  fractionLost?: number | undefined;
  qualityLimitationReason?: string | undefined;
}

export interface CallQualityReport {
  appBuild: string;
  sampleCount: number;
  outbound?: CallQualityStreamReport | undefined;
  inbound?: CallQualityStreamReport | undefined;
  iceTransport?: string | undefined;
  relay?: boolean | undefined;
}

export interface ReplyPreview {
  id: number;
  sender_id: string;
  msg_type: string;
  content: string;
}

export interface Message {
  id: number;
  sender_id: string;
  receiver_id: string;
  msg_type: string;
  content: string;
  timestamp: string;
  reply_to_id?: number | undefined;
  reply_to?: ReplyPreview | undefined;
  client_message_id?: string | undefined;
  version: number;
  updated_at?: string | undefined;
  thumbnail_url?: string | undefined;
  media_width?: number | undefined;
  media_height?: number | undefined;
  delivery_status?: "sending" | "sent" | "failed" | undefined;
}

export type ChatConversationType = "dm" | "group";
export type ForwardMode = "single" | "individual" | "merged";

export interface ForwardMessageSource {
  conversation_type: ChatConversationType;
  conversation_id: string;
  message_id: number;
  expected_version: number;
}

export interface ForwardTarget {
  conversation_type: ChatConversationType;
  conversation_id: string;
  display_name: string;
  avatar_url: string;
}

export interface ForwardRequest {
  client_operation_id: string;
  mode: ForwardMode;
  sources: ForwardMessageSource[];
  targets: Pick<ForwardTarget, "conversation_type" | "conversation_id">[];
}

export interface ForwardCreatedMessage {
  conversation_type: ChatConversationType;
  conversation_id: string;
  message_id: number;
}

export interface ForwardOperationResult {
  client_operation_id: string;
  bundle_id?: string | undefined;
  created_messages: ForwardCreatedMessage[];
}

export interface ForwardBundleItem {
  ordinal: number;
  sender_name: string;
  sent_at: string;
  message_type: string;
  summary: string;
  asset_id?: string | undefined;
}

export interface ForwardBundle {
  bundle_id: string;
  title: string;
  created_at: string;
  items: ForwardBundleItem[];
}

export interface ForwardBundleMessagePayload {
  bundle_id: string;
  title: string;
  item_count: number;
  summary: string;
}

export interface DirectHistoryClearReceipt {
  conversation_id: string;
  cleared_before_message_id: number;
  cleared_at?: string | undefined;
  revision: number;
}

export interface APIEnvelope<T> {
  code?: number | string;
  message?: string;
  data?: T;
}
