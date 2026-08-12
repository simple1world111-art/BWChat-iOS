import { router, Stack } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { SilentRefreshControl as RefreshControl } from "@/components/ui/SilentRefreshControl";
import {
  ProfileFieldDivider,
  ProfileGroupedCard,
  ProfileNoticeBanner,
  ProfileRowDivider,
} from "@/components/profile/ProfileSettingsChrome";
import { useAuth } from "@/providers/AuthProvider";
import { useLocalization } from "@/providers/LocalizationProvider";
import {
  accountComplianceErrorCode,
  accountComplianceFallbackMessage,
  authorizeAccountDeletion,
  createClientRequestId,
  getAccountDeletionPreview,
  requestAccountDeletion,
  type AccountDeletionPreview,
  type DeletionAuthorization,
} from "@/services/account/AccountComplianceService";
import { colors } from "@/theme";

export default function AccountDeletionScreen() {
  const { activeLanguage, t } = useLocalization();
  const { user, isSessionUnverified, finalizeAccountDeletion } = useAuth();
  const ownerId = user?.user_id ?? "";
  const mounted = useRef(true);
  const generation = useRef(0);
  const submitLock = useRef(false);
  const scrollRef = useRef<ScrollView>(null);
  const authorizationRef = useRef<DeletionAuthorization | null>(null);
  const requestIdRef = useRef<string | null>(null);
  const [preview, setPreview] = useState<AccountDeletionPreview | null>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [confirmationUsername, setConfirmationUsername] = useState("");
  const [authorization, setAuthorization] = useState<DeletionAuthorization | null>(null);
  const [isLoading, setLoading] = useState(false);
  const [isSubmitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canAuthorize =
    Boolean(preview) &&
    currentPassword.length > 0 &&
    confirmationUsername === preview?.confirmationUsername &&
    !isLoading &&
    !isSubmitting;

  useEffect(
    () => () => {
      mounted.current = false;
      generation.current += 1;
    },
    [],
  );

  const revealDeletionInput = useCallback((target: number) => {
    requestAnimationFrame(() => {
      if (!mounted.current) return;
      scrollRef.current?.scrollResponderScrollNativeHandleToKeyboard(
        target,
        deletionInputKeyboardClearance,
        true,
      );
    });
  }, []);

  const load = useCallback(async () => {
    if (isSessionUnverified || !ownerId || submitLock.current) return;
    const operation = ++generation.current;
    const current = () => mounted.current && operation === generation.current;
    authorizationRef.current = null;
    setAuthorization(null);
    requestIdRef.current = null;
    setLoading(true);
    setError(null);
    try {
      const next = await getAccountDeletionPreview();
      if (!current()) return;
      setPreview(next);
      setCurrentPassword("");
      setConfirmationUsername("");
    } catch (nextError) {
      if (current()) {
        setPreview(null);
        setError(deletionError(nextError, t));
      }
    } finally {
      if (current()) setLoading(false);
    }
  }, [isSessionUnverified, ownerId, t]);

  useEffect(() => {
    const task = setTimeout(() => void load(), 0);
    return () => clearTimeout(task);
  }, [load]);

  const submitAcceptedDeletion = async () => {
    const authorization = authorizationRef.current;
    if (!authorization || submitLock.current || isSubmitting) return;
    submitLock.current = true;
    const operation = ++generation.current;
    const current = () => mounted.current && operation === generation.current;
    const clientRequestId = requestIdRef.current ?? createClientRequestId();
    requestIdRef.current = clientRequestId;
    setSubmitting(true);
    setError(null);
    try {
      const receipt = await requestAccountDeletion({
        deletionAuthorizationToken: authorization.deletionAuthorizationToken,
        clientRequestId,
      });
      if (!current()) return;
      authorizationRef.current = null;
      setAuthorization(null);
      requestIdRef.current = null;
      finalizeAccountDeletion(ownerId);
      router.replace({
        pathname: "/(auth)/account-deletion-accepted",
        params: {
          requestId: receipt.requestId,
          purgeBy: receipt.purgeBy,
        },
      } as never);
    } catch (nextError) {
      if (!current()) return;
      const code = accountComplianceErrorCode(nextError);
      if (code === "DELETION_PREVIEW_STALE") {
        authorizationRef.current = null;
        setAuthorization(null);
        requestIdRef.current = null;
        setError(t("account.deletion.previewStale"));
        setTimeout(() => void load(), 0);
      } else if (code === "DELETION_AUTHORIZATION_EXPIRED") {
        authorizationRef.current = null;
        setAuthorization(null);
        requestIdRef.current = null;
        setError(t("account.deletion.authorizationExpired"));
      } else {
        // The outcome may be unknown. Keep both the single-purpose token and
        // the idempotency key in memory so the next tap asks the same request.
        setError(deletionError(nextError, t));
      }
    } finally {
      submitLock.current = false;
      if (current()) setSubmitting(false);
    }
  };

  const showFinalConfirmation = () => {
    Alert.alert(t("account.deletion.finalTitle"), t("account.deletion.finalMessage"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("account.deletion.finalAction"),
        style: "destructive",
        onPress: () => void submitAcceptedDeletion(),
      },
    ]);
  };

  const authorize = async () => {
    if (submitLock.current || isSubmitting) return;
    if (authorizationRef.current) {
      showFinalConfirmation();
      return;
    }
    if (!preview || !canAuthorize) return;
    submitLock.current = true;
    const operation = ++generation.current;
    const current = () => mounted.current && operation === generation.current;
    let shouldConfirm = false;
    Keyboard.dismiss();
    setSubmitting(true);
    setError(null);
    try {
      const authorization = await authorizeAccountDeletion({
        currentPassword,
        confirmationUsername,
        previewToken: preview.previewToken,
      });
      if (!current()) return;
      authorizationRef.current = authorization;
      setAuthorization(authorization);
      requestIdRef.current = createClientRequestId();
      setCurrentPassword("");
      shouldConfirm = true;
    } catch (nextError) {
      if (!current()) return;
      if (accountComplianceErrorCode(nextError) === "DELETION_PREVIEW_STALE") {
        setError(t("account.deletion.previewStale"));
        setTimeout(() => void load(), 0);
      } else {
        setError(deletionError(nextError, t));
      }
    } finally {
      submitLock.current = false;
      if (current()) setSubmitting(false);
    }
    if (shouldConfirm && current()) showFinalConfirmation();
  };

  if (isSessionUnverified) {
    return (
      <>
        <Stack.Screen options={{ title: t("account.deletion.title") }} />
        <View style={styles.offline}>
          <ProfileNoticeBanner message={t("account.security.onlineRequired")} />
        </View>
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: t("account.deletion.title") }} />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.screen}
      >
        <ScrollView
          ref={scrollRef}
          automaticallyAdjustKeyboardInsets={false}
          contentContainerStyle={styles.content}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={isLoading} onRefresh={() => void load()} />}
          showsVerticalScrollIndicator={false}
        >
          <ProfileNoticeBanner message={t("account.deletion.irreversibleDetail")} />
          {error ? <ProfileNoticeBanner message={error} /> : null}

          {isLoading && !preview ? (
            <View style={styles.loading}>
              <ActivityIndicator color={colors.accent} />
              <Text style={styles.secondary}>{t("account.deletion.loadingPreview")}</Text>
            </View>
          ) : null}

          {preview ? (
            <>
              <ProfileGroupedCard>
                {impactRows(preview, t).map((row, index) => (
                  <View key={row.label}>
                    {index > 0 ? <ProfileRowDivider /> : null}
                    <MetricRow label={row.label} value={String(row.value)} />
                  </View>
                ))}
              </ProfileGroupedCard>

              <ProfileGroupedCard>
                <SectionCopy
                  title={t("account.deletion.deleteCategories")}
                  lines={preview.deleteCategories.map((category) => categoryLabel(category, t))}
                />
                <ProfileRowDivider />
                <SectionCopy
                  title={t("account.deletion.retainedCategories")}
                  lines={preview.retainedCategories.map((item) =>
                    t(
                      "account.deletion.retentionLine",
                      categoryLabel(item.category, t),
                      item.retentionDays,
                      reasonLabel(item.reason, t),
                    ),
                  )}
                />
                <ProfileRowDivider />
                <MetricRow
                  label={t("account.deletion.purgeDeadline")}
                  value={estimatedPurgeDate(preview.purgeWithinDays, activeLanguage)}
                />
              </ProfileGroupedCard>

              <ProfileGroupedCard>
                <DeletionInput
                  label={t("password.current")}
                  placeholder={t("password.current.placeholder")}
                  secure
                  value={currentPassword}
                  disabled={Boolean(authorization) || isSubmitting}
                  onFocus={revealDeletionInput}
                  onChange={(value) => {
                    setCurrentPassword(value);
                    authorizationRef.current = null;
                    setAuthorization(null);
                    requestIdRef.current = null;
                  }}
                />
                <ProfileFieldDivider />
                <DeletionInput
                  label={t("account.deletion.typeUsername")}
                  placeholder={preview.confirmationUsername}
                  value={confirmationUsername}
                  disabled={Boolean(authorization) || isSubmitting}
                  onFocus={revealDeletionInput}
                  onChange={(value) => {
                    setConfirmationUsername(value);
                    authorizationRef.current = null;
                    setAuthorization(null);
                    requestIdRef.current = null;
                  }}
                />
              </ProfileGroupedCard>

              <Pressable
                accessibilityRole="button"
                accessibilityState={{
                  busy: isSubmitting,
                  disabled: isSubmitting || (!authorization && !canAuthorize),
                }}
                disabled={isSubmitting || (!authorization && !canAuthorize)}
                onPress={() => void authorize()}
                style={({ pressed }) => [
                  styles.deleteButton,
                  !authorization && !canAuthorize && styles.disabled,
                  pressed && styles.pressed,
                ]}
              >
                {isSubmitting ? <ActivityIndicator color="#FFFFFF" /> : null}
                <Text style={styles.deleteButtonText}>
                  {t(authorization ? "account.deletion.retry" : "account.deletion.continue")}
                </Text>
              </Pressable>
            </>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metricRow}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  );
}

function SectionCopy({ title, lines }: { title: string; lines: string[] }) {
  return (
    <View style={styles.sectionCopy}>
      <Text style={styles.metricLabel}>{title}</Text>
      {lines.map((line, index) => (
        <Text key={`${line}-${index}`} style={styles.secondary}>
          {tombstoneBullet(line)}
        </Text>
      ))}
    </View>
  );
}

function DeletionInput({
  label,
  placeholder,
  value,
  secure = false,
  disabled = false,
  onFocus,
  onChange,
}: {
  label: string;
  placeholder: string;
  value: string;
  secure?: boolean;
  disabled?: boolean;
  onFocus: (target: number) => void;
  onChange: (value: string) => void;
}) {
  return (
    <View style={styles.inputRow}>
      <Text style={styles.metricLabel}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        accessibilityState={{ disabled }}
        autoCapitalize="none"
        autoCorrect={false}
        editable={!disabled}
        placeholder={placeholder}
        placeholderTextColor={colors.tertiaryText}
        secureTextEntry={secure}
        style={styles.input}
        textContentType={secure ? "password" : "username"}
        value={value}
        onFocus={(event) => onFocus(event.nativeEvent.target)}
        onChangeText={onChange}
      />
    </View>
  );
}

const deletionInputKeyboardClearance = 200;

function impactRows(
  preview: AccountDeletionPreview,
  t: (key: string, ...args: (string | number)[]) => string,
) {
  return [
    { label: t("account.deletion.impact.coins"), value: preview.impact.goldCoinsToForfeit },
    { label: t("account.deletion.impact.props"), value: preview.impact.propsToForfeit },
    {
      label: t("account.deletion.impact.cancellableWithdrawals"),
      value: preview.impact.cancellableWithdrawals,
    },
    {
      label: t("account.deletion.impact.settlingWithdrawals"),
      value: preview.impact.settlingWithdrawals,
    },
    {
      label: t("account.deletion.impact.groups"),
      value: preview.impact.ownedGroupsToDissolve,
    },
  ];
}

function categoryLabel(
  category: string,
  t: (key: string, ...args: (string | number)[]) => string,
): string {
  const keys: Record<string, string> = {
    profile: "account.deletion.category.profile",
    contact_data: "account.deletion.category.contactData",
    location: "account.deletion.category.location",
    public_content: "account.deletion.category.publicContent",
    private_media: "account.deletion.category.privateMedia",
    social_relationships: "account.deletion.category.socialRelationships",
    financial_ledger: "account.deletion.category.financialLedger",
    security_events: "account.deletion.category.securityEvents",
    deletion_audit: "account.deletion.category.deletionAudit",
  };
  return keys[category] ? t(keys[category]!) : category;
}

function reasonLabel(
  reason: string,
  t: (key: string, ...args: (string | number)[]) => string,
): string {
  return reason === "financial_and_payment_compliance"
    ? t("account.deletion.reason.financialCompliance")
    : reason;
}

function tombstoneBullet(value: string): string {
  return `• ${value}`;
}

function estimatedPurgeDate(days: number, locale: string): string {
  const date = new Date(Date.now() + Math.max(0, days) * 24 * 60 * 60 * 1_000);
  return new Intl.DateTimeFormat(locale).format(date);
}

function deletionError(
  error: unknown,
  t: (key: string, ...args: (string | number)[]) => string,
): string {
  const code = accountComplianceErrorCode(error);
  const keys: Record<string, string> = {
    INVALID_CURRENT_PASSWORD: "account.error.invalidCurrentPassword",
    DELETION_PREVIEW_STALE: "account.deletion.previewStale",
    DELETION_AUTHORIZATION_EXPIRED: "account.deletion.authorizationExpired",
    ACCOUNT_DELETION_PENDING: "account.deletion.pending",
    IDEMPOTENCY_CONFLICT: "account.error.idempotencyConflict",
    RATE_LIMITED: "account.error.rateLimited",
  };
  if (code && keys[code]) return t(keys[code]!);
  return accountComplianceFallbackMessage(error, t);
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: {
    flexGrow: 1,
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 30,
    rowGap: 16,
    backgroundColor: colors.background,
  },
  offline: { flex: 1, padding: 16, backgroundColor: colors.background },
  loading: { minHeight: 120, alignItems: "center", justifyContent: "center", rowGap: 12 },
  metricRow: {
    minHeight: 50,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    columnGap: 16,
  },
  metricLabel: { flexShrink: 1, color: colors.text, fontSize: 15, fontWeight: "600" },
  metricValue: { color: colors.danger, fontSize: 16, fontWeight: "700" },
  sectionCopy: { paddingVertical: 6, rowGap: 8 },
  secondary: { color: colors.secondaryText, fontSize: 13, lineHeight: 19, fontWeight: "500" },
  inputRow: { minHeight: 64, paddingVertical: 5, rowGap: 6 },
  input: { minHeight: 34, padding: 0, color: colors.text, fontSize: 15 },
  deleteButton: {
    minHeight: 50,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    columnGap: 8,
    borderRadius: 16,
    backgroundColor: colors.danger,
  },
  deleteButtonText: { color: "#FFFFFF", fontSize: 16, fontWeight: "700" },
  pressed: { opacity: 0.72 },
  disabled: { opacity: 0.45 },
});
